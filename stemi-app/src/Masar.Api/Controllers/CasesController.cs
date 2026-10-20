using System.Text.Json;
using Masar.Api.Contracts;
using Masar.Api.Security;
using Masar.Application.Cases;
using Masar.Application.Common;
using Masar.Domain.Pathway;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace Masar.Api.Controllers;

/// <summary>
/// Cases by CAD number: check, create, correct before SEND, discard an unsent case, open an existing case, complete the
/// STEMI pathway (crew); completed cases found and opened read-only (every role allowed to see them).
/// </summary>
[ApiController]
[ScreenSession]
public sealed class CasesController(PlatformGate gate, CaseService cases, CaseQueryService queries, CaseRecordBuilder records) : ControllerBase
{
    private Actor Actor => HttpContext.Actor();
    private ObjectResult CrewOnly(string what) => StatusCode(StatusCodes.Status403Forbidden, new { error = $"Only the crew {what}" });
    private static ObjectResult Result(int status, CaseCommandResponse body) => new(body) { StatusCode = status };

    [HttpGet("/api/cases/check")]
    public IActionResult Check([FromQuery] string? cad) =>
        Actor.Role != ActorRoles.Crew ? CrewOnly("opens cases") : Ok(gate.Run(db => cases.Check(db, cad)));

    [HttpPost("/api/cases")]
    [RequestSizeLimit(1_048_576)]
    public IActionResult Create([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] JsonElement body)
    {
        if (Actor.Role != ActorRoles.Crew) return CrewOnly("opens cases");
        return gate.Run(db =>
        {
            var r = cases.Create(db, Actor, new JsonData(body));
            return r.Status switch
            {
                "invalid" => Result(400, CaseCommandResponse.From(r) with { Code = "invalid" }),
                "exists" => Result(409, CaseCommandResponse.From(r) with { Code = "exists" }),
                _ => Result(r.Status == "created" ? 201 : 200, CaseCommandResponse.From(r) with { Ok = true, Rec = records.Build(db, r.Cad) }),
            };
        });
    }

    /// <summary>Completed cases, found by CAD number (part of it is enough).</summary>
    [HttpGet("/api/cases")]
    public IActionResult ListClosed([FromQuery] string? q) => Ok(new { cases = gate.Run(db => queries.ListClosed(db, Actor, q)) });

    [HttpGet("/api/cases/view")]
    public IActionResult View([FromQuery] string? cad)
    {
        var rec = gate.Run(db => queries.View(db, Actor, cad));
        return rec is null ? NotFound(new { error = "No case with this CAD number for this screen" }) : Ok(new { rec });
    }

    /// <summary>COMPLETE STEMI PATHWAY: only while the current Cardiologist decision is CONFIRMED STEMI. (/close: the 0.4 name.)</summary>
    [HttpPost("/api/cases/complete")]
    [HttpPost("/api/cases/close")]
    [RequestSizeLimit(1_048_576)]
    public IActionResult Complete([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] CadRequest? body)
    {
        if (Actor.Role != ActorRoles.Crew) return CrewOnly("completes the STEMI pathway");
        var r = CaseCommandResponse.From(gate.Run(db => cases.Complete(db, Actor, body?.Cad)));
        return r.Status switch
        {
            "missing" => Result(404, r with { Code = "missing", Error = "There is no case with this CAD number for this tablet" }),
            "closed" => Result(409, r with { Code = "closed", Error = "This STEMI pathway is already closed: it is read-only." }),
            "incomplete" => Result(409, r with { Code = "incomplete" }),
            _ => Result(200, r with { Ok = true }),
        };
    }

    [HttpPost("/api/cases/open")]
    [RequestSizeLimit(1_048_576)]
    public IActionResult Open([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] CadRequest? body)
    {
        if (Actor.Role != ActorRoles.Crew) return CrewOnly("opens cases");
        var r = CaseCommandResponse.From(gate.Run(db => cases.OpenExisting(db, Actor, body?.Cad)));
        return r.Status switch
        {
            "invalid" => Result(400, r with { Code = "invalid" }),
            "missing" => Result(404, r with { Code = "missing", Error = "There is no case with this CAD number" }),
            "other-unit" => Result(403, r with { Code = "other-unit", Error = "This CAD number belongs to a case of another unit" }),
            _ => Result(200, r with { Ok = true }),
        };
    }

    /// <summary>The CAD number of an unsent case corrected before SEND (the case and its corpuls data move with it).</summary>
    [HttpPost("/api/cases/correct")]
    [RequestSizeLimit(1_048_576)]
    public IActionResult Correct([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] JsonElement body)
    {
        if (Actor.Role != ActorRoles.Crew) return CrewOnly("corrects a CAD number");
        var r = CaseCommandResponse.From(gate.Run(db => cases.Correct(db, Actor, new JsonData(body))));
        return r.Status switch
        {
            "invalid" => Result(400, r with { Code = "invalid" }),
            "exists" => Result(409, r with { Code = "exists" }),
            "missing" => Result(404, r with { Code = "missing", Error = "There is no unsent case with this CAD number on this tablet" }),
            "sent" => Result(409, r with { Code = "sent" }),
            _ => Result(200, r with { Ok = true }),
        };
    }

    /// <summary>An unsent case discarded on the tablet: kept as an unsent draft; its corpuls feed ends.</summary>
    [HttpPost("/api/cases/discard")]
    [RequestSizeLimit(1_048_576)]
    public IActionResult Discard([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] CadRequest? body)
    {
        if (Actor.Role != ActorRoles.Crew) return CrewOnly("discards an unsent case");
        var r = CaseCommandResponse.From(gate.Run(db => cases.Discard(db, Actor, body?.Cad)));
        return r.Status switch
        {
            "missing" => Result(404, r with { Code = "missing", Error = "There is no unsent case with this CAD number on this tablet" }),
            "sent" => Result(409, r with { Code = "sent", Error = "The case was already sent: it cannot be discarded." }),
            _ => Result(200, r with { Ok = true }),
        };
    }
}
