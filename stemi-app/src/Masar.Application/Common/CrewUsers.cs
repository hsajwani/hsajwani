using Masar.Application.Abstractions;
using Masar.Domain.Pathway;

namespace Masar.Application.Common;

/// <summary>The crew test user (PROTOTYPE ONLY: one fictional crew account; see docs/security.md).</summary>
public static class CrewUsers
{
    /// <summary>The first crew user, acting through another screen's device session (the test console's demo case).</summary>
    public static Actor? First(IMasarDbContext db, string? device)
    {
        var u = db.Users.Where(x => x.Role == ActorRoles.Crew).OrderBy(x => x.Id).FirstOrDefault();
        return u is null ? null : new Actor(ActorRoles.Crew, u.Id, device, u.Name, u.Title, u.Unit, u.Emirate, u.Email);
    }
}
