using System.Text.Json;
using Masar.Api.Contracts;
using Masar.Api.Hosting;
using Masar.Api.Security;
using Masar.Domain.Pathway;
using Microsoft.AspNetCore.Mvc;

namespace Masar.Api.Controllers;

/// <summary>
/// The screens: / (role chooser), /login (crew login), /crew (crew MDT, needs the crew login), /er, /cardiologist and
/// /control (these give the browser a prototype device session on first visit). Each page learns its role, the crew
/// user and the version without an extra request (window.APP).
/// </summary>
[ApiExplorerSettings(IgnoreApi = true)]
public sealed class PagesController(FrontendFiles files, ActorResolver actors) : ControllerBase
{
    private static readonly JsonSerializerOptions PageJson = new(JsonSerializerDefaults.Web);

    [HttpGet("/")] public Task<IActionResult> Home() => Page(null, "index.html", "/");
    [HttpGet("/login")] public Task<IActionResult> Login() => Page(null, "login/index.html", "/login");
    [HttpGet("/crew")] public Task<IActionResult> Crew() => Page(ActorRoles.Crew, "crew/index.html", "/crew");
    [HttpGet("/er")] public Task<IActionResult> Er() => Page(ActorRoles.Er, "er/index.html", "/er");
    [HttpGet("/cardiologist")] public Task<IActionResult> Cardiologist() => Page(ActorRoles.Cardiologist, "cardiologist/index.html", "/cardiologist");
    [HttpGet("/control")] public Task<IActionResult> Control() => Page(ActorRoles.Control, "control/index.html", "/control");

    [HttpGet("/favicon.ico")] public IActionResult Favicon() => NoContent();

    private async Task<IActionResult> Page(string? role, string file, string path)
    {
        CrewUserDto? user = null;
        if (role == ActorRoles.Crew)
        {
            var u = await actors.CrewUserAsync(HttpContext);
            if (u is null) return Redirect("/login?next=" + Uri.EscapeDataString(path));
            user = new CrewUserDto(u.Id, u.Email, u.Role, u.Name, u.Title, u.Org, u.Unit, u.Emirate);
        }
        else if (role is not null && await ScreenSessions.DeviceAsync(HttpContext, role) is null)
        {
            await ScreenSessions.StartDeviceSessionAsync(HttpContext, role);
        }
        var html = files.Read(file);
        if (html is null) return NotFound("Not found");
        // the default encoder escapes <, > and & so the JSON cannot end the script element
        var app = JsonSerializer.Serialize(new { role, user, version = AppInfo.Version }, PageJson);
        return Content(html.Replace("<!--APP-->", $"<script>window.APP={app};</script>"), "text/html; charset=utf-8");
    }
}
