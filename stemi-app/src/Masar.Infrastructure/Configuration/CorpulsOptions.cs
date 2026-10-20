namespace Masar.Infrastructure.Configuration;

/// <summary>
/// The corpuls monitor feed (configuration section "Corpuls"). Simulation settings, not clinical ones.
/// Provider "mock" = Mock Corpuls Provider — PROTOTYPE ONLY (simulated monitors, no network).
/// Provider "corpuls-mission" = the placeholder for the real corpuls.mission interface: NOT implemented.
/// </summary>
public sealed class CorpulsOptions
{
    public const string Section = "Corpuls";

    public string Provider { get; set; } = "mock";

    /// <summary>One simulated vital-signs update every SimTickMs (also the expected interval behind the screens' freshness indicator).</summary>
    public int SimTickMs { get; set; } = 5000;

    /// <summary>A simulated non-invasive blood pressure measurement every SimNibpSeconds.</summary>
    public int SimNibpSeconds { get; set; } = 120;

    /// <summary>How long the simulated monitor takes to connect after LINK CORPULS (milliseconds).</summary>
    public int SimConnectMs { get; set; } = 800;

    /// <summary>
    /// The prototype demonstration mode of the simulated feed: LINK CORPULS starts a fresh simulated monitor that connects,
    /// sends live values and, DemoEcgSeconds after connecting, ECG 1 by itself. Off: the simulated monitor does only what
    /// the test console's CORPULS SIMULATOR tells it.
    /// </summary>
    public bool DemoMode { get; set; } = true;

    public double DemoEcgSeconds { get; set; } = 3;
}
