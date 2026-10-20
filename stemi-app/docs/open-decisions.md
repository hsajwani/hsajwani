# Open decisions in this build (0.7.0)

Where a decision is still open, the build uses a working default and says so. None of these defaults is confirmed.
Reminder and escalation times are governance configurable and not set; the build invents no numbers, rosters,
response times, hospital capabilities or clinical criteria.

The decisions for the IT handover (hosting, identity, database, operations) are in
[Decisions for the IT handover](#decisions-for-the-it-handover-070), each with its owner. What must change before
production is in [production-gaps.md](production-gaps.md).

## Questions requiring a decision

| # | Question | What this build does (working default) |
|---|---|---|
| Q-69 | Can one CAD incident have more than one STEMI patient? | One STEMI case per CAD number. Entering a CAD number that already has a case gives CASE ALREADY EXISTS with OPEN EXISTING CASE; a second case is never created. |
| Q-70 | How does the CAD number reach the tablet in V1? | The EMT enters it manually from the MDT / dispatch information; checked for format and for an existing case, locked after SEND. CAD integration later. Q-51 (the CAD number format) also open: the build uses `YYYYMMDD-NNNN-N`. |
| ER-1 | Who is the ER Doctor for a case, and how do they sign in? | Any ER screen; the first ER Doctor to press ACCEPT CASE is recorded with the name they type. Prototype identification only (see production-gaps). |
| ER-2 | The ER Doctor's reasons for NOT SUSPICIOUS FOR STEMI | The six reasons specified for this build (ECG DOES NOT MEET STEMI CRITERIA · ALTERNATIVE DIAGNOSIS SUSPECTED · ECG CHANGES NOT CONSISTENT WITH ACUTE STEMI · CLINICAL PRESENTATION NOT CONSISTENT WITH STEMI · POOR ECG QUALITY — NOT DIAGNOSTIC · OTHER with an explanation). The list needs clinical-governance approval. |
| ER-3 | Should UNCERTAIN activate cardiology? | Yes, at once, recorded as "ER Assessment: UNCERTAIN, Cardiology: ACTIVATED". |
| ER-4 | Reminders / escalation when no ER Doctor accepts a new case | None: the alarm continues on every ER screen until accepted. Thresholds and escalation routes are not set. |
| Q-11, Q-43 | Which cardiologist is alerted, and who is escalation level 1? | Every cardiologist screen gets each activation; the first to ACKNOWLEDGE & OPEN is recorded. No roster, no backup, no escalation (thresholds not set: Q-15, Q-54). |
| Q-71 | May a clinician accept / acknowledge while offline? | No: both need a connection and the alarm continues. |
| Q-72 | What does a reminder do? | Nothing automatic; the 0.4.0 console buttons for reminders and escalation were removed. |
| Q-73 | Several new cases at once | Supported: queues on every screen; each alarm continues until each case is accepted / acknowledged. |
| Q-74 | Crew changes after a decision | They arrive silently; the cardiologist can record a new decision while the case is active. |
| Q-75 | Should the crew tablet sound when an outcome arrives? | No sound. Each decision or ER outcome takes over the crew screen until acknowledged. |
| Q-21 | The approved STEMI downtime route and number | The crew is told to use the STEMI downtime procedure (phone) when a case cannot be sent; no number is shown. |
| Q-22 | Destination and ETA | Removed in 0.5.0: transport, destination and ETA belong to ICCC; the platform no longer shows them. |
| Q-26 | Does V1 show the AI or run it in shadow mode first? | Shown as decision support to the crew, ER and cardiologist, the same analysis everywhere. It is a simulation. |
| Q-56 | Crew pick lists (complaints, treatments) | Illustrative lists; no default doses are pre-filled. |
| Q-59 | Patient details on the lock screen | Not applicable: no push notifications in the test build. |
| C-1 | How is a case linked to the monitor? | When the crew confirms the CAD number (LINK CORPULS), the case is created, still unsent and invisible to the ER, and linked to the unit's monitor (one simulated corpuls3 per unit). The crew does not pick a device. The real mapping of CAD number, mission and monitor depends on corpuls.mission ([corpuls-integration.md](corpuls-integration.md)). |
| C-2 | ECGs acquired on the monitor before the CAD number was entered | Not attached: only ECGs acquired after the link reach the case. The crew can use the manual ECG fallback. |
| C-3 | When is monitor data "not current"? | Technical indicator only: connected but no new values for more than 3 × the expected update interval, shown as LAST DATA RECEIVED hh:mm:ss / N min ago. No clinical threshold is set; any rule needs clinical governance. |
| C-4 | Must the crew confirm the vital signs at SEND? | No: the latest monitor values travel with the case automatically, recorded with their time (and in the audit). |
| C-5 | Which values come from the monitor? | HR, SpO₂, non-invasive BP (with its measurement time) and RR, plus the 12-lead ECG. The crew enters age, sex, presenting complaint and symptom onset. Manual vital signs remain a fallback. |
| C-6 | Does the manual ECG fallback need a reason? | No reason is asked; it is recorded as *manual fallback* and audited. It is prominent only when corpuls is not available. |
| C-7 | One monitor, two cases | A monitor serves one case at a time: linking it to a new case ends the previous case's feed, which keeps what it received. |
| C-8 | What happens to the feed when the pathway closes? | It ends; the last values stay with the case; late data for the closed case is refused. A lost connection never closes the pathway, cancels the case or triggers a decision. |

## Decisions for the IT handover (0.7.0)

From 0.7.0 the backend is ASP.NET Core (C#), so it can be handed over to National Ambulance IT
([handover.md](handover.md)). These questions were not decided by building the prototype. Each has an owner; none of
the working defaults is approved.

| # | Question | What this build does (working default) | Owner |
|---|---|---|---|
| H-1 | Hosting platform: IIS on Windows Server, Azure App Service, or Linux; on-premises or cloud; data residency | Runs anywhere .NET 10 runs. Only a local development computer and the cloud development container were used. The options are listed in [deployment.md](deployment.md#hosting-options-for-production-not-verified-here) and none is verified. | IT, Information Security |
| H-2 | HTTPS: where TLS ends (Kestrel or a reverse proxy), certificates, HSTS | Plain HTTP on a local network ([security.md](security.md#transport-and-http-headers)) | IT, Information Security |
| H-3 | Identity provider for the crew, ER Doctors and Cardiologists (e.g. Microsoft Entra ID with OpenID Connect, staff ID, MFA, shared MDT devices) | One crew test account; no login for the ER and Cardiologist screens (Free-text ER Doctor Name / Free-text Cardiologist Name — PROTOTYPE ONLY) | Information Security, IT, Clinical Governance, hospitals |
| H-4 | Production database: SQL Server or PostgreSQL, or an approval of SQLite | SQLite — PROTOTYPE DATABASE, one file on the server's disk ([database.md](database.md)) | IT, Information Security |
| H-5 | Storage and protection of the ASP.NET Core Data Protection keys (certificate, DPAPI, Key Vault), and key rotation | Plain XML files in the data folder | IT, Information Security |
| H-6 | Central logging and monitoring: the logging platform, health and readiness monitoring, alerting the support team | Structured console logging; `/health` is a liveness check only | IT |
| H-7 | Backup frequency and encryption; retention periods for cases, ECG images, the audit trail and backups | No backup is configured; nothing is deleted automatically | Clinical Governance, Information Security, IT |
| H-8 | CI/CD pipeline: automated build, tests and quality gate, publish, deployment, NuGet source | Scripts and documented commands only ([testing.md](testing.md#it-handover-quality-gate)); no pipeline in the repository | IT |
| H-9 | When to remove the legacy Node.js server (`server/`) and its fallback in the development runner | Kept as a transition fallback ([deployment.md](deployment.md#the-transition-from-the-nodejs-prototype)) | IT, MASAR programme |
| H-10 | Scale-out and availability: more than one instance, failover, maintenance windows | Exactly one process ([deployment.md](deployment.md#single-instance)) | IT, MASAR programme |
| H-11 | Removing or disabling the test console (TEST ONLY) in production builds, and how that is verified | The test console is part of every build and reachable by anyone who opens `/control` | IT, Information Security |
| H-12 | The MASAR programme structure: who owns the platform, its workstreams and governance bodies, and who approves releases and clinical changes | Not described in the repository | MASAR programme |
| H-13 | When and how corpuls.mission is integrated, and who supplies the interface information ([corpuls-integration.md](corpuls-integration.md)) | Mock Corpuls Provider — PROTOTYPE ONLY; the real provider is a placeholder | MEAD, Corpuls, MASAR programme, Information Security |
| H-14 | Whether any ECG AI is used in V1, which service, and its validation (Q-26) | Simulated AI Interpretation — PROTOTYPE ONLY | Clinical Governance, MASAR programme |

## Design choices not yet confirmed

The alert band across the ER screen (rather than a full-screen alert), the full-screen activation layer on the
cardiologist's phone, the order of the ER decisions (ACTIVATE · UNCERTAIN · NOT SUSPICIOUS), the two-step cardiologist
decision, the rule that an assessment or decision must cover the latest ECG, the queues on each screen, the crew's
pathway progress (CREW → ER → CARDIOLOGY → DECISION), and the clinical timeline built from the record (the full audit
trail stays in the test console). From 0.6.0: the crew's single page (the corpuls connection bar, the large ECG, the
compact live-values panel, the four patient items, one sticky SEND TO ER with the list of what is missing), the
wording of the connection states (CORPULS CONNECTED · WAITING FOR CORPULS · CORPULS CONNECTION LOST / LIVE MONITOR
DATA TEMPORARILY UNAVAILABLE), and the manual fallback as a quiet secondary control. From 0.6.1, for the prototype
demonstration only: the automatic simulated feed (ECG 1 about 3 s after CORPULS CONNECTED), the step line in the corpuls
bar, and SIMULATE REPEAT ECG ACQUISITION on the crew screen (no physical monitor is connected). Each needs a yes or no.

## Not built in this round

Hospital, cath-lab and ACC screens; cath-lab activation; destination / transfer; administration and rosters;
lock-screen push and escalation; an amendment workflow for closed cases; real identity (SSO); the real corpuls.mission
connection (simulated only; see corpuls-integration.md); other monitors (ZOLL, LIFEPAK); a production deployment
(hosting, HTTPS, identity provider, production database, backups, central logging: see production-gaps.md).
