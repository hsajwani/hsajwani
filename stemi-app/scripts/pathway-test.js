/* The other ways through the STEMI pathway, on the ER Doctor's and the Cardiologist's screens (in the browser):
   4 UNCERTAIN — ACTIVATE CARDIOLOGIST · 5 NOT SUSPICIOUS FOR STEMI needs a reason, then closes the screening pathway ·
   6 OTHER needs an explanation, which is kept · 9 NOT STEMI closes the pathway automatically ·
   12 each CAD records its own ER Doctor (Dr. Alpha / Dr. Beta) · 13 each CAD records its own Cardiologist.
   The crew sends these cases through the API (the crew's own screens are covered by test:acceptance and test:cad) and
   follows the outcomes on its screen.
   Run: npm run test:pathway   (cloud container: NODE_PATH=$(npm root -g) npm run test:pathway). Fictional data only. */
const H = require('./lib/harness');
const { chromium } = H.playwright();
const R = H.Results('Pathway');
const ok = R.ok, sleep = H.sleep;

async function main(S) {
  const browser = await chromium.launch();
  const errors = [];
  try {
    const api = H.Api(S.BASE, 'crew'); await api.start();
    const crew = await H.crewPage(browser, S.BASE, errors);
    const er = await H.clinPage(browser, S.BASE, 'er', errors);
    const doc = await H.clinPage(browser, S.BASE, 'cardiologist', errors);
    const C = crew.page, E = er.page, D = doc.page;
    const P1 = H.cad(301), P2 = H.cad(302), P3 = H.cad(303), P4 = H.cad(304);
    const row = c => H.db(S.DATA, `SELECT * FROM cases WHERE cad='${c}'`)[0];
    const waitText = (p, s, t) => p.waitForFunction(x => document.body.innerText.includes(x), s, { timeout: t || 15000 }).then(() => true, () => false);
    const quiet = async (tones, ms) => { const a = await tones(); await sleep(ms || 2500); return (await tones()) - a; };
    const crewAck = async sel => { const b = await C.waitForSelector(sel, { timeout: 15000 }).then(() => true, () => false); if (b) await C.click(sel); return b; };
    const docBase = await doc.tones();

    /* ---------- 5. NOT SUSPICIOUS FOR STEMI: blocked without a reason; with one, the screening pathway closes ---------- */
    await H.apiSend(api, P1);
    await E.waitForSelector(`.alarmband >> text=CAD #${P1}`, { timeout: 15000 });
    await E.click(`.alarmcase:has-text("${P1}") [data-act="accept"]`);
    await H.giveName(E, 'Dr. Alpha');
    await E.waitForSelector('.accepted');
    await E.waitForSelector('[data-act="assess"][data-k="not_suspicious"]:not([aria-disabled="true"])', { timeout: 10000 });
    await E.click('[data-act="assess"][data-k="not_suspicious"]');
    ok('5', 'ER: the panel is titled NOT SUSPICIOUS FOR STEMI — REASON REQUIRED, listing the six reasons', (await E.textContent('#modal-title')) === 'NOT SUSPICIOUS FOR STEMI — REASON REQUIRED' && (await E.$$('.modal .radio')).length === 6);
    await E.click('[data-act="ns-go"]', { force: true });
    ok('5', 'ER: CONFIRM without a reason is blocked, with the reason why', await E.isVisible('#ns-reason-err') && /Select the reason/.test(await E.textContent('#ns-reason-err')) && row(P1).er_assessment === null);
    await E.click('[data-act="ns-reason"][data-k="criteria"]');
    const pre = await E.textContent('#ns-sum');
    ok('5', 'ER: the pre-submit summary reads ER REVIEW — CARDIOLOGY NOT ACTIVATED, Reason, Comment', pre.includes('ER REVIEW — CARDIOLOGY NOT ACTIVATED') && pre.includes('Reason: ECG DOES NOT MEET STEMI CRITERIA') && pre.includes('Comment:'));
    await H.shot(E, 'path-01-er-not-suspicious');
    await E.click('[data-act="ns-go"]');
    ok('5', 'ER: the screening pathway closes — CARDIOLOGY NOT ACTIVATED, read-only', await waitText(E, 'ER review completed') && !(await E.isVisible('[data-act="assess"]')) && /Read-only/.test(await E.textContent('#c-decide')));
    const r1 = row(P1);
    ok('5', 'Saved: assessment, reason, ER Doctor, time, closure reason and source', r1.er_assessment === 'not_suspicious' && r1.er_non_activation_reason === 'ECG DOES NOT MEET STEMI CRITERIA' && r1.er_assessed_by === 'Dr. Alpha' && r1.er_assessment_at > 0 && r1.closure_reason === 'ER Doctor assessment: NOT SUSPICIOUS FOR STEMI' && r1.closure_source === 'ER Doctor screening decision' && r1.closed_at > 0);
    ok('5', 'No cardiology activation and no cardiologist decision', !r1.cardiology_activated_at && H.db(S.DATA, `SELECT COUNT(*) n FROM decisions WHERE cad='${P1}'`)[0].n === 0 && H.db(S.DATA, `SELECT COUNT(*) n FROM cardiologist_alerts WHERE cad='${P1}'`)[0].n === 0);
    const a1 = H.auditOf(S.DATA, P1).map(a => a.action);
    ok('5', 'Audit: assessment, reason, cardiology not activated and closure are separate events', ['ER Doctor assessment: NOT SUSPICIOUS FOR STEMI — Dr. Alpha', 'Reason: ECG DOES NOT MEET STEMI CRITERIA', 'Cardiology not activated', 'STEMI screening pathway closed following ER Doctor assessment'].every(s => a1.some(a => a.startsWith(s))));
    const crewOut = await C.waitForSelector('.modal >> text=ER REVIEW COMPLETED / CARDIOLOGY NOT ACTIVATED', { timeout: 15000 }).then(() => true, () => false);
    const crewTxt = crewOut ? await C.textContent('.modal') : '';
    ok('5', 'Crew: sees ER REVIEW COMPLETED / CARDIOLOGY NOT ACTIVATED with the reason — never "NOT STEMI"', crewOut && crewTxt.includes('ECG DOES NOT MEET STEMI CRITERIA') && !/NOT STEMI(?! CRITERIA)/.test(crewTxt.replace(/NOT SUSPICIOUS FOR STEMI/g, '')));
    await H.shot(C, 'path-02-crew-er-outcome');
    await C.click('[data-act="er-ack"]');
    await sleep(800);
    ok('5', 'Crew: the acknowledgement of the outcome is recorded', row(P1).er_outcome_seen_at > 0);
    ok('5', 'Cardiologist: never alerted for this case, no sound', !(await D.isVisible('.activation')) && (await doc.tones()) === docBase);

    /* ---------- 12 + 6. change clinician → Dr. Beta; OTHER needs an explanation, which is kept ---------- */
    await E.click('[data-act="queue"]');
    await E.click('.topbar [data-act="clinician"]');
    await H.giveName(E, 'Dr. Beta');
    ok('12', 'ER: CHANGE CLINICIAN on the queue screen sets Dr. Beta', /Dr\. Beta/.test(await E.textContent('.tb-clin')));
    await H.apiSend(api, P2);
    await E.waitForSelector(`.alarmband >> text=CAD #${P2}`, { timeout: 15000 });
    ok('12', 'ER: the alert says who will accept (no name re-entry)', (await E.textContent('.alarmband')).includes('Accepting as Dr. Beta'));
    await E.click(`.alarmcase:has-text("${P2}") [data-act="accept"]`);
    await E.waitForSelector('.accepted');
    ok('12', 'ER: accepted at once under the remembered name', /ACCEPTED BY Dr\. Beta/.test(await E.textContent('.accepted')) && !(await E.isVisible('#clin-name')));
    ok('12', 'Each CAD records its own ER Doctor: Dr. Alpha and Dr. Beta', row(P1).er_doctor_name === 'Dr. Alpha' && row(P2).er_doctor_name === 'Dr. Beta');
    ok('12', 'CHANGE CLINICIAN is not offered while a case is being reviewed', !(await E.isVisible('.topbar [data-act="clinician"]')));
    await E.waitForSelector('[data-act="assess"][data-k="not_suspicious"]:not([aria-disabled="true"])', { timeout: 10000 });
    await E.click('[data-act="assess"][data-k="not_suspicious"]');
    await E.click('[data-act="ns-reason"][data-k="other"]');
    await E.click('[data-act="ns-go"]', { force: true });
    ok('6', 'ER: OTHER without an explanation is blocked, the field marked', await E.isVisible('#ns-comment-err') && (await E.getAttribute('#ns-comment', 'aria-invalid')) === 'true' && /\(required for OTHER\)/.test(await E.textContent('#ns-opt')) && row(P2).er_assessment === null);
    await E.fill('#ns-comment', 'Test explanation');
    await E.click('[data-act="ns-go"]');
    await waitText(E, 'ER review completed');
    const r2 = row(P2);
    ok('6', 'OTHER saved with the explanation "Test explanation"', r2.er_non_activation_reason === 'OTHER' && r2.er_non_activation_comment === 'Test explanation' && r2.closed_at > 0);
    ok('6', 'ER: the closed case shows the reason and the comment', (await E.textContent('#c-decide')).includes('Test explanation'));
    ok('6', 'Crew: the outcome shows the explanation', await crewAck('.modal:has-text("Test explanation") [data-act="er-ack"]'));

    /* ---------- 4. UNCERTAIN — ACTIVATE CARDIOLOGIST ---------- */
    await E.click('[data-act="queue"]');
    await H.apiSend(api, P3);
    await E.waitForSelector(`.alarmband >> text=CAD #${P3}`, { timeout: 15000 });
    await E.click(`.alarmcase:has-text("${P3}") [data-act="accept"]`);
    await E.waitForSelector('[data-act="assess"][data-k="uncertain"]:not([aria-disabled="true"])', { timeout: 10000 });
    await E.click('[data-act="assess"][data-k="uncertain"]');
    ok('4', 'ER: the UNCERTAIN confirmation says cardiology is activated at once', /recorded as UNCERTAIN and cardiology is activated at once/.test(await E.textContent('.modal')));
    await E.click('[data-act="assess-go"]');
    const act = await D.waitForSelector(`.activation >> text=CAD #${P3}`, { timeout: 15000 }).then(() => true, () => false);
    ok('4', 'Cardiologist: alerted, showing ER assessment UNCERTAIN — ACTIVATE CARDIOLOGIST', act && (await D.textContent('.activation')).includes('UNCERTAIN — ACTIVATE CARDIOLOGIST'));
    await sleep(2000);
    ok('4', 'Cardiologist: the activation alarm sounds', (await doc.tones()) > docBase);
    ok('4', 'Audit and record: "ER Assessment: UNCERTAIN, Cardiology: ACTIVATED"', H.auditOf(S.DATA, P3).some(a => a.action === 'ER Assessment: UNCERTAIN, Cardiology: ACTIVATED') && row(P3).er_assessment === 'uncertain' && row(P3).cardiology_activated_at > 0);
    ok('4', 'Crew: CARDIOLOGY ACTIVATED', await C.waitForSelector(`.qrow:has-text("${P3}") >> text=CARDIOLOGY ACTIVATED`, { timeout: 15000 }).then(() => true, () => false));

    /* ---------- 13 + 9. Dr. Gamma acknowledges; NOT STEMI needs a reason, then closes automatically ---------- */
    await D.click('.activation [data-act="ack"]');
    await H.giveName(D, 'Dr. Gamma');
    await D.waitForSelector('#c-dock [data-act="decide"]:not([aria-disabled="true"])', { timeout: 10000 });
    ok('17', 'Cardiologist: the alarm stopped on ACKNOWLEDGE & OPEN', (await quiet(doc.tones)) === 0);
    ok('4', 'Cardiologist: the case shows the ER assessment UNCERTAIN', /ER: UNCERTAIN — ACTIVATE CARDIOLOGIST/.test(await D.textContent('#c-er')));
    await D.click('#c-dock [data-act="decide"]');
    await D.click('.modal [data-act="d"][data-k="not"]');
    await D.click('[data-act="d-go"]', { force: true });
    ok('9', 'Cardiologist: NOT STEMI without a reason is blocked', await D.isVisible('#d-why-err') && !row(P3).cardiologist_decision);
    await D.click('[data-act="d-why"][data-v="No acute ischaemic changes"]');
    await D.fill('#d-adv', 'Continue standard care (fictional test advice)');
    await H.shot(D, 'path-03-card-not-stemi');
    await D.click('[data-act="d-go"]');
    const ns = await C.waitForSelector('.modal >> text=NOT STEMI / PATHWAY CLOSED', { timeout: 15000 }).then(() => true, () => false);
    ok('9', 'Crew: NOT STEMI / PATHWAY CLOSED with the reason — never CAD CANCELLED', ns && (await C.textContent('.modal')).includes('No acute ischaemic changes') && !/CAD CANCELLED/i.test(await C.evaluate(() => document.body.innerText)));
    await C.click('[data-act="dec-ack"]');
    const r3 = row(P3);
    ok('9', 'NOT STEMI: decision saved, then closed automatically; the CAD number unchanged', r3.cardiologist_decision === 'not' && r3.closure_reason === 'Cardiologist decision: NOT STEMI' && r3.closure_source === 'automatic following Cardiologist decision' && r3.cad === P3);
    ok('9', 'Cardiologist: read-only after NOT STEMI', await waitText(D, 'read-only') && !(await D.isVisible('#c-dock [data-act="decide"]')));
    await E.click('[data-act="queue"]');
    ok('9', 'ER: the case moved to Completed, silently', await E.waitForSelector(`#q-done >> text=CAD #${P3}`, { timeout: 15000 }).then(() => true, () => false) && (await quiet(er.tones, 500)) === 0);

    /* ---------- 13. a second cardiologist on the same phone ---------- */
    await D.click('[data-act="queue"]');
    await D.click('#q-clin [data-act="clinician"]');
    await H.giveName(D, 'Dr. Delta');
    await H.apiSend(api, P4);
    await E.waitForSelector(`.alarmband >> text=CAD #${P4}`, { timeout: 15000 });
    await E.click(`.alarmcase:has-text("${P4}") [data-act="accept"]`);
    await E.waitForSelector('[data-act="assess"][data-k="activate"]:not([aria-disabled="true"])', { timeout: 10000 });
    await E.click('[data-act="assess"][data-k="activate"]'); await E.click('[data-act="assess-go"]');
    await D.waitForSelector(`.activation >> text=CAD #${P4}`, { timeout: 15000 });
    ok('13', 'Cardiologist: the alert says who acknowledges', (await D.textContent('.activation')).includes('As Dr. Delta'));
    await D.click('.activation [data-act="ack"]');
    await D.waitForSelector('#c-er');
    await sleep(600);
    ok('13', 'Each CAD records its own Cardiologist: Dr. Gamma and Dr. Delta', row(P3).cardiologist_name === 'Dr. Gamma' && row(P4).cardiologist_name === 'Dr. Delta');
    ok('12', 'P3 and P4 were accepted by Dr. Beta (remembered for the browser session)', row(P3).er_doctor_name === 'Dr. Beta' && row(P4).er_doctor_name === 'Dr. Beta');

    /* ---------- completed cases: searched by CAD number, read-only, never implying a cardiologist ---------- */
    await D.click('[data-act="queue"]');
    await D.fill('#hq', P1.slice(-6));
    const found = await D.waitForSelector(`#q-done >> text=CAD #${P1}`, { timeout: 8000 }).then(() => true, () => false);
    ok('5', 'Cardiologist search finds the ER-closed case as CARDIOLOGY NOT ACTIVATED', found && (await D.textContent('#q-done')).includes('CARDIOLOGY NOT ACTIVATED'));
    await D.click(`#q-done [data-cad="${P1}"]`);
    await D.waitForSelector('#c-er');
    ok('5', 'Opened from search: no cardiologist involvement implied, read-only', /CARDIOLOGY NOT ACTIVATED/.test(await D.textContent('#c-er')) && !(await D.isVisible('#c-dock [data-act="decide"]')));
    await E.click('[data-act="queue"]');
    await E.waitForSelector(`#q-done [data-cad="${P1}"]`, { timeout: 8000 });
    await E.click(`#q-done [data-cad="${P1}"]`);
    await E.click('[data-act="summary"]');
    const sum = await E.evaluate(() => document.body.innerText);
    ok('5', 'Case Summary of the ER-closed case: NOT SUSPICIOUS FOR STEMI, the reason, Cardiology NOT ACTIVATED', sum.includes('NOT SUSPICIOUS FOR STEMI') && sum.includes('ECG DOES NOT MEET STEMI CRITERIA') && sum.includes('NOT ACTIVATED') && !sum.includes('Dr. Gamma'));
    await H.shot(E, 'path-04-er-summary', true);
    ok('', 'No script errors on any screen', !errors.length, errors.slice(0, 3).join(' | '));
  } finally { await browser.close(); }
}

(async () => {
  const S = await H.startServer();
  try { await main(S); } catch (e) { console.error(e); R.ok('', 'The test ran to the end', false, e.message); } finally { await S.stop(); }
  process.exit(R.summary() ? 1 : 0);
})();
