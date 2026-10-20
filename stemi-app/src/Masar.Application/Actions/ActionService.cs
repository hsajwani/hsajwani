using System.Text.Json;
using System.Text.RegularExpressions;
using Masar.Application.Abstractions;
using Masar.Application.Ai;
using Masar.Application.Cases;
using Masar.Application.Common;
using Masar.Application.Monitoring;
using Masar.Domain.Entities;
using Masar.Domain.Pathway;
using Masar.Domain.Rules;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Masar.Application.Actions;

/// <summary>
/// Applies the actions the screens send (POST /api/ops), in order. Each action is stored once (its id makes a resend
/// after a reconnection harmless), checked against the pathway state machine (<see cref="PathwayStateMachine.Guard"/>)
/// before anything is written, written in one transaction with its audit entries, and the changed case is pushed to
/// the screens. Nothing here decides anything clinical: every clinical step is a person's action.
/// The audit texts are part of the record and are kept word for word from the prototype (docs/clinical-workflow.md).
/// </summary>
public sealed partial class ActionService(MonitorService monitor, AiAnalysisService ai, ILiveNotifier live, TimeProvider time, ILogger<ActionService> log)
{
    /// <summary>How long a device time may lie in the past (48 h) or the future (60 s) before the server's time is used instead.</summary>
    private const long DevicePastMs = 48 * 3600_000L, DeviceFutureMs = 60_000;
    /// <summary>A crew entry received this much later than it was saved was saved offline: the audit keeps both times.</summary>
    private const long OfflineAfterMs = 5000;

    private static readonly Dictionary<string, string> SourceText = new()
    {
        [EcgSources.Corpuls] = "corpuls", [EcgSources.ManualFallback] = "manual fallback", [EcgSources.Test] = "test",
    };

    /// <summary>The handler of one action: false when the action is not one of this screen's.</summary>
    private delegate bool Handler(OpContext o);

    /// <summary>Everything one action needs. T: the device time (made plausible); Rcv: when the server received it.</summary>
    private sealed record OpContext(IMasarDbContext Db, Actor A, string Id, string Kind, long T, JsonData D, CaseFacts F, long Rcv, AuditWriter W)
    {
        public Case C => F.Case;
        public string Cad => F.Case.Cad;
    }

    public List<OpResult> Apply(IMasarDbContext db, Actor actor, IReadOnlyList<JsonElement> ops)
    {
        var results = new List<OpResult>();
        var touched = new List<string>();
        foreach (var raw in ops)
        {
            var op = new JsonData(raw);
            var id = op.Str("id");
            var kind = op.Str("k");
            if (!op.IsObject || id is null || kind is null || id.Length > 80)
            {
                results.Add(new OpResult(op.Get("id") is { } rawId ? (object)rawId.Clone() : null, false) { Error = "This action could not be read.", Status = 400 });
                continue;
            }
            var cad = CadNumber.Normalize(op.Text("cad"));
            var f = CaseFactsLoader.Load(db, cad);
            if (f is null || (actor.Role == ActorRoles.Crew && f.Case.Unit != actor.Unit))
            {
                results.Add(new OpResult(id, false) { Error = "There is no case with this CAD number for this screen.", Status = 404 });
                continue;
            }
            if (db.Ops.FirstOrDefault(x => x.OpId == id) is { } seen)
            {
                results.Add(new OpResult(id, true) { Dup = true, Rcv = seen.ReceivedAt });
                continue;
            }
            if (PathwayStateMachine.Guard(actor.Role, kind, f) is { } refused)
            {
                results.Add(new OpResult(id, false) { Error = refused, Status = 409 });
                continue;
            }
            var rcv = time.NowMs();
            var t = Sane(op.Number("t"), rcv);
            var w = new AuditWriter(db, cad, actor);
            try
            {
                db.InTransaction(() =>
                {
                    db.Insert(new Op
                    {
                        OpId = id, Cad = cad, UserId = actor.Id ?? actor.Device, Role = actor.Role, Kind = kind, DeviceTime = t, ReceivedAt = rcv,
                        PayloadJson = op.Obj("data").IsObject ? op.RawText("data") : "{}",
                    });
                    var context = new OpContext(db, actor, id, kind, t, op.Obj("data"), f, rcv, w);
                    Handler? handler = actor.Role switch { ActorRoles.Crew => CrewAction, ActorRoles.Er => ErAction, ActorRoles.Cardiologist => CardiologistAction, _ => null };
                    if (handler is null || !handler(context)) throw new ActionException(403, $"\"{kind}\" is not an action for the {actor.Role} screen.");
                    // an entry saved on the tablet while it was offline keeps both times: when it was saved and when it was received
                    var me = actor.Role == ActorRoles.Crew ? actor.CrewTitle : null;
                    w.Flush(me is not null && rcv - t > OfflineAfterMs
                        ? e => { if (e.Who == me) e.Text += e.At == rcv ? $" · saved on the tablet {TimeText.Hms(t)}, received on reconnection" : $" · received {TimeText.Hms(rcv)}, on reconnection"; }
                        : null);
                });
                results.Add(new OpResult(id, true) { Rcv = rcv });
                if (!touched.Contains(cad)) touched.Add(cad);
            }
            catch (ActionException e)
            {
                results.Add(new OpResult(id, false) { Error = e.Message, Status = e.Status });
            }
            catch (Exception e)
            {
                log.LogError(e, "Action {ActionKind} on case {Cad} could not be stored", kind, cad);
                results.Add(new OpResult(id, false) { Error = "The server could not store this action.", Status = 500 });
            }
        }
        foreach (var cad in touched)
        {
            monitor.CloseIfNeeded(db, cad);
            live.CaseChanged(cad);
        }
        return results;
    }

    /// <summary>A time from a device: kept when plausible (within the last 48 hours, not in the future), otherwise the server's.</summary>
    public static long Sane(double? t, long rcv) => t is { } v && double.IsFinite(v) && v > rcv - DevicePastMs && v <= rcv + DeviceFutureMs ? (long)v : rcv;

    private static string NeedName(string? raw)
    {
        var r = ClinicianName.Clean(raw);
        if (!r.Ok) throw new ActionException(400, r.Error!);
        return r.Name;
    }

    private static string OptName(string? raw) => ClinicianName.Clean(raw) is { Ok: true } r ? r.Name : string.Empty;

    /// <summary>A clinical step names the ECG it covers; a newer ECG that arrived meanwhile must be reviewed first.</summary>
    private static int NeedLatest(CaseFacts f, int? on)
    {
        if (on is null) throw new ActionException(400, "The decision must name the ECG it covers.");
        if (on != f.EcgCount) throw new ActionException(409, $"ECG {f.EcgCount} has arrived since this screen was updated. Review ECG {f.EcgCount} before recording this.");
        return on.Value;
    }

    /// <summary>
    /// The ER assessment and the Cardiologist decision cover the latest ECG, so the clinician must have opened it: a
    /// screen records each first view of an ECG image (action "viewed"). The screens apply the same rule; the server
    /// enforces it, so no screen or client can record a decision on an ECG that was never opened. Views recorded by
    /// 0.4.0 and earlier (ecg_views, Cardiologist only) count too.
    /// </summary>
    private static void NeedViewed(OpContext o, int ecg, string message)
    {
        var role = o.A.Role;
        var viewed = o.Db.EcgRoleViews.Any(v => v.Cad == o.Cad && v.Role == role && v.EcgN == ecg)
            || (role == ActorRoles.Cardiologist && o.Db.EcgViews.Any(v => v.Cad == o.Cad && v.EcgN == ecg));
        if (!viewed) throw new ActionException(409, message);
    }

    /// <summary>One of the four minimum-data items in the SEND action, or null when the crew gave no answer.</summary>
    private static MinimumDataRules.Answer? SentAnswer(JsonData md, string field)
    {
        var item = md.Obj(field);
        if (!item.IsObject || string.IsNullOrEmpty(item.Text("v"))) return null;
        var raw = item.Obj("raw");
        return new MinimumDataRules.Answer(raw.Truthy("nv"), raw.Number("v"), raw.Str("k"), raw.Text("other"), raw.Number("t"));
    }

    /// <summary>Closes the STEMI pathway (never the operational CAD incident: ICCC and the ePCR own that). Read-only from then on.</summary>
    public static void MarkClosed(IMasarDbContext db, string cad, long t, string by, string? userId, PathwayClosure why) =>
        db.Cases.Where(c => c.Cad == cad).ExecuteUpdate(s => s
            .SetProperty(c => c.Status, "closed").SetProperty(c => c.ClosedAt, t).SetProperty(c => c.ClosedBy, by).SetProperty(c => c.ClosedUserId, userId)
            .SetProperty(c => c.ClosureReason, why.Reason).SetProperty(c => c.ClosureSource, why.Source));

    // ---------- storing ECGs, images and the minimum data ----------

    /// <summary>An ECG uploaded by the crew: the manual fallback (the normal ECG arrives from corpuls).</summary>
    private static void InsertEcg(OpContext o, JsonData e, int n, double? sendAt, string by)
    {
        var variant = e.Truthy("variant") ? e.Text("variant") : null;
        o.Db.Insert(new Ecg
        {
            Cad = o.Cad, N = n, AcquiredAt = Sane(e.Number("acq"), o.Rcv), SentAt = Sane(sendAt, o.Rcv), ReceivedAt = o.Rcv, PrimaryImage = e.Int("pri") ?? 1,
            Variant = variant is null ? null : variant[..Math.Min(20, variant.Length)], SameAsPrevious = e.Truthy("same"), SentBy = by,
            TimeReason = e.Truthy("timeWhy") ? TextRules.Clean(e.Text("timeWhy"), 200) : null, OpId = o.Id, Source = EcgSources.ManualFallback,
        });
        LinkImages(o, n, e.Array("imgs"), after: false);
    }

    /// <summary>Images are uploaded before the action that sends them; the action links them to their ECG.</summary>
    private static void LinkImages(OpContext o, int n, IEnumerable<JsonElement> images, bool after)
    {
        foreach (var raw in images)
        {
            var x = new JsonData(raw);
            var imageId = x.Text("imageId");
            if (string.IsNullOrEmpty(imageId) || !o.Db.EcgImages.Any(i => i.Id == imageId && i.Cad == o.Cad))
                throw new ActionException(409, $"Image {(x.Get("i") is { } i ? JsonData.JsString(i) : raw.ValueKind == JsonValueKind.Null ? "null" : "undefined")} of ECG {n} was not found on the server");
            var number = x.Int("i");
            var captured = Sane(x.Number("at"), o.Rcv);
            var kind = x.Text("kind").Or("full");
            var quality = x.Text("q").Or("good");
            o.Db.EcgImages.Where(i => i.Id == imageId).ExecuteUpdate(s => s
                .SetProperty(i => i.EcgN, n).SetProperty(i => i.I, number).SetProperty(i => i.CapturedAt, captured).SetProperty(i => i.Kind, kind)
                .SetProperty(i => i.Quality, quality).SetProperty(i => i.ReceivedAt, o.Rcv).SetProperty(i => i.AddedAfterSend, after).SetProperty(i => i.OpId, o.Id));
        }
    }

    private static void InsertMinimumData(OpContext o, string field, string? value, string? rawJson, double? takenAt, string entryKind, string reason)
    {
        var v = value ?? string.Empty;
        MinimumDataEntry entry = MinimumDataFields.IsPatientField(field) ? new PatientDetail() : new Observation();
        entry.Id = Ids.New("v");
        entry.Cad = o.Cad;
        entry.Field = field;
        entry.ValueText = v[..Math.Min(120, v.Length)];
        entry.RawJson = rawJson;
        entry.TakenAt = Sane(takenAt, o.Rcv);
        entry.ReceivedAt = o.Rcv;
        entry.EnteredBy = o.A.CrewTitle;
        entry.EntryKind = entryKind;
        entry.Reason = reason;
        entry.OpId = o.Id;
        o.Db.Insert(entry);
    }

    private static string EcgList(IMasarDbContext db, string cad) => string.Join(", ", db.Ecgs.Where(e => e.Cad == cad).OrderBy(e => e.N).Select(e => new { e.N, e.Source }).ToList()
        .Select(e => $"ECG {e.N}{(e.Source is not null && SourceText.TryGetValue(e.Source, out var s) ? $" ({s})" : string.Empty)}"));

    private static string Images(int count) => $"{count} image{(count > 1 ? "s" : string.Empty)}";

    // ---------- actions from the crew MDT ----------

    private bool CrewAction(OpContext o)
    {
        var d = o.D;
        var me = o.A.CrewTitle;
        var unit = o.C.Unit;
        switch (o.Kind)
        {
            case "open": // the pathway opening is recorded when the case is created; kept for tablets of 0.4
                return true;
            case "submit":
            {
                if (o.C.ServerReceivedAt is not null) return true; // already received: a resend changes nothing
                // the ECG normally arrived from corpuls already; an ECG in the action is the crew's manual fallback
                var ecg = d.Obj("ecg");
                var e = ecg.IsObject && ecg.Array("imgs").Any() ? ecg : (JsonData?)null;
                if (e is null && o.F.EcgCount == 0)
                    throw new ActionException(400, "An ECG is needed to send the case: wait for the ECG from corpuls, or use the manual ECG fallback.");
                // the case reaches the ER only with the crew's four items (Unknown is an answer)
                var sentMd = d.Obj("md");
                if (MinimumDataRules.CheckForSend(SentAnswer(sentMd, "age"), SentAnswer(sentMd, "sex"), SentAnswer(sentMd, "complaint"), SentAnswer(sentMd, "onset"), o.Rcv) is { } missing)
                    throw new ActionException(400, missing);
                var n = o.F.EcgCount + 1;
                var sendAt = d.Number("sendAt");
                var sent = Sane(sendAt, o.Rcv);
                if (e is { } fallback) InsertEcg(o, fallback, n, sendAt, me);
                var late = d.Truthy("late");
                o.Db.Cases.Where(c => c.Cad == o.Cad).ExecuteUpdate(s => s
                    .SetProperty(c => c.SubmittedAt, sent).SetProperty(c => c.ServerReceivedAt, o.Rcv).SetProperty(c => c.DeliveredLate, late)
                    .SetProperty(c => c.ErAlertedAt, o.Rcv).SetProperty(c => c.DraftDiscardedAt, (long?)null));
                // vital signs in the minimum data are the crew's manual fallback (corpuls had none); the rest is the crew's own
                var md = d.Obj("md");
                if (md.IsObject)
                    foreach (var p in md.Raw.EnumerateObject())
                    {
                        var v = new JsonData(p.Value);
                        if (!MinimumDataFields.Labels.ContainsKey(p.Name) || !JsonData.IsTruthy(p.Value)) continue;
                        InsertMinimumData(o, p.Name, v.Text("v"), v.RawText("raw"), v.Number("t"),
                            v.Truthy("fb") && MinimumDataFields.VitalSigns.Contains(p.Name) ? "fallback" : "sent", string.Empty);
                    }
                if (e is { } f2)
                {
                    var count = f2.Array("imgs").Count();
                    o.W.By(Sane(f2.Number("acq"), o.Rcv), $"ECG {n} acquired · manual ECG fallback{(count > 1 ? $" · {count} images" : string.Empty)}", me, "key");
                    o.W.By(sent, $"Manual ECG fallback used: ECG {n} ({Images(count)}) uploaded by the crew", me, "key");
                    MonitorService.FallbackUsed(o.Db, o.Cad, o.Rcv, n);
                }
                o.W.By(sent, $"Case sent to the ER by {unit}: {EcgList(o.Db, o.Cad)}, the latest monitor values and the minimum data", me, "key");
                o.W.Sys(o.Rcv, $"Server received the case{(e is not null ? $" and ECG {n} (images stored, checksums recorded)" : string.Empty)}{(late ? " · delivered after a failed first attempt" : string.Empty)}", "key");
                monitor.AtSend(o.Db, o.C, o.Rcv, o.W);
                o.W.Sys(o.Rcv, "ER alerted: NEW STEMI CASE awaiting ER Doctor acceptance · the Cardiologist is not alerted at this stage", "key");
                if (e is not null) ai.Schedule(o.Cad, n);
                return true;
            }
            case "ecg": // the manual ECG fallback after SEND (the normal serial ECG arrives from corpuls)
            {
                var e = d.Obj("ecg");
                var requested = e.IsObject ? e.Int("n") : null;
                if (requested is null) throw new ActionException(400, "This ECG could not be read.");
                var count = o.F.EcgCount;
                if (requested > count + 1)
                    throw new ActionException(409, $"The case has {count} ECG{(count == 1 ? string.Empty : "s")}: the next ECG is ECG {count + 1}, not ECG {requested}.");
                var images = e.Array("imgs").Count();
                if (!e.IsArray("imgs") || images == 0) throw new ActionException(400, $"ECG {requested} needs at least one image.");
                // an ECG from corpuls may have taken the number meanwhile: the fallback ECG becomes the next one, nothing is replaced
                var n = count + 1;
                var sendAt = d.Number("sendAt");
                InsertEcg(o, e, n, sendAt, me);
                o.W.By(Sane(e.Number("acq"), o.Rcv), $"ECG {n} acquired · manual ECG fallback{(images > 1 ? $" · {images} images" : string.Empty)}{(n != requested ? $" · stored as ECG {n} (ECG {requested} had arrived from corpuls meanwhile)" : string.Empty)}", me, "key");
                o.W.By(Sane(sendAt, o.Rcv), $"Manual ECG fallback used: ECG {n} ({Images(images)}) uploaded by {unit}{(o.F.State == PathwayStates.RepeatRequested ? " · repeat ECG as requested by the Cardiologist" : string.Empty)}", me, "key");
                o.W.Sys(o.Rcv, $"ECG {n} received · {(o.F.Activated is not null ? "the ER and the Cardiologist screens were" : "the ER screen was")} updated silently (no alarm)", "key");
                o.W.Update(o.Rcv, "ecg", $"ECG {n} received", new { n });
                MonitorService.FallbackUsed(o.Db, o.Cad, o.Rcv, n);
                ai.Schedule(o.Cad, n);
                return true;
            }
            case "img":
            {
                var x = d.Obj("img");
                var n = d.Int("n");
                var i = x.IsObject ? x.Int("i") : null;
                if (!x.IsObject || n is null || i is null) throw new ActionException(400, "This image could not be read.");
                var target = o.Db.Ecgs.FirstOrDefault(e => e.Cad == o.Cad && e.N == n);
                if (target is null) throw new ActionException(409, $"ECG {n} is not on the server.");
                if (target.Source == EcgSources.Corpuls) throw new ActionException(409, $"ECG {n} came from corpuls: a photo is added as a new ECG with the manual ECG fallback.");
                if (o.Db.EcgImages.FirstOrDefault(m => m.Cad == o.Cad && m.EcgN == n && m.I == i) is { } existing)
                {
                    if (existing.Id == x.Text("imageId")) return true;
                    throw new ActionException(409, $"ECG {n} already has an Image {i}. Nothing is replaced: add it again as a new image.");
                }
                LinkImages(o, n.Value, [x.Raw], after: true);
                o.W.By(o.Rcv, $"Image {i} added to ECG {n} by {unit} · an additional image of the same ECG, not a new ECG", me, "key");
                o.W.Update(o.Rcv, "img", $"Additional image added to ECG {n} (Image {i})", new { n, i });
                return true;
            }
            case "md":
            {
                var field = d.Str("k");
                if (field is null || !MinimumDataFields.Labels.TryGetValue(field, out var label)) throw new ActionException(400, "Unknown field.");
                var kind = d.Str("kind") is "update" or "correct" or "clarify" or "fallback" ? d.Str("kind")! : "update";
                var previous = MinimumDataReader.Latest(o.Db, o.Cad, field);
                var why = TextRules.Clean(d.Text("why"), 200);
                var v = TextRules.Clean(d.Text("v"), 120);
                if (v.Length == 0) throw new ActionException(400, $"{label}: no value.");
                InsertMinimumData(o, field, v, d.RawText("raw"), d.Truthy("at") ? d.Number("at") : o.T, kind, why);
                o.W.By(o.Rcv, kind switch
                {
                    "correct" => $"{label} corrected by crew: {previous?.ValueText ?? "–"} → {v} · the previous value is kept{(why.Length > 0 ? " · reason: " + why : string.Empty)}",
                    "fallback" => $"{label} entered by crew (manual fallback, corpuls data unavailable): {v}",
                    _ => $"{label} updated by crew: {v}{(previous is not null ? $" · previous {previous.ValueText} ({TimeText.Hm(previous.TakenAt ?? 0)}) kept" : string.Empty)}",
                }, me, "key");
                o.W.Update(o.Rcv, "md", kind == "correct" ? $"{label} corrected to {v}" : $"{label} {v}{(kind == "fallback" ? " (entered by the crew)" : string.Empty)}", new { k = field, corr = kind == "correct" });
                return true;
            }
            case "rec": // a treatment update: shown silently to the ER and the Cardiologist
            {
                var label = TextRules.Clean(d.Text("label"), 60);
                var v = TextRules.Clean(d.Text("v"), 300);
                var key = NotKeyCharacters().Replace(d.Truthy("k") ? d.Text("k") ?? string.Empty : "otx", string.Empty);
                key = key.Length == 0 ? "otx" : key[..Math.Min(24, key.Length)];
                if (label.Length == 0 || v.Length == 0) throw new ActionException(400, "A treatment update needs a treatment and what was done.");
                o.Db.Insert(new Treatment
                {
                    Id = Ids.New("v"), Cad = o.Cad, ItemKey = key, Label = label, Category = "Treatments given", ValueText = v, NotObtained = false,
                    TakenAt = Sane(d.Number("at"), o.T), ReceivedAt = o.Rcv, EnteredBy = me, EntryKind = "new", OpId = o.Id,
                });
                o.W.By(o.Rcv, $"Treatment update by crew — {label}: {v}", me, "key");
                o.W.Update(o.Rcv, "rec", $"{label}: {v}", new { k = key });
                return true;
            }
            case "hopen": // the Case Summary was opened (recorded once)
                if (o.C.HandoverOpenedAt is null)
                {
                    o.Db.Cases.Where(c => c.Cad == o.Cad).ExecuteUpdate(s => s.SetProperty(c => c.HandoverOpenedAt, o.T));
                    o.W.By(o.T, $"Case Summary opened by {me}", me, "view");
                }
                return true;
            case "decrcv":
            {
                var decisionId = d.Text("id");
                var x = o.Db.Decisions.FirstOrDefault(r => r.Id == decisionId && r.Cad == o.Cad);
                if (x is { DeliveredAt: null })
                {
                    o.Db.Decisions.Where(r => r.Id == x.Id).ExecuteUpdate(s => s.SetProperty(r => r.DeliveredAt, o.Rcv));
                    o.W.Sys(o.Rcv, $"Cardiologist decision ({CardiologistDecisions.Labels.GetValueOrDefault(x.Kind)}) shown on the {unit} tablet", "key");
                }
                return true;
            }
            case "decack":
            {
                var decisionId = d.Text("id");
                var x = o.Db.Decisions.FirstOrDefault(r => r.Id == decisionId && r.Cad == o.Cad);
                if (x is { CrewAckAt: null })
                {
                    o.Db.Decisions.Where(r => r.Id == x.Id).ExecuteUpdate(s => s.SetProperty(r => r.CrewAckAt, o.T));
                    o.W.By(o.T, $"Crew acknowledged the Cardiologist decision: {CardiologistDecisions.Labels.GetValueOrDefault(x.Kind)}", me, "key");
                }
                return true;
            }
            case "erack":
                if (o.C.ErAssessment == "not_suspicious" && o.C.ErOutcomeSeenAt is null)
                {
                    o.Db.Cases.Where(c => c.Cad == o.Cad).ExecuteUpdate(s => s.SetProperty(c => c.ErOutcomeSeenAt, o.T));
                    o.W.By(o.T, "Crew acknowledged the ER review outcome: cardiology not activated", me, "key");
                }
                return true;
            case "note":
                o.W.By(o.T, TextRules.Clean(d.Text("text")), me, "view");
                return true;
            default:
                return false;
        }
    }

    // ---------- a first view of each ECG image, per role ----------

    private static void Viewed(OpContext o, string name)
    {
        var n = o.D.Number("n");
        var i = o.D.Number("i");
        if (n is not { } nv || i is not { } iv || nv != Math.Floor(nv) || iv != Math.Floor(iv)) return;
        var ecg = (int)nv;
        var image = (int)iv;
        var role = o.A.Role;
        var who = role == ActorRoles.Er ? "ER Doctor" : "Cardiologist";
        if (!o.Db.EcgImages.Any(x => x.Cad == o.Cad && x.EcgN == ecg && x.I == image)) return;
        if (o.Db.EcgRoleViews.Any(x => x.Cad == o.Cad && x.Role == role && x.EcgN == ecg && x.I == image)) return;
        var first = !o.Db.EcgRoleViews.Any(x => x.Cad == o.Cad && x.Role == role && x.EcgN == ecg);
        o.Db.Insert(new EcgRoleView { Cad = o.Cad, Role = role, EcgN = ecg, I = image, ViewedAt = o.T, ViewedBy = name });
        var by = name.Or($"the {who}");
        if (role == ActorRoles.Cardiologist && o.C.OpenedAt is null && o.F.Acknowledged is not null)
        {
            o.Db.Cases.Where(c => c.Cad == o.Cad).ExecuteUpdate(s => s.SetProperty(c => c.OpenedAt, o.T));
            o.W.By(o.T, $"ECG {ecg} opened by {by} (Cardiologist) · review started", name, "key");
        }
        else if (first) o.W.By(o.T, $"ECG {ecg} viewed by {by} ({who})", name, "key");
        else o.W.By(o.T, $"Image {image} of ECG {ecg} viewed by {by} ({who})", name, "view");
    }

    private static string EcgNumbers(JsonData d, string separator) => string.Join(separator, d.Array("ns").Select(n => "ECG " + JsonData.JsString(n)));

    // ---------- actions from the ER Doctor ----------

    private bool ErAction(OpContext o)
    {
        var d = o.D;
        switch (o.Kind)
        {
            case "er_shown":
                if (o.F.State == PathwayStates.SentToEr && o.C.ErAlertShownAt is null)
                {
                    o.Db.Cases.Where(c => c.Cad == o.Cad).ExecuteUpdate(s => s.SetProperty(c => c.ErAlertShownAt, o.Rcv));
                    o.W.Sys(o.Rcv, "NEW STEMI CASE alert shown on the ER screen · audible alarm started", "key");
                }
                return true;
            case "er_accept":
            {
                var name = NeedName(d.Text("name"));
                if (o.F.State != PathwayStates.SentToEr) return true; // already accepted: nothing changes
                o.Db.Cases.Where(c => c.Cad == o.Cad).ExecuteUpdate(s => s.SetProperty(c => c.ErDoctorName, name).SetProperty(c => c.ErAcceptedAt, o.T));
                o.W.By(o.T, $"ER Doctor accepted the case: {name} · audible alarm stopped", name, "key");
                return true;
            }
            case "er_assess":
            {
                var name = NeedName(d.Truthy("name") ? d.Text("name") : o.C.ErDoctorName);
                var on = NeedLatest(o.F, d.Int("on"));
                NeedViewed(o, on, $"View ECG {on} before recording the assessment.");
                var kind = d.Str("kind");
                if (kind is "activate" or "uncertain")
                {
                    var label = kind == "activate" ? "ACTIVATE CARDIOLOGIST" : "UNCERTAIN";
                    o.Db.Cases.Where(c => c.Cad == o.Cad).ExecuteUpdate(s => s
                        .SetProperty(c => c.ErAssessment, kind).SetProperty(c => c.ErAssessmentAt, o.T).SetProperty(c => c.ErAssessedBy, name)
                        .SetProperty(c => c.ErAssessmentEcg, on).SetProperty(c => c.CardiologyActivatedAt, o.T)
                        .SetProperty(c => c.CardiologyActivationReason, $"ER Doctor assessment: {label}").SetProperty(c => c.CardiologyActivatedBy, name));
                    if (!o.Db.CardiologistAlerts.Any(a => a.Cad == o.Cad))
                        o.Db.Insert(new CardiologistAlert { Cad = o.Cad, Cardiologist = "Cardiologist on call", Hospital = "On-call cardiology", AlertedAt = o.Rcv });
                    o.W.By(o.T, $"ER Doctor assessment: {label} — {name} · on ECG {on}", name, "key");
                    if (kind == "uncertain") o.W.By(o.T, "ER Assessment: UNCERTAIN, Cardiology: ACTIVATED", name, "key");
                    o.W.By(o.T, $"Cardiology activated by ER Doctor {name} · the same case sent to the Cardiologist queue", name, "key");
                    o.W.Sys(o.Rcv, "Cardiologist alerted: NEW CARDIOLOGY ACTIVATION", "key");
                    return true;
                }
                if (kind == "not_suspicious")
                {
                    // closing without activating cardiology must be explainable afterwards: a reason is mandatory
                    var r = ErAssessmentRules.CheckNotSuspicious(d.Str("reason"), d.Text("comment"));
                    if (!r.Ok) throw new ActionException(400, r.Error!);
                    o.Db.Cases.Where(c => c.Cad == o.Cad).ExecuteUpdate(s => s
                        .SetProperty(c => c.ErAssessment, "not_suspicious").SetProperty(c => c.ErAssessmentAt, o.T).SetProperty(c => c.ErAssessedBy, name)
                        .SetProperty(c => c.ErAssessmentEcg, on).SetProperty(c => c.ErNonActivationReason, r.ReasonLabel)
                        .SetProperty(c => c.ErNonActivationComment, r.Comment.OrNull()));
                    MarkClosed(o.Db, o.Cad, o.T, name, null, PathwayClosure.ErNotActivated);
                    o.W.By(o.T, $"ER Doctor assessment: NOT SUSPICIOUS FOR STEMI — {name} · on ECG {on}", name, "key");
                    o.W.By(o.T, $"Reason: {r.ReasonLabel}", name, "key");
                    if (!string.IsNullOrEmpty(r.Comment)) o.W.By(o.T, $"Comment: {r.Comment}", name, "key");
                    o.W.By(o.T, "Cardiology not activated", name, "key");
                    o.W.Sys(o.T, $"STEMI screening pathway closed following ER Doctor assessment — CAD #{o.Cad} · read-only · the CAD incident itself is not changed", "key");
                    o.W.Update(o.T, "closed", "ER REVIEW COMPLETED — CARDIOLOGY NOT ACTIVATED", new { });
                    return true;
                }
                throw new ActionException(400, "Unknown ER assessment.");
            }
            case "viewed":
                Viewed(o, OptName(d.Text("name")));
                return true;
            case "compare":
            {
                var name = OptName(d.Text("name"));
                o.W.By(o.T, $"Serial ECG comparison opened by {name.Or("the ER Doctor")} (ER Doctor): {EcgNumbers(d, " | ")}", name, "view");
                return true;
            }
            case "note":
                o.W.By(o.T, TextRules.Clean(d.Text("text")), OptName(d.Text("name")), "view");
                return true;
            default:
                return false;
        }
    }

    // ---------- actions from the Cardiologist ----------

    private bool CardiologistAction(OpContext o)
    {
        var d = o.D;
        switch (o.Kind)
        {
            case "shown":
                if (o.F.State == PathwayStates.CardiologyActivated && o.F.Alert is { ShownAt: null })
                {
                    o.Db.CardiologistAlerts.Where(a => a.Cad == o.Cad).ExecuteUpdate(s => s.SetProperty(a => a.ShownAt, o.Rcv));
                    o.W.Sys(o.Rcv, "NEW CARDIOLOGY ACTIVATION alert shown on the Cardiologist screen · audible alarm started", "key");
                }
                return true;
            case "ack":
            {
                var name = NeedName(d.Text("name"));
                if (o.F.State != PathwayStates.CardiologyActivated) return true; // already acknowledged
                o.Db.Cases.Where(c => c.Cad == o.Cad).ExecuteUpdate(s => s
                    .SetProperty(c => c.CardiologistName, name).SetProperty(c => c.CardiologistAcknowledgedAt, o.T).SetProperty(c => c.AcknowledgedAt, o.T));
                if (o.F.Alert is not null)
                    o.Db.CardiologistAlerts.Where(a => a.Cad == o.Cad).ExecuteUpdate(s => s.SetProperty(a => a.AcknowledgedAt, o.T).SetProperty(a => a.AcknowledgedBy, name));
                o.W.By(o.T, $"Cardiologist acknowledged: ACKNOWLEDGE & OPEN by {name} · audible alarm stopped", name, "key");
                return true;
            }
            case "viewed":
                Viewed(o, OptName(d.Text("name")).Or(o.C.CardiologistName ?? string.Empty));
                return true;
            case "seen": // the NEW list of 0.4: kept so an older screen does not fail
                foreach (var raw in d.Array("ids"))
                {
                    var id = JsonData.JsString(raw);
                    o.Db.CaseUpdates.Where(u => u.Id == id && u.Cad == o.Cad && u.SeenAt == null).ExecuteUpdate(s => s.SetProperty(u => u.SeenAt, o.T));
                }
                return true;
            case "compare":
            {
                var name = OptName(d.Text("name")).Or(o.C.CardiologistName ?? string.Empty);
                if (o.C.ComparedAt is null) o.Db.Cases.Where(c => c.Cad == o.Cad).ExecuteUpdate(s => s.SetProperty(c => c.ComparedAt, o.T));
                o.W.By(o.T, $"Serial ECG comparison opened by {name.Or("the Cardiologist")} (Cardiologist): {EcgNumbers(d, " | ")}", name, "view");
                return true;
            }
            case "decision":
            {
                var k = d.Str("k");
                if (k is null || !CardiologistDecisions.Labels.TryGetValue(k, out var label)) throw new ActionException(400, "Unknown decision.");
                var name = NeedName(d.Truthy("name") ? d.Text("name") : o.C.CardiologistName);
                var on = NeedLatest(o.F, d.Int("on"));
                NeedViewed(o, on, $"View ECG {on} before deciding.");
                var reason = TextRules.Clean(d.Text("reason"), 300);
                var note = TextRules.Clean(d.Text("note"));
                var advice = TextRules.Clean(d.Text("adv"));
                var instruction = TextRules.Clean(d.Text("instr"), 300);
                if (k == CardiologistDecisions.NotStemi && reason.Length == 0) throw new ActionException(400, "NOT STEMI needs a reason.");
                var reasons = d.Array("reasons").Select(r => TextRules.Clean(r.ValueKind == JsonValueKind.Null ? null : JsonData.JsString(r), 100)).Where(r => r.Length > 0).Take(8).ToList();
                var also = d.Array("also").Select(n => JsonData.AsInt(n)).Where(n => n is > 0 && n < on).Select(n => n!.Value).ToList();
                var within = d.Int("within") is int w and > 0 and <= 240 ? w : (int?)null;
                var aiFeedback = d.Str("ai") is { } a && CardiologistDecisions.AiFeedback.Contains(a) ? a : null;
                // the decision is stored first; NOT STEMI then closes the pathway as a separate event
                o.Db.Insert(new Decision
                {
                    Id = Ids.New("x"), Cad = o.Cad, Kind = k, OnEcg = on, AlsoJson = JsonDefaults.Serialize(also), Reason = reason, Note = note, Advice = advice,
                    ReasonsJson = JsonDefaults.Serialize(reasons), Instruction = instruction, WithinMin = within, AiFeedback = aiFeedback, DecidedAt = o.T,
                    ReceivedAt = o.Rcv, DecidedBy = name, DecidedByTitle = $"{name}, Cardiologist", UserId = null,
                });
                o.Db.Cases.Where(c => c.Cad == o.Cad).ExecuteUpdate(s => s.SetProperty(c => c.CardiologistDecision, k).SetProperty(c => c.CardiologistDecisionAt, o.T));
                var extra = new List<string>();
                if (reason.Length > 0) extra.Add("reason: " + reason);
                if (reasons.Count > 0) extra.Add(string.Join(", ", reasons));
                if (instruction.Length > 0) extra.Add("instruction: " + instruction);
                if (within is not null) extra.Add($"within {within} min");
                if (note.Length > 0) extra.Add("note to the crew: " + note);
                if (advice.Length > 0) extra.Add("advice: " + advice);
                o.W.By(o.T, $"Cardiologist decision: {label} — {name} · on ECG {on}{(also.Count > 0 ? $" (also reviewed: {string.Join(", ", also.Select(n => "ECG " + n))})" : string.Empty)}{(extra.Count > 0 ? " · " + string.Join(" · ", extra) : string.Empty)}", name, "key");
                if (aiFeedback is not null) o.W.By(o.T, $"AI report feedback from {name}: {aiFeedback}", name, "view");
                if (k == CardiologistDecisions.NotStemi)
                {
                    MarkClosed(o.Db, o.Cad, o.T, name, null, PathwayClosure.NotStemi);
                    o.W.Sys(o.T, $"STEMI pathway automatically closed following the Cardiologist NOT STEMI decision — CAD #{o.Cad} · no cath-lab activation · read-only · the CAD incident itself is not changed", "key");
                    o.W.Update(o.T, "closed", "NOT STEMI — PATHWAY CLOSED", new { });
                }
                return true;
            }
            case "note":
                o.W.By(o.T, TextRules.Clean(d.Text("text")), OptName(d.Text("name")).Or(o.C.CardiologistName ?? string.Empty), "view");
                return true;
            default:
                return false;
        }
    }

    [GeneratedRegex("[^a-z0-9-]", RegexOptions.IgnoreCase)]
    private static partial Regex NotKeyCharacters();
}
