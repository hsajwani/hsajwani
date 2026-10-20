using Masar.Domain.Pathway;

namespace Masar.Application.Cases;

/// <summary>
/// Who may see which case. Enforced on the server: a screen only ever receives the cases its role may see.
/// </summary>
public static class CaseVisibility
{
    /// <summary>On the live screens (the test console sees every case, including those taken off the screens).</summary>
    public static bool CanSee(string role, string? unit, CaseFacts f) => role switch
    {
        ActorRoles.Control => true,
        _ when !f.Case.Active => false,
        // the crew sees its own unit's cases
        ActorRoles.Crew => f.Case.Unit == unit,
        // the ER sees a case once it was sent (never an unsent draft)
        ActorRoles.Er => f.Case.ServerReceivedAt is not null,
        // the Cardiologist sees only cases where the ER Doctor activated cardiology
        ActorRoles.Cardiologist => f.Activated is not null,
        _ => false,
    };

    /// <summary>
    /// Opened by CAD number (completed cases). The Cardiologist finds an ER-closed case only by searching for it, and then
    /// sees that cardiology was not activated (no cardiologist involvement is implied).
    /// </summary>
    public static bool CanView(string role, string? unit, CaseFacts f, bool searching) => role switch
    {
        ActorRoles.Control => true,
        ActorRoles.Crew => f.Case.Unit == unit,
        ActorRoles.Er => f.Case.ServerReceivedAt is not null,
        ActorRoles.Cardiologist => f.Activated is not null || (searching && PathwayStates.IsClosed(f.State)),
        _ => false,
    };
}
