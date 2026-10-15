# Architecture · test build 0.5.0

TEST BUILD · FICTIONAL DATA ONLY. This describes the test build, not the production system.

## The pieces

```
 crew MDT (/crew)        ER Doctor (/er)          Cardiologist (/cardiologist)     test console (/control)
 public/crew/            public/er/               public/cardiologist/             public/control/
      │  ▲                    │  ▲                      │  ▲                             ▲
 POST │  │ SSE           POST │  │ SSE             POST │  │ SSE                         │ SSE
      ▼  │                    ▼  │                      ▼  │                             │
 ┌───────────────────────────── server/index.js (node:http) ────────────────────────────────────────┐
 │ auth.js      crew test login · prototype device sessions for ER / cardiologist / console          │
 │ pathway.js   the state machine: derives each case's state, refuses actions the state does not allow│
 │ platform.js  the platform: actions, audit trail, alerts, closures, snapshots, pushes per role       │
 │ live.js      Server-Sent Events: per-screen case pushes, heartbeat, presence                         │
 │ ai/          AI service interface; provider "mock" (simulated)                                       │
 │ db.js        node:sqlite → data/stemi-test.db (migrations on start); images → data/images/           │
 └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 public/shared/  ds.css (design system) · ui.js · clinical.js · live.js · rules.js · cad.js · ecg.js · fonts/
```

One Node.js 22 process, standard library only (`node:http`, `node:sqlite`, `node:crypto`). No build step, no npm
dependencies. Every screen is plain HTML, CSS and JavaScript sharing one design system.

## One case per CAD number, the same case on every screen

The CAD number (for example `20261004-0123-1`) is the case identifier: the primary key of `cases`, carried by every
other table. The crew (EMT) enters it manually from the dispatch / MDT information; `public/shared/cad.js` normalises
it the same way on the tablet and the server (`CAD#…`, `cad # …`, spaces, 13 digits → `20261004-0123-1`; shown as
`CAD #20261004-0123-1`). A second case under the same number is never created (CASE ALREADY EXISTS → correct the number
or OPEN EXISTING CASE).

There are no per-role copies: the crew, the ER Doctor and the Cardiologist read the same record, pushed to each screen
that may see it:

| Screen | Sees |
|---|---|
| Crew MDT | its own unit's cases |
| ER Doctor | every case sent to the ER |
| Cardiologist | only cases where cardiology was activated; an ER-closed case only when searched for by CAD number |
| Test console | every case, including those taken off the screens |

Several cases can be open at once (each screen has queues). The test console can take a case off the live screens
(`cases.active = 0`); that never closes its STEMI pathway.

## The state machine (`server/pathway.js`)

The server derives the state from the stored record and checks every action against it before storing it:

```
DRAFT → SENT TO ER → ER REVIEWING ─┬─ NOT SUSPICIOUS FOR STEMI (reason required) → ER REVIEW COMPLETED — CARDIOLOGY NOT ACTIVATED (closed)
                                   └─ ACTIVATE / UNCERTAIN → CARDIOLOGY ACTIVATED → CARDIOLOGIST REVIEWING ─┬─ CONFIRMED STEMI → COMPLETE → COMPLETED (closed)
                                                                                                              ├─ NOT STEMI → PATHWAY CLOSED (closed automatically)
                                                                                                              └─ REPEAT ECG REQUESTED → repeat ECG received → CARDIOLOGIST REVIEWING → …
```

| State key | Derived from |
|---|---|
| `draft` | case created, not yet received (`server_received_at` empty) |
| `sent_to_er` | received; no ER acceptance |
| `er_reviewing` | `er_accepted_at`; no activation |
| `er_closed` | closed with `closure_reason = ER Doctor assessment: NOT SUSPICIOUS FOR STEMI` |
| `cardiology_activated` | `cardiology_activated_at`; not acknowledged |
| `cardiologist_reviewing` | acknowledged; no decision (or the last decision was not a repeat request / confirmation) |
| `repeat_requested` | last decision `repeat`, no ECG newer than the one it covered |
| `repeat_received` | last decision `repeat`, a newer ECG has arrived |
| `confirmed` | last decision `confirm`, not closed |
| `not_stemi_closed` | closed with `closure_reason = Cardiologist decision: NOT STEMI` |
| `completed` | closed by the crew (`closure_source = crew`) |

Refused by the server (HTTP 409/400 with the reason): COMPLETE before CONFIRMED STEMI; NOT SUSPICIOUS without a
reason, or OTHER without an explanation; an ER assessment before acceptance or a second one; any cardiologist action
before activation; a decision before ACKNOWLEDGE & OPEN; a decision or ER assessment naming an ECG older than the
latest (a newer ECG must be reviewed first); any change to a closed case (only viewing and the crew's acknowledgement
of a decision or outcome are still recorded); a duplicate CAD number; an ECG number out of sequence. The ER's NOT
SUSPICIOUS never creates a cardiologist decision.

**Cases made before 0.5.0** went straight to the cardiologist. They have no ER fields and are read as already
cardiology-activated (`legacy: true` in the record): they still open, and are acknowledged and decided as before.

## Data model (new in 0.5.0)

Added to `cases` on start by `server/db.js` (existing rows are kept, nothing is wiped):
`er_alerted_at`, `er_alert_shown_at`, `er_doctor_name`, `er_accepted_at`, `er_assessment` (`activate` · `uncertain` ·
`not_suspicious`), `er_assessment_at`, `er_assessed_by`, `er_assessment_ecg`, `er_non_activation_reason`,
`er_non_activation_comment`, `er_outcome_seen_at`, `cardiology_activated_at`, `cardiology_activation_reason`,
`cardiology_activated_by`, `cardiologist_name`, `cardiologist_acknowledged_at`, `cardiologist_decision`,
`cardiologist_decision_at` — next to the existing `closure_reason`, `closure_source`, `closed_at`, `closed_by`.
New table `ecg_role_views` (first view of each ECG image per role). `audit_events` gains `device`.
The 0.3.0 handover tables (`arrivals`, `handovers`, `final_vitals`) and the 0.4.0 `destinations` / `etas` /
`alert_followups` stay in the schema so older databases open; nothing writes to them any more.

## The live link (`server/live.js`, `public/shared/live.js`)

Server-Sent Events from the server, HTTP POST to it. On connecting a screen gets `init` (server clock, data epoch),
`cfg` (test simulation), `cases` (every open case it may see). After each change the server pushes `case` with the
whole record of that case to every screen allowed to see it (`rec: null` when it leaves the screen). A heartbeat
(`hb`) every few seconds keeps the clocks aligned and proves the link; when it stops, or any request fails, the
screen says CONNECTION LOST — RECONNECTING. The crew tablet says OFFLINE — CHANGES SAVED LOCALLY only when something
is actually waiting on the tablet.

Every request names its screen (`X-Stemi-Role`, or `?role=` on the event stream); the server checks it against that
screen's session.

## Actions (`POST /api/ops`)

Each action is `{ id, cad, k, t, data }`; the id makes a resend harmless (stored once in `ops`).

| Screen | Actions |
|---|---|
| Crew | `submit` (ECG 1 + minimum data), `ecg` (serial / repeat ECG), `img` (another image of a sent ECG), `md` (vital signs update), `rec` (treatment update), `hopen`, `decrcv`, `decack`, `erack`, `note` |
| ER Doctor | `er_shown`, `er_accept {name}`, `er_assess {kind, on, reason, comment, name}`, `viewed`, `compare`, `note` |
| Cardiologist | `shown`, `ack {name}`, `viewed`, `compare`, `decision {k, on, also, reason, note, adv, reasons, instr, within, ai, name}`, `note` |

Plus `POST /api/cases` (create under the CAD number), `GET /api/cases/check`, `POST /api/cases/open` (existing case),
`POST /api/cases/complete` (COMPLETE STEMI PATHWAY), `GET /api/cases?q=` (completed cases by CAD number),
`GET /api/cases/view?cad=` (one case, read-only), `POST /api/images?cad=` (crew), `GET /files/:id` (stored images),
and the test console's `/api/control/*` (console session only).

## Identity (prototype only)

- **Crew:** `crew@test.local` test login, signed cookie (`stemi_sid`).
- **ER Doctor, Cardiologist, test console:** no login. Opening the page gives the browser a signed *device session*
  cookie for that role. The clinician types their name at ACCEPT CASE / ACKNOWLEDGE & OPEN; it is validated (trimmed,
  spaces collapsed, 2–80 characters, must contain letters; `public/shared/rules.js`), remembered in the browser
  session (`sessionStorage`), and recorded per CAD number (`er_doctor_name`, `cardiologist_name`, decision
  `decided_by`, audit `actor`). *Change clinician* is offered when no case is being reviewed.
- A typed name is **not** authentication and gives no identity assurance. Production needs the organisation's identity
  provider (SSO such as Microsoft Entra ID, with staff ID, badge or PIN): see production-gaps.md.

## Alarms

Two alarms, each from the page (Web Audio), each needing one tap on the start screen first (browsers block sound
until then):

- **ER Doctor:** NEW STEMI CASE — from the moment the case reaches the ER screen until an ER Doctor accepts it.
- **Cardiologist:** NEW CARDIOLOGY ACTIVATION — from activation until ACKNOWLEDGE & OPEN.

Nothing else sounds anywhere: AI results, repeat ECGs, vital signs, treatment updates, activation (on the ER screen),
decisions and closures arrive silently. The audit records when each alert was shown (alarm started) and accepted /
acknowledged (alarm stopped).

## The AI interface (`server/ai/`)

`analyse({ecg, previous, unavailable}) → {st, result}`, one analysis per ECG, made once and shown unchanged on the crew,
ER and cardiologist screens. Only the `mock` provider exists: scripted results for the fictional test ECGs; it does not
read images and sends nothing anywhere. A real provider would be a new module with the same contract, selected by
`AI_PROVIDER`. The AI never decides, activates or closes anything.

## The design system (`public/shared/ds.css`)

Tokens (type scale, spacing, radius, surfaces, status colours), then components: top bar, connection status, buttons
(primary, critical, escalate, secondary, quiet; 40–60 px targets), status badges (word + icon + tone), cards, alerts,
forms with linked errors, choice chips and radio lists, key–value data, queues, the pathway progress, the timeline,
dialogs (bottom sheets on a phone), toasts, banners, the ECG viewer (zoom, pan, pinch, full screen, serial compare),
the AI panel, decision panels, the new-case alert band (ER) and the activation layer (cardiologist). Light theme,
local fonts (Public Sans, Atkinson Hyperlegible Mono; OFL).

## Replacing pieces later

The data layer is `server/db.js` (+ `schema.sql`); identity is `server/auth.js`; the AI is `server/ai/`; the live link
is `server/live.js`. Each can be replaced without changing the screens' contract.
