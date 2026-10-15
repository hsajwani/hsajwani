/* Shared test harness for the STEMI test suites (scripts/*.js).
   Each suite starts its own server on a random port with a temporary data folder, so it never touches the development
   server (npm run dev) or data/. Fictional test data only.
   Browser suites need Playwright with Chromium: npm install -g playwright && npx playwright install chromium
   (in the Claude Code cloud container run with NODE_PATH=$(npm root -g)). */
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'scripts', 'out');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const p2 = n => String(n).padStart(2, '0');
const T = new Date(), DAY = `${T.getFullYear()}${p2(T.getMonth() + 1)}${p2(T.getDate())}`;
/* a fictional CAD number for today: cad(123) → 20261015-0123-1 */
const cad = (n, k) => `${DAY}-${String(n).padStart(4, '0')}-${k || 1}`;

function playwright() {
  try { return require('playwright'); } catch (_) {
    console.error('Playwright is not installed. Install it with: npm install -g playwright && npx playwright install chromium\n(in the Claude Code cloud container: NODE_PATH=$(npm root -g) npm run test:…)');
    process.exit(2);
  }
}

/* ---------- results ---------- */
function Results(name) {
  const list = [];
  return {
    ok(id, what, cond, detail) {
      list.push({ id, what, pass: !!cond });
      console.log(`${cond ? 'PASS' : 'FAIL'}  ${id ? `[${id}] ` : ''}${what}${detail ? ' · ' + String(detail).replace(/\s+/g, ' ').slice(0, 220) : ''}`);
      return !!cond;
    },
    get failed() { return list.filter(r => !r.pass).length; },
    summary() { const f = list.filter(r => !r.pass).length; console.log(`\n${name}: ${list.length - f}/${list.length} checks passed.`); return f; },
    list
  };
}

/* ---------- a server of its own ---------- */
async function startServer(env) {
  const PORT = 3050 + Math.floor(Math.random() * 900), BASE = `http://localhost:${PORT}`;
  const DATA = (env && env.DATA_DIR) || fs.mkdtempSync(path.join(os.tmpdir(), 'stemi-test-'));
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: ROOT, env: { ...process.env, STEMI_DEV: '', PORT: String(PORT), DATA_DIR: DATA, MOCK_AI_DELAY_MS: '1500', HEARTBEAT_MS: '2000', CORPULS_SIM_TICK_MS: '1000', CORPULS_PROVIDER: 'mock', ...(env || {}) }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 80 && !log.includes('Test console'); i++) await sleep(100);
  if (!log.includes('Test console')) throw new Error('The test server did not start:\n' + log);
  return {
    PORT, BASE, DATA, proc, log: () => log,
    async stop(keep) { if (proc.exitCode === null) { proc.kill(); await new Promise(r => proc.once('exit', r)); } if (!keep) fs.rmSync(DATA, { recursive: true, force: true }); }
  };
}
/* read the test database (a separate process, as the server holds it open) */
function db(DATA, sql) {
  const out = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e',
    `const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(${JSON.stringify(path.join(DATA, 'stemi-test.db'))});console.log(JSON.stringify(d.prepare(${JSON.stringify(sql)}).all()));d.close()`]);
  return JSON.parse(out.toString());
}
const auditOf = (DATA, c) => db(DATA, `SELECT at, actor, role, action, kind FROM audit_events WHERE cad='${c}' ORDER BY at, id`);

/* ---------- the API, as a screen would call it ---------- */
function Api(BASE, role) {
  const jar = {};
  const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  const take = r => { for (const x of r.headers.getSetCookie()) { const [kv] = x.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } };
  let n = 0;
  const api = {
    role, BASE,
    async req(method, url, body, ct) {
      const r = await fetch(BASE + url, { method, redirect: 'manual', headers: { cookie: cookie(), 'x-stemi-role': role, ...(body ? { 'content-type': ct || 'application/json' } : {}) }, body: body ? (ct ? body : JSON.stringify(body)) : undefined });
      take(r); let b = null; try { b = await r.json(); } catch (_) { /* not JSON */ }
      return { status: r.status, body: b };
    },
    /* a crew login, or the device session a page gives */
    async start() {
      if (role === 'crew') return api.req('POST', '/api/login', { email: 'crew@test.local', password: 'stemi-test' });
      const r = await fetch(BASE + '/' + role); take(r); return { status: r.status };
    },
    op(c, k, data) { return { id: `t-${role}-${Date.now().toString(36)}-${++n}`, cad: c, k, t: Date.now(), data: data || {} }; },
    async ops(...list) { const r = await api.req('POST', '/api/ops', { ops: list }); return r.body && r.body.results ? r.body.results : [{ ok: false, error: 'HTTP ' + r.status }]; },
    async one(c, k, data) { return (await api.ops(api.op(c, k, data)))[0]; },
    async view(c) { const r = await api.req('GET', '/api/cases/view?cad=' + encodeURIComponent(c)); return r.status === 200 ? r.body.rec : null; },
    async upload(c, file) {
      const buf = fs.readFileSync(path.join(ROOT, 'samples', file || 'test-ecg-1-borderline-anterior.jpg'));
      return api.req('POST', '/api/images?src=file&cad=' + encodeURIComponent(c), buf, 'image/jpeg');
    }
  };
  return api;
}
/* the test console's corpuls simulator, acting on the simulated monitor of one case (TEST ONLY) */
const CONSOLES = new Map();
async function testConsole(BASE) {
  if (!CONSOLES.has(BASE)) { const c = Api(BASE, 'control'); await c.start(); CONSOLES.set(BASE, c); }
  return CONSOLES.get(BASE);
}
async function sim(BASE, c, action, body) { return (await testConsole(BASE)).req('POST', '/api/control/corpuls/' + action, { cad: c, ...(body || {}) }); }
/* a complete crew SEND through the API (for tests that are about what happens after it): the case is created and linked
   to the simulated corpuls monitor, ECG 1 arrives from it, then the crew's four items are sent.
   opts.manual: the manual ECG fallback instead (an uploaded image, no corpuls) */
async function apiSend(crew, c, opts) {
  opts = opts || {};
  const cr = await crew.req('POST', '/api/cases', { cad: c, cid: 'cid-' + c, openedAt: Date.now() - 120e3, link: !opts.manual });
  const t = Date.now();
  const md = {
    age: { v: '58 y', raw: { v: 58 }, t }, sex: { v: 'Male', raw: { v: 'Male' }, t }, complaint: { v: 'Chest pain', raw: { k: 'cp' }, t },
    onset: { v: 'Unknown', raw: { nv: 'Unknown' }, t }
  };
  let ecg = null;
  if (opts.manual) {
    const up = await crew.upload(c);
    ecg = { n: 1, acq: t - 60e3, variant: opts.variant || 'border', pri: 1, imgs: [{ i: 1, kind: 'full', q: 'file', at: t - 60e3, imageId: up.body && up.body.id }] };
  } else {
    await sim(crew.BASE, c, 'connect');
    await sim(crew.BASE, c, 'trigger-ecg', { sample: opts.sample || 'A' });
  }
  const r = await crew.one(c, 'submit', { sendAt: t, md, ecg });
  return { created: cr.status, submit: r };
}

/* ---------- pages ---------- */
/* counts every tone the page's alarm plays (Web Audio oscillators) */
const SOUND_PROBE = `(() => { window.__tones = []; const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  const orig = AC.prototype.createOscillator; AC.prototype.createOscillator = function () { window.__tones.push(Date.now()); return orig.call(this); }; })();`;
const PHONE = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
function watch(page, errors, label) {
  page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|net::ERR_|Failed to load resource/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
}
async function crewPage(browser, BASE, errors, ctxOpts) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, ...(ctxOpts || {}) });
  const page = await ctx.newPage(); watch(page, errors, 'crew');
  await page.goto(BASE + '/login');
  await page.fill('#email', 'crew@test.local'); await page.fill('#pw', 'stemi-test');
  await Promise.all([page.waitForURL('**/crew'), page.click('button[type=submit]')]);
  await page.waitForSelector('[data-act="new-case"]');
  await page.waitForSelector('.conn:not(.conn--wait)');
  return { ctx, page };
}
/* a clinician screen with the alarm probe; the start screen is tapped (sound allowed) */
async function clinPage(browser, BASE, role, errors, ctxOpts) {
  const ctx = await browser.newContext({ ...(role === 'cardiologist' ? PHONE : { viewport: { width: 1440, height: 900 } }), ...(ctxOpts || {}) });
  await ctx.addInitScript(SOUND_PROBE);
  const page = await ctx.newPage(); watch(page, errors, role);
  await page.goto(BASE + '/' + role);
  await page.click('#gate-go');
  await page.waitForSelector('.conn:not(.conn--wait)');
  await sleep(400);
  return { ctx, page, tones: () => page.evaluate(() => window.__tones.length) };
}
/* the crew's whole new-case pathway through the screen: OPEN STEMI PATHWAY → CAD number → LINK CORPULS → ECG 1 arrives
   from the simulated corpuls (the test console triggers the acquisition) → age, sex, complaint, onset → SEND TO ER.
   opts.fallback: corpuls is not used; the crew adds ECG 1 with the manual ECG fallback (fictional test image) */
async function crewNewCase(page, c, opts) {
  opts = opts || {};
  const BASE = new URL(page.url()).origin;
  await page.click('[data-act="home"]').catch(() => {});
  await page.click('[data-act="new-case"]');
  if (await page.isVisible('.modal [data-act="draft-discard"]')) { await page.click('.modal [data-act="draft-discard"]'); await page.click('[data-act="draft-discard-go"]'); await page.click('[data-act="new-case"]'); }
  await page.waitForSelector('#cadin');
  await page.fill('#cadin', opts.typed || c);
  await page.click('[data-act="cad-ok"]');
  await page.waitForSelector('#d-bar .cbar', { timeout: 10000 });
  if (opts.fallback) {
    for (let i = 0; i < (opts.images || 1); i++) { await page.click('[data-act="fb-draft"], [data-act="img-add"]'); await page.click('[data-act="img-gen"]'); await sleep(150); }
  } else {
    await page.waitForSelector('.cbar--ok', { timeout: 10000 });
    await sim(BASE, c, 'trigger-ecg', { sample: opts.sample || 'A' });
    await page.waitForSelector('#d-viewer:not([hidden]) .ecgv__scroll img', { timeout: 10000 });
  }
  await page.fill('#md-age', String(opts.age || 58));
  await page.click(`[data-act="md-set"][data-k="sex"][data-v="${opts.sex || 'Male'}"]`);
  await page.click('[data-act="md-set"][data-k="complaint"][data-v="cp"]');
  await page.click('[data-act="md-ago"][data-m="30"]');
  await page.waitForSelector('[data-act="send"]:not([aria-disabled="true"])');
  if (opts.noSend) return;
  await page.click('[data-act="send"]');
  await page.waitForSelector(`.case-h__cad:has-text("CAD #${c}")`, { timeout: 20000 });
}
/* type a name in the clinician name prompt and confirm */
async function giveName(page, name) {
  await page.waitForSelector('#clin-name');
  await page.fill('#clin-name', name);
  await page.click('[data-name-go]');
}
async function shot(page, name, full) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: !!full }).catch(() => {});
}

module.exports = { ROOT, OUT, sleep, cad, DAY, playwright, Results, startServer, db, auditOf, Api, apiSend, testConsole, sim, SOUND_PROBE, PHONE, watch, crewPage, clinPage, crewNewCase, giveName, shot };
