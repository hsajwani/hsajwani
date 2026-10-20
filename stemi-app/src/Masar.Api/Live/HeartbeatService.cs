using Masar.Api.Configuration;
using Masar.Application.Common;
using Microsoft.Extensions.Options;

namespace Masar.Api.Live;

/// <summary>
/// The live link's heartbeat ("hb"): a technical signal that lets every screen prove it is current. It is never written
/// to the audit trail (technical heartbeats would bury the clinical events).
/// </summary>
public sealed class HeartbeatService(LiveHub hub, IOptions<LiveOptions> options, TimeProvider time) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(Math.Max(100, options.Value.HeartbeatMs)), time);
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken)) hub.Broadcast("hb", new { at = time.NowMs() });
        }
        catch (OperationCanceledException)
        {
            // stopping
        }
    }
}
