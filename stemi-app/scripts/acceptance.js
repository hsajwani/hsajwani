/* Automated run of the first acceptance test (Hamad's 19 steps, CAD number entered manually) with two real browsers talking to a real server:
   a desktop browser as the crew MDT and a phone-sized browser as the cardiologist's iPhone. It also checks that the
   alarm sounds only for the new case, that both pages survive a refresh, and that the crew's entries made without a
   connection arrive in order on reconnection.
   Needs Playwright (not needed to run the app):  npm install --no-save playwright && npx playwright install chromium
   Run:  npm run test:acceptance        Screenshots go to scripts/out/.  Fictional test data only. */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { console.error('Playwright is not installed. See the comment at the top of this file.'); process.exit(2); }

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const PORT = 3000 + Math.floor(Math.random() * 900) + 50;
const BASE = `http://localhost:${PORT}`;
/* the phone opens the computer's network address over plain HTTP, as the iPhone will: not a secure context, so any
   browser feature that needs HTTPS fails here as it would on the iPhone */
const LAN = Object.values(os.networkInterfaces()).flat().find(a => a && a.family === 'IPv4' && !a.internal);
const DOC_BASE = LAN ? `http://${LAN.address}:${PORT}` : BASE;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'stemi-acc-'));
fs.mkdirSync(OUT, { recursive: true });

const p2 = n => String(n).padStart(2, '0');
const TODAY = new Date();
/* the CAD number the EMT types (fictional), in the brief's format */
const CAD = `${TODAY.getFullYear()}${p2(TODAY.getMonth() + 1)}${p2(TODAY.getDate())}-0123-1`;
const DBQ = sql => JSON.parse(require('node:child_process').execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e',
  `const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(${JSON.stringify(path.join(DATA, 'stemi-test.db'))});console.log(JSON.stringify(d.prepare(${JSON.stringify(sql)}).all()))`]).toString());
const results = [];
const ok = (n, what, cond, detail) => { results.push({ n, what, pass: !!cond, detail: detail || '' }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${String(n).padStart(2)}  ${what}${detail ? ' · ' + detail : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* count every tone the cardiologist's page plays, with its time, so "no sound for updates" is checked, not assumed */
const SOUND_PROBE = `(() => { window.__tones = []; const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  const orig = AC.prototype.createOscillator; AC.prototype.createOscillator = function () { window.__tones.push(Date.now()); return orig.call(this); }; })();`;

async function main() {
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, MOCK_AI_DELAY_MS: '2500', HEARTBEAT_MS: '2000' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 50 && !log.includes('Test console'); i++) await sleep(100);

  const browser = await chromium.launch();
  const errors = [];
  const crewCtx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
  const docCtx = await browser.newContext({ viewport: { width: 393, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
  await docCtx.addInitScript(SOUND_PROBE);
  async function login(ctx, email, who, base) {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(`${who}: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error') errors.push(`${who} console: ${m.text()}`); });
    await p.goto((base || BASE) + '/login');
    await p.fill('#email', email); await p.fill('#pw', 'stemi-test');
    await Promise.all([p.waitForNavigation(), p.click('button[type=submit]')]);
    return p;
  }
  const shot = (p, name) => p.screenshot({ path: path.join(OUT, name + '.png') });
  const crew = await login(crewCtx, 'crew@test.local', 'crew');
  const doc = await login(docCtx, 'cardio@test.local', 'cardiologist', DOC_BASE);
  await doc.click('#gate-go');
  if (LAN) ok(0, 'Phone page opened from the network address over plain HTTP, as on the iPhone', !(await doc.evaluate(() => window.isSecureContext)), DOC_BASE + '/cardiologist');
  else console.log('NOTE  this computer has no network address: the phone page ran on localhost');
  const tones = () => doc.evaluate(() => window.__tones.length);

  /* 1-3: open a new STEMI case; the EMT enters the CAD number manually */
  await crew.waitForSelector('text=LIVE — CONNECTED');
  ok(1, 'Crew interface open and live', await crew.isVisible('text=LIVE — CONNECTED'));
  ok('1a', 'No CAD number generated: no case until the crew opens one', !DBQ('SELECT cad FROM cases').length && await crew.isVisible('[data-act="open-path"]'));
  await crew.click('[data-act="open-path"]');
  await crew.waitForSelector('#cadin');
  ok(2, 'New STEMI case opened: the CAD NUMBER field is shown', await crew.isVisible('text=CAD NUMBER'));
  const MSG = 'text=Enter a valid CAD number before continuing.';
  await crew.click('[data-act="cad-ok"]');
  ok('C1', 'Blank CAD number refused with an inline message', await crew.isVisible(MSG) && await crew.isVisible('#cadin'));
  await crew.fill('#cadin', CAD.slice(0, 13)); await crew.click('[data-act="cad-ok"]');
  ok('C2', 'Incomplete CAD number refused with an inline message', await crew.isVisible(MSG) && await crew.isVisible('#cadin'), CAD.slice(0, 13));
  const typed = `   cad# ${CAD}   `;
  await crew.fill('#cadin', typed); await crew.click('[data-act="cad-ok"]');
  await crew.waitForSelector('[data-act="upload"]', { timeout: 5000 });
  const head = (await crew.textContent('.ch-l1')).replace(/\s+/g, ' ');
  ok(3, 'CAD number entered manually and shown at the top of the workspace', head.includes(`CAD #${CAD}`), head.trim().slice(0, 70));
  ok('C3', 'Extra spaces and the "cad#" prefix normalised', head.includes(`CAD #${CAD}`) && !/cad#/.test(head), JSON.stringify(typed) + ' → CAD #' + CAD);
  await crew.reload(); await crew.waitForSelector('text=LIVE — CONNECTED');
  ok('C3b', 'Entered CAD number kept after a refresh before SEND (case still only on the tablet)', (await crew.textContent('#view')).includes(`CAD #${CAD}`) && !DBQ('SELECT cad FROM cases').length);
  await crew.click('[data-act="open-case"]'); await crew.waitForSelector('[data-act="upload"]');
  /* 4: Upload test ECG 1 from a file */
  const [fc] = await Promise.all([crew.waitForEvent('filechooser'), crew.click('[data-act="upload"]')]);
  await fc.setFiles(path.join(ROOT, 'samples/test-ecg-1-borderline-anterior.jpg'));
  await crew.waitForSelector('text=Image check on this tablet', { timeout: 5000 }).catch(() => {});
  ok(4, 'Test ECG 1 uploaded from a file', await crew.isVisible('.rv-img img'));
  /* 5: the minimum dataset through the real drawers */
  const tap = s => crew.click(s);
  const keys = async ks => { for (const k of ks) await tap(`[data-key="${k}"]`); };
  await tap('[data-act="open"][data-k="age"]'); await keys(['5', '4']); await tap('[data-act="md-done"]');
  await tap('[data-act="set"][data-k="sex"][data-v="Male"]');
  await tap('[data-act="open"][data-k="complaint"]'); await tap('[data-act="cpick"][data-v="cp"]');
  await tap('[data-act="open"][data-k="onset"]'); await tap('[data-act="tq"][data-m="30"]'); await tap('[data-act="md-done"]');
  await tap('[data-act="open"][data-k="bp"]'); await keys(['1', '1', '8', '7', '4']); await tap('[data-act="md-done"]');
  await tap('[data-act="open"][data-k="hr"]'); await keys(['8', '4']); await tap('[data-act="md-done"]');
  await tap('[data-act="open"][data-k="spo2"]'); await keys(['9', '6']); await tap('[data-act="md-done"]');
  await tap('[data-act="set"][data-k="gcs"][data-v="15"]');
  ok(5, 'Minimum dataset entered', await crew.isEnabled('[data-act="send"]'));
  await shot(crew, '05-crew-ready-to-send');
  /* 6 */
  const tSend = Date.now();
  await tap('[data-act="send"]');
  /* 7-8: the exact CAD number the EMT entered is in the new-case alert */
  await doc.waitForSelector('.nca', { timeout: 10000 });
  const tAlert = Date.now();
  ok(6, 'SEND pressed', true);
  const alertCad = (await doc.textContent('.nca-cad')).trim();
  ok(7, 'New case appeared on the phone automatically with the exact CAD number entered', await doc.isVisible('text=NEW CARDIAC CASE') && alertCad === `CAD #${CAD}`, `${alertCad} · ${tAlert - tSend} ms after SEND`);
  const rows = DBQ('SELECT cad, cad_source FROM cases');
  ok('C4', 'Case stored under the normalised CAD number, source: manual crew entry', rows.length === 1 && rows[0].cad === CAD && rows[0].cad_source === 'manual-crew', JSON.stringify(rows));
  await sleep(3500);
  const t1 = await tones();
  ok(8, 'Audible alarm sounding (tones played on the phone)', t1 >= 8, `${t1} tones in ~3.5 s`);
  await shot(doc, '08-phone-new-case-alarm');
  await sleep(1700);
  ok(8.1, 'Alarm keeps sounding until acknowledged', (await tones()) > t1);
  /* 9-10 */
  await doc.click('.nca-go');
  await sleep(2500);
  const tAck = await tones();
  await sleep(2500);
  ok(9, 'ACKNOWLEDGE & OPEN pressed', !(await doc.isVisible('.nca')));
  ok(10, 'Alarm stopped', (await tones()) === tAck, `${tAck} tones in total`);
  /* 11 */
  await crew.waitForSelector('text=/is reviewing|acknowledged/', { timeout: 8000 });
  ok(11, 'Crew status changed automatically to acknowledged / reviewing', await crew.isVisible('text=/is reviewing|acknowledged/'));
  await shot(crew, '11-crew-reviewing');
  const crewHead = (await crew.textContent('.ch-l1')).replace(/\s+/g, ' ');
  ok('C5', 'CAD number locked on the crew screen after SEND', /locked after send/i.test(crewHead) && !(await crew.isVisible('.ch-l1 [data-act="cad-edit"]')), crewHead.trim().slice(0, 80));
  /* 12: BP */
  await tap('[data-act="mdup"][data-k="bp"]'); await keys(['9', '4', '/', '6', '0']); await tap('[data-act="md-done"]');
  ok(12, 'BP updated', true);
  /* 13: medication */
  await tap('[data-act="rec"][data-id="asp"]'); await tap('[data-act="ropt"][data-i="0"]'); await tap('[data-act="rsave"]');
  ok(13, 'Medication added (aspirin)', true);
  /* 14: ECG 2 from a file */
  await tap('[data-act="add-ecg"] >> nth=0');
  const [fc2] = await Promise.all([crew.waitForEvent('filechooser'), crew.click('[data-act="upload"]')]);
  await fc2.setFiles(path.join(ROOT, 'samples/test-ecg-2-evolving-anterior.jpg'));
  await crew.waitForSelector('[data-act="send"]:not([disabled])');
  await tap('[data-act="send"]');
  ok(14, 'ECG 2 uploaded and sent', true);
  /* 15 */
  await doc.waitForSelector('text=/NEW — ECG 2 received/', { timeout: 10000 });
  await sleep(1500);
  const strip = await doc.textContent('.nstrip').catch(() => '');
  const three = /BP/.test(strip) && /Aspirin/.test(strip) && /ECG 2/.test(strip);
  ok(15, 'BP, medication and ECG 2 appeared on the phone without refresh and without sound', three && (await tones()) === tAck, strip.replace(/\s+/g, ' ').slice(0, 160));
  await shot(doc, '15-phone-new-updates');
  /* 16 */
  await doc.locator('[data-act="cmp"]:visible').first().click();
  await doc.waitForSelector('.panes');
  ok(16, 'ECG 1 and ECG 2 compared side by side', (await doc.$$('.panes .pane')).length === 2);
  await shot(doc, '16-phone-compare');
  /* 17: wait for the analysis of ECG 2, then look at it in the case view */
  await doc.click('[data-act="cmp-back"]');
  await doc.locator('[data-act="ecg"][data-n="2"]:visible').first().click();
  await doc.waitForSelector('#r-ai >> text=AI analysis completed', { timeout: 15000 });
  const aiDoc = await doc.textContent('#r-ai');
  await crew.waitForSelector('#r-ai >> text=AI analysis completed', { timeout: 10000 });
  const aiCrew = await crew.textContent('#r-ai');
  const imp = 'Pattern concerning for evolving acute anterior STEMI';
  ok(17, 'AI interpretation visible, the same on both screens', aiDoc.includes(imp) && aiCrew.includes(imp) && /decision support/i.test(aiDoc) && /decision support/i.test(aiCrew));
  await doc.evaluate(() => { const el = document.querySelector('#r-ai'); if (el) el.scrollIntoView(); });
  await shot(doc, '17-phone-ai');
  const docHead = (await doc.textContent('#r-head')).replace(/\s+/g, ' ');
  ok('C6', 'The same CAD number in the phone\'s case header', docHead.includes(`CAD #${CAD}`), docHead.trim().slice(0, 60));
  /* 18 */
  await doc.click('[data-act="decide"]');
  await doc.click('[data-act="d-confirm"]');
  await doc.click('[data-act="c-go"]');
  const tDec = Date.now();
  ok(18, 'CONFIRMED STEMI selected', true);
  /* 19 */
  await crew.waitForSelector('.decv >> text=CONFIRMED STEMI', { timeout: 8000 });
  ok(19, 'Decision appeared on the crew screen immediately', true, `${Date.now() - tDec} ms`);
  await shot(crew, '19-crew-decision');
  await crew.click('[data-act="dec-ack"]');

  /* duplicate CAD: a second case under the same number is not created; the existing case can be opened */
  await tap('[data-act="home"]'); await sleep(400); await shot(crew, 'D0-crew-home-with-case');
  await tap('[data-act="new-case"]'); await tap('[data-act="newcase-go"]');
  await crew.waitForSelector('#cadin');
  await crew.fill('#cadin', `CAD#${CAD}`); await crew.click('[data-act="cad-ok"]');
  await crew.waitForSelector('.dlg.dup', { timeout: 5000 }).catch(() => {});
  const dupTxt = await crew.textContent('#layer').catch(() => '');
  ok('D1', 'Same CAD entered again: CASE ALREADY EXISTS with the CAD number and OPEN EXISTING CASE', /CASE ALREADY EXISTS/.test(dupTxt) && dupTxt.includes(`CAD #${CAD}`) && /OPEN EXISTING CASE/.test(dupTxt));
  await shot(crew, 'D1-crew-case-already-exists');
  const dupPost = await crewCtx.request.post(BASE + '/api/cases', { data: { cad: ` cad#${CAD} `, cid: 'another-tablet-case' } });
  const blankPost = await crewCtx.request.post(BASE + '/api/cases', { data: { cad: '   ', cid: 'x' } });
  ok('D2', 'The platform refuses a duplicate (409) and a blank CAD number (400); still one case', dupPost.status() === 409 && blankPost.status() === 400 && DBQ('SELECT cad FROM cases').length === 1, `duplicate ${dupPost.status()} · blank ${blankPost.status()}`);
  await tap('[data-act="dup-open"]');
  await crew.waitForSelector('#view .chip >> text=CONFIRMED STEMI', { timeout: 8000 }).catch(() => {});
  await shot(crew, 'D3-crew-existing-case-opened');
  const reopened = (await crew.textContent('#view')).replace(/\s+/g, ' ');
  ok('D3', 'OPEN EXISTING CASE shows the existing case (decision kept, nothing overwritten)', reopened.includes(`CAD #${CAD}`) && /CONFIRMED STEMI/.test(reopened) && DBQ('SELECT cad FROM cases').length === 1);

  /* extra: refresh survives, offline entries arrive in order, the audit trail has the key events */
  await crew.reload(); await doc.reload(); await doc.click('#gate-go');
  await crew.waitForSelector('text=LIVE — CONNECTED'); await doc.waitForSelector('text=LIVE — CONNECTED');
  await sleep(1000);
  ok('R1', 'After refresh the crew still shows the case, its CAD number and the decision', await crew.isVisible('text=CONFIRMED STEMI') && (await crew.textContent('.ch-l1')).includes(`CAD #${CAD}`));
  ok('R2', 'After refresh the phone still shows the case, the same CAD number and the decision', (await doc.textContent('body')).includes('CONFIRMED STEMI') && (await doc.textContent('body')).includes(`CAD #${CAD}`));
  await doc.locator('[data-act="open"]:visible').first().click();
  await crewCtx.setOffline(true);
  await crew.waitForSelector('text=CONNECTION LOST', { timeout: 20000 });
  ok('O1', 'Crew shows CONNECTION LOST when the link drops', true);
  await tap('[data-act="mdup"][data-k="hr"]'); await keys(['1', '0', '2']); await tap('[data-act="md-done"]');
  await shot(crew, 'O1-crew-offline');
  await sleep(1000);
  await crewCtx.setOffline(false);
  await crew.waitForSelector('text=LIVE — CONNECTED', { timeout: 20000 });
  await doc.waitForSelector('text=/HR updated|NEW — HR/', { timeout: 15000 }).catch(() => {});
  const docBody = await doc.textContent('body');
  ok('O2', 'Entry saved offline reached the phone after reconnection', docBody.includes('102'));
  const info = await (await crewCtx.request.get(BASE + '/api/me')).json();
  ok('A0', 'Session still valid', info.user && info.user.role === 'crew');

  const con = await crewCtx.newPage();
  await con.goto(BASE + '/control'); await con.waitForSelector('#steps li'); await sleep(800);
  await con.screenshot({ path: path.join(OUT, 'Z-test-console.png'), fullPage: true });
  const tab = await docCtx.browser().newContext({ viewport: { width: 1280, height: 860 } });
  const dt = await login(tab, 'cardio@test.local', 'cardiologist-desktop'); await dt.click('#gate-go'); await dt.locator('[data-act="open"]:visible').first().click(); await sleep(800);
  await dt.screenshot({ path: path.join(OUT, 'Z-cardiologist-desktop.png') });
  await browser.close();
  server.kill();
  const audit = require('node:child_process').execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e',
    `const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(${JSON.stringify(path.join(DATA, 'stemi-test.db'))});console.log(JSON.stringify(d.prepare("SELECT action FROM audit_events ORDER BY at, id").all().map(r=>r.action)))`]).toString();
  const A = JSON.parse(audit);
  const need = [`STEMI case opened by K. Ahmed, Paramedic (Ambulance 214) — CAD #${CAD} · CAD number entered manually by crew`, 'ECG 1 acquired', 'Case submitted', 'Server received case', 'Cardiologist alerted', 'alert shown', 'Cardiologist acknowledged', 'ECG 1 opened', 'BP updated', 'Aspirin documented', 'ECG 2 received', 'AI analysis completed', 'Serial comparison opened', 'STEMI confirmed', 'Decision delivered', `Existing case CAD #${CAD} opened`];
  const missing = need.filter(n => !A.some(a => a.includes(n)));
  ok('A1', 'Audit trail holds every major event', !missing.length, missing.length ? 'missing: ' + missing.join(', ') : `${A.length} events`);
  /* requests that fail while the crew context is deliberately offline are expected */
  const real = errors.filter(e => !/ERR_INTERNET_DISCONNECTED/.test(e));
  ok('E', 'No script errors on either device', !real.length, real.slice(0, 5).join(' | '));
  fs.writeFileSync(path.join(OUT, 'audit-trail.txt'), A.join('\n') + '\n');
  fs.rmSync(DATA, { recursive: true, force: true });
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots and audit trail in scripts/out/`);
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
