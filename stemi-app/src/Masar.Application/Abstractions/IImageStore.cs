namespace Masar.Application.Abstractions;

/// <summary>
/// Where ECG image files are kept (the database holds the metadata and SHA-256). The prototype stores them on the local
/// disk (FileImageStore); production needs approved, encrypted storage with retention (see docs/security.md).
/// </summary>
public interface IImageStore
{
    void Save(string fileName, byte[] data);
    string? PathOf(string fileName);
    void DeleteAll();
}
