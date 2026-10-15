/* The platform: it receives every screen's actions, keeps the shared case record (one record per CAD number, the same
   record on every screen), writes the audit trail, raises the ER and cardiology alerts, runs the (mock) AI service and
   pushes each changed case to the screens allowed to see it. It decides nothing clinical: every clinical step is a
   person's action, checked against the pathway rules (server/pathway.js) before it is stored. */
const D = require('./db');
const cfg = require('./config');
const live = require('./live');
const seed = require('./seed');
const AI = require('./ai');
const PW = require('./pathway');
const CADN = require('../public/shared/cad.js');
const RULES = require('../public/shared/rules.js');

const MDL = { age: 'Age', sex: 'Sex', complaint: 'Presenting complaint', onset: 'Symptom onset', bp: 'BP', hr: 'HR', spo2: 'SpO₂', gcs: 'GCS' };
const PATIENT_FIELDS = ['age', 'sex', 'complaint', 'onset'];
const ptTable = k => (PATIENT_FIELDS.includes(k) ? 'patient_details' : 'observations');
const J = v => (v == null ? null : JSON.stringify(v));
const P = s => (s == null ? null : JSON.parse(s));
const p2 = n => String(n).padStart(2, '0');
const hm = t => { const d = new Date(t); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
const hms = t => hm(t) + ':' + p2(new Date(t).getSeconds());
const err = (status, message) => Object.assign(new Error(message), { status });
/* a time from a device: kept when plausible (within the last 48 hours, not in the future), otherwise the server's */
const sane = (t, rcv) => (Number.isFinite(+t) && +t > rcv - 48 * 3600e3 && +t <= rcv + 60e3 ? +t : rcv);

const caseRow = cad => D.get('SELECT * FROM cases WHERE cad=?', cad);
const crewT = u => `${u.name}, ${u.title}`;
const SYS = { role: 'system', id: null, device: null };

/* everything the pathway rules need about one case */
function facts(cad) {
  const C = cad && caseRow(cad);
  if (!C) return null;
  const alert = D.get('SELECT * FROM cardiologist_alerts WHERE cad=?', cad);
  const lastDec = D.get('SELECT * FROM decisions WHERE cad=? ORDER BY decided_at DESC, rowid DESC LIMIT 1', cad);
  const nEcg = (D.get('SELECT MAX(n) n FROM ecgs WHERE cad=?', cad) || {}).n || 0;
  /* made before 0.5.0: sent straight to the cardiologist, with no ER step */
  const legacy = !C.er_alerted_at && !!alert;
  const activated = C.cardiology_activated_at || (legacy ? alert.alerted_at : null);
  const acked = C.cardiologist_acknowledged_at || (legacy ? C.acknowledged_at || alert.acknowledged_at : null);
  const F = { C, alert, lastDec, nEcg, legacy, activated, acked };
  F.state = PW.state(F);
  return F;
}

/* ---------- audit trail and the NEW updates list ---------- */
function writer(cad, A) {
  const buf = [];
  const add = (t, text, who, role, kind, uid) => buf.push({ t, text, who: who || '', role, kind: kind || 'evt', uid: uid || null });
  return {
    /* a person acting from this screen: the crew user, or the ER Doctor / Cardiologist under the name they entered */
    by: (t, text, who, kind) => add(t, text, who, A.role === 'control' ? 'test-console' : A.role, kind, A.id),
    /* the platform itself, or the AI service */
    sys: (t, text, kind, who) => add(t, text, who || 'Platform', 'system', kind),
    upd: (at, kind, text, ref) => D.run('INSERT INTO case_updates(id,cad,kind,text,ref_json,at) VALUES(?,?,?,?,?,?)', D.uid('u'), cad, kind, text, J(ref || {}), at),
    flush(fix) {
      for (const a of buf) {
        if (fix) fix(a);
        D.run('INSERT INTO audit_events(cad,at,actor,user_id,role,action,kind,device) VALUES(?,?,?,?,?,?,?,?)', cad, a.t, a.who, a.uid, a.role, a.text, a.kind, (A && A.device) || null);
      }
      buf.length = 0;
    }
  };
}
const needName = raw => { const r = RULES.cleanName(raw); if (!r.ok) throw err(400, r.error); return r.name; };
/* a clinical step names the ECG it covers; a newer ECG that arrived meanwhile must be reviewed first */
function needLatest(F, on) {
  if (!Number.isInteger(on)) throw err(400, 'The decision must name the ECG it covers.');
  if (on !== F.nEcg) throw err(409, `ECG ${F.nEcg} has arrived since this screen was updated. Review ECG ${F.nEcg} before recording this.`);
}

/* ---------- storing ECGs, images and the minimum data ---------- */
function insertEcg(cad, e, sendAt, rcv, by, opId) {
  D.run('INSERT INTO ecgs(cad,n,acquired_at,sent_at,received_at,primary_image,variant,same_as_previous,sent_by,time_reason,op_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    cad, e.n, sane(e.acq, rcv), sane(sendAt, rcv), rcv, Number.isInteger(e.pri) ? e.pri : 1, e.variant ? String(e.variant).slice(0, 20) : null, e.same ? 1 : 0, by,
    e.timeWhy ? RULES.cleanText(e.timeWhy, 200) : null, opId);
  linkImages(cad, e.n, e.imgs, rcv, false, opId);
}
/* images are uploaded before the action that sends them; the action links them to their ECG */
function linkImages(cad, n, imgs, rcv, after, opId) {
  for (const x of imgs || []) {
    const row = x && x.imageId && D.get('SELECT id FROM ecg_images WHERE id=? AND cad=?', x.imageId, cad);
    if (!row) throw err(409, `Image ${x && x.i} of ECG ${n} was not found on the server`);
    D.run('UPDATE ecg_images SET ecg_n=?, i=?, captured_at=?, kind=?, quality=?, received_at=?, added_after_send=?, op_id=? WHERE id=?',
      n, x.i, sane(x.at, rcv), x.kind || 'full', x.q || 'good', rcv, after ? 1 : 0, opId, x.imageId);
  }
}
function insertMd(cad, k, v, rcv, by, kind, why, opId) {
  D.run(`INSERT INTO ${ptTable(k)}(id,cad,field,value_text,raw_json,taken_at,received_at,entered_by,entry_kind,reason,op_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    D.uid('v'), cad, k, String(v.v == null ? '' : v.v).slice(0, 120), J(v.raw == null ? null : v.raw), sane(v.t, rcv), rcv, by, kind, why || '', opId);
}

/* ---------- actions from the crew MDT ---------- */
function crewOp(A, o, F, rcv, W) {
  const t = o.t, d = o.data || {}, C = F.C, cad = C.cad, ME = crewT(A), UNIT = C.unit;
  switch (o.k) {
    case 'open': /* the pathway opening is recorded when the case is created; kept for tablets of 0.4 */
      return true;
    case 'submit': {
      if (C.server_received_at) return true; /* already received: a resend changes nothing */
      const e = d.ecg;
      if (!e || e.n !== 1 || !Array.isArray(e.imgs) || !e.imgs.length) throw err(400, 'ECG 1 with at least one image is needed to send the case.');
      insertEcg(cad, e, d.sendAt, rcv, ME, o.id);
      D.run('UPDATE cases SET submitted_at=?, server_received_at=?, delivered_late=?, er_alerted_at=? WHERE cad=?', sane(d.sendAt, rcv), rcv, d.late ? 1 : 0, rcv, cad);
      Object.entries(d.md || {}).forEach(([k, v]) => { if (MDL[k] && v) insertMd(cad, k, v, rcv, ME, 'sent', '', o.id); });
      W.by(sane(e.acq, rcv), `ECG 1 acquired${e.imgs.length > 1 ? ` · ${e.imgs.length} images` : ''}`, ME, 'key');
      W.by(sane(d.sendAt, rcv), `Case sent to the ER by ${UNIT}: ECG 1 and the minimum data`, ME, 'key');
      W.sys(rcv, `Server received the case and ECG 1 (images stored, checksums recorded)${d.late ? ' · delivered after a failed first attempt' : ''}`, 'key');
      W.sys(rcv, 'ER alerted: NEW STEMI CASE awaiting ER Doctor acceptance · the Cardiologist is not alerted at this stage', 'key');
      aiRun(cad, 1);
      return true;
    }
    case 'ecg': {
      const e = d.ecg;
      if (!e || !Number.isInteger(e.n)) throw err(400, 'This ECG could not be read.');
      if (D.get('SELECT 1 FROM ecgs WHERE cad=? AND n=?', cad, e.n)) return true;
      if (e.n !== F.nEcg + 1) throw err(409, `The case has ${F.nEcg} ECG${F.nEcg === 1 ? '' : 's'}: the next ECG is ECG ${F.nEcg + 1}, not ECG ${e.n}.`);
      if (!Array.isArray(e.imgs) || !e.imgs.length) throw err(400, `ECG ${e.n} needs at least one image.`);
      insertEcg(cad, e, d.sendAt, rcv, ME, o.id);
      W.by(sane(e.acq, rcv), `ECG ${e.n} acquired${e.imgs.length > 1 ? ` · ${e.imgs.length} images` : ''}`, ME, 'key');
      W.by(sane(d.sendAt, rcv), F.state === 'repeat_requested' ? `Repeat ECG sent by ${UNIT} as requested by the Cardiologist: ECG ${e.n}` : `ECG ${e.n} sent by ${UNIT} (serial ECG)`, ME, 'key');
      W.sys(rcv, `ECG ${e.n} received · ${F.activated ? 'the ER and the Cardiologist screens were' : 'the ER screen was'} updated silently (no alarm)`, 'key');
      W.upd(rcv, 'ecg', `ECG ${e.n} received`, { n: e.n });
      aiRun(cad, e.n);
      return true;
    }
    case 'img': {
      const x = d.img;
      if (!x || !Number.isInteger(d.n) || !Number.isInteger(x.i)) throw err(400, 'This image could not be read.');
      if (!D.get('SELECT 1 FROM ecgs WHERE cad=? AND n=?', cad, d.n)) throw err(409, `ECG ${d.n} is not on the server.`);
      const ex = D.get('SELECT id FROM ecg_images WHERE cad=? AND ecg_n=? AND i=?', cad, d.n, x.i);
      if (ex) { if (ex.id === x.imageId) return true; throw err(409, `ECG ${d.n} already has an Image ${x.i}. Nothing is replaced: add it again as a new image.`); }
      linkImages(cad, d.n, [x], rcv, true, o.id);
      W.by(rcv, `Image ${x.i} added to ECG ${d.n} by ${UNIT} · an additional image of the same ECG, not a new ECG`, ME, 'key');
      W.upd(rcv, 'img', `Additional image added to ECG ${d.n} (Image ${x.i})`, { n: d.n, i: x.i });
      return true;
    }
    case 'md': {
      if (!MDL[d.k]) throw err(400, 'Unknown field.');
      const kind = ['update', 'correct', 'clarify'].includes(d.kind) ? d.kind : 'update', tb = ptTable(d.k);
      const prev = D.get(`SELECT * FROM ${tb} WHERE cad=? AND field=? ORDER BY received_at DESC, rowid DESC LIMIT 1`, cad, d.k);
      const why = RULES.cleanText(d.why, 200), v = RULES.cleanText(d.v, 120), L = MDL[d.k];
      if (!v) throw err(400, `${L}: no value.`);
      insertMd(cad, d.k, { v, raw: d.raw, t: d.at || t }, rcv, ME, kind, why, o.id);
      W.by(rcv, kind === 'correct' ? `${L} corrected by crew: ${prev ? prev.value_text : '–'} → ${v} · the previous value is kept${why ? ' · reason: ' + why : ''}`
        : `${L} updated by crew: ${v}${prev ? ` · previous ${prev.value_text} (${hm(prev.taken_at)}) kept` : ''}`, ME, 'key');
      W.upd(rcv, 'md', kind === 'correct' ? `${L} corrected to ${v}` : `${L} ${v}`, { k: d.k, corr: kind === 'correct' });
      return true;
    }
    case 'rec': { /* a treatment update: shown silently to the ER and the Cardiologist */
      const label = RULES.cleanText(d.label, 60), v = RULES.cleanText(d.v, 300), k = String(d.k || 'otx').replace(/[^a-z0-9-]/gi, '').slice(0, 24) || 'otx';
      if (!label || !v) throw err(400, 'A treatment update needs a treatment and what was done.');
      D.run('INSERT INTO treatments(id,cad,item_key,label,category,value_text,not_obtained,taken_at,received_at,entered_by,entry_kind,op_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        D.uid('v'), cad, k, label, 'Treatments given', v, 0, sane(d.at, t), rcv, ME, 'new', o.id);
      W.by(rcv, `Treatment update by crew — ${label}: ${v}`, ME, 'key');
      W.upd(rcv, 'rec', `${label}: ${v}`, { k });
      return true;
    }
    case 'hopen': /* the Case Summary was opened (recorded once) */
      if (!C.handover_opened_at) { D.run('UPDATE cases SET handover_opened_at=? WHERE cad=?', t, cad); W.by(t, `Case Summary opened by ${ME}`, ME, 'view'); }
      return true;
    case 'decrcv': {
      const x = D.get('SELECT * FROM decisions WHERE id=? AND cad=?', d.id, cad);
      if (x && !x.delivered_at) { D.run('UPDATE decisions SET delivered_at=? WHERE id=?', rcv, x.id); W.sys(rcv, `Cardiologist decision (${RULES.DECISIONS[x.kind]}) shown on the ${UNIT} tablet`, 'key'); }
      return true;
    }
    case 'decack': {
      const x = D.get('SELECT * FROM decisions WHERE id=? AND cad=?', d.id, cad);
      if (x && !x.crew_ack_at) { D.run('UPDATE decisions SET crew_ack_at=? WHERE id=?', t, x.id); W.by(t, `Crew acknowledged the Cardiologist decision: ${RULES.DECISIONS[x.kind]}`, ME, 'key'); }
      return true;
    }
    case 'erack':
      if (C.er_assessment === 'not_suspicious' && !C.er_outcome_seen_at) {
        D.run('UPDATE cases SET er_outcome_seen_at=? WHERE cad=?', t, cad);
        W.by(t, 'Crew acknowledged the ER review outcome: cardiology not activated', ME, 'key');
      }
      return true;
    case 'note':
      W.by(t, RULES.cleanText(d.text), ME, 'view');
      return true;
    default:
      return false;
  }
}

/* ---------- a first view of each ECG image, per role ---------- */
function viewed(A, d, F, t, W, name) {
  const cad = F.C.cad, n = +d.n, i = +d.i, role = A.role, R = role === 'er' ? 'ER Doctor' : 'Cardiologist';
  if (!D.get('SELECT 1 FROM ecg_images WHERE cad=? AND ecg_n=? AND i=?', cad, n, i)) return;
  if (D.get('SELECT 1 FROM ecg_role_views WHERE cad=? AND role=? AND ecg_n=? AND i=?', cad, role, n, i)) return;
  const first = !D.get('SELECT 1 FROM ecg_role_views WHERE cad=? AND role=? AND ecg_n=?', cad, role, n);
  D.run('INSERT INTO ecg_role_views(cad,role,ecg_n,i,viewed_at,viewed_by) VALUES(?,?,?,?,?,?)', cad, role, n, i, t, name || '');
  const who = name || `the ${R}`;
  if (role === 'cardiologist' && !F.C.opened_at && F.acked) { D.run('UPDATE cases SET opened_at=? WHERE cad=?', t, cad); W.by(t, `ECG ${n} opened by ${who} (Cardiologist) · review started`, name, 'key'); }
  else if (first) W.by(t, `ECG ${n} viewed by ${who} (${R})`, name, 'key');
  else W.by(t, `Image ${i} of ECG ${n} viewed by ${who} (${R})`, name, 'view');
}
const optName = raw => { const r = RULES.cleanName(raw); return r.ok ? r.name : ''; };

/* ---------- actions from the ER Doctor ---------- */
function erOp(A, o, F, rcv, W) {
  const t = o.t, d = o.data || {}, C = F.C, cad = C.cad;
  switch (o.k) {
    case 'er_shown':
      if (F.state === 'sent_to_er' && !C.er_alert_shown_at) {
        D.run('UPDATE cases SET er_alert_shown_at=? WHERE cad=?', rcv, cad);
        W.sys(rcv, 'NEW STEMI CASE alert shown on the ER screen · audible alarm started', 'key');
      }
      return true;
    case 'er_accept': {
      const nm = needName(d.name);
      if (F.state !== 'sent_to_er') return true; /* already accepted: nothing changes */
      D.run('UPDATE cases SET er_doctor_name=?, er_accepted_at=? WHERE cad=?', nm, t, cad);
      W.by(t, `ER Doctor accepted the case: ${nm} · audible alarm stopped`, nm, 'key');
      return true;
    }
    case 'er_assess': {
      const nm = needName(d.name || C.er_doctor_name);
      needLatest(F, d.on);
      if (d.kind === 'activate' || d.kind === 'uncertain') {
        const lab = d.kind === 'activate' ? 'ACTIVATE CARDIOLOGIST' : 'UNCERTAIN';
        D.run(`UPDATE cases SET er_assessment=?, er_assessment_at=?, er_assessed_by=?, er_assessment_ecg=?,
               cardiology_activated_at=?, cardiology_activation_reason=?, cardiology_activated_by=? WHERE cad=?`,
          d.kind, t, nm, d.on, t, `ER Doctor assessment: ${lab}`, nm, cad);
        D.run('INSERT OR IGNORE INTO cardiologist_alerts(cad,cardiologist,hospital,alerted_at) VALUES(?,?,?,?)', cad, 'Cardiologist on call', 'On-call cardiology', rcv);
        W.by(t, `ER Doctor assessment: ${lab} — ${nm} · on ECG ${d.on}`, nm, 'key');
        if (d.kind === 'uncertain') W.by(t, 'ER Assessment: UNCERTAIN, Cardiology: ACTIVATED', nm, 'key');
        W.by(t, `Cardiology activated by ER Doctor ${nm} · the same case sent to the Cardiologist queue`, nm, 'key');
        W.sys(rcv, 'Cardiologist alerted: NEW CARDIOLOGY ACTIVATION', 'key');
        return true;
      }
      if (d.kind === 'not_suspicious') {
        const r = RULES.checkNotSuspicious(d.reason, d.comment);
        if (!r.ok) throw err(400, r.error);
        D.run(`UPDATE cases SET er_assessment='not_suspicious', er_assessment_at=?, er_assessed_by=?, er_assessment_ecg=?, er_non_activation_reason=?, er_non_activation_comment=? WHERE cad=?`,
          t, nm, d.on, r.reason, r.comment || null, cad);
        markClosed(cad, t, nm, null, PW.CLOSE.er);
        W.by(t, `ER Doctor assessment: NOT SUSPICIOUS FOR STEMI — ${nm} · on ECG ${d.on}`, nm, 'key');
        W.by(t, `Reason: ${r.reason}`, nm, 'key');
        if (r.comment) W.by(t, `Comment: ${r.comment}`, nm, 'key');
        W.by(t, 'Cardiology not activated', nm, 'key');
        W.sys(t, `STEMI screening pathway closed following ER Doctor assessment — CAD #${cad} · read-only · the CAD incident itself is not changed`, 'key');
        W.upd(t, 'closed', 'ER REVIEW COMPLETED — CARDIOLOGY NOT ACTIVATED', {});
        return true;
      }
      throw err(400, 'Unknown ER assessment.');
    }
    case 'viewed':
      viewed(A, d, F, t, W, optName(d.name));
      return true;
    case 'compare':
      W.by(t, `Serial ECG comparison opened by ${optName(d.name) || 'the ER Doctor'} (ER Doctor): ${(d.ns || []).map(n => 'ECG ' + n).join(' | ')}`, optName(d.name), 'view');
      return true;
    case 'note':
      W.by(t, RULES.cleanText(d.text), optName(d.name), 'view');
      return true;
    default:
      return false;
  }
}

/* ---------- actions from the Cardiologist ---------- */
function docOp(A, o, F, rcv, W) {
  const t = o.t, d = o.data || {}, C = F.C, cad = C.cad;
  switch (o.k) {
    case 'shown':
      if (F.state === 'cardiology_activated' && F.alert && !F.alert.shown_at) {
        D.run('UPDATE cardiologist_alerts SET shown_at=? WHERE cad=?', rcv, cad);
        W.sys(rcv, 'NEW CARDIOLOGY ACTIVATION alert shown on the Cardiologist screen · audible alarm started', 'key');
      }
      return true;
    case 'ack': {
      const nm = needName(d.name);
      if (F.state !== 'cardiology_activated') return true; /* already acknowledged */
      D.run('UPDATE cases SET cardiologist_name=?, cardiologist_acknowledged_at=?, acknowledged_at=? WHERE cad=?', nm, t, t, cad);
      if (F.alert) D.run('UPDATE cardiologist_alerts SET acknowledged_at=?, acknowledged_by=? WHERE cad=?', t, nm, cad);
      W.by(t, `Cardiologist acknowledged: ACKNOWLEDGE & OPEN by ${nm} · audible alarm stopped`, nm, 'key');
      return true;
    }
    case 'viewed':
      viewed(A, d, F, t, W, optName(d.name) || C.cardiologist_name || '');
      return true;
    case 'seen': /* 0.4's NEW list: kept so an older screen does not fail */
      for (const id of d.ids || []) D.run('UPDATE case_updates SET seen_at=? WHERE id=? AND cad=? AND seen_at IS NULL', t, id, cad);
      return true;
    case 'compare': {
      const nm = optName(d.name) || C.cardiologist_name || '';
      if (!C.compared_at) D.run('UPDATE cases SET compared_at=? WHERE cad=?', t, cad);
      W.by(t, `Serial ECG comparison opened by ${nm || 'the Cardiologist'} (Cardiologist): ${(d.ns || []).map(n => 'ECG ' + n).join(' | ')}`, nm, 'view');
      return true;
    }
    case 'decision': {
      if (!RULES.DECISIONS[d.k]) throw err(400, 'Unknown decision.');
      const nm = needName(d.name || C.cardiologist_name);
      needLatest(F, d.on);
      const reason = RULES.cleanText(d.reason, 300), note = RULES.cleanText(d.note), adv = RULES.cleanText(d.adv), instr = RULES.cleanText(d.instr, 300);
      if (d.k === 'not' && !reason) throw err(400, 'NOT STEMI needs a reason.');
      const reasons = (Array.isArray(d.reasons) ? d.reasons : []).map(r => RULES.cleanText(r, 100)).filter(Boolean).slice(0, 8);
      const also = (Array.isArray(d.also) ? d.also : []).filter(n => Number.isInteger(n) && n > 0 && n < d.on);
      const within = Number.isInteger(d.within) && d.within > 0 && d.within <= 240 ? d.within : null;
      const ai = ['Agree', 'Disagree', 'Did not use'].includes(d.ai) ? d.ai : null;
      /* the decision is stored first; NOT STEMI then closes the pathway as a separate event */
      D.run(`INSERT INTO decisions(id,cad,kind,on_ecg,also_json,reason,note,advice,reasons_json,instruction,within_min,ai_feedback,decided_at,received_at,decided_by,decided_by_title,user_id)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        D.uid('x'), cad, d.k, d.on, J(also), reason, note, adv, J(reasons), instr, within, ai, t, rcv, nm, `${nm}, Cardiologist`, null);
      D.run('UPDATE cases SET cardiologist_decision=?, cardiologist_decision_at=? WHERE cad=?', d.k, t, cad);
      const extra = [reason && 'reason: ' + reason, reasons.length && reasons.join(', '), instr && 'instruction: ' + instr, within && `within ${within} min`, note && 'note to the crew: ' + note, adv && 'advice: ' + adv].filter(Boolean);
      W.by(t, `Cardiologist decision: ${RULES.DECISIONS[d.k]} — ${nm} · on ECG ${d.on}${also.length ? ` (also reviewed: ${also.map(n => 'ECG ' + n).join(', ')})` : ''}${extra.length ? ' · ' + extra.join(' · ') : ''}`, nm, 'key');
      if (ai) W.by(t, `AI report feedback from ${nm}: ${ai}`, nm, 'view');
      if (d.k === 'not') {
        markClosed(cad, t, nm, null, PW.CLOSE.not);
        W.sys(t, `STEMI pathway automatically closed following the Cardiologist NOT STEMI decision — CAD #${cad} · no cath-lab activation · read-only · the CAD incident itself is not changed`, 'key');
        W.upd(t, 'closed', 'NOT STEMI — PATHWAY CLOSED', {});
      }
      return true;
    }
    case 'note':
      W.by(t, RULES.cleanText(d.text), optName(d.name) || C.cardiologist_name || '', 'view');
      return true;
    default:
      return false;
  }
}

const HANDLERS = { crew: crewOp, er: erOp, cardiologist: docOp };

/* ---------- applying a batch of actions from one screen, in order; each action is stored once ---------- */
function applyOps(A, ops) {
  const results = [], touched = new Set();
  for (const o of ops) {
    if (!o || typeof o.id !== 'string' || typeof o.k !== 'string' || o.id.length > 80) { results.push({ id: o && o.id, ok: false, error: 'This action could not be read.', status: 400 }); continue; }
    const cad = CADN.normalize(o.cad), F = cad && facts(cad);
    if (!F || (A.role === 'crew' && F.C.unit !== A.unit)) { results.push({ id: o.id, ok: false, error: 'There is no case with this CAD number for this screen.', status: 404 }); continue; }
    const seen = D.get('SELECT received_at FROM ops WHERE op_id=?', o.id);
    if (seen) { results.push({ id: o.id, ok: true, dup: true, rcv: seen.received_at }); continue; }
    const rule = PW.guard(A.role, o.k, F);
    if (rule) { results.push({ id: o.id, ok: false, error: rule, status: 409 }); continue; }
    const rcv = Date.now(), W = writer(cad, A);
    o.t = sane(o.t, rcv);
    try {
      D.tx(() => {
        D.run('INSERT INTO ops(op_id,cad,user_id,role,kind,device_time,received_at,payload_json) VALUES(?,?,?,?,?,?,?,?)', o.id, cad, A.id || A.device, A.role, o.k, o.t, rcv, J(o.data || {}));
        const fn = HANDLERS[A.role];
        if (!fn || !fn(A, o, F, rcv, W)) throw err(403, `"${o.k}" is not an action for the ${A.role} screen.`);
        /* an entry saved on the tablet while it was offline keeps both times: when it was saved and when it was received */
        const me = A.role === 'crew' ? crewT(A) : null;
        W.flush(me && rcv - o.t > 5000 ? a => { if (a.who === me) a.text += a.t === rcv ? ` · saved on the tablet ${hms(o.t)}, received on reconnection` : ` · received ${hms(rcv)}, on reconnection`; } : null);
      });
      results.push({ id: o.id, ok: true, rcv });
      touched.add(cad);
    } catch (e) {
      results.push({ id: o.id, ok: false, error: e.status ? e.message : 'The server could not store this action.', status: e.status || 500 });
      if (!e.status) console.error('action failed', o.k, e);
    }
  }
  touched.forEach(push);
  return results;
}

/* ---------- closing the STEMI pathway (never the operational CAD incident: ICCC and ePCR own that) ----------
   Three ways: the ER Doctor's NOT SUSPICIOUS FOR STEMI (cardiology not activated), the Cardiologist's NOT STEMI (closed
   automatically), or the crew's COMPLETE STEMI PATHWAY after CONFIRMED STEMI. The case stays stored, moves to Completed
   and is read-only. No handover documentation is asked for: it belongs to ICCC / ePCR. */
function markClosed(cad, t, byT, userId, why) {
  D.run("UPDATE cases SET status='closed', closed_at=?, closed_by=?, closed_user_id=?, closure_reason=?, closure_source=? WHERE cad=?", t, byT, userId, why.reason, why.source, cad);
}
function completeCase(A, raw) {
  const cad = CADN.normalize(raw), F = cad && facts(cad);
  if (!F || F.C.unit !== A.unit) return { status: 'missing', cad };
  if (F.C.closed_at) return { status: 'closed', cad, kind: PW.closedKind(F.C) };
  if (F.state !== 'confirmed') return { status: 'incomplete', cad, state: F.state, error: 'COMPLETE STEMI PATHWAY is available only while the current Cardiologist decision is CONFIRMED STEMI.' };
  const t = Date.now(), ME = crewT(A), W = writer(cad, A);
  D.tx(() => {
    markClosed(cad, t, ME, A.id, PW.CLOSE.crew);
    W.by(t, `STEMI pathway completed and closed by ${ME} (${F.C.unit}) — CAD #${cad} · read-only · the CAD incident itself is not changed`, ME, 'key');
    W.upd(t, 'closed', 'STEMI PATHWAY COMPLETED', {});
    W.flush();
  });
  push(cad);
  return { status: 'completed', cad };
}

/* ---------- who may see which case ---------- */
/* on the live screens (the test console sees every case, including those taken off the screens) */
function canSee(A, F) {
  if (A.role === 'control') return true;
  if (!F.C.active) return false;
  if (A.role === 'crew') return F.C.unit === A.unit;
  if (A.role === 'er') return !!F.C.server_received_at;
  if (A.role === 'cardiologist') return !!F.activated;
  return false;
}
/* opened by CAD number (completed cases): the cardiologist finds an ER-closed case only by searching for it, and sees
   that cardiology was not activated */
function canView(A, F, searching) {
  if (A.role === 'control') return true;
  if (A.role === 'crew') return F.C.unit === A.unit;
  if (A.role === 'er') return !!F.C.server_received_at;
  if (A.role === 'cardiologist') return !!F.activated || (searching && RULES.isClosed(F.state));
  return false;
}
function caseSummary(F) {
  const C = F.C, cur = (tb, k) => D.get(`SELECT value_text v FROM ${tb} WHERE cad=? AND field=? ORDER BY received_at DESC, rowid DESC LIMIT 1`, C.cad, k);
  const e1 = D.get('SELECT acquired_at FROM ecgs WHERE cad=? AND n=1', C.cad);
  const v = k => { const r = cur(ptTable(k), k); return r ? r.v : null; };
  return {
    cad: C.cad, unit: C.unit, state: F.state, legacy: F.legacy, active: !!C.active, created: C.created_at,
    closedAt: C.closed_at || null, closedBy: C.closed_by || null, kind: C.closed_at ? PW.closedKind(C) : null,
    pt: { age: v('age'), sex: v('sex'), complaint: v('complaint') }, ecgAt: e1 ? e1.acquired_at : null,
    er: { name: C.er_doctor_name || null, assessment: C.er_assessment || null, reason: C.er_non_activation_reason || null },
    cardio: { activated: F.activated || null, name: C.cardiologist_name || (F.legacy && F.alert && F.alert.acknowledged_by) || null, decision: F.lastDec ? F.lastDec.kind : null }
  };
}
/* completed cases, found by CAD number (part of it is enough); newest first */
function listClosed(A, q) {
  const n = CADN.normalize(q || '').replace(/[^0-9A-Z-]/g, ''), out = [];
  for (const r of D.all('SELECT cad FROM cases WHERE closed_at IS NOT NULL AND cad LIKE ? ORDER BY closed_at DESC LIMIT 200', `%${n}%`)) {
    const F = facts(r.cad);
    if (F && canView(A, F, n.length >= 4)) out.push(caseSummary(F));
    if (out.length >= 50) break;
  }
  return out;
}
/* one case by CAD number, read-only, for a screen allowed to open it */
function viewCase(A, raw) {
  const F = facts(CADN.normalize(raw));
  return F && canView(A, F, true) ? snapshot(F.C.cad, F) : null;
}

/* ---------- the case under the CAD number the crew entered manually ---------- */
const casePublic = C => ({ cad: C.cad, active: !!C.active, submittedAt: C.server_received_at || null, unit: C.unit, openedAt: C.pathway_opened_at || C.created_at, closedAt: C.closed_at || null });
/* is this CAD number valid, and is there already a case under it? (the tablet asks before sending) */
function checkCad(raw) {
  const c = CADN.check(raw);
  if (!c.ok) return { ok: false, cad: c.cad, error: c.error, detail: c.detail };
  const C = caseRow(c.cad);
  return { ok: true, cad: c.cad, exists: !!C, ...(C ? { existing: casePublic(C) } : {}) };
}
/* create the case when the crew sends it. The CAD number is the one the EMT typed, normalised; a second case under the
   same number is never created and an existing case is never overwritten. Resending the same create (same tablet case
   id) is harmless. → { status: 'created' | 'same' | 'exists' | 'invalid', ... } */
function createCase(A, b, source) {
  const c = CADN.check(b && b.cad);
  if (!c.ok) return { status: 'invalid', cad: c.cad, error: c.error, detail: c.detail };
  const cad = c.cad, cid = String((b && b.cid) || '').slice(0, 64) || null, rcv = Date.now();
  const ex = caseRow(cad);
  if (ex) {
    if (cid && ex.created_cid === cid) return { status: 'same', cad };
    return { status: 'exists', cad, existing: casePublic(ex) };
  }
  const crew = A.role === 'crew' ? A : { ...seed.crewUser(), device: A.device };
  const ME = crewT(crew), UNIT = crew.unit, src = source || 'manual-crew';
  const ok = t => (Number.isFinite(t) && t > rcv - 24 * 3600e3 && t <= rcv + 60e3 ? t : rcv);
  const openedAt = ok(+b.openedAt), hist = (Array.isArray(b.hist) ? b.hist : []).slice(-10).map(h => ({ v: CADN.normalize(h && h.v), t: ok(+(h && h.t)) })).filter(h => h.v);
  const enteredAt = hist.length ? hist[hist.length - 1].t : openedAt;
  const how = src === 'manual-crew' ? 'CAD number manually entered by crew from dispatch/MDT information' : 'CAD number entered in the test console (fictional demo case)';
  const W = writer(cad, crew);
  D.tx(() => {
    D.run(`INSERT INTO cases(cad,active,unit,emirate,crew_name,incident_type,created_at,pathway_opened_at,pathway_opened_by,cad_source,cad_entered_at,cad_entered_by,created_cid)
           VALUES(?,1,?,?,?,?,?,?,?,?,?,?,?)`, cad, UNIT, crew.emirate || '', ME, 'STEMI pathway', rcv, openedAt, ME, src, enteredAt, ME, cid);
    W.by(openedAt, `STEMI case opened by ${ME} (${UNIT}) — CAD #${cad} · ${how}`, ME, 'key');
    hist.forEach((h, i) => { if (i > 0 && h.v !== hist[i - 1].v) W.by(h.t, `CAD number corrected by crew before sending: CAD #${hist[i - 1].v} → CAD #${h.v} · nothing had been sent`, ME, 'key'); });
    W.sys(rcv, `Case created on the platform under CAD #${cad} (CAD number checked: no existing case with this number)`, 'key');
    W.flush();
  });
  push(cad);
  return { status: 'created', cad };
}
/* CASE ALREADY EXISTS → OPEN EXISTING CASE: the existing case opens on the tablet; nothing is created or changed */
function openExisting(A, raw) {
  const c = CADN.check(raw);
  if (!c.ok) return { status: 'invalid', cad: c.cad, error: c.error, detail: c.detail };
  const F = facts(c.cad);
  if (!F) return { status: 'missing', cad: c.cad };
  if (F.C.unit !== A.unit) return { status: 'other-unit', cad: c.cad };
  const t = Date.now(), W = writer(c.cad, A);
  D.tx(() => {
    if (!F.C.active) D.run('UPDATE cases SET active=1 WHERE cad=?', c.cad);
    W.by(t, `Existing case CAD #${c.cad} opened on the ${A.unit} tablet by ${crewT(A)} · the same CAD number was entered again; no second case created`, crewT(A), 'key');
    W.flush();
  });
  push(c.cad);
  return { status: 'opened', cad: c.cad, rec: snapshot(c.cad) };
}
/* the test console takes a case off every live screen, or returns it. Clinically nothing changes: the STEMI pathway is
   NOT closed (only COMPLETE STEMI PATHWAY, NOT STEMI or the ER Doctor's NOT SUSPICIOUS FOR STEMI close it) */
function setOnScreens(A, raw, on) {
  const cad = CADN.normalize(raw), C = cad && caseRow(cad);
  if (!C) return false;
  if (!!C.active === !!on) return true;
  const W = writer(cad, A);
  D.run('UPDATE cases SET active=? WHERE cad=?', on ? 1 : 0, cad);
  W.by(Date.now(), on ? `Case CAD #${cad} returned to the live screens from the test console` : `Case CAD #${cad} taken off the live screens from the test console · kept in the database · the STEMI pathway is not closed`, 'Test console', 'key');
  W.flush();
  push(cad);
  return true;
}

/* ---------- the AI service: starts once the ECG is stored, never delays an alert, never sounds ---------- */
function aiRun(cad, n) {
  setTimeout(() => {
    if (!caseRow(cad)) return;
    const start = Date.now();
    D.run('INSERT OR IGNORE INTO ai_interpretations(cad,ecg_n,status,started_at,provider) VALUES(?,?,?,?,?)', cad, n, 'proc', start, cfg.AI_PROVIDER);
    const W = writer(cad, SYS);
    W.sys(start, `AI analysis of ECG ${n} started (Primary image)`, 'evt', 'AI service (simulated)');
    W.flush(); push(cad);
    if (D.sim().ai === 'proc') return; /* held at "processing" by the test console */
    setTimeout(() => aiFinish(cad, n).catch(e => console.error('AI', e)), cfg.MOCK_AI_DELAY_MS);
  }, 1200);
}
async function aiFinish(cad, n) {
  const a = D.get('SELECT * FROM ai_interpretations WHERE cad=? AND ecg_n=?', cad, n);
  if (!a || a.status !== 'proc') return;
  const e = D.get('SELECT * FROM ecgs WHERE cad=? AND n=?', cad, n);
  if (!e) return;
  const pri = D.get('SELECT * FROM ecg_images WHERE cad=? AND ecg_n=? AND i=?', cad, n, e.primary_image) || D.get('SELECT * FROM ecg_images WHERE cad=? AND ecg_n=? ORDER BY i LIMIT 1', cad, n);
  const pe = n > 1 ? D.get('SELECT * FROM ecgs WHERE cad=? AND n=?', cad, n - 1) : null;
  const pa = pe ? D.get('SELECT * FROM ai_interpretations WHERE cad=? AND ecg_n=?', cad, n - 1) : null;
  let out;
  try {
    out = await AI.provider().analyse({
      cad,
      ecg: { n, acq: e.acquired_at, variant: e.variant, same: !!e.same_as_previous, pri: e.primary_image, primary: { quality: pri ? pri.quality : 'good', source: pri ? pri.source : 'file', filePath: pri ? pri.file_name : null } },
      previous: pe ? { n: pe.n, acq: pe.acquired_at, ai: pa ? { st: pa.status } : null } : null,
      unavailable: D.sim().ai === 'down'
    });
  } catch (x) {
    console.error('AI service failed', x);
    out = { st: 'down', result: { ver: 'AI service error' } };
  }
  const t = Date.now();
  D.run('UPDATE ai_interpretations SET status=?, completed_at=?, version=?, result_json=? WHERE cad=? AND ecg_n=?', out.st, t, out.result.ver || '', J(out.result), cad, n);
  const txt = { ok: `AI analysis completed · ECG ${n}`, lim: `AI interpretation limited — ECG quality insufficient · ECG ${n}`, wh: `AI interpretation limited — ECG quality insufficient · ECG ${n}`, down: `AI interpretation unavailable · ECG ${n}` }[out.st];
  const W = writer(cad, SYS);
  W.sys(t, `${txt} (acquired ${hms(e.acquired_at)})${out.result.imp ? ` · impression: ${out.result.imp}` : ''} · the same analysis is shown on every screen · decision support only`, 'key', 'AI service (decision support, simulated)');
  W.upd(t, 'ai', txt, { n });
  W.flush(); push(cad);
}
/* analyses held at "processing" finish once the test console lets them, and after a server restart */
function aiResume() {
  if (D.sim().ai === 'proc') return;
  D.all("SELECT cad, ecg_n FROM ai_interpretations WHERE status='proc'").forEach(r => setTimeout(() => aiFinish(r.cad, r.ecg_n).catch(console.error), 1500));
}

/* ---------- the shared case record, in the shape every screen reads ---------- */
function snapshot(cad, F) {
  F = F || facts(cad);
  if (!F) return null;
  const C = F.C, A = F.alert;
  const R = {
    cad, unit: C.unit, emirate: C.emirate, crew: C.crew_name, state: F.state, legacy: F.legacy, active: !!C.active, created: C.created_at,
    cadEntry: { src: C.cad_source || 'simulated-feed', at: C.cad_entered_at, by: C.cad_entered_by },
    path: { at: C.pathway_opened_at || C.created_at, by: C.pathway_opened_by || C.crew_name },
    sub: C.server_received_at ? { send: C.submitted_at, rcv: C.server_received_at, late: !!C.delivered_late } : null,
    er: {
      alerted: C.er_alerted_at || null, shown: C.er_alert_shown_at || null, name: C.er_doctor_name || null, accepted: C.er_accepted_at || null,
      assessment: C.er_assessment || null, at: C.er_assessment_at || null, by: C.er_assessed_by || null, on: C.er_assessment_ecg || null,
      reason: C.er_non_activation_reason || null, comment: C.er_non_activation_comment || null, crewAck: C.er_outcome_seen_at || null
    },
    cardio: {
      activated: F.activated || null, by: C.cardiology_activated_by || null,
      reason: C.cardiology_activation_reason || (F.legacy ? 'Sent directly to the cardiologist (case made before ER review was introduced)' : null),
      alerted: A ? A.alerted_at : null, shown: A ? A.shown_at : null, ack: F.acked || null,
      name: C.cardiologist_name || (F.legacy && A ? A.acknowledged_by : null) || null, opened: C.opened_at || null,
      decision: F.lastDec ? F.lastDec.kind : null, decisionAt: F.lastDec ? F.lastDec.decided_at : null
    },
    pt: {}, rec: {}, ecgs: [], dec: [], upd: [], audit: [], views: { er: {}, cardiologist: {} },
    hopen: C.handover_opened_at || null,
    closed: C.closed_at ? { at: C.closed_at, by: C.closed_by, reason: C.closure_reason || PW.CLOSE.crew.reason, source: C.closure_source || 'crew', kind: PW.closedKind(C) } : null
  };
  for (const tb of ['patient_details', 'observations']) {
    D.all(`SELECT rowid, * FROM ${tb} WHERE cad=? ORDER BY received_at, rowid`, cad).forEach(r => {
      (R.pt[r.field] || (R.pt[r.field] = [])).push({ id: r.id, v: r.value_text, raw: P(r.raw_json), t: r.taken_at, rcv: r.received_at, by: r.entered_by, kind: r.entry_kind, why: r.reason || '' });
    });
  }
  D.all('SELECT rowid, * FROM treatments WHERE cad=? ORDER BY received_at, rowid', cad).forEach(r => {
    const x = R.rec[r.item_key] || (R.rec[r.item_key] = { label: r.label, group: r.category, vers: [] });
    x.vers.push({ id: r.id, v: r.value_text, nv: !!r.not_obtained, t: r.taken_at, rcv: r.received_at, by: r.entered_by, kind: r.entry_kind });
  });
  const ais = {};
  D.all('SELECT * FROM ai_interpretations WHERE cad=?', cad).forEach(a => {
    ais[a.ecg_n] = { st: a.status, start: a.started_at, ...(a.status !== 'proc' ? { done: a.completed_at, ...P(a.result_json) } : {}) };
  });
  D.all('SELECT * FROM ecgs WHERE cad=? ORDER BY n', cad).forEach(e => {
    const imgs = D.all('SELECT * FROM ecg_images WHERE cad=? AND ecg_n=? ORDER BY i', cad, e.n).map(x => ({
      i: x.i, kind: x.kind, q: x.quality, at: x.captured_at, rcv: x.received_at, after: !!x.added_after_send, src: x.source, url: `/files/${x.id}`
    }));
    R.ecgs.push({ n: e.n, acq: e.acquired_at, variant: e.variant, pri: e.primary_image, same: !!e.same_as_previous, sent: e.sent_at, rcv: e.received_at, by: e.sent_by, why: e.time_reason || '', imgs, ai: ais[e.n] || null });
  });
  D.all('SELECT * FROM ecg_role_views WHERE cad=?', cad).forEach(v => { (R.views[v.role] || (R.views[v.role] = {}))[v.ecg_n + '|' + v.i] = v.viewed_at; });
  D.all('SELECT * FROM ecg_views WHERE cad=?', cad).forEach(v => { const k = v.ecg_n + '|' + v.i; if (!R.views.cardiologist[k]) R.views.cardiologist[k] = v.viewed_at; });
  R.dec = D.all('SELECT rowid, * FROM decisions WHERE cad=? ORDER BY decided_at, rowid', cad).map(x => ({
    id: x.id, k: x.kind, at: x.decided_at, rcv: x.received_at, by: x.decided_by, byT: x.decided_by_title, on: x.on_ecg, also: P(x.also_json) || [],
    reason: x.reason || '', note: x.note || '', adv: x.advice || '', reasons: P(x.reasons_json) || [], instr: x.instruction || '', within: x.within_min, ai: x.ai_feedback, dlv: x.delivered_at, crewAck: x.crew_ack_at
  }));
  R.upd = D.all('SELECT rowid, * FROM case_updates WHERE cad=? ORDER BY at, rowid', cad).map(u => ({ id: u.id, at: u.at, kind: u.kind, text: u.text, ref: P(u.ref_json) || {} }));
  R.audit = D.all('SELECT * FROM audit_events WHERE cad=? ORDER BY at, id', cad).map((a, i) => ({ t: a.at, text: a.action, who: a.actor || '', role: a.role || '', kind: a.kind, i }));
  return R;
}

/* ---------- pushing: each changed case goes to every screen allowed to see it ---------- */
const dirty = new Set();
let pushQ = null;
function push(cad) {
  if (cad) dirty.add(cad);
  if (pushQ) return;
  pushQ = setImmediate(() => {
    pushQ = null;
    const cads = [...dirty], at = Date.now();
    dirty.clear();
    for (const cad of cads) {
      const F = facts(cad), rec = F ? snapshot(cad, F) : null;
      live.each(c => {
        if (F && canSee(c.actor, F)) { live.write(c, 'case', { cad, rec, at }); c.cads.add(cad); }
        else if (c.cads.has(cad)) { live.write(c, 'case', { cad, rec: null, at }); c.cads.delete(cad); }
      });
    }
  });
}
/* what a screen gets when it connects: every open case it may see (the test console also gets the last closed ones) */
function hello(c) {
  const A = c.actor, at = Date.now(), list = [];
  const rows = A.role === 'control'
    ? D.all('SELECT cad FROM cases WHERE closed_at IS NULL UNION SELECT cad FROM (SELECT cad FROM cases WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 12)')
    : D.all('SELECT cad FROM cases WHERE closed_at IS NULL AND active=1 ORDER BY created_at');
  c.cads.clear();
  for (const r of rows) {
    const F = facts(r.cad);
    if (F && canSee(A, F)) { list.push(snapshot(r.cad, F)); c.cads.add(r.cad); }
  }
  const out = [['init', { now: at, epoch: D.epoch(), role: A.role }], ['cfg', { sim: D.sim() }], ['cases', { list, at }]];
  if (A.role === 'control') out.push(['presence', live.presence()]);
  return out;
}
/* after the test data is reset: every screen starts afresh */
function restartScreens() { live.each(c => { for (const [ev, data] of hello(c)) live.write(c, ev, data); }); }
live.onPresence(() => live.broadcast('presence', live.presence(), c => c.role === 'control'));

/* ---------- a pre-filled fictional case for demonstrations (test console) ----------
   The tester types the CAD number (checked and normalised like the crew's entry; a duplicate is refused). The case is
   then sent exactly as the crew MDT would send it: ECG 1 (the sample test image) and the minimum data go through the
   same crew actions, so the ER gets the normal NEW STEMI CASE alarm and the mock AI analyses ECG 1. */
function demoCase(A, rawCad) {
  const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
  const crew = { ...seed.crewUser(), device: A.device };
  const r = createCase(crew, { cad: rawCad, openedAt: Date.now() - 5000 }, 'manual-test-console');
  if (r.status !== 'created') return r;
  const cad = r.cad, buf = fs.readFileSync(path.join(cfg.ROOT, 'samples', 'test-ecg-1-borderline-anterior.jpg'));
  const imageId = D.uid('img'), file = imageId + '.jpg', t = Date.now();
  fs.writeFileSync(path.join(cfg.IMAGE_DIR, file), buf);
  D.run('INSERT INTO ecg_images(id,cad,uploaded_at,source,file_name,mime,bytes,sha256,uploaded_by) VALUES(?,?,?,?,?,?,?,?,?)',
    imageId, cad, t - 3500, 'file', file, 'image/jpeg', buf.length, crypto.createHash('sha256').update(buf).digest('hex'), crewT(crew));
  const id = k => `demo-${cad}-${k}`, mdT = t - 2000;
  const md = {
    age: { v: '58 y', raw: { v: 58, est: false }, t: mdT },
    sex: { v: 'Male', raw: { v: 'Male' }, t: mdT },
    complaint: { v: 'Chest pain', raw: { v: 'cp' }, t: mdT },
    onset: { v: `${hm(t - 45 * 60000)} (approximate)`, raw: { v: t - 45 * 60000, approx: true }, t: mdT },
    bp: { v: '142/88 mmHg', raw: { sys: 142, dia: 88 }, t: mdT },
    hr: { v: '88 bpm', raw: { v: 88 }, t: mdT },
    spo2: { v: '97 %', raw: { v: 97 }, t: mdT },
    gcs: { v: '15', raw: { v: 15 }, t: mdT }
  };
  const variant = D.sim().find === 'clear' ? 'clear' : 'border';
  applyOps(crew, [{ id: id('submit'), cad, k: 'submit', t: t - 1000, data: { sendAt: t - 1000, late: false, md,
    ecg: { n: 1, acq: t - 3000, variant, pri: 1, same: false, timeWhy: null, imgs: [{ i: 1, kind: 'full', q: 'file', at: t - 3000, imageId }] } } }]);
  return r;
}

/* every case for the test console, newest first */
function consoleCases() {
  return D.all('SELECT cad FROM cases ORDER BY created_at DESC LIMIT 100').map(r => caseSummary(facts(r.cad)));
}

module.exports = {
  applyOps, snapshot, push, hello, restartScreens, demoCase, checkCad, createCase, openExisting, setOnScreens, completeCase,
  listClosed, viewCase, consoleCases, aiResume, aiFinish, facts
};
