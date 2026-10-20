# Building, running and deploying · MASAR STEMI prototype 0.7.0

This is a prototype with fictional test data only. It is **not approved for real patient data** in any environment.
This page explains how to build, run, publish and host it, and what must be decided before production. The answers
are owned by IT and Information Security (see [production-gaps.md](production-gaps.md) and
[open-decisions.md](open-decisions.md)).

Related pages:
- [configuration.md](configuration.md): every setting.
- [database.md](database.md): the SQLite file and the migrations.
- [security.md](security.md): sessions, secrets and keys.
- [testing.md](testing.md): the tests and the IT handover quality gate.
- [troubleshooting.md](troubleshooting.md).
- [architecture.md](architecture.md): how the parts fit together.
- [handover.md](handover.md): the overview.

## Prerequisites

| To … | You need |
|---|---|
| Build, run from source, run the .NET tests | .NET 10 SDK. `global.json` asks for 10.0.100 or a later 10.0 feature band (`rollForward: latestFeature`). |
| Run a published build | ASP.NET Core Runtime 10 (the "ASP.NET Core Runtime" or "Hosting Bundle" download). The SDK is not needed. |
| Use the development runner (`npm run dev:*`) and the end-to-end tests (`npm run test:api` …) | Node.js 22.13 or later (`package.json` `engines`). No npm packages are installed: the scripts use the Node.js standard library only. |
| Run the browser test suites | Playwright with Chromium: `npm install -g playwright && npx playwright install chromium` |
| Restore NuGet packages (first build) | Access to nuget.org, or to an internal NuGet mirror configured in a `NuGet.config` (not included). Package versions are pinned in `Directory.Packages.props`. |
| Use the EF Core command-line tool | `dotnet tool restore` in `stemi-app/` (installs `dotnet-ef` 10.0.13 from `dotnet-tools.json`). |

### Installing the .NET 10 SDK

- **macOS:** the Arm64 (Apple silicon) or x64 installer from https://dotnet.microsoft.com/download/dotnet/10.0, or
  `brew install --cask dotnet-sdk`.
- **Windows:** the installer from the same page, or `winget install Microsoft.DotNet.SDK.10`.
- **Linux:** the distribution's package (for example `apt-get install dotnet-sdk-10.0` where Microsoft or the
  distribution publishes it), or the `dotnet-install` script. See the Linux page linked from the download page.

Check with `dotnet --version`, which should print 10.0.x. If the development runner does not find the SDK, it says so
and runs the legacy Node.js server instead (see [The transition from the Node.js prototype](#the-transition-from-the-nodejs-prototype)).

## Build and test

From `stemi-app/`:

```sh
dotnet build Masar.sln            # or: npm run build
dotnet test Masar.sln             # or: npm run test:unit   (unit and integration tests)
npm test                          # unit/integration tests, then every end-to-end suite except visual QA
```

The solution builds with `TreatWarningsAsErrors` (`Directory.Build.props`): a compiler warning fails the build. The
tests are described in [testing.md](testing.md).

## Run from source (development)

```sh
npm run dev:bg       # Local development server — DEVELOPMENT ONLY: build, start in the background, rebuild on change
npm run dev:status   # is it running, on which port, the addresses to open
npm run dev:stop
```

The development runner (`scripts/dev.js`) does the following:
- builds `src/Masar.Api`;
- starts it with `ASPNETCORE_ENVIRONMENT=Development`, using the repository's `public/` (screens) and `data/` (test
  database);
- rebuilds and restarts it when a backend file changes;
- writes its log to `.local/stemi-dev.log`.

The first start restores the NuGet packages and builds, which can take a minute or two.

Without the runner, `dotnet run --project src/Masar.Api` (or `npm start`) uses
`src/Masar.Api/Properties/launchSettings.json`, which also sets the Development environment.

The screens are then served at:

| Screen | Address |
|---|---|
| Crew MDT (login) | `http://localhost:3000/crew` |
| ER Doctor | `http://localhost:3000/er` |
| Cardiologist | `http://localhost:3000/cardiologist` (on a phone: `http://<this computer's IP>:3000/cardiologist`) |
| Test console — TEST ONLY | `http://localhost:3000/control` |

The crew test login is `crew@test.local`. Its password comes from configuration or from the generated file
`data/crew-test-password.txt` (see [configuration.md](configuration.md#prototype-prototype-only)). The start banner says
which one is used.

## Publish

```sh
dotnet publish src/Masar.Api -c Release -o <publish folder>
```

The result is a framework-dependent build: it needs the ASP.NET Core 10 runtime on the server. It contains:
- `Masar.Api.dll` and its dependencies;
- `appsettings.json` (and `appsettings.Development.json`, which a Production run does not read);
- `wwwroot/`: a copy of the repository's `public/` folder, made by the `Content` item in `src/Masar.Api/Masar.Api.csproj`;
- `runtimes/`: the native SQLite library for each platform;
- `web.config`, used only by IIS.

Self-contained builds (`-r <runtime id> --self-contained`) and single-file builds are possible with standard .NET
options. They are **not verified** in this repository.

### Run a published build

```sh
cd <publish folder>
ASPNETCORE_ENVIRONMENT=Production \
Storage__DataDirectory=/var/lib/masar-stemi \
Prototype__CrewTestUser__Password='<from the secret store>' \
dotnet Masar.Api.dll
```

On Windows PowerShell, set the variables with `$env:Storage__DataDirectory = '…'` first.

### The working directory

ASP.NET Core takes its **content root from the working directory**. Relative paths in configuration are resolved
against it: `Frontend:RootPath` (default `wwwroot`) and `Storage:DataDirectory` (default `data`). Start the process
with the publish folder as its working directory; IIS, a systemd unit's `WorkingDirectory=` and Azure App Service do
this when configured as usual. Otherwise the server stops at start with *The screens folder was not found* (see
[troubleshooting.md](troubleshooting.md)).

Put the data folder **outside** the publish folder with an absolute `Storage__DataDirectory`, so a redeployment never
replaces or deletes it.

### The endpoint

Kestrel listens where `Kestrel:Endpoints:Http:Url` says. The default is `http://0.0.0.0:3000`: plain HTTP on every
network interface, as the prototype needs for the iPhone on the local Wi-Fi.

- Behind a reverse proxy, listen on the loopback only: `Kestrel__Endpoints__Http__Url=http://127.0.0.1:5000`.
- Kestrel can also serve HTTPS itself with an `Https` endpoint and a certificate (`Kestrel:Endpoints:Https:Url`,
  `Kestrel:Endpoints:Https:Certificate:Path` / `:Password`, or a certificate store). This is standard ASP.NET Core
  configuration and is **not verified** in this repository.

## Hosting options for production (not verified here)

None of these has been set up or tested in this repository. They are the usual ways to host ASP.NET Core in a
Microsoft-oriented environment. The choice belongs to IT and Information Security
([open-decisions.md](open-decisions.md)). Whatever the choice, production needs HTTPS, approved hosting, the identity
provider, a production database decision, protected keys, central logging and backups
([production-gaps.md](production-gaps.md)).

| Option | Notes |
|---|---|
| **IIS on Windows Server** with the ASP.NET Core Module (Hosting Bundle) | Publish produces `web.config` (in-process hosting). Set the environment variables in the site's configuration or in `web.config`. Give the application pool identity write access to the data folder. Use one worker process (no web garden), and avoid overlapping recycles, so two copies never run at once (see [Single instance](#single-instance)). |
| **Azure App Service** (Windows or Linux) | Settings become application settings (environment variables). Storage needs care: the data folder must be on persistent storage, and SQLite on network storage is not recommended. A production database is expected instead (see [database.md](database.md)). Keep one instance. |
| **Linux with systemd** behind nginx, Apache or YARP | A systemd unit with `WorkingDirectory=<publish folder>`, `Environment=` lines (secrets from a protected environment file), a dedicated service account, and restart on failure. The proxy terminates TLS. |

Points for any reverse proxy:

- **Server-Sent Events.** `/api/stream` is a long-lived `text/event-stream` response. The proxy must not buffer it or
  compress it. The application sends `X-Accel-Buffering: no` for nginx. The proxy's read timeout must be longer than
  the heartbeat (`Live:HeartbeatMs`, 5 s).
- **Forwarded headers and Secure cookies.** The application does not call `UseForwardedHeaders`. Behind a
  TLS-terminating proxy it sees plain HTTP, so set `Sessions__RequireSecureCookies=true`: every session cookie is then
  marked `Secure` (`src/Masar.Api/Security/ScreenSessions.cs`). Forwarded headers (client address, scheme) for the
  known proxy remain a production gap ([production-gaps.md](production-gaps.md)).
- **Host names.** Set `AllowedHosts` to the real host names.

## The data folder

`Storage:DataDirectory` holds everything the server writes:

| Path | What | Notes |
|---|---|---|
| `stemi-test.db`, `-wal`, `-shm` | SQLite — PROTOTYPE DATABASE (write-ahead log mode) | [database.md](database.md) |
| `images/` | ECG image files (uploads and simulated corpuls ECGs) | Their SHA-256 is recorded in `ecg_images` |
| `keys/` | ASP.NET Core Data Protection key ring: protects the session cookies | Losing it signs every screen out; nothing else is lost |
| `crew-test-password.txt` | Generated crew test password (only when none is configured) | File mode 600 (not on Windows); never logged |

Rules for the data folder:
- It is **never committed** (`.gitignore` excludes `data/`).
- Only the service account needs read and write access to it.
- It holds fictional test data only in this build.
- Back it up as a whole, with the database copied consistently (see [database.md](database.md#backup)).

### Data Protection keys in production

At first start ASP.NET Core logs *No XML encryptor configured. Key … may be persisted to storage in unencrypted form.*
This is expected in the prototype: the key ring is plain XML in `{data folder}/keys`. Production must protect it:
- with a certificate (`ProtectKeysWithCertificate`);
- on Windows, with DPAPI;
- in Azure, by keeping the keys in Blob Storage protected with Key Vault.

Each option is a small change to `Program.cs`. The keys only protect the prototype's session cookies; they protect no
stored data.

## Database migrations

The server brings the database to the current schema **at every start** (`DatabaseInitializer` in
`src/Masar.Infrastructure/Persistence/`):
- A new, empty database is built by the EF Core migrations.
- A database created by the Node.js prototype is adopted without data loss.

No manual step is needed. To run the migrations explicitly, for example in a deployment pipeline:

```sh
dotnet tool restore
dotnet ef database update --project src/Masar.Infrastructure --startup-project src/Masar.Infrastructure \
  --connection "Data Source=/var/lib/masar-stemi/stemi-test.db"
```

Alternatively, build a self-contained migrations bundle (`dotnet ef migrations bundle …`) and run it on the server.
`dotnet ef database update` applies the migrations as written. It does **not** adopt a Node.js prototype database;
only the server's start-up does that. Details are in [database.md](database.md).

## Monitoring

- **Health:** `GET /health` answers without a login. It returns `status`, `app`, `environment`, `version`, `port`,
  `pid`, `startedAt` and `uptimeSeconds`, and nothing about cases, users or secrets. It is a liveness check: it does not
  test the database.
- **Logs:** structured console logging (`ILogger` message templates), with levels set by `Logging:LogLevel:*`.
  `Logging__Console__FormatterName=json` gives one JSON object per line for a collector. Routing logs to the
  organisation's logging platform is open: IT must choose the platform and the provider package.
- **The start banner** on standard output (addresses, data folder, providers, where the crew password came from) is
  for people, not for log parsing.
- **What is not logged:** passwords, cookies and patient data. The audit trail of the pathway is in the database
  (`audit_events`), not in the log.

## Single instance

The prototype must run as **exactly one process**:

- `PlatformGate` (`src/Masar.Application/Common/PlatformGate.cs`) serialises every change with an in-process lock.
- The live link (`src/Masar.Api/Live/LiveHub.cs`) keeps the open screens in memory and pushes each change at the end of
  that change.
- The Mock Corpuls Provider keeps its simulated monitors and timers in memory.
- SQLite is a single file.

Two processes on the same data folder would interleave their changes and miss each other's pushes. Load balancing or
scale-out needs a different design: a server database with row locking or a single writer, and a shared message bus
for the live link (see [architecture.md](architecture.md)).

## Before production

Do not deploy this build for real patients. As a minimum, the following must be decided and built (each item is
tracked in [production-gaps.md](production-gaps.md) and [open-decisions.md](open-decisions.md)):
- approved hosting with HTTPS;
- the organisation's identity provider in place of the prototype sessions and free-text names;
- a production database decision;
- protected Data Protection keys;
- central logging and monitoring;
- backup and retention;
- removing the test console (TEST ONLY);
- a real corpuls.mission provider (only after MEAD / corpuls supply the interface and approvals exist);
- a validated AI service, if any;
- Information Security review.

## The transition from the Node.js prototype

Versions up to 0.6.1 ran on Node.js (`server/`). From 0.7.0 the backend is ASP.NET Core; the screens are unchanged.

- **Existing test data is kept.** At its first start the .NET backend finds a prototype database (`data/stemi-test.db`
  with no migration history) and adopts it. Missing columns are added and the baseline migration is recorded. Cases,
  ECGs, images and the audit trail are untouched.
- **The legacy Node.js server** (`server/`, LEGACY) stays for the transition. The development runner uses it
  automatically when the .NET SDK is missing, or on request (`npm run dev:bg -- --legacy`, or `STEMI_BACKEND=node` in
  `.env`). `npm run start:legacy` starts it directly. It is to be removed in a later version.

Breaking changes:
- **The .NET 10 SDK is needed** to run the backend from source.
- **Every screen's session ends once.** The cookie format changed, so screens reload and the crew logs in again.
  Switching between the two backends does the same each time.
- **The crew test password is no longer built in.** The old default is removed. Set `TEST_USER_PASSWORD` in `.env`
  (or `Prototype__CrewTestUser__Password`), or use the generated `data/crew-test-password.txt`. Both backends use the
  same source. Each re-hashes the password in its own format at start, so either backend accepts the same password.
- **`SESSION_SECRET` is no longer used** (see [configuration.md](configuration.md#retired-settings)).
- **`/health` reports `"production"`** where the prototype reported `"standard"` outside development.
