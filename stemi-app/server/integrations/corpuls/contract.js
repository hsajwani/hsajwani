/* The corpuls integration contract.
   CORPULS 3 → corpuls.mission → STEMI platform. A provider is the only code that knows how monitor data reaches the
   platform; everything else (the platform, every screen) reads the normalized events below. The simulated provider
   (mock-provider.js) is the only working one in this test build; RealCorpulsMissionProvider (real-provider.js) is a
   placeholder until MEAD / corpuls supply the interface (docs/corpuls-integration.md).

   Normalized events (all times are epoch milliseconds):
     VITALS_UPDATED             { type, event_id, cad, timestamp, source, device_id, heart_rate, spo2, bp_systolic,
                                  bp_diastolic, bp_measured_at, respiratory_rate }
                                  bp_measured_at: blood pressure is measured intermittently (NIBP), so it keeps its own
                                  time; the other values are from the sample at `timestamp`. A value not available is null.
     ECG_ACQUIRED               { type, event_id, cad, timestamp, ecg_sequence, acquired_at, source, device_id,
                                  heart_rate, image: { mime, data (Buffer) }, meta }
                                  ecg_sequence: the monitor's own count of 12-leads for this mission; the platform numbers
                                  the case's ECGs itself (ECG 1, 2, 3 … across every source). heart_rate: the rate the
                                  monitor reported with the 12-lead, if any. meta: provider details the platform stores
                                  but never shows as clinical data.
     CORPULS_CONNECTION_CHANGED { type, event_id, cad, timestamp, status, device_id, reason }
   event_id is stable: a provider that sends an event again (for example after reconnecting) sends the same id, and the
   platform stores it once. */

const EVENTS = { VITALS: 'VITALS_UPDATED', ECG: 'ECG_ACQUIRED', CONNECTION: 'CORPULS_CONNECTION_CHANGED' };
/* connection states of a case's monitor feed */
const STATUSES = ['waiting', 'connected', 'reconnecting', 'disconnected'];
/* where an ECG in a case came from */
const SOURCES = ['corpuls', 'manual_fallback', 'test'];

const int = (v, lo, hi) => { const n = Math.round(Number(v)); return v == null || v === '' || !Number.isFinite(n) || n < lo || n > hi ? null : n; };
const time = v => (Number.isFinite(+v) && +v > 0 ? +v : null);
const str = (v, max) => (v == null ? null : String(v).slice(0, max || 80));

/* builders: what a provider emits always has this shape, whatever it received */
function vitals(o) {
  return {
    type: EVENTS.VITALS, event_id: str(o.event_id, 120), cad: str(o.cad, 40), timestamp: time(o.timestamp) || Date.now(), source: 'corpuls',
    device_id: str(o.device_id), heart_rate: int(o.heart_rate, 0, 350), spo2: int(o.spo2, 0, 100),
    bp_systolic: int(o.bp_systolic, 0, 350), bp_diastolic: int(o.bp_diastolic, 0, 300), bp_measured_at: time(o.bp_measured_at),
    respiratory_rate: int(o.respiratory_rate, 0, 120), explicit: !!o.explicit
  };
}
function ecg(o) {
  return {
    type: EVENTS.ECG, event_id: str(o.event_id, 120), cad: str(o.cad, 40), timestamp: time(o.timestamp) || Date.now(),
    ecg_sequence: int(o.ecg_sequence, 1, 999), acquired_at: time(o.acquired_at), source: 'corpuls', device_id: str(o.device_id),
    heart_rate: int(o.heart_rate, 20, 300),
    image: o.image && Buffer.isBuffer(o.image.data) ? { mime: str(o.image.mime, 40), data: o.image.data } : null, meta: o.meta || {}
  };
}
function connection(o) {
  return {
    type: EVENTS.CONNECTION, event_id: str(o.event_id, 120), cad: str(o.cad, 40), timestamp: time(o.timestamp) || Date.now(),
    status: STATUSES.includes(o.status) ? o.status : 'disconnected', device_id: str(o.device_id), reason: str(o.reason, 120)
  };
}

/* The provider interface. A provider links a case (CAD number) to the monitor feed of the crew's unit, and from then on
   reports that feed's data and connection state as the events above, each carrying the CAD number.
     name, simulated                          what it is (shown in the test console and the Case Summary)
     expectedIntervalMs                       how often vital signs normally arrive (the screens' technical freshness
                                              indicator uses it; it is not a clinical threshold)
     connectCase({ cad, unit, device_id? })   → { device_id, label, status }   start the feed for this case
     relinkCase(oldCad, newCad)               the CAD number of an unsent case was corrected
     disconnectCase(cad, reason)              stop the feed for this case (pathway closed, case discarded …)
     getConnectionStatus(cad)                 → { status, at, device_id } | null
     getLatestVitals(cad)                     → VITALS_UPDATED | null
     getECGs(cad)                             → [ECG_ACQUIRED without the image data]
     resume(links)                            after a platform restart: the feeds that were linked, to carry on silently
     onVitalsUpdate(fn), onECGAcquired(fn), onConnectionStatusChanged(fn)
   A handler returns the platform's verdict ({ ok } or { ok:false, error }); a provider may log it, never act on it. */
class CorpulsProvider {
  constructor() { this.handlers = { [EVENTS.VITALS]: [], [EVENTS.ECG]: [], [EVENTS.CONNECTION]: [] }; }
  get name() { return 'none'; }
  get simulated() { return false; }
  get expectedIntervalMs() { return 5000; }
  connectCase() { throw new Error('connectCase is not implemented by this provider'); }
  relinkCase(oldCad, newCad) { this.disconnectCase(oldCad, 'CAD number corrected'); return this.connectCase({ cad: newCad }); }
  disconnectCase() { /* nothing to stop */ }
  getConnectionStatus() { return null; }
  getLatestVitals() { return null; }
  getECGs() { return []; }
  resume() { /* nothing to resume */ }
  onVitalsUpdate(fn) { this.handlers[EVENTS.VITALS].push(fn); }
  onECGAcquired(fn) { this.handlers[EVENTS.ECG].push(fn); }
  onConnectionStatusChanged(fn) { this.handlers[EVENTS.CONNECTION].push(fn); }
  /* for providers: hand a normalized event to the platform; returns the platform's verdict */
  emit(evt) {
    let out = { ok: false, error: 'No platform listening' };
    for (const fn of this.handlers[evt.type] || []) out = fn(evt) || out;
    return out;
  }
}

module.exports = { EVENTS, STATUSES, SOURCES, vitals, ecg, connection, CorpulsProvider };
