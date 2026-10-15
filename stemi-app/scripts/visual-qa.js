/* Visual QA: every major screen at realistic sizes, screenshotted to scripts/out/visual/, with automatic checks:
   - no horizontal page overflow (only the ECG viewer may scroll sideways, inside itself)
   - no control smaller than 40 × 40 px (inline text links excepted)
   - every image has alt text, every button and form field has an accessible name
   Fictional test data is created through the API in every state of the pathway first.
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
    if (!vis(el) || el.closest('.ecgv__scroll, .ecgv__tabs, .ecgv__imgs, .steps, [aria-hidden="true"], .sr-only, svg')) continue;
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
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(DIR, name + '.png'), fullPage: true });
  const a = await page.evaluate(AUDIT);
  const okAll = a.overflow <= 1 && !a.wide.length && !a.small.length && !a.noAlt && !a.noName.length;
  R.ok(name, note || name, okAll, okAll ? '' : JSON.stringify({ overflow: a.overflow, wide: a.wide, small: a.small, noAlt: a.noAlt, noName: a.noName }));
}

async function main(S) {
  const browser = await chromium.launch();
  const errors = [];
  try {
    /* fictional cases in every state */
    const crew = H.Api(S.BASE, 'crew'), er = H.Api(S.BASE, 'er'), doc = H.Api(S.BASE, 'cardiologist');
    await crew.start(); await er.start(); await doc.start();
    const c = n => H.cad(500 + n);
    for (let i = 1; i <= 7; i++) await H.apiSend(crew, c(i));
    for (const i of [2, 3, 4, 5, 6, 7]) await er.one(c(i), 'er_accept', { name: 'Dr. Ahmed Mohammed' });
    await er.one(c(3), 'er_assess', { kind: 'not_suspicious', reason: 'alternative', comment: 'Fictional test comment: pericardial rub on auscultation', on: 1, name: 'Dr. Ahmed Mohammed' });
    for (const i of [4, 5, 6, 7]) await er.one(c(i), 'er_assess', { kind: i === 5 ? 'uncertain' : 'activate', on: 1, name: 'Dr. Ahmed Mohammed' });
    for (const i of [5, 6, 7]) await doc.one(c(i), 'ack', { name: 'Dr. Sara Al Mansoori' });
    await doc.one(c(6), 'decision', { k: 'repeat', on: 1, reasons: ['Dynamic changes suspected'], instr: 'Add V7 to V9', within: 10, name: 'Dr. Sara Al Mansoori' });
    await doc.one(c(7), 'decision', { k: 'confirm', on: 1, note: 'Fictional test note', name: 'Dr. Sara Al Mansoori' });
    await crew.one(c(7), 'md', { k: 'bp', v: '128/76 mmHg', raw: { sys: 128, dia: 76 }, kind: 'update' });
    await crew.one(c(7), 'rec', { k: 'asp', label: 'Aspirin', v: 'Given · 10:41' });
    await H.sleep(2500);

    /* ---------- role chooser and login ---------- */
    for (const [vp, k] of [[VP.desktop, 'desktop'], [VP.phone, 'phone']]) {
      const ctx = await browser.newContext({ viewport: vp }), p = await ctx.newPage(); H.watch(p, errors, 'entry');
      await p.goto(S.BASE + '/'); await check(p, `entry-roles-${k}`, `Role chooser (${k})`);
      await p.goto(S.BASE + '/login'); await check(p, `entry-login-${k}`, `Crew login (${k})`);
      await ctx.close();
    }

    /* ---------- crew ---------- */
    for (const [vp, k] of [[VP.tablet, 'tablet'], [VP.desktop, 'desktop'], [VP.portrait, 'portrait']]) {
      const { ctx, page: p } = await H.crewPage(browser, S.BASE, errors, { viewport: vp });
      await p.waitForSelector('.qrow');
      /* decisions and outcomes not yet acknowledged are shown one after another: acknowledge them first */
      for (let i = 0; i < 6; i++) {
        await p.waitForTimeout(700);
        if (!(await p.isVisible('.modal'))) break;
        if (i === 0) await check(p, `crew-decision-popup-${k}`, `Crew · a decision received (${k})`);
        await p.click('.modal [data-act="dec-ack"], .modal [data-act="er-ack"]');
      }
      await check(p, `crew-home-${k}`, `Crew home (${k})`);
      await p.click('[data-act="new-case"]'); await p.fill('#cadin', H.cad(590 + Object.keys(VP).indexOf(k)));
      await check(p, `crew-new-cad-${k}`, `Crew new case · CAD (${k})`);
      await p.click('[data-act="cad-ok"]'); await p.waitForSelector('[data-act="img-add"]');
      await p.click('[data-act="img-add"]'); await check(p, `crew-new-addimage-${k}`, `Crew new case · add image dialog (${k})`);
      await p.click('[data-act="img-gen"]'); await p.click('[data-act="img-add"]'); await p.click('[data-act="img-gen"]');
      await check(p, `crew-new-ecg-${k}`, `Crew new case · ECG (${k})`);
      await p.click('[data-act="step"][data-k="md"]'); await p.click('[data-act="md-done"]');
      await check(p, `crew-new-md-errors-${k}`, `Crew new case · minimum data with errors (${k})`);
      await p.fill('#md-age', '58'); await p.click('[data-act="md-set"][data-k="sex"][data-v="Male"]'); await p.click('[data-act="md-set"][data-k="complaint"][data-v="oth"]');
      await p.fill('#md-other', 'Jaw pain (fictional)'); await p.click('[data-act="md-ago"][data-m="60"]');
      await p.fill('#md-sys', '150'); await p.fill('#md-dia', '90'); await p.fill('#md-hr', '96'); await p.fill('#md-spo2', '95'); await p.fill('#md-gcs', '15');
      await p.click('[data-act="md-done"]'); await p.waitForSelector('[data-act="send"]');
      await check(p, `crew-new-review-${k}`, `Crew new case · review and SEND (${k})`);
      await p.click('[data-act="home"]');
      for (const [i, st] of [[1, 'sent'], [6, 'repeat'], [7, 'confirmed']]) {
        await p.click(`.qrow[data-cad="${c(i)}"]`); await p.waitForSelector('.status-panel');
        await check(p, `crew-case-${st}-${k}`, `Crew case · ${st} (${k})`);
        await p.click('[data-act="home"]');
      }
      await p.click(`.qrow[data-cad="${c(7)}"]`); await p.waitForSelector('.status-panel');
      await p.click('[data-act="vitals"]'); await check(p, `crew-vitals-${k}`, `Crew · update vital signs (${k})`); await p.click('.modal [data-act="modal-close"]');
      await p.click('[data-act="treat"]'); await p.click('[data-act="t-k"][data-v="asp"]'); await p.click('[data-act="t-o"][data-v="Given"]'); await check(p, `crew-treatment-${k}`, `Crew · treatment update (${k})`); await p.click('.modal [data-act="modal-close"]');
      await p.click('.status-panel [data-act="complete"]'); await check(p, `crew-complete-${k}`, `Crew · COMPLETE STEMI PATHWAY? (${k})`); await p.click('.modal [data-act="modal-close"]');
      await p.click('[data-act="summary"]'); await check(p, `crew-summary-${k}`, `Crew · Case Summary (${k})`);
      await p.click('[data-act="home"]');
      await ctx.close();
    }

    /* ---------- ER Doctor ---------- */
    let fresh = 20;
    for (const [vp, k] of [[VP.desktop, 'desktop'], [VP.tablet, 'tablet'], [VP.portrait, 'portrait']]) {
      if (k !== 'desktop') await H.apiSend(crew, c(++fresh)); /* each pass accepts one new case */
      const ctx = await browser.newContext({ viewport: vp }), p = await ctx.newPage(); H.watch(p, errors, 'er');
      await p.goto(S.BASE + '/er'); await check(p, `er-gate-${k}`, `ER start screen (${k})`);
      await p.click('#gate-go'); await p.waitForSelector('.alarmband');
      await check(p, `er-queue-alert-${k}`, `ER queue with a new case alert (${k})`);
      await p.click('.alarmcase [data-act="accept"]'); await p.waitForSelector('#clin-name');
      await check(p, `er-name-${k}`, `ER name prompt (${k})`);
      await H.giveName(p, 'Dr. Ahmed Mohammed'); await p.waitForSelector('.accepted'); await p.waitForTimeout(800);
      await check(p, `er-review-${k}`, `ER review (${k})`);
      await p.click('[data-act="assess"][data-k="not_suspicious"]'); await p.click('[data-act="ns-go"]', { force: true });
      await check(p, `er-not-suspicious-${k}`, `ER NOT SUSPICIOUS panel with the error (${k})`);
      await p.click('.modal [data-act="modal-close"]');
      await p.click('[data-act="assess"][data-k="uncertain"]'); await check(p, `er-uncertain-confirm-${k}`, `ER UNCERTAIN confirmation (${k})`); await p.click('.modal [data-act="modal-close"]');
      await p.click('[data-act="queue"]');
      await p.click(`.qrow[data-cad="${c(7)}"]`); await p.waitForSelector('.case-h'); await check(p, `er-confirmed-${k}`, `ER · a CONFIRMED STEMI case (${k})`);
      await p.click('[data-act="queue"]'); await p.waitForSelector(`#q-done [data-cad="${c(3)}"]`);
      await p.click(`#q-done [data-cad="${c(3)}"]`); await p.waitForSelector('.case-h'); await check(p, `er-closed-${k}`, `ER · a case closed by the ER (${k})`);
      await p.click('[data-act="summary"]'); await check(p, `er-summary-${k}`, `ER · Case Summary (${k})`);
      await ctx.close();
    }

    /* ---------- Cardiologist ---------- */
    for (const [vp, k] of [[VP.phone, 'phone'], [VP.phoneLand, 'phone-landscape'], [VP.tablet, 'tablet']]) {
      /* each pass acknowledges one new activation */
      if (k !== 'phone') { const nc = c(++fresh); await H.apiSend(crew, nc); await er.one(nc, 'er_accept', { name: 'Dr. Ahmed Mohammed' }); await er.one(nc, 'er_assess', { kind: 'activate', on: 1, name: 'Dr. Ahmed Mohammed' }); }
      const ctx = await browser.newContext({ ...(k.startsWith('phone') ? H.PHONE : {}), viewport: vp }), p = await ctx.newPage(); H.watch(p, errors, 'cardiologist');
      await p.goto(S.BASE + '/cardiologist'); await check(p, `card-gate-${k}`, `Cardiologist start screen (${k})`);
      await p.click('#gate-go'); await p.waitForSelector('.activation');
      await check(p, `card-alert-${k}`, `Cardiologist activation alert (${k})`);
      await p.click('.activation [data-act="ack"]'); await p.waitForSelector('#clin-name');
      await check(p, `card-name-${k}`, `Cardiologist name prompt (${k})`);
      await H.giveName(p, 'Dr. Sara Al Mansoori'); await p.waitForSelector('#c-er'); await p.waitForTimeout(800);
      await check(p, `card-case-${k}`, `Cardiologist case (${k})`);
      const decide = k === 'tablet' ? '#c-decide [data-act="d"][data-k="confirm"]' : '#c-dock [data-act="decide"]';
      if (k !== 'tablet') { await p.click(decide); await check(p, `card-choose-${k}`, `Cardiologist decision choice (${k})`); await p.click('.modal [data-act="d"][data-k="not"]'); }
      else await p.click('#c-decide [data-act="d"][data-k="not"]');
      await p.click('[data-act="d-go"]', { force: true });
      await check(p, `card-not-${k}`, `Cardiologist NOT STEMI with the error (${k})`);
      await p.click('.modal [data-act="modal-close"]');
      await p.click('[data-act="queue"]'); await check(p, `card-queue-${k}`, `Cardiologist queue (${k})`);
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

    /* ---------- test console ---------- */
    {
      const ctx = await browser.newContext({ viewport: VP.desktop }), p = await ctx.newPage(); H.watch(p, errors, 'control');
      await p.goto(S.BASE + '/control'); await p.waitForSelector('tr[data-cad]');
      await p.click(`tr[data-cad="${c(7)}"]`); await p.waitForSelector('.ts');
      await check(p, 'console-desktop', 'Test console (desktop)');
      await ctx.close();
    }
    R.ok('', 'No script errors on any screen', !errors.length, errors.slice(0, 3).join(' | '));
  } finally { await browser.close(); }
}

(async () => {
  const S = await H.startServer({ MOCK_AI_DELAY_MS: '400' });
  try { await main(S); } catch (e) { console.error(e); R.ok('', 'The visual QA ran to the end', false, e.message); } finally { await S.stop(); }
  console.log(`Screenshots: ${path.relative(process.cwd(), DIR)}`);
  process.exit(R.summary() ? 1 : 0);
})();
