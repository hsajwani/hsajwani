using Masar.Domain.Pathway;

namespace Masar.Application.Common;

/// <summary>
/// Who acts: the crew test user, or a prototype device session of the ER Doctor / Cardiologist / test console.
/// PROTOTYPE ONLY: this is not secure authentication (see docs/security.md). Production replaces how the actor is
/// established (organisational SSO), not what the services do with it.
/// </summary>
public sealed record Actor(string Role, string? Id, string? Device, string? Name, string? Title, string? Unit, string? Emirate, string? Email = null)
{
    public static readonly Actor SystemActor = new(ActorRoles.System, null, null, null, null, null, null);

    /// <summary>"K. Ahmed, Paramedic": how a crew member appears in the audit trail.</summary>
    public string CrewTitle => $"{Name}, {Title}";
}
