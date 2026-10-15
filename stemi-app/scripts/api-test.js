/* The platform's rules, checked through the API alone (no browser): the backend is the authority.
   - every state transition the pathway allows, and every one it must refuse
   - closed cases are read-only (scenario 14); the cardiologist never sees a case before the ER activates it (scenario 15)
   - clinician names are validated and recorded per CAD number; roles are kept apart
   - a case made by 0.4.0 (no ER step) still opens
   Run: npm run test:api     Fictional test data only; its own server, port and temporary database. */
const H = require('./lib/harness');
const R = H.Results('API tests');
const ok = R.ok;

async function main() {
  let S = await H.startServer({ MOCK_AI_DELAY_MS: '300' });
  try {
    const crew = H.Api(S.BASE, 'crew'), er = H.Api(S.BASE, 'er'), doc = H.Api(S.BASE, 'cardiologist'), con = H.Api(S.BASE, 'control'), anon = H.Api(S.BASE, 'crew');
    await crew.start(); await er.start(); await doc.start(); await con.start();

    /* ---------- sessions and roles ---------- */
    ok('A1', 'Without a session the API refuses (401)', (await anon.req('GET', '/api/cases')).status === 401);
    ok('A2', 'The ER screen cannot create a case', (await er.req('POST', '/api/cases', { cad: H.cad(1) })).status === 403);
    ok('A3', 'The cardiologist screen cannot upload ECG images', (await doc.upload(H.cad(1))).status === 403);
    ok('A4', 'The crew cannot use the test console', (await crew.req('POST', '/api/control/reset')).status === 403);
    const h = await anon.req('GET', '/health');
    ok('A5', 'Health answers without a login and shows no cases, users or secrets', h.status === 200 && h.body.status === 'ok' && h.body.version === require('../package.json').version && !/cad|crew@|secret|password/i.test(JSON.stringify(h.body)));

    /* ---------- case A: the full pathway, with every refusal on the way ---------- */
    const A = H.cad(101);
    const created = await crew.req('POST', '/api/cases', { cad: `cad # ${A}`, cid: 'a1', openedAt: Date.now() - 60e3 });
    ok('A6', 'CAD number normalised on create ("cad # …" → canonical)', created.status === 201 && created.body.cad === A, created.body && created.body.cad);
    ok('A7', 'Duplicate CAD number refused (CASE ALREADY EXISTS)', (await crew.req('POST', '/api/cases', { cad: A, cid: 'other' })).status === 409);
    ok('A8', 'The same tablet resending its create is harmless', (await crew.req('POST', '/api/cases', { cad: A, cid: 'a1' })).body.status === 'same');
    ok('A9', 'Before SEND: the ER cannot accept a case that was not sent', !(await er.one(A, 'er_accept', { name: 'Dr. Early' })).ok);
    await crew.req('POST', '/api/cases', { cad: A, cid: 'a1' });
    const up = await crew.upload(A), t = Date.now();
    const sub = await crew.one(A, 'submit', { sendAt: t, md: { age: { v: '61 y', raw: { v: 61 }, t } }, ecg: { n: 1, acq: t - 30e3, variant: 'border', pri: 1, imgs: [{ i: 1, kind: 'full', q: 'file', at: t - 30e3, imageId: up.body.id }] } });
    ok('A10', 'SEND: case and ECG 1 received', sub.ok, sub.error);
    let a = await crew.view(A);
    ok('A11', 'State after SEND: SENT TO ER; the ER was alerted, the Cardiologist was not', a.state === 'sent_to_er' && a.er.alerted && !a.cardio.activated && !a.cardio.alerted);
    ok('A12', '[15] The cardiologist cannot open a case before the ER activates cardiology', (await doc.req('GET', '/api/cases/view?cad=' + A)).status === 404);
    ok('A13', '[15] …nor act on it', /not been activated/.test((await doc.one(A, 'ack', { name: 'Dr. Card' })).error || ''));
    ok('A14', 'SENT TO ER cannot jump to CONFIRMED STEMI', !(await doc.one(A, 'decision', { k: 'confirm', on: 1, name: 'Dr. Card' })).ok);
    ok('A15', 'COMPLETE refused while SENT TO ER', (await crew.req('POST', '/api/cases/complete', { cad: A })).status === 409);
    ok('A16', 'The ER assessment is refused before acceptance', /Accept the case/.test((await er.one(A, 'er_assess', { kind: 'activate', on: 1, name: 'Dr. Test ER' })).error || ''));
    for (const [bad, why] of [['', 'empty'], ['    ', 'spaces only'], ['A', 'one character'], ['x'.repeat(81), '81 characters'], ['12345', 'no letters']]) {
      ok('A17', `Clinician name refused: ${why}`, !(await er.one(A, 'er_accept', { name: bad })).ok);
    }
    ok('A18', 'ER accept with a valid name', (await er.one(A, 'er_accept', { name: '  Dr.   Test   ER  ' })).ok);
    a = await er.view(A);
    ok('A19', 'The name is trimmed and saved with the acceptance time: ER REVIEWING', a.state === 'er_reviewing' && a.er.name === 'Dr. Test ER' && a.er.accepted > 0, a.er.name);
    ok('A20', 'A second acceptance changes nothing (first ER Doctor kept)', (await er.one(A, 'er_accept', { name: 'Dr. Someone Else' })).ok && (await er.view(A)).er.name === 'Dr. Test ER');
    ok('A21', 'COMPLETE refused while the ER reviews', (await crew.req('POST', '/api/cases/complete', { cad: A })).status === 409);
    ok('A22', 'NOT SUSPICIOUS refused without a reason', /reason/i.test((await er.one(A, 'er_assess', { kind: 'not_suspicious', on: 1, name: 'Dr. Test ER' })).error || ''));
    ok('A23', 'NOT SUSPICIOUS refused with an unknown reason', !(await er.one(A, 'er_assess', { kind: 'not_suspicious', reason: 'made-up', on: 1, name: 'Dr. Test ER' })).ok);
    ok('A24', 'NOT SUSPICIOUS + OTHER refused without an explanation', /OTHER/.test((await er.one(A, 'er_assess', { kind: 'not_suspicious', reason: 'other', comment: '   ', on: 1, name: 'Dr. Test ER' })).error || ''));
    ok('A25', 'An assessment naming an older ECG than the latest is refused', !(await er.one(A, 'er_assess', { kind: 'activate', on: 0, name: 'Dr. Test ER' })).ok);
    ok('A26', 'ER: ACTIVATE CARDIOLOGIST', (await er.one(A, 'er_assess', { kind: 'activate', on: 1, name: 'Dr. Test ER' })).ok);
    a = await doc.view(A);
    ok('A27', 'Cardiology activated: the cardiologist now sees the same case (same CAD number)', a && a.cad === A && a.state === 'cardiology_activated' && a.cardio.activated && a.cardio.alerted);
    ok('A28', 'A second ER assessment is refused', /already recorded/.test((await er.one(A, 'er_assess', { kind: 'uncertain', on: 1, name: 'Dr. Test ER' })).error || ''));
    ok('A29', 'A decision before ACKNOWLEDGE & OPEN is refused', /Acknowledge/.test((await doc.one(A, 'decision', { k: 'confirm', on: 1, name: 'Dr. Card' })).error || ''));
    ok('A30', 'Cardiologist ack refused without a name', !(await doc.one(A, 'ack', { name: ' ' })).ok);
    ok('A31', 'Cardiologist ACKNOWLEDGE & OPEN', (await doc.one(A, 'ack', { name: 'Dr. Test Cardiology' })).ok);
    a = await doc.view(A);
    ok('A32', 'Cardiologist name and time saved: CARDIOLOGIST REVIEWING', a.state === 'cardiologist_reviewing' && a.cardio.name === 'Dr. Test Cardiology' && a.cardio.ack > 0);
    ok('A33', 'COMPLETE refused while the cardiologist reviews', (await crew.req('POST', '/api/cases/complete', { cad: A })).status === 409);
    ok('A34', 'NOT STEMI refused without a reason', !(await doc.one(A, 'decision', { k: 'not', on: 1, name: 'Dr. Test Cardiology' })).ok);
    ok('A35', 'UNCLEAR — REPEAT ECG REQUESTED', (await doc.one(A, 'decision', { k: 'repeat', on: 1, reasons: ['Poor ECG quality'], name: 'Dr. Test Cardiology' })).ok);
    ok('A36', 'State REPEAT ECG REQUESTED; COMPLETE refused', (await crew.view(A)).state === 'repeat_requested' && (await crew.req('POST', '/api/cases/complete', { cad: A })).status === 409);
    ok('A37', 'An ECG with the wrong number is refused (no gaps, nothing replaced)', !(await crew.one(A, 'ecg', { sendAt: Date.now(), ecg: { n: 3, acq: Date.now(), pri: 1, imgs: [] } })).ok);
    const up2 = await crew.upload(A, 'test-ecg-2-evolving-anterior.jpg');
    ok('A38', 'Repeat ECG 2 sent', (await crew.one(A, 'ecg', { sendAt: Date.now(), ecg: { n: 2, acq: Date.now() - 5e3, variant: 'evolved', pri: 1, imgs: [{ i: 1, kind: 'full', q: 'file', at: Date.now() - 5e3, imageId: up2.body.id }] } })).ok);
    ok('A39', 'State: repeat ECG received, cardiologist reviewing', (await crew.view(A)).state === 'repeat_received');
    ok('A40', 'A decision on ECG 1 after ECG 2 arrived is refused', /ECG 2 has arrived/.test((await doc.one(A, 'decision', { k: 'confirm', on: 1, name: 'Dr. Test Cardiology' })).error || ''));
    ok('A41', 'CONFIRMED STEMI on ECG 2', (await doc.one(A, 'decision', { k: 'confirm', on: 2, name: 'Dr. Test Cardiology' })).ok);
    ok('A42', 'Only the crew completes the STEMI pathway', (await er.req('POST', '/api/cases/complete', { cad: A })).status === 403);
    const done = await crew.req('POST', '/api/cases/complete', { cad: A });
    ok('A43', 'COMPLETE STEMI PATHWAY after CONFIRMED STEMI', done.status === 200 && done.body.status === 'completed');
    a = await crew.view(A);
    ok('A44', 'Completed: closure time, crew user, reason and source saved; decision history kept', a.state === 'completed' && a.closed.source === 'crew' && a.closed.reason === 'STEMI pathway completed' && /K\. Ahmed/.test(a.closed.by) && a.dec.map(d => d.k).join() === 'repeat,confirm');

    /* ---------- scenario 14: a closed case is read-only, whoever asks ---------- */
    const refused = r => !r.ok && /read-only/.test(r.error || '');
    ok('A45', '[14] Closed: new vital signs refused', refused(await crew.one(A, 'md', { k: 'bp', v: '120/70 mmHg', kind: 'update' })));
    ok('A46', '[14] Closed: a new ECG refused', refused(await crew.one(A, 'ecg', { sendAt: Date.now(), ecg: { n: 3, acq: Date.now(), pri: 1, imgs: [] } })));
    ok('A47', '[14] Closed: an image upload refused', (await crew.upload(A)).status === 409);
    ok('A48', '[14] Closed: a treatment update refused', refused(await crew.one(A, 'rec', { k: 'asp', label: 'Aspirin', v: 'Given' })));
    ok('A49', '[14] Closed: a new decision refused', refused(await doc.one(A, 'decision', { k: 'not', on: 2, reason: 'x', name: 'Dr. Test Cardiology' })));
    ok('A50', '[14] Closed: an ER assessment refused', refused(await er.one(A, 'er_assess', { kind: 'activate', on: 2, name: 'Dr. Test ER' })));
    ok('A51', '[14] Closed: completing again refused (409)', (await crew.req('POST', '/api/cases/complete', { cad: A })).status === 409);
    ok('A52', '[14] Closed: viewing is still allowed and recorded', (await doc.one(A, 'viewed', { n: 2, i: 1, name: 'Dr. Test Cardiology' })).ok);

    /* ---------- case B: ER NOT SUSPICIOUS FOR STEMI closes the screening pathway; no cardiologist involvement ---------- */
    const B = H.cad(102);
    ok('B1', 'Case B sent', (await H.apiSend(crew, B)).submit.ok);
    await er.one(B, 'er_accept', { name: 'Dr. Beta' });
    ok('B2', 'ER: NOT SUSPICIOUS FOR STEMI with reason OTHER and an explanation', (await er.one(B, 'er_assess', { kind: 'not_suspicious', reason: 'other', comment: '  Test explanation  ', on: 1, name: 'Dr. Beta' })).ok);
    const b = await er.view(B);
    ok('B3', 'Closed by the ER Doctor: reason, comment, closure reason and source saved', b.state === 'er_closed' && b.er.reason === 'OTHER' && b.er.comment === 'Test explanation' && b.closed.reason === 'ER Doctor assessment: NOT SUSPICIOUS FOR STEMI' && b.closed.source === 'ER Doctor screening decision');
    ok('B4', 'No cardiology activation and no cardiologist decision was created', !b.cardio.activated && !b.cardio.alerted && b.dec.length === 0 && H.db(S.DATA, `SELECT COUNT(*) n FROM decisions WHERE cad='${B}'`)[0].n === 0);
    ok('B5', 'The cardiologist cannot acknowledge or decide on it', !(await doc.one(B, 'ack', { name: 'Dr. X' })).ok && !(await doc.one(B, 'decision', { k: 'confirm', on: 1, name: 'Dr. X' })).ok);
    const list = (await doc.req('GET', '/api/cases?q=')).body.cases, search = (await doc.req('GET', '/api/cases?q=' + B.slice(-6))).body.cases;
    ok('B6', 'Cardiologist Completed list: ER-closed cases only when searched for, shown as CARDIOLOGY NOT ACTIVATED', !list.some(x => x.cad === B) && search.some(x => x.cad === B && x.state === 'er_closed'));
    ok('B7', 'The CAD record itself is unchanged (same CAD number, nothing cancelled)', b.cad === B && !JSON.stringify(b.audit).includes('CANCELLED'));
    const audB = H.auditOf(S.DATA, B).map(x => x.action);
    ['ER Doctor assessment: NOT SUSPICIOUS FOR STEMI — Dr. Beta', 'Reason: OTHER', 'Comment: Test explanation', 'Cardiology not activated', 'STEMI screening pathway closed following ER Doctor assessment'].forEach(s =>
      ok('B8', `Audit: "${s}"`, audB.some(x => x.includes(s))));
    ok('B9', '[14] ER-closed: crew updates refused', !(await crew.one(B, 'md', { k: 'hr', v: '90 bpm', kind: 'update' })).ok);

    /* ---------- case C: NOT STEMI closes automatically ---------- */
    const C = H.cad(103);
    await H.apiSend(crew, C);
    await er.one(C, 'er_accept', { name: 'Dr. Gamma' }); await er.one(C, 'er_assess', { kind: 'uncertain', on: 1, name: 'Dr. Gamma' });
    let c = await doc.view(C);
    ok('C1', 'UNCERTAIN activates cardiology at once', c.state === 'cardiology_activated' && c.er.assessment === 'uncertain' && /UNCERTAIN/.test(c.cardio.reason));
    ok('C2', 'Audit: "ER Assessment: UNCERTAIN, Cardiology: ACTIVATED"', H.auditOf(S.DATA, C).some(x => x.action === 'ER Assessment: UNCERTAIN, Cardiology: ACTIVATED'));
    await doc.one(C, 'ack', { name: 'Dr. Delta' });
    ok('C3', 'NOT STEMI with a reason', (await doc.one(C, 'decision', { k: 'not', on: 1, reason: 'No acute ischaemic changes', name: 'Dr. Delta' })).ok);
    c = await crew.view(C);
    ok('C4', 'NOT STEMI: decision stored, then closed automatically (reason and source)', c.state === 'not_stemi_closed' && c.dec.length === 1 && c.closed.reason === 'Cardiologist decision: NOT STEMI' && c.closed.source === 'automatic following Cardiologist decision');
    const audC = H.auditOf(S.DATA, C).map(x => x.action), iD = audC.findIndex(x => x.startsWith('Cardiologist decision: NOT STEMI')), iX = audC.findIndex(x => x.startsWith('STEMI pathway automatically closed'));
    ok('C5', 'Audit: the decision first, then a separate automatic-closure event', iD >= 0 && iX > iD);
    ok('C6', 'COMPLETE refused on a NOT STEMI case', (await crew.req('POST', '/api/cases/complete', { cad: C })).status === 409);

    /* ---------- identities per CAD number ---------- */
    ok('D1', 'Each CAD records its own ER Doctor and Cardiologist', H.db(S.DATA, `SELECT cad, er_doctor_name e, cardiologist_name c FROM cases ORDER BY cad`).map(r => `${r.e}/${r.c || '-'}`).join(' ') === 'Dr. Test ER/Dr. Test Cardiology Dr. Beta/- Dr. Gamma/Dr. Delta');
    const roles = H.db(S.DATA, `SELECT DISTINCT role FROM audit_events`).map(r => r.role).sort().join(',');
    ok('D2', 'The audit trail records the role of every event', roles === 'cardiologist,crew,er,system', roles);

    /* ---------- the test console ---------- */
    ok('E1', 'Console: a demo case goes to the ER (SENT TO ER)', (await con.req('POST', '/api/control/demo-case', { cad: H.cad(104) })).status === 200 && (await er.view(H.cad(104))).state === 'sent_to_er');
    ok('E2', 'Console: taking a case off the screens does not close it', (await con.req('POST', '/api/control/screens', { cad: H.cad(104), on: false })).status === 200 && (await er.view(H.cad(104))).state === 'sent_to_er' && !(await er.view(H.cad(104))).active);

    /* ---------- a case made by 0.4.0 (no ER step) still opens ---------- */
    await S.stop(true);
    const L = H.cad(105), t0 = Date.now() - 600e3;
    require('node:child_process').execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', `
      const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(${JSON.stringify(require('node:path').join(S.DATA, 'stemi-test.db'))});
      d.prepare("INSERT INTO cases(cad,active,unit,emirate,crew_name,incident_type,created_at,pathway_opened_at,submitted_at,server_received_at) VALUES(?,1,'Ambulance 214','Ras Al Khaimah','K. Ahmed, Paramedic','STEMI pathway',?,?,?,?)").run('${L}',${t0},${t0},${t0 + 60e3},${t0 + 61e3});
      d.prepare("INSERT INTO cardiologist_alerts(cad,cardiologist,hospital,alerted_at) VALUES(?,?,?,?)").run('${L}','Dr X','A',${t0 + 62e3});
      d.prepare("INSERT INTO audit_events(cad,at,actor,role,action,kind) VALUES(?,?,?,?,?,?)").run('${L}',${t0 + 61e3},'Platform','system','Server received case and ECG 1','key');`]);
    S = await H.startServer({ DATA_DIR: S.DATA, MOCK_AI_DELAY_MS: '300' });
    const doc2 = H.Api(S.BASE, 'cardiologist'), er2 = H.Api(S.BASE, 'er');
    await doc2.start(); await er2.start();
    const l = await doc2.view(L);
    ok('F1', 'A 0.4.0 case (no ER information) still opens: read as sent directly to the cardiologist', l && l.legacy && l.state === 'cardiology_activated' && !l.er.accepted);
    ok('F2', 'The ER sees it as already activated (no ER step to record)', (await er2.view(L)).state === 'cardiology_activated');
    ok('F3', 'The cardiologist can acknowledge it as before', (await doc2.one(L, 'ack', { name: 'Dr. Legacy' })).ok && (await doc2.view(L)).state === 'cardiologist_reviewing');
    ok('F4', 'Earlier cases are kept across the restart (database not wiped)', H.db(S.DATA, 'SELECT COUNT(*) n FROM cases')[0].n === 5);
  } finally { await S.stop(); }
}

main().catch(e => { console.error(e); R.ok('', 'The test ran to the end', false, e.message); }).finally(() => process.exit(R.summary() ? 1 : 0));
