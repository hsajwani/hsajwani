using Masar.Api.Contracts;
using Masar.Api.Hosting;
using Masar.Api.Live;
using Masar.Api.Security;
using Masar.Application.Common;
using Masar.Application.Monitoring;
using Masar.Domain.Pathway;
using Masar.Infrastructure.Configuration;
using Masar.Infrastructure.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.Extensions.Options;

namespace Masar.Api.Controllers;

/// <summary>The crew test login (PROTOTYPE ONLY), the screen's own session, and server information.</summary>
[ApiController]
public sealed class SessionController(PlatformGate gate, ActorResolver actors, LiveHub hub, MonitorService monitor, AppInfo app,
    IOptions<AiOptions> ai, TimeProvider time, ILogger<SessionController> log) : ControllerBase
{
    [HttpPost("/api/login")]
    [RequestSizeLimit(1_048_576)]
    public async Task<IActionResult> Login([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] LoginRequest? body)
    {
        var email = (body?.Email ?? string.Empty).Trim().ToLowerInvariant();
        var user = gate.Run(db => db.Users.FirstOrDefault(u => u.Email == email));
        if (user is null || !CrewTestUserSeeder.Verify(user, body?.Password ?? string.Empty))
        {
            log.LogInformation("Crew login refused for {Email}", email);
            return Unauthorized(new { error = "Email or password not recognised" });
        }
        if (user.Role != ActorRoles.Crew)
            return Unauthorized(new { error = "This login is for the crew MDT only. The ER Doctor and Cardiologist screens need no login: open /er or /cardiologist." });
        await ScreenSessions.SignInCrewAsync(HttpContext, user.Id);
        log.LogInformation("Crew login: {UserId}", user.Id);
        return Ok(new LoginResponse(user.Role, user.Name));
    }

    [HttpPost("/api/logout")]
    public async Task<IActionResult> Logout()
    {
        await ScreenSessions.SignOutCrewAsync(HttpContext);
        return Ok(new { ok = true });
    }

    [HttpGet("/api/ping")]
    public IActionResult Ping() => Ok(new { ok = true, now = time.NowMs() });

    [HttpGet("/api/me")]
    [ScreenSession]
    public async Task<IActionResult> Me()
    {
        var actor = HttpContext.Actor();
        CrewUserDto? user = null;
        if (actor.Role == ActorRoles.Crew && await actors.CrewUserAsync(HttpContext) is { } u)
            user = new CrewUserDto(u.Id, u.Email, u.Role, u.Name, u.Title, u.Org, u.Unit, u.Emirate);
        return Ok(new { role = actor.Role, user, version = AppInfo.Version });
    }

    /// <summary>Server information for the test console: version, providers, open screens, and the addresses to open on other devices.</summary>
    [HttpGet("/api/info")]
    [ScreenSession]
    public IActionResult Info()
    {
        var port = app.Port;
        return Ok(new
        {
            version = AppInfo.Version,
            aiProvider = ai.Value.Provider,
            corpuls = monitor.Info(),
            clients = hub.ClientCount,
            presence = hub.Presence(),
            urls = AppInfo.LanAddresses().Select(a => new { name = a.Name, er = $"http://{a.Address}:{port}/er", cardiologist = $"http://{a.Address}:{port}/cardiologist" }),
        });
    }
}
