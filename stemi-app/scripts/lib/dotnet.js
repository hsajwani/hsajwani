/* The ASP.NET Core backend (src/Masar.Api), as the development runner (scripts/dev.js) and the test harness
   (scripts/lib/harness.js) start it. Node.js 22 standard library only.

   Settings: the .NET application reads standard .NET configuration (appsettings.json, then environment variables such as
   Corpuls__DemoMode). The older setting names of the Node.js prototype (.env: PORT, DATA_DIR, CORPULS_DEMO_MODE …) are
   translated here, so an existing .env keeps working. The full list is in docs/configuration.md. */
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const API_DIR = path.join(ROOT, 'src', 'Masar.Api');
const API_PROJECT = path.join(API_DIR, 'Masar.Api.csproj');
const DLL = path.join(API_DIR, 'bin', 'Debug', 'net10.0', 'Masar.Api.dll');

/* prototype setting name (.env) → .NET configuration key (environment variable form) */
const LEGACY = {
  DATA_DIR: 'Storage__DataDirectory',
  MAX_IMAGE_BYTES: 'Storage__MaxImageBytes',
  SESSION_HOURS: 'Sessions__CrewSessionHours',
  TEST_USER_PASSWORD: 'Prototype__CrewTestUser__Password',
  AI_PROVIDER: 'Ai__Provider',
  MOCK_AI_DELAY_MS: 'Ai__MockDelayMs',
  HEARTBEAT_MS: 'Live__HeartbeatMs',
  CORPULS_PROVIDER: 'Corpuls__Provider',
  CORPULS_SIM_TICK_MS: 'Corpuls__SimTickMs',
  CORPULS_SIM_NIBP_SECONDS: 'Corpuls__SimNibpSeconds',
  CORPULS_SIM_CONNECT_MS: 'Corpuls__SimConnectMs',
  CORPULS_DEMO_MODE: 'Corpuls__DemoMode',
  CORPULS_DEMO_ECG_SECONDS: 'Corpuls__DemoEcgSeconds'
};
/* no longer used by the .NET backend (documented in docs/configuration.md) */
const RETIRED = ['SESSION_SECRET'];

/* the .NET environment variables for a set of prototype-style settings. host/port: where Kestrel listens */
function dotnetEnv(settings, o) {
  const out = {};
  for (const [k, v] of Object.entries(settings || {})) {
    if (v === undefined || v === '' || !LEGACY[k]) continue;
    if (k === 'DATA_DIR') out[LEGACY[k]] = path.resolve(ROOT, v);
    else if (k === 'CORPULS_DEMO_MODE') out[LEGACY[k]] = /^(false|0|off|no)$/i.test(v) ? 'false' : 'true';
    else out[LEGACY[k]] = String(v);
  }
  if (o && o.port) out.Kestrel__Endpoints__Http__Url = `http://${o.host || '0.0.0.0'}:${o.port}`;
  return out;
}

/* is the .NET SDK installed? (the message says what to install) */
function sdkVersion() {
  try { return execFileSync('dotnet', ['--version'], { encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (_) { return null; }
}
const NO_SDK = 'The .NET 10 SDK is needed to build and run the MASAR backend (ASP.NET Core). Install it from https://dotnet.microsoft.com/download/dotnet/10.0 (macOS: the Arm64 or x64 installer, or "brew install --cask dotnet-sdk"), then run this again. See docs/deployment.md.';

/* build the backend (Debug); quick when nothing changed. Returns the build output; throws with it on failure */
function build(opts) {
  try {
    return execFileSync('dotnet', ['build', API_PROJECT, '-c', 'Debug', '--nologo', '-v', 'q', '-clp:NoSummary;ErrorsOnly'], {
      encoding: 'utf8', cwd: ROOT, env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' }, stdio: ['ignore', 'pipe', 'pipe'], timeout: (opts && opts.timeout) || 600000
    });
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`.trim() || e.message;
    throw Object.assign(new Error(`The .NET build failed:\n${out}`), { output: out });
  }
}

/* start the built backend. env: the full environment for the process (already translated) */
function start(env, stdio) {
  if (!fs.existsSync(DLL)) throw new Error(`The backend is not built (${path.relative(ROOT, DLL)} is missing): run dotnet build`);
  return spawn('dotnet', [DLL], { cwd: API_DIR, env, stdio: stdio || ['ignore', 'pipe', 'pipe'] });
}

module.exports = { ROOT, API_DIR, API_PROJECT, DLL, LEGACY, RETIRED, dotnetEnv, sdkVersion, NO_SDK, build, start };
