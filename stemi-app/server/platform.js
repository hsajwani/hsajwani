/* The platform: what the approved prototype's page simulated (round 3 v0.2, shell.js), now on a server with a database.
   It receives the devices' actions, stores them, writes the audit trail, alerts the cardiologist, runs the AI service
   and pushes the shared case record to every screen. It decides nothing clinical. */
const D = require('./db');
const cfg = require('./config');
const live = require('./live');
const seed = require('./seed');
const AI = require('./ai');

const HN = { A: 'PCI Hospital A', B: 'PCI Hospital B', C: 'PCI Hospital C' };
const MDL = { age: 'Age', sex: 'Sex', complaint: 'Presenting complaint', onset: 'Symptom onset', bp: 'BP', hr: 'HR', spo2: 'SpO₂', gcs: 'GCS' };
const PATIENT_FIELDS = ['age', 'sex', 'complaint', 'onset'];
const ptTable = k => (PATIENT_FIELDS.includes(k) ? 'patient_details' : 'observations');
const J = v => (v == null ? null : JSON.stringify(v));
const P = s => (s == null ? null : JSON.parse(s));
const p2 = n => String(n).padStart(2, '0');
const hm = t => { const d = new Date(t); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
const hms = t => hm(t) + ':' + p2(new Date(t).getSeconds());

const caseRow = cad => D.get('SELECT * FROM cases WHERE cad=?', cad);
const userT = u => (u.role === 'crew' ? `${u.name}, ${u.title}` : `${u.name}, ${u.title}${u.org ? ', ' + u.org : ''}`);
function onDutyCardiologist() {
  /* the on-duty cardiologist of the provisional PCI hospital (Q-11). In this build: the cardiologist test user */
  return D.get("SELECT * FROM users WHERE role='cardiologist' ORDER BY id LIMIT 1");
}

/* ---------- audit and NEW updates ---------- */
/* the role of an audit event: the logged-in user's role for their own actions, otherwise the system that acted */
const auditRole = (who, user) => (user && who === userT(user) ? user.role : /^CAD/.test(who || '') ? 'cad-feed' : 'system');
function writer(cad, user) {
  const buf = [];
  return {
    au(t, text, who, kind) { const self = user && who === userT(user); buf.push({ t, text, who: who || '', kind: kind || 'evt', uid: self ? user.id : null, role: auditRole(who, user) }); },
    upd(at, kind, text, ref) { D.run('INSERT INTO case_updates(id,cad,kind,text,ref_json,at) VALUES(?,?,?,?,?,?)', D.uid('u'), cad, kind, text, J(ref || {}), at); },
    flush(fix) {
      for (const a of buf) { if (fix) fix(a); D.run('INSERT INTO audit_events(cad,at,actor,user_id,role,action,kind) VALUES(?,?,?,?,?,?,?)', cad, a.t, a.who, a.uid, a.role, a.text, a.kind); }
      buf.length = 0;
    },
    buf
  };
}

/* ---------- actions from the crew tablet ---------- */
function crewOp(user, o, cad, rcv, W) {
  const t = o.t, d = o.data || {}, C = caseRow(cad), CREWT = userT(user), UNIT = C.unit;
  switch (o.k) {
    case 'open':
      if (!C.pathway_opened_at) {
        D.run('UPDATE cases SET pathway_opened_at=?, pathway_opened_by=? WHERE cad=?', t, CREWT, cad);
        W.au(t, `STEMI pathway opened on CAD ${cad} by ${UNIT}`, CREWT, 'key');
      }
      break;
    case 'submit': {
      if (C.server_received_at) break; /* already received: a resend changes nothing */
      const e = d.ecg;
      D.run('INSERT INTO ecgs(cad,n,acquired_at,sent_at,received_at,primary_image,variant,same_as_previous,sent_by,time_reason,op_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        cad, 1, e.acq, d.sendAt, rcv, e.pri, e.variant, e.same ? 1 : 0, CREWT, e.timeWhy || null, o.id);
      linkImages(cad, 1, e.imgs, rcv, false, o.id);
      D.run('UPDATE cases SET submitted_at=?, server_received_at=?, delivered_late=? WHERE cad=?', d.sendAt, rcv, d.late ? 1 : 0, cad);
      Object.entries(d.md || {}).forEach(([k, v]) => {
        if (!MDL[k]) return;
        D.run(`INSERT INTO ${ptTable(k)}(id,cad,field,value_text,raw_json,taken_at,received_at,entered_by,entry_kind,op_id) VALUES(?,?,?,?,?,?,?,?,?,?)`,
          D.uid('v'), cad, k, v.v, J(v.raw), v.t, rcv, CREWT, 'sent', o.id);
      });
      (d.ev || []).forEach(x => W.au(x.t, x.text, CREWT));
      W.au(e.acq, `ECG 1 acquired${e.imgs.length > 1 ? ` · ${e.imgs.length} images` : ''}`, CREWT, 'key');
      W.au(d.sendAt, `Case submitted by ${UNIT}: ECG 1 and minimum dataset`, CREWT, 'key');
      W.au(rcv, `Server received case and ECG 1 (images stored, checksums recorded)${d.late ? ' · delivered late, downtime route already in use' : ''}`, 'Platform', 'key');
      /* destination engine (placeholder policy, not AI): the prototype's fixed recommendation */
      D.run('INSERT INTO destinations(id,cad,hospital,status,reason,at,received_at,set_by) VALUES(?,?,?,?,?,?,?,?)',
        D.uid('d'), cad, 'A', 'rec', 'Nearest participating PCI centre within catchment; no diversion.', rcv + 1, rcv + 1, 'Destination engine');
      W.au(rcv + 1, 'Provisional destination recommended: PCI Hospital A (placeholder policy)', 'Destination engine');
      /* the alert never waits for the AI */
      const doc = onDutyCardiologist();
      D.run('INSERT INTO cardiologist_alerts(cad,cardiologist,hospital,alerted_at) VALUES(?,?,?,?)', cad, doc.name, 'A', rcv + 2);
      W.au(rcv + 2, `Cardiologist alerted: ${doc.name}, on duty, PCI Hospital A · new case`, 'Platform', 'key');
      aiRun(cad, 1);
      break;
    }
    case 'ecg': {
      const e = d.ecg;
      if (D.get('SELECT n FROM ecgs WHERE cad=? AND n=?', cad, e.n)) break;
      D.run('INSERT INTO ecgs(cad,n,acquired_at,sent_at,received_at,primary_image,variant,same_as_previous,sent_by,time_reason,op_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        cad, e.n, e.acq, d.sendAt, rcv, e.pri, e.variant, e.same ? 1 : 0, CREWT, e.timeWhy || null, o.id);
      linkImages(cad, e.n, e.imgs, rcv, false, o.id);
      W.au(e.acq, `ECG ${e.n} acquired${e.imgs.length > 1 ? ` · ${e.imgs.length} images` : ''}`, CREWT, 'key');
      W.au(d.sendAt, `ECG ${e.n} sent by ${UNIT}`, CREWT);
      W.au(rcv, `ECG ${e.n} received by the server · cardiologist updated silently (no alarm)`, 'Platform', 'key');
      W.upd(rcv, 'ecg', `ECG ${e.n} received`, { n: e.n });
      aiRun(cad, e.n);
      break;
    }
    case 'img': {
      if (!D.get('SELECT n FROM ecgs WHERE cad=? AND n=?', cad, d.n)) break;
      linkImages(cad, d.n, [d.img], rcv, true, o.id);
      W.au(rcv, `Image ${d.img.i} added to ECG ${d.n} by ${UNIT} · not a new ECG`, CREWT);
      W.upd(rcv, 'img', `Additional image added to ECG ${d.n} (Image ${d.img.i})`, { n: d.n, i: d.img.i });
      break;
    }
    case 'md': {
      if (!MDL[d.k]) break;
      const tb = ptTable(d.k);
      const prev = D.get(`SELECT * FROM ${tb} WHERE cad=? AND field=? ORDER BY received_at DESC, rowid DESC LIMIT 1`, cad, d.k);
      D.run(`INSERT INTO ${tb}(id,cad,field,value_text,raw_json,taken_at,received_at,entered_by,entry_kind,reason,op_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        D.uid('v'), cad, d.k, d.v, J(d.raw), d.at || t, rcv, CREWT, d.kind, d.why || '', o.id);
      const L = MDL[d.k], was = prev ? ` (was ${prev.value_text} at ${hm(prev.taken_at)})` : '', why = d.why && d.why !== 'Correction of an earlier entry' ? d.why : '';
      const txt = d.kind === 'correct' ? `${L} corrected to ${d.v}${was}${why ? ' · ' + why : ''}` : d.kind === 'clarify' ? `${L} clarified: ${d.v}${was}` : `${L} ${d.v}`;
      W.au(rcv, d.kind === 'correct' ? `${L} corrected by crew: ${prev ? prev.value_text : ''} → ${d.v} · previous value kept${why ? ' · reason: ' + why : ''}`
        : d.kind === 'clarify' ? `${L} clarified by crew: ${d.v}${prev ? ` · previous ${prev.value_text} kept` : ''}`
          : `${L} updated by crew: ${d.v}${prev ? ` · previous ${prev.value_text} at ${hm(prev.taken_at)} kept` : ''}`, CREWT, 'key');
      W.upd(rcv, 'md', txt, { k: d.k, corr: d.kind === 'correct' });
      break;
    }
    case 'rec': {
      const prev = D.get('SELECT * FROM treatments WHERE cad=? AND item_key=? ORDER BY received_at DESC, rowid DESC LIMIT 1', cad, d.k);
      D.run('INSERT INTO treatments(id,cad,item_key,label,category,value_text,not_obtained,taken_at,received_at,entered_by,entry_kind,op_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        D.uid('v'), cad, d.k, d.label, d.group, d.v, d.nv ? 1 : 0, d.at || t, rcv, CREWT, prev && !d.multi ? 'change' : 'new', o.id);
      W.au(rcv, `${d.ev || d.label + ' documented'}: ${d.v}${prev && !d.multi ? ` · previous entry kept: ${prev.value_text}` : ''}`, CREWT, 'key');
      W.upd(rcv, 'rec', `${d.label}: ${d.v}`, { k: d.k });
      break;
    }
    case 'dest': {
      const prev = D.get('SELECT * FROM destinations WHERE cad=? ORDER BY at DESC, rowid DESC LIMIT 1', cad);
      if (!HN[d.hosp]) break;
      D.run('INSERT INTO destinations(id,cad,hospital,status,why,from_hospital,at,received_at,set_by) VALUES(?,?,?,?,?,?,?,?,?)',
        D.uid('d'), cad, d.hosp, d.st, d.why || '', d.from || null, t, rcv, CREWT);
      const txt = d.st === 'chg' ? `Destination changed to ${HN[d.hosp]}${d.why ? ' · reason: ' + d.why : ''}` : `Destination confirmed: ${HN[d.hosp]}`;
      W.au(rcv, txt + (prev && d.st === 'chg' ? ` · previous ${HN[prev.hospital]} kept` : ''), CREWT, 'key');
      W.upd(rcv, 'dest', txt, {});
      break;
    }
    case 'eta': {
      D.run('INSERT INTO etas(id,cad,minutes,departed_at,at,received_at,set_by,why) VALUES(?,?,?,?,?,?,?,?)', D.uid('e'), cad, d.min, d.dep || null, t, rcv, CREWT, d.why);
      const txt = d.why === 'dep' ? `Departed scene · ETA ${d.min} min` : `ETA updated: ${d.min} min`;
      W.au(rcv, txt, CREWT, 'key'); W.upd(rcv, 'eta', txt, {});
      break;
    }
    case 'decrcv': {
      const x = D.get('SELECT * FROM decisions WHERE id=? AND cad=?', d.id, cad);
      if (x && !x.delivered_at) { D.run('UPDATE decisions SET delivered_at=? WHERE id=?', rcv, x.id); W.au(rcv, `Decision delivered to the ${UNIT} tablet and shown to the crew`, 'Platform', 'key'); }
      break;
    }
    case 'decack': {
      const x = D.get('SELECT * FROM decisions WHERE id=? AND cad=?', d.id, cad);
      if (x && !x.crew_ack_at) { D.run('UPDATE decisions SET crew_ack_at=? WHERE id=?', t, x.id); W.au(t, 'Crew acknowledged the decision', CREWT, 'key'); }
      break;
    }
    case 'downtime':
      if (!C.downtime_at) { D.run('UPDATE cases SET downtime_at=? WHERE cad=?', t, cad); W.au(t, 'STEMI downtime route in use · confirmed on the crew tablet', CREWT, 'key'); }
      break;
    case 'note':
      W.au(t, String(d.text || '').slice(0, 500), CREWT, 'view');
      break;
    default:
      return false;
  }
  return true;
}

/* images were uploaded before the action that sends them; the action links them to their ECG */
function linkImages(cad, n, imgs, rcv, after, opId) {
  for (const x of imgs || []) {
    const row = x.imageId && D.get('SELECT id FROM ecg_images WHERE id=? AND cad=?', x.imageId, cad);
    if (!row) throw Object.assign(new Error(`Image ${x.i} of ECG ${n} was not found on the server`), { status: 409 });
    D.run('UPDATE ecg_images SET ecg_n=?, i=?, captured_at=?, kind=?, quality=?, received_at=?, added_after_send=?, op_id=? WHERE id=?',
      n, x.i, x.at, x.kind || 'full', x.q || 'good', rcv, after ? 1 : 0, opId, x.imageId);
  }
}

/* ---------- actions from the cardiologist ---------- */
function docOp(user, o, cad, rcv, W) {
  const t = o.t, d = o.data || {}, C = caseRow(cad), DOCN = user.name, DOCT = userT(user);
  const A = D.get('SELECT * FROM cardiologist_alerts WHERE cad=?', cad);
  switch (o.k) {
    case 'shown':
      if (A && !A.shown_at) { D.run('UPDATE cardiologist_alerts SET shown_at=? WHERE cad=?', rcv, cad); W.au(rcv, `NEW CARDIAC CASE alert shown on ${DOCN}'s device · audible alarm started`, 'Platform', 'key'); }
      break;
    case 'ack':
      if (A && !A.acknowledged_at) {
        D.run('UPDATE cardiologist_alerts SET acknowledged_at=?, acknowledged_by=? WHERE cad=?', t, DOCT, cad);
        D.run('UPDATE cases SET acknowledged_at=? WHERE cad=?', t, cad);
        W.au(t, `Cardiologist acknowledged: ACKNOWLEDGE & OPEN by ${DOCN} · audible alarm stopped`, DOCT, 'key');
      }
      break;
    case 'viewed': {
      if (D.get('SELECT 1 FROM ecg_views WHERE cad=? AND ecg_n=? AND i=?', cad, d.n, d.i)) break;
      const firstOfEcg = !D.get('SELECT 1 FROM ecg_views WHERE cad=? AND ecg_n=?', cad, d.n);
      D.run('INSERT INTO ecg_views(cad,ecg_n,i,viewed_at,viewed_by) VALUES(?,?,?,?,?)', cad, d.n, d.i, t, DOCT);
      if (!C.opened_at && C.acknowledged_at) { D.run('UPDATE cases SET opened_at=? WHERE cad=?', t, cad); W.au(t, `ECG ${d.n} opened by ${DOCN} · review started`, DOCT, 'key'); }
      else if (firstOfEcg) W.au(t, `ECG ${d.n} viewed by ${DOCN}`, DOCT, 'key');
      else W.au(t, `Image ${d.i} of ECG ${d.n} first viewed by ${DOCN}`, DOCT, 'view');
      D.all('SELECT id, kind, ref_json FROM case_updates WHERE cad=? AND seen_at IS NULL', cad).forEach(u => {
        const r = P(u.ref_json) || {};
        if ((u.kind === 'ecg' && r.n === d.n) || (u.kind === 'img' && r.n === d.n && r.i === d.i)) D.run('UPDATE case_updates SET seen_at=? WHERE id=?', t, u.id);
      });
      break;
    }
    case 'seen': {
      let n = 0;
      for (const id of d.ids || []) n += Number(D.run('UPDATE case_updates SET seen_at=? WHERE id=? AND cad=? AND seen_at IS NULL', t, id, cad).changes);
      if (n) W.au(t, `${n} new update${n > 1 ? 's' : ''} marked as seen by ${DOCN}`, DOCT, 'view');
      break;
    }
    case 'compare': {
      const s = (d.ns || []).map(n => 'ECG ' + n).join(' | ');
      if (!C.compared_at) D.run('UPDATE cases SET compared_at=? WHERE cad=?', t, cad);
      W.au(t, `Serial comparison opened by ${DOCN}: ${s}`, DOCT, 'key');
      break;
    }
    case 'decision': {
      if (!['confirm', 'not', 'repeat'].includes(d.k)) break;
      if (!C.acknowledged_at) throw Object.assign(new Error('Acknowledge the case before deciding'), { status: 409 });
      D.run(`INSERT INTO decisions(id,cad,kind,on_ecg,also_json,reason,note,advice,reasons_json,instruction,within_min,ai_feedback,decided_at,received_at,decided_by,decided_by_title,user_id)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        D.uid('x'), cad, d.k, d.on, J(d.also || []), d.reason || '', d.note || '', d.adv || '', J(d.reasons || []), d.instr || '', d.within || null, d.ai || null, t, rcv, DOCN, DOCT, user.id);
      const lab = { confirm: 'STEMI confirmed', not: 'Not STEMI recorded', repeat: 'Unclear: repeat ECG requested' }[d.k];
      const rs = d.reasons || [];
      W.au(t, `${lab} by ${DOCN} on ECG ${d.on}${d.reason ? ' · reason: ' + d.reason : ''}${rs.length ? ' · ' + rs.join(', ') : ''}${d.note ? ' · note: ' + d.note : ''}`, DOCT, 'key');
      if (d.ai) W.au(t, `AI report feedback from ${DOCN}: ${d.ai}`, DOCT, 'view');
      break;
    }
    case 'call':
      W.au(t, d.end ? `Call with ${C.unit} ended · ${d.len}` : `Call started with ${C.unit}`, DOCT, 'view');
      break;
    case 'note':
      W.au(t, String(d.text || '').slice(0, 500), DOCT, 'view');
      break;
    default:
      return false;
  }
  return true;
}

/* ---------- applying a batch of actions from one device, in order; each action is stored once ---------- */
function applyOps(user, ops) {
  const cad = seed.activeCad();
  const results = [];
  for (const o of ops) {
    if (!o || typeof o.id !== 'string' || typeof o.k !== 'string') { results.push({ id: o && o.id, ok: false, error: 'bad action' }); continue; }
    if (o.cad && o.cad !== cad) { results.push({ id: o.id, ok: false, error: 'This case is no longer the active test case' }); continue; }
    const seen = D.get('SELECT received_at FROM ops WHERE op_id=?', o.id);
    if (seen) { results.push({ id: o.id, ok: true, dup: true, rcv: seen.received_at }); continue; }
    const rcv = Date.now(), W = writer(cad, user);
    try {
      D.tx(() => {
        D.run('INSERT INTO ops(op_id,cad,user_id,role,kind,device_time,received_at,payload_json) VALUES(?,?,?,?,?,?,?,?)', o.id, cad, user.id, user.role, o.k, o.t, rcv, J(o.data || {}));
        const ok = user.role === 'crew' ? crewOp(user, o, cad, rcv, W) : docOp(user, o, cad, rcv, W);
        if (!ok) throw Object.assign(new Error(`"${o.k}" is not an action for the ${user.role} role`), { status: 403 });
        /* an entry saved on the tablet while it was offline keeps both times: when it was saved and when the server received it */
        const crewT = userT(user);
        W.flush(rcv - o.t > 5000 && user.role === 'crew' ? a => { if (a.who === crewT) a.text += a.t === rcv ? ` · saved on the tablet ${hms(o.t)}, received on reconnection` : ` · received ${hms(rcv)}, on reconnection`; } : null);
      });
      results.push({ id: o.id, ok: true, rcv });
    } catch (e) {
      results.push({ id: o.id, ok: false, error: e.message, status: e.status || 500 });
      if (!e.status) console.error('action failed', o.k, e);
    }
  }
  push();
  return results;
}

/* ---------- the AI service: starts once the ECG is stored, never delays the alert, never sounds ---------- */
function aiRun(cad, n) {
  setTimeout(() => {
    if (!caseRow(cad)) return;
    const start = Date.now();
    D.run('INSERT OR IGNORE INTO ai_interpretations(cad,ecg_n,status,started_at,provider) VALUES(?,?,?,?,?)', cad, n, 'proc', start, cfg.AI_PROVIDER);
    const W = writer(cad, null);
    W.au(start, `AI analysis of ECG ${n} started (Primary image)`, 'AI service');
    W.flush(); push();
    if (D.sim().ai === 'proc') return; /* held at "processing" by the test console */
    setTimeout(() => aiFinish(cad, n).catch(e => console.error('AI', e)), cfg.MOCK_AI_DELAY_MS);
  }, 1200);
}
async function aiFinish(cad, n) {
  const a = D.get('SELECT * FROM ai_interpretations WHERE cad=? AND ecg_n=?', cad, n);
  if (!a || a.status !== 'proc') return;
  const e = D.get('SELECT * FROM ecgs WHERE cad=? AND n=?', cad, n);
  const pri = D.get('SELECT * FROM ecg_images WHERE cad=? AND ecg_n=? AND i=?', cad, n, e.primary_image) || D.get('SELECT * FROM ecg_images WHERE cad=? AND ecg_n=? ORDER BY i LIMIT 1', cad, n);
  const pe = n > 1 ? D.get('SELECT * FROM ecgs WHERE cad=? AND n=?', cad, n - 1) : null;
  const pa = pe ? D.get('SELECT * FROM ai_interpretations WHERE cad=? AND ecg_n=?', cad, n - 1) : null;
  let out;
  try {
    out = await AI.provider().analyse({
      cad,
      ecg: { n, acq: e.acquired_at, variant: e.variant, same: !!e.same_as_previous, pri: e.primary_image, primary: { quality: pri.quality, source: pri.source, filePath: pri.file_name } },
      previous: pe ? { n: pe.n, acq: pe.acquired_at, ai: pa ? { st: pa.status } : null } : null,
      unavailable: D.sim().ai === 'down'
    });
  } catch (err) {
    console.error('AI service failed', err);
    out = { st: 'down', result: { ver: 'AI service error' } };
  }
  const t = Date.now();
  D.run('UPDATE ai_interpretations SET status=?, completed_at=?, version=?, result_json=? WHERE cad=? AND ecg_n=?', out.st, t, out.result.ver || '', J(out.result), cad, n);
  const txt = { ok: `AI analysis completed · ECG ${n}`, lim: `AI interpretation limited — ECG quality insufficient · ECG ${n}`, wh: `AI interpretation limited — ECG quality insufficient · ECG ${n}`, down: `AI interpretation unavailable · ECG ${n}` }[out.st];
  const kept = n > 1 ? ` · new ECG analysis; the analysis of ECG ${n - 1} is kept` : '', imp = out.result.imp ? ` · impression: ${out.result.imp}` : '';
  const W = writer(cad, null);
  W.au(t, `${txt} (acquired ${hms(e.acquired_at)})${kept}${imp} · the same analysis sent to the crew tablet and the cardiologist`, 'AI service (decision support, simulated)', 'key');
  W.upd(t, 'ai', txt, { n });
  W.flush(); push();
}
/* analyses held at "processing" finish once the test console lets them, and after a server restart */
function aiResume() {
  if (D.sim().ai === 'proc') return;
  D.all("SELECT cad, ecg_n FROM ai_interpretations WHERE status='proc'").forEach(r => setTimeout(() => aiFinish(r.cad, r.ecg_n).catch(console.error), 1500));
}

/* ---------- reminders and escalation: thresholds are governance configurable and NOT set, so only the test console fires them ---------- */
function reminder() {
  const cad = seed.activeCad(), A = D.get('SELECT * FROM cardiologist_alerts WHERE cad=?', cad);
  if (!A || A.acknowledged_at) return false;
  const t = Date.now(), n = D.get("SELECT COUNT(*) c FROM alert_followups WHERE cad=? AND kind='reminder'", cad).c + 1;
  D.run("INSERT INTO alert_followups(cad,kind,level,target,at) VALUES(?,?,?,?,?)", cad, 'reminder', n, A.cardiologist, t);
  const W = writer(cad, null); W.au(t, `Acknowledgement reminder ${n} sent to ${A.cardiologist} (interval: governance configurable, not set · fired from the test console)`, 'Platform', 'key'); W.flush();
  push(); return true;
}
function escalate() {
  const cad = seed.activeCad(), A = D.get('SELECT * FROM cardiologist_alerts WHERE cad=?', cad);
  if (!A || A.acknowledged_at) return false;
  const t = Date.now(), lv = D.get("SELECT COUNT(*) c FROM alert_followups WHERE cad=? AND kind='escalation'", cad).c + 1;
  const to = lv === 1 ? 'Backup cardiologist (Dr Y, fictional)' : 'ACC duty officer (fictional)';
  D.run("INSERT INTO alert_followups(cad,kind,level,target,at) VALUES(?,?,?,?,?)", cad, 'escalation', lv, to, t);
  const W = writer(cad, null); W.au(t, `Escalation level ${lv}: ${to} alerted · case not acknowledged (threshold: governance configurable, not set · fired from the test console)`, 'Platform', 'key'); W.flush();
  push(); return true;
}

/* ---------- presence: the server knows when a device stops reaching it ---------- */
live.onPresence((role, up, wasAt) => {
  const cad = seed.activeCad(), C = caseRow(cad);
  if (!C || (up && !wasAt)) { push(); return; }
  const t = Date.now(), who = role === 'crew' ? `${C.unit} tablet` : `${onDutyCardiologist().name}'s device`;
  const W = writer(cad, null); W.au(t, up ? `${who} reconnected · changes synchronised` : `${who} lost connection to the platform`, 'Platform', 'key'); W.flush();
  push();
});

/* ---------- the shared case record, in the shape both screens read ---------- */
function snapshot(cad) {
  const C = caseRow(cad);
  if (!C) return null;
  const R = {
    cad, unit: C.unit, emirate: C.emirate, crew: C.crew_name,
    incident: { type: C.incident_type, disp: C.dispatched_at, atPt: C.at_patient_at },
    path: C.pathway_opened_at ? { at: C.pathway_opened_at, by: C.pathway_opened_by } : null,
    sub: C.server_received_at ? { send: C.submitted_at, rcv: C.server_received_at, late: !!C.delivered_late } : null,
    downtime: C.downtime_at ? { at: C.downtime_at } : null,
    pt: {}, rec: {}, ecgs: [], dest: [], eta: [], alert: null, ack: C.acknowledged_at, opened: C.opened_at, views: {}, cmp: C.compared_at,
    dec: [], upd: [], audit: [], ops: {}, presence: live.presence()
  };
  for (const tb of ['patient_details', 'observations']) {
    D.all(`SELECT rowid, * FROM ${tb} WHERE cad=? ORDER BY received_at, rowid`, cad).forEach(r => {
      (R.pt[r.field] || (R.pt[r.field] = [])).push({ id: r.id, v: r.value_text, raw: P(r.raw_json), t: r.taken_at, rcv: r.received_at, by: r.entered_by, kind: r.entry_kind, why: r.reason || '', op: r.op_id });
    });
  }
  D.all('SELECT rowid, * FROM treatments WHERE cad=? ORDER BY received_at, rowid', cad).forEach(r => {
    const x = R.rec[r.item_key] || (R.rec[r.item_key] = { label: r.label, group: r.category, vers: [] });
    x.vers.push({ id: r.id, v: r.value_text, nv: !!r.not_obtained, t: r.taken_at, rcv: r.received_at, by: r.entered_by, kind: r.entry_kind, op: r.op_id });
  });
  const ais = {};
  D.all('SELECT * FROM ai_interpretations WHERE cad=?', cad).forEach(a => {
    ais[a.ecg_n] = { st: a.status, start: a.started_at, ...(a.status !== 'proc' ? { done: a.completed_at, ...P(a.result_json) } : {}) };
  });
  D.all('SELECT * FROM ecgs WHERE cad=? ORDER BY n', cad).forEach(e => {
    const imgs = D.all('SELECT * FROM ecg_images WHERE cad=? AND ecg_n=? ORDER BY i', cad, e.n).map(x => ({
      i: x.i, kind: x.kind, q: x.quality, at: x.captured_at, rcv: x.received_at, after: !!x.added_after_send, src: x.source, url: `/files/${x.id}`, op: x.op_id
    }));
    R.ecgs.push({ n: e.n, acq: e.acquired_at, variant: e.variant, pri: e.primary_image, same: !!e.same_as_previous, sent: e.sent_at, rcv: e.received_at, by: e.sent_by, op: e.op_id, imgs, ai: ais[e.n] || null });
  });
  R.dest = D.all('SELECT rowid, * FROM destinations WHERE cad=? ORDER BY at, rowid', cad).map(d => ({ id: d.id, hosp: d.hospital, st: d.status, reason: d.reason, why: d.why || '', t: d.at, rcv: d.received_at, by: d.set_by, from: d.from_hospital }));
  R.eta = D.all('SELECT rowid, * FROM etas WHERE cad=? ORDER BY at, rowid', cad).map(e => ({ id: e.id, min: e.minutes, dep: e.departed_at, t: e.at, rcv: e.received_at, by: e.set_by, why: e.why }));
  const A = D.get('SELECT * FROM cardiologist_alerts WHERE cad=?', cad);
  if (A) {
    const fu = D.all('SELECT * FROM alert_followups WHERE cad=? ORDER BY at', cad);
    R.alert = { at: A.alerted_at, who: A.cardiologist, hosp: A.hospital, dlv: A.shown_at, ack: A.acknowledged_at,
      rem: fu.filter(f => f.kind === 'reminder').map(f => f.at), esc: fu.filter(f => f.kind === 'escalation').map(f => ({ t: f.at, to: f.target, lv: f.level })) };
  }
  D.all('SELECT * FROM ecg_views WHERE cad=?', cad).forEach(v => { R.views[v.ecg_n + '|' + v.i] = v.viewed_at; });
  R.dec = D.all('SELECT rowid, * FROM decisions WHERE cad=? ORDER BY decided_at, rowid', cad).map(x => ({
    id: x.id, k: x.kind, at: x.decided_at, rcv: x.received_at, by: x.decided_by, byT: x.decided_by_title, on: x.on_ecg, also: P(x.also_json) || [],
    reason: x.reason || '', note: x.note || '', adv: x.advice || '', reasons: P(x.reasons_json) || [], instr: x.instruction || '', within: x.within_min, ai: x.ai_feedback, dlv: x.delivered_at, crewAck: x.crew_ack_at
  }));
  R.upd = D.all('SELECT rowid, * FROM case_updates WHERE cad=? ORDER BY at, rowid', cad).map(u => ({ id: u.id, at: u.at, kind: u.kind, text: u.text, ref: P(u.ref_json) || {}, seen: u.seen_at }));
  R.audit = D.all('SELECT * FROM audit_events WHERE cad=? ORDER BY at, id', cad).map((a, i) => ({ t: a.at, text: a.action, who: a.actor || '', role: a.role || '', kind: a.kind, i }));
  D.all('SELECT op_id, received_at FROM ops WHERE cad=?', cad).forEach(o => { R.ops[o.op_id] = o.received_at; });
  return R;
}

/* push the active case to every open screen */
let pushQ = null;
function push() {
  if (pushQ) return;
  pushQ = setImmediate(() => {
    pushQ = null;
    const cad = seed.activeCad(), rec = snapshot(cad), at = Date.now();
    live.broadcast('snap', { rec, at });
  });
}

/* ---------- a pre-filled fictional case for demonstrations (test console) ----------
   Starts a new simulated CAD incident and sends it exactly as the crew tablet would: the pathway, ECG 1 (the sample
   test image), the minimum dataset and aspirin go through the same crew actions, so the cardiologist gets the normal
   NEW CARDIAC CASE alert and the mock AI analyses ECG 1. The crew can then add ECG 2 and update vital signs live. */
function demoCase() {
  const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
  const cad = seed.newIncident();
  const crew = D.get("SELECT * FROM users WHERE role='crew' ORDER BY id LIMIT 1");
  const buf = fs.readFileSync(path.join(cfg.ROOT, 'samples', 'test-ecg-1-borderline-anterior.jpg'));
  const imageId = D.uid('img'), file = imageId + '.jpg';
  fs.writeFileSync(path.join(cfg.IMAGE_DIR, file), buf);
  const t = Date.now();
  D.run('INSERT INTO ecg_images(id,cad,uploaded_at,source,file_name,mime,bytes,sha256,uploaded_by) VALUES(?,?,?,?,?,?,?,?,?)',
    imageId, cad, t - 3500, 'file', file, 'image/jpeg', buf.length, crypto.createHash('sha256').update(buf).digest('hex'), userT(crew));
  const id = k => `demo-${cad}-${k}`, mdT = t - 2000;
  const md = {
    age: { v: '58 y', raw: { v: 58, est: null }, t: mdT },
    sex: { v: 'Male', raw: { v: 'Male' }, t: mdT },
    complaint: { v: 'Chest pain', raw: { v: 'cp', det: '' }, t: mdT },
    onset: { v: `${hm(t - 45 * 60000)} (approximate)`, raw: { v: t - 45 * 60000, approx: true }, t: mdT },
    bp: { v: '142/88', raw: { sys: 142, dia: 88, at: mdT }, t: mdT },
    hr: { v: '88 bpm', raw: { v: 88, at: mdT }, t: mdT },
    spo2: { v: '97 %', raw: { v: 97, at: mdT }, t: mdT },
    gcs: { v: '15', raw: { v: 15 }, t: mdT }
  };
  const variant = D.sim().find === 'clear' ? 'clear' : 'border';
  applyOps(crew, [
    { id: id('open'), cad, k: 'open', t: t - 4500, data: { cad } },
    { id: id('submit'), cad, k: 'submit', t: t - 1000, data: { sendAt: t - 1000, late: false, md, ev: [{ t: mdT, text: 'Minimum dataset entered' }],
      ecg: { n: 1, acq: t - 3000, variant, pri: 1, same: false, timeWhy: null, imgs: [{ i: 1, kind: 'full', q: 'file', at: t - 3000, imageId }] } } },
    { id: id('asp'), cad, k: 'rec', t: t - 500, data: { k: 'asp', label: 'Aspirin', group: 'Treatments given', v: `Given · 300 mg · ${hm(t - 500)}`, nv: false, at: t - 500, multi: false, ev: 'Aspirin documented' } }
  ]);
  return cad;
}

function hello() {
  const cad = seed.activeCad();
  return [['init', { now: Date.now(), cad, epoch: D.epoch() }], ['cfg', { sim: D.sim() }], ['snap', { rec: snapshot(cad), at: Date.now() }]];
}

module.exports = { applyOps, snapshot, push, hello, demoCase, reminder, escalate, aiResume, aiFinish, HN };
