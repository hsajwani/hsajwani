namespace Masar.Domain.Entities;

/// <summary>The first view of each ECG image per role (er | cardiologist): recorded so a decision can require it.</summary>
public class EcgRoleView
{
    public string Cad { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public int EcgN { get; set; }
    public int I { get; set; }
    public long ViewedAt { get; set; }
    public string? ViewedBy { get; set; }
}

/// <summary>The cardiologist's first view of each image as recorded by 0.4.0 and earlier (read only, kept for old cases).</summary>
public class EcgView
{
    public string Cad { get; set; } = string.Empty;
    public int EcgN { get; set; }
    public int I { get; set; }
    public long ViewedAt { get; set; }
    public string? ViewedBy { get; set; }
}
