namespace Masar.Domain.Entities;

/// <summary>
/// A Cardiologist decision. Acknowledgement and decision are separate events, and every decision is kept (a repeat ECG
/// request is followed by a later decision on the newer ECG).
/// </summary>
public class Decision
{
    public string Id { get; set; } = string.Empty;
    public string Cad { get; set; } = string.Empty;
    /// <summary>confirm | not | repeat.</summary>
    public string Kind { get; set; } = string.Empty;
    /// <summary>The ECG number the decision covers (it must be the latest ECG when decided).</summary>
    public int? OnEcg { get; set; }
    public string? AlsoJson { get; set; }
    public string? Reason { get; set; }
    public string? Note { get; set; }
    public string? Advice { get; set; }
    public string? ReasonsJson { get; set; }
    public string? Instruction { get; set; }
    public int? WithinMin { get; set; }
    public string? AiFeedback { get; set; }
    public long DecidedAt { get; set; }
    public long ReceivedAt { get; set; }
    public string DecidedBy { get; set; } = string.Empty;
    public string? DecidedByTitle { get; set; }
    public string? UserId { get; set; }
    public long? DeliveredAt { get; set; }
    public long? CrewAckAt { get; set; }
}
