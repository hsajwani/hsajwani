namespace Masar.Application.Abstractions;

/// <summary>
/// The live link to the open screens (Server-Sent Events, implemented in Masar.Api by LiveHub). The application
/// services only say WHAT changed; the live layer decides which screens may see it (Cases.CaseVisibility) and sends it
/// once the current change is committed.
/// </summary>
public interface ILiveNotifier
{
    /// <summary>A case changed: its record goes to every screen allowed to see it (and is withdrawn from the others).</summary>
    void CaseChanged(string cad);
    /// <summary>The monitor values of a case changed: a small "monitor" event goes to the screens holding that case.</summary>
    void MonitorChanged(string cad, object monitor, long at);
    /// <summary>An event to every open screen, or only to the screens of one role.</summary>
    void Broadcast(string eventName, object data, string? onlyRole = null);
    /// <summary>The test data was reset: every screen starts afresh.</summary>
    void RestartAllScreens();
    /// <summary>TEST ONLY: a simulated corpuls monitor changed (the test console follows it live).</summary>
    void SimulatorChanged();
}
