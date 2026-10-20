# Testing · MASAR STEMI prototype 0.7.0

The critical pathway behaviour is covered at three levels:

1. **.NET unit tests** test the rules and the services directly.
2. **.NET integration tests** test the HTTP pipeline in memory.
3. **End-to-end suites** drive the real server and the real screens in a browser.

Every test uses fictional data and its own temporary database. No test touches `data/` or the running development
server.

## Commands

From `stemi-app/`:

| Command | What runs | Needs |
|---|---|---|
| `dotnet test Masar.sln` (or `npm run test:unit`) | `tests/Masar.UnitTests` and `tests/Masar.IntegrationTests` | .NET 10 SDK |
| `npm run test:api` | End-to-end API rules, no browser | .NET 10 SDK, Node.js 22 |
| `npm run test:demo` · `test:corpuls` · `test:acceptance` · `test:pathway` · `test:cad` | End-to-end browser suites | the above + Playwright with Chromium |
| `npm run test:visual` | Visual QA of every major screen (screenshots + automatic checks) | the above |
| `npm test` | `test:unit`, then `test:api`, `test:demo`, `test:corpuls`, `test:acceptance`, `test:pathway`, `test:cad`, stopping at the first failure | everything above |

To install Playwright: `npm install -g playwright && npx playwright install chromium`. The suites load it from the
global Node.js modules. Where Node.js does not search the global modules (for example the cloud development container),
run them with `NODE_PATH=$(npm root -g)` in front, for example `NODE_PATH=$(npm root -g) npm run test:acceptance`.

Run the end-to-end suites **one after another** (as `npm test` does), not in parallel. Each suite builds the backend
when it starts, and two builds of the same project at once can collide.

## Current results (0.7.0)

| Suite | Result |
|---|---|
| Masar.UnitTests | 91 / 91 |
| Masar.IntegrationTests | 10 / 10 |
| `test:api` | 88 / 88 checks |
| `test:demo` | 28 / 28 |
| `test:corpuls` | 71 / 71 |
| `test:acceptance` | 50 / 50 |
| `test:pathway` | 38 / 38 |
| `test:cad` | 30 / 30 |
| `test:visual` | 123 / 123 |

## .NET unit tests (`tests/Masar.UnitTests`)

xUnit. The application and infrastructure services are wired exactly as in the host (`AddMasarApplication`,
`AddMasarInfrastructure`) by `TestPlatform.cs`, with these differences:
- a temporary SQLite database;
- the Mock Corpuls Provider's demo mode off;
- a short mock-AI delay;
- a test crew password given through configuration;
- a live link that only records what it was told to push.

| File | Covers |
|---|---|
| `Domain/PathwayStateMachineTests.cs` | Every derived state of the STEMI pathway; repeat ECG requested / received; the three closed states and their stored reasons; cases made before the ER step (legacy); **closed-case immutability for every role and every changing action**; what stays allowed on a closed case (viewing, acknowledgements); the crew cannot add to an unsent draft; the ER Doctor accepts first and assesses once; nothing reaches the Cardiologist before activation; the Cardiologist acknowledges before deciding; the test console records no clinical action. |
| `Domain/RulesTests.cs` | CAD number normalisation and refusal messages; clinician-name rules; NOT SUSPICIOUS FOR STEMI reasons and OTHER's explanation; free-text cleaning and length limits. |
| `Infrastructure/MockProvidersTests.cs` | Simulated AI Interpretation — PROTOTYPE ONLY: status by image quality, "unavailable" never reported as a finding, every result marked simulated, serial comparison. The fictional ECG drawing: sample → pattern, heart-rate clamping, the FICTIONAL TEST DATA marking, deterministic output. The snake_case column mapping. |
| `Infrastructure/DatabaseTests.cs` | **Migrations from a clean database.** Every table and column of the model exists, and there are no pending model changes (`HasPendingModelChanges`). **A database created by the Node.js prototype** is adopted with its data, and the result has exactly the schema of a clean database. An older prototype database (0.4) gets the newer columns and its legacy case still opens correctly. |
| `Application/PathwayServiceTests.cs` | End to end through the services: the complete pathway crew → ER → Cardiologist → completed, with its audit entries; a closed case refuses every change on the server and writes no audit; NOT SUSPICIOUS needs a reason and closes without activating cardiology; a decision must cover the latest ECG, and NOT STEMI closes the pathway; a resent action is stored once; one case per CAD number; CAD correction before SEND, locked after SEND; ECGs from the simulated corpuls feed are numbered and stored once, and late data after a discard is refused. |

## .NET integration tests (`tests/Masar.IntegrationTests`)

`MasarApiFactory` runs the real ASP.NET Core application in memory (`WebApplicationFactory<Program>`) with these
settings:
- environment `Testing`;
- a temporary data folder;
- the repository's `public/` screens;
- demo mode off;
- a test crew password given through configuration.

`ApiTests.cs` covers the following:
- `/health` reveals nothing and reports the version;
- the configured data folder is used;
- pages carry their role and give device screens a prototype session;
- `/crew` redirects to the login;
- the crew login accepts only the configured password;
- the API's 401 messages;
- each screen may do only its own actions (403);
- a case is created once, is invisible to the ER until SEND, and the ER sees the manual-fallback ECG after SEND;
- only JPEG or PNG uploads are accepted;
- the live stream starts with `init`, `cfg`, `cases`;
- malformed JSON gets `400 Bad JSON`.

## End-to-end suites (`scripts/*.js`)

These are Node.js scripts. They use only the standard library plus Playwright for the browser.

`scripts/lib/harness.js` does the following for each suite:
- builds the backend once (`dotnet build`) and starts the built `src/Masar.Api` on a random port, with
  `ASPNETCORE_ENVIRONMENT=Production`, a temporary data folder and a random crew password for the run;
- translates the prototype setting names a suite passes (for example `CORPULS_DEMO_MODE: 'false'`) to the .NET keys
  (`scripts/lib/dotnet.js`);
- reads the SQLite file directly to check what was stored and audited;
- stops the server and deletes the folder at the end.

| Suite | Covers |
|---|---|
| `api-test.js` | The platform's rules through the API alone. It checks every transition the pathway allows and every one it must refuse; closed cases are read-only; the Cardiologist sees nothing before the ER activates cardiology; clinician names are validated and recorded per CAD number; roles are kept apart; a 0.4.0-style case still opens; the data survives a restart. |
| `demo-test.js` | The prototype demo mode of the simulated corpuls feed (Mock Corpuls Provider — PROTOTYPE ONLY). LINK CORPULS leads to CONNECTED, live values and ECG 1, all automatic. It also covers SEND; the manual fallback staying quiet while connected and becoming prominent on connection loss; a repeat ECG simulated from the crew screen and arriving from corpuls; a closed case accepting no automatic events; RESET CORPULS DEMO; discarding an unsent case. |
| `corpuls-test.js` | The simulated corpuls integration end to end, with demo mode off, driven by the test console's CORPULS SIMULATOR (TEST ONLY): link, live vitals, ECG 1, SEND, the ER and Cardiologist workflows, repeat ECGs 2 and 3, connection loss and reconnection without duplicates, the manual ECG fallback, closed cases, duplicate CAD numbers, paused data (freshness), signal loss with an ECG held on the monitor, a server restart, and the `corpuls-mission` placeholder provider. |
| `acceptance.js` | The whole pathway on three screens at once: crew tablet, ER desktop and Cardiologist phone. Crew SEND, ER accept with a name, ACTIVATE, Cardiologist acknowledge with a name, repeat ECG, CONFIRMED STEMI, COMPLETE STEMI PATHWAY; nothing reaches the Cardiologist before the ER; everything arrives without a refresh; the alarms sound only for a new case or activation, until accepted. |
| `pathway-test.js` | The other ways through the pathway on the ER and Cardiologist screens: UNCERTAIN; NOT SUSPICIOUS FOR STEMI needs a reason and closes the screening pathway; OTHER needs an explanation; NOT STEMI closes automatically; each CAD number records its own ER Doctor and Cardiologist. |
| `cad-entry-test.js` | Manual CAD number entry: normalisation and refusal; the unsent case; correction before SEND; CASE ALREADY EXISTS and OPEN EXISTING CASE; reload, discard, and the CAD number locked after SEND; working offline (the case is created and sent on reconnection, and an offline update keeps both times in the audit). |
| `visual-qa.js` | Every major screen at realistic sizes, with screenshots in `scripts/out/visual/` (git-ignored). It checks that there is no horizontal overflow, no control smaller than 40 × 40 px, and that every image and control has an accessible name. |

Each suite prints one `PASS` / `FAIL` line per check and a summary. It exits non-zero on any failure. Screenshots go
to `scripts/out/`.

### Comparing with the legacy Node.js server

`STEMI_BACKEND=node npm run test:api` (or any suite) runs it against the LEGACY Node.js server (`server/`) instead of
the .NET backend. This was used to prove that the ASP.NET Core port behaves the same. The legacy server is kept only
for the transition ([deployment.md](deployment.md#the-transition-from-the-nodejs-prototype)).

## Rules for changes

- **Never remove, skip or weaken a test to make a build pass.** A failing test is a defect to fix, or a deliberate
  behaviour change. A behaviour change needs the test updated in the same change, with the reason in the commit and
  in the docs.
- Every change to a pathway rule, the state machine, closed-case immutability, the audit texts or the corpuls rules
  needs a test: a unit test for the rule, and an end-to-end check where a screen depends on it.
- A schema change needs a migration. The database tests must still pass on a clean database and on an adopted
  prototype database ([database.md](database.md#adding-a-migration)).
- After a screen change, run `npm run test:visual` and look at the screenshots.
- Tests never use real patient data, never touch `data/` and never stop or restart the development server.

## IT handover quality gate

Before a major version is complete:

| # | Check | How |
|---|---|---|
| 1 | The solution builds | `dotnet build Masar.sln`: warnings are errors |
| 2 | The automated tests pass | `dotnet test Masar.sln`; `npm test`; `npm run test:visual` after screen changes |
| 3 | Migrations work from a clean database | `DatabaseTests` (unit tests) apply every migration to an empty database. Manually, start the server with an empty `Storage__DataDirectory`. |
| 4 | Configuration is documented | Every key in `appsettings*.json` and the options classes is in [configuration.md](configuration.md) |
| 5 | No secrets are committed | `git ls-files` shows no `.env`, no `data/`, no `*.db`. Check that `git grep -n -i -E "password\|secret\|api[_-]?key\|token" -- . ':!docs' ':!*.md'` finds only names of settings, never values. |
| 6 | README, architecture and handover docs are current | [handover.md](handover.md), [architecture.md](architecture.md), `README.md`, and the pages this change touches |
| 7 | Prototype-only features are labelled | Mock Corpuls Provider, Simulated AI Interpretation, free-text clinician names, SQLite, the development server, the test console (each labelled in code comments and docs) |
| 8 | External dependencies are documented | [deployment.md](deployment.md#prerequisites); packages pinned in `Directory.Packages.props` and `dotnet-tools.json` |
| 9 | The application starts from the documented instructions alone | On a clean checkout, follow [deployment.md](deployment.md). There must be no dependency on the original developer's machine or accounts. |
