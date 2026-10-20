using System.Text.Json;
using Masar.Application;
using Masar.Application.Abstractions;
using Masar.Application.Actions;
using Masar.Application.Cases;
using Masar.Application.Common;
using Masar.Infrastructure;
using Masar.Infrastructure.Identity;
using Masar.Infrastructure.Persistence;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Masar.UnitTests;

/// <summary>
/// The application and infrastructure services wired as in the real host, on a temporary SQLite database (never data/),
/// with the simulated corpuls feed's demo mode off and a live link that only records what it was told.
/// </summary>
public sealed class TestPlatform : IDisposable
{
    public string DataDirectory { get; } = Path.Combine(Path.GetTempPath(), "masar-test-" + Guid.NewGuid().ToString("N"));
    public ServiceProvider Services { get; }
    public RecordingLiveNotifier Live { get; } = new();
    private long _ops;

    public TestPlatform(bool initialize = true, bool demoMode = false)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Storage:DataDirectory"] = DataDirectory,
            ["Corpuls:DemoMode"] = demoMode ? "true" : "false",
            ["Corpuls:SimConnectMs"] = "50",
            ["Corpuls:SimTickMs"] = "60000",
            ["Ai:MockDelayMs"] = "10",
            // random per run: no password in the source code
            ["Prototype:CrewTestUser:Password"] = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(16)),
        }).Build();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<ILiveNotifier>(Live);
        services.AddMasarApplication();
        services.AddMasarInfrastructure(config, DataDirectory);
        Services = services.BuildServiceProvider();
        if (!initialize) return;
        Get<DatabaseInitializer>().Initialize();
        Get<CrewTestUserSeeder>().Seed();
    }

    public T Get<T>() where T : notnull => Services.GetRequiredService<T>();

    public PlatformGate Gate => Get<PlatformGate>();

    public Actor Crew => Gate.Run(db => CrewUsers.First(db, null))!;
    public static readonly Actor Er = new("er", null, "device-er", null, "ER Doctor", null, null);
    public static readonly Actor Cardiologist = new("cardiologist", null, "device-cardiologist", null, "Cardiologist", null, null);

    public static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    public static JsonData Json(object value) => new(JsonSerializer.SerializeToElement(value));

    /// <summary>One action, as a screen sends it (POST /api/ops).</summary>
    public OpResult Op(Actor actor, string cad, string kind, object? data = null, string? id = null)
    {
        var op = JsonSerializer.SerializeToElement(new { id = id ?? $"t-{actor.Role}-{Interlocked.Increment(ref _ops)}", cad, k = kind, t = Now, data = data ?? new { } });
        return Gate.Run(db => Get<ActionService>().Apply(db, actor, [op]))[0];
    }

    public CaseRecord Record(string cad) => Gate.Run(db => Get<CaseRecordBuilder>().Build(db, cad))!;

    public List<string> Audit(string cad) => Gate.Run(db => db.AuditEvents.Where(a => a.Cad == cad).OrderBy(a => a.At).ThenBy(a => a.Id).Select(a => a.Action).ToList());

    /// <summary>Creates the case and sends it with a manual fallback ECG (a fictional uploaded image).</summary>
    public void SendWithFallbackEcg(string cad)
    {
        var crew = Crew;
        Gate.Run(db => Get<CaseService>().Create(db, crew, Json(new { cad, cid = "cid-" + cad })));
        var image = Gate.Run(db => Get<EcgImageService>().Store(db, cad, EcgImageService.Jpeg, [0xFF, 0xD8, 0xFF, 0xD9], crew.CrewTitle, "file"));
        var now = Now;
        var r = Op(crew, cad, "submit", new
        {
            sendAt = now,
            md = MinimumData(now),
            ecg = new { n = 1, acq = now - 1000, variant = "border", pri = 1, imgs = new[] { new { i = 1, kind = "full", q = "file", at = now - 1000, imageId = image.Id } } },
        });
        if (!r.Ok) throw new InvalidOperationException(r.Error);
    }

    /// <summary>The crew's four items as the crew tablet sends them at SEND.</summary>
    public static object MinimumData(long now) => new
    {
        age = new { v = "58 y", raw = new { v = 58 }, t = now },
        sex = new { v = "Male", raw = new { v = "Male" }, t = now },
        complaint = new { v = "Chest pain", raw = new { k = "cp" }, t = now },
        onset = new { v = "Unknown", raw = new { nv = "Unknown" }, t = now },
    };

    /// <summary>The ER Doctor / Cardiologist screen opens ECG n, as the screens do before an assessment or a decision.</summary>
    public void See(Actor actor, string cad, int n) => Op(actor, cad, "viewed", new { n, i = 1 });

    public void Dispose()
    {
        Services.Dispose();
        SqliteConnection.ClearAllPools();
        try { Directory.Delete(DataDirectory, recursive: true); } catch (IOException) { /* a background timer may still hold a file */ }
    }
}

/// <summary>Records what the services asked the live link to send (instead of open screens).</summary>
public sealed class RecordingLiveNotifier : ILiveNotifier
{
    public List<string> ChangedCases { get; } = [];
    public void CaseChanged(string cad) { lock (ChangedCases) ChangedCases.Add(cad); }
    public void MonitorChanged(string cad, object monitor, long at) { }
    public void Broadcast(string eventName, object data, string? onlyRole = null) { }
    public void RestartAllScreens() { }
    public void SimulatorChanged() { }
}
