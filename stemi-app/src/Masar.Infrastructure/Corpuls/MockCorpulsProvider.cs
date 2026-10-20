using System.Text.Json;
using Masar.Application.Abstractions;
using Masar.Application.Common;
using Masar.Application.Monitoring;
using Masar.Infrastructure.Configuration;
using Microsoft.Extensions.Logging;

namespace Masar.Infrastructure.Corpuls;

/// <summary>
/// Mock Corpuls Provider — PROTOTYPE ONLY. The simulated corpuls feed of this build: no real monitor, no
/// corpuls.mission, no network. Every value and every ECG is generated here and is fictional.
/// <para>
/// Each crew unit has one simulated corpuls3 (Ambulance 214 → SIM-C3-214). Linking a case starts that monitor's feed:
/// WAITING, then CONNECTED (when the simulated monitor is available), then vital signs every tick (HR and SpO₂ move
/// gradually towards their set values — never random —, RR every 30 s, a non-invasive blood pressure every
/// Corpuls:SimNibpSeconds) and 12-leads drawn at the monitor's heart rate of that moment. A 12-lead acquired before the
/// monitor connects, or during a signal loss, is held on the monitor and sent once connected; a disconnected monitor
/// transmits nothing. On reconnection the feed resends its last ECG and sample, as a real feed might: the platform
/// stores each once.
/// </para>
/// <para>
/// Demo mode (Corpuls:DemoMode, the prototype default) plays the crew's side by itself: every new link starts a fresh
/// simulated monitor; Corpuls:DemoEcgSeconds after it connects, ECG 1 is "acquired" (Sample A) unless the case already
/// has an ECG; the heart rate shows a fixed beat-to-beat variation; a requested repeat 12-lead can be acquired from the
/// crew screen (Sample B, then C).
/// </para>
/// Its timers run under the <see cref="PlatformGate"/>, like every change to the case record.
/// </summary>
public sealed class MockCorpulsProvider : ICorpulsProvider, ICorpulsSimulator, IDisposable
{
    public static readonly SimDefaults DefaultTarget = new(88, 98, 132, 78, 17);
    private const int ReconnectMs = 1500;
    private const long RrEveryMs = 30_000;
    private const string SettingsKey = "corpuls_sim";
    /// <summary>Demo mode: the small beat-to-beat variation of a monitor's heart rate, as a fixed pattern around the set value.</summary>
    private static readonly int[] HrWave = [0, 1, 1, 0, -1, -1];

    /// <summary>Simulation limits (what the simulated monitor can show), NOT clinical thresholds.</summary>
    private static readonly (string Key, string Name, int Low, int High)[] Limits =
        [("hr", "HR", 20, 250), ("spo2", "SpO₂", 50, 100), ("sys", "BP systolic", 40, 300), ("dia", "BP diastolic", 20, 200), ("rr", "RR", 4, 60)];

    private readonly PlatformGate _gate;
    private readonly ISettingsStore _store;
    private readonly TimeProvider _time;
    private readonly ILogger<MockCorpulsProvider> _log;
    private readonly int _tickMs;
    private readonly long _nibpMs;
    private readonly int _connectMs;
    private readonly bool _demo;
    private readonly int _demoEcgMs;
    private readonly OrderedDictionary<string, Device> _devices = new();
    private Dictionary<string, SavedDevice> _saved;
    private ICorpulsEventSink? _sink;
    private readonly ITimer _ticker;

    public MockCorpulsProvider(CorpulsOptions options, PlatformGate gate, ISettingsStore store, TimeProvider time, ILogger<MockCorpulsProvider> log)
    {
        _gate = gate;
        _store = store;
        _time = time;
        _log = log;
        _tickMs = Math.Max(100, options.SimTickMs);
        _nibpMs = Math.Max(1, options.SimNibpSeconds) * 1000L;
        _connectMs = Math.Max(0, options.SimConnectMs);
        _demo = options.DemoMode;
        _demoEcgMs = (int)Math.Max(0, options.DemoEcgSeconds * 1000);
        _saved = Load();
        _ticker = time.CreateTimer(_ => Guarded(Tick), null, TimeSpan.FromMilliseconds(_tickMs), TimeSpan.FromMilliseconds(_tickMs));
    }

    public string Name => MonitorRecordReader.MockProviderName;
    public bool Simulated => true;
    public bool DemoMode => _demo;
    public int ExpectedIntervalMs => _tickMs;
    public TimeSpan DemoEcgDelay => TimeSpan.FromMilliseconds(_demoEcgMs);
    public SimDefaults Defaults => DefaultTarget;
    public event Action? Changed;

    public void Attach(ICorpulsEventSink sink) => _sink = sink;

    // ---------- the simulated monitors ----------

    private sealed class Device(string id)
    {
        public string Id { get; } = id;
        public string? Unit;
        public string? Cad;
        public string Status = "idle";
        public long StatusAt;
        public bool Available = true, Paused, Signal = true;
        public SimVitalsTarget Target = new(DefaultTarget.Hr, DefaultTarget.Spo2, DefaultTarget.Sys, DefaultTarget.Dia, DefaultTarget.Rr);
        public SimCurrent? Cur;
        public SimBp? Bp;
        public long RrAt;
        public int Seq;
        public EcgAcquired? Last;
        public List<EcgAcquired> Held = [];
        public VitalsUpdated? LastVitals;
        public readonly List<ITimer> Timers = [];
        public ITimer? FirstEcgTimer;
        public int Wave;
        public bool AutoEcg;
        public long LinkedAt;
        public long LastAcq;
    }

    /// <summary>What survives a restart: the test console's choices for each simulated monitor (not clinical data).</summary>
    private sealed class SavedDevice
    {
        public string? Unit { get; set; }
        public bool? Available { get; set; }
        public bool? Paused { get; set; }
        public bool? Signal { get; set; }
        public SavedTarget? Target { get; set; }
    }

    private sealed class SavedTarget
    {
        public int? Hr { get; set; }
        public int? Spo2 { get; set; }
        public int? Sys { get; set; }
        public int? Dia { get; set; }
        public int? Rr { get; set; }
    }

    private Dictionary<string, SavedDevice> Load()
    {
        try
        {
            var raw = _store.Get(SettingsKey);
            return string.IsNullOrEmpty(raw) ? [] : JsonSerializer.Deserialize<Dictionary<string, SavedDevice>>(raw, JsonDefaults.Options) ?? [];
        }
        catch (JsonException e)
        {
            _log.LogWarning(e, "The saved corpuls simulator settings could not be read; starting from the defaults");
            return [];
        }
    }

    private void Save(Device d)
    {
        _saved[d.Id] = new SavedDevice
        {
            Unit = d.Unit, Available = d.Available, Paused = d.Paused, Signal = d.Signal,
            Target = new SavedTarget { Hr = d.Target.Hr, Spo2 = d.Target.Spo2, Sys = d.Target.Sys, Dia = d.Target.Dia, Rr = d.Target.Rr },
        };
        _store.Set(SettingsKey, JsonDefaults.Serialize(_saved));
    }

    private static string DeviceFor(string? unit)
    {
        var digits = new string((unit ?? string.Empty).SkipWhile(c => !char.IsAsciiDigit(c)).TakeWhile(char.IsAsciiDigit).ToArray());
        return $"SIM-C3-{(digits.Length > 0 ? digits : "000")}";
    }

    private static string Label(Device d) => $"corpuls3 {d.Id} · {d.Unit.Or("test unit")} (simulated)";

    private Device Dev(string id, string? unit = null)
    {
        if (!_devices.TryGetValue(id, out var d))
        {
            var s = _saved.GetValueOrDefault(id);
            var t = s?.Target;
            d = new Device(id)
            {
                Unit = unit.OrNull() ?? s?.Unit, StatusAt = _time.NowMs(), Available = s?.Available != false, Paused = s?.Paused == true, Signal = s?.Signal != false,
                Target = new SimVitalsTarget(t?.Hr ?? DefaultTarget.Hr, t?.Spo2 ?? DefaultTarget.Spo2, t?.Sys ?? DefaultTarget.Sys, t?.Dia ?? DefaultTarget.Dia, t?.Rr ?? DefaultTarget.Rr),
            };
            _devices[id] = d;
        }
        if (!string.IsNullOrEmpty(unit)) d.Unit = unit;
        return d;
    }

    private Device? ByCad(string cad) => _devices.Values.FirstOrDefault(d => d.Cad == cad);

    private void OnSim() => Changed?.Invoke();

    /// <summary>Runs a timer's work under the platform gate; a failure is logged and never stops the process.</summary>
    private void Guarded(Action work)
    {
        try
        {
            _gate.Run(_ => work());
        }
        catch (Exception e)
        {
            _log.LogError(e, "Simulated corpuls monitor timer failed");
        }
    }

    private ITimer Later(Device d, int ms, Action work)
    {
        ITimer? timer = null;
        timer = _time.CreateTimer(_ => Guarded(() =>
        {
            // a timer cleared while it was waiting for the gate does nothing
            if (timer is null || !d.Timers.Remove(timer)) return;
            timer.Dispose();
            work();
        }), null, TimeSpan.FromMilliseconds(Math.Max(0, ms)), Timeout.InfiniteTimeSpan);
        d.Timers.Add(timer);
        return timer;
    }

    private static void Stop(Device d)
    {
        foreach (var t in d.Timers) t.Dispose();
        d.Timers.Clear();
    }

    private CorpulsVerdict Emit(object e) => _sink is null
        ? CorpulsVerdict.Refused("No platform listening")
        : e switch
        {
            VitalsUpdated v => _sink.OnVitalsUpdated(v),
            EcgAcquired x => _sink.OnEcgAcquired(x),
            ConnectionChanged c => _sink.OnConnectionChanged(c),
            _ => CorpulsVerdict.Refused("Unknown event"),
        };

    private void SetStatus(Device d, string status, string reason)
    {
        if (d.Status == status) return;
        d.Status = status;
        d.StatusAt = _time.NowMs();
        OnSim();
        if (d.Cad is not null)
            Emit(ConnectionChanged.Create($"{d.Id}:c:{d.StatusAt}:{status}", d.Cad, d.StatusAt, status, d.Id, reason, _time.NowMs()));
    }

    /// <summary>The clean demo state of a simulated monitor: available, signal on, data flowing, the default values.</summary>
    private void Fresh(Device d)
    {
        d.Available = true;
        d.Signal = true;
        d.Paused = false;
        d.Target = new SimVitalsTarget(DefaultTarget.Hr, DefaultTarget.Spo2, DefaultTarget.Sys, DefaultTarget.Dia, DefaultTarget.Rr);
        d.Wave = 0;
        Save(d);
    }

    /// <summary>The heart rate the monitor shows now (what a 12-lead acquired now is drawn at).</summary>
    private static int HrNow(Device d) => d.LastVitals?.HeartRate ?? d.Cur?.Hr ?? d.Target.Hr;

    private static string DemoSample(int n) => n <= 1 ? "A" : n == 2 ? "B" : "C";

    private static int Toward(int v, int target, int step) => v < target ? Math.Min(target, v + step) : Math.Max(target, v - step);

    // ---------- the provider interface ----------

    public CorpulsLink ConnectCase(CorpulsLinkRequest request)
    {
        var d = Dev(request.DeviceId.OrNull() ?? DeviceFor(request.Unit), request.Unit);
        var previous = d.Cad is not null && d.Cad != request.Cad ? d.Cad : null;
        Stop(d);
        if (d.Cad != request.Cad)
        {
            d.Seq = 0;
            d.Last = null;
            d.Held = [];
            d.Cur = null;
            d.Bp = null;
            d.LastVitals = null;
            d.LastAcq = 0;
            // demo: a new link starts from the clean demo state, whatever an earlier demonstration left behind
            if (_demo) Fresh(d);
        }
        // the initial state is returned, not emitted: the platform stores the link first
        d.Cad = request.Cad;
        d.Status = CorpulsStatuses.Waiting;
        d.StatusAt = _time.NowMs();
        d.LinkedAt = d.StatusAt;
        // demo only: the platform's hint that the case has no ECG yet (a real provider has no such option)
        d.AutoEcg = _demo && request.AutoEcg;
        if (d.Available && d.Signal) Later(d, _connectMs, () => Online(d, again: false));
        OnSim();
        return new CorpulsLink(d.Id, Label(d), d.Status, previous);
    }

    public void RelinkCase(string oldCad, string newCad)
    {
        if (ByCad(oldCad) is not { } d) return;
        d.Cad = newCad;
        OnSim();
    }

    public void DisconnectCase(string cad, string reason)
    {
        if (ByCad(cad) is not { } d) return;
        Stop(d);
        d.Cad = null;
        d.Status = "idle";
        d.Held = [];
        d.AutoEcg = false;
        OnSim();
    }

    public CorpulsConnectionState? GetConnectionStatus(string cad) => ByCad(cad) is { } d ? new CorpulsConnectionState(d.Status, d.StatusAt, d.Id) : null;

    public VitalsUpdated? GetLatestVitals(string cad) => ByCad(cad)?.LastVitals;

    /// <summary>After a server restart: carry on with the feeds that were linked, silently (no new connection events).</summary>
    public void Resume(IReadOnlyList<CorpulsResumeLink> links)
    {
        foreach (var l in links)
        {
            var d = Dev(l.DeviceId, l.Unit);
            d.Cad = l.Cad;
            d.Status = l.Status.Or(CorpulsStatuses.Waiting);
            d.StatusAt = _time.NowMs();
            d.Seq = l.CorpulsEcgs;
            d.AutoEcg = _demo && l.TotalEcgs == 0;
            if (l.Vitals is { } v)
            {
                d.Cur = new SimCurrent(v.Hr ?? d.Target.Hr, v.Spo2 ?? d.Target.Spo2, v.Rr ?? d.Target.Rr);
                if (v.Sys is { } sys) d.Bp = new SimBp(sys, v.Dia ?? 0, v.BpAt ?? v.At);
            }
            if (d.Status == CorpulsStatuses.Waiting && d.Available && d.Signal) Later(d, _connectMs, () => Online(d, again: false));
            if (d.Status == CorpulsStatuses.Reconnecting && d.Available && d.Signal) Later(d, ReconnectMs, () => Online(d, again: true));
            if (d.Status == CorpulsStatuses.Connected) FirstEcgLater(d);
        }
        OnSim();
    }

    // ---------- the feed ----------

    /// <summary>
    /// The monitor comes online for its case: connected, then what was held during a signal loss, the resends of a
    /// reconnecting feed (duplicates, stored once by the platform), and a fresh sample with a blood pressure if none yet.
    /// </summary>
    private void Online(Device d, bool again)
    {
        if (d.Cad is null || !d.Available || !d.Signal) return;
        SetStatus(d, CorpulsStatuses.Connected, again ? "restored" : "monitor connected");
        if (again && d.Last is not null) Emit(d.Last);
        var held = d.Held;
        d.Held = [];
        foreach (var e in held)
        {
            var sent = e with { Timestamp = _time.NowMs() };
            d.Last = sent;
            Emit(sent);
        }
        if (again && d.LastVitals is not null) Emit(d.LastVitals);
        if (!d.Paused) Sample(d, nibp: d.Bp is null);
        FirstEcgLater(d);
    }

    /// <summary>Demo: shortly after the monitor connects, the crew acquires the first 12-lead on it.</summary>
    private void FirstEcgLater(Device d)
    {
        if (!d.AutoEcg || d.Seq > 0 || d.Held.Count > 0 || (d.FirstEcgTimer is not null && d.Timers.Contains(d.FirstEcgTimer))) return;
        var cad = d.Cad;
        d.FirstEcgTimer = Later(d, _demoEcgMs, () =>
        {
            if (d.Cad != cad || !d.AutoEcg || d.Seq > 0 || d.Status != CorpulsStatuses.Connected) return;
            d.AutoEcg = false;
            Acquire(d, DemoSample(1), 1, null);
        });
    }

    private CorpulsVerdict Sample(Device d, bool step = false, bool exact = false, bool nibp = false)
    {
        var t = _time.NowMs();
        var target = d.Target;
        d.Cur ??= new SimCurrent(target.Hr, target.Spo2, target.Rr);
        if (exact) d.Cur = new SimCurrent(target.Hr, target.Spo2, target.Rr);
        else if (step)
        {
            var rr = d.Cur.Rr;
            if (t - d.RrAt >= RrEveryMs)
            {
                rr = Toward(rr, target.Rr, 1);
                d.RrAt = t;
            }
            d.Cur = new SimCurrent(Toward(d.Cur.Hr, target.Hr, 2), Toward(d.Cur.Spo2, target.Spo2, 1), rr);
        }
        if (nibp || exact || d.Bp is null || t - d.Bp.At >= _nibpMs) d.Bp = new SimBp(target.Sys, target.Dia, t);
        // demo: a periodic sample shows the small beat-to-beat variation; an explicit update shows the set values exactly
        int hr = d.Cur.Hr;
        if (_demo && step)
        {
            d.Wave = (d.Wave + 1) % HrWave.Length;
            hr = Math.Max(20, Math.Min(250, d.Cur.Hr + HrWave[d.Wave]));
        }
        var e = VitalsUpdated.Create($"{d.Id}:v:{t}", d.Cad, t, d.Id, hr, d.Cur.Spo2, d.Bp.Sys, d.Bp.Dia, d.Bp.At, d.Cur.Rr, exact, t);
        d.LastVitals = e;
        return Emit(e);
    }

    private void Tick()
    {
        foreach (var d in _devices.Values.ToList())
            if (d.Cad is not null && d.Status == CorpulsStatuses.Connected && !d.Paused) Sample(d, step: true);
    }

    /// <summary>A 12-lead acquired on the simulated corpuls3 and transmitted. n: the case's next ECG number (for the sample).</summary>
    private CorpulsVerdict Acquire(Device d, string sample, int? n, string? lateCad)
    {
        var late = lateCad is not null && lateCad != d.Cad;
        if (!late && d.Status is not (CorpulsStatuses.Connected or CorpulsStatuses.Reconnecting or CorpulsStatuses.Waiting))
            return CorpulsVerdict.Refused("The simulated monitor is not connected: a 12-lead acquired now cannot be transmitted. Connect it first, or the crew uses the manual ECG fallback.");
        // acquired just before it is transmitted (the end of the 10-second recording); never before the case was linked
        // or before the monitor's previous 12-lead
        var t = _time.NowMs();
        var acq = Math.Min(t, Math.Max(t - 1000, Math.Max(d.LinkedAt + 500, d.LastAcq + 1000)));
        var seq = late ? d.Seq + 1 : ++d.Seq;
        if (!late)
        {
            d.LastAcq = acq;
            d.AutoEcg = false;
        }
        var image = MockEcgRenderer.SampleEcg(sample, n is > 0 ? n.Value : seq, acq, HrNow(d));
        var e = EcgAcquired.Create($"{d.Id}:ecg:{seq}:{acq}", late ? lateCad : d.Cad, t, seq, acq, d.Id, image.Rate,
            new EcgImagePayload(image.Mime, image.Data), new EcgMeta(image.Sample, image.Label, image.Variant, Simulated: true), t);
        // not connected yet, or the signal is lost: the monitor keeps the 12-lead and sends it once connected
        if (!late && d.Status != CorpulsStatuses.Connected)
        {
            d.Held.Add(e);
            OnSim();
            return new CorpulsVerdict(true, Held: true);
        }
        if (!late) d.Last = e;
        return Emit(e);
    }

    // ---------- the test console's simulator (TEST ONLY), and the crew's simulated acquisition in demo mode ----------

    /// <summary>
    /// Target: the device linked to the case; for a case that is closed or no longer linked, the device it was linked to,
    /// so "late" data from it can be tried (the platform must refuse it).
    /// </summary>
    public CorpulsVerdict Simulate(SimTarget target, string action, SimParams p)
    {
        var d = ByCad(target.Cad);
        var late = d is null;
        if (d is null)
        {
            if (string.IsNullOrEmpty(target.DeviceId)) return CorpulsVerdict.Refused("This case has no corpuls link.");
            d = Dev(target.DeviceId);
        }
        CorpulsVerdict Out(CorpulsVerdict? r = null)
        {
            Save(d);
            OnSim();
            return r ?? CorpulsVerdict.Accepted;
        }
        if (late && action is not ("trigger-ecg" or "send-vitals")) return CorpulsVerdict.Refused("This case is no longer linked to the simulated monitor.");
        switch (action)
        {
            case "connect":
                d.Available = true;
                d.Signal = true;
                if (d.Status != CorpulsStatuses.Connected)
                {
                    Stop(d);
                    Online(d, again: d.Last is not null || d.LastVitals is not null);
                }
                return Out();
            case "disconnect":
                d.Available = false;
                Stop(d);
                SetStatus(d, CorpulsStatuses.Disconnected, "monitor disconnected");
                return Out();
            case "reconnect":
                d.Available = true;
                d.Signal = true;
                Stop(d);
                if (d.Status == CorpulsStatuses.Connected) return Out(new CorpulsVerdict(true, Note: "Already connected."));
                SetStatus(d, CorpulsStatuses.Reconnecting, "reconnecting");
                Later(d, ReconnectMs, () => Online(d, again: true));
                return Out();
            case "signal-loss":
                if (d.Status != CorpulsStatuses.Connected) return Out(CorpulsVerdict.Refused("The simulated monitor is not connected."));
                d.Signal = false;
                Stop(d);
                SetStatus(d, CorpulsStatuses.Reconnecting, "signal lost");
                return Out();
            case "restore-signal":
                d.Signal = true;
                if (d.Available && d.Status == CorpulsStatuses.Reconnecting) Online(d, again: true);
                return Out();
            case "pause":
                d.Paused = true;
                return Out();
            case "resume":
                d.Paused = false;
                if (d.Status == CorpulsStatuses.Connected) Sample(d);
                return Out();
            case "set":
            {
                var next = new Dictionary<string, int> { ["hr"] = d.Target.Hr, ["spo2"] = d.Target.Spo2, ["sys"] = d.Target.Sys, ["dia"] = d.Target.Dia, ["rr"] = d.Target.Rr };
                foreach (var (key, name, low, high) in Limits)
                {
                    var typed = p.Values.GetValueOrDefault(key);
                    if (string.IsNullOrEmpty(typed)) continue;
                    var ok = double.TryParse(typed.Trim(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var number) && double.IsFinite(number);
                    var v = ok ? Math.Floor(number + 0.5) : double.NaN;
                    if (!ok || v < low || v > high) return CorpulsVerdict.Refused($"{name}: {low}–{high} in this simulator.");
                    next[key] = (int)v;
                }
                if (next["sys"] <= next["dia"]) return CorpulsVerdict.Refused("BP: the systolic value must be higher than the diastolic.");
                d.Target = new SimVitalsTarget(next["hr"], next["spo2"], next["sys"], next["dia"], next["rr"]);
                return Out();
            }
            case "send-vitals":
            {
                if (late)
                {
                    var now = _time.NowMs();
                    var e = VitalsUpdated.Create($"{d.Id}:v:{now}:late", target.Cad, now, d.Id, d.Target.Hr, d.Target.Spo2, d.Target.Sys, d.Target.Dia, now, d.Target.Rr, true, now);
                    return Out(Emit(e));
                }
                if (d.Status != CorpulsStatuses.Connected) return Out(CorpulsVerdict.Refused("The simulated monitor is not connected: nothing can be sent."));
                return Out(Sample(d, exact: true));
            }
            case "trigger-ecg":
            {
                var sample = p.Sample is "A" or "B" or "C" ? p.Sample : DemoSample(p.N is > 0 ? p.N.Value : d.Seq + 1);
                return Out(Acquire(d, sample, p.N, late ? target.Cad : null));
            }
            default:
                return CorpulsVerdict.Refused("Unknown simulator action.");
        }
    }

    /// <summary>
    /// RESET CORPULS DEMO (test console, TEST ONLY): every simulated monitor back to the clean demo state. A monitor
    /// linked to a case reconnects if needed (sending what it held) and sends the default values at once; a case still
    /// without an ECG gets its automatic ECG 1 again (demo mode). Cases, ECGs and the record are not touched.
    /// </summary>
    public int ResetDemo(Func<string, bool> hasEcg)
    {
        var n = 0;
        foreach (var d in _devices.Values.ToList())
        {
            n++;
            Stop(d);
            Fresh(d);
            if (d.Cad is null) continue;
            d.AutoEcg = _demo && d.Seq == 0 && !hasEcg(d.Cad);
            if (d.Status != CorpulsStatuses.Connected) Online(d, again: d.Last is not null || d.LastVitals is not null);
            if (d.Status == CorpulsStatuses.Connected)
            {
                Sample(d, exact: true);
                FirstEcgLater(d);
            }
        }
        OnSim();
        return n;
    }

    public IReadOnlyList<SimDeviceState> State() => _devices.Values.Select(d => new SimDeviceState(
        d.Id, d.Unit, d.Cad, Label(d), d.Status, d.StatusAt, d.Available, d.Paused, d.Signal, d.Target, d.Cur, d.Bp, d.Seq, d.Held.Count, d.AutoEcg)).ToList();

    /// <summary>All test data deleted: every simulated monitor starts afresh.</summary>
    public void Reset()
    {
        foreach (var d in _devices.Values) Stop(d);
        _devices.Clear();
        _saved = [];
        _store.Set(SettingsKey, "{}");
        OnSim();
    }

    public void Dispose()
    {
        _ticker.Dispose();
        foreach (var d in _devices.Values) Stop(d);
    }
}
