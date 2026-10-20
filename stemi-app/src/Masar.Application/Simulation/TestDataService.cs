using Masar.Application.Abstractions;
using Masar.Application.Common;
using Masar.Application.Monitoring;
using Microsoft.EntityFrameworkCore;

namespace Masar.Application.Simulation;

/// <summary>
/// TEST ONLY: the test console's "delete all test data". Every test case, its record, audit and images are deleted;
/// the crew test user and the settings stay. Production must have no such function (retention is a governance decision,
/// see docs/security.md).
/// </summary>
public sealed class TestDataService(MonitorService monitor, IImageStore images, SimulationSettings simulation, ILiveNotifier live)
{
    /// <summary>Children first, cases last (foreign keys). Includes the tables kept only for older databases.</summary>
    public static readonly IReadOnlyList<string> CaseTables =
    [
        "final_vitals", "handovers", "arrivals", "ops", "audit_events", "case_updates", "etas", "destinations", "decisions", "ecg_views", "ecg_role_views",
        "alert_followups", "cardiologist_alerts", "ai_interpretations", "monitor_vitals", "monitor_events", "ecg_images", "ecgs", "treatments", "observations",
        "patient_details", "cases",
    ];

    public void ResetAll(IMasarDbContext db)
    {
        db.InTransaction(() =>
        {
            // Security: a table name cannot be a SQL parameter; these come from the fixed list above, never from a request.
#pragma warning disable EF1002
            foreach (var table in CaseTables) db.Database.ExecuteSqlRaw($"DELETE FROM \"{table}\"");
#pragma warning restore EF1002
        });
        monitor.Reset();
        images.DeleteAll();
        simulation.BumpEpoch();
        live.RestartAllScreens();
    }
}
