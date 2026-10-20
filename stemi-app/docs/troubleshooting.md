# Troubleshooting · MASAR STEMI prototype 0.7.0

Symptom → cause → fix.

The first places to look:
- the development runner's log, `.local/stemi-dev.log` (`npm run dev:status` shows its path);
- the server's console output;
- `GET /health`.

Related pages: [deployment.md](deployment.md), [configuration.md](configuration.md), [database.md](database.md).

## Starting the server

| Symptom | Cause | Fix |
|---|---|---|
| The runner logs *backend: LEGACY Node.js server … The .NET 10 SDK is needed …* | The .NET 10 SDK is not installed or not on the `PATH`. A newer major version alone (for example .NET 11) does not count: `global.json` asks for a 10.0 SDK. The runner falls back to the legacy Node.js server so the screens keep working. | Install the .NET 10 SDK ([deployment.md](deployment.md#installing-the-net-10-sdk)), check `dotnet --version` in `stemi-app/`, then `npm run dev:restart`. |
| `dotnet build` stops with *A compatible .NET SDK was not found* and *Requested SDK version: 10.0.100* | Only another major SDK version is installed. `global.json` accepts 10.0.100 or any later 10.0 SDK, so every machine builds with the same SDK family. | Install the .NET 10 SDK beside the other one (SDKs install side by side). `dotnet --list-sdks` then shows a 10.0.x entry. Keep `global.json`: moving to a new .NET version is a deliberate change (update `global.json`, the target framework and the packages together, then run every test suite). |
| `Port 3000 is used by another program. Nothing was stopped.` | Another program listens on the port. | Close it, or set another `PORT` in `.env` (another `Kestrel__Endpoints__Http__Url` outside the runner). The runner never stops a process it did not start. |
| `A STEMI server is already running on port 3000 but was not started by the development runner` | A server started another way (`npm start`, `dotnet run`) holds the port. | Stop that one (Ctrl+C in its terminal), then `npm run dev:bg`. |
| `the build failed: waiting for a file change before trying again` | A compile error. Warnings count as errors (`TreatWarningsAsErrors`). | Read the errors above that line in `.local/stemi-dev.log`, or run `dotnet build Masar.sln`. Saving the fix restarts the build. |
| `Started … but /health did not answer within 5 minutes` | The first build is still restoring packages (no access to nuget.org?), or the server stops at start. | Look at `.local/stemi-dev.log`. Check the network access to nuget.org or the internal NuGet mirror. |
| `it stopped 5 times in a row right after starting: waiting for a file change` | The server fails at start every time. | The cause is in the log just above: configuration, the screens folder, or the database (below). |
| *The screens folder was not found: … (Frontend:RootPath)* | `Frontend:RootPath` points nowhere. A published build was started from another working directory, or `wwwroot` is missing. | Start the published build from its own folder ([deployment.md](deployment.md#the-working-directory)), or set `Frontend__RootPath` to an absolute path. In development, `appsettings.Development.json` points at `../../public`. |
| *Unknown Corpuls:Provider* / *Unknown Ai:Provider* | A misspelt provider. | `Corpuls:Provider` is `mock` or `corpuls-mission`. `Ai:Provider` is `mock`. |
| `warn: … XmlKeyManager … No XML encryptor configured` | Expected in the prototype: the session-cookie keys are stored as plain XML in `{data}/keys`. | Nothing to do for fictional data. Production protects the keys ([deployment.md](deployment.md#data-protection-keys-in-production)). |

## Database

| Symptom | Cause | Fix |
|---|---|---|
| *The model for context 'MasarDbContext' has pending changes* at start | An entity or the mapping changed without a migration. | Add a migration ([database.md](database.md#adding-a-migration)). The unit test `DatabaseTests` reports this too. |
| *database is locked* / a request hangs for 30 s, then fails | Another process holds a write lock on the SQLite file: a second server on the same data folder, or a tool with an open write transaction. | Run one server per data folder ([deployment.md](deployment.md#single-instance)) and close the other tool. Do not put the database on a network share. |
| *no such table* or *no such column* errors | The database was changed by hand, or a migration was skipped. | Stop the server, back up the data folder, then start again: the migrations run at start. For test data you can start from nothing with `npm run reset`. |
| Log line *Database created by the Node.js prototype found: …* | The first .NET start on a database created by the Node.js prototype. | Expected, once. The data is kept ([database.md](database.md#what-happens-at-start)). |
| You need an empty test database | — | While the server runs: the test console's "Delete all test data" (TEST ONLY). With the server stopped: `npm run reset` (TEST ONLY), then `npm run dev:bg`. Never on anything but fictional test data. |

## Signing in

| Symptom | Cause | Fix |
|---|---|---|
| Crew login: *Email or password not recognised* | The password is not the one configured. It comes from `Prototype:CrewTestUser:Password` (`TEST_USER_PASSWORD` in `.env`), or from the generated `data/crew-test-password.txt`. The start banner says which. | Use the password from the source the banner names. Each start re-applies it to the account. The prototype's old built-in default no longer exists. |
| Every screen asks to log in again, or reloads, after the upgrade to 0.7.0 | The session cookies changed format (ASP.NET Core Data Protection). Switching between the .NET and the legacy Node.js backends does the same each time. | Expected once. The crew logs in again; the ER, Cardiologist and test console screens reload and get a new session. |
| Every screen is signed out after the data folder was moved or replaced | The session keys live in `{data}/keys`. | Expected. Keep `keys/` with the data folder. |
| ER or Cardiologist API calls get *No session for this screen: reload the page* | The browser has no device session for that role (cookies cleared, or it expired after 30 days). | Reload the page: it starts a new prototype device session. |

## Screens and the live link

| Symptom | Cause | Fix |
|---|---|---|
| A screen shows CONNECTION LOST | No event arrived on `/api/stream` for 12 s (the heartbeat is every `Live:HeartbeatMs`, 5 s): the server stopped or restarted, or the network or a proxy holds the stream back. | Check `npm run dev:status` or `/health`. Behind a proxy, turn off response buffering and compression for `text/event-stream`, and make the read timeout longer than the heartbeat ([deployment.md](deployment.md#hosting-options-for-production-not-verified-here)). The screens reconnect by themselves. |
| The iPhone cannot open `http://<Mac IP>:3000/cardiologist` | The server listens only on localhost, the phone is on another network, or the Mac's firewall blocks incoming connections. | Keep `HOST=0.0.0.0` (or `Kestrel__Endpoints__Http__Url=http://0.0.0.0:3000`). Put both devices on the same Wi-Fi. Allow incoming connections for `dotnet` in the macOS firewall. `npm run dev:status` prints the address to open. |
| A screen change does not appear | The browser shows the old file. | Refresh the page. Screens are read from disk on every request. Backend changes rebuild by themselves under the runner. |
| A sound does not play on the ER or Cardiologist screen | Browsers allow sound only after a tap. | Press **START · ENABLE ALARM SOUND** on the screen's start page. The production alarm requirements are in [production-gaps.md](production-gaps.md). |

## Simulated corpuls feed and AI (PROTOTYPE ONLY)

| Symptom | Cause | Fix |
|---|---|---|
| After LINK CORPULS the monitor never connects (CORPULS NOT CONNECTED after 15 s) | `Corpuls:Provider` is `corpuls-mission`, the placeholder that never connects. Or the simulated monitor was disconnected in the test console. | Use `Corpuls:Provider=mock`. In the test console's CORPULS SIMULATOR (TEST ONLY) press CONNECT MONITOR, or RESET CORPULS DEMO. |
| Connected, but ECG 1 does not arrive by itself | Demo mode is off (`Corpuls:DemoMode=false`, `CORPULS_DEMO_MODE=false`), or the case already had an ECG. | Turn demo mode on, or trigger the ECG in the CORPULS SIMULATOR. |
| Vital signs stop and LAST DATA RECEIVED appears | The simulated data was paused, or the signal lost, in the test console. | Press RESUME DATA or RESTORE SIGNAL in the CORPULS SIMULATOR. |
| The AI analysis stays at "processing" | The test console's **Mock AI** setting is *Stays processing*. It holds every analysis, by design. | Set **Mock AI** back to *Completes* in the test console: held analyses then finish. |
| The AI says *unavailable* | The test console's **Mock AI** setting is *Unavailable*. | Set it back to *Completes*. A new ECG then gets a normal analysis. |

## Tests

| Symptom | Cause | Fix |
|---|---|---|
| *Playwright is not installed* | The browser suites need Playwright with Chromium. | `npm install -g playwright && npx playwright install chromium`. In the cloud container prefix the command with `NODE_PATH=$(npm root -g)`. |
| *The test server did not start* followed by build output | The harness's `dotnet build` failed. | Fix the build (`dotnet build Masar.sln`). |
| Random build errors when several suites run at once | Two suites building the same project in parallel. | Run the suites one after another (`npm test` does). |
| A suite fails only against the .NET backend | A difference from the legacy behaviour. | Compare with `STEMI_BACKEND=node npm run test:<suite>` ([testing.md](testing.md#comparing-with-the-legacy-nodejs-server)). |

## The legacy Node.js server

The legacy Node.js server (`server/`, LEGACY) runs only as the transition fallback:
- automatically when the .NET SDK is missing;
- with `npm run dev:bg -- --legacy`;
- with `STEMI_BACKEND=node` in `.env`;
- directly with `npm run start:legacy`.

`npm run dev:status` says which backend runs. To return to the ASP.NET Core backend, remove `STEMI_BACKEND` from
`.env` (or install the .NET SDK), then run `npm run dev:restart`.

Both backends use the same `data/` folder, the same database and the same crew password source. Each switch signs
every screen out once, because the cookie formats differ.
