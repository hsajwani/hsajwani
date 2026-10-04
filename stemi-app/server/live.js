/* The live link: Server-Sent Events from the server to every open screen.
   Devices send actions as ordinary HTTP requests (POST /api/ops); after each change the server pushes the case record
   to every screen. A heartbeat every few seconds lets a screen prove it is current ("Last update HH:MM:SS"); when the
   heartbeat stops arriving the screen says CONNECTION LOST. */
const cfg = require('./config');

const clients = new Set();
let presenceCb = () => {};
/* a screen that reloads reconnects within a second or two; only a gap longer than this counts as offline */
const OFFLINE_AFTER_MS = 8000;
const presence = { crew: { up: false, at: null, timer: null }, cardiologist: { up: false, at: null, timer: null } };

function write(c, event, data) {
  try { c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) { /* closed */ }
}

function count(role) { let n = 0; for (const c of clients) if (c.role === role) n++; return n; }

function setPresence(role, up) {
  const p = presence[role];
  if (!p) return;
  clearTimeout(p.timer); p.timer = null;
  if (up) {
    if (!p.up) { p.up = true; const was = p.at; p.at = Date.now(); presenceCb(role, true, was); }
  } else if (p.up) {
    p.timer = setTimeout(() => { if (count(role) === 0 && p.up) { p.up = false; p.at = Date.now(); presenceCb(role, false); } }, OFFLINE_AFTER_MS);
  }
}

function add(req, res, user, hello) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 2000\n\n');
  const c = { res, role: user.role, user };
  clients.add(c);
  req.socket.setKeepAlive(true);
  req.socket.setNoDelay(true);
  req.on('close', () => { clients.delete(c); if (count(c.role) === 0) setPresence(c.role, false); });
  for (const [ev, data] of hello()) write(c, ev, data);
  setPresence(c.role, true);
}

function broadcast(event, dataFn) {
  for (const c of clients) write(c, event, typeof dataFn === 'function' ? dataFn(c) : dataFn);
}

setInterval(() => broadcast('hb', { at: Date.now() }), cfg.HEARTBEAT_MS).unref();

module.exports = {
  add, broadcast,
  onPresence(fn) { presenceCb = fn; },
  /* up is null until the device has connected once since the server started (unknown, not offline) */
  presence: () => ({ crew: { up: presence.crew.at === null ? null : presence.crew.up, at: presence.crew.at }, doc: { up: presence.cardiologist.at === null ? null : presence.cardiologist.up, at: presence.cardiologist.at } }),
  clientCount: () => clients.size
};
