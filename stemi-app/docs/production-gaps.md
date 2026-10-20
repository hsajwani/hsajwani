# What must change before production

This test build (0.7.0, ASP.NET Core backend) proves the crew → ER Doctor → cardiologist workflow with fictional data
and a **simulated** corpuls feed. It is **not** fit for real patient information. Real patient data stays out of every environment until hosting, InfoSec, privacy and
data-governance requirements are approved. Nothing below has been chosen yet: vendors, hosting and architecture are
decided after design approval, with National Ambulance InfoSec and the governance bodies.

## Platform and operations (0.7.0)

The backend is now a conventional ASP.NET Core application ([architecture.md](architecture.md),
[deployment.md](deployment.md)). These are the platform items still needed for production. Each has an owner; the
questions behind them are in [open-decisions.md](open-decisions.md#decisions-for-the-it-handover-070).

| Item | What is needed | Owner |
|---|---|---|
| Hosting and HTTPS | Approved hosting and HTTPS only, with HSTS. Behind a TLS-terminating proxy set `Sessions:RequireSecureCookies = true` (session cookies always `Secure`); trusting the proxy's forwarded headers (`UseForwardedHeaders`, for the client address and scheme) is not implemented yet. `AllowedHosts` must list the real host names. | IT, Information Security |
| Identity | Replace the prototype sessions (`src/Masar.Api/Security/`) with the organisation's identity provider. Remove the crew test account, the anonymous device sessions and the typed clinician names ([security.md](security.md#what-production-needs-instead)). | Information Security, IT |
| Production database | A decision on SQL Server or PostgreSQL (or an approval of SQLite). Then the provider swap, a new baseline migration, and the SQLite-specific code listed in [database.md](database.md#moving-to-sql-server-or-postgresql). | IT, Information Security |
| Data Protection keys | Protected key storage (certificate, DPAPI or Key Vault) and rotation, in place of plain files in the data folder. | IT, Information Security |
| Central logging and monitoring | Route the structured logs to the organisation's platform. Add a readiness check that tests the database (`/health` is liveness only). Alert the support team. | IT |
| Backup and retention | Scheduled, encrypted backups of the database and the ECG images, tested restores, and the retention periods. Today nothing is backed up and nothing is deleted automatically. | Clinical Governance, Information Security, IT |
| CI/CD pipeline | Automated build, tests ([testing.md](testing.md)) and quality gate on every change; repeatable publish and deployment; an approved NuGet source. None exists in the repository. | IT |
| Legacy Node.js server | Remove `server/`, the fallback in `scripts/dev.js`, `npm run start:legacy` and `STEMI_BACKEND=node` once every user runs the ASP.NET Core backend. | IT, MASAR programme |
| Scale-out | The build runs as exactly one process: the in-process `PlatformGate` lock, the in-memory live link and the SQLite file. More instances need a server database with row locking or a single writer, and a shared message bus for the live link. | IT, MASAR programme |
| Test console | Remove or disable `/control` and `/api/control/*` (TEST ONLY) in production builds, and verify it. | IT, Information Security |
| Abuse protection | Rate limiting and lockout for the login and the API; anti-forgery review; a Content-Security-Policy for the pages (an inline bootstrap script needs a nonce or hash). | Information Security, IT |

## Security and access

- **HTTPS everywhere.** The test build uses plain HTTP on a local Wi-Fi network, with no encryption. Production needs
  TLS on approved hosting, with certificates managed by the hosting team.
- **Authentication.** The test build has one crew test login, and the ER Doctor and Cardiologist screens need no
  login at all: the clinician **types their name**, which is recorded per CAD number. That is prototype clinician
  identification only and gives **no identity assurance** (anyone can type any name). Production needs the hospitals'
  and National Ambulance's identity providers: organisation single sign-on (for example Microsoft Entra ID), staff ID,
  badge or PIN at the point of care, multi-factor authentication where policy requires it, roles and privileges from
  the directory, session expiry and revocation, and lost-device handling. The recorded name must come from the
  verified identity, not from typing.
- **Authorisation.** Per-case access by role and organisation (an ER sees its own cases, a cardiologist the cases
  routed to them, their backup and ACC); the test build lets every ER screen see every sent case.
- **The server as the authority for time.** The test build accepts the device's time for some events (it also
  records the server's receipt time). Production records authoritative server times and synchronised device clocks,
  including the monitors' and corpuls.mission's clocks (ECG acquisition and vital-sign times come from them).
- **InfoSec review**, penetration testing and vulnerability management before any pilot.

## Alerting (the production alarm requirement)

The test build's alarm is a sound played by an open web page. A locked phone, a page in the background, silent mode
or Do Not Disturb can stop it. The production system must not rely on a browser sound alone. It needs an approved
alerting method that covers at least:

- An in-app alarm while the app is open, behaving as in this build: on the ER screen only for a new case until it is
  accepted; on the cardiologist's phone only for a new cardiology activation until ACKNOWLEDGE & OPEN.
- A secure push notification that reaches a locked phone or a closed app and can be heard, with no patient details on
  the lock screen (Q-59).
- Escalation to the backup cardiologist and ACC when the alert is not acknowledged, at governance-configurable
  thresholds (Q-15, Q-43, Q-54), and reminders (Q-72).
- Proof of delivery: when the alert reached the device and was shown, not only when it was sent, so an alert that
  never arrived is escalated rather than assumed seen.
- Monitoring of the alerting path itself: if push delivery fails or a device stops reporting, ACC sees it.
- Whether the alarm may sound through silent and Do Not Disturb depends on the phone platform, its permissions, and
  whether cardiologists use personal or managed phones (Q-33). This decides whether the app must be a native app
  rather than a web page.
- End-to-end testing of the full alert path on the real devices before any pilot.

## Hosting, data and records

- **Approved hosting** that meets National Ambulance and UAE data requirements, chosen with InfoSec. No cloud service
  is used by this build.
- **Production database** (for example SQL Server or PostgreSQL) with encryption at rest, backups, point-in-time recovery, schema
  migrations and an agreed retention period.
- **ECG image storage** with encryption, integrity checks (the build already records SHA-256) and retention.
- **Audit trail** protected against alteration, retained and exportable for clinical governance.
- **Several cases and users at once:** the build handles several open cases on every screen, but has one crew unit and
  no rosters; production needs many crews, several EDs, cardiologists and hospitals, rosters and backups (Q-11).
- **Availability and downtime:** monitoring, alerting to the support team, failover, and the approved STEMI downtime
  route with its number (Q-21).

## Clinical AI

- The build's AI is a scripted simulation (Simulated AI Interpretation — PROTOTYPE ONLY). Any real ECG AI must be validated and introduced in stages (retrospective
  validation, shadow mode, controlled visibility, monitored pilot, ongoing governance), with version tracking,
  performance monitoring and the regulatory review the approving bodies require.
- The AI remains decision support: it never diagnoses, activates the cath lab or makes the decision, and the original
  ECG stays dominant beside it.

## Integrations (later phases)

- **corpuls / corpuls.mission.** The build simulates the feed (Mock Corpuls Provider — PROTOTYPE ONLY). The real
  connection (`RealCorpulsMissionProvider`) is a placeholder. Writing it needs everything listed in
  [corpuls-integration.md](corpuls-integration.md) from MEAD / corpuls:
  - authentication, API documentation, payload formats and units;
  - the event mechanism and delivery guarantees;
  - CAD / mission and device mapping;
  - sandbox access with test devices;
  - retention, connection / retry / heartbeat rules, and clock synchronisation.

  It also needs National Ambulance InfoSec approval, a data-sharing agreement, and data-protection and clinical-safety
  approval. No real monitor data flows until then.
- How the CAD number reaches the tablet in V1 (Q-70), then CAD integration.
- ePCR, and other ECG devices (ZOLL, LIFEPAK). The manual ECG fallback stays for when no monitor feed is available.
- Hospital, cath-lab, ACC and administration views (not built yet). The ED view in this build is the ER Doctor's
  screening step only.
- An authorised amendment workflow for closed cases (a closed STEMI pathway is read-only here).

## Privacy and governance

- Data-protection and privacy approval, data-sharing agreements with participating hospitals, access logging and
  review, and a process for patient-data requests.
- Clinical safety review of the workflow, alarms and failure modes before the pilot.
- Network governance approval of the configurable rules (activation workflow, escalation, destination policy).
