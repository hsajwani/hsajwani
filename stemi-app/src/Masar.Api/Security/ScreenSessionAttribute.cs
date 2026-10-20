using Masar.Application.Common;
using Masar.Domain.Pathway;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Masar.Api.Security;

/// <summary>
/// Requires the screen's session (crew login, or the ER / Cardiologist / test console device session). Without it the
/// API answers 401 with the message the screens show. The actor is then available as <c>HttpContext.Actor()</c>.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class ScreenSessionAttribute : Attribute, IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var http = context.HttpContext;
        var role = ActorResolver.RequestedRole(http);
        var actor = await http.RequestServices.GetRequiredService<ActorResolver>().ResolveAsync(http, role);
        if (actor is null)
        {
            context.Result = new UnauthorizedObjectResult(new { error = role == ActorRoles.Crew ? "Not logged in" : "No session for this screen: reload the page" });
            return;
        }
        http.Items[ActorResolver.ItemKey] = actor;
        await next();
    }
}

public static class ActorHttpContextExtensions
{
    public static Actor Actor(this HttpContext http) => (Actor)http.Items[ActorResolver.ItemKey]!;
}
