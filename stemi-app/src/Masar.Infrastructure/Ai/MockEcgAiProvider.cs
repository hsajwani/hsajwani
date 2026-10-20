using System.Text.Json.Nodes;
using Masar.Application.Abstractions;

namespace Masar.Infrastructure.Ai;

/// <summary>
/// Simulated AI Interpretation — PROTOTYPE ONLY. Scripted results for the fictional test ECGs: NOT a clinical model, and
/// it does not look at the image — it returns the scripted findings of the test ECG pattern it is given. Nothing is sent
/// to any external service. Decision support only: the Cardiologist makes the STEMI decision.
/// The wording is the approved prototype's (round 3 v0.2). A real AI service must be validated and approved first and
/// implements <see cref="IEcgAiProvider"/> (see docs/handover.md, "AI status").
/// </summary>
public sealed class MockEcgAiProvider(TimeSpan processingDelay) : IEcgAiProvider
{
    public const string Version = "SIMULATED AI (mock service, test build) · not a clinical model";

    public string Name => "mock";
    public TimeSpan ProcessingDelay { get; } = processingDelay;

    private sealed record Findings(string Rhy, string Rate, string Ste, string SteL, string Std, string StdL, string Imp, string ImpL, string Conf);

    private static readonly Dictionary<string, Findings> Scripted = new()
    {
        ["clear"] = new("Sinus rhythm", "84 bpm", "V2 3.0 mm, V3 4.0 mm, V4 3.4 mm, V5 2.1 mm; smaller in V1, I and aVL",
            "V2 3.0 mm, V3 4.0 mm, V4 3.4 mm, V5 2.1 mm; smaller in V1 and aVL. Limb leads I, II and III not assessed",
            "Reciprocal ST depression III 1.7 mm, aVF 1.5 mm, II 1.1 mm", "Reciprocal ST depression aVF 1.5 mm. II and III not assessed",
            "Sinus rhythm. ST elevation in V2 to V5 with reciprocal inferior ST depression. Pattern concerning for acute anterior STEMI.",
            "Sinus rhythm. ST elevation in V2 to V5. Limb leads I, II and III could not be assessed, so the inferior leads are only partly reported. Pattern concerning for acute anterior STEMI.",
            "Model confidence for anterior ST elevation: high"),
        ["border"] = new("Sinus rhythm", "84 bpm", "V2 1.0 mm, V3 1.2 mm, V4 1.2 mm, with tall T waves V2 to V4",
            "V2 1.0 mm, V3 1.2 mm, V4 1.2 mm, with tall T waves V2 to V4. Limb leads I, II and III not assessed",
            "No reciprocal ST depression of 1 mm or more", "None of 1 mm or more in aVF. II and III not assessed",
            "Sinus rhythm. Borderline ST elevation in V2 to V4 with tall T waves, without reciprocal change. Early evolving anterior STEMI not excluded; a serial ECG may help.",
            "Sinus rhythm. Borderline ST elevation in V2 to V4 with tall T waves. Limb leads I, II and III could not be assessed. Early evolving anterior STEMI not excluded; a serial ECG may help.",
            "Model confidence for anterior ST elevation: low"),
        ["evolved"] = new("Sinus rhythm", "92 bpm", "V2 1.4 mm, V3 3.2 mm, V4 3.0 mm, V5 1.2 mm",
            "V2 1.4 mm, V3 3.2 mm, V4 3.0 mm, V5 1.2 mm. Limb leads I, II and III not assessed",
            "Reciprocal ST depression III 1.2 mm, aVF 1.0 mm", "Reciprocal ST depression aVF 1.0 mm. II and III not assessed",
            "Sinus rhythm. ST elevation in V2 to V5, greatest in V3 and V4, with reciprocal inferior ST depression. Pattern concerning for evolving acute anterior STEMI.",
            "Sinus rhythm. ST elevation in V2 to V5, greatest in V3 and V4. Limb leads I, II and III could not be assessed. Pattern concerning for evolving acute anterior STEMI.",
            "Model confidence for anterior ST elevation: high"),
        ["clear2"] = new("Sinus rhythm", "88 bpm", "V2 3.2 mm, V3 4.2 mm, V4 3.6 mm, V5 2.2 mm; smaller in V1, I and aVL",
            "V2 3.2 mm, V3 4.2 mm, V4 3.6 mm, V5 2.2 mm; smaller in V1 and aVL. Limb leads I, II and III not assessed",
            "Reciprocal ST depression III 1.8 mm, aVF 1.6 mm, II 1.2 mm", "Reciprocal ST depression aVF 1.6 mm. II and III not assessed",
            "Sinus rhythm. ST elevation in V2 to V5 with reciprocal inferior ST depression. Pattern concerning for acute anterior STEMI.",
            "Sinus rhythm. ST elevation in V2 to V5. Limb leads I, II and III could not be assessed. Pattern concerning for acute anterior STEMI.",
            "Model confidence for anterior ST elevation: high"),
    };

    private sealed record SerialText(string Heading, Func<int, string> Text);

    private static readonly Dictionary<string, SerialText> Serial = new()
    {
        ["evolved"] = new("Dynamic change detected", p => $"Compared with ECG {p}, there is new ST elevation in V3 and V4 (V3 +2.0 mm, V4 +1.8 mm) with new reciprocal ST depression in III and aVF."),
        ["clear2"] = new("No significant change", p => $"Compared with ECG {p}, the ST elevation in V2 to V5 persists at a similar level, and the reciprocal ST depression is unchanged."),
        ["same"] = new("No significant change", p => $"Compared with ECG {p}, this ECG is similar."),
    };

    private static readonly Dictionary<string, string> QualityText = new()
    {
        ["ok"] = "Suitable: all 12 leads, calibration pulse and rhythm strip visible",
        ["lim"] = "Limited: glare over limb leads I, II and III",
        ["wh"] = "Not suitable: leads V4 to V6 cut off at the edge of the image",
        ["file"] = "Not assessed: uploaded image file. The simulated AI does not read images; these are the scripted test findings",
        ["corpuls"] = "Digital 12-lead from the simulated corpuls feed. The simulated AI does not read the ECG; these are the scripted test findings",
    };

    private static JsonObject? CompareWithPrevious(AiEcgInput ecg, string status, AiPreviousEcg? previous)
    {
        if (previous is null) return null;
        var result = new JsonObject { ["vs"] = previous.N, ["vsAcq"] = previous.AcquiredAt };
        if (previous.PreviousStatus is null or "proc" or "down")
        {
            result["h"] = "Cannot compare";
            result["t"] = $"There is no AI analysis of ECG {previous.N}.";
            return result;
        }
        if (previous.PreviousStatus == "wh")
        {
            result["h"] = "Cannot compare";
            result["t"] = $"The image of ECG {previous.N} was not suitable for analysis (leads V4 to V6 cut off).";
            return result;
        }
        var s = Serial.GetValueOrDefault(ecg.Same ? "same" : ecg.Variant ?? string.Empty) ?? Serial["same"];
        var text = s.Text(previous.N);
        if (previous.PreviousStatus == "lim") text += $" Limb leads I, II and III of ECG {previous.N} could not be assessed.";
        if (status == "lim") text += $" Limb leads I, II and III of ECG {ecg.N} were not compared.";
        result["h"] = s.Heading;
        result["t"] = text;
        return result;
    }

    /// <summary>Status: ok | lim (limited by image quality) | wh (not suitable) | down (unavailable).</summary>
    public AiAnalysis Analyse(AiAnalysisRequest request)
    {
        var ecg = request.Ecg;
        var file = ecg.Source == "file";
        var monitor = ecg.Source == "corpuls";
        var status = request.Unavailable ? "down" : ecg.Quality == "glare" ? "lim" : ecg.Quality == "cut" ? "wh" : "ok";
        var t = Scripted.GetValueOrDefault(ecg.Variant ?? string.Empty) ?? Scripted["clear"];
        var limited = status == "lim";
        var result = new JsonObject
        {
            ["q"] = monitor ? QualityText["corpuls"] : file ? QualityText["file"] : QualityText.GetValueOrDefault(status),
            ["ver"] = Version,
            ["pri"] = ecg.PrimaryImage,
            ["provider"] = Name,
        };
        if (status is "ok" or "lim")
        {
            result["rhy"] = t.Rhy;
            result["rate"] = ecg.Rate is > 0 ? $"{ecg.Rate} bpm" : t.Rate;
            result["ste"] = limited ? t.SteL : t.Ste;
            result["std"] = limited ? t.StdL : t.Std;
            result["cond"] = "No bundle branch block or AV block";
            result["ser"] = CompareWithPrevious(ecg, status, request.Previous);
            result["imp"] = limited ? t.ImpL : t.Imp;
            result["conf"] = $"{(limited ? "Model confidence: moderate, limited by image quality" : t.Conf)}. {(monitor ? "Scripted test result for the simulated corpuls ECG" : file ? "Scripted test result for an uploaded file" : "Read from a photograph of the printout")}";
            result["lim"] = limited ? new JsonObject { ["ste"] = 1, ["std"] = 1, ["imp"] = 1 } : new JsonObject();
        }
        return new AiAnalysis(status, result);
    }
}
