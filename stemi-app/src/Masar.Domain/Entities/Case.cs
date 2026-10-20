namespace Masar.Domain.Entities;

/// <summary>
/// One STEMI case per CAD number (table <c>cases</c>). The CAD number is the case identifier carried by every other
/// table. All times are Unix epoch milliseconds. Columns are only ever added, never removed or renamed, so databases
/// created by earlier versions keep opening (see docs/database.md).
/// </summary>
public class Case
{
    public string Cad { get; set; } = string.Empty;
    /// <summary>manual-crew | manual-test-console | null (simulated CAD feed of v0.1).</summary>
    public string? CadSource { get; set; }
    public long? CadEnteredAt { get; set; }
    public string? CadEnteredBy { get; set; }
    /// <summary>The tablet's own id for this case, so a resent "create" is not taken for a duplicate.</summary>
    public string? CreatedCid { get; set; }
    /// <summary>Null while the pathway is active; "closed" once closed (read-only from then on).</summary>
    public string? Status { get; set; }
    /// <summary>When the Case Summary was first opened (column name kept from 0.3.0).</summary>
    public long? HandoverOpenedAt { get; set; }
    public long? ClosedAt { get; set; }
    public string? ClosedBy { get; set; }
    public string? ClosedUserId { get; set; }
    public string? ClosureReason { get; set; }
    public string? ClosureSource { get; set; }
    /// <summary>False when the test console took the case off the live screens (the pathway is NOT closed by that).</summary>
    public bool Active { get; set; } = true;
    public string Unit { get; set; } = string.Empty;
    public string Emirate { get; set; } = string.Empty;
    public string CrewName { get; set; } = string.Empty;
    public string IncidentType { get; set; } = string.Empty;
    public long? DispatchedAt { get; set; }
    public long? AtPatientAt { get; set; }
    public long CreatedAt { get; set; }
    public long? PathwayOpenedAt { get; set; }
    public string? PathwayOpenedBy { get; set; }
    /// <summary>When the crew pressed SEND (tablet time).</summary>
    public long? SubmittedAt { get; set; }
    /// <summary>When the server stored the sent case. Null: still an unsent draft (never shown to the ER).</summary>
    public long? ServerReceivedAt { get; set; }
    public bool DeliveredLate { get; set; }
    public long? DowntimeAt { get; set; }
    public long? AcknowledgedAt { get; set; }
    public long? OpenedAt { get; set; }
    public long? ComparedAt { get; set; }

    // 0.5.0: the ER Doctor step and the cardiology activation
    public long? ErAlertedAt { get; set; }
    public long? ErAlertShownAt { get; set; }
    public string? ErDoctorName { get; set; }
    public long? ErAcceptedAt { get; set; }
    /// <summary>activate | uncertain | not_suspicious.</summary>
    public string? ErAssessment { get; set; }
    public long? ErAssessmentAt { get; set; }
    public string? ErAssessedBy { get; set; }
    public int? ErAssessmentEcg { get; set; }
    public string? ErNonActivationReason { get; set; }
    public string? ErNonActivationComment { get; set; }
    public long? ErOutcomeSeenAt { get; set; }
    public long? CardiologyActivatedAt { get; set; }
    public string? CardiologyActivationReason { get; set; }
    public string? CardiologyActivatedBy { get; set; }
    public string? CardiologistName { get; set; }
    public long? CardiologistAcknowledgedAt { get; set; }
    public string? CardiologistDecision { get; set; }
    public long? CardiologistDecisionAt { get; set; }

    // 0.6.0: the corpuls monitor feed linked to the case, and its latest values
    public string? CorpulsProvider { get; set; }
    public string? CorpulsDeviceId { get; set; }
    public string? CorpulsDeviceLabel { get; set; }
    public long? CorpulsLinkedAt { get; set; }
    public string? CorpulsLinkedBy { get; set; }
    /// <summary>waiting | connected | reconnecting | disconnected.</summary>
    public string? CorpulsStatus { get; set; }
    public long? CorpulsStatusAt { get; set; }
    public bool? CorpulsConnectedOnce { get; set; }
    public long? CorpulsLastDataAt { get; set; }
    public long? CorpulsLinkEndedAt { get; set; }
    public string? CorpulsLinkEndReason { get; set; }
    /// <summary>The latest monitor values as JSON: hr, spo2, rr, sys, dia, bpAt, at.</summary>
    public string? VitalsJson { get; set; }
    public long? VitalsAt { get; set; }
    public string? VitalsSource { get; set; }
    public long? VitalsHistAt { get; set; }
    /// <summary>An unsent case discarded on the tablet: it stays a draft; nothing reached the ER.</summary>
    public long? DraftDiscardedAt { get; set; }
}
