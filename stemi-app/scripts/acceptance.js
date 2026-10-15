/* End-to-end acceptance test of the STEMI pathway on three screens at once, in the browser:
   crew MDT (landscape tablet 1180 × 820) → ER Doctor (desktop 1440 × 900) → Cardiologist (phone 393 × 852).
   The ECGs and vital signs come from the simulated corpuls feed in its demo mode (the default): after LINK CORPULS the
   feed connects and ECG 1 arrives by itself; the repeat ECG is simulated from the crew screen; the test console only
   changes a vital sign.
   Scenarios: 1 crew SEND · 2 ER accept with a name · 3 ER ACTIVATE · 7 cardiologist acknowledge with a name ·
   10 repeat ECG · 8 CONFIRMED STEMI · 11 COMPLETE STEMI PATHWAY · 15 nothing reaches the cardiologist before the ER ·
   16 everything arrives without a refresh · 17 the alarms sound only for a new case / activation, until accepted.
   Run: npm run test:acceptance   (cloud container: NODE_PATH=$(npm root -g) npm run test:acceptance)
   Its own server, port and temporary database: the development server and data/ are not touched. Fictional data only. */
const H = require('./lib/harness');
const { chromium } = H.playwright();
const R = H.Results('Acceptance');
const ok = R.ok, sleep = H.sleep;

async function main(S) {
  const browser = await chromium.launch();
  const errors = [];
  try {
    const crew = await H.crewPage(browser, S.BASE, errors);
    const er = await H.clinPage(browser, S.BASE, 'er', errors);
    const doc = await H.clinPage(browser, S.BASE, 'cardiologist', errors);
    const C = crew.page, E = er.page, D = doc.page, A = H.cad(201);
    /* scenario 16: nothing below reloads a page */
    const navs = { crew: 0, er: 0, doc: 0 };
    C.on('framenavigated', f => { if (f === C.mainFrame()) navs.crew++; });
    E.on('framenavigated', f => { if (f === E.mainFrame()) navs.er++; });
    D.on('framenavigated', f => { if (f === D.mainFrame()) navs.doc++; });
    const text = p => p.evaluate(() => document.body.innerText);
    const waitText = (p, s, t) => p.waitForFunction(x => document.body.innerText.includes(x), s, { timeout: t || 15000 }).then(() => true, () => false);
    const quiet = async (tones, ms) => { const a = await tones(); await sleep(ms || 3400); return (await tones()) - a; };
    const erBase = await er.tones(), docBase = await doc.tones();

    /* ---------- 1. crew SEND → the ER is alerted, the cardiologist is not ---------- */
    await H.crewNewCase(C, A);
    await H.shot(C, 'acc-01-crew-sent');
    ok('1', 'Crew: the case shows SENT TO ER after SEND', (await C.textContent('.status-panel')).includes('SENT TO ER') && (await C.textContent('.case-h')).includes('SENT TO ER'));
    ok('1', 'Crew: progress CREW → ER → CARDIOLOGY → DECISION shown', /CREW[\s\S]*ER[\s\S]*CARDIOLOGY[\s\S]*DECISION/i.test(await C.textContent('.progress')));
    const band = await E.waitForSelector(`.alarmband >> text=CAD #${A}`, { timeout: 15000 }).then(() => true, () => false);
    ok('1', 'ER: NEW STEMI CASE alert arrives without refresh, with CAD, patient basics and ECG time', band && /58 y · Male · Chest pain/.test(await E.textContent('.alarmband')) && /ECG acquired/.test(await E.textContent('.alarmband')));
    await H.shot(E, 'acc-02-er-alert');
    await sleep(3500);
    const t1 = await er.tones();
    ok('17', 'ER: audible alarm sounding', t1 - erBase >= 8, `${t1 - erBase} tones`);
    ok('17', 'ER: the alarm continues until the case is accepted', (await quiet(er.tones, 1800)) > 0);
    ok('1', 'Cardiologist: nothing arrives at this stage — no alert, no case, no sound', !(await D.isVisible('.activation')) && !(await text(D)).includes(A) && (await doc.tones()) === docBase);
    ok('15', 'Cardiologist queue does not list the pre-ER case', (await D.textContent('#q-new')).includes('No new activations'));

    /* ---------- 2. ER accept with the name "Dr. Test ER" ---------- */
    await E.click(`.alarmcase:has-text("${A}") [data-act="accept"]`);
    await H.shot(E, 'acc-03-er-name');
    await H.giveName(E, 'Dr. Test ER');
    const acc = await E.waitForSelector('.accepted', { timeout: 10000 }).then(() => true, () => false);
    ok('2', 'ER: the case opens with ACCEPTED BY Dr. Test ER · Accepted at HH:MM', acc && /ACCEPTED BY Dr\. Test ER/.test(await E.textContent('.accepted')) && /Accepted at \d\d:\d\d/.test(await E.textContent('.accepted')));
    ok('17', 'ER: the alarm stops on acceptance', (await quiet(er.tones)) === 0);
    const dbA = H.db(S.DATA, `SELECT er_doctor_name n, er_accepted_at t FROM cases WHERE cad='${A}'`)[0];
    ok('2', 'ER Doctor name and acceptance time saved for this CAD number', dbA.n === 'Dr. Test ER' && dbA.t > 0);
    ok('2', 'Crew: ER DOCTOR REVIEWING with the ER Doctor\'s name, without refresh', await waitText(C, 'ER DOCTOR REVIEWING') && (await C.textContent('.status-panel')).includes('Dr. Test ER'));
    ok('2', 'ER: the original ECG (from corpuls) is on screen at once', await E.isVisible('#c-viewer .ecgv__scroll img') && (await E.textContent('#c-viewer .ecgv__cap')).includes('from corpuls'));
    await E.waitForFunction(() => /AI analysis completed/.test(document.querySelector('#c-ai').innerText), null, { timeout: 15000 }).catch(() => {});
    ok('2', 'ER: AI decision support shown with the statement, and no sound for the AI result', /AI interpretation is decision support\. The Cardiologist makes the final STEMI decision\./.test(await E.textContent('#c-ai')) && (await quiet(er.tones, 500)) === 0);
    await H.shot(E, 'acc-04-er-review', true);

    /* ---------- 3. ER: ACTIVATE CARDIOLOGIST → the cardiologist's alarm ---------- */
    await E.click('[data-act="assess"][data-k="activate"]');
    await E.click('[data-act="assess-go"]');
    ok('3', 'ER: CARDIOLOGY ACTIVATED — AWAITING CARDIOLOGIST', await waitText(E, 'CARDIOLOGY ACTIVATED — AWAITING CARDIOLOGIST'));
    const act = await D.waitForSelector(`.activation >> text=CAD #${A}`, { timeout: 15000 }).then(() => true, () => false);
    const actTxt = act ? await D.textContent('.activation') : '';
    ok('3', 'Cardiologist: NEW CARDIOLOGY ACTIVATION with CAD, ER Doctor, ER assessment, activation and ECG times', act && /NEW CARDIOLOGY ACTIVATION/.test(actTxt) && actTxt.includes('Dr. Test ER') && actTxt.includes('ACTIVATE CARDIOLOGIST') && /Activated/.test(actTxt) && /ECG acquired/.test(actTxt));
    await H.shot(D, 'acc-05-card-activation');
    await sleep(3500);
    ok('17', 'Cardiologist: audible alarm sounding for the activation', (await doc.tones()) - docBase >= 8);
    ok('17', 'ER: the activation makes no sound on the ER screen', (await quiet(er.tones, 500)) === 0);
    ok('3', 'Crew: CARDIOLOGY ACTIVATED, without refresh', await waitText(C, 'CARDIOLOGY ACTIVATED'));

    /* ---------- 7. cardiologist ACKNOWLEDGE & OPEN with the name "Dr. Test Cardiology" ---------- */
    await D.click('.activation [data-act="ack"]');
    await H.giveName(D, 'Dr. Test Cardiology');
    const opened = await D.waitForSelector('#c-viewer .ecgv__scroll img', { timeout: 10000 }).then(() => true, () => false);
    ok('7', 'Cardiologist: the case opens on the ECG', opened && !(await D.isVisible('.activation')));
    ok('17', 'Cardiologist: the alarm stops on ACKNOWLEDGE & OPEN', (await quiet(doc.tones)) === 0);
    const dbC = H.db(S.DATA, `SELECT cardiologist_name n, cardiologist_acknowledged_at t FROM cases WHERE cad='${A}'`)[0];
    ok('7', 'Cardiologist name and acknowledgement time saved for this CAD number', dbC.n === 'Dr. Test Cardiology' && dbC.t > 0);
    ok('7', 'Crew: CARDIOLOGIST REVIEWING with the name', await waitText(C, 'CARDIOLOGIST REVIEWING') && (await C.textContent('.status-panel')).includes('Dr. Test Cardiology'));
    ok('7', 'ER: sees the cardiologist acknowledged, silently', await waitText(E, 'Dr. Test Cardiology · acknowledged') && (await quiet(er.tones, 300)) === 0);
    ok('7', 'Cardiologist: ER Doctor and ER assessment shown with the case', /ER: ACTIVATE CARDIOLOGIST/.test(await D.textContent('#c-er')) && (await D.textContent('#c-er')).includes('Dr. Test ER'));
    await H.shot(D, 'acc-06-card-case');

    /* ---------- 10. UNCLEAR — REQUEST REPEAT ECG ---------- */
    await D.click('#c-dock [data-act="decide"]');
    await D.click('.modal [data-act="d"][data-k="repeat"]');
    await D.click('[data-act="d-rep"][data-v="Poor ECG quality"]');
    await D.fill('#d-ins', 'Repeat with V7 to V9');
    await H.shot(D, 'acc-07-card-repeat');
    await D.click('[data-act="d-go"]');
    const rq = await C.waitForSelector('.modal >> text=REPEAT ECG REQUESTED', { timeout: 15000 }).then(() => true, () => false);
    ok('10', 'Crew: REPEAT ECG REQUESTED arrives at once, with the instruction', rq && (await C.textContent('.modal')).includes('Repeat with V7 to V9'));
    await C.click('[data-act="dec-ack"]');
    ok('10', 'Crew: told to acquire the repeat 12-lead on corpuls; COMPLETE STEMI PATHWAY not available', /Acquire a new 12-lead on corpuls3/.test(await C.textContent('.status-panel')) && !(await C.isVisible('[data-act="complete"]')));
    /* the crew acquires the repeat ECG on corpuls3 — in the prototype's demo mode simulated from the crew screen: nothing to upload */
    await C.click('.status-panel [data-act="demo-acq"]');
    let n2 = 0;
    for (let i = 0; i < 30 && n2 < 2; i++) { await sleep(200); n2 = H.db(S.DATA, `SELECT COUNT(*) n FROM ecgs WHERE cad='${A}' AND source='corpuls'`)[0].n; }
    ok('10', 'corpuls: the repeat 12-lead (SIMULATE REPEAT ECG ACQUISITION on the crew screen) arrives as ECG 2 from corpuls', n2 === 2);
    ok('10', 'Crew: REPEAT ECG SENT — CARDIOLOGIST REVIEWING', await waitText(C, 'REPEAT ECG SENT — CARDIOLOGIST REVIEWING'));
    const newDoc = await D.waitForSelector('.ecgv__new >> text=ECG 2', { timeout: 15000 }).then(() => true, () => false);
    ok('10', 'Cardiologist: ECG 2 arrives silently and is announced, not swapped in', newDoc && (await quiet(doc.tones, 500)) === 0 && (await D.textContent('.ecgv__cap')).includes('ECG 1 of 2'));
    ok('10', 'ER: ECG 2 arrives silently too', await E.waitForSelector('.ecg-tab >> text=ECG 2', { timeout: 15000 }).then(() => true, () => false) && (await quiet(er.tones, 300)) === 0);
    ok('10', 'Cardiologist: a decision is held until the new ECG 2 has been viewed', (await D.getAttribute('#c-dock [data-act="decide"]', 'aria-disabled')) === 'true');
    /* new vital signs from corpuls: arrive silently on both screens */
    await H.sim(S.BASE, A, 'set', { sys: 128, dia: 76 }); await H.sim(S.BASE, A, 'send-vitals');
    ok('16', 'ER: the new BP from corpuls arrives without refresh, the earlier reading kept, no sound', await waitText(E, '128/76') && /Earlier: 132\/78/.test(await E.textContent('#c-details')) && (await quiet(er.tones, 300)) === 0);

    /* ---------- 8. CONFIRMED STEMI ---------- */
    await D.click('#c-dock [data-act="view-latest"]');
    await D.waitForFunction(() => { const b = document.querySelector('#c-dock [data-act="decide"]'); return b && b.getAttribute('aria-disabled') !== 'true'; }, null, { timeout: 8000 }).catch(() => {});
    ok('8', 'Cardiologist: ECG 2 viewed; the decision is available and covers ECG 2', /ECG 2/.test(await D.textContent('#c-dock [data-act="decide"]')));
    ok('16', 'Cardiologist: the new BP is there too, without refresh or sound', (await D.textContent('#c-details')).includes('128/76') && (await quiet(doc.tones, 300)) === 0);
    await D.click('#c-dock [data-act="decide"]');
    await D.click('.modal [data-act="d"][data-k="confirm"]');
    await D.fill('#d-note', 'Fictional test note');
    await D.click('[data-act="d-go"]');
    const cf = await C.waitForSelector('.modal >> text=CONFIRMED STEMI', { timeout: 15000 }).then(() => true, () => false);
    ok('8', 'Crew: CONFIRMED STEMI arrives at once, with the note', cf && (await C.textContent('.modal')).includes('Fictional test note'));
    await H.shot(C, 'acc-08-crew-confirmed');
    await C.click('[data-act="dec-ack"]');
    ok('8', 'Crew: CONFIRMED STEMI; COMPLETE STEMI PATHWAY available', (await C.textContent('.status-panel')).includes('CONFIRMED STEMI') && await C.isVisible('[data-act="complete"]'));
    ok('8', 'ER: sees CONFIRMED STEMI, silently', await waitText(E, 'CONFIRMED STEMI') && (await quiet(er.tones, 300)) === 0);
    ok('8', 'Cardiologist: CONFIRMED STEMI shown; a new decision can still be recorded', await waitText(D, 'CONFIRMED STEMI') && await D.isVisible('#c-dock [data-act="decide-new"]'));

    /* ---------- 11. COMPLETE STEMI PATHWAY ---------- */
    await C.click('.status-panel [data-act="complete"]');
    const ct = await C.textContent('.modal');
    ok('11', 'Crew: confirmation text as specified, with CANCEL / COMPLETE and nothing to fill in', /COMPLETE STEMI PATHWAY\?/.test(ct) && ct.includes('This will close the STEMI pathway for:') && ct.includes(`CAD #${A}`) && ct.includes('The STEMI case will remain available as read-only.') && !(await C.$('.modal input, .modal textarea')));
    await H.shot(C, 'acc-09-crew-complete');
    await C.click('[data-act="complete-go"]');
    ok('11', 'Crew: STEMI PATHWAY COMPLETED, read-only (no updates, no new ECG)', await waitText(C, 'STEMI PATHWAY COMPLETED') && !(await C.isVisible('[data-act="vitals"]')) && !(await C.isVisible('[data-act="ecg-new"]')));
    const dbX = H.db(S.DATA, `SELECT closed_at, closed_by, closure_reason r, closure_source s FROM cases WHERE cad='${A}'`)[0];
    ok('11', 'Closure saved: time, crew user, reason, source', dbX.closed_at > 0 && /K\. Ahmed/.test(dbX.closed_by) && dbX.r === 'STEMI pathway completed' && dbX.s === 'crew');
    ok('11', 'ER and Cardiologist see the completion without refresh, read-only, no sound', await waitText(E, 'STEMI PATHWAY COMPLETED') && await waitText(D, 'STEMI PATHWAY COMPLETED') && !(await D.isVisible('#c-dock [data-act="decide-new"]')) && (await quiet(er.tones, 300)) === 0 && (await quiet(doc.tones, 300)) === 0);

    /* ---------- the Case Summary and the completed list ---------- */
    await C.click('[data-act="summary"]');
    const sum = await text(C);
    ok('11', 'Crew Case Summary: CASE, ER REVIEW, CARDIOLOGY, ECGs, TIMELINE — nothing to fill in', ['Case', 'ER review', 'Cardiology', 'ECGs', 'Timeline'].every(h => sum.includes(h)) && sum.includes('Dr. Test ER') && sum.includes('Dr. Test Cardiology') && !(await C.$('#main input, #main textarea')));
    await H.shot(C, 'acc-10-crew-summary', true);
    await C.click('[data-act="sum-back"]'); await C.click('[data-act="home"]');
    ok('11', 'Crew: the case moved from Active to Completed', await C.waitForSelector(`#q-done >> text=CAD #${A}`, { timeout: 8000 }).then(() => true, () => false) && !(await C.textContent('#q-act')).includes(A));
    await E.click('[data-act="queue"]');
    ok('11', 'ER: the case is in Completed', await E.waitForSelector(`#q-done >> text=CAD #${A}`, { timeout: 8000 }).then(() => true, () => false));

    /* ---------- 16 and 17 overall ---------- */
    ok('16', 'No screen was reloaded during the whole pathway', navs.crew === 0 && navs.er === 0 && navs.doc === 0, JSON.stringify(navs));
    const aud = H.auditOf(S.DATA, A).map(a => a.action);
    ok('17', 'Audit: each alarm started when shown and stopped on acceptance / acknowledgement', aud.some(a => a.startsWith('NEW STEMI CASE alert shown on the ER screen · audible alarm started')) && aud.some(a => a.startsWith('ER Doctor accepted the case: Dr. Test ER · audible alarm stopped')) && aud.some(a => a.startsWith('NEW CARDIOLOGY ACTIVATION alert shown')) && aud.some(a => a.includes('ACKNOWLEDGE & OPEN by Dr. Test Cardiology · audible alarm stopped')));
    ok('', 'Audit wording: CAD number manually entered by crew from dispatch/MDT information', aud.some(a => a.includes('CAD number manually entered by crew from dispatch/MDT information')));
    ok('', 'No page ever showed "CAD CANCELLED"', ![await text(C), await text(E), await text(D)].some(t => /CAD CANCELLED/i.test(t)));
    ok('', 'No script errors on any screen', !errors.length, errors.slice(0, 3).join(' | '));
  } finally { await browser.close(); }
}

(async () => {
  const S = await H.startServer();
  try { await main(S); } catch (e) { console.error(e); R.ok('', 'The test ran to the end', false, e.message); } finally { await S.stop(); }
  process.exit(R.summary() ? 1 : 0);
})();
