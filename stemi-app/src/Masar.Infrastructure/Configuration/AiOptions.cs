namespace Masar.Infrastructure.Configuration;

/// <summary>The ECG AI service (configuration section "Ai"). Only "mock" exists: Simulated AI Interpretation — PROTOTYPE ONLY.</summary>
public sealed class AiOptions
{
    public const string Section = "Ai";

    /// <summary>mock (the only provider in this build; no ECG is sent to any external service).</summary>
    public string Provider { get; set; } = "mock";

    /// <summary>How long the mock AI "processes" before its result appears (milliseconds).</summary>
    public int MockDelayMs { get; set; } = 5000;
}
