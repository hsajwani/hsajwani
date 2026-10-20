using Masar.Api.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;

namespace Masar.Api.Hosting;

/// <summary>The screens' files (HTML, CSS, JavaScript): read from disk on every request, so a refresh shows a change.</summary>
public sealed class FrontendFiles
{
    public FrontendFiles(IOptions<FrontendOptions> options, IWebHostEnvironment env)
    {
        var configured = options.Value.RootPath;
        Root = Path.GetFullPath(Path.IsPathRooted(configured) ? configured : Path.Combine(env.ContentRootPath, configured));
        if (!Directory.Exists(Root)) throw new DirectoryNotFoundException($"The screens folder was not found: {Root} (Frontend:RootPath).");
        Provider = new PhysicalFileProvider(Root);
    }

    public string Root { get; }
    public PhysicalFileProvider Provider { get; }

    public string? Read(string relativePath)
    {
        var full = Path.GetFullPath(Path.Combine(Root, relativePath));
        return full.StartsWith(Root + Path.DirectorySeparatorChar, StringComparison.Ordinal) && File.Exists(full) ? File.ReadAllText(full) : null;
    }
}
