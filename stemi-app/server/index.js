/* Unified STEMI Platform · first functional multi-device test build (crew ↔ cardiologist).
   TEST DATA ONLY: fictional patients, simulated CAD numbers, simulated ECG images, test users.
   One process serves both role-based interfaces (/crew, /cardiologist), the API, the live event stream and the stored images. */
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

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const PAGES = { '/crew': ['crew', 'crew/index.html'], '/cardiologist': ['cardiologist', 'cardiologist/index.html'], '/control': [null, 'control/index.html'], '/login': [undefined, 'login/index.html'] };

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
  const user = auth.currentUser(req);

  /* ---------- pages ---------- */
  if (req.method === 'GET' && p === '/') return redirect(res, !user ? '/login' : user.role === 'crew' ? '/crew' : '/cardiologist');
  if (req.method === 'GET' && PAGES[p]) {
    const [role, file] = PAGES[p];
    if (role !== undefined) {
      if (!user) return redirect(res, '/login?next=' + encodeURIComponent(p));
      if (role && user.role !== role) return redirect(res, '/login?next=' + encodeURIComponent(p) + '&wrong=' + user.role);
    }
    /* the page learns who is logged in without an extra request */
    const html = fs.readFileSync(path.join(cfg.PUBLIC_DIR, file), 'utf8')
      .replace('<!--APP-->', `<script>window.APP=${JSON.stringify({ user: user || null }).replace(/</g, '\\u003c')};</script>`);
    return send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8' });
  }
  if (req.method === 'GET' && p.startsWith('/assets/')) {
    const f = path.normalize(path.join(cfg.PUBLIC_DIR, p.slice(8)));
    if (!f.startsWith(cfg.PUBLIC_DIR + path.sep)) return send(res, 404, 'Not found');
    return serveFile(res, f);
  }
  if (req.method === 'GET' && p === '/favicon.ico') return send(res, 204, '');

  /* ---------- login ---------- */
  if (req.method === 'POST' && p === '/api/login') {
    const b = await json(req), r = auth.login(b.email, b.password);
    if (!r) return send(res, 401, { error: 'Email or password not recognised' });
    return send(res, 200, { role: r.user.role, name: r.user.name }, { 'Set-Cookie': r.cookie });
  }
  if (req.method === 'POST' && p === '/api/logout') return send(res, 200, { ok: true }, { 'Set-Cookie': auth.logoutCookie });
  if (req.method === 'GET' && p === '/api/ping') return send(res, 200, { ok: true, now: Date.now() });

  /* everything below needs a logged-in test user */
  if (!user) return send(res, 401, { error: 'Not logged in' });

  if (req.method === 'GET' && p === '/api/me') return send(res, 200, { user });
  if (req.method === 'GET' && p === '/api/info') {
    const lan = lanAddresses();
    return send(res, 200, { cardiologistUrls: lan.map(a => `http://${a.address}:${cfg.PORT}/cardiologist`), aiProvider: cfg.AI_PROVIDER, clients: live.clientCount(),
      reminderSeconds: cfg.ALERT_REMINDER_SECONDS, escalationSeconds: cfg.ALERT_ESCALATION_SECONDS });
  }

  /* ---------- the live link ---------- */
  if (req.method === 'GET' && p === '/api/stream') {
    const view = url.searchParams.get('view');
    /* the test console watches without counting as the crew tablet or the cardiologist's device */
    const who = view === 'control' ? { ...user, role: 'control' } : user;
    return live.add(req, res, who, platform.hello);
  }

  /* ---------- the case under the CAD number the crew entered manually ---------- */
  if (p === '/api/cases/check' && req.method === 'GET') {
    if (user.role !== 'crew') return send(res, 403, { error: 'Only the crew opens cases' });
    return send(res, 200, platform.checkCad(url.searchParams.get('cad')));
  }
  if (p === '/api/cases' && req.method === 'POST') {
    if (user.role !== 'crew') return send(res, 403, { error: 'Only the crew opens cases' });
    const r = platform.createCase(user, await json(req));
    if (r.status === 'invalid') return send(res, 400, { code: 'invalid', ...r });
    if (r.status === 'exists') return send(res, 409, { code: 'exists', ...r });
    return send(res, r.status === 'created' ? 201 : 200, { ok: true, ...r, rec: platform.snapshot(r.cad) });
  }
  /* completed cases: listed and opened read-only by CAD number, for the crew and the cardiologist */
  if (p === '/api/cases' && req.method === 'GET') return send(res, 200, { cases: platform.listClosed(url.searchParams.get('q')) });
  if (p === '/api/cases/view' && req.method === 'GET') {
    const rec = platform.viewClosed(url.searchParams.get('cad'));
    return rec ? send(res, 200, { rec }) : send(res, 404, { error: 'No completed case with this CAD number' });
  }
  /* COMPLETE HANDOVER & CLOSE CASE */
  if (p === '/api/cases/close' && req.method === 'POST') {
    if (user.role !== 'crew') return send(res, 403, { error: 'Only the crew completes the handover' });
    const r = platform.closeCase(user, (await json(req)).cad);
    if (r.status === 'notactive') return send(res, 409, { code: 'notactive', error: 'This case is no longer the active case' });
    if (r.status === 'incomplete') return send(res, 409, { code: 'incomplete', ...r });
    return send(res, 200, { ok: true, ...r });
  }
  if (p === '/api/cases/open' && req.method === 'POST') {
    if (user.role !== 'crew') return send(res, 403, { error: 'Only the crew opens cases' });
    const r = platform.openExisting(user, (await json(req)).cad);
    if (r.status === 'invalid') return send(res, 400, { code: 'invalid', ...r });
    if (r.status === 'missing') return send(res, 404, { code: 'missing', ...r, error: 'There is no case with this CAD number' });
    return send(res, 200, { ok: true, ...r });
  }

  /* ---------- actions from the devices ---------- */
  if (req.method === 'POST' && p === '/api/ops') {
    const b = await json(req);
    const ops = Array.isArray(b.ops) ? b.ops : [];
    if (!ops.length || ops.length > 200) return send(res, 400, { error: 'No actions' });
    return send(res, 200, { results: platform.applyOps(user, ops), now: Date.now() });
  }

  /* ---------- ECG images: uploaded from the crew tablet, stored on disk, linked to their ECG when the ECG is sent ---------- */
  if (req.method === 'POST' && p === '/api/images') {
    if (user.role !== 'crew') return send(res, 403, { error: 'Only the crew uploads ECG images' });
    const mime = String(req.headers['content-type'] || '').split(';')[0];
    if (!['image/jpeg', 'image/png'].includes(mime)) return send(res, 415, { error: 'JPEG or PNG only' });
    const buf = await readBody(req, cfg.MAX_IMAGE_BYTES);
    if (!buf.length) return send(res, 400, { error: 'Empty image' });
    const cad = seed.activeCad();
    if (!cad) return send(res, 409, { error: 'No case is open on the platform' });
    if (D.get('SELECT closed_at FROM cases WHERE cad=?', cad).closed_at) return send(res, 409, { error: 'This case is closed (handover completed): it is read-only' });
    if (url.searchParams.get('cad') && url.searchParams.get('cad') !== cad) return send(res, 409, { error: 'This case is no longer the active test case' });
    const id = D.uid('img'), file = `${id}${mime === 'image/png' ? '.png' : '.jpg'}`;
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    fs.writeFileSync(path.join(cfg.IMAGE_DIR, file), buf);
    const src = url.searchParams.get('src') === 'file' ? 'file' : 'test-generator';
    D.run('INSERT INTO ecg_images(id,cad,uploaded_at,source,file_name,mime,bytes,sha256,uploaded_by) VALUES(?,?,?,?,?,?,?,?,?)',
      id, cad, Date.now(), src, file, mime, buf.length, sha, `${user.name}, ${user.title}`);
    return send(res, 200, { id, url: `/files/${id}`, sha256: sha });
  }
  if (req.method === 'GET' && p.startsWith('/files/')) {
    const row = D.get('SELECT file_name, mime FROM ecg_images WHERE id=?', p.slice(7));
    if (!row) return send(res, 404, 'Not found');
    return serveFile(res, path.join(cfg.IMAGE_DIR, row.file_name), { 'Cache-Control': 'private, max-age=86400, immutable' });
  }

  /* ---------- the test console (stands in for the CAD feed and the prototype's simulation controls) ---------- */
  if (req.method === 'POST' && p.startsWith('/api/control/')) {
    const what = p.slice(13);
    if (what === 'sim') {
      const b = await json(req), patch = {};
      if (['border', 'clear'].includes(b.find)) patch.find = b.find;
      if (['good', 'glare', 'cut'].includes(b.q)) patch.q = b.q;
      if (['ok', 'down', 'proc'].includes(b.ai)) patch.ai = b.ai;
      if (typeof b.ids === 'boolean') patch.ids = b.ids;
      const sim = D.setSim(patch);
      live.broadcast('cfg', { sim });
      if (patch.ai && patch.ai !== 'proc') platform.aiResume();
      return send(res, 200, { sim });
    }
    if (what === 'reset') {
      resetData();
      D.bumpEpoch();
      live.broadcast('init', { now: Date.now(), cad: null, epoch: D.epoch() });
      platform.push();
      return send(res, 200, { ok: true });
    }
    if (what === 'close-case') return send(res, 200, { ok: platform.closeActive() });
    if (what === 'demo-case') {
      const r = platform.demoCase((await json(req)).cad);
      if (r.status === 'invalid') return send(res, 400, { code: 'invalid', ...r, error: r.error + ' ' + r.detail });
      if (r.status === 'exists') return send(res, 409, { code: 'exists', ...r, error: `CASE ALREADY EXISTS: CAD #${r.cad}. No second case was created.` });
      return send(res, 200, { ok: true, cad: r.cad });
    }
    if (what === 'reminder') return send(res, 200, { ok: platform.reminder() });
    if (what === 'escalate') return send(res, 200, { ok: platform.escalate() });
  }
  return send(res, 404, { error: 'Not found' });
}

/* wipe every test case and image (users stay) */
function resetData() {
  D.tx(() => {
    ['final_vitals', 'handovers', 'arrivals', 'ops', 'audit_events', 'case_updates', 'etas', 'destinations', 'decisions', 'ecg_views', 'alert_followups', 'cardiologist_alerts',
      'ai_interpretations', 'ecg_images', 'ecgs', 'treatments', 'observations', 'patient_details', 'cases'].forEach(t => D.run(`DELETE FROM ${t}`));
  });
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

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
  }
  /* Wi-Fi on a Mac is usually en0 */
  return out.sort((a, b) => (a.name === 'en0' ? -1 : b.name === 'en0' ? 1 : 0));
}

server.listen(cfg.PORT, cfg.HOST, () => {
  const lan = lanAddresses();
  const ip = lan[0] ? lan[0].address : '<this computer\'s IP address>';
  const line = '─'.repeat(64);
  console.log(`\n${line}\n Unified STEMI Platform · test build · FICTIONAL TEST DATA ONLY\n${line}`);
  console.log(` Crew MDT (this computer):   http://localhost:${cfg.PORT}/crew`);
  console.log(` Cardiologist (iPhone):      http://${ip}:${cfg.PORT}/cardiologist`);
  console.log(` Test console:               http://localhost:${cfg.PORT}/control`);
  if (lan.length > 1) console.log(` Other addresses of this computer: ${lan.slice(1).map(a => `${a.address} (${a.name})`).join(', ')}`);
  console.log(`\n Test users: crew@test.local and cardio@test.local · password: ${process.env.TEST_USER_PASSWORD ? '(from .env)' : cfg.TEST_PASSWORD}`);
  const act = seed.activeCad();
  console.log(` Active case: ${act ? 'CAD #' + act : 'none (the crew enters the CAD number when opening the STEMI pathway)'} · database: ${path.relative(cfg.ROOT, cfg.DB_FILE)} · AI: ${cfg.AI_PROVIDER} (simulated)`);
  console.log(` The iPhone must be on the same Wi-Fi. Stop the server with Ctrl+C.\n${line}\n`);
});

module.exports = server;
