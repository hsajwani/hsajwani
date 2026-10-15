/* Deletes the test database and stored images (every CAD case, active and completed, with its ECGs and audit events),
   so the next start begins with no cases. The crew test user is recreated on start.
   Run it with the server stopped. While the server runs, use "Delete all test data" in the test console instead. */
const fs = require('node:fs');
const cfg = require('../server/config');

fetch(`http://127.0.0.1:${cfg.PORT}/api/ping`, { signal: AbortSignal.timeout(1500) })
  .then(() => {
    console.error(`The server is still running on port ${cfg.PORT}. Either use "Delete all test data" in the test console\n` +
      `(http://localhost:${cfg.PORT}/control) while it runs, or stop it first: npm run dev:stop (or Ctrl+C where npm start runs).`);
    process.exit(1);
  }, () => {
    for (const f of ['stemi-test.db', 'stemi-test.db-wal', 'stemi-test.db-shm']) fs.rmSync(`${cfg.DATA_DIR}/${f}`, { force: true });
    fs.rmSync(cfg.IMAGE_DIR, { recursive: true, force: true });
    console.log('Test data deleted. Start the server again with: npm run dev:bg');
  });
