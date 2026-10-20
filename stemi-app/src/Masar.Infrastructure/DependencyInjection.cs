using Masar.Application.Abstractions;
using Masar.Application.Common;
using Masar.Application.Monitoring;
using Masar.Infrastructure.Ai;
using Masar.Infrastructure.Configuration;
using Masar.Infrastructure.Corpuls;
using Masar.Infrastructure.Identity;
using Masar.Infrastructure.Persistence;
using Masar.Infrastructure.Storage;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Masar.Infrastructure;

public static class DependencyInjection
{
    /// <summary>
    /// The infrastructure: the database, the image store, the AI provider and the corpuls provider, chosen by configuration
    /// (sections Storage, Ai, Corpuls, Prototype — see docs/configuration.md).
    /// </summary>
    public static IServiceCollection AddMasarInfrastructure(this IServiceCollection services, IConfiguration configuration, string contentRoot)
    {
        services.Configure<StorageOptions>(configuration.GetSection(StorageOptions.Section));
        services.Configure<AiOptions>(configuration.GetSection(AiOptions.Section));
        services.Configure<CorpulsOptions>(configuration.GetSection(CorpulsOptions.Section));
        services.Configure<PrototypeOptions>(configuration.GetSection(PrototypeOptions.Section));

        var storage = configuration.GetSection(StorageOptions.Section).Get<StorageOptions>() ?? new StorageOptions();
        var paths = StoragePaths.Resolve(storage, contentRoot);
        services.AddSingleton(paths);

        services.AddDbContextFactory<MasarDbContext>(o => o
            .UseSqlite($"Data Source={paths.DatabaseFile}")
            .UseQueryTrackingBehavior(QueryTrackingBehavior.NoTracking));
        services.AddSingleton<IMasarDbContextFactory, MasarDbContextFactory>();
        services.AddSingleton<DatabaseInitializer>();
        services.AddSingleton<ISettingsStore, SettingsStore>();
        services.AddSingleton<IImageStore>(_ => new FileImageStore(paths.ImagesDirectory));
        services.AddSingleton(sp => new CrewTestUserSeeder(
            sp.GetRequiredService<PlatformGate>(), sp.GetRequiredService<IOptions<PrototypeOptions>>().Value, paths.DataDirectory,
            sp.GetRequiredService<ILogger<CrewTestUserSeeder>>()));

        // Simulated AI Interpretation — PROTOTYPE ONLY: "mock" is the only AI provider of this build
        services.AddSingleton<IEcgAiProvider>(sp =>
        {
            var ai = sp.GetRequiredService<IOptions<AiOptions>>().Value;
            if (!string.Equals(ai.Provider, "mock", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException($"Unknown Ai:Provider \"{ai.Provider}\". Only \"mock\" exists in this build.");
            return new MockEcgAiProvider(TimeSpan.FromMilliseconds(Math.Max(0, ai.MockDelayMs)));
        });

        // the corpuls provider behind the replaceable ICorpulsProvider interface
        services.AddSingleton<ICorpulsProvider>(sp =>
        {
            var corpuls = sp.GetRequiredService<IOptions<CorpulsOptions>>().Value;
            return corpuls.Provider.Trim().ToLowerInvariant() switch
            {
                "mock" => new MockCorpulsProvider(corpuls, sp.GetRequiredService<PlatformGate>(), sp.GetRequiredService<ISettingsStore>(),
                    sp.GetRequiredService<TimeProvider>(), sp.GetRequiredService<ILogger<MockCorpulsProvider>>()),
                "corpuls-mission" => new RealCorpulsMissionProvider(),
                _ => throw new InvalidOperationException($"Unknown Corpuls:Provider \"{corpuls.Provider}\". Use \"mock\" (simulated) or \"corpuls-mission\" (not implemented)."),
            };
        });
        return services;
    }
}
