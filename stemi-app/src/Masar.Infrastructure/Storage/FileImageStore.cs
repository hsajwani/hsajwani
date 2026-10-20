using Masar.Application.Abstractions;

namespace Masar.Infrastructure.Storage;

/// <summary>
/// ECG image files on the local disk ({data folder}/images). PROTOTYPE ONLY: production needs approved storage with
/// encryption at rest, backup and a retention policy (see docs/security.md and docs/deployment.md).
/// </summary>
public sealed class FileImageStore : IImageStore
{
    private readonly string _directory;

    public FileImageStore(string directory)
    {
        _directory = Path.GetFullPath(directory);
        Directory.CreateDirectory(_directory);
    }

    public void Save(string fileName, byte[] data) => File.WriteAllBytes(Resolve(fileName) ?? throw new ArgumentException("Invalid image file name.", nameof(fileName)), data);

    public string? PathOf(string fileName) => Resolve(fileName) is { } path && File.Exists(path) ? path : null;

    public void DeleteAll()
    {
        foreach (var file in Directory.EnumerateFiles(_directory)) File.Delete(file);
    }

    /// <summary>Security: a stored file name never leaves the image folder (no path separators, no "..").</summary>
    private string? Resolve(string fileName)
    {
        if (string.IsNullOrWhiteSpace(fileName) || fileName != Path.GetFileName(fileName) || fileName.Contains("..")) return null;
        return Path.Combine(_directory, fileName);
    }
}
