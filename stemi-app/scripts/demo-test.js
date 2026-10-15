/* The prototype demo mode of the simulated corpuls feed (CORPULS_DEMO_MODE, on by default): the basic demonstration runs
   by itself, with no test console, no real hardware and no upload.
   1 LINK CORPULS → CONNECTING TO CORPULS… → CORPULS CONNECTED → live vital signs → ECG 1 RECEIVED FROM CORPULS, all
     automatic · 2 the crew continues to SEND TO ER after ECG 1 · 3 the manual fallback is not prominent while corpuls is
     connected · 4 connection loss → the manual fallback becomes prominent · 5 the Cardiologist requests a repeat ECG →
     the crew simulates the acquisition; ECG 2 arrives from corpuls on the same CAD number, without an upload ·
     6 a closed case accepts no automatic corpuls events — and RESET CORPULS DEMO, and an unsent case discarded before
     its ECG 1. Screenshots of the demo: scripts/out/demo-*.png. Fictional data only.
   Run: npm run test:demo   (cloud container: NODE_PATH=$(npm root -g) npm run test:demo)
   Its own server, port and temporary database: the development server and data/ are not touched. */
const H = require('./lib/harness');
const { chromium } = H.playwright();
const R = H.Results('Demo mode');
const ok = R.ok, sleep = H.sleep;

async function main(S) {
  const browser = await chromium.launch();
  const errors = [];
  try {
    const { page: C } = await H.crewPage(browser, S.BASE, errors);
    const doc = await H.clinPage(browser, S.BASE, 'cardiologist', errors), D = doc.page;
    const crew = H.Api(S.BASE, 'crew'), er = H.Api(S.BASE, 'er'), card = H.Api(S.BASE, 'cardiologist');
    await crew.start(); await er.start(); await card.start();
    const con = await H.testConsole(S.BASE);
    const A = H.cad(601);
    const row = c => H.db(S.DATA, `SELECT * FROM cases WHERE cad='${c}'`)[0];
    const ecgs = c => H.db(S.DATA, `SELECT n, source, device_id, acquired_at FROM ecgs WHERE cad='${c}' ORDER BY n`);
    const aud = c => H.auditOf(S.DATA, c).map(a => a.action);
    const tile = async k => ((await C.textContent(`#d-mon .mtile--${k} .mtile__v, #c-mon .mtile--${k} .mtile__v`).catch(() => '')) || '').trim();
    const waitText = (p, s, t) => p.waitForFunction(x => document.body.innerText.includes(x), s, { timeout: t || 15000 }).then(() => true, () => false);
    const fbProminent = () => C.evaluate(() => [...document.querySelectorAll('[data-act="fb-draft"], [data-act="ecg-new"]')].some(b => b.offsetParent && !b.classList.contains('btn--quiet')));

    /* ---------- 1. LINK CORPULS: connected, live vital signs and ECG 1, all by themselves ---------- */
    const info = (await con.req('GET', '/api/control/corpuls')).body;
    ok('1', 'Demo mode is on by default, on the simulated provider', info.demo === true && info.simulated === true && info.provider === 'mock');
    await C.click('[data-act="new-case"]'); await C.waitForSelector('#cadin'); await C.fill('#cadin', A);
    /* every state the screen passes through is noted, so the short transitional ones are seen too */
    await C.evaluate(() => {
      window.__seq = [];
      const note = () => {
        const q = s => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; };
        for (const x of [`bar:${q('#d-bar .cbar__t > b')}`, `ecg:${q('#d-ecgalt .ecgwait__t b')}`, `head:${q('#d-ecgh h2')}`, `mon:${q('#d-mon .mon__st')}`]) if (!/:$/.test(x) && !window.__seq.includes(x)) window.__seq.push(x);
      };
      new MutationObserver(note).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    const t0 = Date.now();
    await C.click('[data-act="cad-ok"]');
    await H.shot(C, 'demo-01-connecting');
    await C.waitForSelector('#d-bar .cbar--ok', { timeout: 10000 });
    const tConn = Date.now();
    ok('3', 'While connecting and receiving, the manual fallback is not prominent (only a quiet link)', !(await fbProminent()) && await C.isVisible('#d-ecgalt [data-act="fb-draft"].btn--quiet'));
    await sleep(300);
    await H.shot(C, 'demo-02-receiving');
    const vit = await C.waitForFunction(() => { const v = document.querySelector('#d-mon .mtile--bp .mtile__v'); return v && /\d+\/\d+/.test(v.textContent); }, null, { timeout: 8000 }).then(() => true, () => false);
    const hr0 = +(await tile('hr'));
    ok('1', 'Live HR, SpO₂, BP and RR appear by themselves (LIVE FROM CORPULS)', vit && hr0 >= 85 && hr0 <= 91 && (await tile('spo2')) === '98' && (await tile('bp')) === '132/78' && (await tile('rr')) === '17'
      && /LIVE FROM CORPULS/.test(await C.textContent('#d-mon')), `HR ${hr0}`);
    await C.waitForSelector('#d-viewer:not([hidden]) .ecgv__scroll img', { timeout: 10000 });
    const tEcg = Date.now();
    await sleep(400);
    await H.shot(C, 'demo-03-ecg1');
    const seq = await C.evaluate(() => window.__seq), at = s => seq.indexOf(s);
    ok('1', 'The screen goes CONNECTING TO CORPULS… → CORPULS CONNECTED → RECEIVING 12-LEAD ECG FROM CORPULS… → ECG 1 RECEIVED FROM CORPULS',
      at('bar:CONNECTING TO CORPULS…') >= 0 && at('bar:CONNECTING TO CORPULS…') < at('bar:CORPULS CONNECTED') && at('ecg:RECEIVING 12-LEAD ECG FROM CORPULS…') >= 0
      && at('ecg:RECEIVING 12-LEAD ECG FROM CORPULS…') < at('head:ECG 1 RECEIVED FROM CORPULS'), seq.join(' | '));
    ok('1', 'Connected about a second after LINK CORPULS; ECG 1 a few seconds later (2–5 s)', tConn - t0 < 4000 && tEcg - tConn >= 1500 && tEcg - tConn <= 6000, `connected ${tConn - t0} ms, ECG 1 ${tEcg - tConn} ms after`);
    ok('1', 'No dead-end wording at any point', !seq.some(x => /WAITING FOR ECG|No ECG has arrived|Acquire the 12-lead ECG on corpuls3/.test(x)));
    const e1 = ecgs(A);
    ok('1', 'ECG 1 arrived from corpuls with no console input and no upload (source corpuls, the unit\'s monitor)', e1.length === 1 && e1[0].source === 'corpuls' && e1[0].device_id === 'SIM-C3-214'
      && H.db(S.DATA, `SELECT COUNT(*) n FROM ecg_images WHERE cad='${A}' AND source<>'corpuls'`)[0].n === 0);
    ok('1', 'Crew: ECG 1 RECEIVED FROM CORPULS · Acquired hh:mm:ss; the steps all done; a subtle SIMULATED CORPULS FEED tag', /ECG 1 RECEIVED FROM CORPULS/.test(await C.textContent('#d-ecgh')) && /Acquired \d\d:\d\d:\d\d/.test(await C.textContent('#d-ecgh'))
      && (await C.$$('#d-bar .csteps li.is-done')).length === 4 && /Simulated corpuls feed/i.test(await C.textContent('#d-bar')));
    const v1 = row(A).vitals_at;
    await sleep(2500);
    ok('1', 'Vital-sign updates keep arriving by themselves', row(A).vitals_at > v1);
    ok('3', 'With ECG 1 received and corpuls connected, the fallback is still not prominent', !(await fbProminent()));

    /* ---------- 2. the crew continues to SEND TO ER ---------- */
    await C.fill('#md-age', '61'); await C.click('[data-act="md-set"][data-k="sex"][data-v="Female"]'); await C.click('[data-act="md-set"][data-k="complaint"][data-v="cp"]'); await C.click('[data-act="md-ago"][data-m="30"]');
    await C.waitForSelector('[data-act="send"]:not([aria-disabled="true"])', { timeout: 5000 });
    ok('2', 'Ready: CAD, ECG 1 from corpuls, patient 4 of 4 — nothing else to do', /ECG 1 from corpuls/.test(await C.textContent('.readylist')) && /Patient 4 of 4/.test(await C.textContent('.readylist')));
    await H.shot(C, 'demo-04-ready');
    await C.click('[data-act="send"]');
    await C.waitForSelector(`.case-h__cad:has-text("CAD #${A}")`, { timeout: 15000 });
    ok('2', 'SEND TO ER: SENT TO ER; the case reached the platform with ECG 1 and the latest monitor values', (await C.textContent('.status-panel')).includes('SENT TO ER') && row(A).server_received_at > 0
      && aud(A).some(a => a.startsWith('Latest monitor values sent with the case')));
    await H.shot(C, 'demo-05-sent');

    /* ---------- 5. repeat ECG: simulated on the crew screen, arrives from corpuls on the same CAD ---------- */
    await er.one(A, 'er_accept', { name: 'Dr. Demo ER' }); await er.one(A, 'er_assess', { kind: 'activate', on: 1, name: 'Dr. Demo ER' });
    await D.waitForSelector(`.activation >> text=CAD #${A}`, { timeout: 15000 });
    await D.click('.activation [data-act="ack"]'); await H.giveName(D, 'Dr. Demo Cardiology');
    await D.waitForSelector('#c-dock [data-act="decide"]:not([aria-disabled="true"])', { timeout: 10000 });
    await D.click('#c-dock [data-act="decide"]'); await D.click('.modal [data-act="d"][data-k="repeat"]'); await D.click('[data-act="d-go"]');
    const rq = await C.waitForSelector('.modal >> text=REPEAT ECG REQUESTED', { timeout: 15000 }).then(() => true, () => false);
    await C.click('[data-act="dec-ack"]');
    const btn = await C.waitForSelector('.status-panel [data-act="demo-acq"]', { timeout: 8000 }).then(() => true, () => false);
    ok('5', 'Crew: REPEAT ECG REQUESTED, with SIMULATE REPEAT ECG ACQUISITION (prototype only; no upload asked)', rq && btn && /SIMULATE REPEAT ECG ACQUISITION/.test(await C.textContent('.status-panel'))
      && /Prototype only/.test(await C.textContent('.status-panel')) && !(await fbProminent()));
    await H.shot(C, 'demo-06-repeat');
    await C.click('.status-panel [data-act="demo-acq"]');
    const got2 = await waitText(C, 'REPEAT ECG SENT — CARDIOLOGIST REVIEWING');
    const two = ecgs(A);
    ok('5', 'ECG 2 arrives from corpuls on the same CAD number; ECG 1 unchanged; no image uploaded', got2 && two.length === 2 && two[1].n === 2 && two[1].source === 'corpuls' && two[0].acquired_at === e1[0].acquired_at
      && H.db(S.DATA, `SELECT COUNT(*) n FROM ecg_images WHERE cad='${A}' AND source<>'corpuls'`)[0].n === 0);
    ok('5', 'Cardiologist: ECG 2 arrives silently, announced', await D.waitForSelector('.ecgv__new >> text=ECG 2', { timeout: 10000 }).then(() => true, () => false));
    ok('5', 'Audit: the simulated acquisition is recorded as a prototype action, then "ECG 2 received from corpuls"', aud(A).some(a => a.startsWith('Prototype demo: repeat 12-lead acquisition on the simulated corpuls3')) && aud(A).some(a => a.startsWith('ECG 2 received from corpuls')));
    ok('5', 'API: only the crew can simulate the acquisition', (await er.req('POST', '/api/corpuls/demo-acquire', { cad: A })).status === 403);
    await sleep(600);
    await H.shot(C, 'demo-07-ecg2');

    /* ---------- 4. connection loss: the fallback becomes prominent ---------- */
    await H.sim(S.BASE, A, 'disconnect');
    const lost = await C.waitForSelector('#c-bar .cbar--warn', { timeout: 8000 }).then(() => true, () => false);
    ok('4', 'Connection lost: CORPULS CONNECTION LOST · MANUAL FALLBACK AVAILABLE, the fallback prominent', lost && /CORPULS CONNECTION LOST/.test(await C.textContent('#c-bar')) && /MANUAL FALLBACK AVAILABLE/.test(await C.textContent('#c-bar'))
      && await C.isVisible('#c-bar [data-act="ecg-new"]') && await fbProminent());
    ok('4', 'The last values stay, with their time; the pathway is not closed', (await tile('bp')) === '132/78' && /LAST DATA RECEIVED/.test(await C.textContent('#c-mon')) && !row(A).closed_at);
    await H.shot(C, 'demo-08-lost');

    /* ---------- RESET CORPULS DEMO (test console only) ---------- */
    const rs = await con.req('POST', '/api/control/corpuls/reset-demo', {});
    const back = await C.waitForSelector('#c-bar .cbar--ok', { timeout: 8000 }).then(() => true, () => false);
    ok('R', 'RESET CORPULS DEMO: the simulated monitor is back (connected, default values); the fallback quiet again', rs.status === 200 && rs.body.ok && back && !(await fbProminent()) && ecgs(A).length === 2);
    ok('R', 'The reset is not offered on the crew screen', !(await C.isVisible('[data-act="corp-reset"]')) && !/RESET CORPULS DEMO/.test(await C.textContent('body')));
    ok('R', 'API: only the test console can reset the demo', (await crew.req('POST', '/api/control/corpuls/reset-demo', {})).status === 403);

    /* ---------- 6. a closed case accepts no automatic corpuls events ---------- */
    await D.waitForSelector('.ecgv__new >> text=ECG 2', { timeout: 5000 }).catch(() => {});
    await D.click('#c-dock [data-act="view-latest"]').catch(() => {});
    await D.waitForSelector('#c-dock [data-act="decide"]:not([aria-disabled="true"])', { timeout: 10000 });
    await D.click('#c-dock [data-act="decide"]'); await D.click('.modal [data-act="d"][data-k="confirm"]'); await D.click('[data-act="d-go"]');
    await C.waitForSelector('.modal >> text=CONFIRMED STEMI', { timeout: 15000 }); await C.click('[data-act="dec-ack"]');
    await C.click('.status-panel [data-act="complete"]'); await C.click('[data-act="complete-go"]');
    await waitText(C, 'STEMI PATHWAY COMPLETED');
    await sleep(500);
    const closed = row(A);
    await sleep(3000);
    ok('6', 'Closed: the feed ends and no automatic vital-sign update arrives any more', closed.closed_at > 0 && closed.corpuls_link_ended_at > 0 && row(A).vitals_at === closed.vitals_at && row(A).vitals_json === closed.vitals_json);
    const late = await H.sim(S.BASE, A, 'trigger-ecg'), lateV = await H.sim(S.BASE, A, 'send-vitals'), lateC = await crew.req('POST', '/api/corpuls/demo-acquire', { cad: A });
    ok('6', 'Late ECG and vital signs for the closed case are refused; the crew\'s simulated acquisition too', late.status === 409 && /closed and read-only/.test(late.body.error || '') && lateV.status === 409 && lateC.status === 409 && ecgs(A).length === 2);
    ok('6', 'Crew: CORPULS FEED ENDED; no simulated acquisition offered on the closed case', /CORPULS FEED ENDED/.test(await C.textContent('#c-bar')) && !(await C.isVisible('[data-act="demo-acq"]')));

    /* an unsent case discarded before its automatic ECG 1: nothing attaches to it afterwards */
    const B = H.cad(602);
    await crew.req('POST', '/api/cases', { cad: B, cid: 'cid-b', link: true });
    await crew.req('POST', '/api/cases/discard', { cad: B });
    await sleep(5000);
    ok('6', 'An unsent case discarded before its automatic ECG 1: the feed ended, no ECG and no data arrive', row(B).corpuls_link_ended_at > 0 && ecgs(B).length === 0);
    /* a case that already holds a fallback ECG on the tablet gets no automatic ECG 1 */
    const F = H.cad(603);
    await crew.req('POST', '/api/cases', { cad: F, cid: 'cid-f', link: true, autoEcg: false });
    await sleep(5000);
    ok('1', 'No automatic ECG 1 when the tablet already holds a fallback ECG (connected, live values, no ECG)', row(F).corpuls_status === 'connected' && !!row(F).vitals_json && ecgs(F).length === 0);
    ok('', 'No script errors on any screen', !errors.length, errors.slice(0, 3).join(' | '));
  } finally { await browser.close(); }
}

(async () => {
  /* the demo's own timing (connect 0.8 s, ECG 1 3 s later); vital signs every second to keep the run short */
  const S = await H.startServer({ MOCK_AI_DELAY_MS: '600' });
  try { await main(S); } catch (e) { console.error(e); R.ok('', 'The test ran to the end', false, e.message); } finally { await S.stop(); }
  process.exit(R.summary() ? 1 : 0);
})();
