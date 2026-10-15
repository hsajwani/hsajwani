/* Settings come from environment variables (see .env.example). Nothing here is a secret worth protecting:
   this build holds fictional test data only. */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
/* settings from .env when it exists; a variable already set in the environment wins */
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
fs.mkdirSync(path.join(DATA_DIR, 'images'), { recursive: true });

/* the session signing key: from .env, or generated once and kept in the data folder (never committed) */
function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(DATA_DIR, '.session-secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
}

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

module.exports = {
  ROOT,
  DATA_DIR,
  DB_FILE: path.join(DATA_DIR, 'stemi-test.db'),
  IMAGE_DIR: path.join(DATA_DIR, 'images'),
  PUBLIC_DIR: path.join(ROOT, 'public'),
  PORT: num(process.env.PORT, 3000),
  HOST: process.env.HOST || '0.0.0.0',
  SESSION_SECRET: sessionSecret(),
  SESSION_HOURS: num(process.env.SESSION_HOURS, 24),
  TEST_PASSWORD: process.env.TEST_USER_PASSWORD || 'stemi-test',
  /* the AI service behind the interface in server/ai/: only "mock" exists in this build */
  AI_PROVIDER: process.env.AI_PROVIDER || 'mock',
  MOCK_AI_DELAY_MS: num(process.env.MOCK_AI_DELAY_MS, 5000),
  HEARTBEAT_MS: num(process.env.HEARTBEAT_MS, 5000),
  MAX_IMAGE_BYTES: num(process.env.MAX_IMAGE_BYTES, 8 * 1024 * 1024)
  /* acknowledgement reminders and escalation are governance decisions not yet made (Q-15, Q-54, Q-72): nothing in this
     build reminds or escalates; the alarms continue until a clinician accepts / acknowledges */
};
