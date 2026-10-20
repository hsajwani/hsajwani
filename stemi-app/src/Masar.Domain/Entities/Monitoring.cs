namespace Masar.Domain.Entities;

/// <summary>
/// The corpuls monitor's vital signs as a light history (not every sample): each blood pressure measurement, explicit
/// updates, about one row a minute otherwise, and the values sent with the case. No raw waveforms are stored.
/// </summary>
public class MonitorVital
{
    public long Id { get; set; }
    public string Cad { get; set; } = string.Empty;
    public long At { get; set; }
    public long ReceivedAt { get; set; }
    public string? DeviceId { get; set; }
    public string Source { get; set; } = string.Empty;
    public int? Hr { get; set; }
    public int? Spo2 { get; set; }
    public int? BpSys { get; set; }
    public int? BpDia { get; set; }
    public long? BpAt { get; set; }
    public int? Rr { get; set; }
    public string? EventId { get; set; }
    /// <summary>nibp | update | sample | at_send.</summary>
    public string? Why { get; set; }
}

/// <summary>The feed's significant moments (linked, connected, lost, restored, ended, ECG received, manual fallback).</summary>
public class MonitorEvent
{
    public long Id { get; set; }
    public string Cad { get; set; } = string.Empty;
    public long At { get; set; }
    public string Kind { get; set; } = string.Empty;
    public string Text { get; set; } = string.Empty;
}
