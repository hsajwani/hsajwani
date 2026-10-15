/* The live link: Server-Sent Events from the server to every open screen.
   Screens send actions as ordinary HTTP requests (POST /api/ops); after each change the server pushes the changed case
   to every screen allowed to see it (crew: its own unit's cases · ER: cases sent to the ER · cardiologist: cases where
   cardiology was activated · test console: all). A heartbeat every few seconds lets a screen prove it is current; when
   it stops arriving the screen says CONNECTION LOST. */
const cfg = require('./config');

const clients = new Set();
let presenceCb = () => {};
/* a screen that reloads reconnects within a second or two; only a gap longer than this counts as offline */
const OFFLINE_AFTER_MS = 8000;
const ROLES = ['crew', 'er', 'cardiologist'];
const presence = Object.fromEntries(ROLES.map(r => [r, { up: false, at: null, timer: null }]));
const dev = process.env.STEMI_DEV === '1';
const stamp = () => new Date().toISOString();

function write(c, event, data) {
  try { c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) { /* closed */ }
}
function count(role) { let n = 0; for (const c of clients) if (c.role === role) n++; return n; }

function setPresence(role, up) {
  const p = presence[role];
  if (!p) return;
  clearTimeout(p.timer); p.timer = null;
  if (up) {
    if (!p.up) { p.up = true; p.at = Date.now(); presenceCb(); }
  } else if (p.up) {
    p.timer = setTimeout(() => { if (count(role) === 0 && p.up) { p.up = false; p.at = Date.now(); presenceCb(); } }, OFFLINE_AFTER_MS);
  }
}

/* hello(c) → [[event, data], …] sent first; it also records which cases this screen holds (c.cads) */
function add(req, res, actor, hello) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 2000\n\n');
  const c = { res, role: actor.role, actor, cads: new Set() };
  clients.add(c);
  req.socket.setKeepAlive(true);
  req.socket.setNoDelay(true);
  if (dev) console.log(`[${stamp()}] live link: ${c.role} screen connected (${clients.size} open)`);
  req.on('close', () => {
    clients.delete(c);
    if (count(c.role) === 0) setPresence(c.role, false);
    if (dev) console.log(`[${stamp()}] live link: ${c.role} screen disconnected (${clients.size} open)`);
  });
  res.on('error', e => console.error(`[${stamp()}] live link error (${c.role}): ${e.message}`));
  for (const [ev, data] of hello(c)) write(c, ev, data);
  setPresence(c.role, true);
}

/* to every open screen, or only to those the filter accepts */
function broadcast(event, dataFn, filter) {
  for (const c of clients) if (!filter || filter(c)) write(c, event, typeof dataFn === 'function' ? dataFn(c) : dataFn);
}
const each = fn => { for (const c of clients) fn(c); };

setInterval(() => broadcast('hb', { at: Date.now() }), cfg.HEARTBEAT_MS).unref();

module.exports = {
  add, broadcast, each, write,
  onPresence(fn) { presenceCb = fn; },
  /* up is null until a screen of that role has connected once since the server started (unknown, not offline) */
  presence: () => Object.fromEntries(ROLES.map(r => [r, { up: presence[r].at === null ? null : presence[r].up, at: presence[r].at }])),
  clientCount: () => clients.size
};
