using System.Text.Json.Nodes;
using Masar.Application.Abstractions;
using Masar.Application.Common;
using Masar.Application.Monitoring;
using Masar.Domain.Pathway;
using Microsoft.EntityFrameworkCore;

namespace Masar.Application.Cases;

/// <summary>Builds the shared case record (<see cref="CaseRecord"/>) of one CAD number from the database.</summary>
public sealed class CaseRecordBuilder(MonitorRecordReader monitors)
{
    /// <summary>Text shown for cases made before 0.5.0, which went straight to the cardiologist.</summary>
    public const string LegacyActivationReason = "Sent directly to the cardiologist (case made before ER review was introduced)";

    public CaseRecord? Build(IMasarDbContext db, string? cad, CaseFacts? facts = null)
    {
        var f = facts ?? CaseFactsLoader.Load(db, cad);
        if (f is null) return null;
        var c = f.Case;
        var a = f.Alert;
        cad = c.Cad;

        var pt = new Dictionary<string, List<MinimumDataValue>>();
        foreach (var r in MinimumDataReader.All(db, cad))
        {
            if (!pt.TryGetValue(r.Field, out var list)) pt[r.Field] = list = [];
            list.Add(new MinimumDataValue(r.Id, r.ValueText, JsonData.Parse(r.RawJson), r.TakenAt, r.ReceivedAt, r.EnteredBy, r.EntryKind, r.Reason ?? string.Empty));
        }

        var rec = new Dictionary<string, TreatmentItem>();
        foreach (var r in db.Treatments.FromSql($"SELECT * FROM treatments WHERE cad = {cad} ORDER BY received_at, rowid").AsEnumerable())
        {
            if (!rec.TryGetValue(r.ItemKey, out var item)) rec[r.ItemKey] = item = new TreatmentItem(r.Label, r.Category, []);
            item.Vers.Add(new TreatmentVersion(r.Id, r.ValueText, r.NotObtained, r.TakenAt, r.ReceivedAt, r.EnteredBy, r.EntryKind));
        }

        var ai = db.AiInterpretations.Where(x => x.Cad == cad).ToList().ToDictionary(x => x.EcgN, x =>
        {
            var o = new JsonObject { ["st"] = x.Status, ["start"] = x.StartedAt };
            if (x.Status != "proc")
            {
                o["done"] = x.CompletedAt;
                if (JsonData.Parse(x.ResultJson) is JsonObject result)
                    foreach (var (k, v) in result) o[k] = v?.DeepClone();
            }
            return o;
        });
        var images = db.EcgImages.Where(x => x.Cad == cad && x.EcgN != null).OrderBy(x => x.EcgN).ThenBy(x => x.I).ToList()
            .GroupBy(x => x.EcgN!.Value).ToDictionary(g => g.Key, g => g.Select(x =>
                new EcgImageRecord(x.I, x.Kind, x.Quality, x.CapturedAt, x.ReceivedAt, x.AddedAfterSend, x.Source, $"/files/{x.Id}")).ToList());
        var ecgs = db.Ecgs.Where(e => e.Cad == cad).OrderBy(e => e.N).ToList().Select(e => new EcgRecord(
            e.N, e.AcquiredAt, e.Variant, e.PrimaryImage, e.SameAsPrevious, e.SentAt, e.ReceivedAt, e.SentBy, e.TimeReason ?? string.Empty,
            images.GetValueOrDefault(e.N) ?? [], ai.GetValueOrDefault(e.N), e.Source.OrNull(), e.DeviceId.OrNull(), e.SourceSeq is > 0 ? e.SourceSeq : null,
            e.TransmittedAt is > 0 ? e.TransmittedAt : null)).ToList();

        var views = new Dictionary<string, Dictionary<string, long>> { [ActorRoles.Er] = [], [ActorRoles.Cardiologist] = [] };
        foreach (var v in db.EcgRoleViews.Where(v => v.Cad == cad).ToList())
        {
            if (!views.TryGetValue(v.Role, out var byRole)) views[v.Role] = byRole = [];
            byRole[$"{v.EcgN}|{v.I}"] = v.ViewedAt;
        }
        // first views recorded by 0.4.0 and earlier (cardiologist only)
        foreach (var v in db.EcgViews.Where(v => v.Cad == cad).ToList())
            views[ActorRoles.Cardiologist].TryAdd($"{v.EcgN}|{v.I}", v.ViewedAt);

        var decisions = db.Decisions.FromSql($"SELECT * FROM decisions WHERE cad = {cad} ORDER BY decided_at, rowid").AsEnumerable().Select(x => new DecisionRecord(
            x.Id, x.Kind, x.DecidedAt, x.ReceivedAt, x.DecidedBy, x.DecidedByTitle, x.OnEcg, JsonData.Parse(x.AlsoJson) ?? new JsonArray(),
            x.Reason ?? string.Empty, x.Note ?? string.Empty, x.Advice ?? string.Empty, JsonData.Parse(x.ReasonsJson) ?? new JsonArray(),
            x.Instruction ?? string.Empty, x.WithinMin, x.AiFeedback, x.DeliveredAt, x.CrewAckAt)).ToList();
        var updates = db.CaseUpdates.FromSql($"SELECT * FROM case_updates WHERE cad = {cad} ORDER BY at, rowid").AsEnumerable()
            .Select(u => new UpdateRecord(u.Id, u.At, u.Kind, u.Text, JsonData.Parse(u.RefJson) ?? new JsonObject())).ToList();
        var audit = db.AuditEvents.Where(x => x.Cad == cad).OrderBy(x => x.At).ThenBy(x => x.Id).ToList()
            .Select((x, i) => new AuditLine(x.At, x.Action, x.Actor ?? string.Empty, x.Role ?? string.Empty, x.Kind, i)).ToList();

        return new CaseRecord(
            cad, c.Unit, c.Emirate, c.CrewName, f.State, f.Legacy, c.Active, c.CreatedAt,
            new CadEntryInfo(c.CadSource.Or("simulated-feed"), c.CadEnteredAt, c.CadEnteredBy),
            new PathwayOpening(c.PathwayOpenedAt ?? c.CreatedAt, c.PathwayOpenedBy.Or(c.CrewName)),
            c.ServerReceivedAt is { } received ? new SubmissionInfo(c.SubmittedAt, received, c.DeliveredLate) : null,
            new ErReview(c.ErAlertedAt, c.ErAlertShownAt, c.ErDoctorName.OrNull(), c.ErAcceptedAt, c.ErAssessment.OrNull(), c.ErAssessmentAt,
                c.ErAssessedBy.OrNull(), c.ErAssessmentEcg is > 0 ? c.ErAssessmentEcg : null, c.ErNonActivationReason.OrNull(),
                c.ErNonActivationComment.OrNull(), c.ErOutcomeSeenAt),
            new CardiologyInfo(f.Activated, c.CardiologyActivatedBy.OrNull(),
                c.CardiologyActivationReason.OrNull() ?? (f.Legacy ? LegacyActivationReason : null),
                a?.AlertedAt, a?.ShownAt, f.Acknowledged,
                c.CardiologistName.OrNull() ?? (f.Legacy ? a?.AcknowledgedBy.OrNull() : null),
                c.OpenedAt, f.LastDecision?.Kind, f.LastDecision?.DecidedAt),
            pt, rec, ecgs, decisions, updates, audit, views, c.HandoverOpenedAt, c.DraftDiscardedAt,
            c.ClosedAt is { } closedAt
                ? new ClosureInfo(closedAt, c.ClosedBy, c.ClosureReason.Or(PathwayClosure.Completed.Reason), c.ClosureSource.Or(PathwayClosure.Completed.Source), PathwayClosure.KindOf(c.ClosureReason))
                : null,
            monitors.Read(db, c));
    }
}
