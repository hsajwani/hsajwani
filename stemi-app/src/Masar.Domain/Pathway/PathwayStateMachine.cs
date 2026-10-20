namespace Masar.Domain.Pathway;

/// <summary>
/// The STEMI pathway's state machine. The server is the authority: every action from a screen is checked here before
/// it is stored, and the state every screen shows is derived here from the stored record.
/// <code>
/// DRAFT → SENT TO ER → ER REVIEWING → either
///   ER REVIEW COMPLETED — CARDIOLOGY NOT ACTIVATED (closed), or
///   CARDIOLOGY ACTIVATED → CARDIOLOGIST REVIEWING → one of
///     CONFIRMED STEMI (active) → COMPLETE STEMI PATHWAY → COMPLETED (closed)
///     NOT STEMI → PATHWAY CLOSED (closed automatically)
///     REPEAT ECG REQUESTED → repeat ECG received → CARDIOLOGIST REVIEWING → next decision
/// </code>
/// No clinical criteria live here: every clinical step is a person's action; the rules only decide whether that action
/// is allowed in the current state.
/// </summary>
public static class PathwayStateMachine
{
    /// <summary>
    /// What a closed (read-only) case still accepts: viewing it, and confirming that a decision or outcome has been seen.
    /// Everything else is refused, so a closed STEMI pathway can never be changed (closed-case immutability).
    /// </summary>
    public static readonly IReadOnlySet<string> ReadOnlyAllowed = new HashSet<string>
        { "viewed", "seen", "compare", "decrcv", "decack", "erack", "hopen", "er_shown", "shown" };

    /// <summary>Crew actions that add to a case that has been sent (refused on an unsent draft).</summary>
    public static readonly IReadOnlySet<string> CrewAfterSend = new HashSet<string>
        { "ecg", "img", "md", "rec", "note", "hopen", "decrcv", "decack", "erack" };

    public static string DeriveState(CaseFacts f)
    {
        var c = f.Case;
        if (c.ClosedAt is not null)
        {
            return PathwayClosure.KindOf(c.ClosureReason) switch
            {
                "er-not-activated" => PathwayStates.ErClosed,
                "not-stemi" => PathwayStates.NotStemiClosed,
                _ => PathwayStates.Completed,
            };
        }
        if (c.ServerReceivedAt is null) return PathwayStates.Draft;
        if (f.Activated is null) return c.ErAcceptedAt is not null ? PathwayStates.ErReviewing : PathwayStates.SentToEr;
        if (f.Acknowledged is null) return PathwayStates.CardiologyActivated;
        var d = f.LastDecision;
        if (d is null) return PathwayStates.CardiologistReviewing;
        if (d.Kind == "confirm") return PathwayStates.Confirmed;
        // A repeat request stays open until an ECG newer than the one it covered has arrived.
        if (d.Kind == "repeat") return f.EcgCount > (d.OnEcg ?? 0) ? PathwayStates.RepeatReceived : PathwayStates.RepeatRequested;
        return PathwayStates.CardiologistReviewing;
    }

    /// <summary>
    /// Null when the action is allowed in the case's current state, otherwise the reason it is refused (shown to the user).
    /// </summary>
    public static string? Guard(string role, string actionKind, CaseFacts f)
    {
        var st = f.State;
        // Closed-case immutability: only viewing and acknowledgements are recorded on a closed case.
        if (PathwayStates.IsClosed(st) && !ReadOnlyAllowed.Contains(actionKind)) return "This STEMI pathway is closed: it is read-only.";
        switch (role)
        {
            case ActorRoles.Crew:
                if (CrewAfterSend.Contains(actionKind) && st == PathwayStates.Draft) return "Send the case before adding to it.";
                return null;
            case ActorRoles.Er:
                if (st == PathwayStates.Draft) return "This case has not been sent to the ER.";
                if (actionKind == "er_assess")
                {
                    // The ER Doctor must first accept the case (which stops the alarm and records who reviews it), and
                    // records exactly one screening assessment.
                    if (st == PathwayStates.SentToEr) return "Accept the case before recording the ER assessment.";
                    if (st != PathwayStates.ErReviewing) return "The ER assessment for this case is already recorded.";
                }
                return null;
            case ActorRoles.Cardiologist:
                // Only the ER Doctor activates cardiology: nothing reaches or is recorded by the Cardiologist before that.
                if (f.Activated is null) return "Cardiology has not been activated for this case: no cardiologist action can be recorded.";
                // Acknowledging (which stops the alarm) is a separate step from deciding.
                if (actionKind == "decision" && st == PathwayStates.CardiologyActivated) return "Acknowledge the case before recording a decision.";
                return null;
            default:
                return "This is not an action for this screen.";
        }
    }
}
