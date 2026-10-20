using Masar.Api.Live;
using Masar.Api.Security;
using Masar.Application.Common;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;

namespace Masar.Api.Controllers;

/// <summary>
/// GET /api/stream?role=…: the live link of one screen (Server-Sent Events). It starts with init, cfg and cases (and
/// presence for the test console); then case, monitor, hb (heartbeat), cfg, corpuls and presence events follow.
/// </summary>
[ApiController]
public sealed class LiveStreamController(LiveHub hub, LiveUpdates updates, PlatformGate gate, IHostApplicationLifetime lifetime) : ControllerBase
{
    [HttpGet("/api/stream")]
    [ScreenSession]
    public async Task Stream(CancellationToken requestAborted)
    {
        // the stream ends when the screen goes away, or at once when the server stops (it never ends by itself)
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(requestAborted, lifetime.ApplicationStopping);
        var ct = stop.Token;
        var actor = HttpContext.Actor();
        Response.Headers.ContentType = "text/event-stream; charset=utf-8";
        Response.Headers.CacheControl = "no-cache, no-transform";
        Response.Headers["X-Accel-Buffering"] = "no";
        HttpContext.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();
        await Response.WriteAsync("retry: 2000\n\n", ct);
        await Response.Body.FlushAsync(ct);

        var client = new LiveClient(actor);
        // registered and greeted in one step: no update can slip in between
        gate.Run(db =>
        {
            hub.Add(client);
            updates.Hello(db, client);
        });
        hub.SetPresence(actor.Role, true);
        try
        {
            await foreach (var message in client.Outbox.Reader.ReadAllAsync(ct))
            {
                await Response.WriteAsync(message, ct);
                await Response.Body.FlushAsync(ct);
            }
        }
        catch (OperationCanceledException)
        {
            // the screen went away
        }
        catch (IOException)
        {
            // the connection broke
        }
        finally
        {
            hub.Remove(client);
        }
    }
}
