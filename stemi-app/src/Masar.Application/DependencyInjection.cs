using Masar.Application.Actions;
using Masar.Application.Ai;
using Masar.Application.Cases;
using Masar.Application.Common;
using Masar.Application.Monitoring;
using Masar.Application.Simulation;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Masar.Application;

public static class DependencyInjection
{
    /// <summary>
    /// The application services (use cases). All are singletons: they keep no per-request state, and every change runs
    /// through the one <see cref="PlatformGate"/>.
    /// </summary>
    public static IServiceCollection AddMasarApplication(this IServiceCollection services)
    {
        services.TryAddSingleton(TimeProvider.System);
        services.AddSingleton<PlatformGate>();
        services.AddSingleton<SimulationSettings>();
        services.AddSingleton<MonitorRecordReader>();
        services.AddSingleton<CaseRecordBuilder>();
        services.AddSingleton<CaseQueryService>();
        services.AddSingleton<EcgImageService>();
        services.AddSingleton<AiAnalysisService>();
        services.AddSingleton<MonitorService>();
        services.AddSingleton<ActionService>();
        services.AddSingleton<CaseService>();
        services.AddSingleton<TestDataService>();
        return services;
    }
}
