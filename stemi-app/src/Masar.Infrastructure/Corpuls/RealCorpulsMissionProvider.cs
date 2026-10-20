using Masar.Application.Monitoring;

namespace Masar.Infrastructure.Corpuls;

/// <summary>
/// The future connection to corpuls.mission. NOT IMPLEMENTED — a placeholder only (Corpuls:Provider = corpuls-mission).
/// It makes no network call and receives nothing: every linked case stays "waiting for corpuls" and the crew's manual
/// ECG fallback is the only way to add an ECG.
/// No vendor API detail is assumed here. Before it can be written, MEAD / corpuls must provide (docs/corpuls-integration.md):
/// authentication method · endpoint / API documentation · ECG payload format · vital-signs payload format and units ·
/// event / webhook mechanism (push or poll, ordering, delivery guarantees, resend) · how a CAD number maps to a mission
/// and a monitor · device and unit identifiers · sandbox / test access and test devices · data-retention behaviour ·
/// connection, retry and heartbeat requirements · clock synchronisation · security and data-protection approvals.
/// It must then emit exactly the normalized events of the contract (CorpulsContract.cs), so no screen changes.
/// </summary>
public sealed class RealCorpulsMissionProvider : ICorpulsProvider
{
    public string Name => "corpuls-mission";
    public bool Simulated => false;
    public bool DemoMode => false;
    public int ExpectedIntervalMs => 5000;

    public void Attach(ICorpulsEventSink sink)
    {
        // nothing will ever be emitted until the interface exists
    }

    public CorpulsLink ConnectCase(CorpulsLinkRequest request) =>
        new(null, "corpuls.mission — not connected (the interface is not implemented in this build)", CorpulsStatuses.Waiting, null);

    public void RelinkCase(string oldCad, string newCad) { }
    public void DisconnectCase(string cad, string reason) { }
    public CorpulsConnectionState? GetConnectionStatus(string cad) => null;
    public VitalsUpdated? GetLatestVitals(string cad) => null;
    public void Resume(IReadOnlyList<CorpulsResumeLink> links) { }
}
