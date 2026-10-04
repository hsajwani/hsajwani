/* The persistent test database: one SQLite file (data/stemi-test.db), built into Node 22, no install step.
   Later this layer is the one place to change for PostgreSQL. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const cfg = require('./config');

const db = new DatabaseSync(cfg.DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
/* columns added after v0.1: a database made by an earlier version gets them on start, keeping every existing row */
function addColumn(table, col, type) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
}
addColumn('audit_events', 'role', 'TEXT');
addColumn('cases', 'cad_source', 'TEXT');
addColumn('cases', 'cad_entered_at', 'INTEGER');
addColumn('cases', 'cad_entered_by', 'TEXT');
addColumn('cases', 'created_cid', 'TEXT');
addColumn('cases', 'status', 'TEXT');
addColumn('cases', 'handover_opened_at', 'INTEGER');
addColumn('cases', 'closed_at', 'INTEGER');
addColumn('cases', 'closed_by', 'TEXT');
addColumn('cases', 'closed_user_id', 'TEXT');
addColumn('cases', 'closure_reason', 'TEXT');
addColumn('cases', 'closure_source', 'TEXT');

const cache = new Map();
const st = sql => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; };
const all = (sql, ...a) => st(sql).all(...a).map(r => ({ ...r }));
const get = (sql, ...a) => { const r = st(sql).get(...a); return r ? { ...r } : null; };
const run = (sql, ...a) => st(sql).run(...a);
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
const uid = p => p + crypto.randomBytes(6).toString('hex');

/* ---------- passwords ---------- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
function checkPassword(pw, stored) {
  const [salt, h] = String(stored).split(':');
  if (!salt || !h) return false;
  const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(pw, salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- settings (the test console's simulation choices) ---------- */
const SIM_DEFAULT = { find: 'border', q: 'good', ai: 'ok', ids: false };
function sim() {
  const r = get("SELECT value FROM settings WHERE key='sim'");
  return { ...SIM_DEFAULT, ...(r ? JSON.parse(r.value) : {}) };
}
function setSim(patch) {
  const v = { ...sim(), ...patch };
  run("INSERT INTO settings(key,value) VALUES('sim',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify(v));
  return v;
}
/* the epoch changes when the test data is reset or a new incident starts, so open screens start afresh */
function epoch() { const r = get("SELECT value FROM settings WHERE key='epoch'"); return r ? r.value : bumpEpoch(); }
function bumpEpoch() {
  const v = Date.now().toString(36);
  run("INSERT INTO settings(key,value) VALUES('epoch',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", v);
  return v;
}

module.exports = { db, all, get, run, tx, uid, hashPassword, checkPassword, sim, setSim, epoch, bumpEpoch };
