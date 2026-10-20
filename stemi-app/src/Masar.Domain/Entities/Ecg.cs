namespace Masar.Domain.Entities;

/// <summary>
/// ECG 1, ECG 2, ECG 3 …: one row per acquisition, numbered by the platform across every source. An ECG is never
/// overwritten: a repeat ECG is a new number, so every ECG keeps its own time, images, AI result and review history.
/// </summary>
public class Ecg
{
    public string Cad { get; set; } = string.Empty;
    public int N { get; set; }
    public long? AcquiredAt { get; set; }
    public long? SentAt { get; set; }
    public long? ReceivedAt { get; set; }
    public int PrimaryImage { get; set; } = 1;
    /// <summary>The fictional test pattern (mock AI scripted findings follow it): border | clear | evolved | clear2.</summary>
    public string? Variant { get; set; }
    public bool SameAsPrevious { get; set; }
    public string? SentBy { get; set; }
    public string? TimeReason { get; set; }
    public string? OpId { get; set; }
    /// <summary>corpuls | manual_fallback | test; empty for the crew photos of 0.5.0 and earlier.</summary>
    public string? Source { get; set; }
    public string? DeviceId { get; set; }
    /// <summary>The provider's event id: an ECG sent again (after a reconnection) is stored once.</summary>
    public string? SourceEventId { get; set; }
    public int? SourceSeq { get; set; }
    public long? TransmittedAt { get; set; }
    /// <summary>The heart rate the monitor reported with the 12-lead.</summary>
    public int? DeviceHr { get; set; }
}
