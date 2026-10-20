using System.Text.Json.Nodes;

namespace Masar.Application.Abstractions;

/// <summary>
/// The ECG AI service interface. The platform calls Analyse once per ECG and shows the same result on every screen.
/// PROTOTYPE ONLY: the only provider in this build is MockEcgAiProvider (scripted findings for the fictional test ECGs;
/// it does not read images). A real provider must be validated and approved first and implements this same contract.
/// An AI failure must never block a case: the platform records "AI interpretation unavailable" and carries on.
/// The AI never decides, activates or closes anything.
/// </summary>
public interface IEcgAiProvider
{
    string Name { get; }
    /// <summary>How long the analysis takes before its result is stored (the mock's simulated processing time).</summary>
    TimeSpan ProcessingDelay { get; }
    AiAnalysis Analyse(AiAnalysisRequest request);
}

public sealed record AiAnalysisRequest(string Cad, AiEcgInput Ecg, AiPreviousEcg? Previous, bool Unavailable);

/// <summary>Quality: good | glare | cut. Source of the primary image: file | test-generator | corpuls.</summary>
public sealed record AiEcgInput(int N, long? AcquiredAt, string? Variant, bool Same, int PrimaryImage, int? Rate, string? Quality, string Source);

public sealed record AiPreviousEcg(int N, long? AcquiredAt, string? PreviousStatus);

/// <summary>Status: ok | lim | wh | down. Result: the fields every screen shows (see docs/api.md, "AI result").</summary>
public sealed record AiAnalysis(string Status, JsonObject Result);
