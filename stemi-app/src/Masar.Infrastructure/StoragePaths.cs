using Masar.Infrastructure.Configuration;

namespace Masar.Infrastructure;

/// <summary>The resolved data locations (Storage:DataDirectory, relative to the content root unless absolute).</summary>
public sealed record StoragePaths(string DataDirectory, string DatabaseFile, string ImagesDirectory, string KeysDirectory)
{
    public static StoragePaths Resolve(StorageOptions options, string contentRoot)
    {
        var data = Path.GetFullPath(Path.IsPathRooted(options.DataDirectory) ? options.DataDirectory : Path.Combine(contentRoot, options.DataDirectory));
        var paths = new StoragePaths(data, Path.Combine(data, options.DatabaseFileName), Path.Combine(data, "images"), Path.Combine(data, "keys"));
        Directory.CreateDirectory(paths.ImagesDirectory);
        Directory.CreateDirectory(paths.KeysDirectory);
        return paths;
    }
}
