# Configuration · MASAR STEMI prototype 0.7.0

The backend (`src/Masar.Api`) uses standard ASP.NET Core configuration. Nothing environment-specific is hard-coded:
ports, folders, providers, timings and the crew test password all come from configuration. This page lists every key.
For building and running, see [deployment.md](deployment.md). For the security of secrets, see
[security.md](security.md).

## Where configuration comes from

ASP.NET Core reads these sources in order; a later source overrides an earlier one:

1. `src/Masar.Api/appsettings.json`: the defaults, committed, with no secrets.
2. `src/Masar.Api/appsettings.{Environment}.json`. Only `appsettings.Development.json` exists.
3. User secrets, in the Development environment only (`UserSecretsId` `masar-stemi-prototype` in
   `src/Masar.Api/Masar.Api.csproj`).
4. Environment variables. A key's sections are joined with a double underscore: `Corpuls:DemoMode` becomes
   `Corpuls__DemoMode`.
5. Command-line arguments, for example `dotnet Masar.Api.dll --Corpuls:DemoMode=false`.

The options classes that bind these sections are:
- `src/Masar.Api/Configuration/ApiOptions.cs`: `FrontendOptions`, `PrototypeSessionOptions` and `LiveOptions`.
- `src/Masar.Infrastructure/Configuration/StorageOptions.cs`, `AiOptions.cs`, `CorpulsOptions.cs` and
  `PrototypeOptions.cs`.

## Environments

The environment is set with `ASPNETCORE_ENVIRONMENT`.

| Environment | Who uses it | Files read |
|---|---|---|
| `Development` | The development runner (`npm run dev`, `npm run dev:bg`; `scripts/dev.js` sets it) and `dotnet run --project src/Masar.Api` (`src/Masar.Api/Properties/launchSettings.json`) | `appsettings.json`, `appsettings.Development.json`, user secrets |
| `Production` | A published deployment (the default when the variable is not set). The end-to-end test harness (`scripts/lib/harness.js`) also uses it, with environment-variable overrides. | `appsettings.json` |
| `Testing` | The integration tests (`tests/Masar.IntegrationTests/MasarApiFactory.cs`), with in-memory overrides | `appsettings.json` |

`appsettings.Development.json` points the screens and the data folder at the repository: `Frontend:RootPath` is
`../../public` and `Storage:DataDirectory` is `../../data`, both relative to `src/Masar.Api`. It also logs the live
link's connections (`Masar.Api.Live` at `Debug`).

`GET /health` reports `"environment": "development"` in Development. Any other environment is reported in lower case,
for example `"production"`. The Node.js prototype reported `"standard"` instead of `"production"`.

## Every key

Relative paths are resolved against the content root. That is the application's working directory: `src/Masar.Api`
in development, the publish folder in a deployment (see [deployment.md](deployment.md#the-working-directory)).

The Legacy `.env` column is the prototype setting name that the development runner and the test harness translate to
the key (see [The development runner's `.env`](#the-development-runners-env)).

### Kestrel, hosting and logging

| Key | Default | Environment variable | Legacy `.env` | Meaning |
|---|---|---|---|---|
| `Kestrel:Endpoints:Http:Url` | `http://0.0.0.0:3000` | `Kestrel__Endpoints__Http__Url` | `HOST` + `PORT` | Where the server listens. `0.0.0.0` makes it reachable from other devices on the network (needed for the iPhone in the prototype). Behind a reverse proxy use `http://127.0.0.1:<port>`. |
| `AllowedHosts` | `*` | `AllowedHosts` | — | ASP.NET Core host filtering. `*` accepts any host name. Production should list the real host names (see [security.md](security.md)). |
| `Logging:LogLevel:Default` | `Information` | `Logging__LogLevel__Default` | — | Minimum level of the application's structured log. |
| `Logging:LogLevel:Microsoft.AspNetCore` | `Warning` | `Logging__LogLevel__Microsoft.AspNetCore` | — | Framework request logging. |
| `Logging:LogLevel:Microsoft.EntityFrameworkCore` | `Warning` | `Logging__LogLevel__Microsoft.EntityFrameworkCore` | — | `Information` shows every SQL command (diagnosis only). |
| `Logging:LogLevel:Masar.Api.Live` | `Debug` in Development only | `Logging__LogLevel__Masar.Api.Live` | — | Live link connected / disconnected messages. |

To get JSON log lines for a log collector, use the console logger's built-in JSON formatter:
`Logging__Console__FormatterName=json`.

The server is reached at the URL in `Kestrel:Endpoints:Http:Url`. `/health` reports the port it actually listens on.

### Storage

| Key | Default | Environment variable | Legacy `.env` | Meaning |
|---|---|---|---|---|
| `Storage:DataDirectory` | `data` (Development: `../../data`) | `Storage__DataDirectory` | `DATA_DIR` (resolved against `stemi-app/`) | The data folder. It holds the SQLite database, `images/` (ECG image files), `keys/` (the session-cookie keys) and `crew-test-password.txt` when a password is generated. It is created if missing. |
| `Storage:DatabaseFileName` | `stemi-test.db` | `Storage__DatabaseFileName` | — | The SQLite file inside the data folder. The prototype's file name is kept so an existing test database keeps working. |
| `Storage:MaxImageBytes` | `8388608` (8 MiB) | `Storage__MaxImageBytes` | `MAX_IMAGE_BYTES` | The largest ECG image the crew may upload (`POST /api/images`). A larger upload gets HTTP 413. |

SQLite — PROTOTYPE DATABASE unless approved for production (see [database.md](database.md)).

### Frontend

| Key | Default | Environment variable | Legacy `.env` | Meaning |
|---|---|---|---|---|
| `Frontend:RootPath` | `wwwroot` (Development: `../../public`) | `Frontend__RootPath` | — (the test harness sets it to `stemi-app/public`) | The folder holding the screens. A published build carries them in `wwwroot` (copied from `public/` by `Masar.Api.csproj`). The server stops at start with *The screens folder was not found* if the folder is missing. |

### Sessions (PROTOTYPE ONLY)

| Key | Default | Environment variable | Legacy `.env` | Meaning |
|---|---|---|---|---|
| `Sessions:CrewSessionHours` | `24` | `Sessions__CrewSessionHours` | `SESSION_HOURS` | Lifetime of the crew test login cookie (`stemi_sid`). |
| `Sessions:DeviceSessionDays` | `30` | `Sessions__DeviceSessionDays` | — | Lifetime of the ER Doctor / Cardiologist / test console device session cookies (`stemi_dev_<role>`). |
| `Sessions:RequireSecureCookies` | `false` | `Sessions__RequireSecureCookies` | — | `true`: the session cookies are always marked `Secure` (HTTPS only). **Set `true` in production**, also behind a reverse proxy that ends TLS (the application cannot detect that by itself). `false`: `Secure` only when the request itself is HTTPS — the prototype on plain HTTP in the local network. |

These are prototype sessions, not an identity solution (see [security.md](security.md)).

### Live link

| Key | Default | Environment variable | Legacy `.env` | Meaning |
|---|---|---|---|---|
| `Live:HeartbeatMs` | `5000` | `Live__HeartbeatMs` | `HEARTBEAT_MS` | Interval of the `hb` event on the live stream (`/api/stream`). The screens show CONNECTION LOST when no event arrives for 12 s (`STALE_MS` in `public/shared/live.js`). Minimum 100 ms. |
| `Live:OfflineAfterMs` | `8000` | `Live__OfflineAfterMs` | — | How long a role may have no screen open before the test console shows it as offline. A page reload does not count. |

These are technical settings. No clinical meaning is attached to them.

### AI — Simulated AI Interpretation — PROTOTYPE ONLY

| Key | Default | Environment variable | Legacy `.env` | Meaning |
|---|---|---|---|---|
| `Ai:Provider` | `mock` | `Ai__Provider` | `AI_PROVIDER` | The ECG AI provider. Only `mock` exists: scripted results for the fictional test ECGs, with no external service and no ECG sent anywhere (`src/Masar.Infrastructure/Ai/MockEcgAiProvider.cs`). Any other value stops the server at start. |
| `Ai:MockDelayMs` | `5000` | `Ai__MockDelayMs` | `MOCK_AI_DELAY_MS` | How long the mock "processes" before its result appears. The analysis starts 1.2 s after the ECG is stored (`AiAnalysisService.StartDelay`). |

### Corpuls — Mock Corpuls Provider — PROTOTYPE ONLY

All of these are simulation settings, not clinical ones. See [corpuls-integration.md](corpuls-integration.md).

| Key | Default | Environment variable | Legacy `.env` | Meaning |
|---|---|---|---|---|
| `Corpuls:Provider` | `mock` | `Corpuls__Provider` | `CORPULS_PROVIDER` | `mock`: the Mock Corpuls Provider (simulated monitors, no network). `corpuls-mission`: the placeholder for the real corpuls.mission interface. It is NOT implemented: it makes no network call and no monitor ever connects. Any other value stops the server at start. |
| `Corpuls:SimTickMs` | `5000` | `Corpuls__SimTickMs` | `CORPULS_SIM_TICK_MS` | One simulated vital-signs update per interval. It is also the expected interval behind the screens' technical freshness indicator (more than 3 × this interval without data shows LAST DATA RECEIVED). Minimum 100 ms. |
| `Corpuls:SimNibpSeconds` | `120` | `Corpuls__SimNibpSeconds` | `CORPULS_SIM_NIBP_SECONDS` | A simulated non-invasive blood pressure measurement per interval. |
| `Corpuls:SimConnectMs` | `800` | `Corpuls__SimConnectMs` | `CORPULS_SIM_CONNECT_MS` | How long the simulated monitor takes to connect after LINK CORPULS. |
| `Corpuls:DemoMode` | `true` | `Corpuls__DemoMode` | `CORPULS_DEMO_MODE` (`false`, `0`, `off` or `no` turn it off) | The prototype demonstration mode. Each LINK CORPULS starts a fresh simulated monitor that connects, sends live values and sends ECG 1 by itself; the crew can simulate a requested repeat 12-lead. When off, the simulated monitor does only what the test console's CORPULS SIMULATOR (TEST ONLY) tells it. |
| `Corpuls:DemoEcgSeconds` | `3` | `Corpuls__DemoEcgSeconds` | `CORPULS_DEMO_ECG_SECONDS` | Demo mode: seconds between CORPULS CONNECTED and the automatic ECG 1. |

### Prototype (PROTOTYPE ONLY)

| Key | Default | Environment variable | Legacy `.env` | Meaning |
|---|---|---|---|---|
| `Prototype:CrewTestUser:Email` | `crew@test.local` | `Prototype__CrewTestUser__Email` | — | E-mail of the single fictional crew test account (id `u-crew-1`), created at the first start. A changed value is applied to that account at the next start. |
| `Prototype:CrewTestUser:Password` | not set | `Prototype__CrewTestUser__Password` | `TEST_USER_PASSWORD` | The crew test password. **A secret: never in `appsettings.json` or git.** When it is not set, a random password is generated once into `{data folder}/crew-test-password.txt` (file mode 600 outside Windows) and used from then on. The value is never logged; the start banner names only where it came from. At every start the account's stored hash is checked against this value and replaced if it differs. |

## Where secrets go

The only secret this build reads is the crew test password. The session-cookie keys are generated by ASP.NET Core
Data Protection into `{data folder}/keys`.

| Where | How |
|---|---|
| Development | Use `.env` (git-ignored; `TEST_USER_PASSWORD=`), or `dotnet user-secrets set "Prototype:CrewTestUser:Password" "<value>" --project src/Masar.Api`. You can also set nothing and use the generated `data/crew-test-password.txt`. |
| Test runs | The end-to-end harness generates a random password per run. The integration tests use a fixed test value passed through configuration, never a stored secret. |
| Production | Environment variables provided by the hosting platform, or a secret store such as Azure Key Vault (needs a configuration provider that this build does not include). Never in `appsettings*.json`, never in git. |

No configuration file in the repository contains a password, key, token or connection-string secret. The SQLite
connection string is built from `Storage:*` and has no credentials.

## The development runner's `.env`

The development runner (`scripts/dev.js`, `npm run dev` / `npm run dev:bg`) is DEVELOPMENT ONLY. It reads
`stemi-app/.env` if the file exists (see `.env.example`), translates the prototype setting names to the .NET keys,
and starts the backend with `ASPNETCORE_ENVIRONMENT=Development`. The translation table is `LEGACY` in
`scripts/lib/dotnet.js`. The test harness uses the same table, so test scripts keep the prototype names, for example
`H.startServer({ CORPULS_DEMO_MODE: 'false' })`.

| `.env` name | .NET key |
|---|---|
| `PORT`, `HOST` | `Kestrel:Endpoints:Http:Url` = `http://{HOST}:{PORT}` (defaults `0.0.0.0`, `3000`) |
| `DATA_DIR` | `Storage:DataDirectory` (resolved against `stemi-app/`) |
| `MAX_IMAGE_BYTES` | `Storage:MaxImageBytes` |
| `SESSION_HOURS` | `Sessions:CrewSessionHours` |
| `TEST_USER_PASSWORD` | `Prototype:CrewTestUser:Password` |
| `AI_PROVIDER` | `Ai:Provider` |
| `MOCK_AI_DELAY_MS` | `Ai:MockDelayMs` |
| `HEARTBEAT_MS` | `Live:HeartbeatMs` |
| `CORPULS_PROVIDER` | `Corpuls:Provider` |
| `CORPULS_SIM_TICK_MS` | `Corpuls:SimTickMs` |
| `CORPULS_SIM_NIBP_SECONDS` | `Corpuls:SimNibpSeconds` |
| `CORPULS_SIM_CONNECT_MS` | `Corpuls:SimConnectMs` |
| `CORPULS_DEMO_MODE` | `Corpuls:DemoMode` (`false`, `0`, `off`, `no` → `false`; anything else → `true`) |
| `CORPULS_DEMO_ECG_SECONDS` | `Corpuls:DemoEcgSeconds` |

Some settings are read only by the development runner:

| `.env` name | Meaning |
|---|---|
| `DEV_AUTO_PULL` | `true`: every 30 s the runner fast-forwards the checkout from GitHub (only with a clean working tree), so pushed changes arrive without a manual `git pull`. |
| `STEMI_BACKEND` | `node`: run the LEGACY Node.js server (`server/`) instead of the ASP.NET Core backend. It is a transition fallback only. The same happens automatically when the .NET SDK is missing. |

### Retired settings

| Setting | Why |
|---|---|
| `SESSION_SECRET` | The Node.js prototype signed its cookies with HMAC and this secret. The ASP.NET Core backend protects its cookies with ASP.NET Core Data Protection, whose keys live in `{data folder}/keys`. The setting is ignored. |

The legacy Node.js server (`server/config.js`) still reads the old names itself when it runs as the fallback.
