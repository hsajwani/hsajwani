namespace Masar.Domain.Entities;

/// <summary>The cardiology activation alert of a case: when it was raised, shown (alarm started) and acknowledged.</summary>
public class CardiologistAlert
{
    public string Cad { get; set; } = string.Empty;
    public string Cardiologist { get; set; } = string.Empty;
    public string Hospital { get; set; } = string.Empty;
    public long AlertedAt { get; set; }
    public long? ShownAt { get; set; }
    public long? AcknowledgedAt { get; set; }
    public string? AcknowledgedBy { get; set; }
}
