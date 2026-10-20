# ADR 0001 — ASP.NET Core (C#) backend for the IT handover

- **Status:** Accepted
- **Date:** 2026-10-20
- **Version:** 0.7.0
- **Scope:** the STEMI coordination platform prototype (`stemi-app/`)

## Context

Up to 0.6.1 the prototype's backend was a Node.js 22 server using only the standard library (`server/`): `node:http`
for the API and the live event stream, `node:sqlite` for the database, hand-written signed cookies, no build step. It
worked and was fully covered by end-to-end tests, but it was built for fast prototyping by one developer.

The project may be handed over formally to the **National Ambulance IT Department**. The IT handover requirement
states that the backend must be written in **C# with ASP.NET Core**, with a conventional, well-structured .NET
architecture that an enterprise Microsoft-oriented IT team can support without the original developer; that the
frontend stays plain HTML, CSS and JavaScript unless there is a clear reason to change; that clinical workflow rules are
enforced on the backend and separated from the user interface; that the corpuls integration sits behind a replaceable
provider interface with simulated providers clearly separated; that configuration uses standard .NET configuration with
no secrets in source code; that logging is structured, auditability is preserved, migrations are documented and
reproducible, and the critical pathway behaviour is covered by automated tests; and that backward compatibility is
preserved where reasonable.

The prototype is in active demonstration use: its screens, its HTTP API and live events, and the test database on the
user's computer (`data/stemi-test.db`) are relied on. Its end-to-end suites (API, demo, corpuls, acceptance,
pathway, CAD entry, visual) encode the expected behaviour precisely.

## Decision

1. **Backend: ASP.NET Core 10 and C#** on .NET 10 (LTS), SDK pinned in `global.json`.
2. **A conventional layered solution** (`Masar.sln`):
   - `Masar.Domain`: the pathway state machine, clinical rules and entities, with no dependencies;
   - `Masar.Application`: the use cases and the interfaces the outer layers implement;
   - `Masar.Infrastructure`: EF Core and SQLite, migrations, the corpuls and AI providers, file storage;
   - `Masar.Api`: the ASP.NET Core host (MVC controllers, cookie authentication, Server-Sent Events, hosted services).

   Plus `Masar.UnitTests` and `Masar.IntegrationTests` (xUnit). Central Package Management; warnings treated as
   errors.
3. **Data access: Entity Framework Core with SQLite** as the PROTOTYPE DATABASE. The baseline migration creates
   exactly the prototype's 0.6.1 schema, and a database created by the prototype is adopted on start without data
   changes. A production database is a later provider change, once approved.
4. **The frontend stays plain HTML, CSS and JavaScript** (`public/`), unchanged and served by ASP.NET Core.
5. **A faithful port**: the same HTTP API (routes, JSON fields, status codes, messages), the same Server-Sent Events
   and payloads, the same audit wording and the same database schema and file name, so the screens and the existing
   test data keep working, and the existing end-to-end suites prove the parity.
6. **Standard platform features instead of custom ones**: ASP.NET Core cookie authentication and Data Protection for
   the prototype sessions, ASP.NET Core Identity's password hasher, `IOptions` configuration, `ILogger` structured
   logging, `BackgroundService` and `TimeProvider` for timers, EF Core migrations.
7. **No secrets in source code**: the crew test password comes from configuration (environment variable or
   user-secrets) or is generated into the data folder.
8. **The legacy Node.js server is kept only during the transition** (`server/`, `npm run dev -- --legacy`,
   `STEMI_BACKEND=node`, and automatically when the .NET SDK is not installed), clearly labelled LEGACY, and removed in a
   later version.

## Alternatives considered

| Alternative | Why not chosen |
|---|---|
| **Stay on Node.js** | Does not meet the handover requirement (C# / ASP.NET Core, supportable by a Microsoft-oriented IT team). The prototype also relied on hand-written authentication and SQL that the .NET platform provides in standard form. |
| **.NET 8 LTS** | Support ends in November 2026, too close to the handover; .NET 10 is the current LTS. |
| **Rewrite the screens (for example Blazor)** | No clear technical reason: the screens work, are tested at every viewport and are plain web technology the IT team can maintain. A rewrite would add risk and lose the existing end-to-end coverage. |
| **SignalR instead of Server-Sent Events** | Possible later (it would also give a scale-out backplane), but it changes the live-link contract of every screen. SSE is a web standard served directly by ASP.NET Core and keeps the screens unchanged. |
| **SQL Server or PostgreSQL now** | The choice of a production database depends on hosting, InfoSec and data-governance approvals that do not exist yet. EF Core keeps the change to a provider swap plus migrations; SQLite keeps the prototype self-contained and keeps the existing test data. |
| **A new API design during the port** | It would break the screens and invalidate the end-to-end tests that prove the port. API changes, if wanted, come later as documented, versioned changes. |

## Consequences

**Positive**

- The codebase uses mainstream, supported Microsoft technology with a conventional structure: an IT developer who has
  not seen the project can build, run, test and extend it from the documentation.
- Clinical rules are concentrated and unit-tested in `Masar.Domain`; the server is the authority for every action and
  for closed-case immutability.
- Integrations are behind interfaces (`ICorpulsProvider`, `IEcgAiProvider`, `IImageStore`, `ILiveNotifier`), with the
  simulated providers clearly separated and labelled PROTOTYPE ONLY.
- The schema is now managed by reproducible EF Core migrations.
- The screens, the API and the test data did not change for users; all existing end-to-end suites pass against the new
  backend, and unit and integration tests were added.

**Negative / costs**

- The **.NET 10 SDK is required** on every development machine (the runtime on servers).
- **Breaking changes** (listed in [handover.md](../handover.md#what-changed-in-070-and-breaking-changes)): existing browser
  sessions are invalidated once; the crew test password no longer has a built-in default; settings are .NET
  configuration keys (the old `.env` names are translated by the development runner); `/health` reports the ASP.NET
  Core environment name.
- **Single instance.** Like the prototype, the application serialises changes with an in-process lock
  (`PlatformGate`) and keeps the live connections and the simulated monitors in memory. Running several instances
  needs a different concurrency design, a live-link backplane and a shared key ring
  ([architecture.md](../architecture.md#4-the-unit-of-work-platformgate)).
- For the transition there are two backends in the repository; the legacy one must not be developed further and has to
  be removed.
- The faithful port keeps some prototype choices that a fresh design might change (for example dynamic JSON action
  payloads, epoch-millisecond times, SQLite `rowid` ordering in a few queries); they are documented in
  [api.md](../api.md) and [architecture.md](../architecture.md).
