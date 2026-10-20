using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Masar.Application.Monitoring;

namespace Masar.Application.Cases;

// The shared case record: one record per CAD number, the same on every screen (GET /api/cases/view, the live "case"
// event). The browser code reads these exact (camelCase) names; docs/api.md documents every field. Times are Unix epoch
// milliseconds; null means "not (yet) happened".

public sealed record CaseRecord(
    string Cad,
    string Unit,
    string Emirate,
    string Crew,
    string State,
    bool Legacy,
    bool Active,
    long Created,
    CadEntryInfo CadEntry,
    PathwayOpening Path,
    SubmissionInfo? Sub,
    ErReview Er,
    CardiologyInfo Cardio,
    /// <summary>The crew's minimum data per field (age, sex, complaint, onset; bp, hr, spo2, rr only as manual fallback): every entry, oldest first.</summary>
    Dictionary<string, List<MinimumDataValue>> Pt,
    /// <summary>Treatment updates per item.</summary>
    Dictionary<string, TreatmentItem> Rec,
    List<EcgRecord> Ecgs,
    List<DecisionRecord> Dec,
    List<UpdateRecord> Upd,
    List<AuditLine> Audit,
    /// <summary>First view of each ECG image per role: views[role]["n|i"] = time.</summary>
    Dictionary<string, Dictionary<string, long>> Views,
    long? Hopen,
    long? Discarded,
    ClosureInfo? Closed,
    MonitorRecord? Monitor);

/// <summary>How the CAD number was entered: manual-crew | manual-test-console | simulated-feed (v0.1 cases).</summary>
public sealed record CadEntryInfo(string Src, long? At, string? By);

public sealed record PathwayOpening(long At, string By);

/// <summary>SEND: the tablet's send time, the server's receive time, delivered after a failed first attempt.</summary>
public sealed record SubmissionInfo(long? Send, long Rcv, bool Late);

public sealed record ErReview(
    long? Alerted, long? Shown, string? Name, long? Accepted, string? Assessment, long? At, string? By, int? On,
    string? Reason, string? Comment, long? CrewAck);

public sealed record CardiologyInfo(
    long? Activated, string? By, string? Reason, long? Alerted, long? Shown, long? Ack, string? Name, long? Opened,
    string? Decision, long? DecisionAt);

/// <summary>One minimum-data entry. Kind: sent | update | correct | clarify | fallback.</summary>
public sealed record MinimumDataValue(string Id, string? V, JsonNode? Raw, long? T, long Rcv, string? By, string Kind, string Why);

public sealed record TreatmentItem(string Label, string? Group, List<TreatmentVersion> Vers);

public sealed record TreatmentVersion(string Id, string? V, bool Nv, long? T, long Rcv, string? By, string Kind);

/// <summary>
/// ECG n. Src: corpuls | manual_fallback | test | null (crew photos of 0.5.0 and earlier). Ai: the AI analysis
/// ({ st, start } while processing; then also done and the result fields), or null before it starts.
/// </summary>
public sealed record EcgRecord(
    int N, long? Acq, string? Variant, int Pri, bool Same, long? Sent, long? Rcv, string? By, string Why,
    List<EcgImageRecord> Imgs, JsonObject? Ai, string? Src, string? Dev, int? Seq, long? Tx);

public sealed record EcgImageRecord(int? I, string? Kind, string? Q, long? At, long? Rcv, bool After, string Src, string Url);

public sealed record DecisionRecord(
    string Id, string K, long At, long Rcv, string By, string? ByT, int? On, JsonNode Also, string Reason, string Note,
    string Adv, JsonNode Reasons, string Instr, int? Within, string? Ai, long? Dlv, long? CrewAck);

/// <summary>An entry of the screens' silent "NEW" list.</summary>
public sealed record UpdateRecord(string Id, long At, string Kind, string Text, JsonNode Ref);

/// <summary>An audit entry as the screens show it. I: its position (oldest first).</summary>
public sealed record AuditLine(long T, string Text, string Who, string Role, string Kind, int I);

/// <summary>Kind: completed | not-stemi | er-not-activated.</summary>
public sealed record ClosureInfo(long At, string? By, string Reason, string Source, string Kind);

/// <summary>A case in a list (completed cases, the test console).</summary>
public sealed record CaseSummary(
    string Cad, string Unit, string State, bool Legacy, bool Active, long Created, long? ClosedAt, string? ClosedBy, string? Kind,
    CaseSummaryPatient Pt, long? EcgAt, CaseSummaryEr Er, CaseSummaryCardio Cardio);

public sealed record CaseSummaryPatient(string? Age, string? Sex, string? Complaint);
public sealed record CaseSummaryEr(string? Name, string? Assessment, string? Reason);
public sealed record CaseSummaryCardio(long? Activated, string? Name, string? Decision);

/// <summary>What a tablet may learn about an existing case under the CAD number it entered.</summary>
public sealed record CasePublicInfo(string Cad, bool Active, long? SubmittedAt, string Unit, long OpenedAt, long? ClosedAt);

/// <summary>
/// The outcome of a case command (create, correct, open, discard, complete). Status: created | same | exists | invalid |
/// corrected | opened | missing | other-unit | sent | discarded | closed | incomplete | completed | error. Fields that do
/// not apply are left out of the JSON.
/// </summary>
public sealed record CaseCommandResult(string Status, string? Cad)
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Error { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Detail { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public CasePublicInfo? Existing { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? State { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Kind { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public CaseRecord? Rec { get; init; }
}

/// <summary>GET /api/cases/check: is the CAD number valid, and is there already a case under it?</summary>
public sealed record CadCheckResponse(bool Ok, string Cad)
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Error { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Detail { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? Exists { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public CasePublicInfo? Existing { get; init; }
}
