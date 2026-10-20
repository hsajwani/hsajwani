using System.Security.Cryptography;
using Masar.Application.Abstractions;
using Masar.Application.Common;
using Masar.Domain.Entities;

namespace Masar.Application.Cases;

/// <summary>
/// Stores an ECG image: the file in the image store, its metadata and SHA-256 in ecg_images (so the image can be
/// checked later). The image is linked to its ECG by the action that sends it (or by the corpuls feed).
/// </summary>
public sealed class EcgImageService(IImageStore store, TimeProvider time)
{
    public const string Svg = "image/svg+xml";
    public const string Png = "image/png";
    public const string Jpeg = "image/jpeg";

    /// <param name="source">file | test-generator (crew uploads, manual fallback) · corpuls (the simulated feed).</param>
    public EcgImage Store(IMasarDbContext db, string cad, string mime, byte[] data, string? uploadedBy, string source)
    {
        var id = Ids.New("img");
        var fileName = id + (mime == Svg ? ".svg" : mime == Png ? ".png" : ".jpg");
        store.Save(fileName, data);
        return db.Insert(new EcgImage
        {
            Id = id, Cad = cad, UploadedAt = time.NowMs(), Source = source, FileName = fileName, Mime = mime, Bytes = data.LongLength,
            Sha256 = Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant(), UploadedBy = uploadedBy,
        });
    }
}
