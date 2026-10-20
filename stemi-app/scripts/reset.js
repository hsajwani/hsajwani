/* TEST ONLY: deletes the test database and the stored ECG images (every CAD case, active and completed, with its ECGs
   and audit events), so the next start begins with no cases. The database is rebuilt by the migrations on start and
   the crew test user is recreated. The crew test password and the session keys in data/ are kept.
   Run it with the server stopped. While the server runs, use "Delete all test data" in the test console instead.
   Never run it against anything but fictional test data. */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const PORT = Number(process.env.PORT || 3000);
const DATA = path.resolve(ROOT, process.env.DATA_DIR || 'data');

fetch(`http://127.0.0.1:${PORT}/api/ping`, { signal: AbortSignal.timeout(1500) })
  .then(() => {
    console.error(`The server is still running on port ${PORT}. Either use "Delete all test data" in the test console\n` +
      `(http://localhost:${PORT}/control) while it runs, or stop it first: npm run dev:stop`);
    process.exit(1);
  }, () => {
    for (const f of ['stemi-test.db', 'stemi-test.db-wal', 'stemi-test.db-shm']) fs.rmSync(path.join(DATA, f), { force: true });
    fs.rmSync(path.join(DATA, 'images'), { recursive: true, force: true });
    console.log(`Test data deleted (${DATA}). Start the server again with: npm run dev:bg`);
  });
