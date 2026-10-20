namespace Masar.Domain.Entities;

/// <summary>A treatment update from the crew (shown silently to the ER and the Cardiologist). Never overwritten.</summary>
public class Treatment
{
    public string Id { get; set; } = string.Empty;
    public string Cad { get; set; } = string.Empty;
    public string ItemKey { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string? Category { get; set; }
    public string? ValueText { get; set; }
    public bool NotObtained { get; set; }
    public long? TakenAt { get; set; }
    public long ReceivedAt { get; set; }
    public string? EnteredBy { get; set; }
    public string EntryKind { get; set; } = string.Empty;
    public string? OpId { get; set; }
}
