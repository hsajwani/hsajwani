using Masar.Application.Abstractions;
using Masar.Application.Cases;
using Masar.Application.Common;
using Masar.Application.Monitoring;
using Masar.Application.Simulation;
using Masar.Domain.Pathway;

namespace Masar.Api.Live;

/// <summary>
/// What the screens receive on the live link: the opening messages of a screen ("hello"), and the pushes after each
/// change. Runs under the PlatformGate, so every screen sees committed, consistent records.
/// </summary>
public sealed class LiveUpdates(LiveHub hub, CaseRecordBuilder records, SimulationSettings simulation, MonitorService monitor, TimeProvider time)
{
    /// <summary>The test console also gets the most recently closed cases.</summary>
    private const int ConsoleClosedCases = 12;

    /// <summary>
    /// What a screen gets when it connects: init (server time, data epoch, role), cfg (the test console's simulation
    /// choices), cases (every open case it may see), and for the test console the presence of the other screens.
    /// It also records which cases the screen holds.
    /// </summary>
    public void Hello(IMasarDbContext db, LiveClient client)
    {
        var actor = client.Actor;
        var at = time.NowMs();
        var cads = actor.Role == ActorRoles.Control
            ? db.Cases.Where(c => c.ClosedAt == null).Select(c => c.Cad).ToList()
                .Union(db.Cases.Where(c => c.ClosedAt != null).OrderByDescending(c => c.ClosedAt).Take(ConsoleClosedCases).Select(c => c.Cad).ToList())
                .Order(StringComparer.Ordinal).ToList()
            : db.Cases.Where(c => c.ClosedAt == null && c.Active).OrderBy(c => c.CreatedAt).Select(c => c.Cad).ToList();
        client.Cads.Clear();
        var list = new List<CaseRecord>();
        foreach (var cad in cads)
        {
            var f = CaseFactsLoader.Load(db, cad);
            if (f is null || !CaseVisibility.CanSee(actor.Role, actor.Unit, f)) continue;
            list.Add(records.Build(db, cad, f)!);
            client.Cads.Add(cad);
        }
        client.Send(hub.Format("init", new { now = at, epoch = simulation.Epoch(), role = actor.Role }));
        client.Send(hub.Format("cfg", new { sim = SimulationSettings.ToDto(simulation.Current()) }));
        client.Send(hub.Format("cases", new { list, at }));
        if (actor.Role == ActorRoles.Control) client.Send(hub.Format("presence", hub.Presence()));
    }

    /// <summary>Each changed case goes to every screen allowed to see it, and is withdrawn (rec: null) from a screen no longer allowed.</summary>
    public void PushCases(IMasarDbContext db, IEnumerable<string> cads)
    {
        foreach (var cad in cads)
        {
            var at = time.NowMs();
            var f = CaseFactsLoader.Load(db, cad);
            var rec = f is null ? null : records.Build(db, cad, f);
            string? update = null, withdrawn = null;
            foreach (var c in hub.Clients)
            {
                if (f is not null && CaseVisibility.CanSee(c.Actor.Role, c.Actor.Unit, f))
                {
                    c.Send(update ??= hub.Format("case", new { cad, rec, at }));
                    c.Cads.Add(cad);
                }
                else if (c.Cads.Remove(cad)) c.Send(withdrawn ??= hub.Format("case", new { cad, rec = (CaseRecord?)null, at }));
            }
        }
    }

    /// <summary>TEST ONLY: the test console follows the simulated corpuls monitors live.</summary>
    public void PushSimulator(IMasarDbContext db) => hub.Broadcast("corpuls", monitor.SimInfo(db), ActorRoles.Control);

    /// <summary>
    /// Runs at the end of every unit of work (registered with the PlatformGate at start): every case changed by it goes to
    /// the screens now, while the gate is still held — so the screens see committed, consistent records, and before the
    /// HTTP answer of the change leaves (as the screens expect).
    /// </summary>
    public void Flush(IMasarDbContext db)
    {
        // a push never changes data, but stay safe if something marks more work while flushing
        for (var round = 0; round < 3; round++)
        {
            var (cases, simulatorChanged, restartAll) = hub.TakeWork();
            if (cases.Count == 0 && !simulatorChanged && !restartAll) return;
            if (restartAll) RestartAll(db);
            PushCases(db, cases);
            if (simulatorChanged) PushSimulator(db);
        }
    }

    /// <summary>After the test data was reset: every screen starts afresh.</summary>
    public void RestartAll(IMasarDbContext db)
    {
        foreach (var c in hub.Clients) Hello(db, c);
    }
}
