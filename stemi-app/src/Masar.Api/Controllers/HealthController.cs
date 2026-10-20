using Masar.Api.Contracts;
using Masar.Api.Hosting;
using Microsoft.AspNetCore.Mvc;

namespace Masar.Api.Controllers;

/// <summary>GET /health: is the server alive? No login, and nothing about cases, users, settings or secrets.</summary>
[ApiController]
public sealed class HealthController(AppInfo app, IHostEnvironment env, TimeProvider time) : ControllerBase
{
    [HttpGet("/health")]
    public HealthResponse Get() => new(
        "ok", AppInfo.AppName, env.IsDevelopment() ? "development" : env.EnvironmentName.ToLowerInvariant(), AppInfo.Version, app.Port, Environment.ProcessId,
        app.StartedAt.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'"), (long)Math.Round((time.GetUtcNow() - app.StartedAt).TotalSeconds));
}
