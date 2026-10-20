namespace Masar.Domain.Entities;

/// <summary>
/// One AI analysis per ECG, made once and shown unchanged on every screen. PROTOTYPE ONLY: the provider in this build
/// is a mock with scripted findings (not a clinical model). Decision support only: it never decides anything.
/// </summary>
public class AiInterpretation
{
    public string Cad { get; set; } = string.Empty;
    public int EcgN { get; set; }
    /// <summary>proc | ok | lim (limited by quality) | wh (not suitable) | down (unavailable).</summary>
    public string Status { get; set; } = string.Empty;
    public long? StartedAt { get; set; }
    public long? CompletedAt { get; set; }
    public string? Provider { get; set; }
    public string? Version { get; set; }
    public string? ResultJson { get; set; }
}
