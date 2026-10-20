using System.Text.Json;
using Masar.Application.Abstractions;
using Masar.Application.Actions;
using Masar.Application.Ai;
using Masar.Application.Common;
using Masar.Application.Monitoring;
using Masar.Application.Simulation;
using Masar.Domain.Entities;
using Masar.Domain.Pathway;
using Masar.Domain.Rules;
using Microsoft.EntityFrameworkCore;

namespace Masar.Application.Cases;

/// <summary>
/// The case under the CAD number the crew entered manually: check, create, correct before SEND, discard an unsent case,
/// open an existing case, complete the pathway, and the test console's demo case and screen visibility.
/// One case per CAD number: a second case under the same number is never created and an existing case is never
/// overwritten (the crew is offered OPEN EXISTING CASE instead).
/// </summary>
public sealed class CaseService(
    CaseRecordBuilder records, ActionService actions, MonitorService monitor, AiAnalysisService ai, SimulationSettings simulation,
    ILiveNotifier live, TimeProvider time)
{
    /// <summary>How far an opening time from the tablet may lie in the past (24 h) or the future (60 s).</summary>
    private const long OpenedPastMs = 24 * 3600_000L, OpenedFutureMs = 60_000;
    private const int MaxCadHistory = 10;

    private IReadOnlyList<string>? _cadTables;

    private static Case? Row(IMasarDbContext db, string? cad) => string.IsNullOrEmpty(cad) ? null : db.Cases.FirstOrDefault(c => c.Cad == cad);

    public static CasePublicInfo Public(Case c) =>
        new(c.Cad, c.Active, c.ServerReceivedAt, c.Unit, c.PathwayOpenedAt ?? c.CreatedAt, c.ClosedAt);

    private static CaseCommandResult Invalid(CadCheckResult c) => new("invalid", c.Cad) { Error = c.Error, Detail = c.Detail };

    /// <summary>Is this CAD number valid, and is there already a case under it? (the tablet asks before sending)</summary>
    public CadCheckResponse Check(IMasarDbContext db, string? raw)
    {
        var c = CadNumber.Check(raw);
        if (!c.Ok) return new CadCheckResponse(false, c.Cad) { Error = c.Error, Detail = c.Detail };
        var existing = Row(db, c.Cad);
        return new CadCheckResponse(true, c.Cad) { Exists = existing is not null, Existing = existing is null ? null : Public(existing) };
    }

    /// <summary>
    /// Creates the case when the crew opens it. Body: cad, cid (the tablet's own id for the case, so a resent create is
    /// harmless), openedAt, hist (the CAD numbers typed before confirming, for the audit), link (link the unit's corpuls
    /// monitor at once), autoEcg. Status: created | same | exists | invalid.
    /// </summary>
    public CaseCommandResult Create(IMasarDbContext db, Actor actor, JsonData body, string source = "manual-crew")
    {
        var c = CadNumber.Check(body.Text("cad"));
        if (!c.Ok) return Invalid(c);
        var cad = c.Cad;
        var cidText = body.Truthy("cid") ? body.Text("cid") ?? string.Empty : string.Empty;
        var cid = cidText.Length == 0 ? null : cidText[..Math.Min(64, cidText.Length)];
        var rcv = time.NowMs();
        var link = body.Truthy("link");
        var autoEcg = body.Get("autoEcg") is not { ValueKind: JsonValueKind.False };
        if (Row(db, cad) is { } existing)
        {
            if (cid is not null && existing.CreatedCid == cid)
            {
                if (link && actor.Role == ActorRoles.Crew) monitor.Link(db, actor, cad, autoEcg: autoEcg);
                return new CaseCommandResult("same", cad);
            }
            return new CaseCommandResult("exists", cad) { Existing = Public(existing) };
        }
        var crew = actor.Role == ActorRoles.Crew ? actor : CrewUsers.First(db, actor.Device) ?? throw new InvalidOperationException("The crew test user is missing.");
        var me = crew.CrewTitle;
        long Plausible(double? t) => t is { } v && double.IsFinite(v) && v > rcv - OpenedPastMs && v <= rcv + OpenedFutureMs ? (long)v : rcv;
        var openedAt = Plausible(body.Number("openedAt"));
        var history = body.Array("hist").TakeLast(MaxCadHistory).Select(h => new JsonData(h))
            .Select(h => (V: CadNumber.Normalize(h.Text("v")), T: Plausible(h.Number("t")))).Where(h => h.V.Length > 0).ToList();
        var enteredAt = history.Count > 0 ? history[^1].T : openedAt;
        var how = source == "manual-crew"
            ? "CAD number manually entered by crew from dispatch/MDT information"
            : "CAD number entered in the test console (fictional demo case)";
        var w = new AuditWriter(db, cad, crew);
        db.InTransaction(() =>
        {
            db.Insert(new Case
            {
                Cad = cad, Active = true, Unit = crew.Unit ?? string.Empty, Emirate = crew.Emirate ?? string.Empty, CrewName = me, IncidentType = "STEMI pathway",
                CreatedAt = rcv, PathwayOpenedAt = openedAt, PathwayOpenedBy = me, CadSource = source, CadEnteredAt = enteredAt, CadEnteredBy = me, CreatedCid = cid,
            });
            w.By(openedAt, $"STEMI case opened by {me} ({crew.Unit}) — CAD #{cad} · {how}", me, "key");
            for (var i = 1; i < history.Count; i++)
                if (history[i].V != history[i - 1].V)
                    w.By(history[i].T, $"CAD number corrected by crew before sending: CAD #{history[i - 1].V} → CAD #{history[i].V} · nothing had been sent", me, "key");
            w.Sys(rcv, $"Case created on the platform under CAD #{cad} (CAD number checked: no existing case with this number)", "key");
            w.Flush();
        });
        // the crew's tablet links the case to the unit's corpuls monitor at once: from then on the ECGs and vital signs
        // acquired on corpuls attach to this CAD number (autoEcg false: the tablet already holds a fallback ECG, so the
        // simulated demo does not add an ECG 1 of its own)
        if (link) monitor.Link(db, crew, cad, autoEcg: autoEcg);
        live.CaseChanged(cad);
        return new CaseCommandResult("created", cad);
    }

    /// <summary>The tables that carry the CAD number (a correction before SEND moves everything of the case).</summary>
    private IReadOnlyList<string> CadTables(IMasarDbContext db) => _cadTables ??= db.Database
        .SqlQueryRaw<string>("SELECT name AS Value FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").ToList()
        .Where(table => db.Database.SqlQuery<string>($"SELECT name AS Value FROM pragma_table_info({table})").ToList().Contains("cad"))
        .ToList();

    /// <summary>
    /// The CAD number of an unsent case, corrected on the tablet: the case — with anything already received from corpuls —
    /// moves to the corrected number. Nothing had reached the ER, and an existing case is never touched.
    /// Status: corrected | same | exists | invalid | missing | sent.
    /// </summary>
    public CaseCommandResult Correct(IMasarDbContext db, Actor actor, JsonData body)
    {
        var from = CadNumber.Normalize(body.Text("cad"));
        var f = CaseFactsLoader.Load(db, from);
        if (f is null || f.Case.Unit != actor.Unit) return new CaseCommandResult("missing", from);
        // once the case reached the ER its CAD number is locked: the ER and the audit trail know it under that number
        if (f.State != PathwayStates.Draft) return new CaseCommandResult("sent", from) { Error = "The case was already sent: its CAD number is locked." };
        var c = CadNumber.Check(body.Text("to"));
        if (!c.Ok) return Invalid(c);
        var to = c.Cad;
        if (to == from) return new CaseCommandResult("same", to) { Rec = records.Build(db, to) };
        if (Row(db, to) is { } existing) return new CaseCommandResult("exists", to) { Existing = Public(existing) };
        var t = time.NowMs();
        var tables = CadTables(db);
        db.InTransaction(() =>
        {
            // the primary key changes in every table at once: foreign keys are checked at the commit
            db.Database.ExecuteSqlRaw("PRAGMA defer_foreign_keys = ON");
            foreach (var table in tables)
            {
                // Security: a table name cannot be a SQL parameter. These names come from the database's own catalogue
                // (sqlite_master), never from a request; the CAD numbers are parameters.
#pragma warning disable EF1002
                db.Database.ExecuteSqlRaw($"UPDATE \"{table.Replace("\"", "\"\"")}\" SET cad = {{0}} WHERE cad = {{1}}", to, from);
#pragma warning restore EF1002
            }
            var w = new AuditWriter(db, to, actor);
            w.By(t, $"CAD number corrected by crew before sending: CAD #{from} → CAD #{to} · nothing had been sent{(f.Case.CorpulsLinkedAt is not null ? " · the corpuls feed and what it sent move with the case" : string.Empty)}", actor.CrewTitle, "key");
            w.Flush();
        });
        monitor.Relink(from, to);
        ai.ResumeCase(db, to);
        live.CaseChanged(from);
        live.CaseChanged(to);
        return new CaseCommandResult("corrected", to) { Rec = records.Build(db, to) };
    }

    /// <summary>
    /// An unsent case discarded on the tablet: nothing reached the ER; the case stays stored as an unsent draft, its corpuls
    /// feed ends, and OPEN EXISTING CASE can take it up again. Status: discarded | missing | sent.
    /// </summary>
    public CaseCommandResult Discard(IMasarDbContext db, Actor actor, string? raw)
    {
        var cad = CadNumber.Normalize(raw);
        var f = CaseFactsLoader.Load(db, cad);
        if (f is null || f.Case.Unit != actor.Unit) return new CaseCommandResult("missing", cad);
        if (f.State != PathwayStates.Draft) return new CaseCommandResult("sent", cad);
        if (f.Case.DraftDiscardedAt is not null) return new CaseCommandResult("discarded", cad);
        var t = time.NowMs();
        var w = new AuditWriter(db, cad, actor);
        db.InTransaction(() =>
        {
            db.Cases.Where(c => c.Cad == cad).ExecuteUpdate(s => s.SetProperty(c => c.DraftDiscardedAt, t));
            w.By(t, $"Unsent case discarded on the {actor.Unit} tablet by {actor.CrewTitle} · nothing was sent to the ER · what was received from corpuls is kept", actor.CrewTitle, "key");
            w.Flush();
        });
        monitor.EndLink(db, cad, "unsent case discarded on the tablet");
        live.CaseChanged(cad);
        return new CaseCommandResult("discarded", cad);
    }

    /// <summary>CASE ALREADY EXISTS → OPEN EXISTING CASE: the existing case opens on the tablet; nothing is created. Status: opened | invalid | missing | other-unit.</summary>
    public CaseCommandResult OpenExisting(IMasarDbContext db, Actor actor, string? raw)
    {
        var c = CadNumber.Check(raw);
        if (!c.Ok) return Invalid(c);
        var f = CaseFactsLoader.Load(db, c.Cad);
        if (f is null) return new CaseCommandResult("missing", c.Cad);
        if (f.Case.Unit != actor.Unit) return new CaseCommandResult("other-unit", c.Cad);
        var t = time.NowMs();
        var w = new AuditWriter(db, c.Cad, actor);
        db.InTransaction(() =>
        {
            if (!f.Case.Active) db.Cases.Where(x => x.Cad == c.Cad).ExecuteUpdate(s => s.SetProperty(x => x.Active, true));
            if (f.Case.DraftDiscardedAt is not null) db.Cases.Where(x => x.Cad == c.Cad).ExecuteUpdate(s => s.SetProperty(x => x.DraftDiscardedAt, (long?)null));
            w.By(t, $"Existing case CAD #{c.Cad} opened on the {actor.Unit} tablet by {actor.CrewTitle} · the same CAD number was entered again; no second case created{(f.State == PathwayStates.Draft ? " · the unsent case is taken up again" : string.Empty)}", actor.CrewTitle, "key");
            w.Flush();
        });
        live.CaseChanged(c.Cad);
        return new CaseCommandResult("opened", c.Cad) { Rec = records.Build(db, c.Cad) };
    }

    /// <summary>
    /// TEST ONLY: the test console takes a case off every live screen, or returns it. Clinically nothing changes: the
    /// STEMI pathway is NOT closed (only COMPLETE STEMI PATHWAY, NOT STEMI or NOT SUSPICIOUS FOR STEMI close it).
    /// </summary>
    public bool SetOnScreens(IMasarDbContext db, Actor actor, string? raw, bool on)
    {
        var cad = CadNumber.Normalize(raw);
        var c = Row(db, cad);
        if (c is null) return false;
        if (c.Active == on) return true;
        var w = new AuditWriter(db, cad, actor);
        db.Cases.Where(x => x.Cad == cad).ExecuteUpdate(s => s.SetProperty(x => x.Active, on));
        w.By(time.NowMs(), on
            ? $"Case CAD #{cad} returned to the live screens from the test console"
            : $"Case CAD #{cad} taken off the live screens from the test console · kept in the database · the STEMI pathway is not closed", "Test console", "key");
        w.Flush();
        live.CaseChanged(cad);
        return true;
    }

    /// <summary>
    /// COMPLETE STEMI PATHWAY (crew): allowed only while the current Cardiologist decision is CONFIRMED STEMI. The case
    /// stays stored, moves to Completed and is read-only. The CAD incident itself is not changed (ICCC / ePCR own it).
    /// Status: completed | missing | closed | incomplete.
    /// </summary>
    public CaseCommandResult Complete(IMasarDbContext db, Actor actor, string? raw)
    {
        var cad = CadNumber.Normalize(raw);
        var f = CaseFactsLoader.Load(db, cad);
        if (f is null || f.Case.Unit != actor.Unit) return new CaseCommandResult("missing", cad);
        if (f.Case.ClosedAt is not null) return new CaseCommandResult("closed", cad) { Kind = PathwayClosure.KindOf(f.Case.ClosureReason) };
        if (f.State != PathwayStates.Confirmed)
            return new CaseCommandResult("incomplete", cad) { State = f.State, Error = "COMPLETE STEMI PATHWAY is available only while the current Cardiologist decision is CONFIRMED STEMI." };
        var t = time.NowMs();
        var me = actor.CrewTitle;
        var w = new AuditWriter(db, cad, actor);
        db.InTransaction(() =>
        {
            ActionService.MarkClosed(db, cad, t, me, actor.Id, PathwayClosure.Completed);
            w.By(t, $"STEMI pathway completed and closed by {me} ({f.Case.Unit}) — CAD #{cad} · read-only · the CAD incident itself is not changed", me, "key");
            w.Update(t, "closed", "STEMI PATHWAY COMPLETED", new { });
            w.Flush();
        });
        monitor.CloseIfNeeded(db, cad);
        live.CaseChanged(cad);
        return new CaseCommandResult("completed", cad);
    }

    /// <summary>
    /// TEST ONLY: a pre-filled fictional case for demonstrations. The tester types the CAD number (checked like the crew's
    /// entry; a duplicate is refused). The case then goes the way the crew's would: created, linked to a simulated corpuls
    /// monitor of its own (so a crew case in progress keeps the unit's monitor), ECG 1 acquired on it, the minimum data,
    /// SEND. The ER gets the normal NEW STEMI CASE alarm and the mock AI analyses ECG 1.
    /// Status: created | invalid | exists | error.
    /// </summary>
    public CaseCommandResult DemoCase(IMasarDbContext db, Actor actor, string? rawCad)
    {
        var crew = CrewUsers.First(db, actor.Device) ?? throw new InvalidOperationException("The crew test user is missing.");
        var now = time.NowMs();
        var r = Create(db, crew, new JsonData(JsonSerializer.SerializeToElement(new { cad = rawCad, openedAt = now - 5000 })), "manual-test-console");
        if (r.Status != "created") return r;
        var cad = r.Cad!;
        var digits = new string(cad.Where(char.IsAsciiDigit).ToArray());
        monitor.Link(db, crew, cad, deviceId: $"SIM-C3-DEMO-{digits[Math.Max(0, digits.Length - 5)..]}", autoEcg: false);
        var none = new Dictionary<string, string?>();
        monitor.Simulate(db, cad, "connect", new SimParams(null, null, none));
        var ecg = monitor.Simulate(db, cad, "trigger-ecg", new SimParams(simulation.Current().Find == "clear" ? "C" : "A", null, none));
        if (!ecg.Ok) return new CaseCommandResult("error", cad) { Error = ecg.Error.Or("The simulated ECG was not received.") };
        var t = time.NowMs();
        var mdT = t - 2000;
        var onset = t - 45 * 60_000;
        var md = new
        {
            age = new { v = "58 y", raw = new { v = 58, est = false }, t = mdT },
            sex = new { v = "Male", raw = new { v = "Male" }, t = mdT },
            complaint = new { v = "Chest pain", raw = new { k = "cp" }, t = mdT },
            onset = new { v = $"{TimeText.Hm(onset)} (approximate)", raw = new { t = onset, approx = true }, t = mdT },
        };
        var submit = JsonSerializer.SerializeToElement(new { id = $"demo-{cad}-submit", cad, k = "submit", t, data = new { sendAt = t, late = false, md } });
        actions.Apply(db, crew, [submit]);
        return r;
    }
}
