/* The STEMI pathway's closure rules, with two real browsers (crew MDT and the cardiologist's phone):
   Test 1 — NOT STEMI: the pathway closes automatically, the crew sees NOT STEMI — PATHWAY CLOSED at once, the case moves
            to Completed and is read-only; no cath-lab activation; the CAD incident is not "cancelled"; everything kept.
   Test 3 — UNCLEAR / REQUEST REPEAT ECG: the pathway stays active, the crew sees the request and sends ECG 2, and
            COMPLETE STEMI PATHWAY is not available; once the cardiologist changes the decision to CONFIRMED STEMI it
            is available at once, and the crew completes the pathway.
   (Tests 2 and 4, CONFIRMED STEMI staying active and COMPLETE STEMI PATHWAY, are in scripts/acceptance.js.)
   Needs Playwright, like scripts/acceptance.js.   Run:  npm run test:pathway        Fictional test data only. */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { console.error('Playwright is not installed. See the comment at the top of scripts/acceptance.js.'); process.exit(2); }

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const PORT = 3000 + Math.floor(Math.random() * 900) + 50;
const BASE = `http://localhost:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'stemi-path-'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const p2 = n => String(n).padStart(2, '0');
const T = new Date(), DAY = `${T.getFullYear()}${p2(T.getMonth() + 1)}${p2(T.getDate())}`;
const CAD1 = `${DAY}-0201-1`, CAD3 = `${DAY}-0203-1`;
const results = [];
const ok = (n, what, cond, detail) => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${String(n).padEnd(4)} ${what}${detail ? ' · ' + detail : ''}`); };
const DBQ = sql => JSON.parse(require('node:child_process').execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e',
  `const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(${JSON.stringify(path.join(DATA, 'stemi-test.db'))});console.log(JSON.stringify(d.prepare(${JSON.stringify(sql)}).all()))`]).toString());
const SOUND_PROBE = `(() => { window.__tones = []; const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  const orig = AC.prototype.createOscillator; AC.prototype.createOscillator = function () { window.__tones.push(Date.now()); return orig.call(this); }; })();`;

async function main(server) {
  const browser = await chromium.launch();
  const errors = [];
  try {
    const crewCtx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
    const docCtx = await browser.newContext({ viewport: { width: 393, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await docCtx.addInitScript(SOUND_PROBE);
    const login = async (ctx, email, who) => {
      const p = await ctx.newPage();
      p.on('pageerror', e => errors.push(`${who}: ${e.message}`));
      await p.goto(BASE + '/login'); await p.fill('#email', email); await p.fill('#pw', 'stemi-test');
      await Promise.all([p.waitForNavigation(), p.click('button[type=submit]')]);
      return p;
    };
    const crew = await login(crewCtx, 'crew@test.local', 'crew');
    const doc = await login(docCtx, 'cardio@test.local', 'cardiologist');
    await doc.click('#gate-go');
    await crew.waitForSelector('text=LIVE — CONNECTED');
    const tap = s => crew.click(s), keys = async ks => { for (const k of ks) await tap(`[data-key="${k}"]`); };
    const tones = () => doc.evaluate(() => window.__tones.length);

    /* the crew: enter the CAD number, upload ECG 1, minimum dataset, SEND */
    async function sendCase(cad, first) {
      if (!first) { await tap('[data-act="home"]').catch(() => {}); await tap('[data-act="new-case"]').catch(() => {}); await tap('[data-act="newcase-go"]').catch(() => {}); }
      await tap('[data-act="open-path"]').catch(() => {});
      await crew.waitForSelector('#cadin');
      await crew.fill('#cadin', cad); await tap('[data-act="cad-ok"]');
      const [fc] = await Promise.all([crew.waitForEvent('filechooser'), crew.click('[data-act="upload"]')]);
      await fc.setFiles(path.join(ROOT, 'samples/test-ecg-1-borderline-anterior.jpg'));
      await crew.waitForSelector('.rv-img img');
      await tap('[data-act="open"][data-k="age"]'); await keys(['6', '7']); await tap('[data-act="md-done"]');
      await tap('[data-act="set"][data-k="sex"][data-v="Female"]');
      await tap('[data-act="open"][data-k="complaint"]'); await tap('[data-act="cpick"][data-v="cp"]');
      await tap('[data-act="open"][data-k="onset"]'); await tap('[data-act="tq"][data-m="30"]'); await tap('[data-act="md-done"]');
      await tap('[data-act="nv"][data-k="bp"][data-v="Not obtained"]');
      await tap('[data-act="open"][data-k="hr"]'); await keys(['7', '6']); await tap('[data-act="md-done"]');
      await tap('[data-act="open"][data-k="spo2"]'); await keys(['9', '7']); await tap('[data-act="md-done"]');
      await tap('[data-act="set"][data-k="gcs"][data-v="15"]');
      await tap('[data-act="send"]');
    }
    /* the cardiologist: the new case alarms; ACKNOWLEDGE & OPEN stops it */
    async function receiveAndAck() {
      const before = await tones();
      await doc.waitForSelector('.nca', { timeout: 10000 });
      await sleep(2500);
      const ringing = (await tones()) > before;
      await doc.click('.nca-go'); await sleep(2000);
      const atAck = await tones(); await sleep(1500);
      return { ringing, stopped: (await tones()) === atAck };
    }
    const decide = async k => {
      await doc.locator('[data-act="decide"]:visible').first().click();
      await doc.click(`[data-act="d-${k}"]`);
    };

    /* ---------- Test 1: NOT STEMI ---------- */
    await sendCase(CAD1, true);
    const a1 = await receiveAndAck();
    ok('1.1', 'New case: the alarm sounds, and stops at ACKNOWLEDGE & OPEN', a1.ringing && a1.stopped);
    const t1 = await tones();
    await decide('not');
    await doc.click('[data-act="n-why"][data-k="No acute ischaemic changes"]');
    await doc.click('[data-act="n-go"]');
    await crew.waitForSelector('.decv >> text=NOT STEMI', { timeout: 8000 }).catch(() => {});
    const decTxt = (await crew.textContent('#layer')).replace(/\s+/g, ' ');
    ok('1.2', 'Crew immediately receives NOT STEMI · PATHWAY CLOSED with the cardiologist and time', /NOT STEMI/.test(decTxt) && /PATHWAY CLOSED/.test(decTxt) && /Dr X/.test(decTxt) && /\d\d:\d\d:\d\d/.test(decTxt));
    await crew.screenshot({ path: path.join(OUT, 'T1-crew-not-stemi.png') });
    await tap('[data-act="dec-ack"]');
    await crew.waitForSelector('text=Completed cases');
    const home = (await crew.textContent('#view')).replace(/\s+/g, ' ');
    ok('1.3', 'Case leaves the active list and appears under Completed cases', !/My active cases/.test(home) && home.includes(`CAD #${CAD1}`) && /Pathway closed \(NOT STEMI\)/.test(home));
    const c1 = DBQ(`SELECT status, closed_at, closed_by, closure_reason, closure_source, active FROM cases WHERE cad='${CAD1}'`)[0];
    ok('1.4', 'Closure recorded: reason Cardiologist decision: NOT STEMI, source automatic, by the cardiologist', c1.status === 'closed' && c1.closure_reason === 'Cardiologist decision: NOT STEMI' && c1.closure_source === 'automatic following Cardiologist decision' && /Dr X/.test(c1.closed_by), JSON.stringify(c1));
    const aud = DBQ(`SELECT action, role FROM audit_events WHERE cad='${CAD1}' ORDER BY at, id`);
    const iDec = aud.findIndex(a => /^Cardiologist decision: NOT STEMI — Dr X/.test(a.action)), iClose = aud.findIndex(a => /^STEMI pathway automatically closed following Cardiologist NOT STEMI decision/.test(a.action));
    ok('1.5', 'Two separate audit events: the decision, then the automatic closure', iDec >= 0 && iClose > iDec && aud[iDec].role === 'cardiologist', `${aud[iDec] && aud[iDec].action} | ${aud[iClose] && aud[iClose].action}`);
    ok('1.6', 'Never described as a CAD cancellation; the CAD case record itself is kept under the same number', !aud.some(a => /CAD (incident )?cancel/i.test(a.action)) && !/CAD CANCELLED/i.test(home + decTxt) && DBQ(`SELECT cad FROM cases WHERE cad='${CAD1}'`).length === 1);
    ok('1.7', 'No cath-lab / STEMI activation: no STEMI confirmed, nothing beyond the closure', !aud.some(a => /STEMI confirmed|cath-lab activat/i.test(a.action)));
    ok('1.8', 'ECGs, AI interpretation, clinical information and audit events all kept', DBQ(`SELECT n FROM ecgs WHERE cad='${CAD1}'`).length === 1 && DBQ(`SELECT status FROM ai_interpretations WHERE cad='${CAD1}'`).length === 1 && DBQ(`SELECT field FROM observations WHERE cad='${CAD1}'`).length >= 4 && aud.length > 10);
    await sleep(1000);
    const docTxt = (await doc.textContent('body')).replace(/\s+/g, ' ');
    ok('1.9', 'Cardiologist: NOT STEMI — PATHWAY CLOSED, decision controls gone, no sound', /NOT STEMI — PATHWAY CLOSED/.test(docTxt) && !(await doc.isVisible('[data-act="decide"]')) && !(await doc.isVisible('[data-act="newdec"]')) && (await tones()) === t1);
    await doc.screenshot({ path: path.join(OUT, 'T1-phone-not-stemi.png') });
    const r = (await (await crewCtx.request.post(BASE + '/api/ops', { data: { ops: [{ id: 'nst-1', cad: CAD1, k: 'md', t: Date.now(), data: { k: 'hr', v: '70 bpm', raw: { v: 70 }, kind: 'update' } }] } })).json()).results[0];
    ok('1.10', 'Read-only: the platform refuses changes', r.ok === false && /closed/.test(r.error), r.error);
    const found = await (await docCtx.request.get(BASE + '/api/cases?q=' + CAD1.slice(-6))).json();
    ok('1.11', 'Completed case searchable by CAD number (cardiologist)', found.cases.some(x => x.cad === CAD1 && x.kind === 'not-stemi'));

    /* ---------- Test 3: UNCLEAR / REQUEST REPEAT ECG ---------- */
    await sendCase(CAD3, false);
    await receiveAndAck();
    await decide('repeat');
    await doc.click('[data-act="r-go"]');
    await crew.waitForSelector('.decv >> text=/REPEAT/', { timeout: 8000 }).catch(() => {});
    ok('3.1', 'Crew sees the repeat ECG request', /REPEAT/.test(await crew.textContent('#layer')));
    await tap('[data-act="dec-ack-rep"]');
    const [fc2] = await Promise.all([crew.waitForEvent('filechooser'), crew.click('[data-act="upload"]')]);
    await fc2.setFiles(path.join(ROOT, 'samples/test-ecg-2-evolving-anterior.jpg'));
    await crew.waitForSelector('[data-act="send"]:not([disabled])'); await tap('[data-act="send"]');
    await doc.waitForSelector('text=/NEW — ECG 2 received/', { timeout: 10000 }).catch(() => {});
    const c3 = DBQ(`SELECT status, closed_at, active FROM cases WHERE cad='${CAD3}'`)[0];
    ok('3.2', 'ECG 2 sent and received; the pathway stays active, no automatic closure', DBQ(`SELECT n FROM ecgs WHERE cad='${CAD3}' AND n=2 AND received_at IS NOT NULL`).length === 1 && !c3.closed_at && c3.active === 1);
    ok('3.3', 'The cardiologist can decide again on ECG 2 (review continues)', await doc.locator('[data-act="decide"]:visible').count() > 0);
    /* while the decision is UNCLEAR / REQUEST REPEAT ECG, the crew cannot complete the pathway */
    await crew.waitForSelector('.ch [data-act="handover"]'); await tap('.ch [data-act="handover"]');
    await crew.waitForSelector('#h-sum');
    const sum3 = (await crew.textContent('#view')).replace(/\s+/g, ' ');
    const refused = await crewCtx.request.post(BASE + '/api/cases/close', { data: { cad: CAD3 } });
    ok('3.4', 'UNCLEAR: COMPLETE STEMI PATHWAY not available on the case summary, and the platform refuses it', (await crew.locator('[data-act="ho-complete"]').count()) === 0 && /available after CONFIRMED STEMI/.test(sum3) && refused.status() === 409 && !DBQ(`SELECT closed_at FROM cases WHERE cad='${CAD3}'`)[0].closed_at, `close request → ${refused.status()}`);
    /* the cardiologist changes the decision to CONFIRMED STEMI on ECG 2: the button is available at once */
    await doc.locator('[data-act="ecg"][data-n="2"]:visible').first().click().catch(() => {});
    await sleep(500);
    await decide('confirm');
    await doc.click('[data-act="c-go"]');
    await crew.waitForSelector('[data-act="ho-complete"]:not([disabled])', { state: 'attached', timeout: 8000 }).catch(() => {});
    ok('3.5', 'After CONFIRMED STEMI, COMPLETE STEMI PATHWAY is available immediately (case summary still open)', (await crew.locator('[data-act="ho-complete"]:not([disabled])').count()) === 1 && !DBQ(`SELECT closed_at FROM cases WHERE cad='${CAD3}'`)[0].closed_at);
    await tap('[data-act="dec-ack"]');
    await tap('.ch [data-act="handover"]'); await crew.waitForSelector('[data-act="ho-complete"]:not([disabled])');
    await tap('[data-act="ho-complete"]'); await tap('[data-act="ho-close"]');
    await crew.waitForSelector('text=Completed cases', { timeout: 8000 });
    const c3b = DBQ(`SELECT status, closure_reason, closure_source FROM cases WHERE cad='${CAD3}'`)[0];
    ok('3.6', 'The crew completes the confirmed pathway: closed by the crew, read-only, under Completed', c3b.status === 'closed' && c3b.closure_reason === 'STEMI pathway completed' && c3b.closure_source === 'crew', JSON.stringify(c3b));
    ok('E', 'No script errors', !errors.length, errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    server.kill();
  }
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
