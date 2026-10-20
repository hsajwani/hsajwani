using Masar.Application.Monitoring;
using Masar.Infrastructure;
using Masar.Infrastructure.Configuration;
using Microsoft.Extensions.Options;

namespace Masar.Api.Hosting;

/// <summary>
/// The human-readable start message on the console: the addresses of every screen (the development runner and the test
/// harness wait for its "Test console" line). Operational events are logged separately (structured logging).
/// </summary>
public static class StartupBanner
{
    public static void Print(IServiceProvider services, string passwordSource)
    {
        var app = services.GetRequiredService<AppInfo>();
        var env = services.GetRequiredService<IHostEnvironment>();
        var paths = services.GetRequiredService<StoragePaths>();
        var ai = services.GetRequiredService<IOptions<AiOptions>>().Value;
        var prototype = services.GetRequiredService<IOptions<PrototypeOptions>>().Value;
        var port = app.Port;
        var lan = AppInfo.LanAddresses();
        var ip = lan.FirstOrDefault()?.Address ?? "<this computer's IP address>";
        var line = new string('─', 64);
        var title = env.IsDevelopment() ? "STEMI Development Server Running (ASP.NET Core)" : "MASAR · STEMI Coordination Platform · prototype";
        var provider = services.GetRequiredService<ICorpulsProvider>();
        var corpulsText = provider.Simulated
            ? $"simulated feed (Mock Corpuls Provider — PROTOTYPE ONLY{(provider.DemoMode ? ", demo mode: automatic ECG 1" : string.Empty)})"
            : $"{provider.Name} (not implemented: no monitor data; the manual ECG fallback only)";
        Console.WriteLine($"""

            {line}
             {title} · v{AppInfo.Version} · {DateTimeOffset.UtcNow:yyyy-MM-dd'T'HH:mm:ss.fff'Z'}
             FICTIONAL TEST DATA ONLY · {env.EnvironmentName}
            {line}
             Crew (this Mac):            http://localhost:{port}/crew
             ER Doctor (this Mac):       http://localhost:{port}/er
             Cardiologist on this Mac:   http://localhost:{port}/cardiologist
             Cardiologist on iPhone:     http://{ip}:{port}/cardiologist
             Test console:               http://localhost:{port}/control
            """);
        if (lan.Count > 1) Console.WriteLine($" Other addresses: {string.Join(", ", lan.Skip(1).Select(a => $"{a.Address} ({a.Name})"))}");
        Console.WriteLine($" Health: http://localhost:{port}/health · database: {paths.DatabaseFile} (SQLite — PROTOTYPE DATABASE, kept across restarts)");
        Console.WriteLine($" AI: {ai.Provider} (Simulated AI Interpretation — PROTOTYPE ONLY) · corpuls: {corpulsText}");
        Console.WriteLine($" Crew test login: {prototype.CrewTestUser.Email} · password: from {passwordSource}");
        Console.WriteLine($"{line}{Environment.NewLine}");
    }
}
