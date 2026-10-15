/* STEMI Coordination Platform · test build (crew → ER Doctor → Cardiologist).
   TEST DATA ONLY: fictional patients, simulated CAD numbers, simulated ECG images, test users.
   One process serves every role's screen (/crew, /er, /cardiologist, /control), the API, the live event stream and the
   stored ECG images. */
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`This test build needs Node.js 22.13 or later; this computer has ${process.version}. Install the current LTS from https://nodejs.org`);
  process.exit(1);
}
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const cfg = require('./config');
const D = require('./db');
const seed = require('./seed');
const auth = require('./auth');
const live = require('./live');
const platform = require('./platform');

seed.ensureUsers();
/* STEMI_DEV is set by the development runner (scripts/dev.js) */
const DEV = process.env.STEMI_DEV === '1';
const STARTED = Date.now();
const VERSION = require('../package.json').version;
const stamp = () => new Date().toISOString();
process.on('uncaughtException', e => { console.error(`[${stamp()}] uncaught server error:`, e); process.exit(1); });
process.on('unhandledRejection', e => console.error(`[${stamp()}] unhandled promise rejection:`, e));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
/* path → [who may open it, file]. crew: the crew login · er / cardiologist / control: a prototype device session, given
   on first visit (no login) · null: anyone */
const PAGES = {
  '/': [null, 'index.html'],
  '/login': [null, 'login/index.html'],
  '/crew': ['crew', 'crew/index.html'],
  '/er': ['er', 'er/index.html'],
  '/cardiologist': ['cardiologist', 'cardiologist/index.html'],
  '/control': ['control', 'control/index.html']
};

function send(res, status, body, headers) {
  const isBuf = Buffer.isBuffer(body), isStr = typeof body === 'string';
  const data = isBuf || isStr ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': isBuf ? 'application/octet-stream' : isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}
const redirect = (res, to, headers) => { res.writeHead(302, { Location: to, ...headers }); res.end(); };

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const parts = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(Object.assign(new Error('Too large'), { status: 413 })); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}
const json = async req => { const b = await readBody(req, 1024 * 1024); try { return JSON.parse(b.toString() || '{}'); } catch (_) { throw Object.assign(new Error('Bad JSON'), { status: 400 }); } };

function serveFile(res, file, extraHeaders) {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...extraHeaders });
    res.end(buf);
  });
}

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  /* ---------- pages ---------- */
  if (req.method === 'GET' && PAGES[p]) {
    const [role, file] = PAGES[p], headers = { 'Content-Type': 'text/html; charset=utf-8' };
    let user = null;
    if (role === 'crew') {
      user = auth.currentUser(req);
      if (!user) return redirect(res, '/login?next=' + encodeURIComponent(p));
    } else if (role && !auth.device(req, role)) headers['Set-Cookie'] = auth.deviceCookie(role);
    /* the page learns its role, the crew user and the version without an extra request */
    const html = fs.readFileSync(path.join(cfg.PUBLIC_DIR, file), 'utf8')
      .replace('<!--APP-->', `<script>window.APP=${JSON.stringify({ role, user, version: VERSION }).replace(/</g, '\\u003c')};</script>`);
    return send(res, 200, html, headers);
  }
  if (req.method === 'GET' && p.startsWith('/assets/')) {
    const f = path.normalize(path.join(cfg.PUBLIC_DIR, p.slice(8)));
    if (!f.startsWith(cfg.PUBLIC_DIR + path.sep)) return send(res, 404, 'Not found');
    return serveFile(res, f);
  }
  if (req.method === 'GET' && p === '/favicon.ico') return send(res, 204, '');

  /* ---------- crew login ---------- */
  if (req.method === 'POST' && p === '/api/login') {
    const b = await json(req), r = auth.login(b.email, b.password);
    if (!r.user) return send(res, 401, { error: r.error });
    return send(res, 200, { role: r.user.role, name: r.user.name }, { 'Set-Cookie': r.cookie });
  }
  if (req.method === 'POST' && p === '/api/logout') return send(res, 200, { ok: true }, { 'Set-Cookie': auth.logoutCookie });
  if (req.method === 'GET' && p === '/api/ping') return send(res, 200, { ok: true, now: Date.now() });
  /* is the server alive? No login, and nothing about cases, users, settings or secrets */
  if (req.method === 'GET' && p === '/health') {
    return send(res, 200, { status: 'ok', app: 'stemi-unified-platform', environment: DEV ? 'development' : 'standard', version: VERSION,
      port: cfg.PORT, pid: process.pid, startedAt: new Date(STARTED).toISOString(), uptimeSeconds: Math.round((Date.now() - STARTED) / 1000) });
  }

  /* ---------- ECG images: shown on every role's screen ---------- */
  if (req.method === 'GET' && p.startsWith('/files/')) {
    if (!auth.anySession(req)) return send(res, 401, { error: 'Not signed in' });
    const row = D.get('SELECT file_name FROM ecg_images WHERE id=?', p.slice(7));
    if (!row) return send(res, 404, 'Not found');
    /* the simulated corpuls ECGs are SVG drawn by the platform itself; nothing in them may ever run */
    return serveFile(res, path.join(cfg.IMAGE_DIR, row.file_name), { 'Cache-Control': 'private, max-age=86400, immutable', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'X-Content-Type-Options': 'nosniff' });
  }

  /* everything below needs the screen's session: the crew login, or the ER / cardiologist / console device session */
  const role = String(req.headers['x-stemi-role'] || url.searchParams.get('role') || 'crew');
  const A = auth.actor(req, role);
  if (!A) return send(res, 401, { error: role === 'crew' ? 'Not logged in' : 'No session for this screen: reload the page' });

  if (req.method === 'GET' && p === '/api/me') return send(res, 200, { role: A.role, user: A.role === 'crew' ? A : null, version: VERSION });
  if (req.method === 'GET' && p === '/api/info') {
    const lan = lanAddresses();
    return send(res, 200, { version: VERSION, aiProvider: cfg.AI_PROVIDER, corpuls: platform.monitor.providerInfo(), clients: live.clientCount(), presence: live.presence(),
      urls: lan.map(a => ({ name: a.name, er: `http://${a.address}:${cfg.PORT}/er`, cardiologist: `http://${a.address}:${cfg.PORT}/cardiologist` })) });
  }

  /* ---------- the live link ---------- */
  if (req.method === 'GET' && p === '/api/stream') return live.add(req, res, A, platform.hello);

  /* ---------- cases ---------- */
  const crewOnly = what => send(res, 403, { error: `Only the crew ${what}` });
  if (p === '/api/cases/check' && req.method === 'GET') {
    if (A.role !== 'crew') return crewOnly('opens cases');
    return send(res, 200, platform.checkCad(url.searchParams.get('cad')));
  }
  if (p === '/api/cases' && req.method === 'POST') {
    if (A.role !== 'crew') return crewOnly('opens cases');
    const r = platform.createCase(A, await json(req));
    if (r.status === 'invalid') return send(res, 400, { code: 'invalid', ...r });
    if (r.status === 'exists') return send(res, 409, { code: 'exists', ...r });
    return send(res, r.status === 'created' ? 201 : 200, { ok: true, ...r, rec: platform.snapshot(r.cad) });
  }
  /* completed cases: found by CAD number and opened read-only, by every role allowed to see them */
  if (p === '/api/cases' && req.method === 'GET') return send(res, 200, { cases: platform.listClosed(A, url.searchParams.get('q')) });
  if (p === '/api/cases/view' && req.method === 'GET') {
    const rec = platform.viewCase(A, url.searchParams.get('cad'));
    return rec ? send(res, 200, { rec }) : send(res, 404, { error: 'No case with this CAD number for this screen' });
  }
  /* COMPLETE STEMI PATHWAY: only while the current Cardiologist decision is CONFIRMED STEMI */
  if ((p === '/api/cases/complete' || p === '/api/cases/close') && req.method === 'POST') {
    if (A.role !== 'crew') return crewOnly('completes the STEMI pathway');
    const r = platform.completeCase(A, (await json(req)).cad);
    if (r.status === 'missing') return send(res, 404, { code: 'missing', error: 'There is no case with this CAD number for this tablet' });
    if (r.status === 'closed') return send(res, 409, { code: 'closed', ...r, error: 'This STEMI pathway is already closed: it is read-only.' });
    if (r.status === 'incomplete') return send(res, 409, { code: 'incomplete', ...r });
    return send(res, 200, { ok: true, ...r });
  }
  if (p === '/api/cases/open' && req.method === 'POST') {
    if (A.role !== 'crew') return crewOnly('opens cases');
    const r = platform.openExisting(A, (await json(req)).cad);
    if (r.status === 'invalid') return send(res, 400, { code: 'invalid', ...r });
    if (r.status === 'missing') return send(res, 404, { code: 'missing', ...r, error: 'There is no case with this CAD number' });
    if (r.status === 'other-unit') return send(res, 403, { code: 'other-unit', ...r, error: 'This CAD number belongs to a case of another unit' });
    return send(res, 200, { ok: true, ...r });
  }
  /* the CAD number of an unsent case corrected before SEND (the case and its corpuls data move with it) */
  if (p === '/api/cases/correct' && req.method === 'POST') {
    if (A.role !== 'crew') return crewOnly('corrects a CAD number');
    const r = platform.correctCad(A, await json(req));
    if (r.status === 'invalid') return send(res, 400, { code: 'invalid', ...r });
    if (r.status === 'exists') return send(res, 409, { code: 'exists', ...r });
    if (r.status === 'missing') return send(res, 404, { code: 'missing', ...r, error: 'There is no unsent case with this CAD number on this tablet' });
    if (r.status === 'sent') return send(res, 409, { code: 'sent', ...r });
    return send(res, 200, { ok: true, ...r });
  }
  /* an unsent case discarded on the tablet: kept as an unsent draft, its corpuls feed ends */
  if (p === '/api/cases/discard' && req.method === 'POST') {
    if (A.role !== 'crew') return crewOnly('discards an unsent case');
    const r = platform.discardDraft(A, (await json(req)).cad);
    if (r.status === 'missing') return send(res, 404, { code: 'missing', ...r, error: 'There is no unsent case with this CAD number on this tablet' });
    if (r.status === 'sent') return send(res, 409, { code: 'sent', ...r, error: 'The case was already sent: it cannot be discarded.' });
    return send(res, 200, { ok: true, ...r });
  }

  /* ---------- the corpuls feed: the crew links the case to the unit's monitor (the CAD number must exist) ---------- */
  if (p === '/api/corpuls/link' && req.method === 'POST') {
    if (A.role !== 'crew') return crewOnly('links the corpuls monitor');
    const r = platform.monitor.link(A, (await json(req)).cad);
    if (r.status === 'missing') return send(res, 404, { code: 'missing', ...r, error: 'There is no case with this CAD number for this tablet: enter the CAD number first.' });
    if (r.status === 'closed') return send(res, 409, { code: 'closed', ...r, error: 'This STEMI pathway is closed: it is read-only.' });
    return send(res, 200, { ok: true, ...r, rec: platform.snapshot(r.cad) });
  }

  /* ---------- actions from the screens ---------- */
  if (req.method === 'POST' && p === '/api/ops') {
    if (!['crew', 'er', 'cardiologist'].includes(A.role)) return send(res, 403, { error: 'This screen does not record clinical actions' });
    const b = await json(req);
    const ops = Array.isArray(b.ops) ? b.ops : [];
    if (!ops.length || ops.length > 200) return send(res, 400, { error: 'No actions' });
    return send(res, 200, { results: platform.applyOps(A, ops), now: Date.now() });
  }

  /* ---------- ECG images: uploaded from the crew MDT, stored on disk, linked to their ECG when it is sent ---------- */
  if (req.method === 'POST' && p === '/api/images') {
    if (A.role !== 'crew') return crewOnly('uploads ECG images');
    const mime = String(req.headers['content-type'] || '').split(';')[0];
    if (!['image/jpeg', 'image/png'].includes(mime)) return send(res, 415, { error: 'JPEG or PNG only' });
    const F = platform.facts(String(url.searchParams.get('cad') || ''));
    if (!F || F.C.unit !== A.unit) return send(res, 404, { error: 'There is no case with this CAD number for this tablet' });
    if (F.C.closed_at) return send(res, 409, { error: 'This STEMI pathway is closed: it is read-only' });
    const buf = await readBody(req, cfg.MAX_IMAGE_BYTES);
    if (!buf.length) return send(res, 400, { error: 'Empty image' });
    const id = D.uid('img'), file = `${id}${mime === 'image/png' ? '.png' : '.jpg'}`;
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    fs.writeFileSync(path.join(cfg.IMAGE_DIR, file), buf);
    const src = url.searchParams.get('src') === 'file' ? 'file' : 'test-generator';
    D.run('INSERT INTO ecg_images(id,cad,uploaded_at,source,file_name,mime,bytes,sha256,uploaded_by) VALUES(?,?,?,?,?,?,?,?,?)',
      id, F.C.cad, Date.now(), src, file, mime, buf.length, sha, `${A.name}, ${A.title}`);
    return send(res, 200, { id, url: `/files/${id}`, sha256: sha });
  }

  /* ---------- the test console (TEST ONLY: test data and simulation controls) ---------- */
  if (p.startsWith('/api/control/')) {
    if (A.role !== 'control') return send(res, 403, { error: 'Test console only' });
    const what = p.slice(13);
    if (req.method === 'GET' && what === 'cases') return send(res, 200, { cases: platform.consoleCases() });
    /* the corpuls simulator (TEST ONLY): the simulated monitors, and what the tester makes them do */
    if (req.method === 'GET' && what === 'corpuls') return send(res, 200, platform.monitor.simInfo());
    if (req.method === 'POST' && what.startsWith('corpuls/')) {
      const b = await json(req), r = platform.monitor.simulate(b.cad, what.slice(8), b);
      return send(res, r.ok ? 200 : 409, { ...r, sim: platform.monitor.simInfo() });
    }
    if (req.method !== 'POST') return send(res, 404, { error: 'Not found' });
    if (what === 'sim') {
      const b = await json(req), patch = {};
      if (['border', 'clear'].includes(b.find)) patch.find = b.find;
      if (['good', 'glare', 'cut'].includes(b.q)) patch.q = b.q;
      if (['ok', 'down', 'proc'].includes(b.ai)) patch.ai = b.ai;
      const sim = D.setSim(patch);
      live.broadcast('cfg', { sim });
      if (patch.ai && patch.ai !== 'proc') platform.aiResume();
      return send(res, 200, { sim });
    }
    if (what === 'reset') {
      resetData();
      D.bumpEpoch();
      platform.restartScreens();
      return send(res, 200, { ok: true });
    }
    if (what === 'screens') {
      const b = await json(req);
      return send(res, 200, { ok: platform.setOnScreens(A, b.cad, !!b.on) });
    }
    if (what === 'demo-case') {
      const r = platform.demoCase(A, (await json(req)).cad);
      if (r.status === 'invalid') return send(res, 400, { code: 'invalid', ...r, error: r.error + ' ' + r.detail });
      if (r.status === 'exists') return send(res, 409, { code: 'exists', ...r, error: `CASE ALREADY EXISTS: CAD #${r.cad}. No second case was created.` });
      if (r.status === 'error') return send(res, 500, { code: 'error', ...r });
      return send(res, 200, { ok: true, cad: r.cad });
    }
  }
  return send(res, 404, { error: 'Not found' });
}

/* wipe every test case and image (the crew test user stays) */
function resetData() {
  D.tx(() => {
    ['final_vitals', 'handovers', 'arrivals', 'ops', 'audit_events', 'case_updates', 'etas', 'destinations', 'decisions', 'ecg_views', 'ecg_role_views', 'alert_followups', 'cardiologist_alerts',
      'ai_interpretations', 'monitor_vitals', 'monitor_events', 'ecg_images', 'ecgs', 'treatments', 'observations', 'patient_details', 'cases'].forEach(t => D.run(`DELETE FROM ${t}`));
  });
  platform.monitor.reset();
  for (const f of fs.readdirSync(cfg.IMAGE_DIR)) fs.unlinkSync(path.join(cfg.IMAGE_DIR, f));
}

const server = http.createServer((req, res) => {
  route(req, res).catch(e => {
    if (!e.status) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
  });
});
server.keepAliveTimeout = 65000;
platform.aiResume();
/* the corpuls feeds that were linked carry on after a restart */
platform.monitor.resume();

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
  }
  /* Wi-Fi on a Mac is usually en0 */
  return out.sort((a, b) => (a.name === 'en0' ? -1 : b.name === 'en0' ? 1 : 0));
}

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`[${stamp()}] Port ${cfg.PORT} is already in use. Another program (or another copy of this server) is using it. Check with: npm run dev:status`);
  else console.error(`[${stamp()}] server error:`, e);
  process.exit(1);
});

server.listen(cfg.PORT, cfg.HOST, () => {
  const lan = lanAddresses();
  const ip = lan[0] ? lan[0].address : '<this computer\'s IP address>';
  const line = '─'.repeat(64);
  console.log(`\n${line}\n ${DEV ? 'STEMI Development Server Running' : 'STEMI Coordination Platform · test build'} · v${VERSION} · ${stamp()}\n FICTIONAL TEST DATA ONLY\n${line}`);
  console.log(` Crew (this Mac):            http://localhost:${cfg.PORT}/crew`);
  console.log(` ER Doctor (this Mac):       http://localhost:${cfg.PORT}/er`);
  console.log(` Cardiologist on this Mac:   http://localhost:${cfg.PORT}/cardiologist`);
  console.log(` Cardiologist on iPhone:     http://${ip}:${cfg.PORT}/cardiologist`);
  console.log(` Test console:               http://localhost:${cfg.PORT}/control`);
  if (lan.length > 1) console.log(` Other addresses: ${lan.slice(1).map(a => `${a.address} (${a.name})`).join(', ')}`);
  console.log(` Health: http://localhost:${cfg.PORT}/health · database: ${path.relative(cfg.ROOT, cfg.DB_FILE)} (kept across restarts) · AI: ${cfg.AI_PROVIDER} (simulated) · corpuls: ${cfg.CORPULS_PROVIDER === 'mock' ? 'simulated feed (MockCorpulsProvider)' : cfg.CORPULS_PROVIDER + ' (not implemented)'}`);
  if (!DEV) console.log(` Crew test login: crew@test.local · password: ${process.env.TEST_USER_PASSWORD ? '(from .env)' : cfg.TEST_PASSWORD}\n The iPhone must be on the same Wi-Fi. Stop the server with Ctrl+C.`);
  console.log(`${line}\n`);
});

module.exports = server;
