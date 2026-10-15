/* RealCorpulsMissionProvider: the future connection to corpuls.mission. NOT IMPLEMENTED — a placeholder only.
   It makes no network call and receives nothing: with CORPULS_PROVIDER=corpuls-mission every linked case stays
   "waiting for corpuls" and the crew's manual ECG fallback is the only way to add an ECG.
   No vendor API detail is assumed here. Before it can be written, MEAD / corpuls must provide (docs/corpuls-integration.md):
   authentication method · endpoint / API documentation · ECG payload format · vital-signs payload format and units ·
   event / webhook mechanism (push or poll, ordering, delivery guarantees, resend) · how a CAD number maps to a mission
   and a monitor · device and unit identifiers · sandbox / test access and test devices · data-retention behaviour ·
   connection, retry and heartbeat requirements · clock synchronisation · security and data-protection approvals.
   It must then emit exactly the normalized events of contract.js, so no screen changes. */
const { CorpulsProvider } = require('./contract');

class RealCorpulsMissionProvider extends CorpulsProvider {
  get name() { return 'corpuls-mission'; }
  get simulated() { return false; }
  connectCase({ cad }) {
    return { device_id: null, label: 'corpuls.mission — not connected (the interface is not implemented in this build)', status: 'waiting', cad };
  }
}

module.exports = RealCorpulsMissionProvider;
