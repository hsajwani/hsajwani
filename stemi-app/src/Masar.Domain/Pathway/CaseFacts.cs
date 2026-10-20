using Masar.Domain.Entities;

namespace Masar.Domain.Pathway;

/// <summary>
/// Everything the pathway rules need to know about one case, read from the database in one place
/// (see CaseFactsLoader in Masar.Application). The state is derived from these facts, never stored.
/// </summary>
public sealed class CaseFacts
{
    public required Case Case { get; init; }
    public CardiologistAlert? Alert { get; init; }
    public Decision? LastDecision { get; init; }
    /// <summary>The highest ECG number of the case (ECG 1, 2, 3 … across every source); 0 when there is none.</summary>
    public int EcgCount { get; init; }
    /// <summary>A case made before 0.5.0: sent straight to the cardiologist, with no ER step.</summary>
    public bool Legacy { get; init; }
    /// <summary>When cardiology was activated (the ER Doctor's ACTIVATE / UNCERTAIN), or null.</summary>
    public long? Activated { get; init; }
    /// <summary>When the Cardiologist acknowledged the activation (ACKNOWLEDGE &amp; OPEN), or null.</summary>
    public long? Acknowledged { get; init; }
    public string State { get; set; } = PathwayStates.Draft;

    public static CaseFacts From(Case c, CardiologistAlert? alert, Decision? lastDecision, int ecgCount)
    {
        // Cases made before 0.5.0 have a cardiologist alert but no ER fields: they are read as already activated.
        var legacy = c.ErAlertedAt is null && alert is not null;
        var facts = new CaseFacts
        {
            Case = c,
            Alert = alert,
            LastDecision = lastDecision,
            EcgCount = ecgCount,
            Legacy = legacy,
            Activated = c.CardiologyActivatedAt ?? (legacy ? alert!.AlertedAt : null),
            Acknowledged = c.CardiologistAcknowledgedAt ?? (legacy ? c.AcknowledgedAt ?? alert!.AcknowledgedAt : null),
        };
        facts.State = PathwayStateMachine.DeriveState(facts);
        return facts;
    }
}
