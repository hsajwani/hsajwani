using Masar.Application.Common;
using Masar.Domain.Entities;
using Masar.Domain.Pathway;

namespace Masar.Api.Security;

/// <summary>
/// Establishes the <see cref="Actor"/> of a request. The screen says which role it is (X-Stemi-Role header, or ?role= on
/// the live stream; default crew). A device role needs that role's device session; anything else is the signed-in crew
/// user. PROTOTYPE ONLY (see <see cref="ScreenSessions"/>).
/// </summary>
public sealed class ActorResolver(PlatformGate gate)
{
    public const string ItemKey = "masar:actor";

    public static string RequestedRole(HttpContext http)
    {
        var header = http.Request.Headers[ScreenSessions.RoleHeader].ToString();
        if (header.Length > 0) return header;
        var query = http.Request.Query["role"].ToString();
        return query.Length > 0 ? query : ActorRoles.Crew;
    }

    public async Task<Actor?> ResolveAsync(HttpContext http, string role)
    {
        if (ActorRoles.DeviceRoles.Contains(role))
        {
            var device = await ScreenSessions.DeviceAsync(http, role);
            if (device is null) return null;
            var title = role switch { ActorRoles.Er => "ER Doctor", ActorRoles.Cardiologist => "Cardiologist", _ => "Test console" };
            return new Actor(role, null, device, null, title, null, null);
        }
        var user = await CrewUserAsync(http);
        return user is null ? null : new Actor(ActorRoles.Crew, user.Id, null, user.Name, user.Title, user.Unit, user.Emirate, user.Email);
    }

    /// <summary>The crew user of this browser's crew session (it must still exist and be a crew account).</summary>
    public async Task<User?> CrewUserAsync(HttpContext http)
    {
        var id = await ScreenSessions.CrewUserIdAsync(http);
        return id is null ? null : gate.Run(db => db.Users.FirstOrDefault(u => u.Id == id && u.Role == ActorRoles.Crew));
    }

    /// <summary>Any valid session at all (stored ECG images are shown on every role's screen).</summary>
    public async Task<bool> AnySessionAsync(HttpContext http)
    {
        if (await CrewUserAsync(http) is not null) return true;
        foreach (var role in ActorRoles.DeviceRoles)
            if (await ScreenSessions.DeviceAsync(http, role) is not null) return true;
        return false;
    }
}
