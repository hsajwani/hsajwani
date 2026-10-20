using Masar.Api.Security;
using Masar.Application.Abstractions;
using Masar.Application.Common;
using Microsoft.AspNetCore.Mvc;

namespace Masar.Api.Controllers;

/// <summary>GET /files/{id}: a stored ECG image, shown on every role's screen (any valid session).</summary>
[ApiController]
public sealed class FilesController(PlatformGate gate, IImageStore images, ActorResolver actors) : ControllerBase
{
    [HttpGet("/files/{id}")]
    public async Task<IActionResult> Get(string id)
    {
        if (!await actors.AnySessionAsync(HttpContext)) return Unauthorized(new { error = "Not signed in" });
        var image = gate.Run(db => db.EcgImages.FirstOrDefault(i => i.Id == id));
        var path = image is null ? null : images.PathOf(image.FileName);
        if (path is null) return NotFound("Not found");
        Response.Headers.CacheControl = "private, max-age=86400, immutable";
        // Security: the simulated corpuls ECGs are SVG drawn by the platform itself; nothing in them may ever run
        Response.Headers.ContentSecurityPolicy = "default-src 'none'; style-src 'unsafe-inline'";
        Response.Headers.XContentTypeOptions = "nosniff";
        var type = Path.GetExtension(path).ToLowerInvariant() switch { ".svg" => "image/svg+xml", ".png" => "image/png", _ => "image/jpeg" };
        return PhysicalFile(path, type);
    }
}
