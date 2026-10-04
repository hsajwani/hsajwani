/* Local development runner for the STEMI test build. No dependencies: Node.js 22 standard library only.

   npm run dev            the server in the foreground, restarted when backend files change (Ctrl+C stops it)
   npm run dev:bg         the same in the background: keeps running after the Terminal or the Claude Code command ends
   npm run dev:status     is it running, on which port, with the current addresses
   npm run dev:restart    stop, then start again in the background
   npm run dev:stop       stop the background server (only this project's STEMI development server)

   How it works: one small supervisor process starts server/index.js as a child and
   - restarts it when a backend file changes (server/, public/shared/cad.js, package.json, .env);
     the screens (public/) are read from disk on every request, so a browser refresh shows a frontend change
   - restarts it if it stops unexpectedly (and stops retrying after repeated immediate crashes, until a file changes)
   - writes a timestamped log to .local/stemi-dev.log and its own identity to .local/stemi-dev.json
   - optionally (DEV_AUTO_PULL=true in .env, or --pull) fast-forwards this checkout from GitHub every 30 s when the
     working tree is clean, so changes pushed by Claude Code reach this Mac without a manual git pull
   The database (data/) is never touched: a restart is not a reset. */
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const SELF = path.join(ROOT, 'scripts', 'dev.js');
const LOCAL = path.join(ROOT, '.local');
const LOG = path.join(LOCAL, 'stemi-dev.log');
const PIDF = path.join(LOCAL, 'stemi-dev.json');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const PORT = Number(process.env.PORT || 3000);
const PULL = process.argv.includes('--pull') || /^(1|true|yes)$/i.test(process.env.DEV_AUTO_PULL || '');
const WATCH = ['server', 'public/shared/cad.js', 'package.json', '.env'];
const stamp = () => new Date().toISOString();
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(LOCAL, { recursive: true });

/* ---------- identity: is the recorded process really this project's supervisor? ---------- */
function readPid() { try { return JSON.parse(fs.readFileSync(PIDF, 'utf8')); } catch (_) { return null; } }
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function commandOf(pid) { try { return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim(); } catch (_) { return ''; } }
/* the PID file is trusted only if that PID is alive AND its command line is this project's dev.js supervisor:
   a PID reused by another application is never signalled */
function ours() {
  const r = readPid();
  if (!r || !r.pid || !alive(r.pid)) return null;
  const cmd = commandOf(r.pid);
  /* started as node /abs/path/scripts/dev.js (dev:bg) or node scripts/dev.js (npm run dev, from this project: the PID
     file in this project's .local records the root) */
  return (cmd.includes(SELF) || (cmd.includes('scripts/dev.js') && r.root === ROOT)) && / run\b/.test(cmd) ? r : null;
}
/* a PID file is removed only when its process no longer exists (never because it could not be verified) */
function dropStalePid() { const old = readPid(); if (old && !(old.pid && alive(old.pid))) { try { fs.unlinkSync(PIDF); } catch (_) { /* gone */ } } }
function health(timeout = 1500) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/health', timeout }, res => {
      let b = ''; res.on('data', d => { b += d; }); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (_) { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}
function portBusy() {
  return new Promise(resolve => {
    const s = net.connect({ host: '127.0.0.1', port: PORT }); s.setTimeout(1000);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.on('error', () => resolve(false));
  });
}
function lanIp() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
  out.sort((a, b) => (a.name === 'en0' ? -1 : b.name === 'en0' ? 1 : 0));
  return out;
}
function urls() {
  const lan = lanIp(), ip = lan[0] ? lan[0].address : null;
  return [
    `Crew:                      http://localhost:${PORT}/crew`,
    `Control:                   http://localhost:${PORT}/control`,
    `Cardiologist on this Mac:  http://localhost:${PORT}/cardiologist`,
    `Cardiologist on iPhone:    ${ip ? `http://${ip}:${PORT}/cardiologist` : 'no network address found: is this Mac on Wi-Fi?'}`,
    ...(lan.length > 1 ? [`Other addresses:           ${lan.slice(1).map(a => `${a.address} (${a.name})`).join(', ')}`] : [])
  ].join('\n');
}

/* ---------- the supervisor (npm run dev, and the background process of npm run dev:bg) ---------- */
async function run(bg) {
  const existing = ours();
  if (existing && existing.pid !== process.pid) { console.log(`The STEMI development server is already running (pid ${existing.pid}, port ${existing.port}). Use npm run dev:status.`); process.exit(0); }
  if (await portBusy()) {
    const h = await health();
    console.log(h && h.app === 'stemi-unified-platform'
      ? `A STEMI server is already running on port ${PORT} but was not started by the development runner (for example npm start in another Terminal). Stop that one (Ctrl+C in its Terminal), then run this again.`
      : `Port ${PORT} is used by another program. Nothing was stopped. Set another PORT in .env, or close that program.`);
    process.exit(1);
  }
  const logStream = fs.createWriteStream(LOG, { flags: 'a' });
  const out = (line, err) => { const l = `[${stamp()}] ${line}`; logStream.write(l + '\n'); if (!bg) (err ? process.stderr : process.stdout).write(l + '\n'); };
  const pipe = (stream, err) => { let buf = ''; stream.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) { logStream.write(l + '\n'); if (!bg) (err ? process.stderr : process.stdout).write(l + '\n'); } } }); };
  let child = null, stopping = false, restarting = false, quickCrashes = 0, startedAt = 0, waitingForChange = false;
  const writePid = () => fs.writeFileSync(PIDF, JSON.stringify({ pid: process.pid, childPid: child ? child.pid : null, port: PORT, root: ROOT, startedAt: new Date(SUP_START).toISOString(), background: bg, autoPull: PULL }, null, 1));
  const SUP_START = Date.now();

  function start(reason) {
    waitingForChange = false; startedAt = Date.now();
    out(`starting the STEMI server (${reason})`);
    child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'server', 'index.js')], { cwd: ROOT, env: { ...process.env, STEMI_DEV: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    pipe(child.stdout, false); pipe(child.stderr, true);
    writePid();
    child.on('exit', (code, sig) => {
      const c = child; child = null; writePid();
      if (stopping || restarting) return;
      const quick = Date.now() - startedAt < 4000;
      quickCrashes = quick ? quickCrashes + 1 : 0;
      out(`the STEMI server stopped unexpectedly (${sig || 'exit code ' + code})`, true);
      if (quickCrashes >= 5) { waitingForChange = true; out('it stopped 5 times in a row right after starting: waiting for a file change before trying again (see the errors above)', true); return; }
      setTimeout(() => { if (!child && !stopping && !waitingForChange) start('restart after it stopped'); }, Math.min(1000 * Math.max(1, quickCrashes), 5000));
      void c;
    });
  }
  function stopChild() {
    return new Promise(resolve => {
      if (!child) return resolve();
      const c = child, t = setTimeout(() => { try { c.kill('SIGKILL'); } catch (_) { /* gone */ } }, 4000);
      c.once('exit', () => { clearTimeout(t); resolve(); });
      try { c.kill('SIGTERM'); } catch (_) { clearTimeout(t); resolve(); }
    });
  }
  let debounce = null;
  function changed(file) {
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      if (stopping) return;
      out(`backend file changed (${file}): restarting the STEMI server · the database is kept`);
      restarting = true; await stopChild(); restarting = false; quickCrashes = 0;
      start('backend change');
    }, 300);
  }
  for (const w of WATCH) {
    const p = path.join(ROOT, w);
    if (!fs.existsSync(p)) continue;
    const dir = fs.statSync(p).isDirectory();
    try { fs.watch(p, { recursive: dir }, (_, f) => { if (!dir || (f && /\.(js|json|sql)$/.test(String(f)))) changed(dir ? path.join(w, String(f)) : w); }); }
    catch (e) { out(`cannot watch ${w}: ${e.message}`, true); }
  }
  /* changes pushed to GitHub reach this checkout: fast-forward only, and only with no local edits */
  if (PULL) {
    const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    let pulling = false;
    setInterval(() => {
      if (pulling) return; pulling = true;
      try {
        if (git('status', '--porcelain', '--untracked-files=no')) return;
        git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}');
        git('fetch', '--quiet');
        const behind = Number(git('rev-list', '--count', 'HEAD..@{u}'));
        if (behind > 0) { git('merge', '--ff-only', '--quiet', '@{u}'); out(`auto-pull: ${behind} new commit${behind > 1 ? 's' : ''} from GitHub applied (${git('log', '-1', '--format=%h %s')})`); }
      } catch (e) { out(`auto-pull skipped: ${String(e.stderr || e.message).split('\n')[0]}`); } finally { pulling = false; }
    }, 30000).unref();
    out('auto-pull on: checking GitHub every 30 s (fast-forward only, never with local edits)');
  }
  const shutdown = async sig => {
    if (stopping) return; stopping = true;
    out(`stopping (${sig})`);
    await stopChild();
    try { const r = readPid(); if (r && r.pid === process.pid) fs.unlinkSync(PIDF); } catch (_) { /* gone */ }
    logStream.end(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGHUP', () => { if (!bg) shutdown('SIGHUP'); });
  out(`development runner started (pid ${process.pid}, port ${PORT}, ${bg ? 'background' : 'foreground'})`);
  start('first start');
}

/* ---------- the commands ---------- */
async function background() {
  const r = ours();
  if (r) { console.log(`Already running (pid ${r.pid}, port ${r.port}). Nothing started.\n\n${urls()}`); return; }
  if (await portBusy()) { await run(true); return; } /* prints why, and exits */
  const p = spawn(process.execPath, [SELF, 'run', '--bg', ...(PULL ? ['--pull'] : [])], { cwd: ROOT, detached: true, stdio: 'ignore', env: process.env });
  p.unref();
  for (let i = 0; i < 40; i++) { await sleep(250); const h = await health(); if (h && h.status === 'ok') { console.log(`STEMI development server running in the background (pid ${p.pid}, port ${PORT}).\nLog: .local/stemi-dev.log${PULL ? ' · auto-pull on' : ''}\n\n${urls()}`); return; } }
  console.log(`Started (pid ${p.pid}) but /health did not answer within 10 s. See .local/stemi-dev.log`);
  process.exitCode = 1;
}
async function status() {
  const r = ours(), h = await health();
  if (r && h) console.log(`RUNNING · pid ${r.pid} · port ${r.port} · ${r.background ? 'background' : 'foreground'} · since ${r.startedAt} · server up ${h.uptimeSeconds} s · version ${h.version}${r.autoPull ? ' · auto-pull on' : ''}\nLog: .local/stemi-dev.log\n\n${urls()}`);
  else if (r) console.log(`The runner is running (pid ${r.pid}) but the server is not answering on port ${r.port} right now (restarting, or waiting for a fix: see .local/stemi-dev.log).`);
  else if (h && h.app === 'stemi-unified-platform') console.log(`A STEMI server is answering on port ${PORT} (pid ${h.pid}) but it was not started by the development runner (for example npm start).`);
  else console.log(`NOT RUNNING. Start it with: npm run dev:bg`);
  if (!r) dropStalePid();
}
async function stop() {
  const r = ours();
  if (!r) {
    dropStalePid();
    const h = await health();
    console.log(h && h.app === 'stemi-unified-platform' ? `No background development server to stop. A STEMI server on port ${PORT} was started some other way (pid ${h.pid}); it was left alone.` : 'Not running.');
    return;
  }
  process.kill(r.pid, 'SIGTERM');
  for (let i = 0; i < 40 && alive(r.pid); i++) await sleep(250);
  if (alive(r.pid) && ours()) { try { process.kill(-r.pid, 'SIGKILL'); } catch (_) { try { process.kill(r.pid, 'SIGKILL'); } catch (__) { /* gone */ } } }
  if (r.childPid && alive(r.childPid) && commandOf(r.childPid).includes(path.join(ROOT, 'server', 'index.js'))) { try { process.kill(r.childPid, 'SIGKILL'); } catch (_) { /* gone */ } }
  console.log(`Stopped the STEMI development server (pid ${r.pid}). The database is kept.`);
}

const cmd = process.argv[2];
({
  run: () => run(process.argv.includes('--bg')),
  bg: background,
  status,
  stop,
  restart: async () => { await stop(); await sleep(500); await background(); }
}[cmd] || (() => { console.log('Usage: node scripts/dev.js run|bg|status|stop|restart'); process.exitCode = 1; }))();
