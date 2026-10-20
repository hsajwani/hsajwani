using Masar.Api.Contracts;
using Masar.Api.Security;
using Masar.Application.Cases;
using Masar.Application.Common;
using Masar.Application.Monitoring;
using Masar.Domain.Pathway;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace Masar.Api.Controllers;

/// <summary>The corpuls feed: the crew links the case to the unit's monitor (the CAD number must exist first).</summary>
[ApiController]
[ScreenSession]
public sealed class CorpulsController(PlatformGate gate, MonitorService monitor, CaseRecordBuilder records) : ControllerBase
{
    private Actor Actor => HttpContext.Actor();
    private ObjectResult CrewOnly(string what) => StatusCode(StatusCodes.Status403Forbidden, new { error = $"Only the crew {what}" });

    [HttpPost("/api/corpuls/link")]
    [RequestSizeLimit(1_048_576)]
    public IActionResult Link([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] CadRequest? body)
    {
        if (Actor.Role != ActorRoles.Crew) return CrewOnly("links the corpuls monitor");
        return gate.Run<IActionResult>(db =>
        {
            var r = monitor.Link(db, Actor, body?.Cad);
            var response = new CaseCommandResponse(r.Status, r.Cad) { Already = r.Already };
            return r.Status switch
            {
                "missing" => NotFound(response with { Code = "missing", Error = "There is no case with this CAD number for this tablet: enter the CAD number first." }),
                "closed" => Conflict(response with { Code = "closed", Error = "This STEMI pathway is closed: it is read-only." }),
                _ => Ok(response with { Ok = true, Rec = records.Build(db, r.Cad) }),
            };
        });
    }

    /// <summary>
    /// Demo mode only (PROTOTYPE ONLY): the crew acquires a 12-lead on the simulated corpuls3 from the crew screen,
    /// because no physical monitor is connected; the ECG arrives through the simulated feed.
    /// </summary>
    [HttpPost("/api/corpuls/demo-acquire")]
    [RequestSizeLimit(1_048_576)]
    public IActionResult DemoAcquire([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] CadRequest? body)
    {
        if (Actor.Role != ActorRoles.Crew) return CrewOnly("acquires the simulated 12-lead");
        var r = gate.Run(db => monitor.DemoAcquire(db, Actor, body?.Cad));
        var status = r.Status switch { "ok" => 200, "missing" => 404, _ => 409 };
        return StatusCode(status, new DemoAcquireResponse(r.Status == "ok", r.Status, r.Status, r.Cad) { N = r.N, Held = r.Held, Error = r.Error });
    }
}
