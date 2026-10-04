# Working in this repository

The STEMI test application lives in `stemi-app/` (Node.js 22, no dependencies). See `stemi-app/README.md`.

## Keep the local STEMI development server running

The user tests on their Mac (crew at `http://localhost:3000/crew`) and iPhone (`http://<Mac IP>:3000/cardiologist`)
with the development runner (`stemi-app/scripts/dev.js`). For every STEMI development task:

1. Check it first: `cd stemi-app && npm run dev:status`. If it is not running, start it with `npm run dev:bg`.
2. If it is running, leave it running. Do not stop it at the end of a task, and do not tell the user to run `npm start`.
3. Make the change. Backend changes (`server/`, `public/shared/cad.js`, `package.json`, `.env`) restart the server by
   themselves; screen changes in `public/` need only a browser refresh.
4. Run the relevant tests: `npm run test:acceptance`, `npm run test:pathway`, `npm run test:cad` (Playwright; in the
   cloud container `NODE_PATH=$(npm root -g)`). They use their own random ports and temporary databases and do not
   touch the development server or `data/`.
5. Confirm the development server answers again: `npm run dev:status` (or `curl -s localhost:3000/health`).
6. Never delete or reset `data/` (the test database) unless the user asks.

Only ask the user to restart something manually if it genuinely cannot be done automatically.
Note: a Claude Code cloud session runs in its own container, not on the user's Mac. Changes reach the Mac through
GitHub: `git pull`, or automatically when the user has `DEV_AUTO_PULL=true` in `stemi-app/.env`.
