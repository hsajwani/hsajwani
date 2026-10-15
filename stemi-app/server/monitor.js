/* The corpuls feed, on the platform's side: it links a case (CAD number) to the unit's monitor through the corpuls
   provider (server/integrations/corpuls/), and turns the provider's normalized events into the case record.
   - Every event is checked first: the CAD number must exist, the case must be open, and the event's monitor must be the
     one linked to that case. Anything else is refused and changes nothing (a closed case stays read-only).
   - Each ECG is stored once (the provider's event id), numbered by the platform (ECG 1, 2, 3 … across every source),
     analysed by the (mock) AI like any ECG, and reaches the screens silently.
   - The latest vital signs live on the case; a light history keeps each blood pressure measurement and about one sample a
     minute. Routine samples never go into the audit trail; the significant moments do (linked, connected, ECG received,
     connection lost / restored, feed ended, manual fallback).
   - Vital-sign updates travel to the screens as a small "monitor" event; everything else as the usual case push.
   It decides nothing clinical. */
const D = require('./db');
const live = require('./live');
const corpuls = require('./integrations/corpuls');
const CADN = require('../public/shared/cad.js');

const p2 = n => String(n).padStart(2, '0');
const hms = t => { const d = new Date(t); return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
const J = v => (v == null ? null : JSON.stringify(v));
const P = s => { try { return s == null ? null : JSON.parse(s); } catch (_) { return null; } };
const caseRow = cad => D.get('SELECT * FROM cases WHERE cad=?', cad);
const HIST_EVERY_MS = 60000;
const SYS = { role: 'system', id: null, device: null };

let PF = null, provider = null;
const feedName = () => (provider && provider.simulated ? 'corpuls feed (simulated)' : 'corpuls feed');

/* the simulation settings of the mock monitors survive a restart (test console choices, not clinical data) */
const simStore = {
  load() { const r = D.get("SELECT value FROM settings WHERE key='corpuls_sim'"); return (r && P(r.value)) || {}; },
  save(v) { D.run("INSERT INTO settings(key,value) VALUES('corpuls_sim',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify(v)); }
};
/* the test console follows the simulated monitors live */
let simQ = null;
function simChanged() {
  if (simQ) return;
  simQ = setImmediate(() => { simQ = null; live.broadcast('corpuls', () => simInfo(), c => c.role === 'control'); });
}

/* platform: { facts, writer, push, aiRun, crewT, storeImage } */
function init(platform) {
  PF = platform;
  provider = corpuls.create({ store: simStore, onSim: simChanged });
  provider.onConnectionStatusChanged(onConnection);
  provider.onVitalsUpdate(onVitals);
  provider.onECGAcquired(onEcg);
}
const event = (cad, at, kind, text) => D.run('INSERT INTO monitor_events(cad,at,kind,text) VALUES(?,?,?,?)', cad, at, kind, text);

/* ---------- linking a case to the unit's monitor ---------- */
/* A: who links (the crew, or the test console for a demo case). o: { device_id, autoEcg } — autoEcg false: the case
   already has (or is about to get) an ECG another way, so the demo's automatic ECG 1 is not wanted.
   → { status: 'linked' | 'missing' | 'closed', cad } */
function link(A, raw, o) {
  o = o || {};
  const cad = CADN.normalize(raw), C = cad && caseRow(cad);
  if (!C || (A.role === 'crew' && C.unit !== A.unit)) return { status: 'missing', cad };
  if (C.closed_at) return { status: 'closed', cad };
  if (C.corpuls_linked_at && !C.corpuls_link_ended_at) return { status: 'linked', cad, already: true };
  const r = provider.connectCase({ cad, unit: C.unit, device_id: o.device_id, autoEcg: o.autoEcg !== false && PF.facts(cad).nEcg === 0 });
  const t = Date.now(), who = A.role === 'crew' ? PF.crewT(A) : 'Test console', W = PF.writer(cad, A);
  const others = r.device_id ? D.all('SELECT cad FROM cases WHERE corpuls_device_id=? AND cad<>? AND corpuls_linked_at IS NOT NULL AND corpuls_link_ended_at IS NULL', r.device_id, cad) : [];
  D.tx(() => {
    D.run(`UPDATE cases SET corpuls_provider=?, corpuls_device_id=?, corpuls_device_label=?, corpuls_linked_at=?, corpuls_linked_by=?, corpuls_status=?, corpuls_status_at=?,
           corpuls_link_ended_at=NULL, corpuls_link_end_reason=NULL WHERE cad=?`, provider.name, r.device_id, r.label, t, who, r.status, t, cad);
    W.by(t, `Corpuls feed linked to CAD #${cad} · ${r.label} · monitor data from now on attaches to this CAD number`, who, 'key');
    event(cad, t, 'linked', `Corpuls feed linked · ${r.label}`);
    W.flush();
  });
  /* one monitor serves one patient: a case still linked to it keeps what it received, and its feed ends */
  others.forEach(x => endLink(x.cad, `the monitor was linked to CAD #${cad}`, true));
  PF.push(cad);
  return { status: 'linked', cad };
}
/* the feed of a case ends (pathway closed, unsent case discarded, monitor moved): the last values stay with the case */
function endLink(cad, why, providerDone) {
  const C = caseRow(cad);
  if (!C || !C.corpuls_linked_at || C.corpuls_link_ended_at) return;
  if (!providerDone) provider.disconnectCase(cad, why);
  const t = Date.now(), W = PF.writer(cad, SYS);
  D.tx(() => {
    D.run('UPDATE cases SET corpuls_link_ended_at=?, corpuls_link_end_reason=? WHERE cad=?', t, why, cad);
    W.sys(t, `Corpuls feed unlinked from CAD #${cad} (${why}) · the last values received are kept`, 'key', feedName());
    event(cad, t, 'ended', `Corpuls feed ended (${why})`);
    W.flush();
  });
  PF.push(cad);
}
/* after any change: a closed case's feed ends */
function closeIfNeeded(cad) {
  const C = caseRow(cad);
  if (C && C.closed_at && C.corpuls_linked_at && !C.corpuls_link_ended_at) endLink(cad, 'STEMI pathway closed');
}
/* the CAD number of an unsent case was corrected: the feed follows the case */
function relink(oldCad, newCad) { provider.relinkCase(oldCad, newCad); }

/* ---------- the provider's events ---------- */
/* the CAD number must exist, the case must be open, and the monitor must be the one linked to it */
function check(e) {
  const cad = CADN.normalize(e.cad || ''), C = cad && caseRow(cad);
  if (!C) return { ok: false, error: `No case with CAD #${e.cad || '?'}: the monitor data was not added.` };
  if (C.closed_at) return { ok: false, closed: true, error: `CAD #${cad} is closed and read-only: the monitor data was not added.` };
  if (!C.corpuls_linked_at || C.corpuls_link_ended_at || !e.device_id || C.corpuls_device_id !== e.device_id) return { ok: false, error: `Monitor ${e.device_id || '?'} is not linked to CAD #${cad}: its data was not added.` };
  return { ok: true, C };
}
function onConnection(e) {
  const v = check(e);
  if (!v.ok) return v;
  const C = v.C, prev = C.corpuls_status, t = e.timestamp;
  if (prev === e.status) return { ok: true, dup: true };
  const W = PF.writer(C.cad, SYS), F = feedName();
  D.tx(() => {
    D.run('UPDATE cases SET corpuls_status=?, corpuls_status_at=? WHERE cad=?', e.status, t, C.cad);
    if (e.status === 'connected' && !C.corpuls_connected_once) {
      D.run('UPDATE cases SET corpuls_connected_once=1 WHERE cad=?', C.cad);
      W.sys(t, `Corpuls monitor connected (${C.corpuls_device_label || e.device_id}) · live vital signs started`, 'key', F);
      event(C.cad, t, 'connected', 'Corpuls monitor connected · live data started');
    } else if (e.status === 'connected' && (prev === 'reconnecting' || prev === 'disconnected')) {
      W.sys(t, 'Corpuls connection restored', 'key', F);
      event(C.cad, t, 'restored', 'Corpuls connection restored');
    } else if (prev === 'connected' && (e.status === 'reconnecting' || e.status === 'disconnected')) {
      /* one event per outage, whatever the feed does while it lasts */
      const how = e.status === 'reconnecting' ? 'signal lost, reconnecting' : 'monitor disconnected';
      W.sys(t, `Corpuls connection lost (${how}) · last data received ${C.corpuls_last_data_at ? hms(C.corpuls_last_data_at) : '–'}`, 'key', F);
      event(C.cad, t, 'lost', `Corpuls connection lost (${how})`);
    }
    W.flush();
  });
  PF.push(C.cad);
  return { ok: true };
}
function onVitals(e) {
  const v = check(e);
  if (!v.ok) return v;
  const C = v.C, rcv = Date.now();
  /* a resent or older sample changes nothing */
  if (C.vitals_at && e.timestamp <= C.vitals_at) return { ok: true, dup: true };
  const prev = P(C.vitals_json) || {};
  const nv = { hr: e.heart_rate, spo2: e.spo2, rr: e.respiratory_rate, sys: e.bp_systolic, dia: e.bp_diastolic, bpAt: e.bp_measured_at, at: e.timestamp };
  const newBp = !!nv.bpAt && nv.bpAt !== prev.bpAt;
  const hist = newBp || e.explicit || !C.vitals_hist_at || e.timestamp - C.vitals_hist_at >= HIST_EVERY_MS || (C.corpuls_status_at || 0) > (C.vitals_hist_at || 0);
  D.tx(() => {
    D.run(`UPDATE cases SET vitals_json=?, vitals_at=?, vitals_source='corpuls', corpuls_last_data_at=?${hist ? ', vitals_hist_at=?' : ''} WHERE cad=?`,
      ...(hist ? [J(nv), e.timestamp, e.timestamp, e.timestamp, C.cad] : [J(nv), e.timestamp, e.timestamp, C.cad]));
    if (hist) D.run('INSERT INTO monitor_vitals(cad,at,received_at,device_id,source,hr,spo2,bp_sys,bp_dia,bp_at,rr,event_id,why) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      C.cad, e.timestamp, rcv, e.device_id, 'corpuls', nv.hr, nv.spo2, nv.sys, nv.dia, nv.bpAt, nv.rr, e.event_id, newBp ? 'nibp' : e.explicit ? 'update' : 'sample');
  });
  pushMonitor(C.cad);
  return { ok: true };
}
function onEcg(e) {
  const v = check(e);
  if (!v.ok) return v;
  if (!e.image || !e.image.data || !e.image.data.length) return { ok: false, error: 'The ECG arrived without its image: nothing was added.' };
  if (e.event_id) { const ex = D.get('SELECT n FROM ecgs WHERE cad=? AND source_event_id=?', v.C.cad, e.event_id); if (ex) return { ok: true, dup: true, n: ex.n }; }
  const C = v.C, F = PF.facts(C.cad), n = F.nEcg + 1, rcv = Date.now(), acq = e.acquired_at && e.acquired_at <= rcv + 60e3 ? e.acquired_at : rcv;
  const meta = e.meta || {}, W = PF.writer(C.cad, SYS), FN = feedName();
  const img = PF.storeImage(C.cad, e.image.mime, e.image.data, FN);
  D.tx(() => {
    D.run(`INSERT INTO ecgs(cad,n,acquired_at,sent_at,received_at,primary_image,variant,same_as_previous,sent_by,time_reason,op_id,source,device_id,source_event_id,source_seq,transmitted_at,device_hr)
           VALUES(?,?,?,?,?,1,?,0,?,NULL,NULL,'corpuls',?,?,?,?,?)`, C.cad, n, acq, e.timestamp, rcv, meta.variant ? String(meta.variant).slice(0, 20) : null, FN, e.device_id, e.event_id, e.ecg_sequence, e.timestamp, e.heart_rate);
    D.run('UPDATE ecg_images SET ecg_n=?, i=1, captured_at=?, kind=?, quality=?, received_at=?, added_after_send=? WHERE id=?', n, acq, 'full', 'good', rcv, C.server_received_at ? 1 : 0, img.id);
    W.sys(rcv, `ECG ${n} received from corpuls · acquired ${hms(acq)} · ${C.corpuls_device_label || e.device_id}`, 'key', FN);
    event(C.cad, rcv, 'ecg', `ECG ${n} received from corpuls`);
    if (F.state === 'repeat_requested') W.sys(rcv, `Repeat ECG received from corpuls as requested by the Cardiologist: ECG ${n}`, 'key', FN);
    if (C.server_received_at) { W.sys(rcv, `ECG ${n} reached ${F.activated ? 'the ER and the Cardiologist screens' : 'the ER screen'} silently (no alarm)`, 'key'); W.upd(rcv, 'ecg', `ECG ${n} received`, { n }); }
    W.flush();
  });
  PF.aiRun(C.cad, n);
  PF.push(C.cad);
  return { ok: true, n };
}

/* ---------- what the case record carries, and the small live update ---------- */
function monitorOf(C) {
  if (!C.corpuls_linked_at && !C.vitals_json) return null;
  const name = C.corpuls_provider || provider.name;
  return {
    provider: name, simulated: name === 'mock', demo: name === 'mock' && !!provider.demo, device: C.corpuls_device_id || null, label: C.corpuls_device_label || null,
    linked: C.corpuls_linked_at || null, by: C.corpuls_linked_by || null, status: C.corpuls_status || null, statusAt: C.corpuls_status_at || null,
    ended: C.corpuls_link_ended_at || null, endWhy: C.corpuls_link_end_reason || null, last: C.corpuls_last_data_at || null,
    every: provider.expectedIntervalMs, v: P(C.vitals_json),
    hist: D.all('SELECT at, hr, spo2, bp_sys sys, bp_dia dia, bp_at bpAt, rr, source, why FROM monitor_vitals WHERE cad=? ORDER BY at DESC, id DESC LIMIT 12', C.cad),
    log: D.all('SELECT at, kind, text FROM monitor_events WHERE cad=? ORDER BY at, id', C.cad)
  };
}
function pushMonitor(cad) {
  const C = caseRow(cad);
  if (!C) return;
  const mon = monitorOf(C), at = Date.now();
  live.each(c => { if (c.cads.has(cad)) live.write(c, 'monitor', { cad, mon, at }); });
}
/* SEND: the latest monitor values travel with the case (the crew does not confirm them) */
function atSend(C, t, W, who) {
  const v = P(C.vitals_json);
  if (!v) { W.sys(t, 'No monitor values had been received from corpuls when the case was sent', 'key', feedName()); return; }
  D.run('INSERT INTO monitor_vitals(cad,at,received_at,device_id,source,hr,spo2,bp_sys,bp_dia,bp_at,rr,event_id,why) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
    C.cad, v.at, t, C.corpuls_device_id, 'corpuls', v.hr, v.spo2, v.sys, v.dia, v.bpAt, v.rr, null, 'at_send');
  W.sys(t, `Latest monitor values sent with the case: ${vitalsText(v)} · from corpuls, ${hms(v.at)}`, 'key', who || feedName());
}
const vitalsText = v => [v.hr != null && `HR ${v.hr} bpm`, v.spo2 != null && `SpO₂ ${v.spo2} %`, v.sys != null && `BP ${v.sys}/${v.dia} mmHg${v.bpAt ? ` (measured ${hms(v.bpAt)})` : ''}`, v.rr != null && `RR ${v.rr}/min`].filter(Boolean).join(' · ') || 'none';
/* the crew used the manual ECG fallback (audited by the platform's crew action, recorded here for the timeline) */
function fallbackUsed(cad, t, n) { event(cad, t, 'fallback', `Manual ECG fallback used: ECG ${n}`); }

/* ---------- after a restart, and the test console ---------- */
function resume() {
  const rows = D.all(`SELECT c.cad, c.unit, c.corpuls_device_id d, c.corpuls_status s, c.vitals_json v, (SELECT COUNT(*) FROM ecgs e WHERE e.cad=c.cad AND e.source='corpuls') n,
                      (SELECT COUNT(*) FROM ecgs e WHERE e.cad=c.cad) total
                      FROM cases c WHERE c.corpuls_linked_at IS NOT NULL AND c.corpuls_link_ended_at IS NULL AND c.closed_at IS NULL AND c.corpuls_device_id IS NOT NULL`);
  provider.resume(rows.map(r => ({ cad: r.cad, unit: r.unit, device_id: r.d, status: r.s, vitals: P(r.v), ecgs: r.n, total: r.total })));
}
/* the test console's simulator acts on the monitor of one case (TEST ONLY) */
function simulate(raw, action, params) {
  if (typeof provider.simulate !== 'function') return { ok: false, error: 'The corpuls simulator works only with the simulated provider (CORPULS_PROVIDER=mock).' };
  const cad = CADN.normalize(raw || ''), C = cad && caseRow(cad);
  if (!C) return { ok: false, error: 'There is no case with this CAD number.' };
  if (!C.corpuls_device_id) return { ok: false, error: `CAD #${cad} has no corpuls link.` };
  return provider.simulate({ cad, device_id: C.corpuls_device_id }, action, { ...(params || {}), n: PF.facts(cad).nEcg + 1 }) || { ok: true };
}
/* demo mode (prototype only): the crew acquires the requested repeat 12-lead on the simulated corpuls3 from the crew
   screen, because no physical monitor is connected. The ECG then arrives from the simulated feed like any corpuls ECG
   (never an upload). → { status: 'ok' | 'off' | 'missing' | 'closed' | 'unlinked' | 'refused', n, error } */
function demoAcquire(A, raw) {
  if (!provider.demo || typeof provider.simulate !== 'function') return { status: 'off', error: 'The simulated corpuls demo is not on in this build.' };
  const cad = CADN.normalize(raw || ''), C = cad && caseRow(cad);
  if (!C || C.unit !== A.unit) return { status: 'missing', cad, error: 'There is no case with this CAD number for this tablet.' };
  if (C.closed_at) return { status: 'closed', cad, error: 'This STEMI pathway is closed: it is read-only.' };
  if (!C.corpuls_linked_at || C.corpuls_link_ended_at || !C.corpuls_device_id) return { status: 'unlinked', cad, error: 'This case is not linked to the simulated corpuls monitor.' };
  const n = PF.facts(cad).nEcg + 1, t = Date.now(), W = PF.writer(cad, A);
  W.by(t, `Prototype demo: ${n > 1 ? 'repeat ' : ''}12-lead acquisition on the simulated corpuls3 started from the crew screen (stands in for ECG ${n} acquired on the monitor)`, PF.crewT(A), 'evt');
  W.flush();
  const r = provider.simulate({ cad, device_id: C.corpuls_device_id }, 'trigger-ecg', { n }) || { ok: false };
  if (!r.ok) {
    const why = r.error || 'The simulated monitor did not send the ECG.';
    W.by(Date.now(), `Prototype demo: the simulated corpuls3 did not transmit ECG ${n} (${why})`, PF.crewT(A), 'evt');
    W.flush();
    return { status: 'refused', cad, error: why };
  }
  return { status: 'ok', cad, n: r.n || n, held: !!r.held };
}
/* RESET CORPULS DEMO (test console, TEST ONLY): every simulated monitor back to the clean demo state */
function resetDemo() {
  if (typeof provider.resetDemo !== 'function') return { ok: false, error: 'The corpuls simulator works only with the simulated provider (CORPULS_PROVIDER=mock).' };
  const n = provider.resetDemo(cad => PF.facts(cad).nEcg > 0);
  return { ok: true, monitors: n };
}
function simInfo() {
  const cases = D.all(`SELECT cad, unit, corpuls_device_id device, corpuls_device_label label, corpuls_status status, corpuls_last_data_at last, corpuls_link_ended_at ended,
                       closed_at closed, server_received_at sent, corpuls_linked_at linked FROM cases WHERE corpuls_linked_at IS NOT NULL ORDER BY corpuls_linked_at DESC LIMIT 30`);
  return { provider: provider.name, simulated: provider.simulated, demo: !!provider.demo, demoEcgMs: provider.demoEcgMs || null, every: provider.expectedIntervalMs,
    defaults: provider.constructor.defaults || null, devices: provider.simState ? provider.simState() : [], cases };
}
function reset() { if (provider.reset) provider.reset(); }
const providerInfo = () => ({ name: provider.name, simulated: provider.simulated, demo: !!provider.demo, every: provider.expectedIntervalMs });

module.exports = { init, link, endLink, closeIfNeeded, relink, monitorOf, pushMonitor, atSend, fallbackUsed, vitalsText, resume, simulate, demoAcquire, resetDemo, simInfo, reset, providerInfo };
