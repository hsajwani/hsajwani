# Working in this repository

MASAR — the STEMI Coordination Platform prototype — lives in `stemi-app/`:

- **Backend:** ASP.NET Core / C# on .NET 10 (`stemi-app/Masar.sln`). The projects are `src/Masar.Domain` (state
  machine, clinical rules), `src/Masar.Application` (use cases), `src/Masar.Infrastructure` (EF Core + SQLite, providers)
  and `src/Masar.Api` (controllers, live link, sessions).
- **Screens:** plain HTML, CSS and JavaScript in `stemi-app/public/`.
- **Tests:** `stemi-app/tests/` (xUnit) and `stemi-app/scripts/*.js` (end-to-end, Node.js 22 + Playwright).
- **Legacy:** `stemi-app/server/` is the LEGACY Node.js server, kept only as a transition fallback. Do not develop there.

Start with `stemi-app/README.md` and `stemi-app/docs/handover.md`.

## Keep the local STEMI development server running

The user tests on their Mac with the development runner (`stemi-app/scripts/dev.js`, DEVELOPMENT ONLY):

- crew: `http://localhost:3000/crew`
- ER Doctor: `http://localhost:3000/er`
- test console: `http://localhost:3000/control`
- iPhone: `http://<Mac IP>:3000/cardiologist`

For every STEMI development task:

1. Check it first: `cd stemi-app && npm run dev:status`. If it is not running, start it with `npm run dev:bg`.
2. If it is running, leave it running. Do not stop it at the end of a task, and do not tell the user to run `npm start`.
3. Make the change.
   - Backend changes rebuild and restart the server by themselves: the `.cs`, `.csproj` and `appsettings*.json` files
     under `src/`, `Directory.*.props`, `global.json`, `.env`.
   - Screen changes in `public/` need only a browser refresh.
   - `public/shared/cad.js` and `rules.js` are browser copies of the C# rules in `src/Masar.Domain/Rules`: change both
     together.
4. Run the relevant tests:
   - `npm run test:unit` (`dotnet test Masar.sln`)
   - `npm run test:api` (no browser)
   - `npm run test:demo`, `npm run test:corpuls`, `npm run test:acceptance`, `npm run test:pathway`, `npm run test:cad`
   - `npm run test:visual` after screen changes

   The browser suites need Playwright; in the cloud container use `NODE_PATH=$(npm root -g)`. The end-to-end suites
   build the backend and use their own random ports, temporary databases and a random crew password. They do not touch
   the development server or `data/`.
5. Confirm the development server answers again: `npm run dev:status` (or `curl -s localhost:3000/health`).
6. Never delete or reset `data/` (the test database) unless the user asks.

### The simulated corpuls feed

The ECGs and vital signs come from a **simulated** corpuls feed (`MockCorpulsProvider`, Mock Corpuls Provider —
PROTOTYPE ONLY):

- **Provider:** `src/Masar.Infrastructure/Corpuls/`, behind `ICorpulsProvider` in `src/Masar.Application/Monitoring/`.
- **Demo mode** (`Corpuls:DemoMode`, `.env` `CORPULS_DEMO_MODE`, the default): LINK CORPULS connects, sends live values
  and ECG 1 by itself.
- **Test console:** its CORPULS SIMULATOR (`/control`) is for the advanced demonstration.
- **No real corpuls.mission is connected.** Never add real network calls or vendor API details without a supported,
  approved interface (see `stemi-app/docs/corpuls-integration.md`).

### Restarts and the user's Mac

Only ask the user to restart something manually if it genuinely cannot be done automatically.

A Claude Code cloud session runs in its own container, not on the user's Mac. Changes reach the Mac through GitHub:
`git pull`, or automatically when the user has `DEV_AUTO_PULL=true` in `stemi-app/.env`. The Mac needs the .NET 10 SDK;
without it the runner falls back to the legacy Node.js server.

## IT handover requirements (standing instructions)

The project may be handed over to the National Ambulance IT Department. They must be able to take ownership without
reverse-engineering anything.

### Technology

- C# and ASP.NET Core for the backend. Standard HTML, CSS and JavaScript for the frontend unless there is a clear
  technical reason to change.
- Conventional, well-structured .NET architecture (Domain / Application / Infrastructure / Api). Technologies an
  enterprise Microsoft-oriented IT team can support.
- No unnecessary custom frameworks, obscure dependencies or overly clever abstractions.

### Code

- Readable, modular code with clear names for services, controllers, models, DTOs, entities and integration
  components.
- Clinical workflow logic stays separate from UI logic. Clinical workflow rules, the STEMI state machine and closed-case
  immutability are enforced on the backend, not only in the browser.
- Corpuls stays behind the replaceable `ICorpulsProvider` interface. Simulated/test providers are kept clearly apart
  from future production providers.
- Comment where an IT developer needs to know **why**: a clinical rule, a restricted transition, retained data, a
  provider abstraction, a security control, or prototype behaviour that must be replaced before production. Do not
  comment the obvious. Comments are not a substitute for documentation.

### Configuration and security

- No environment-specific values hard-coded. Configuration goes through standard .NET configuration and environment
  settings.
- Never put passwords, secrets, API keys or credentials in source code or in git.
- Structured logging (`ILogger` message templates). Never log passwords, secrets, tokens or patient information.
- Preserve auditability: every significant pathway event is audited. Do not flood the audit with technical heartbeats
  or routine vital-sign samples.

### Database and tests

- Database changes are EF Core migrations, documented and reproducible from a clean database. Never edit
  `InitialSchemaSql.cs`; see `docs/database.md`.
- Maintain automated tests for all critical pathway behaviour. Never remove or weaken a test to make a build pass.

### API and compatibility

- Keep API contracts explicit and documented (`docs/api.md`).
- Preserve backward compatibility where reasonable. Document breaking changes.

### Documentation

Keep the documentation current after every major update. It lives in `stemi-app/docs/`:

- `handover.md`, `architecture.md`, `api.md`, `clinical-workflow.md`
- `deployment.md`, `configuration.md`, `database.md`, `security.md`
- `corpuls-integration.md`, `testing.md`, `troubleshooting.md`
- `open-decisions.md`, `production-gaps.md`, `adr/`

Also keep `README.md` current. Specifically:

- Update the architecture diagrams when major components change.
- Document all routes, services, integrations, database tables, background processes and external dependencies.
- Document how to build, run, test, configure, deploy and troubleshoot.
- Document every assumption that needs confirmation from MEAD, Corpuls, hospitals, Clinical Governance, Information
  Security, IT or the MASAR programme.

### Production readiness labels

Clearly distinguish prototype/simulated functionality from production-ready functionality, with explicit labels:

| Component | Label |
|---|---|
| Mock Corpuls Provider | PROTOTYPE ONLY |
| Simulated AI Interpretation | PROTOTYPE ONLY |
| Free-text ER Doctor Name | PROTOTYPE ONLY |
| Free-text Cardiologist Name | PROTOTYPE ONLY |
| Crew test login and device sessions | PROTOTYPE ONLY |
| Test console | TEST ONLY |
| SQLite | PROTOTYPE DATABASE unless approved for production |
| Local development server | DEVELOPMENT ONLY |

- Never present mock Corpuls integration, mock AI or free-text clinician identification as production-grade.
- Production identity must be designed for approved organisational authentication (SSO such as Microsoft Entra ID,
  staff ID or another approved mechanism).

### Deployability

- The system must be deployable without depending on the original developer's computer or personal accounts.
- No undocumented manual setup steps. Prefer repeatable scripts and configuration.
- A competent IT developer must be able to clone, read the docs, configure, run the database, start the application
  and run the tests without help.

### Quality gate (before any major version is complete)

- The solution builds and every automated test passes.
- Migrations work from a clean database.
- Configuration is documented and no secrets are committed.
- README, architecture and handover docs are current.
- Prototype-only features are labelled and external dependencies are documented.
- The app starts from the documented instructions with no undocumented dependency on the original developer's
  machine.
