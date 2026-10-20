using System.Text.Json.Serialization;

namespace Masar.Application.Monitoring;

// The corpuls integration contract: CORPULS 3 → corpuls.mission → STEMI platform.
// A provider is the only code that knows how monitor data reaches the platform. Everything else (the platform, every
// screen) reads only the normalized events below. In this build the only working provider is the SIMULATED
// MockCorpulsProvider (PROTOTYPE ONLY); RealCorpulsMissionProvider is a placeholder until MEAD / corpuls supply the
// interface (docs/corpuls-integration.md). No vendor API detail is assumed anywhere.
// All times are Unix epoch milliseconds. EventId is stable: an event sent again (after a reconnection) carries the same
// id and the platform stores it once.

public static class CorpulsStatuses
{
    public const string Waiting = "waiting";
    public const string Connected = "connected";
    public const string Reconnecting = "reconnecting";
    public const string Disconnected = "disconnected";
    public static readonly IReadOnlyList<string> All = [Waiting, Connected, Reconnecting, Disconnected];
}

/// <summary>Where an ECG of a case came from.</summary>
public static class EcgSources
{
    public const string Corpuls = "corpuls";
    public const string ManualFallback = "manual_fallback";
    public const string Test = "test";
}

/// <summary>VITALS_UPDATED. Non-invasive BP is measured intermittently, so it keeps its own time. A missing value is null.</summary>
public sealed record VitalsUpdated(
    string? EventId, string? Cad, long Timestamp, string? DeviceId,
    int? HeartRate, int? Spo2, int? BpSystolic, int? BpDiastolic, long? BpMeasuredAt, int? RespiratoryRate,
    bool Explicit)
{
    public string Source => EcgSources.Corpuls;

    /// <summary>The builder every provider uses: whatever it received, what it emits has these ranges.</summary>
    public static VitalsUpdated Create(string? eventId, string? cad, long? timestamp, string? deviceId, double? heartRate, double? spo2,
        double? bpSystolic, double? bpDiastolic, long? bpMeasuredAt, double? respiratoryRate, bool isExplicit, long now) =>
        new(Contract.Str(eventId, 120), Contract.Str(cad, 40), Contract.Time(timestamp) ?? now, Contract.Str(deviceId, 80),
            Contract.Int(heartRate, 0, 350), Contract.Int(spo2, 0, 100), Contract.Int(bpSystolic, 0, 350), Contract.Int(bpDiastolic, 0, 300),
            Contract.Time(bpMeasuredAt), Contract.Int(respiratoryRate, 0, 120), isExplicit);
}

/// <summary>
/// ECG_ACQUIRED. EcgSequence is the monitor's own count of 12-leads for the mission; the platform numbers the case's ECGs
/// itself (ECG 1, 2, 3 … across every source). Meta: provider details stored but never shown as clinical data.
/// </summary>
public sealed record EcgAcquired(
    string? EventId, string? Cad, long Timestamp, int? EcgSequence, long? AcquiredAt, string? DeviceId, int? HeartRate,
    EcgImagePayload? Image, EcgMeta Meta)
{
    public string Source => EcgSources.Corpuls;

    public static EcgAcquired Create(string? eventId, string? cad, long? timestamp, int? ecgSequence, long? acquiredAt, string? deviceId,
        int? heartRate, EcgImagePayload? image, EcgMeta? meta, long now) =>
        new(Contract.Str(eventId, 120), Contract.Str(cad, 40), Contract.Time(timestamp) ?? now, Contract.Int(ecgSequence, 1, 999),
            Contract.Time(acquiredAt), Contract.Str(deviceId, 80), Contract.Int(heartRate, 20, 300), image, meta ?? new EcgMeta(null, null, null, false));
}

public sealed record EcgImagePayload(string Mime, byte[] Data);

public sealed record EcgMeta(string? Sample, string? Label, string? Variant, bool Simulated);

/// <summary>CORPULS_CONNECTION_CHANGED: waiting | connected | reconnecting | disconnected.</summary>
public sealed record ConnectionChanged(string? EventId, string? Cad, long Timestamp, string Status, string? DeviceId, string? Reason)
{
    public static ConnectionChanged Create(string? eventId, string? cad, long? timestamp, string? status, string? deviceId, string? reason, long now) =>
        new(Contract.Str(eventId, 120), Contract.Str(cad, 40), Contract.Time(timestamp) ?? now,
            status is not null && CorpulsStatuses.All.Contains(status) ? status : CorpulsStatuses.Disconnected, Contract.Str(deviceId, 80), Contract.Str(reason, 120));
}

/// <summary>The platform's verdict on an event. A provider may log it, never act on it.</summary>
public sealed record CorpulsVerdict(
    bool Ok,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Error = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] bool Dup = false,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? N = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] bool Closed = false,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] bool Held = false,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Note = null)
{
    public static readonly CorpulsVerdict Accepted = new(true);
    public static CorpulsVerdict Refused(string error, bool closed = false) => new(false, error, Closed: closed);
}

/// <summary>What linking a case to a monitor returns: the device, its label and the initial status (not emitted).</summary>
public sealed record CorpulsLink(string? DeviceId, string Label, string Status, string? PreviousCad);

/// <summary>
/// A request to link a case. AutoEcg (simulated demo mode only, ignored by a real provider): the platform's hint that the
/// case has no ECG yet, so the simulated crew acquires ECG 1 by itself once the monitor is connected.
/// </summary>
public sealed record CorpulsLinkRequest(string Cad, string? Unit, string? DeviceId, bool AutoEcg);

/// <summary>After a platform restart: a feed that was linked, so the provider carries on silently.</summary>
public sealed record CorpulsResumeLink(string Cad, string? Unit, string DeviceId, string? Status, CaseVitals? Vitals, int CorpulsEcgs, int TotalEcgs);

public sealed record CorpulsConnectionState(string Status, long At, string DeviceId);

/// <summary>The platform side of the feed (MonitorService): every provider event is handed here.</summary>
public interface ICorpulsEventSink
{
    CorpulsVerdict OnConnectionChanged(ConnectionChanged e);
    CorpulsVerdict OnVitalsUpdated(VitalsUpdated e);
    CorpulsVerdict OnEcgAcquired(EcgAcquired e);
}

/// <summary>
/// A corpuls provider. Replaceable: the platform only uses this interface, so a production provider for corpuls.mission
/// can replace the simulated one without changing any screen or platform rule (selected by Corpuls:Provider).
/// </summary>
public interface ICorpulsProvider
{
    /// <summary>mock | corpuls-mission.</summary>
    string Name { get; }
    bool Simulated { get; }
    /// <summary>The simulated demonstration mode (always false for a real provider).</summary>
    bool DemoMode { get; }
    /// <summary>How often vital signs normally arrive. Drives only the technical freshness indicator, never a clinical rule.</summary>
    int ExpectedIntervalMs { get; }
    void Attach(ICorpulsEventSink sink);
    CorpulsLink ConnectCase(CorpulsLinkRequest request);
    void RelinkCase(string oldCad, string newCad);
    void DisconnectCase(string cad, string reason);
    CorpulsConnectionState? GetConnectionStatus(string cad);
    VitalsUpdated? GetLatestVitals(string cad);
    void Resume(IReadOnlyList<CorpulsResumeLink> links);
}

/// <summary>
/// TEST ONLY: what the test console's CORPULS SIMULATOR (and the crew's simulated acquisition in demo mode) can make the
/// simulated monitor do. Only the simulated provider implements it; it must never exist in a production provider.
/// </summary>
public interface ICorpulsSimulator
{
    /// <summary>Raised when a simulated monitor changed (the test console follows it live).</summary>
    event Action? Changed;
    TimeSpan DemoEcgDelay { get; }
    SimDefaults Defaults { get; }
    CorpulsVerdict Simulate(SimTarget target, string action, SimParams parameters);
    /// <summary>RESET CORPULS DEMO: every simulated monitor back to the clean demo state. hasEcg(cad): the case already has an ECG.</summary>
    int ResetDemo(Func<string, bool> hasEcg);
    IReadOnlyList<SimDeviceState> State();
    /// <summary>All test data deleted: every simulated monitor starts afresh.</summary>
    void Reset();
}

/// <summary>The monitor of a case; for a closed or unlinked case the device it was linked to, so late data can be tried.</summary>
public sealed record SimTarget(string Cad, string? DeviceId);

/// <summary>Sample: A | B | C. N: the case's next ECG number. Values: hr, spo2, sys, dia, rr as typed (null: not given).</summary>
public sealed record SimParams(string? Sample, int? N, IReadOnlyDictionary<string, string?> Values);

public sealed record SimDefaults(int Hr, int Spo2, int Sys, int Dia, int Rr);

public sealed record SimVitalsTarget(int Hr, int Spo2, int Sys, int Dia, int Rr);
public sealed record SimCurrent(int Hr, int Spo2, int Rr);
public sealed record SimBp(int Sys, int Dia, long At);

public sealed record SimDeviceState(string Id, string? Unit, string? Cad, string Label, string Status, long StatusAt, bool Available, bool Paused,
    bool Signal, SimVitalsTarget Target, SimCurrent? Cur, SimBp? Bp, int Seq, int Held, bool AutoEcg);

/// <summary>The latest monitor values kept on the case (cases.vitals_json).</summary>
public sealed record CaseVitals(int? Hr, int? Spo2, int? Rr, int? Sys, int? Dia, long? BpAt, long At);

internal static class Contract
{
    public static int? Int(double? v, int lo, int hi)
    {
        if (v is null || double.IsNaN(v.Value) || double.IsInfinity(v.Value)) return null;
        var n = Math.Floor(v.Value + 0.5); // JavaScript Math.round, as the simulator and the screens round
        return n < lo || n > hi ? null : (int)n;
    }
    public static int? Int(int? v, int lo, int hi) => v is null || v < lo || v > hi ? null : v;
    public static long? Time(long? v) => v is > 0 ? v : null;
    public static string? Str(string? v, int max) => v is null ? null : v.Length > max ? v[..max] : v;
}
