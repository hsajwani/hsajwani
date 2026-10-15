/* The simulated corpuls integration, end to end, on the three screens and through the API:
   A CAD + corpuls link · B live vital signs · C automatic ECG 1 · D SEND TO ER · E ER workflow · F cardiologist workflow ·
   G repeat ECGs 2 and 3 · H connection loss · J manual ECG fallback · I reconnection without duplicates · K closed case ·
   L duplicate CAD — and: data paused (freshness indicator), signal loss with an ECG held on the monitor, a server
   restart, the corpuls.mission placeholder provider.
   The test console's CORPULS SIMULATOR plays the crew's corpuls3 (MockCorpulsProvider). Fictional data only.
   Run: npm run test:corpuls   (cloud container: NODE_PATH=$(npm root -g) npm run test:corpuls). */
const H = require('./lib/harness');
const { chromium } = H.playwright();
const R = H.Results('corpuls');
const ok = R.ok, sleep = H.sleep;

async function main(S) {
  const browser = await chromium.launch();
  const errors = [];
  try {
    const { page: C } = await H.crewPage(browser, S.BASE, errors);
    const er = await H.clinPage(browser, S.BASE, 'er', errors), E = er.page;
    const doc = await H.clinPage(browser, S.BASE, 'cardiologist', errors), D = doc.page;
    const crew = H.Api(S.BASE, 'crew'); await crew.start();
    const A = H.cad(401);
    const row = c => H.db(S.DATA, `SELECT * FROM cases WHERE cad='${c}'`)[0];
    const ecgs = c => H.db(S.DATA, `SELECT n, source, device_id, source_event_id, acquired_at FROM ecgs WHERE cad='${c}' ORDER BY n`);
    const aud = c => H.auditOf(S.DATA, c).map(a => a.action);
    const sim = (k, b) => H.sim(S.BASE, A, k, b);
    const waitText = (p, s, t) => p.waitForFunction(x => document.body.innerText.includes(x), s, { timeout: t || 15000 }).then(() => true, () => false);
    const quiet = async (tones, ms) => { const a = await tones(); await sleep(ms || 2500); return (await tones()) - a; };
    const tile = async k => { const t = await C.textContent(`#d-mon .mtile--${k} .mtile__v, #c-mon .mtile--${k} .mtile__v`).catch(() => ''); return t.trim(); };

    /* ---------- A. CAD + corpuls link ---------- */
    await C.click('[data-act="new-case"]'); await C.waitForSelector('#cadin');
    await C.fill('#cadin', `cad#${A}`); await C.click('[data-act="cad-ok"]');
    const linked = await C.waitForSelector('.cbar--ok', { timeout: 10000 }).then(() => true, () => false);
    ok('A', 'Crew: valid CAD → CORPULS CONNECTED · CAD #… shown', linked && /CORPULS CONNECTED/.test(await C.textContent('#d-bar')) && (await C.textContent('#d-bar')).includes(`CAD #${A}`));
    ok('A', 'The case exists under the normalised CAD number, linked to the unit\'s monitor (SIM-C3-214), connected', row(A) && row(A).corpuls_device_id === 'SIM-C3-214' && row(A).corpuls_status === 'connected' && !row(A).server_received_at);
    ok('A', 'Audit: "Corpuls feed linked to CAD" and "Corpuls monitor connected"', aud(A).some(a => a.startsWith(`Corpuls feed linked to CAD #${A}`)) && aud(A).some(a => a.startsWith('Corpuls monitor connected')));
    ok('A', 'API: linking a CAD number that has no case is refused (the CAD must exist first)', (await crew.req('POST', '/api/corpuls/link', { cad: H.cad(499) })).status === 404);
    await H.shot(C, 'corp-a-connected');

    /* ---------- B. live vital signs ---------- */
    await sim('set', { hr: 96, spo2: 95, sys: 138, dia: 84, rr: 20 }); await sim('send-vitals');
    await C.waitForFunction(() => { const v = document.querySelector('#d-mon .mtile--hr .mtile__v'); return v && v.textContent.trim() === '96'; }, null, { timeout: 8000 }).catch(() => {});
    ok('B', 'Crew: HR, SpO₂, BP and RR from the simulator shown, nothing typed', (await tile('hr')) === '96' && (await tile('spo2')) === '95' && (await tile('bp')) === '138/84' && (await tile('rr')) === '20');
    ok('B', 'Crew: LIVE FROM CORPULS · Updated … ago (the data\'s own time)', /LIVE FROM CORPULS/.test(await C.textContent('#d-mon')) && /Updated \d+ s ago/.test(await C.textContent('#d-mon')));
    await sim('set', { hr: 110 });
    await sleep(1600);
    const hr2 = +(await tile('hr'));
    ok('B', 'HR moves gradually towards a new set value (no jump, no random values)', hr2 > 96 && hr2 < 110, `HR ${hr2}`);
    await sim('set', { hr: 96 }); await sim('send-vitals');
    await sleep(300);
    const nv = H.db(S.DATA, `SELECT COUNT(*) n FROM monitor_vitals WHERE cad='${A}'`)[0].n;
    ok('B', 'Vital signs are not written to the clinical audit trail; the history stays light', !aud(A).some(a => /^(HR|SpO|BP|RR)\b/.test(a)) && nv <= 6, `${nv} history rows`);

    /* ---------- C. automatic ECG 1 ---------- */
    ok('C', 'Crew: WAITING FOR ECG FROM CORPULS before the acquisition', /WAITING FOR ECG FROM CORPULS/.test(await C.textContent('#d-ecgh')));
    const e1 = await sim('trigger-ecg', { sample: 'A' });
    ok('C', 'Simulator: ECG 1 acquired on corpuls3 and received by the platform', e1.status === 200 && e1.body.n === 1);
    const shown = await C.waitForSelector('#d-viewer:not([hidden]) .ecgv__scroll img', { timeout: 8000 }).then(() => true, () => false);
    ok('C', 'Crew: ECG 1 RECEIVED FROM CORPULS appears by itself, with the acquisition time', shown && /ECG 1 RECEIVED FROM CORPULS/.test(await C.textContent('#d-ecgh')) && /Acquired \d\d:\d\d:\d\d/.test(await C.textContent('#d-ecgh')));
    const im = H.db(S.DATA, `SELECT source, mime, uploaded_by FROM ecg_images WHERE cad='${A}'`);
    const x1 = ecgs(A)[0];
    ok('C', 'No manual upload: one image, from the corpuls feed (SVG drawn by the simulator)', im.length === 1 && im[0].source === 'corpuls' && im[0].mime === 'image/svg+xml' && /corpuls feed/.test(im[0].uploaded_by));
    ok('C', 'ECG 1 stored with source = corpuls, the device, its acquisition time and the provider\'s event id', x1 && x1.n === 1 && x1.source === 'corpuls' && x1.device_id === 'SIM-C3-214' && x1.acquired_at > 0 && !!x1.source_event_id);
    ok('C', 'Audit: "ECG 1 received from corpuls"', aud(A).some(a => a.startsWith('ECG 1 received from corpuls')));
    await H.shot(C, 'corp-c-ecg1');

    /* ---------- D. SEND TO ER ---------- */
    ok('D', 'SEND TO ER is held until the four patient items are answered', (await C.getAttribute('[data-act="send"]', 'aria-disabled')) === 'true');
    await C.click('[data-act="send"]', { force: true });
    ok('D', 'Pressing it then shows what is missing, at the fields', await C.isVisible('#e-age') && !row(A).server_received_at);
    await C.fill('#md-age', '64'); await C.click('[data-act="md-set"][data-k="sex"][data-v="Male"]'); await C.click('[data-act="md-set"][data-k="complaint"][data-v="cp"]'); await C.click('[data-act="md-ago"][data-m="60"]');
    ok('D', 'Ready: CAD, ECG 1 from corpuls, patient 4 of 4 — no vital-signs confirmation asked', /ECG 1 from corpuls/.test(await C.textContent('.readylist')) && /Patient 4 of 4/.test(await C.textContent('.readylist')) && (await C.getAttribute('[data-act="send"]', 'aria-disabled')) === null);
    await C.click('[data-act="send"]');
    await C.waitForSelector(`.case-h__cad:has-text("CAD #${A}")`, { timeout: 15000 });
    ok('D', 'Crew: SENT TO ER; the crew becomes a status viewer', (await C.textContent('.status-panel')).includes('SENT TO ER'));
    const band = await E.waitForSelector(`.alarmband >> text=CAD #${A}`, { timeout: 15000 }).then(() => true, () => false);
    await sleep(2000);
    ok('D', 'ER: NEW STEMI CASE alarm', band && (await er.tones()) > 0);
    ok('D', 'The latest monitor values travelled with the case (audited, kept in the history)', aud(A).some(a => a.startsWith('Latest monitor values sent with the case: HR 96 bpm · SpO₂ 95 % · BP 138/84 mmHg')) && H.db(S.DATA, `SELECT COUNT(*) n FROM monitor_vitals WHERE cad='${A}' AND why='at_send'`)[0].n === 1);

    /* ---------- E. ER workflow ---------- */
    await E.click(`.alarmcase:has-text("${A}") [data-act="accept"]`); await H.giveName(E, 'Dr. Test ER');
    await E.waitForSelector('.accepted');
    ok('E', 'ER: accepted with the name; the alarm stops', /ACCEPTED BY Dr\. Test ER/.test(await E.textContent('.accepted')) && (await quiet(er.tones, 2000)) === 0);
    await E.waitForSelector('#c-strip .mon-st', { timeout: 8000 }).catch(() => {});
    const strip = await E.textContent('#c-strip');
    ok('B', 'ER: the same live values as the crew, with the corpuls freshness', /HR\s*96/.test(strip) && /SpO₂\s*95/.test(strip) && /138\/84/.test(strip) && /RR\s*20/.test(strip) && /corpuls · \d+ s ago/.test(strip));
    ok('E', 'ER: the ECG stays the main object (viewer before the live values in size)', await E.evaluate(() => document.querySelector('#c-viewer').getBoundingClientRect().height > 3 * document.querySelector('#c-strip').getBoundingClientRect().height));
    await E.waitForSelector('[data-act="assess"][data-k="activate"]:not([aria-disabled="true"])', { timeout: 10000 });
    await E.click('[data-act="assess"][data-k="activate"]'); await E.click('[data-act="assess-go"]');
    const act = await D.waitForSelector(`.activation >> text=CAD #${A}`, { timeout: 15000 }).then(() => true, () => false);
    await sleep(2000);
    ok('E', 'ER: ACTIVATE CARDIOLOGIST → the cardiologist\'s alarm', act && (await doc.tones()) > 0);

    /* ---------- F. cardiologist workflow ---------- */
    await D.click('.activation [data-act="ack"]'); await H.giveName(D, 'Dr. Test Cardiology');
    await D.waitForSelector('#c-dock [data-act="decide"]:not([aria-disabled="true"])', { timeout: 10000 });
    ok('F', 'Cardiologist: ACKNOWLEDGE & OPEN; the alarm stops', (await quiet(doc.tones, 2000)) === 0);
    const dstrip = await D.textContent('#c-strip');
    ok('B', 'Cardiologist: the same live values, with the last update time', /HR\s*96/.test(dstrip) && /138\/84/.test(dstrip) && /corpuls · \d+ s ago/.test(dstrip));
    await D.click('#c-dock [data-act="decide"]'); await D.click('.modal [data-act="d"][data-k="repeat"]'); await D.click('[data-act="d-go"]');
    const rq = await C.waitForSelector('.modal >> text=REPEAT ECG REQUESTED', { timeout: 15000 }).then(() => true, () => false);
    ok('F', 'Cardiologist: UNCLEAR — REQUEST REPEAT ECG works; the crew sees REPEAT ECG REQUESTED', rq);
    await C.click('[data-act="dec-ack"]');
    ok('G', 'Crew: told to acquire another 12-lead on corpuls (no upload asked)', /Acquire a new 12-lead on corpuls3/.test(await C.textContent('.status-panel')));

    /* ---------- G. repeat ECG 2 (and 3), automatic and silent ---------- */
    const erT = await er.tones(), docT = await doc.tones();
    const e2 = await sim('trigger-ecg', { sample: 'B' });
    ok('G', 'ECG 2 attaches to the same CAD number by itself', e2.body.n === 2 && ecgs(A).length === 2 && ecgs(A)[1].source === 'corpuls');
    ok('G', 'Crew: ECG 2 appears by itself (the viewer follows it)', await waitText(C, 'REPEAT ECG SENT — CARDIOLOGIST REVIEWING') && await C.waitForSelector('#c-viewer .ecg-tab[aria-selected="true"] >> text=ECG 2', { timeout: 8000 }).then(() => true, () => false));
    ok('G', 'ER and Cardiologist: ECG 2 arrives, announced, not swapped in', await E.waitForSelector('.ecg-tab >> text=ECG 2', { timeout: 10000 }).then(() => true, () => false) && await D.waitForSelector('.ecgv__new >> text=ECG 2', { timeout: 10000 }).then(() => true, () => false));
    await sleep(2500);
    ok('G', 'No new alarm on the ER or the Cardiologist screen', (await er.tones()) === erT && (await doc.tones()) === docT);
    const two = ecgs(A);
    ok('G', 'ECG 1 is kept unchanged: its own time, event, image and AI result', two[0].source_event_id !== two[1].source_event_id && two[0].acquired_at === x1.acquired_at
      && H.db(S.DATA, `SELECT COUNT(*) n FROM ecg_images WHERE cad='${A}' AND ecg_n=1`)[0].n === 1 && H.db(S.DATA, `SELECT status FROM ai_interpretations WHERE cad='${A}' AND ecg_n=1`)[0].status === 'ok');
    ok('G', 'ECG 1\'s review history is kept (viewed by the ER and the Cardiologist)', H.db(S.DATA, `SELECT COUNT(DISTINCT role) n FROM ecg_role_views WHERE cad='${A}' AND ecg_n=1`)[0].n === 2);
    await D.click('#c-dock [data-act="view-latest"]');
    await D.waitForSelector('#c-dock [data-act="decide"]:not([aria-disabled="true"])', { timeout: 10000 });
    await D.click('#c-dock [data-act="decide"]'); await D.click('.modal [data-act="d"][data-k="repeat"]'); await D.click('[data-act="d-go"]');
    await C.waitForSelector('.modal [data-act="dec-ack"]', { timeout: 15000 }); await C.click('[data-act="dec-ack"]');
    const e3 = await sim('trigger-ecg', { sample: 'C' });
    ok('G', 'A second repeat: ECG 3 attaches by itself too', e3.body.n === 3 && await D.waitForSelector('.ecg-tab >> text=ECG 3', { timeout: 10000 }).then(() => true, () => false));
    ok('G', 'The AI result belongs to each ECG (one analysis per ECG)', await (async () => { for (let i = 0; i < 20; i++) { const n = H.db(S.DATA, `SELECT COUNT(*) n FROM ai_interpretations WHERE cad='${A}' AND status='ok'`)[0].n; if (n === 3) return true; await sleep(400); } return false; })());

    /* ---------- data paused: the freshness indicator (technical, not clinical) ---------- */
    await sim('pause');
    const stale = await C.waitForFunction(() => /LAST DATA RECEIVED/.test(document.querySelector('#c-mon').innerText), null, { timeout: 8000 }).then(() => true, () => false);
    ok('P', 'Data paused (monitor still connected): LAST DATA RECEIVED hh:mm:ss, never shown as current', stale && /\d+ s ago/.test(await C.textContent('#c-mon')) && /CORPULS CONNECTED/.test(await C.textContent('#c-bar')));
    ok('P', 'ER: LAST DATA RECEIVED too', await E.waitForFunction(() => /LAST DATA RECEIVED/.test(document.querySelector('#c-strip').innerText), null, { timeout: 8000 }).then(() => true, () => false));
    await sim('resume');
    ok('P', 'Data resumed: LIVE FROM CORPULS again', await C.waitForFunction(() => /LIVE FROM CORPULS/.test(document.querySelector('#c-mon').innerText), null, { timeout: 8000 }).then(() => true, () => false));

    /* ---------- H. connection loss ---------- */
    const lastBefore = row(A).corpuls_last_data_at;
    await sim('disconnect');
    ok('H', 'Crew: CORPULS CONNECTION LOST · Last data received · MANUAL FALLBACK AVAILABLE', await C.waitForSelector('#c-bar .cbar--warn', { timeout: 8000 }).then(() => true, () => false)
      && /CORPULS CONNECTION LOST/.test(await C.textContent('#c-bar')) && /Last data received \d\d:\d\d:\d\d/.test(await C.textContent('#c-bar')) && /MANUAL FALLBACK AVAILABLE/.test(await C.textContent('#c-bar')));
    ok('H', 'Crew: the last values stay visible (greyed, with their time)', (await tile('hr')) === '96' && await C.isVisible('#c-mon .mon.is-dim'));
    ok('H', 'Crew: the manual fallback is offered prominently', await C.isVisible('#c-bar [data-act="ecg-new"]'));
    ok('H', 'ER: LIVE MONITOR DATA TEMPORARILY UNAVAILABLE · last data received, values kept', await E.waitForFunction(() => /LIVE MONITOR DATA TEMPORARILY UNAVAILABLE/.test(document.querySelector('#c-strip').innerText), null, { timeout: 8000 }).then(() => true, () => false) && /138\/84/.test(await E.textContent('#c-strip')));
    ok('H', 'Cardiologist: LIVE MONITOR DATA TEMPORARILY UNAVAILABLE', await D.waitForFunction(() => /LIVE MONITOR DATA TEMPORARILY UNAVAILABLE/.test(document.querySelector('#c-strip').innerText), null, { timeout: 8000 }).then(() => true, () => false));
    await H.shot(C, 'corp-h-lost', true); await H.shot(E, 'corp-h-er-lost');
    ok('H', 'Audit: "Corpuls connection lost" once; the pathway is not closed and nothing clinical happened', aud(A).filter(a => a.startsWith('Corpuls connection lost')).length === 1 && row(A).closed_at === null && (await crew.view(A)).state === 'repeat_received');
    ok('H', 'A disconnected monitor transmits nothing (no new data while lost)', (await sim('trigger-ecg', { sample: 'A' })).status === 409 && row(A).corpuls_last_data_at === lastBefore);

    /* ---------- J. manual ECG fallback while disconnected ---------- */
    await C.click('#c-bar [data-act="ecg-new"]');
    await C.click('.modal [data-act="img-add"]'); await C.click('[data-act="img-gen"]');
    await C.waitForSelector('[data-act="ecg-send"]:not([disabled])');
    ok('J', 'The fallback says what it is: Manual ECG fallback · ECG 4', /Manual ECG fallback · ECG 4/.test(await C.textContent('.modal')));
    await C.click('[data-act="ecg-send"]');
    let fb = null;
    for (let i = 0; i < 30 && !fb; i++) { await sleep(400); fb = ecgs(A).find(e => e.n === 4) || null; }
    ok('J', 'ECG 4 stored with source = manual_fallback', fb && fb.source === 'manual_fallback');
    ok('J', 'Audit: "Manual ECG fallback used"', aud(A).some(a => a.startsWith('Manual ECG fallback used: ECG 4')));
    const nd = await D.waitForSelector('.ecgv__new >> text=ECG 4', { timeout: 10000 }).then(() => true, () => false);
    await D.click('#c-dock [data-act="view-latest"]');
    await D.waitForSelector('#c-dock [data-act="decide"]:not([aria-disabled="true"])', { timeout: 10000 });
    await D.click('#c-dock [data-act="decide"]'); await D.click('.modal [data-act="d"][data-k="confirm"]'); await D.click('[data-act="d-go"]');
    const cf = await C.waitForSelector('.modal >> text=CONFIRMED STEMI', { timeout: 15000 }).then(() => true, () => false);
    ok('J', 'The workflow continues: the Cardiologist reviews the fallback ECG and decides CONFIRMED STEMI', nd && cf);
    await C.click('[data-act="dec-ack"]');

    /* ---------- I. reconnection: data resumes, nothing duplicated ---------- */
    const ecgN = ecgs(A).length, vBefore = row(A).vitals_at;
    await sim('reconnect');
    ok('I', 'Reconnect: the status updates by itself (CORPULS CONNECTED)', await C.waitForSelector('#c-bar .cbar--ok', { timeout: 10000 }).then(() => true, () => false));
    await sleep(2500);
    ok('I', 'Updates resume (new samples after the reconnection)', row(A).vitals_at > vBefore);
    ok('I', 'No duplicate ECG: the resent ECG 3 was stored once', ecgs(A).length === ecgN && new Set(ecgs(A).map(e => e.source_event_id).filter(Boolean)).size === ecgs(A).filter(e => e.source === 'corpuls').length);
    ok('I', 'No duplicate vital-signs record: the resent sample was ignored', H.db(S.DATA, `SELECT COUNT(*) n FROM (SELECT event_id FROM monitor_vitals WHERE cad='${A}' AND event_id IS NOT NULL GROUP BY event_id HAVING COUNT(*) > 1)`)[0].n === 0);
    ok('I', 'Audit: one "Corpuls connection restored"; no heartbeat or routine-sample events', aud(A).filter(a => a === 'Corpuls connection restored').length === 1 && !aud(A).some(a => /heartbeat|sample/i.test(a)));

    /* ---------- signal loss: a 12-lead acquired meanwhile is held on the monitor and sent after ---------- */
    await sim('signal-loss');
    await sleep(300);
    const held = await sim('trigger-ecg', { sample: 'B' });
    ok('S', 'Signal lost: status RECONNECTING; an ECG acquired now is held on the monitor', row(A).corpuls_status === 'reconnecting' && held.body.held === true && ecgs(A).length === ecgN);
    await sim('restore-signal');
    await sleep(600);
    ok('S', 'Signal restored: the held ECG arrives as ECG 5; lost / restored audited once more each', ecgs(A).length === ecgN + 1 && ecgs(A)[ecgN].source === 'corpuls'
      && aud(A).filter(a => a.startsWith('Corpuls connection lost')).length === 2 && aud(A).filter(a => a === 'Corpuls connection restored').length === 2);

    /* ---------- K. a closed case is never changed by monitor data ---------- */
    await C.click('.status-panel [data-act="complete"]'); await C.click('[data-act="complete-go"]');
    await waitText(C, 'STEMI PATHWAY COMPLETED');
    await sleep(500);
    const closed = row(A), nClosed = ecgs(A).length;
    ok('K', 'Closing the pathway ends the corpuls feed (audited); the last values are kept', closed.closed_at > 0 && closed.corpuls_link_ended_at > 0 && aud(A).some(a => a.startsWith(`Corpuls feed unlinked from CAD #${A} (STEMI pathway closed)`)) && !!closed.vitals_json);
    const late1 = await sim('trigger-ecg', { sample: 'A' }), late2 = await sim('send-vitals');
    await sleep(1500);
    ok('K', 'Late ECG and vital signs for the closed case are refused by the platform', late1.status === 409 && /closed and read-only/.test(late1.body.error || '') && late2.status === 409 && /closed and read-only/.test(late2.body.error || ''));
    ok('K', 'The closed case is unchanged: same ECGs, same last values', ecgs(A).length === nClosed && row(A).vitals_at === closed.vitals_at && row(A).vitals_json === closed.vitals_json);
    ok('K', 'API: linking corpuls to a closed case is refused', (await crew.req('POST', '/api/corpuls/link', { cad: A })).status === 409);
    ok('K', 'Crew: CORPULS FEED ENDED, the last values kept, read-only', /CORPULS FEED ENDED/.test(await C.textContent('#c-bar')) && (await tile('hr')) !== '—' && !(await C.isVisible('[data-act="ecg-new"]')));
    await C.click('[data-act="summary"]');
    const sum = await C.evaluate(() => document.body.innerText);
    ok('K', 'Case Summary: latest monitor data with the last update time, each ECG with its source', /Latest monitor data/.test(sum) && /Last monitor update \d\d:\d\d:\d\d/.test(sum) && /from corpuls/i.test(sum) && /manual fallback/i.test(sum) && /Monitor feed/.test(sum));
    await H.shot(C, 'corp-k-summary', true);
    await C.click('[data-act="sum-back"]');

    /* ---------- L. duplicate CAD ---------- */
    await C.click('[data-act="home"]'); await C.click('[data-act="new-case"]'); await C.waitForSelector('#cadin');
    await C.fill('#cadin', A); await C.click('[data-act="cad-ok"]');
    ok('L', 'Crew: the same CAD number again → CASE ALREADY EXISTS, no second case', await C.waitForSelector('.modal >> text=CASE ALREADY EXISTS', { timeout: 8000 }).then(() => true, () => false) && H.db(S.DATA, `SELECT COUNT(*) n FROM cases WHERE cad='${A}'`)[0].n === 1);
    await C.click('[data-act="dup-fix"]');
    ok('L', 'API: a duplicate create is refused (409)', (await crew.req('POST', '/api/cases', { cad: A, cid: 'other', link: true })).status === 409);
    const B = H.cad(402);
    await crew.req('POST', '/api/cases', { cad: B, cid: 'b', link: true });
    ok('L', 'API: correcting an unsent case to an existing number is refused (409)', (await crew.req('POST', '/api/cases/correct', { cad: B, to: A })).status === 409 && !!row(B));
    ok('', 'No script errors on any screen', !errors.length, errors.slice(0, 3).join(' | '));
  } finally { await browser.close(); }
}

/* after a server restart, a linked feed carries on (no false "connection lost"); the corpuls.mission placeholder */
async function restartAndStub() {
  let S = await H.startServer({});
  try {
    const crew = H.Api(S.BASE, 'crew'); await crew.start();
    const Z = H.cad(403);
    await crew.req('POST', '/api/cases', { cad: Z, cid: 'z', link: true });
    await H.sim(S.BASE, Z, 'connect');
    await sleep(1200);
    await S.stop(true);
    const DATA = S.DATA, before = H.db(DATA, `SELECT vitals_at FROM cases WHERE cad='${Z}'`)[0].vitals_at;
    S = await H.startServer({ DATA_DIR: DATA });
    await sleep(2500);
    const r = H.db(DATA, `SELECT corpuls_status, vitals_at FROM cases WHERE cad='${Z}'`)[0];
    ok('R', 'After a server restart the linked feed carries on: still connected, new samples, no false loss', r.corpuls_status === 'connected' && r.vitals_at > before && !H.auditOf(DATA, Z).some(a => /connection lost|restored/.test(a.action)));
  } finally { await S.stop(); }
  S = await H.startServer({ CORPULS_PROVIDER: 'corpuls-mission' });
  try {
    const crew = H.Api(S.BASE, 'crew'), con = H.Api(S.BASE, 'control'); await crew.start(); await con.start();
    const X = H.cad(404);
    await crew.req('POST', '/api/cases', { cad: X, cid: 'x', link: true });
    await sleep(1500);
    const x = H.db(S.DATA, `SELECT corpuls_provider p, corpuls_status s, corpuls_device_label l, vitals_json v FROM cases WHERE cad='${X}'`)[0];
    ok('X', 'corpuls.mission placeholder: nothing connects, nothing arrives (not implemented; no network call)', x.p === 'corpuls-mission' && x.s === 'waiting' && /not implemented/.test(x.l) && !x.v);
    ok('X', 'The simulator refuses to act on the placeholder provider', (await con.req('POST', '/api/control/corpuls/connect', { cad: X })).status === 409);
  } finally { await S.stop(); }
}

(async () => {
  const S = await H.startServer({ MOCK_AI_DELAY_MS: '600' });
  try { await main(S); } catch (e) { console.error(e); R.ok('', 'The test ran to the end', false, e.message); } finally { await S.stop(); }
  try { await restartAndStub(); } catch (e) { console.error(e); R.ok('', 'The restart / placeholder checks ran to the end', false, e.message); }
  process.exit(R.summary() ? 1 : 0);
})();
