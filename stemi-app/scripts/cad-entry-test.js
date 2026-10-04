/* The CAD number entered manually by the EMT: the edge cases the main acceptance test does not walk through.
   - offline at CAD entry: the number cannot be checked, is kept on the tablet, and the workflow continues
   - the tablet's unsent case survives reconnection while the platform has another active case
   - SEND with a CAD number that already has a case: CASE ALREADY EXISTS, the ECG and minimum dataset stay as the draft
   - correcting the CAD number, then sending: the case is created under the corrected number; the existing case is untouched
   - the correction before sending is in the audit trail
   Needs Playwright, like scripts/acceptance.js.   Run:  npm run test:cad        Fictional test data only. */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { console.error('Playwright is not installed. See the comment at the top of scripts/acceptance.js.'); process.exit(2); }

const ROOT = path.resolve(__dirname, '..');
const PORT = 3000 + Math.floor(Math.random() * 900) + 50;
const BASE = `http://localhost:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'stemi-cad-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const p2 = n => String(n).padStart(2, '0');
const T = new Date(), DAY = `${T.getFullYear()}${p2(T.getMonth() + 1)}${p2(T.getDate())}`;
const EXISTING = `${DAY}-0777-1`, CORRECTED = `${DAY}-0778-1`;
const results = [];
const ok = (what, cond, detail) => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}${detail ? ' · ' + detail : ''}`); };

async function main(server) {
  const browser = await chromium.launch();
  const errors = [];
  try {
    const cc = await browser.newContext({ viewport: { width: 1440, height: 860 } });
    const p = await cc.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(BASE + '/login'); await p.fill('#email', 'crew@test.local'); await p.fill('#pw', 'stemi-test');
    await Promise.all([p.waitForNavigation(), p.click('button[type=submit]')]);
    await p.waitForSelector('text=LIVE — CONNECTED');
    const tap = s => p.click(s), keys = async ks => { for (const k of ks) await tap(`[data-key="${k}"]`); };
    const check = async cad => (await cc.request.get(BASE + '/api/cases/check?cad=' + encodeURIComponent(cad))).json();

    /* a case already exists under EXISTING (sent from the test console) */
    const demo = await cc.request.post(BASE + '/api/control/demo-case', { data: { cad: EXISTING } });
    ok('A case exists under ' + EXISTING, demo.status() === 200);
    await p.waitForSelector('[data-act="home"]'); await sleep(1500);
    await tap('[data-act="home"]'); await tap('[data-act="new-case"]'); await tap('[data-act="newcase-go"]');
    await p.waitForSelector('#cadin');

    /* offline: the number is kept and checked at Send */
    await cc.setOffline(true); await p.waitForSelector('text=CONNECTION LOST', { timeout: 20000 });
    await p.fill('#cadin', EXISTING); await tap('[data-act="cad-ok"]');
    await p.waitForSelector('[data-act="upload"]', { timeout: 5000 });
    ok('Offline: CAD number kept unchecked, the workflow continues to the ECG', (await p.textContent('.toast')).includes('checks it for an existing case when you send'));
    await tap('[data-act="shoot"]'); await sleep(1200);
    await cc.setOffline(false); await p.waitForSelector('text=LIVE — CONNECTED', { timeout: 20000 });
    ok('After reconnecting, the tablet keeps its unsent case and CAD number', (await p.textContent('.ch-l1')).includes(`CAD #${EXISTING}`));

    /* minimum dataset, then SEND */
    await tap('[data-act="step"][data-k="C-03"]');
    await tap('[data-act="open"][data-k="age"]'); await keys(['6', '1']); await tap('[data-act="md-done"]');
    await tap('[data-act="set"][data-k="sex"][data-v="Female"]');
    await tap('[data-act="open"][data-k="complaint"]'); await tap('[data-act="cpick"][data-v="cp"]');
    await tap('[data-act="open"][data-k="onset"]'); await tap('[data-act="tq"][data-m="30"]'); await tap('[data-act="md-done"]');
    await tap('[data-act="open"][data-k="bp"]'); await keys(['1', '3', '0', '8', '0']); await tap('[data-act="md-done"]');
    await tap('[data-act="open"][data-k="hr"]'); await keys(['7', '0']); await tap('[data-act="md-done"]');
    await tap('[data-act="open"][data-k="spo2"]'); await keys(['9', '8']); await tap('[data-act="md-done"]');
    await tap('[data-act="set"][data-k="gcs"][data-v="15"]');
    await tap('[data-act="step"][data-k="C-05"]');
    await tap('[data-act="send"]');
    await p.waitForSelector('.dlg.dup', { timeout: 8000 }).catch(() => {});
    ok('SEND under a CAD number that already has a case: CASE ALREADY EXISTS', await p.isVisible('.dlg.dup') && (await p.textContent('#layer')).includes(`CAD #${EXISTING}`));

    /* correct the number: nothing entered is lost */
    await tap('[data-act="dup-fix"]'); await p.waitForSelector('#cadin');
    const steps = await p.textContent('.steps');
    ok('The ECG and the minimum dataset stay as the unsent draft', steps.includes('ECG 1 captured') && steps.includes('8 of 8'));
    await p.fill('#cadin', CORRECTED); await tap('[data-act="cad-ok"]');
    await p.waitForSelector('[data-act="send"]', { timeout: 5000 });
    await tap('[data-act="send"]'); await sleep(3000);
    const c = await check(CORRECTED), e = await check(EXISTING);
    ok('Sent under the corrected CAD number: the case is created under it', c.exists && !!c.existing.submittedAt, CORRECTED);
    ok('The existing case was not changed (only made inactive as the active case moved on)', e.exists && e.existing.cad === EXISTING);
    ok('No script errors', !errors.filter(x => !/ERR_INTERNET_DISCONNECTED/.test(x)).length, errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    server.kill();
  }
  const { DatabaseSync } = require('node:sqlite');
  const d = new DatabaseSync(path.join(DATA, 'stemi-test.db'));
  const A = d.prepare('SELECT action FROM audit_events WHERE cad=? ORDER BY at, id').all(CORRECTED).map(r => r.action);
  d.close();
  ok('The correction before sending is in the audit trail', A.some(a => a.includes(`CAD number corrected by crew before sending: CAD #${EXISTING} → CAD #${CORRECTED}`)));
}

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, MOCK_AI_DELAY_MS: '1000' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
(async () => {
  for (let i = 0; i < 50 && !log.includes('Test console'); i++) await sleep(100);
  await main(server);
})().catch(e => { console.error(e); results.push(false); server.kill(); }).finally(() => {
  fs.rmSync(DATA, { recursive: true, force: true });
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  process.exit(failed ? 1 : 0);
});
