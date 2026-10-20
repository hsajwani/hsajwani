namespace Masar.Domain.Entities;

/// <summary>
/// A stored ECG image (several images of one printout belong to one ECG: Image 1 is the Primary). The file is on disk
/// in the image store; its SHA-256 is recorded so the image can be checked later.
/// </summary>
public class EcgImage
{
    public string Id { get; set; } = string.Empty;
    public string Cad { get; set; } = string.Empty;
    public int? EcgN { get; set; }
    public int? I { get; set; }
    public long? CapturedAt { get; set; }
    public long UploadedAt { get; set; }
    public long? ReceivedAt { get; set; }
    public string? Kind { get; set; }
    public string? Quality { get; set; }
    /// <summary>test-generator | file | corpuls (simulated feed).</summary>
    public string Source { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public string Mime { get; set; } = string.Empty;
    public long Bytes { get; set; }
    public string Sha256 { get; set; } = string.Empty;
    public bool AddedAfterSend { get; set; }
    public string? UploadedBy { get; set; }
    public string? OpId { get; set; }
}
