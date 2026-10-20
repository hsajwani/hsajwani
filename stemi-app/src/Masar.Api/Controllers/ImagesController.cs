using Masar.Api.Security;
using Masar.Application.Cases;
using Masar.Application.Common;
using Masar.Domain.Pathway;
using Masar.Infrastructure.Configuration;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Masar.Api.Controllers;

/// <summary>
/// POST /api/images?cad=…&amp;src=file|test-generator: an ECG image uploaded from the crew MDT (the manual ECG fallback),
/// stored with its SHA-256 and linked to its ECG by the action that sends it. JPEG or PNG only.
/// </summary>
[ApiController]
[ScreenSession]
public sealed class ImagesController(PlatformGate gate, EcgImageService images, IOptions<StorageOptions> storage) : ControllerBase
{
    [HttpPost("/api/images")]
    [DisableRequestSizeLimit] // the limit is Storage:MaxImageBytes, applied below
    public async Task<IActionResult> Upload([FromQuery] string? cad, [FromQuery] string? src, CancellationToken ct)
    {
        var actor = HttpContext.Actor();
        if (actor.Role != ActorRoles.Crew) return StatusCode(StatusCodes.Status403Forbidden, new { error = "Only the crew uploads ECG images" });
        var mime = (Request.ContentType ?? string.Empty).Split(';')[0].Trim();
        if (mime is not (EcgImageService.Jpeg or EcgImageService.Png)) return StatusCode(StatusCodes.Status415UnsupportedMediaType, new { error = "JPEG or PNG only" });
        var c = gate.Run(db => db.Cases.FirstOrDefault(x => x.Cad == (cad ?? string.Empty)));
        if (c is null || c.Unit != actor.Unit) return NotFound(new { error = "There is no case with this CAD number for this tablet" });
        if (c.ClosedAt is not null) return Conflict(new { error = "This STEMI pathway is closed: it is read-only" });

        var limit = storage.Value.MaxImageBytes;
        if (HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } size) size.MaxRequestBodySize = limit;
        using var buffer = new MemoryStream();
        try
        {
            await Request.Body.CopyToAsync(buffer, ct);
        }
        catch (BadHttpRequestException e) when (e.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            return StatusCode(StatusCodes.Status413PayloadTooLarge, new { error = "Too large" });
        }
        if (buffer.Length > limit) return StatusCode(StatusCodes.Status413PayloadTooLarge, new { error = "Too large" });
        if (buffer.Length == 0) return BadRequest(new { error = "Empty image" });
        var source = src == "file" ? "file" : "test-generator";
        var image = gate.Run(db => images.Store(db, c.Cad, mime, buffer.ToArray(), actor.CrewTitle, source));
        return Ok(new { id = image.Id, url = $"/files/{image.Id}", sha256 = image.Sha256 });
    }
}
