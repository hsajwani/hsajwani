# Security · MASAR STEMI prototype 0.7.0

This build is a **prototype with fictional test data only**. Its identification of people is PROTOTYPE ONLY and is
**not secure authentication**. Nothing here has been reviewed or approved by National Ambulance Information Security,
and no real patient data may enter any environment until Information Security, privacy and data-governance approvals
exist. This page describes what is built, why, and what production needs. The open items are tracked in
[production-gaps.md](production-gaps.md) and [open-decisions.md](open-decisions.md).

## Who is acting (identification as built)

The ASP.NET Core cookie authentication is in `src/Masar.Api/Security/`:
- `ScreenSessions.cs`: the cookie schemes;
- `ActorResolver.cs`: who is acting;
- `ScreenSessionAttribute.cs`: the filter that requires a session on the API.

Every application service receives an `Actor` (`src/Masar.Application/Common/Actor.cs`): role, user id, device
session id, name, title, unit. Replacing the identification therefore changes only `src/Masar.Api/Security/` (and the
screens' name prompts), not the pathway services.

| Screen | How it is identified | Label |
|---|---|---|
| Crew MDT (`/crew`) | E-mail and password of the **single fictional crew test account** (`crew@test.local`), then a session cookie | PROTOTYPE ONLY |
| ER Doctor (`/er`) | **No login.** Opening the page gives the browser a device session for the role. The doctor types their name when accepting a case. | Free-text ER Doctor Name — PROTOTYPE ONLY |
| Cardiologist (`/cardiologist`) | **No login.** The same, with the name typed at ACKNOWLEDGE & OPEN. | Free-text Cardiologist Name — PROTOTYPE ONLY |
| Test console (`/control`) | **No login.** Opening the page gives a device session for the test console. | Test console — TEST ONLY |

A typed name gives **no identity assurance**: anyone can type any name. The server only checks the name's form: 2 to
80 characters, at least one letter, control characters removed (`src/Masar.Domain/Rules/ClinicianName.cs`).

### The crew test login

- `POST /api/login` with `{ email, password }`. The e-mail is trimmed and compared in lower case.
- Passwords are stored as ASP.NET Core Identity `PasswordHasher` hashes (PBKDF2), in `users.password_hash`.
- **The password is never in the source code.**
  - It comes from `Prototype:CrewTestUser:Password` (environment variable `Prototype__CrewTestUser__Password`;
    `TEST_USER_PASSWORD` in the development `.env`; or dotnet user-secrets).
  - When it is not configured, a random password is generated once into `{data folder}/crew-test-password.txt` (file
    mode 600 outside Windows).
  - At every start `CrewTestUserSeeder` (`src/Masar.Infrastructure/Identity/`) re-hashes the account's password when it
    does not match the configured or generated one. This also replaces the Node.js prototype's scrypt hashes, which this
    backend cannot verify.
- A wrong e-mail or password gets `401 Email or password not recognised`. A non-crew account (the cardiologist test
  account of 0.4.0) cannot log in.
- **There is no lockout, no rate limit and no multi-factor authentication.**

### Sessions

| Cookie | Scheme | Lifetime | Holds |
|---|---|---|---|
| `stemi_sid` | `Crew` | `Sessions:CrewSessionHours` (24 h), fixed | The crew user's id. The user is read from the database on every request; a removed or non-crew account has no session. |
| `stemi_dev_er`, `stemi_dev_cardiologist`, `stemi_dev_control` | `Device.er`, `Device.cardiologist`, `Device.control` | `Sessions:DeviceSessionDays` (30 days), fixed | The role and a random device session id (12 hexadecimal characters). The id is recorded with every action (`audit_events.device`, `ops.user_id`). |

Cookie properties:
- Every cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`.
- `Secure`: by default only when the request arrives over HTTPS (`CookieSecurePolicy.SameAsRequest`, for the prototype
  on plain HTTP). `Sessions:RequireSecureCookies = true` marks every session cookie `Secure` (`CookieSecurePolicy.Always`):
  required in production.
- Cookies are encrypted and signed with ASP.NET Core Data Protection. The key ring is kept in `{data folder}/keys`
  (application name `MASAR-STEMI`), so sessions survive a restart.
- Deleting the key ring signs every screen out; it protects no stored data.

Each request names its screen: the `X-Stemi-Role` header, or `?role=` on the live stream; the default is crew. The
server accepts the role only if the browser holds that role's session. Otherwise the API answers 401 with the message
the screens show (*Not logged in* / *No session for this screen: reload the page*).

### What production needs instead

Identity must come from the organisation's approved identity provider, for example Microsoft Entra ID through OpenID
Connect, with staff ID. The governing decisions are ER-1 and the identity item in [open-decisions.md](open-decisions.md).
Production needs:

- sign-in for every clinical role, with multi-factor authentication where policy requires it;
- roles and organisations from the directory (crew, ER Doctor, Cardiologist, administrators), not from the URL;
- the recorded name taken from the verified identity, never typed;
- session expiry, revocation and lost-device handling;
- no anonymous device sessions, and no test console.

Only `src/Masar.Api/Security/` (and the name prompts in `public/`) must change: `ActorResolver` builds the `Actor` from
the signed-in identity instead of the prototype cookies.

## Authorization (enforced on the server)

The browser's checks only give immediate feedback. The server decides.

| Rule | Where |
|---|---|
| Each endpoint checks the role. The crew alone creates, corrects, discards, opens and completes cases, links corpuls and uploads images (`403 Only the crew …`). Only the crew, ER and Cardiologist record clinical actions (`/api/ops`). Only the test console uses `/api/control/*` (`403 Test console only`). | `src/Masar.Api/Controllers/*` |
| Each action is checked against the pathway state machine before anything is written (`409` with the reason). | `src/Masar.Domain/Pathway/PathwayStateMachine.cs` (`Guard`) |
| **Closed-case immutability.** On a closed STEMI pathway only viewing and acknowledgements are accepted (`viewed`, `seen`, `compare`, `decrcv`, `decack`, `erack`, `hopen`, `er_shown`, `shown`). Everything else gets `409 This STEMI pathway is closed: it is read-only.` and image uploads are refused with `409`. | `PathwayStateMachine.ReadOnlyAllowed`, `ImagesController` |
| The ER Doctor acts only on sent cases, accepts before assessing, and assesses once. The Cardiologist acts only after the ER Doctor activated cardiology, and acknowledges before deciding. A decision or assessment must name the latest ECG. | `PathwayStateMachine.Guard`, `ActionService` |
| Who sees which case: the crew its own unit's cases; the ER only sent cases; the Cardiologist only cases where cardiology was activated (a case closed by the ER Doctor only when looked up by its CAD number: opened by number, or listed by searching at least 4 characters of it); the test console every case. The live stream applies the same rules to every push. | `src/Masar.Application/Cases/CaseVisibility.cs`, `src/Masar.Api/Live/LiveUpdates.cs` |
| One case per CAD number; a CAD number is locked once the case was sent. | `CaseService` |
| Each action id is stored once: a replayed action changes nothing. | `ActionService`, table `ops` |

Prototype gaps:
- every ER screen sees every sent case, and every cardiologist screen every activated case;
- there is no scoping by hospital or organisation;
- anyone who can reach the server can open `/er`, `/cardiologist` or `/control` and get that role's session.

## Transport and HTTP headers

- **The prototype runs on plain HTTP** on a local network: traffic is not encrypted.
  - Production must use HTTPS only (TLS at Kestrel or at the reverse proxy), with HSTS and `Secure` cookies.
  - The application does not call `UseHttpsRedirection`, `UseHsts` or `UseForwardedHeaders`.
  - Behind a TLS-terminating proxy, set `Sessions:RequireSecureCookies = true` so the cookies are marked `Secure`; the
    application does not read forwarded headers ([deployment.md](deployment.md#hosting-options-for-production-not-verified-here)).
- **Headers set on every response** (`src/Masar.Api/Program.cs`):
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`.
  - `Cache-Control: no-store` unless the response sets its own: API answers and pages are never cached; screen files
    (`/assets/…`) are `no-cache`; ECG images are `private, max-age=86400, immutable`.
- **ECG images** (`GET /files/{id}`) are sent with `Content-Security-Policy: default-src 'none'; style-src
  'unsafe-inline'`. The simulated corpuls ECGs are SVG drawn by the platform, and nothing in them may run. Any valid
  session (any role) may fetch an image by its id.
- **No Content-Security-Policy on the pages.** The pages carry an inline `<script>window.APP=…</script>`, whose JSON is
  escaped so it cannot close the script element. A production CSP needs a nonce or hash for it.
- `AllowedHosts` is `*`. Set the real host names in production.
- No CORS policy is configured, so browsers do not let other sites call the API with the user's cookies and read the
  answer.
  - State-changing endpoints take `application/json` or image bodies, which a cross-site form cannot send without a CORS
    preflight.
  - The cookies are `SameSite=Lax`.
  - There are no anti-forgery tokens: review this for production.

## Input validation

- Every rule is checked on the server, in `src/Masar.Domain/Rules/` and the application services.
  - The CAD number is normalised and checked (`CadNumber`).
  - Clinician names are checked (`ClinicianName`).
  - Free text has control characters removed and its length limited (`TextRules`, 500 characters by default).
  - NOT SUSPICIOUS FOR STEMI needs a reason from the list, and OTHER needs an explanation (`ErAssessmentRules`).
  - Decisions are checked (`ActionService`).
  - Device times are kept only when plausible (at most 48 h old, at most 60 s ahead); otherwise the server's time is
    used.
- JSON request bodies are limited to 1 MB (`[RequestSizeLimit(1_048_576)]`). A batch holds 1 to 200 actions. Malformed
  JSON gets `400 Bad JSON`.
- **Images:**
  - JPEG or PNG only by content type (`415 JPEG or PNG only`);
  - at most `Storage:MaxImageBytes` (8 MiB; `413`);
  - an empty body is refused;
  - each file's SHA-256 is stored;
  - file names are generated by the server (`img` + 12 random hexadecimal characters + extension), never taken from
    the request;
  - `FileImageStore` refuses any name with a path separator or `..`;
  - files are served only through `/files/{id}`, by a database lookup of the id.
- **SQL:** EF Core parameterises every value, including the `FromSql` queries (interpolated values become parameters).
  Two statements are built with table names, which cannot be parameters. Both are marked in the code with
  `#pragma warning disable EF1002` and a comment:
  - the CAD-number correction in `CaseService.Correct` (names from the database's own catalogue, `sqlite_master`);
  - the TEST ONLY reset in `TestDataService` (a fixed list).

  `DatabaseInitializer` and the baseline migration build `ALTER TABLE` statements from the constants in
  `InitialSchemaSql.cs`. No request value reaches any of these.

## Data at rest and retention

- The SQLite database, the ECG image files and the Data Protection key ring are **unencrypted** on the server's local
  disk in `{data folder}`. That is acceptable for fictional test data only.
- Production needs approved storage with encryption at rest, encrypted backups, a retention policy, and protection
  against alteration of the audit trail ([database.md](database.md),
  [production-gaps.md](production-gaps.md)).
- At first start ASP.NET Core logs *No XML encryptor configured …* because the key ring is stored as plain XML.
  Production must protect it with a certificate, DPAPI or a key vault ([deployment.md](deployment.md#data-protection-keys-in-production)).
- Nothing is deleted automatically. Only the TEST ONLY reset deletes data.

## Secrets

- The repository holds **no password, key, token or connection-string secret**.
  - `appsettings*.json` contain none.
  - `.env.example` leaves `TEST_USER_PASSWORD` unset.
  - `.gitignore` excludes `data/`, `.env` and database files.
- The only secret the application reads is the crew test password. Where it is kept:
  - production: environment variables or a secret store;
  - development: `.env` or dotnet user-secrets.

  It is never logged. The start banner shows only where it came from.
- The session keys are generated by ASP.NET Core into the data folder.
- This build uses no API keys: it calls no external service.

## Logging

Structured logging with `ILogger` message templates (see [deployment.md](deployment.md#monitoring)).

- **Never logged:** passwords, cookies, tokens, image contents, patient details.
- **Logged:**
  - a refused crew login with the e-mail address that was entered (`Crew login refused for {Email}`);
  - a successful crew login with the user id;
  - failures with the CAD number and the action kind or ECG number;
  - start-up, migrations and the data folder.
- The clinical record of who did what is the **audit trail in the database** (`audit_events`), not the log.
  Routine monitor samples and heartbeats are never audited.
- In production, CAD numbers in logs are operational identifiers that Information Security should classify.

## TEST ONLY functions

The test console (`/control`, `/api/control/*`) can do the following:
- delete all test data;
- take cases off the screens;
- create demo cases;
- drive the simulated corpuls monitors and the mock AI;
- see every case.

Anyone who opens `/control` gets its session. **It must be removed or disabled in production** (the controller
`src/Masar.Api/Controllers/TestConsoleController.cs`, the page `public/control/`, and the `control` device role),
not merely hidden. `npm run reset` is a TEST ONLY file deletion for development machines.

## External connections

There are none at run time.
- The AI is Simulated AI Interpretation — PROTOTYPE ONLY (`MockEcgAiProvider`): scripted results, and no ECG is sent
  anywhere.
- The monitor feed is the Mock Corpuls Provider — PROTOTYPE ONLY: monitors simulated inside the process.
- The `corpuls-mission` provider is a placeholder that makes no network call.

The only outbound connections come from developer tooling:
- NuGet package restore during a build;
- `git fetch` by the development runner when `DEV_AUTO_PULL=true`.

## Availability and abuse

- Nothing is rate-limited: logins, actions and uploads.
- One process serves everything. A failure of that process stops every screen.
- The screens show CONNECTION LOST when the live link stops.
- Production needs rate limiting, monitoring and an availability design with the approved alerting path
  ([production-gaps.md](production-gaps.md)).

## Assumptions requiring Information Security confirmation

| # | Assumption in this build | To confirm |
|---|---|---|
| S-1 | Plain HTTP is acceptable for a prototype on a closed local network with fictional data. | Whether any demonstration network needs TLS too. |
| S-2 | Typed clinician names and anonymous device sessions are acceptable for prototype demonstrations only. | The production identity provider (e.g. Entra ID), MFA policy, and staff-ID requirements. |
| S-3 | A single shared crew test account with a configured password is acceptable for demonstrations. | Its removal before any pilot; the crew identity model (personal accounts, shared MDT devices). |
| S-4 | Data Protection keys as plain files in the data folder are acceptable for fictional data. | Key storage and protection (certificate, DPAPI, Key Vault) and key rotation. |
| S-5 | SQLite and image files unencrypted on a local disk are acceptable for fictional data. | The production database, encryption at rest, backup encryption, data residency. |
| S-6 | Logging the e-mail entered at a failed crew login, and CAD numbers in error logs, is acceptable. | The log classification, retention and the central logging platform. |
| S-7 | No rate limiting, lockout or anti-forgery tokens in the prototype. | The controls required for production (rate limits, lockout, CSRF protection, WAF). |
| S-8 | No Content-Security-Policy on the pages (an inline bootstrap script is used). | The CSP required, and the approach (nonce or hash). |
| S-9 | The test console is reachable by anyone on the network in the prototype. | That production builds exclude it, and how this is verified. |
| S-10 | The audit trail is append-only by design but not protected against alteration at the storage level. | Tamper-evidence, retention and export requirements for clinical governance. |
| S-11 | No external network calls are made; any future corpuls.mission or AI service connection needs a security review first. | The review process, data-sharing agreements and approvals (see [corpuls-integration.md](corpuls-integration.md)). |
