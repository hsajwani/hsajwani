/* LEGACY Node.js server (the prototype before 0.7.0), kept only as a transition fallback: the backend is now the
   ASP.NET Core application in src/ (docs/handover.md). Settings come from environment variables (see .env.example).
   This build holds fictional test data only; no secret is in the source code. */
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

/* the crew test password: from .env (TEST_USER_PASSWORD), or generated once and kept in the data folder — the same
   file the ASP.NET Core backend uses (data/crew-test-password.txt). Never in the source code, never printed. */
function crewPassword() {
  if (process.env.TEST_USER_PASSWORD) return { value: process.env.TEST_USER_PASSWORD, source: '.env (TEST_USER_PASSWORD)' };
  const f = path.join(DATA_DIR, 'crew-test-password.txt');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(12).toString('base64url') + '\n', { mode: 0o600 });
  return { value: fs.readFileSync(f, 'utf8').trim(), source: f };
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
  TEST_PASSWORD: crewPassword().value,
  TEST_PASSWORD_SOURCE: crewPassword().source,
  /* the AI service behind the interface in server/ai/: only "mock" exists in this build */
  AI_PROVIDER: process.env.AI_PROVIDER || 'mock',
  MOCK_AI_DELAY_MS: num(process.env.MOCK_AI_DELAY_MS, 5000),
  HEARTBEAT_MS: num(process.env.HEARTBEAT_MS, 5000),
  MAX_IMAGE_BYTES: num(process.env.MAX_IMAGE_BYTES, 8 * 1024 * 1024),
  /* the corpuls integration behind server/integrations/corpuls/: "mock" (simulated monitors, the only working provider)
     or "corpuls-mission" (a stub: not implemented, connects to nothing) */
  CORPULS_PROVIDER: process.env.CORPULS_PROVIDER || 'mock',
  /* the simulated monitor: one vital-signs update every CORPULS_SIM_TICK_MS, a non-invasive BP measurement every
     CORPULS_SIM_NIBP_SECONDS. Simulation settings, not clinical ones */
  CORPULS_SIM_TICK_MS: num(process.env.CORPULS_SIM_TICK_MS, 5000),
  CORPULS_SIM_NIBP_SECONDS: num(process.env.CORPULS_SIM_NIBP_SECONDS, 120),
  /* how long the simulated monitor takes to connect after LINK CORPULS (milliseconds) */
  CORPULS_SIM_CONNECT_MS: num(process.env.CORPULS_SIM_CONNECT_MS, 800),
  /* the prototype demo mode of the simulated feed (on unless CORPULS_DEMO_MODE=false): LINK CORPULS starts a fresh
     simulated monitor that connects, sends live values and, CORPULS_DEMO_ECG_SECONDS after connecting, ECG 1 by itself
     (no test console needed for the basic demonstration); the crew can simulate a requested repeat 12-lead. Off: the
     simulated monitor does only what the test console's simulator tells it. Simulation settings, not clinical ones */
  CORPULS_DEMO_MODE: !/^(false|0|off|no)$/i.test(process.env.CORPULS_DEMO_MODE || ''),
  CORPULS_DEMO_ECG_SECONDS: num(process.env.CORPULS_DEMO_ECG_SECONDS, 3)
  /* acknowledgement reminders and escalation are governance decisions not yet made (Q-15, Q-54, Q-72): nothing in this
     build reminds or escalates; the alarms continue until a clinician accepts / acknowledges */
};
