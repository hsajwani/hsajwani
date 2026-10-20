namespace Masar.Domain.Entities;

// Tables kept only so that databases from earlier versions keep opening and nothing written earlier is lost.
// Nothing in this version writes to them: the 0.3.0 handover documentation and the 0.4.0 destination / ETA belong to
// ICCC and the ePCR, not to the STEMI pathway. Do not build new features on them.

public class AlertFollowup
{
    public long Id { get; set; }
    public string Cad { get; set; } = string.Empty;
    public string Kind { get; set; } = string.Empty;
    public int? Level { get; set; }
    public string? Target { get; set; }
    public long At { get; set; }
}

public class Destination
{
    public string Id { get; set; } = string.Empty;
    public string Cad { get; set; } = string.Empty;
    public string Hospital { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string? Reason { get; set; }
    public string? Why { get; set; }
    public string? FromHospital { get; set; }
    public long At { get; set; }
    public long ReceivedAt { get; set; }
    public string? SetBy { get; set; }
}

public class Eta
{
    public string Id { get; set; } = string.Empty;
    public string Cad { get; set; } = string.Empty;
    public int Minutes { get; set; }
    public long? DepartedAt { get; set; }
    public long At { get; set; }
    public long ReceivedAt { get; set; }
    public string? SetBy { get; set; }
    public string? Why { get; set; }
}

public class Arrival
{
    public string Id { get; set; } = string.Empty;
    public string Cad { get; set; } = string.Empty;
    public string Hospital { get; set; } = string.Empty;
    public long ArrivedAt { get; set; }
    public string Kind { get; set; } = string.Empty;
    public long ReceivedAt { get; set; }
    public string? SetBy { get; set; }
    public string? OpId { get; set; }
}

public class Handover
{
    public string Id { get; set; } = string.Empty;
    public string Cad { get; set; } = string.Empty;
    public long? HandoverAt { get; set; }
    public string? Hospital { get; set; }
    public string? Area { get; set; }
    public string? AreaOther { get; set; }
    public string? ClinicianName { get; set; }
    public string? ClinicianRole { get; set; }
    public string? CrewClinician { get; set; }
    public string? Notes { get; set; }
    public long SavedAt { get; set; }
    public long ReceivedAt { get; set; }
    public string? SavedBy { get; set; }
    public string? OpId { get; set; }
}

public class FinalVitals
{
    public string Id { get; set; } = string.Empty;
    public string Cad { get; set; } = string.Empty;
    public string ValuesJson { get; set; } = string.Empty;
    public long ConfirmedAt { get; set; }
    public long ReceivedAt { get; set; }
    public string? ConfirmedBy { get; set; }
    public string? OpId { get; set; }
}
