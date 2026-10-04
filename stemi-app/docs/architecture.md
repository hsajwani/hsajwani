# Architecture · test build v0.1

TEST BUILD · FICTIONAL DATA ONLY. This describes the two-device test build, not the production system.

## The pieces

```
 crew MDT page (/crew)            cardiologist page (/cardiologist)        test console (/control)
 public/crew/                     public/cardiologist/                      public/control/
        │  ▲                               │  ▲                                     ▲
 POST   │  │ SSE                    POST   │  │ SSE                                 │ SSE
 /api/ops, /api/images              /api/ops                                       │
        ▼  │                               ▼  │                                     │
 ┌──────────────────────────────── server/index.js (node:http) ──────────────────────────────┐
 │ auth.js      test logins, signed session cookie                                            │
 │ platform.js  the platform rules: Send, updates, alert, acknowledgement, decision, audit    │
 │ ai/          AI service interface; provider "mock"                                         │
 │ live.js      Server-Sent Events: case record broadcast, heartbeat, device presence         │
 │ db.js        node:sqlite → data/stemi-test.db; images → data/images/                       │
 └────────────────────────────────────────────────────────────────────────────────────────────┘
```

Everything runs in one Node.js process on the Mac, from the standard library only (`node:http`, `node:sqlite`,
`node:crypto`). The pages are the approved round-3 prototype's HTML, CSS and JavaScript. In the prototype one page
simulated the platform in memory (`shell.js`) and passed messages between the two device frames; here that simulated
platform is `server/platform.js`, writing to a database, and the two views talk to it over the network.

## One case record, keyed by the CAD number

The CAD number (for example `20261004-0123-1`) is the case identifier. It is the primary key of `cases`, and every other
table carries it. There is no temporary STEMI ID (Q-44). One case is active at a time; the test console's
*New fictional CAD incident* stands in for the CAD feed (how the CAD number reaches the tablet in V1 is Q-70).

## Data model

All times are epoch milliseconds. A new value never replaces an old one: each entry is a new row with who entered it,
when it was taken and when the server received it.

| Table | Holds |
|---|---|
| `cases` | One row per CAD case: unit, crew, incident times, pathway opened, sent, received, acknowledged, opened, compared |
| `patient_details`, `observations` | Minimum dataset and every later vital sign, correction and clarification |
| `treatments` | Medications, treatments, history, risks, condition and comments |
| `ecgs` | ECG 1, 2, 3…: acquisition, send and receipt times, Primary image, who sent it |
| `ecg_images` | Each image of an ECG: file, SHA-256, source (test generator or uploaded file), quality, added after sending |
| `ai_interpretations` | One analysis per ECG: status, start and completion, provider, version, result |
| `cardiologist_alerts`, `alert_followups` | The new-case alert (sent, shown, acknowledged) and any reminders and escalations |
| `ecg_views` | When each ECG image was first opened by the cardiologist |
| `decisions` | CONFIRMED STEMI, NOT STEMI or repeat ECG request, with the cardiologist's identity, time, reason and note, and when the crew saw and acknowledged it |
| `destinations`, `etas` | Destination recommendation and changes, ETA |
| `case_updates` | What the cardiologist sees as NEW, and when it was seen |
| `audit_events` | The audit trail: time, user, action, CAD number |
| `ops` | Every action received from a device, once, with its device time and server receipt time |
| `users`, `settings` | Test users; test console settings |

## The live link

- **Down (server → screens):** Server-Sent Events on `GET /api/stream`. On connection the server sends `init` (server
  clock, CAD number, data epoch), `cfg` (test console settings) and `snap` (the whole case record). After every change
  it sends a new `snap` to every screen, and a heartbeat `hb` every `HEARTBEAT_MS`.
- **Up (screens → server):** each action is a JSON object `{id, cad, k, data, t}` sent to `POST /api/ops`. The `id` is
  unique and stored in `ops`, so a resend after a lost connection is recognised and ignored.
- **Why the whole record:** one case is a few tens of kilobytes, and sending it whole means a screen can never hold a
  partial or out-of-order state. Production with many cases would send per-case changes instead.
- **Connection status:** a screen shows `LIVE — CONNECTED · Last update HH:MM:SS` while events arrive, and
  `CONNECTION LOST · Attempting to reconnect` when the stream errors or no heartbeat arrives for 12 seconds. It
  reconnects by itself, and checks at once when Safari brings the page back to the front.
- **Presence:** the server knows whether the crew tablet and the cardiologist's device are connected (a gap over
  8 seconds counts as offline, so a reload does not). Losing and regaining the connection is written to the audit
  trail; the cardiologist sees *CREW TABLET OFFLINE*.

## Actions

| From | Action (`k`) | What the server does |
|---|---|---|
| Crew | `open` | Records the STEMI pathway opened on the CAD case |
| Crew | `submit` | Stores ECG 1 and its images, the minimum dataset and the provisional destination (placeholder policy), alerts the on-duty cardiologist, starts the AI. The alert never waits for the AI |
| Crew | `ecg` | Stores ECG 2, 3…, marks it NEW for the cardiologist (silent), starts its own AI analysis |
| Crew | `img` | Adds an image to an ECG already sent (not a new ECG) |
| Crew | `md`, `rec` | New vital sign, correction or clarification; medication, treatment, history. Previous values kept |
| Crew | `dest`, `eta` | Destination confirmation or change; ETA and departure |
| Crew | `decrcv`, `decack` | The decision was shown on the tablet; the crew acknowledged it |
| Crew | `downtime`, `note` | Downtime route used; free-text audit note |
| Cardiologist | `shown` | The NEW CARDIAC CASE alert is on screen and the alarm started |
| Cardiologist | `ack` | ACKNOWLEDGE & OPEN: the alarm stops. Recorded separately from any decision |
| Cardiologist | `viewed`, `seen`, `compare` | First view of each ECG image (the first one starts the review), NEW items seen, serial comparison opened |
| Cardiologist | `decision` | CONFIRMED STEMI, NOT STEMI or repeat ECG request, with identity and time. Refused before acknowledgement |
| Cardiologist | `call`, `note` | Call with the crew; free-text audit note |

Each action runs in one database transaction with its audit entries. The server checks the role: a crew login cannot
send a cardiologist action, and the reverse. An action meant for a case that is no longer active is refused.

## Images

The crew page turns an uploaded file into a JPEG of at most 2000 pixels, or makes a fictional ECG image with the test
generator (`public/shared/ecg.js`), and uploads it to `POST /api/images` with progress. The server stores it under
`data/images/`, records its SHA-256, and links it to its ECG when the `submit`, `ecg` or `img` action arrives. Screens
load images from `GET /files/<id>` (logged-in users only). An upload interrupted by a refresh or a lost connection is
retried by the crew page.

## Time

The server's clock is the platform clock: every receipt is stamped by the server. Screens set their clock from the
server's on connection. An entry saved on the tablet without a connection keeps both times, for example
*saved on the tablet 14:24:41, received on reconnection*.

## Offline behaviour

- **Crew:** entries made without a connection are queued in the browser (`localStorage`) in order and sent when the
  link returns. The unsent draft (the ECG being captured, the minimum dataset) also survives a refresh. Everything
  sent is on the server, so a refresh rebuilds the screen from the case record.
- **Cardiologist:** ACKNOWLEDGE & OPEN and the decision need a connection (round-3 choices 6 and 12, Q-71). Without
  one, the alarm continues and the screen says why. If the server does not record an acknowledgement, the alarm comes
  back.

## The alarm

The cardiologist page plays the alarm with Web Audio, only while an unacknowledged NEW CARDIAC CASE alert is on screen.
A tap on the start screen unlocks sound (browsers require a tap), and the audio session is set to playback so that
Safari 17 and later can play with the ring switch on silent. Nothing else ever sounds: later ECGs, images, vital signs,
medication, ETA, destination and AI results arrive silently, marked NEW with their time.

## The AI interface

`server/ai/index.js` chooses the provider named by `AI_PROVIDER`. A provider exports one function:

```js
analyse({ cad, ecg: { n, acq, variant, same, pri, primary: { quality, source, filePath } },
          previous: { n, acq, ai } | null, unavailable })
  → Promise<{ st: 'ok' | 'lim' | 'wh' | 'down',
              result: { q, rhy, rate, ste, std, cond, ser, imp, conf, lim, ver } }>
```

The platform calls it once per ECG after the ECG is stored, saves the result in `ai_interpretations`, and sends the
same analysis to every screen; it is never recalculated per screen and never edited. A failure is recorded as
*AI interpretation unavailable* and never blocks the case. The only provider, `mock`, returns the prototype's scripted
findings for the fictional test ECGs, labelled *SIMULATED AI (mock service, test build) · not a clinical model*. A
validated AI service would be added as another provider with the same contract.

## Login

`server/auth.js` checks the email and password against `users` (scrypt hash) and issues an HMAC-signed, HttpOnly
cookie valid for `SESSION_HOURS`. The rest of the server only calls `currentUser(req)`, which returns
`{ id, email, role, name, title, org, unit, emirate }`. National Ambulance single sign-on would replace this file.

## Replacing pieces later

| Piece | Test build | Later |
|---|---|---|
| Database | SQLite file, `server/db.js` | PostgreSQL behind the same small data layer |
| Login | Two test users, `server/auth.js` | National Ambulance SSO |
| Alerting | Browser sound while the page is open | Managed push and escalation with proof of delivery |
| AI | `mock` provider | Validated AI service as a provider, introduced in stages |
| CAD number | Test console's simulated feed | CAD integration or the V1 route decided under Q-70 |
| Transport | Plain HTTP on the local Wi-Fi | HTTPS on approved hosting |
