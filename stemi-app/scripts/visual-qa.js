/* Visual QA: every major screen at realistic sizes, screenshotted to scripts/out/visual/, with automatic checks:
   - no horizontal page overflow (only the ECG viewer may scroll sideways, inside itself)
   - no control smaller than 40 × 40 px (inline text links excepted)
   - every image has alt text, every button and form field has an accessible name
   Covered (corpuls-driven, in the prototype's demo mode): the crew's demo flow — CONNECTING TO CORPULS…, CORPULS
   CONNECTED with live values while ECG 1 is received, ECG 1 RECEIVED FROM CORPULS, ready to send, after SEND, repeat ECG
   requested with SIMULATE REPEAT ECG ACQUISITION, ECG 2 received, corpuls connection lost, the manual fallback; the ER
   and the Cardiologist with live data; the serial ECG view; the completed Case Summary; the test console's corpuls
   simulator; and the rest of the pathway. Fictional test data is created through the API and the simulated corpuls feed
   first. The simulated monitor connects in 2.5 s and sends ECG 1 4 s later here, so each transitional state is held
   long enough for its screenshot (the demo's own timing: 0.8 s and 3 s).
   Run: npm run test:visual   (cloud container: NODE_PATH=$(npm root -g) npm run test:visual). */
const fs = require('node:fs');
const path = require('node:path');
const H = require('./lib/harness');
const { chromium } = H.playwright();
const R = H.Results('Visual QA');
const DIR = path.join(H.OUT, 'visual');
const VP = { desktop: { width: 1440, height: 900 }, tablet: { width: 1180, height: 820 }, portrait: { width: 820, height: 1180 }, phone: { width: 393, height: 852 }, phoneLand: { width: 852, height: 393 } };

/* the checks, run in the page */
const AUDIT = () => {
  const out = { overflow: 0, wide: [], small: [], noAlt: 0, noName: [] };
  const W = document.documentElement.clientWidth;
  out.overflow = document.documentElement.scrollWidth - W;
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || el.closest('.ecgv__scroll, .ecgv__tabs, .ecgv__imgs, [aria-hidden="true"], .sr-only, svg')) continue;
    const r = el.getBoundingClientRect();
    if (r.right > W + 1 && getComputedStyle(el).position !== 'fixed') out.wide.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} (${Math.round(r.right - W)} px)`);
  }
  for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role="radio"], [role="tab"]')) {
    if (!vis(el) || el.closest('[aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect();
    const inline = el.classList.contains('link-btn') || (el.tagName === 'A' && !el.className) || el.classList.contains('nbtn');
    if (!inline && (r.height < 39.5 || r.width < 39.5)) out.small.push(`${el.tagName.toLowerCase()}${el.dataset.act ? '[' + el.dataset.act + ']' : ''} ${Math.round(r.width)}×${Math.round(r.height)} "${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 24)}"`);
    const name = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || '').trim() || (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.getAttribute('aria-labelledby') || el.closest('label');
    if (!name) out.noName.push(el.outerHTML.slice(0, 80));
  }
  out.noAlt = [...document.querySelectorAll('img')].filter(i => !i.hasAttribute('alt')).length;
  out.wide = [...new Set(out.wide)].slice(0, 6); out.small = [...new Set(out.small)].slice(0, 8); out.noName = out.noName.slice(0, 4);
  return out;
};

async function check(page, name, note) {
  fs.mkdirSync(DIR, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(DIR, name + '.png'), fullPage: true });
  const a = await page.evaluate(AUDIT);
  const okAll = a.overflow <= 1 && !a.wide.length && !a.small.length && !a.noAlt && !a.noName.length;
  R.ok(name, note || name, okAll, okAll ? '' : JSON.stringify({ overflow: a.overflow, wide: a.wide, small: a.small, noAlt: a.noAlt, noName: a.noName }));
}

async function main(S) {
  const browser = await chromium.launch();
  const errors = [];
  try {
    /* fictional cases in every state; each demo case has a simulated corpuls monitor of its own, so all show live data */
    const crew = H.Api(S.BASE, 'crew'), er = H.Api(S.BASE, 'er'), doc = H.Api(S.BASE, 'cardiologist'), con = await H.testConsole(S.BASE);
    await crew.start(); await er.start(); await doc.start();
    const c = n => H.cad(500 + n), sim = (n, k, b) => H.sim(S.BASE, c(n), k, b);
    const demo = async n => { const r = await con.req('POST', '/api/control/demo-case', { cad: c(n) }); if (r.status !== 200) throw new Error('demo case ' + n + ': ' + JSON.stringify(r.body)); };
    const DRN = 'Dr. Ahmed Mohammed', DCN = 'Dr. Sara Al Mansoori';
    for (let i = 1; i <= 9; i++) await demo(i);
    for (let i = 2; i <= 9; i++) await er.one(c(i), 'er_accept', { name: DRN });
    await er.one(c(3), 'er_assess', { kind: 'not_suspicious', reason: 'alternative', comment: 'Fictional test comment: pericardial rub on auscultation', on: 1, name: DRN });
    for (const i of [4, 5, 6, 7, 8, 9]) await er.one(c(i), 'er_assess', { kind: i === 5 ? 'uncertain' : 'activate', on: 1, name: DRN });
    for (const i of [5, 6, 7, 8, 9]) await doc.one(c(i), 'ack', { name: DCN });
    await doc.one(c(6), 'decision', { k: 'repeat', on: 1, reasons: ['Dynamic changes suspected'], instr: 'Add V7 to V9', within: 10, name: DCN });
    await doc.one(c(7), 'decision', { k: 'confirm', on: 1, note: 'Fictional test note', name: DCN });
    await sim(7, 'set', { sys: 128, dia: 76, hr: 92 }); await sim(7, 'send-vitals');
    await crew.one(c(7), 'rec', { k: 'asp', label: 'Aspirin', v: 'Given' });
    /* a serial case: ECG 1, 2 and 3 from corpuls */
    await doc.one(c(8), 'decision', { k: 'repeat', on: 1, reasons: ['Dynamic changes suspected'], name: DCN });
    await sim(8, 'trigger-ecg', { sample: 'B' });
    await doc.one(c(8), 'decision', { k: 'repeat', on: 2, reasons: ['Repeat due to ongoing symptoms'], name: DCN });
    await sim(8, 'trigger-ecg', { sample: 'C' });
    /* a completed case */
    await doc.one(c(9), 'decision', { k: 'confirm', on: 1, name: DCN });
    await crew.req('POST', '/api/cases/complete', { cad: c(9) });
    /* a case whose monitor is disconnected */
    await sim(4, 'disconnect');
    await H.sleep(2500);

    /* ---------- role chooser and login ---------- */
    for (const [vp, k] of [[VP.desktop, 'desktop'], [VP.phone, 'phone']]) {
      const ctx = await browser.newContext({ viewport: vp }), p = await ctx.newPage(); H.watch(p, errors, 'entry');
      await p.goto(S.BASE + '/'); await check(p, `entry-roles-${k}`, `Role chooser (${k})`);
      await p.goto(S.BASE + '/login'); await check(p, `entry-login-${k}`, `Crew login (${k})`);
      await ctx.close();
    }

    /* ---------- crew: the corpuls-driven case, state by state ---------- */
    let n = 40;
    for (const [vp, k] of [[VP.tablet, 'tablet'], [VP.desktop, 'desktop'], [VP.portrait, 'portrait']]) {
      const { ctx, page: p } = await H.crewPage(browser, S.BASE, errors, { viewport: vp });
      await p.waitForSelector('.qrow');
      for (let i = 0; i < 8; i++) {
        await p.waitForTimeout(600);
        if (!(await p.isVisible('.modal'))) break;
        if (i === 0) await check(p, `crew-decision-popup-${k}`, `Crew · a decision received (${k})`);
        await p.click('.modal [data-act="dec-ack"], .modal [data-act="er-ack"]');
      }
      await check(p, `crew-home-${k}`, `Crew home (${k})`);
      /* the demo: LINK CORPULS → CONNECTING TO CORPULS… → CORPULS CONNECTED with live values → ECG 1, all by itself */
      const Y = H.cad(500 + (++n));
      await p.click('[data-act="new-case"]'); await p.fill('#cadin', Y);
      await check(p, `crew-cad-${k}`, `Crew · CAD number (${k})`);
      await p.click('[data-act="cad-ok"]'); await p.waitForSelector('#d-bar .cbar--busy', { timeout: 10000 });
      await check(p, `crew-connecting-${k}`, `Crew · CONNECTING TO CORPULS… (${k})`);
      await p.waitForSelector('#d-bar .cbar--ok', { timeout: 10000 }); await p.waitForTimeout(300);
      await check(p, `crew-connected-${k}`, `Crew · corpuls connected, live values, receiving ECG 1 (${k})`);
      await p.waitForSelector('#d-viewer:not([hidden]) img', { timeout: 15000 });
      await check(p, `crew-ecg1-${k}`, `Crew · ECG 1 received from corpuls by itself (${k})`);
      await p.click('[data-act="send"]', { force: true });
      await check(p, `crew-missing-${k}`, `Crew · SEND pressed with patient items missing (${k})`);
      await p.fill('#md-age', '58'); await p.click('[data-act="md-set"][data-k="sex"][data-v="Male"]'); await p.click('[data-act="md-set"][data-k="complaint"][data-v="oth"]');
      await p.fill('#md-other', 'Jaw pain (fictional)'); await p.click('[data-act="md-ago"][data-m="60"]');
      await check(p, `crew-ready-${k}`, `Crew · ready to send (${k})`);
      await p.click('[data-act="send"]'); await p.waitForSelector('.status-panel', { timeout: 15000 });
      await check(p, `crew-sent-${k}`, `Crew · after SEND (${k})`);
      await er.one(Y, 'er_accept', { name: DRN }); await er.one(Y, 'er_assess', { kind: 'activate', on: 1, name: DRN });
      await doc.one(Y, 'ack', { name: DCN }); await doc.one(Y, 'decision', { k: 'repeat', on: 1, reasons: ['Poor ECG quality'], instr: 'Repeat with V7 to V9', name: DCN });
      await p.waitForSelector('.modal [data-act="dec-ack"]', { timeout: 15000 }); await p.click('.modal [data-act="dec-ack"]');
      await check(p, `crew-repeat-${k}`, `Crew · repeat ECG requested, SIMULATE REPEAT ECG ACQUISITION (${k})`);
      await p.click('.status-panel [data-act="demo-acq"]'); await p.waitForSelector('.status-panel >> text=REPEAT ECG SENT', { timeout: 10000 });
      await check(p, `crew-repeat-received-${k}`, `Crew · ECG 2 received from corpuls (simulated acquisition) (${k})`);
      await H.sim(S.BASE, Y, 'disconnect'); await p.waitForSelector('#c-bar .cbar--warn', { timeout: 10000 });
      await check(p, `crew-lost-${k}`, `Crew · corpuls connection lost (${k})`);
      await p.click('#c-bar [data-act="ecg-new"]'); await p.click('.modal [data-act="img-add"]'); await p.click('[data-act="img-gen"]'); await p.waitForSelector('[data-act="ecg-send"]:not([disabled])');
      await check(p, `crew-fallback-${k}`, `Crew · manual ECG fallback (${k})`);
      await p.click('.modal [data-act="modal-close"]');
      await p.click('#c-mon [data-act="vitals"]'); await check(p, `crew-fallback-vitals-${k}`, `Crew · manual vital signs fallback (${k})`); await p.click('.modal [data-act="modal-close"]');
      await p.click('[data-act="home"]');
      await p.click(`.qrow[data-cad="${c(7)}"]`); await p.waitForSelector('.status-panel');
      await check(p, `crew-confirmed-${k}`, `Crew · CONFIRMED STEMI (${k})`);
      await p.click('.status-panel [data-act="complete"]'); await check(p, `crew-complete-${k}`, `Crew · COMPLETE STEMI PATHWAY? (${k})`); await p.click('.modal [data-act="modal-close"]');
      await p.click('[data-act="treat"]'); await p.click('[data-act="t-k"][data-v="asp"]'); await p.click('[data-act="t-o"][data-v="Given"]'); await check(p, `crew-treatment-${k}`, `Crew · treatment update (${k})`); await p.click('.modal [data-act="modal-close"]');
      await p.click('[data-act="home"]'); await p.fill('#hq', c(9).slice(-6)); await p.waitForSelector(`#q-done [data-cad="${c(9)}"]`);
      await p.click(`#q-done [data-cad="${c(9)}"]`); await p.waitForSelector('.case-h');
      await p.click('[data-act="summary"]'); await check(p, `crew-summary-completed-${k}`, `Crew · completed Case Summary (${k})`);
      await ctx.close();
    }

    /* ---------- ER Doctor ---------- */
    let fresh = 20;
    for (const [vp, k] of [[VP.desktop, 'desktop'], [VP.tablet, 'tablet'], [VP.portrait, 'portrait']]) {
      await demo(++fresh); /* each pass accepts one new case */
      const ctx = await browser.newContext({ viewport: vp }), p = await ctx.newPage(); H.watch(p, errors, 'er');
      await p.goto(S.BASE + '/er'); await check(p, `er-gate-${k}`, `ER start screen (${k})`);
      await p.click('#gate-go'); await p.waitForSelector('.alarmband');
      await check(p, `er-queue-alert-${k}`, `ER queue with a new case alert (${k})`);
      await p.click(`.alarmcase:has-text("${c(fresh)}") [data-act="accept"]`); await p.waitForSelector('#clin-name');
      await check(p, `er-name-${k}`, `ER name prompt (${k})`);
      await H.giveName(p, DRN); await p.waitForSelector('.accepted'); await p.waitForSelector('#c-strip .mon-st', { timeout: 8000 }); await p.waitForTimeout(600);
      await check(p, `er-review-live-${k}`, `ER review with live corpuls data (${k})`);
      await p.click('[data-act="assess"][data-k="not_suspicious"]'); await p.click('[data-act="ns-go"]', { force: true });
      await check(p, `er-not-suspicious-${k}`, `ER NOT SUSPICIOUS panel with the error (${k})`);
      await p.click('.modal [data-act="modal-close"]');
      await p.click('[data-act="assess"][data-k="uncertain"]'); await check(p, `er-uncertain-confirm-${k}`, `ER UNCERTAIN confirmation (${k})`); await p.click('.modal [data-act="modal-close"]');
      await p.click('[data-act="queue"]');
      await p.click(`.qrow[data-cad="${c(8)}"]`); await p.waitForSelector('.case-h'); await p.click('#c-viewer [data-v="cmp"]');
      await check(p, `er-serial-${k}`, `ER · serial ECG view, compare (${k})`);
      await p.click('[data-act="queue"]');
      await p.click(`.qrow[data-cad="${c(4)}"]`); await p.waitForSelector('.case-h'); await p.waitForTimeout(600);
      await check(p, `er-monitor-lost-${k}`, `ER · live monitor data temporarily unavailable (${k})`);
      await p.click('[data-act="queue"]');
      await p.click(`.qrow[data-cad="${c(7)}"]`); await p.waitForSelector('.case-h'); await check(p, `er-confirmed-${k}`, `ER · a CONFIRMED STEMI case (${k})`);
      await p.click('[data-act="queue"]'); await p.waitForSelector(`#q-done [data-cad="${c(3)}"]`);
      await p.click(`#q-done [data-cad="${c(3)}"]`); await p.waitForSelector('.case-h'); await check(p, `er-closed-${k}`, `ER · a case closed by the ER (${k})`);
      await p.click('[data-act="summary"]'); await check(p, `er-summary-${k}`, `ER · Case Summary (${k})`);
      await ctx.close();
    }

    /* ---------- Cardiologist ---------- */
    await doc.one(c(4), 'ack', { name: DCN }); /* no older activation waiting: each pass acknowledges its own */
    for (const [vp, k] of [[VP.phone, 'phone'], [VP.phoneLand, 'phone-landscape'], [VP.tablet, 'tablet']]) {
      /* each pass acknowledges one new activation */
      const nc = c(++fresh); await demo(fresh); await er.one(nc, 'er_accept', { name: DRN }); await er.one(nc, 'er_assess', { kind: 'activate', on: 1, name: DRN });
      const ctx = await browser.newContext({ ...(k.startsWith('phone') ? H.PHONE : {}), viewport: vp }), p = await ctx.newPage(); H.watch(p, errors, 'cardiologist');
      await p.goto(S.BASE + '/cardiologist'); await check(p, `card-gate-${k}`, `Cardiologist start screen (${k})`);
      await p.click('#gate-go'); await p.waitForSelector('.activation');
      await check(p, `card-alert-${k}`, `Cardiologist activation alert (${k})`);
      await p.click('.activation [data-act="ack"]'); await p.waitForSelector('#clin-name');
      await check(p, `card-name-${k}`, `Cardiologist name prompt (${k})`);
      await H.giveName(p, DCN); await p.waitForSelector('#c-er'); await p.waitForSelector('#c-strip .mon-st', { timeout: 8000 }); await p.waitForTimeout(600);
      await check(p, `card-case-live-${k}`, `Cardiologist case with live corpuls data (${k})`);
      const decide = k === 'tablet' ? '#c-decide [data-act="d"][data-k="confirm"]' : '#c-dock [data-act="decide"]';
      if (k !== 'tablet') { await p.click(decide); await check(p, `card-choose-${k}`, `Cardiologist decision choice (${k})`); await p.click('.modal [data-act="d"][data-k="not"]'); }
      else await p.click('#c-decide [data-act="d"][data-k="not"]');
      await p.click('[data-act="d-go"]', { force: true });
      await check(p, `card-not-${k}`, `Cardiologist NOT STEMI with the error (${k})`);
      await p.click('.modal [data-act="modal-close"]');
      await p.click('[data-act="queue"]'); await check(p, `card-queue-${k}`, `Cardiologist queue (${k})`);
      await p.click(`.qrow[data-cad="${c(8)}"]`); await p.waitForSelector('#c-er'); await p.click('#c-viewer [data-v="cmp"]');
      await check(p, `card-serial-${k}`, `Cardiologist · serial ECG view, compare (${k})`);
      await p.click('[data-act="queue"]');
      await p.click(`.qrow[data-cad="${c(7)}"]`); await p.waitForSelector('#c-er'); await check(p, `card-confirmed-${k}`, `Cardiologist · CONFIRMED STEMI (${k})`);
      await p.click('[data-act="summary"]'); await check(p, `card-summary-${k}`, `Cardiologist · Case Summary (${k})`);
      await p.click('[data-act="sum-back"]'); await p.waitForSelector('.ecgv__scroll');
      await p.click('[data-act="queue"]');
      await ctx.close();
    }
    /* the full-screen ECG viewer */
    {
      const ctx = await browser.newContext({ ...H.PHONE }), p = await ctx.newPage(); H.watch(p, errors, 'cardiologist');
      await p.goto(S.BASE + '/cardiologist'); await p.click('#gate-go');
      await p.click(`.qrow[data-cad="${c(7)}"]`); await p.waitForSelector('.ecgv__scroll');
      await p.click('#c-viewer [data-v="fs"]'); await p.waitForSelector('.ecgfs');
      await check(p, 'card-fullscreen-phone', 'Full-screen ECG (phone)');
      await ctx.close();
    }

    /* ---------- test console and its corpuls simulator ---------- */
    for (const [vp, k] of [[VP.desktop, 'desktop'], [VP.tablet, 'tablet']]) {
      const ctx = await browser.newContext({ viewport: vp }), p = await ctx.newPage(); H.watch(p, errors, 'control');
      await p.goto(S.BASE + '/control'); await p.waitForSelector('tr[data-cad]'); await p.waitForSelector('#corp-cad');
      await p.click(`tr[data-cad="${c(7)}"]`); await p.waitForSelector('.ts');
      await check(p, `console-simulator-${k}`, `Test console with the corpuls simulator (${k})`);
      await ctx.close();
    }
    R.ok('', 'No script errors on any screen', !errors.length, errors.slice(0, 3).join(' | '));
  } finally { await browser.close(); }
}

(async () => {
  const S = await H.startServer({ MOCK_AI_DELAY_MS: '400', CORPULS_SIM_CONNECT_MS: '2500', CORPULS_DEMO_ECG_SECONDS: '4' });
  try { await main(S); } catch (e) { console.error(e); R.ok('', 'The visual QA ran to the end', false, e.message); } finally { await S.stop(); }
  console.log(`Screenshots: ${path.relative(process.cwd(), DIR)}`);
  process.exit(R.summary() ? 1 : 0);
})();
