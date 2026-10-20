using System.Text.Json;
using Masar.Api.Contracts;
using Masar.Api.Security;
using Masar.Application.Abstractions;
using Masar.Application.Ai;
using Masar.Application.Cases;
using Masar.Application.Common;
using Masar.Application.Monitoring;
using Masar.Application.Simulation;
using Masar.Domain.Pathway;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace Masar.Api.Controllers;

/// <summary>
/// The test console (/control) — TEST ONLY: test data and simulation controls. Only the test console's device session
/// may use it; the crew, ER and Cardiologist screens get 403. Production must not include it (docs/security.md).
/// </summary>
[ApiController]
[ScreenSession]
public sealed class TestConsoleController(
    PlatformGate gate, CaseQueryService queries, CaseService cases, MonitorService monitor, SimulationSettings simulation, AiAnalysisService ai,
    TestDataService testData, ILiveNotifier live) : ControllerBase
{
    private bool IsConsole => HttpContext.Actor().Role == ActorRoles.Control;
    private ObjectResult ConsoleOnly() => StatusCode(StatusCodes.Status403Forbidden, new { error = "Test console only" });

    [HttpGet("/api/control/cases")]
    public IActionResult Cases() => !IsConsole ? ConsoleOnly() : Ok(new { cases = gate.Run(db => queries.ConsoleCases(db)) });

    /// <summary>The CORPULS SIMULATOR: the simulated monitors and the linked cases.</summary>
    [HttpGet("/api/control/corpuls")]
    public IActionResult Corpuls() => !IsConsole ? ConsoleOnly() : Ok(gate.Run(db => monitor.SimInfo(db)));

    /// <summary>RESET CORPULS DEMO: every simulated monitor back to the clean demo state (cases and records untouched).</summary>
    [HttpPost("/api/control/corpuls/reset-demo")]
    public IActionResult ResetCorpulsDemo()
    {
        if (!IsConsole) return ConsoleOnly();
        return gate.Run(db =>
        {
            var r = monitor.ResetDemo(db);
            var response = new SimulatorActionResponse(r.Ok, monitor.SimInfo(db)) { Error = r.Error, Monitors = r.Monitors };
            return StatusCode(r.Ok ? 200 : 409, response);
        });
    }

    /// <summary>What the tester makes the simulated monitor of a case do: connect, disconnect, reconnect, signal-loss, restore-signal, pause, resume, set, send-vitals, trigger-ecg.</summary>
    // the route value is "command": "action" is reserved by ASP.NET Core MVC
    [HttpPost("/api/control/corpuls/{command}")]
    [RequestSizeLimit(1_048_576)]
    public IActionResult Simulate(string command, [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] JsonElement body)
    {
        if (!IsConsole) return ConsoleOnly();
        var b = new JsonData(body);
        var values = new[] { "hr", "spo2", "sys", "dia", "rr" }
            .ToDictionary(k => k, k => b.Get(k) is { } v && v.ValueKind != JsonValueKind.Null ? JsonData.JsString(v) : null);
        return gate.Run(db =>
        {
            var r = monitor.Simulate(db, b.Text("cad"), command, new SimParams(b.Str("sample"), null, values));
            return StatusCode(r.Ok ? 200 : 409, SimulatorActionResponse.From(r, monitor.SimInfo(db)));
        });
    }

    /// <summary>The test console's simulation choices: the fictional test ECG pattern, the next test photo's quality, the mock AI behaviour.</summary>
    [HttpPost("/api/control/sim")]
    [RequestSizeLimit(1_048_576)]
    public IActionResult Sim([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] SimulationRequest? body)
    {
        if (!IsConsole) return ConsoleOnly();
        var find = body?.Find is "border" or "clear" ? body.Find : null;
        var q = body?.Q is "good" or "glare" or "cut" ? body.Q : null;
        var aiChoice = body?.Ai is "ok" or "down" or "proc" ? body.Ai : null;
        var sim = gate.Run(db =>
        {
            var v = simulation.Update(find, q, aiChoice);
            live.Broadcast("cfg", new { sim = SimulationSettings.ToDto(v) });
            // analyses held at "processing" finish once the console lets them
            if (aiChoice is not null && aiChoice != "proc") ai.Resume(db);
            return v;
        });
        return Ok(new { sim = SimulationSettings.ToDto(sim) });
    }

    /// <summary>Delete all test data (every test case and image; the crew test user stays). TEST ONLY.</summary>
    [HttpPost("/api/control/reset")]
    public IActionResult Reset()
    {
        if (!IsConsole) return ConsoleOnly();
        gate.Run(db => testData.ResetAll(db));
        return Ok(new { ok = true });
    }

    /// <summary>Take a case off the live screens, or return it (the STEMI pathway is not closed by this).</summary>
    [HttpPost("/api/control/screens")]
    [RequestSizeLimit(1_048_576)]
    public IActionResult Screens([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] ScreensRequest? body)
    {
        if (!IsConsole) return ConsoleOnly();
        var actor = HttpContext.Actor();
        return Ok(new { ok = gate.Run(db => cases.SetOnScreens(db, actor, body?.Cad, body?.On == true)) });
    }

    /// <summary>A pre-filled fictional demo case under a CAD number the tester types.</summary>
    [HttpPost("/api/control/demo-case")]
    [RequestSizeLimit(1_048_576)]
    public IActionResult DemoCase([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] CadRequest? body)
    {
        if (!IsConsole) return ConsoleOnly();
        var actor = HttpContext.Actor();
        var r = CaseCommandResponse.From(gate.Run(db => cases.DemoCase(db, actor, body?.Cad)));
        return r.Status switch
        {
            "invalid" => BadRequest(r with { Code = "invalid", Error = $"{r.Error} {r.Detail}" }),
            "exists" => Conflict(r with { Code = "exists", Error = $"CASE ALREADY EXISTS: CAD #{r.Cad}. No second case was created." }),
            "error" => StatusCode(500, r with { Code = "error" }),
            _ => Ok(new { ok = true, cad = r.Cad }),
        };
    }

    /// <summary>Any other test console address.</summary>
    [Route("/api/control/{**rest}", Order = 1000)]
    public IActionResult Unknown() => !IsConsole ? ConsoleOnly() : NotFound(new { error = "Not found" });
}
