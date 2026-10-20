using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;

namespace Masar.IntegrationTests;

/// <summary>
/// The real ASP.NET Core application in memory (TestServer), on a temporary data folder (never data/), serving the
/// repository's screens. The crew test password is given through configuration, as in production.
/// </summary>
public sealed class MasarApiFactory : WebApplicationFactory<Program>
{
    /// <summary>The crew test password of this test run: random, never in the source code.</summary>
    public static readonly string CrewPassword = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(16));
    public string DataDirectory { get; } = Path.Combine(Path.GetTempPath(), "masar-it-" + Guid.NewGuid().ToString("N"));

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("Storage:DataDirectory", DataDirectory);
        builder.UseSetting("Frontend:RootPath", RepositoryFolder("public"));
        builder.UseSetting("Prototype:CrewTestUser:Password", CrewPassword);
        builder.UseSetting("Corpuls:DemoMode", "false");
        builder.UseSetting("Ai:MockDelayMs", "10");
        builder.UseSetting("Logging:LogLevel:Default", "Warning");
    }

    /// <summary>A folder of the repository (stemi-app/), found from the test assembly's location.</summary>
    public static string RepositoryFolder(string name)
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
            if (File.Exists(Path.Combine(dir.FullName, "Masar.sln"))) return Path.Combine(dir.FullName, name);
        throw new DirectoryNotFoundException("The repository folder (with Masar.sln) was not found.");
    }

    public HttpClient Screen(string role)
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false, HandleCookies = true });
        client.DefaultRequestHeaders.Add("X-Stemi-Role", role);
        return client;
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        SqliteConnection.ClearAllPools();
        try { Directory.Delete(DataDirectory, recursive: true); } catch (IOException) { /* still in use */ }
    }
}
