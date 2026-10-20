using System.Security.Claims;
using System.Security.Cryptography;
using Masar.Application.Common;
using Masar.Domain.Pathway;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace Masar.Api.Security;

/// <summary>
/// Who is acting. PROTOTYPE ONLY: none of this is secure authentication or identity assurance.
/// <list type="bullet">
/// <item>Crew MDT: e-mail + password of the single crew test user, then an ASP.NET Core authentication cookie (scheme
/// <see cref="CrewScheme"/>, cookie "stemi_sid").</item>
/// <item>ER Doctor, Cardiologist and the test console: no login. Opening the page gives the browser a prototype device
/// session for that role (scheme "Device.&lt;role&gt;", cookie "stemi_dev_&lt;role&gt;"). The clinician types their name when
/// accepting / acknowledging a case (Free-text ER Doctor Name / Free-text Cardiologist Name — PROTOTYPE ONLY).</item>
/// </list>
/// Cookies are protected with ASP.NET Core Data Protection (keys in the data folder). Production must replace this with
/// the organisation's approved identity provider (e.g. Microsoft Entra ID via OpenID Connect, with staff ID) — the
/// services only need an <see cref="Actor"/>, so only this class changes. See docs/security.md.
/// </summary>
public static class ScreenSessions
{
    public const string CrewScheme = "Crew";
    public const string CrewCookie = "stemi_sid";
    public static string DeviceScheme(string role) => $"Device.{role}";
    public static string DeviceCookie(string role) => $"stemi_dev_{role}";
    public const string RoleHeader = "X-Stemi-Role";

    private const string UserIdClaim = "masar:user";
    private const string DeviceClaim = "masar:device";
    private const string RoleClaim = "masar:role";

    public static void AddScreenSessions(this AuthenticationBuilder auth, int crewHours, int deviceDays, bool requireSecureCookies)
    {
        auth.AddCookie(CrewScheme, o => Configure(o, CrewCookie, TimeSpan.FromHours(crewHours), requireSecureCookies));
        foreach (var role in ActorRoles.DeviceRoles)
            auth.AddCookie(DeviceScheme(role), o => Configure(o, DeviceCookie(role), TimeSpan.FromDays(deviceDays), requireSecureCookies));
    }

    private static void Configure(CookieAuthenticationOptions o, string name, TimeSpan lifetime, bool requireSecure)
    {
        o.Cookie.Name = name;
        o.Cookie.HttpOnly = true;
        o.Cookie.SameSite = SameSiteMode.Lax;
        o.Cookie.Path = "/";
        // Security: the prototype runs on plain HTTP on the local network; production must use HTTPS and set
        // Sessions:RequireSecureCookies (docs/security.md)
        o.Cookie.SecurePolicy = requireSecure ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
        o.ExpireTimeSpan = lifetime;
        o.Cookie.MaxAge = lifetime;
        o.SlidingExpiration = false;
        // an API request without a session gets 401, never a redirect
        o.Events.OnRedirectToLogin = c => { c.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
        o.Events.OnRedirectToAccessDenied = c => { c.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
    }

    public static Task SignInCrewAsync(HttpContext http, string userId) =>
        http.SignInAsync(CrewScheme, new ClaimsPrincipal(new ClaimsIdentity([new Claim(UserIdClaim, userId)], CrewScheme)),
            new AuthenticationProperties { IsPersistent = true });

    public static Task SignOutCrewAsync(HttpContext http) => http.SignOutAsync(CrewScheme);

    /// <summary>A new prototype device session for this role (the page sets it on first visit).</summary>
    public static Task StartDeviceSessionAsync(HttpContext http, string role) =>
        http.SignInAsync(DeviceScheme(role), new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(RoleClaim, role), new Claim(DeviceClaim, Convert.ToHexString(RandomNumberGenerator.GetBytes(6)).ToLowerInvariant())], DeviceScheme(role))),
            new AuthenticationProperties { IsPersistent = true });

    /// <summary>The id of the crew user signed in on this browser, or null.</summary>
    public static async Task<string?> CrewUserIdAsync(HttpContext http)
    {
        var r = await http.AuthenticateAsync(CrewScheme);
        return r.Succeeded ? r.Principal?.FindFirstValue(UserIdClaim) : null;
    }

    /// <summary>The device id of this browser's session for the role, or null.</summary>
    public static async Task<string?> DeviceAsync(HttpContext http, string role)
    {
        if (!ActorRoles.DeviceRoles.Contains(role)) return null;
        var r = await http.AuthenticateAsync(DeviceScheme(role));
        return r.Succeeded && r.Principal?.FindFirstValue(RoleClaim) == role ? r.Principal.FindFirstValue(DeviceClaim) : null;
    }
}
