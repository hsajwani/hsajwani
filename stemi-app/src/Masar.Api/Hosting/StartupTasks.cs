using Masar.Api.Live;
using Masar.Application.Ai;
using Masar.Application.Common;
using Masar.Application.Monitoring;
using Masar.Infrastructure.Identity;
using Masar.Infrastructure.Persistence;

namespace Masar.Api.Hosting;

/// <summary>What runs once before the server accepts requests. Every step is automatic: there is no manual setup step.</summary>
public static class StartupTasks
{
    /// <returns>Where the crew test password comes from (for the banner; never the password itself).</returns>
    public static string Run(IServiceProvider services)
    {
        // 1. the database: created, or brought to the current schema by the migrations (an existing database is kept)
        services.GetRequiredService<DatabaseInitializer>().Initialize();
        // 2. the crew test account (PROTOTYPE ONLY)
        var passwordSource = services.GetRequiredService<CrewTestUserSeeder>().Seed();
        // 3. the screens are told about every change at the end of the change itself (PlatformGate, LiveUpdates.Flush).
        //    Resolved only now: the corpuls provider behind it reads its saved settings from the database.
        var gate = services.GetRequiredService<PlatformGate>();
        gate.OnUnitOfWorkCompleted(services.GetRequiredService<LiveUpdates>().Flush);
        // 4. AI analyses interrupted by a restart finish; the corpuls feeds that were linked carry on
        var ai = services.GetRequiredService<AiAnalysisService>();
        var monitor = services.GetRequiredService<MonitorService>();
        gate.Run(db =>
        {
            ai.Resume(db);
            monitor.Resume(db);
        });
        return passwordSource;
    }
}
