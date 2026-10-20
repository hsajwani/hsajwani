namespace Masar.Domain.Entities;

/// <summary>
/// One entry of the crew's minimum data. A new value never replaces an old one: every entry is a row, so the history
/// (and who entered what, when) is kept. Age, sex, complaint and onset are in <c>patient_details</c>; vital signs
/// entered by the crew (the manual fallback when corpuls cannot deliver them) are in <c>observations</c>.
/// </summary>
public abstract class MinimumDataEntry
{
    public string Id { get; set; } = string.Empty;
    public string Cad { get; set; } = string.Empty;
    public string Field { get; set; } = string.Empty;
    public string? ValueText { get; set; }
    public string? RawJson { get; set; }
    public long? TakenAt { get; set; }
    public long ReceivedAt { get; set; }
    public string? EnteredBy { get; set; }
    /// <summary>sent | update | correct | clarify | fallback.</summary>
    public string EntryKind { get; set; } = string.Empty;
    public string? Reason { get; set; }
    public string? OpId { get; set; }
}

public class PatientDetail : MinimumDataEntry;

public class Observation : MinimumDataEntry;
