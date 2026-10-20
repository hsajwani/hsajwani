using System.Text.Json.Nodes;
using Masar.Application.Abstractions;
using Masar.Application.Cases;
using Masar.Application.Common;
using Masar.Application.Simulation;
using Masar.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Masar.Application.Ai;

/// <summary>
/// The AI service of the pathway. It starts once an ECG is stored, never delays an alert, never sounds, and its one
/// result per ECG is shown unchanged on every screen. Decision support only: it never decides, activates or closes
/// anything. An AI failure never blocks a case: "AI interpretation unavailable" is recorded and the case carries on.
/// PROTOTYPE ONLY: the provider in this build is the scripted mock (MockEcgAiProvider); no ECG leaves the platform.
/// </summary>
public sealed class AiAnalysisService(
    PlatformGate gate, IEcgAiProvider provider, SimulationSettings simulation, ILiveNotifier live, TimeProvider time, ILogger<AiAnalysisService> log)
{
    /// <summary>The analysis starts a moment after the ECG is stored, so the ECG reaches the screens first.</summary>
    public static readonly TimeSpan StartDelay = TimeSpan.FromMilliseconds(1200);
    /// <summary>Analyses still "processing" (held by the test console, or interrupted by a restart) finish after this.</summary>
    public static readonly TimeSpan ResumeDelay = TimeSpan.FromMilliseconds(1500);

    public const string StartedBy = "AI service (simulated)";
    public const string CompletedBy = "AI service (decision support, simulated)";

    /// <summary>Starts the analysis of ECG n of the case in the background.</summary>
    public void Schedule(string cad, int n) => Later(StartDelay, db => Start(db, cad, n), cad, n);

    private void Later(TimeSpan delay, Action<IMasarDbContext> work, string cad, int n) => _ = RunLaterAsync(delay, work, cad, n);

    private async Task RunLaterAsync(TimeSpan delay, Action<IMasarDbContext> work, string cad, int n)
    {
        try
        {
            await Task.Delay(delay, time);
            gate.Run(work);
        }
        catch (Exception e)
        {
            log.LogError(e, "AI analysis of ECG {EcgNumber} of case {Cad} failed", n, cad);
        }
    }

    private void Start(IMasarDbContext db, string cad, int n)
    {
        if (!db.Cases.Any(c => c.Cad == cad) || !db.Ecgs.Any(e => e.Cad == cad && e.N == n)) return;
        var start = time.NowMs();
        if (!db.AiInterpretations.Any(a => a.Cad == cad && a.EcgN == n))
            db.Insert(new AiInterpretation { Cad = cad, EcgN = n, Status = "proc", StartedAt = start, Provider = provider.Name });
        var w = new AuditWriter(db, cad, Actor.SystemActor);
        w.Sys(start, $"AI analysis of ECG {n} started (Primary image)", "evt", StartedBy);
        w.Flush();
        live.CaseChanged(cad);
        // TEST ONLY: the test console can hold analyses at "processing"
        if (simulation.Current().Ai == "proc") return;
        Later(provider.ProcessingDelay, d => Finish(d, cad, n), cad, n);
    }

    public void Finish(IMasarDbContext db, string cad, int n)
    {
        var a = db.AiInterpretations.FirstOrDefault(x => x.Cad == cad && x.EcgN == n);
        if (a is null || a.Status != "proc") return;
        var e = db.Ecgs.FirstOrDefault(x => x.Cad == cad && x.N == n);
        if (e is null) return;
        var primary = db.EcgImages.FirstOrDefault(x => x.Cad == cad && x.EcgN == n && x.I == e.PrimaryImage)
            ?? db.EcgImages.Where(x => x.Cad == cad && x.EcgN == n).OrderBy(x => x.I).FirstOrDefault();
        var previous = n > 1 ? db.Ecgs.FirstOrDefault(x => x.Cad == cad && x.N == n - 1) : null;
        var previousAi = previous is null ? null : db.AiInterpretations.FirstOrDefault(x => x.Cad == cad && x.EcgN == n - 1);

        AiAnalysis result;
        try
        {
            result = provider.Analyse(new AiAnalysisRequest(
                cad,
                new AiEcgInput(n, e.AcquiredAt, e.Variant, e.SameAsPrevious, e.PrimaryImage, e.DeviceHr is > 0 ? e.DeviceHr : null,
                    primary is null ? "good" : primary.Quality, primary is null ? "file" : primary.Source),
                previous is null ? null : new AiPreviousEcg(previous.N, previous.AcquiredAt, previousAi?.Status),
                Unavailable: simulation.Current().Ai == "down"));
        }
        catch (Exception x)
        {
            log.LogError(x, "The AI service failed on ECG {EcgNumber} of case {Cad}", n, cad);
            result = new AiAnalysis("down", new JsonObject { ["ver"] = "AI service error" });
        }

        var t = time.NowMs();
        db.AiInterpretations.Where(x => x.Cad == cad && x.EcgN == n).ExecuteUpdate(s => s
            .SetProperty(x => x.Status, result.Status)
            .SetProperty(x => x.CompletedAt, t)
            .SetProperty(x => x.Version, JsonData.NodeString(result.Result["ver"]) ?? string.Empty)
            .SetProperty(x => x.ResultJson, result.Result.ToJsonString(JsonDefaults.Options)));
        var text = result.Status switch
        {
            "ok" => $"AI analysis completed · ECG {n}",
            "lim" or "wh" => $"AI interpretation limited — ECG quality insufficient · ECG {n}",
            _ => $"AI interpretation unavailable · ECG {n}",
        };
        var impression = JsonData.NodeString(result.Result["imp"]);
        var w = new AuditWriter(db, cad, Actor.SystemActor);
        w.Sys(t, $"{text} (acquired {TimeText.Hms(e.AcquiredAt ?? 0)}){(string.IsNullOrEmpty(impression) ? string.Empty : $" · impression: {impression}")} · the same analysis is shown on every screen · decision support only", "key", CompletedBy);
        w.Update(t, "ai", text, new { n });
        w.Flush();
        live.CaseChanged(cad);
    }

    /// <summary>After a restart, or when the test console stops holding them: analyses at "processing" finish.</summary>
    public void Resume(IMasarDbContext db)
    {
        if (simulation.Current().Ai == "proc") return;
        foreach (var a in db.AiInterpretations.Where(x => x.Status == "proc").ToList())
            Later(ResumeDelay, d => Finish(d, a.Cad, a.EcgN), a.Cad, a.EcgN);
    }

    /// <summary>The CAD number of a case was corrected: its analyses still processing finish under the new number.</summary>
    public void ResumeCase(IMasarDbContext db, string cad)
    {
        foreach (var a in db.AiInterpretations.Where(x => x.Cad == cad && x.Status == "proc").ToList())
            Later(ResumeDelay, d => Finish(d, cad, a.EcgN), cad, a.EcgN);
    }
}
