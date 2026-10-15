/* MockCorpulsProvider: the simulated corpuls feed of this test build. TEST ONLY — no real monitor, no corpuls.mission,
   no network: every value and every ECG is generated here and is fictional.

   Each crew unit has one simulated corpuls3 (Ambulance 214 → SIM-C3-214). Linking a case starts that monitor's feed for
   the case: WAITING, then CONNECTED (when the simulated monitor is available), then:
   - vital signs every tick (CORPULS_SIM_TICK_MS): HR and SpO₂ move gradually towards their set values (never random),
     RR every 30 s, a non-invasive blood pressure measurement every CORPULS_SIM_NIBP_SECONDS (and at once when the
     tester asks);
   - a 12-lead ECG only when the test console triggers one (the crew's acquisition on corpuls3), from ECG Sample A/B/C;
     acquired before the monitor is connected, or during a signal loss, it is held on the monitor and sent once
     connected; a disconnected monitor transmits nothing.
   The test console also disconnects / reconnects the monitor, simulates a signal loss (the feed reconnects by itself
   when the signal is restored) and pauses the data while staying connected. On reconnection the feed resends its last ECG and last sample, as a real feed might: the
   platform stores each once.
   The simulation settings of each monitor survive a server restart (store); the clinical record is the platform's. */
const C = require('./contract');
const ECG = require('./mock-ecg');

const DEFAULT_TARGET = { hr: 84, spo2: 97, sys: 142, dia: 88, rr: 18 };
const CONNECT_MS = 800, RECONNECT_MS = 1500, RR_EVERY_MS = 30000;
const toward = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));

class MockCorpulsProvider extends C.CorpulsProvider {
  constructor(o) {
    super();
    this.tickMs = o.tickMs; this.nibpMs = o.nibpSeconds * 1000;
    this.store = o.store || null;
    this.onSim = o.onSim || (() => {});
    this.devices = new Map();
    this.saved = (this.store && this.store.load()) || {};
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.timer.unref();
  }
  get name() { return 'mock'; }
  get simulated() { return true; }
  get expectedIntervalMs() { return this.tickMs; }

  /* ---------- the simulated monitors ---------- */
  deviceFor(unit) { return `SIM-C3-${(String(unit || '').match(/\d+/) || ['000'])[0]}`; }
  label(d) { return `corpuls3 ${d.id} · ${d.unit || 'test unit'} (simulated)`; }
  dev(id, unit) {
    let d = this.devices.get(id);
    if (!d) {
      const s = this.saved[id] || {};
      d = { id, unit: unit || s.unit || null, cad: null, status: 'idle', statusAt: Date.now(), available: s.available !== false, paused: !!s.paused,
        signal: s.signal !== false, target: { ...DEFAULT_TARGET, ...(s.target || {}) }, hrSet: !!s.hrSet,
        cur: null, bp: null, rrAt: 0, seq: 0, last: null, held: [], lastVitals: null, timers: [] };
      this.devices.set(id, d);
    }
    if (unit) d.unit = unit;
    return d;
  }
  byCad(cad) { for (const d of this.devices.values()) if (d.cad === cad) return d; return null; }
  save(d) {
    if (!this.store) return;
    this.saved[d.id] = { unit: d.unit, available: d.available, paused: d.paused, signal: d.signal, target: d.target, hrSet: d.hrSet };
    this.store.save(this.saved);
  }
  later(d, ms, fn) { const t = setTimeout(() => { d.timers = d.timers.filter(x => x !== t); fn(); }, ms); d.timers.push(t); }
  stop(d) { d.timers.forEach(clearTimeout); d.timers = []; }
  setStatus(d, status, reason) {
    if (d.status === status) return;
    d.status = status; d.statusAt = Date.now();
    this.onSim();
    if (d.cad) this.emit(C.connection({ event_id: `${d.id}:c:${d.statusAt}:${status}`, cad: d.cad, timestamp: d.statusAt, status, device_id: d.id, reason }));
  }

  /* ---------- the provider interface ---------- */
  connectCase({ cad, unit, device_id }) {
    const d = this.dev(device_id || this.deviceFor(unit), unit);
    const previous = d.cad && d.cad !== cad ? d.cad : null;
    this.stop(d);
    if (d.cad !== cad) Object.assign(d, { seq: 0, last: null, held: [], cur: null, bp: null, lastVitals: null, lastAcq: 0 });
    /* the initial state is returned, not emitted: the platform stores the link first */
    d.cad = cad; d.status = 'waiting'; d.statusAt = Date.now(); d.linkedAt = d.statusAt;
    if (d.available && d.signal) this.later(d, CONNECT_MS, () => this.online(d, false));
    this.onSim();
    return { device_id: d.id, label: this.label(d), status: d.status, previous };
  }
  relinkCase(oldCad, newCad) { const d = this.byCad(oldCad); if (d) { d.cad = newCad; this.onSim(); } return d ? { device_id: d.id, status: d.status } : null; }
  disconnectCase(cad) { const d = this.byCad(cad); if (d) { this.stop(d); d.cad = null; d.status = 'idle'; d.held = []; this.onSim(); } }
  getConnectionStatus(cad) { const d = this.byCad(cad); return d ? { status: d.status, at: d.statusAt, device_id: d.id } : null; }
  getLatestVitals(cad) { const d = this.byCad(cad); return d ? d.lastVitals : null; }
  getECGs(cad) { const d = this.byCad(cad); return d && d.last ? [{ ...d.last, image: null }] : []; }
  /* after a server restart: carry on with the feeds that were linked, silently (no new connection events) */
  resume(links) {
    for (const l of links) {
      const d = this.dev(l.device_id, l.unit);
      d.cad = l.cad; d.status = l.status || 'waiting'; d.statusAt = Date.now(); d.seq = l.ecgs || 0;
      const v = l.vitals;
      if (v) { d.cur = { hr: v.hr != null ? v.hr : d.target.hr, spo2: v.spo2 != null ? v.spo2 : d.target.spo2, rr: v.rr != null ? v.rr : d.target.rr }; if (v.sys != null) d.bp = { sys: v.sys, dia: v.dia, at: v.bpAt || v.at }; }
      if (d.status === 'waiting' && d.available && d.signal) this.later(d, CONNECT_MS, () => this.online(d, false));
      if (d.status === 'reconnecting' && d.available && d.signal) this.later(d, RECONNECT_MS, () => this.online(d, true));
    }
    this.onSim();
  }

  /* ---------- the feed ---------- */
  /* the monitor comes online for its case: connected, then what was held during a signal loss, the resends of a
     reconnecting feed (duplicates, stored once by the platform), and a fresh sample with a blood pressure if none yet */
  online(d, again) {
    if (!d.cad || !d.available || !d.signal) return;
    this.setStatus(d, 'connected', again ? 'restored' : 'monitor connected');
    if (again && d.last) this.emit(d.last);
    for (const e of d.held.splice(0)) { e.timestamp = Date.now(); d.last = e; this.emit(e); }
    if (again && d.lastVitals) this.emit(d.lastVitals);
    if (!d.paused) this.sample(d, { nibp: !d.bp });
  }
  sample(d, o) {
    o = o || {};
    const t = Date.now(), T = d.target;
    if (!d.cur) d.cur = { hr: T.hr, spo2: T.spo2, rr: T.rr };
    if (o.exact) d.cur = { hr: T.hr, spo2: T.spo2, rr: T.rr };
    else if (o.step) {
      d.cur.hr = toward(d.cur.hr, T.hr, 2);
      d.cur.spo2 = toward(d.cur.spo2, T.spo2, 1);
      if (t - d.rrAt >= RR_EVERY_MS) { d.cur.rr = toward(d.cur.rr, T.rr, 1); d.rrAt = t; }
    }
    if (o.nibp || o.exact || !d.bp || t - d.bp.at >= this.nibpMs) d.bp = { sys: T.sys, dia: T.dia, at: t };
    const e = C.vitals({ event_id: `${d.id}:v:${t}`, cad: d.cad, timestamp: t, device_id: d.id, heart_rate: d.cur.hr, spo2: d.cur.spo2,
      bp_systolic: d.bp.sys, bp_diastolic: d.bp.dia, bp_measured_at: d.bp.at, respiratory_rate: d.cur.rr, explicit: !!o.exact });
    d.lastVitals = e;
    return this.emit(e);
  }
  tick() {
    for (const d of this.devices.values()) if (d.cad && d.status === 'connected' && !d.paused) this.sample(d, { step: true });
  }
  /* a 12-lead acquired on the simulated corpuls3 and transmitted (n: the case's next ECG number, for the sample) */
  acquire(d, sample, n, cad) {
    const late = cad && cad !== d.cad;
    if (!late && !['connected', 'reconnecting', 'waiting'].includes(d.status)) {
      return { ok: false, error: 'The simulated monitor is not connected: a 12-lead acquired now cannot be transmitted. Connect it first, or the crew uses the manual ECG fallback.' };
    }
    /* acquired just before it is transmitted (the end of the 10-second recording); never before the case was linked or
       before the monitor's previous 12-lead */
    const t = Date.now(), acq = Math.min(t, Math.max(t - 1000, (d.linkedAt || 0) + 500, (d.lastAcq || 0) + 1000)), seq = late ? d.seq + 1 : ++d.seq;
    if (!late) d.lastAcq = acq;
    const img = ECG.sampleEcg(sample, n || seq, acq, d.cur ? d.cur.hr : d.hrSet ? d.target.hr : null);
    if (!late && !d.hrSet) { d.target.hr = img.nominal; this.save(d); }
    const e = C.ecg({ event_id: `${d.id}:ecg:${seq}:${acq}`, cad: late ? cad : d.cad, timestamp: t, ecg_sequence: seq, acquired_at: acq, device_id: d.id,
      heart_rate: img.rate, image: { mime: img.mime, data: img.data }, meta: { sample: img.sample, label: img.label, variant: img.variant, simulated: true } });
    /* not connected yet, or the signal is lost: the monitor keeps the 12-lead and sends it once connected */
    if (!late && d.status !== 'connected') { d.held.push(e); this.onSim(); return { ok: true, held: true }; }
    if (!late) d.last = e;
    return this.emit(e);
  }

  /* ---------- the test console's simulator (TEST ONLY) ----------
     target: { cad, device_id } — the device linked to the case; for a case that is closed or no longer linked, the
     device it was linked to, so "late" data from it can be tried (the platform must refuse it). */
  simulate(target, action, p) {
    p = p || {};
    let d = this.byCad(target.cad);
    const late = !d;
    if (!d) { if (!target.device_id) return { ok: false, error: 'This case has no corpuls link.' }; d = this.dev(target.device_id); }
    const out = r => { this.save(d); this.onSim(); return r || { ok: true }; };
    if (late && !['trigger-ecg', 'send-vitals'].includes(action)) return { ok: false, error: 'This case is no longer linked to the simulated monitor.' };
    switch (action) {
      case 'connect':
        d.available = true; d.signal = true;
        if (d.status !== 'connected') { this.stop(d); this.online(d, d.last != null || d.lastVitals != null); }
        return out();
      case 'disconnect':
        d.available = false; this.stop(d); this.setStatus(d, 'disconnected', 'monitor disconnected');
        return out();
      case 'reconnect':
        d.available = true; d.signal = true; this.stop(d);
        if (d.status === 'connected') return out({ ok: true, note: 'Already connected.' });
        this.setStatus(d, 'reconnecting', 'reconnecting'); this.later(d, RECONNECT_MS, () => this.online(d, true));
        return out();
      case 'signal-loss':
        if (d.status !== 'connected') return out({ ok: false, error: 'The simulated monitor is not connected.' });
        d.signal = false; this.stop(d); this.setStatus(d, 'reconnecting', 'signal lost');
        return out();
      case 'restore-signal':
        d.signal = true;
        if (d.available && d.status === 'reconnecting') this.online(d, true);
        return out();
      case 'pause': d.paused = true; return out();
      case 'resume': d.paused = false; if (d.status === 'connected') this.sample(d, {}); return out();
      case 'set': {
        /* simulation limits (what the simulated monitor can show), not clinical thresholds */
        const lim = { hr: [20, 250], spo2: [50, 100], sys: [40, 300], dia: [20, 200], rr: [4, 60] }, NAME = { hr: 'HR', spo2: 'SpO₂', sys: 'BP systolic', dia: 'BP diastolic', rr: 'RR' };
        const next = { ...d.target };
        for (const k of Object.keys(lim)) {
          if (p[k] == null || p[k] === '') continue;
          const v = Math.round(Number(p[k]));
          if (!Number.isFinite(v) || v < lim[k][0] || v > lim[k][1]) return { ok: false, error: `${NAME[k]}: ${lim[k][0]}–${lim[k][1]} in this simulator.` };
          next[k] = v;
        }
        if (next.sys <= next.dia) return { ok: false, error: 'BP: the systolic value must be higher than the diastolic.' };
        if (p.hr != null && p.hr !== '') d.hrSet = true;
        d.target = next;
        return out();
      }
      case 'send-vitals': {
        if (late) { const e = C.vitals({ event_id: `${d.id}:v:${Date.now()}:late`, cad: target.cad, timestamp: Date.now(), device_id: d.id, heart_rate: d.target.hr, spo2: d.target.spo2, bp_systolic: d.target.sys, bp_diastolic: d.target.dia, bp_measured_at: Date.now(), respiratory_rate: d.target.rr, explicit: true }); return out(this.emit(e)); }
        if (d.status !== 'connected') return out({ ok: false, error: 'The simulated monitor is not connected: nothing can be sent.' });
        return out(this.sample(d, { exact: true }));
      }
      case 'trigger-ecg': return out(this.acquire(d, ['A', 'B', 'C'].includes(p.sample) ? p.sample : 'A', p.n, late ? target.cad : null));
      default: return { ok: false, error: 'Unknown simulator action.' };
    }
  }
  /* what the test console shows of each simulated monitor */
  simState() {
    return [...this.devices.values()].map(d => ({ id: d.id, unit: d.unit, cad: d.cad, label: this.label(d), status: d.status, statusAt: d.statusAt, available: d.available,
      paused: d.paused, signal: d.signal, target: { ...d.target }, cur: d.cur ? { ...d.cur } : null, bp: d.bp ? { ...d.bp } : null, seq: d.seq, held: d.held.length }));
  }
  /* all test data deleted: every simulated monitor starts afresh */
  reset() { for (const d of this.devices.values()) this.stop(d); this.devices.clear(); this.saved = {}; if (this.store) this.store.save({}); this.onSim(); }
}

module.exports = MockCorpulsProvider;
