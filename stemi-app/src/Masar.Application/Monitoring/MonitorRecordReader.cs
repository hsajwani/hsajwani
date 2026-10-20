using Masar.Application.Abstractions;
using Masar.Application.Common;
using Masar.Domain.Entities;

namespace Masar.Application.Monitoring;

/// <summary>Reads the corpuls feed of a case in the shape the screens use (see <see cref="MonitorRecord"/>).</summary>
public sealed class MonitorRecordReader(ICorpulsProvider provider)
{
    /// <summary>Null when the case was never linked to a monitor and has no monitor values.</summary>
    public MonitorRecord? Read(IMasarDbContext db, Case c)
    {
        if (c.CorpulsLinkedAt is null && c.VitalsJson is null) return null;
        var name = c.CorpulsProvider ?? provider.Name;
        var simulated = name == MockProviderName;
        var history = db.MonitorVitals.Where(v => v.Cad == c.Cad).OrderByDescending(v => v.At).ThenByDescending(v => v.Id).Take(12)
            .Select(v => new MonitorSample(v.At, v.Hr, v.Spo2, v.BpSys, v.BpDia, v.BpAt, v.Rr, v.Source, v.Why)).ToList();
        var log = db.MonitorEvents.Where(e => e.Cad == c.Cad).OrderBy(e => e.At).ThenBy(e => e.Id)
            .Select(e => new MonitorLogEntry(e.At, e.Kind, e.Text)).ToList();
        return new MonitorRecord(name, simulated, simulated && provider.DemoMode, c.CorpulsDeviceId, c.CorpulsDeviceLabel, c.CorpulsLinkedAt,
            c.CorpulsLinkedBy, c.CorpulsStatus, c.CorpulsStatusAt, c.CorpulsLinkEndedAt, c.CorpulsLinkEndReason, c.CorpulsLastDataAt,
            provider.ExpectedIntervalMs, JsonData.Parse(c.VitalsJson), history, log);
    }

    /// <summary>The name of the simulated provider (MockCorpulsProvider).</summary>
    public const string MockProviderName = "mock";
}
