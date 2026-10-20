using System.Text.Json;
using Masar.Api.Security;
using Masar.Application.Actions;
using Masar.Application.Common;
using Masar.Domain.Pathway;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace Masar.Api.Controllers;

/// <summary>
/// POST /api/ops: the clinical actions of the crew, ER Doctor and Cardiologist screens, as a batch { ops: [ { id, cad, k,
/// t, data } ] } applied in order. Every action is checked on the server against the pathway state machine; the
/// browser's own checks are only for immediate feedback. See docs/api.md for every action kind.
/// </summary>
[ApiController]
[ScreenSession]
public sealed class ActionsController(PlatformGate gate, ActionService actions, TimeProvider time) : ControllerBase
{
    public const int MaxActionsPerRequest = 200;

    [HttpPost("/api/ops")]
    [RequestSizeLimit(1_048_576)]
    public IActionResult Apply([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] JsonElement body)
    {
        var actor = HttpContext.Actor();
        if (actor.Role is not (ActorRoles.Crew or ActorRoles.Er or ActorRoles.Cardiologist))
            return StatusCode(StatusCodes.Status403Forbidden, new { error = "This screen does not record clinical actions" });
        var ops = new JsonData(body).Array("ops").ToList();
        if (ops.Count == 0 || ops.Count > MaxActionsPerRequest) return BadRequest(new { error = "No actions" });
        var results = gate.Run(db => actions.Apply(db, actor, ops));
        return Ok(new { results, now = time.NowMs() });
    }
}
