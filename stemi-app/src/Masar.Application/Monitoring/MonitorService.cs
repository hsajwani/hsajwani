using System.Text.Json;
using System.Text.Json.Serialization;
using Masar.Application.Abstractions;
using Masar.Application.Ai;
using Masar.Application.Cases;
using Masar.Application.Common;
using Masar.Domain.Entities;
using Masar.Domain.Pathway;
using Masar.Domain.Rules;
using Microsoft.EntityFrameworkCore;

namespace Masar.Application.Monitoring;

/// <summary>
/// The corpuls feed on the platform's side. It links a case (CAD number) to the unit's monitor through the corpuls
/// provider (<see cref="ICorpulsProvider"/>) and turns the provider's normalized events into the case record.
/// <list type="bullet">
/// <item>Every event is checked first: the CAD number must exist, the case must be open, and the event's monitor must be
/// the one linked to that case. Anything else is refused and changes nothing (a closed case stays read-only).</item>
/// <item>Each ECG is stored once (the provider's event id), numbered by the platform (ECG 1, 2, 3 … across every
/// source), analysed by the AI like any ECG, and reaches the screens silently.</item>
/// <item>The latest vital signs live on the case; a light history keeps each blood pressure measurement and about one
/// sample a minute. Routine samples never go into the audit trail (it would bury the clinical events); the significant
/// moments do: linked, connected, ECG received, connection lost / restored, feed ended, manual fallback.</item>
/// <item>A lost connection never closes, cancels or decides anything: the pathway carries on and the crew has the manual
/// fallback.</item>
/// </list>
/// </summary>
public sealed class MonitorService : ICorpulsEventSink
{
    /// <summary>About one routine vital-signs sample a minute is kept in the history (each NIBP measurement always is).</summary>
    public const long HistoryEveryMs = 60_000;

    private readonly PlatformGate _gate;
    private readonly ICorpulsProvider _provider;
    private readonly MonitorRecordReader _reader;
    private readonly EcgImageService _images;
    private readonly AiAnalysisService _ai;
    private readonly ILiveNotifier _live;
    private readonly TimeProvider _time;

    public MonitorService(PlatformGate gate, ICorpulsProvider provider, MonitorRecordReader reader, EcgImageService images, AiAnalysisService ai,
        ILiveNotifier live, TimeProvider time)
    {
        _gate = gate;
        _provider = provider;
        _reader = reader;
        _images = images;
        _ai = ai;
        _live = live;
        _time = time;
        provider.Attach(this);
        if (provider is ICorpulsSimulator simulator) simulator.Changed += live.SimulatorChanged;
    }

    private ICorpulsSimulator? Simulator => _provider as ICorpulsSimulator;
    private string FeedName => _provider.Simulated ? "corpuls feed (simulated)" : "corpuls feed";
    public const string NotSimulatedError = "The corpuls simulator works only with the simulated provider (Corpuls:Provider = mock).";

    private static Case? Row(IMasarDbContext db, string? cad) => string.IsNullOrEmpty(cad) ? null : db.Cases.FirstOrDefault(c => c.Cad == cad);
    private static void Event(IMasarDbContext db, string cad, long at, string kind, string text) =>
        db.Insert(new MonitorEvent { Cad = cad, At = at, Kind = kind, Text = text });

    // ---------- linking a case to the unit's monitor ----------

    /// <summary>
    /// Links the case to the unit's monitor. Who links: the crew, or the test console for a demo case. autoEcg false: the
    /// case already has (or is about to get) an ECG another way, so the simulated demo's automatic ECG 1 is not wanted.
    /// Status: linked | missing | closed.
    /// </summary>
    public LinkResult Link(IMasarDbContext db, Actor actor, string? raw, string? deviceId = null, bool autoEcg = true)
    {
        var cad = CadNumber.Normalize(raw);
        var c = Row(db, cad);
        if (c is null || (actor.Role == ActorRoles.Crew && c.Unit != actor.Unit)) return new LinkResult("missing", cad);
        if (c.ClosedAt is not null) return new LinkResult("closed", cad);
        if (c.CorpulsLinkedAt is not null && c.CorpulsLinkEndedAt is null) return new LinkResult("linked", cad) { Already = true };
        var link = _provider.ConnectCase(new CorpulsLinkRequest(cad, c.Unit, deviceId, autoEcg && (CaseFactsLoader.Load(db, cad)?.EcgCount ?? 0) == 0));
        var t = _time.NowMs();
        var who = actor.Role == ActorRoles.Crew ? actor.CrewTitle : "Test console";
        var w = new AuditWriter(db, cad, actor);
        var others = link.DeviceId is null ? [] : db.Cases
            .Where(x => x.CorpulsDeviceId == link.DeviceId && x.Cad != cad && x.CorpulsLinkedAt != null && x.CorpulsLinkEndedAt == null)
            .Select(x => x.Cad).ToList();
        db.InTransaction(() =>
        {
            db.Cases.Where(x => x.Cad == cad).ExecuteUpdate(s => s
                .SetProperty(x => x.CorpulsProvider, _provider.Name)
                .SetProperty(x => x.CorpulsDeviceId, link.DeviceId)
                .SetProperty(x => x.CorpulsDeviceLabel, link.Label)
                .SetProperty(x => x.CorpulsLinkedAt, t)
                .SetProperty(x => x.CorpulsLinkedBy, who)
                .SetProperty(x => x.CorpulsStatus, link.Status)
                .SetProperty(x => x.CorpulsStatusAt, t)
                .SetProperty(x => x.CorpulsLinkEndedAt, (long?)null)
                .SetProperty(x => x.CorpulsLinkEndReason, (string?)null));
            w.By(t, $"Corpuls feed linked to CAD #{cad} · {link.Label} · monitor data from now on attaches to this CAD number", who, "key");
            Event(db, cad, t, "linked", $"Corpuls feed linked · {link.Label}");
            w.Flush();
        });
        // one monitor serves one patient: a case still linked to it keeps what it received, and its feed ends
        foreach (var other in others) EndLink(db, other, $"the monitor was linked to CAD #{cad}", providerDone: true);
        _live.CaseChanged(cad);
        return new LinkResult("linked", cad);
    }

    /// <summary>The feed of a case ends (pathway closed, unsent case discarded, monitor moved). The last values stay with the case.</summary>
    public void EndLink(IMasarDbContext db, string cad, string why, bool providerDone = false)
    {
        var c = Row(db, cad);
        if (c is null || c.CorpulsLinkedAt is null || c.CorpulsLinkEndedAt is not null) return;
        if (!providerDone) _provider.DisconnectCase(cad, why);
        var t = _time.NowMs();
        var w = new AuditWriter(db, cad, Actor.SystemActor);
        db.InTransaction(() =>
        {
            db.Cases.Where(x => x.Cad == cad).ExecuteUpdate(s => s.SetProperty(x => x.CorpulsLinkEndedAt, t).SetProperty(x => x.CorpulsLinkEndReason, why));
            w.Sys(t, $"Corpuls feed unlinked from CAD #{cad} ({why}) · the last values received are kept", "key", FeedName);
            Event(db, cad, t, "ended", $"Corpuls feed ended ({why})");
            w.Flush();
        });
        _live.CaseChanged(cad);
    }

    /// <summary>After any change: the feed of a closed case ends.</summary>
    public void CloseIfNeeded(IMasarDbContext db, string cad)
    {
        var c = Row(db, cad);
        if (c is { ClosedAt: not null, CorpulsLinkedAt: not null, CorpulsLinkEndedAt: null }) EndLink(db, cad, "STEMI pathway closed");
    }

    /// <summary>The CAD number of an unsent case was corrected: the feed follows the case.</summary>
    public void Relink(string oldCad, string newCad) => _provider.RelinkCase(oldCad, newCad);

    // ---------- the provider's events ----------

    private CorpulsVerdict Check(IMasarDbContext db, string? eventCad, string? deviceId, out Case? c)
    {
        var cad = CadNumber.Normalize(eventCad);
        c = Row(db, cad);
        if (c is null) return CorpulsVerdict.Refused($"No case with CAD #{eventCad.Or("?")}: the monitor data was not added.");
        if (c.ClosedAt is not null) return CorpulsVerdict.Refused($"CAD #{cad} is closed and read-only: the monitor data was not added.", closed: true);
        if (c.CorpulsLinkedAt is null || c.CorpulsLinkEndedAt is not null || string.IsNullOrEmpty(deviceId) || c.CorpulsDeviceId != deviceId)
            return CorpulsVerdict.Refused($"Monitor {deviceId.Or("?")} is not linked to CAD #{cad}: its data was not added.");
        return CorpulsVerdict.Accepted;
    }

    public CorpulsVerdict OnConnectionChanged(ConnectionChanged e) => _gate.Run(db =>
    {
        var verdict = Check(db, e.Cad, e.DeviceId, out var c);
        if (!verdict.Ok) return verdict;
        var previous = c!.CorpulsStatus;
        var t = e.Timestamp;
        if (previous == e.Status) return new CorpulsVerdict(true, Dup: true);
        var w = new AuditWriter(db, c.Cad, Actor.SystemActor);
        db.InTransaction(() =>
        {
            db.Cases.Where(x => x.Cad == c.Cad).ExecuteUpdate(s => s.SetProperty(x => x.CorpulsStatus, e.Status).SetProperty(x => x.CorpulsStatusAt, t));
            if (e.Status == CorpulsStatuses.Connected && c.CorpulsConnectedOnce != true)
            {
                db.Cases.Where(x => x.Cad == c.Cad).ExecuteUpdate(s => s.SetProperty(x => x.CorpulsConnectedOnce, true));
                w.Sys(t, $"Corpuls monitor connected ({c.CorpulsDeviceLabel.Or(e.DeviceId ?? string.Empty)}) · live vital signs started", "key", FeedName);
                Event(db, c.Cad, t, "connected", "Corpuls monitor connected · live data started");
            }
            else if (e.Status == CorpulsStatuses.Connected && previous is CorpulsStatuses.Reconnecting or CorpulsStatuses.Disconnected)
            {
                w.Sys(t, "Corpuls connection restored", "key", FeedName);
                Event(db, c.Cad, t, "restored", "Corpuls connection restored");
            }
            else if (previous == CorpulsStatuses.Connected && e.Status is CorpulsStatuses.Reconnecting or CorpulsStatuses.Disconnected)
            {
                // one event per outage, whatever the feed does while it lasts
                var how = e.Status == CorpulsStatuses.Reconnecting ? "signal lost, reconnecting" : "monitor disconnected";
                w.Sys(t, $"Corpuls connection lost ({how}) · last data received {(c.CorpulsLastDataAt is { } last ? TimeText.Hms(last) : "–")}", "key", FeedName);
                Event(db, c.Cad, t, "lost", $"Corpuls connection lost ({how})");
            }
            w.Flush();
        });
        _live.CaseChanged(c.Cad);
        return CorpulsVerdict.Accepted;
    });

    public CorpulsVerdict OnVitalsUpdated(VitalsUpdated e) => _gate.Run(db =>
    {
        var verdict = Check(db, e.Cad, e.DeviceId, out var c);
        if (!verdict.Ok) return verdict;
        var rcv = _time.NowMs();
        // a resent or older sample changes nothing
        if (c!.VitalsAt is { } latest && e.Timestamp <= latest) return new CorpulsVerdict(true, Dup: true);
        var previous = JsonData.Parse(c.VitalsJson);
        var values = new CaseVitals(e.HeartRate, e.Spo2, e.RespiratoryRate, e.BpSystolic, e.BpDiastolic, e.BpMeasuredAt, e.Timestamp);
        var newBp = values.BpAt is not null && values.BpAt != JsonData.NodeLong(previous?["bpAt"]);
        var history = newBp || e.Explicit || c.VitalsHistAt is null || e.Timestamp - c.VitalsHistAt >= HistoryEveryMs || (c.CorpulsStatusAt ?? 0) > (c.VitalsHistAt ?? 0);
        var json = JsonDefaults.Serialize(values);
        db.InTransaction(() =>
        {
            db.Cases.Where(x => x.Cad == c.Cad).ExecuteUpdate(s =>
            {
                s.SetProperty(x => x.VitalsJson, json).SetProperty(x => x.VitalsAt, e.Timestamp).SetProperty(x => x.VitalsSource, EcgSources.Corpuls)
                    .SetProperty(x => x.CorpulsLastDataAt, e.Timestamp);
                if (history) s.SetProperty(x => x.VitalsHistAt, e.Timestamp);
            });
            if (history)
                db.Insert(new MonitorVital
                {
                    Cad = c.Cad, At = e.Timestamp, ReceivedAt = rcv, DeviceId = e.DeviceId, Source = EcgSources.Corpuls, Hr = values.Hr, Spo2 = values.Spo2,
                    BpSys = values.Sys, BpDia = values.Dia, BpAt = values.BpAt, Rr = values.Rr, EventId = e.EventId, Why = newBp ? "nibp" : e.Explicit ? "update" : "sample",
                });
        });
        PushMonitor(db, c.Cad);
        return CorpulsVerdict.Accepted;
    });

    public CorpulsVerdict OnEcgAcquired(EcgAcquired e) => _gate.Run(db =>
    {
        var verdict = Check(db, e.Cad, e.DeviceId, out var c);
        if (!verdict.Ok) return verdict;
        if (e.Image is null || e.Image.Data.Length == 0) return CorpulsVerdict.Refused("The ECG arrived without its image: nothing was added.");
        if (e.EventId is not null && db.Ecgs.FirstOrDefault(x => x.Cad == c!.Cad && x.SourceEventId == e.EventId) is { } existing)
            return new CorpulsVerdict(true, Dup: true, N: existing.N);
        var f = CaseFactsLoader.Load(db, c!.Cad)!;
        var n = f.EcgCount + 1;
        var rcv = _time.NowMs();
        var acq = e.AcquiredAt is { } a && a <= rcv + 60_000 ? a : rcv;
        var feed = FeedName;
        var w = new AuditWriter(db, c.Cad, Actor.SystemActor);
        var image = _images.Store(db, c.Cad, e.Image.Mime, e.Image.Data, feed, EcgSources.Corpuls);
        db.InTransaction(() =>
        {
            db.Insert(new Ecg
            {
                Cad = c.Cad, N = n, AcquiredAt = acq, SentAt = e.Timestamp, ReceivedAt = rcv, PrimaryImage = 1,
                Variant = e.Meta.Variant is { Length: > 0 } v ? v[..Math.Min(20, v.Length)] : null, SameAsPrevious = false, SentBy = feed,
                Source = EcgSources.Corpuls, DeviceId = e.DeviceId, SourceEventId = e.EventId, SourceSeq = e.EcgSequence, TransmittedAt = e.Timestamp,
                DeviceHr = e.HeartRate,
            });
            var sent = c.ServerReceivedAt is not null;
            db.EcgImages.Where(x => x.Id == image.Id).ExecuteUpdate(s => s
                .SetProperty(x => x.EcgN, n).SetProperty(x => x.I, 1).SetProperty(x => x.CapturedAt, acq).SetProperty(x => x.Kind, "full")
                .SetProperty(x => x.Quality, "good").SetProperty(x => x.ReceivedAt, rcv).SetProperty(x => x.AddedAfterSend, sent));
            w.Sys(rcv, $"ECG {n} received from corpuls · acquired {TimeText.Hms(acq)} · {c.CorpulsDeviceLabel.Or(e.DeviceId ?? string.Empty)}", "key", feed);
            Event(db, c.Cad, rcv, "ecg", $"ECG {n} received from corpuls");
            if (f.State == PathwayStates.RepeatRequested) w.Sys(rcv, $"Repeat ECG received from corpuls as requested by the Cardiologist: ECG {n}", "key", feed);
            if (sent)
            {
                w.Sys(rcv, $"ECG {n} reached {(f.Activated is not null ? "the ER and the Cardiologist screens" : "the ER screen")} silently (no alarm)", "key");
                w.Update(rcv, "ecg", $"ECG {n} received", new { n });
            }
            w.Flush();
        });
        _ai.Schedule(c.Cad, n);
        _live.CaseChanged(c.Cad);
        return new CorpulsVerdict(true, N: n);
    });

    // ---------- the small live update, and SEND ----------

    public void PushMonitor(IMasarDbContext db, string cad)
    {
        var c = Row(db, cad);
        if (c is null) return;
        _live.MonitorChanged(cad, _reader.Read(db, c)!, _time.NowMs());
    }

    /// <summary>SEND: the latest monitor values travel with the case (the crew does not confirm them).</summary>
    public void AtSend(IMasarDbContext db, Case c, long t, AuditWriter w)
    {
        var v = JsonData.Parse(c.VitalsJson) is { } node ? node.Deserialize<CaseVitals>(JsonDefaults.Options) : null;
        if (v is null)
        {
            w.Sys(t, "No monitor values had been received from corpuls when the case was sent", "key", FeedName);
            return;
        }
        db.Insert(new MonitorVital
        {
            Cad = c.Cad, At = v.At, ReceivedAt = t, DeviceId = c.CorpulsDeviceId, Source = EcgSources.Corpuls, Hr = v.Hr, Spo2 = v.Spo2, BpSys = v.Sys,
            BpDia = v.Dia, BpAt = v.BpAt, Rr = v.Rr, EventId = null, Why = "at_send",
        });
        w.Sys(t, $"Latest monitor values sent with the case: {VitalsText(v)} · from corpuls, {TimeText.Hms(v.At)}", "key", FeedName);
    }

    public static string VitalsText(CaseVitals v)
    {
        var parts = new List<string>();
        if (v.Hr is not null) parts.Add($"HR {v.Hr} bpm");
        if (v.Spo2 is not null) parts.Add($"SpO₂ {v.Spo2} %");
        if (v.Sys is not null) parts.Add($"BP {v.Sys}/{v.Dia?.ToString() ?? "null"} mmHg{(v.BpAt is { } bpAt && bpAt != 0 ? $" (measured {TimeText.Hms(bpAt)})" : string.Empty)}");
        if (v.Rr is not null) parts.Add($"RR {v.Rr}/min");
        return parts.Count == 0 ? "none" : string.Join(" · ", parts);
    }

    /// <summary>The crew used the manual ECG fallback (audited by the crew action; recorded here for the feed's timeline).</summary>
    public static void FallbackUsed(IMasarDbContext db, string cad, long t, int n) => Event(db, cad, t, "fallback", $"Manual ECG fallback used: ECG {n}");

    // ---------- after a restart, the crew's simulated acquisition, and the test console ----------

    /// <summary>After a platform restart: the feeds that were linked carry on silently.</summary>
    public void Resume(IMasarDbContext db)
    {
        var links = db.Cases
            .Where(c => c.CorpulsLinkedAt != null && c.CorpulsLinkEndedAt == null && c.ClosedAt == null && c.CorpulsDeviceId != null)
            .Select(c => new
            {
                c.Cad, c.Unit, c.CorpulsDeviceId, c.CorpulsStatus, c.VitalsJson,
                Corpuls = db.Ecgs.Count(e => e.Cad == c.Cad && e.Source == EcgSources.Corpuls),
                Total = db.Ecgs.Count(e => e.Cad == c.Cad),
            }).ToList()
            .Select(r => new CorpulsResumeLink(r.Cad, r.Unit, r.CorpulsDeviceId!, r.CorpulsStatus,
                JsonData.Parse(r.VitalsJson)?.Deserialize<CaseVitals>(JsonDefaults.Options), r.Corpuls, r.Total)).ToList();
        _provider.Resume(links);
    }

    /// <summary>TEST ONLY: the test console's simulator acts on the monitor of one case.</summary>
    public CorpulsVerdict Simulate(IMasarDbContext db, string? raw, string action, SimParams parameters)
    {
        if (Simulator is not { } simulator) return CorpulsVerdict.Refused(NotSimulatedError);
        var cad = CadNumber.Normalize(raw);
        var c = Row(db, cad);
        if (c is null) return CorpulsVerdict.Refused("There is no case with this CAD number.");
        if (string.IsNullOrEmpty(c.CorpulsDeviceId)) return CorpulsVerdict.Refused($"CAD #{cad} has no corpuls link.");
        var next = (CaseFactsLoader.Load(db, cad)?.EcgCount ?? 0) + 1;
        return simulator.Simulate(new SimTarget(cad, c.CorpulsDeviceId), action, parameters with { N = next });
    }

    /// <summary>
    /// Demo mode only (PROTOTYPE ONLY): the crew acquires the requested repeat 12-lead on the simulated corpuls3 from the
    /// crew screen, because no physical monitor is connected. The ECG then arrives from the simulated feed like any
    /// corpuls ECG (never an upload). Status: ok | off | missing | closed | unlinked | refused.
    /// </summary>
    public DemoAcquireResult DemoAcquire(IMasarDbContext db, Actor actor, string? raw)
    {
        if (!_provider.DemoMode || Simulator is not { } simulator) return new DemoAcquireResult("off", null) { Error = "The simulated corpuls demo is not on in this build." };
        var cad = CadNumber.Normalize(raw);
        var c = Row(db, cad);
        if (c is null || c.Unit != actor.Unit) return new DemoAcquireResult("missing", cad) { Error = "There is no case with this CAD number for this tablet." };
        if (c.ClosedAt is not null) return new DemoAcquireResult("closed", cad) { Error = "This STEMI pathway is closed: it is read-only." };
        if (c.CorpulsLinkedAt is null || c.CorpulsLinkEndedAt is not null || string.IsNullOrEmpty(c.CorpulsDeviceId))
            return new DemoAcquireResult("unlinked", cad) { Error = "This case is not linked to the simulated corpuls monitor." };
        var n = (CaseFactsLoader.Load(db, cad)?.EcgCount ?? 0) + 1;
        var w = new AuditWriter(db, cad, actor);
        w.By(_time.NowMs(), $"Prototype demo: {(n > 1 ? "repeat " : string.Empty)}12-lead acquisition on the simulated corpuls3 started from the crew screen (stands in for ECG {n} acquired on the monitor)", actor.CrewTitle, "evt");
        w.Flush();
        var r = simulator.Simulate(new SimTarget(cad, c.CorpulsDeviceId), "trigger-ecg", new SimParams(null, n, new Dictionary<string, string?>()));
        if (!r.Ok)
        {
            var why = r.Error.Or("The simulated monitor did not send the ECG.");
            w.By(_time.NowMs(), $"Prototype demo: the simulated corpuls3 did not transmit ECG {n} ({why})", actor.CrewTitle, "evt");
            w.Flush();
            return new DemoAcquireResult("refused", cad) { Error = why };
        }
        return new DemoAcquireResult("ok", cad) { N = r.N ?? n, Held = r.Held };
    }

    /// <summary>RESET CORPULS DEMO (test console, TEST ONLY): every simulated monitor back to the clean demo state.</summary>
    public ResetDemoResult ResetDemo(IMasarDbContext db)
    {
        if (Simulator is not { } simulator) return new ResetDemoResult(false) { Error = NotSimulatedError };
        var n = simulator.ResetDemo(cad => (CaseFactsLoader.Load(db, cad)?.EcgCount ?? 0) > 0);
        return new ResetDemoResult(true) { Monitors = n };
    }

    /// <summary>What the test console's CORPULS SIMULATOR shows.</summary>
    public SimulatorInfo SimInfo(IMasarDbContext db)
    {
        var cases = db.Cases.Where(c => c.CorpulsLinkedAt != null).OrderByDescending(c => c.CorpulsLinkedAt).Take(30)
            .Select(c => new SimulatedCase(c.Cad, c.Unit, c.CorpulsDeviceId, c.CorpulsDeviceLabel, c.CorpulsStatus, c.CorpulsLastDataAt, c.CorpulsLinkEndedAt,
                c.ClosedAt, c.ServerReceivedAt, c.CorpulsLinkedAt)).ToList();
        var simulator = Simulator;
        var demoMs = simulator is null ? (long?)null : (long)simulator.DemoEcgDelay.TotalMilliseconds;
        return new SimulatorInfo(_provider.Name, _provider.Simulated, _provider.DemoMode, demoMs is > 0 ? demoMs : null, _provider.ExpectedIntervalMs,
            simulator?.Defaults, simulator?.State() ?? [], cases);
    }

    /// <summary>All test data deleted: every simulated monitor starts afresh.</summary>
    public void Reset() => Simulator?.Reset();

    public ProviderInfo Info() => new(_provider.Name, _provider.Simulated, _provider.DemoMode, _provider.ExpectedIntervalMs);
}

public sealed record LinkResult(string Status, string Cad)
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] public bool Already { get; init; }
}

public sealed record DemoAcquireResult(string Status, string? Cad)
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public int? N { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? Held { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Error { get; init; }
}

public sealed record ResetDemoResult(bool Ok)
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public int? Monitors { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Error { get; init; }
}

/// <summary>The corpuls provider in use (shown in the test console and GET /api/info).</summary>
public sealed record ProviderInfo(string Name, bool Simulated, bool Demo, int Every);

public sealed record SimulatedCase(string Cad, string Unit, string? Device, string? Label, string? Status, long? Last, long? Ended, long? Closed, long? Sent, long? Linked);

/// <summary>TEST ONLY: the simulated monitors and the linked cases, for the test console.</summary>
public sealed record SimulatorInfo(string Provider, bool Simulated, bool Demo, long? DemoEcgMs, int Every, SimDefaults? Defaults,
    IReadOnlyList<SimDeviceState> Devices, List<SimulatedCase> Cases);
