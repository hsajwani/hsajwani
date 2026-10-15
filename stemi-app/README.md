# STEMI Coordination Platform · test build

**Version 0.5.0 · 15 October 2026 · Crew → ER Doctor → Cardiologist**

> **TEST BUILD · FICTIONAL DATA ONLY.** Use only fictional patients, simulated CAD numbers, sample ECG images and the
> test users. Never enter real patient information: this build runs over plain HTTP on a local network and has no
> production security. The ECG AI is a **simulation**, not a clinical model. Not for clinical use.
>
> **Prototype clinician identification only.** The ER Doctor and the Cardiologist type their name; it is recorded
> against each CAD number. A typed name is **not** secure authentication and gives no identity assurance. Production
> needs the organisation's identity provider — hospital / National Ambulance single sign-on (for example Microsoft
> Entra ID), staff ID, badge or PIN. See [docs/production-gaps.md](docs/production-gaps.md).

A narrow, time-critical STEMI coordination platform. It is **not** an ePCR, an ICCC / CAD replacement, a hospital EMR
or a handover form. One case per CAD number travels the whole pathway and every screen sees the same case:

```
CREW: open the STEMI pathway → CAD number → ECG → minimum data → SEND
  → ER DOCTOR: alarm → ACCEPT CASE (name) → review → ACTIVATE CARDIOLOGIST · UNCERTAIN — ACTIVATE · NOT SUSPICIOUS (reason)
      → CARDIOLOGIST (only if activated): alarm → ACKNOWLEDGE & OPEN (name) → CONFIRMED STEMI · NOT STEMI · REPEAT ECG
          → CREW: COMPLETE STEMI PATHWAY after CONFIRMED STEMI · NOT STEMI closes automatically · repeat ECG → next decision
```

| Screen | Address | Device |
|---|---|---|
| Choose a screen | `http://localhost:3000/` | any |
| Crew MDT | `http://localhost:3000/crew` | landscape tablet first; desktop and portrait work too. Crew test login. |
| ER Doctor | `http://localhost:3000/er` | desktop or tablet. No login: type your name when accepting a case. |
| Cardiologist | `http://<the Mac's IP>:3000/cardiologist` | phone first (iPhone, Safari); tablet and desktop work too. No login. |
| Test console | `http://localhost:3000/control` | TEST ONLY: demo cases, simulations, devices, audit trail, reset. |
| Health | `http://localhost:3000/health` | status and version; no case, user or secret information. |

---

## 1. Start on a Mac

You need Node.js 22.13 or later (`node --version`); nothing else is installed — the app has no dependencies.

```bash
cd ~/Documents
git clone -b claude/magical-faraday-sjzcvc https://github.com/hsajwani/hsajwani.git   # first time only
cd hsajwani/stemi-app
npm run dev:bg          # start the development server in the background (keeps running after Terminal closes)
npm run dev:status      # running? port? the addresses for the Mac and the iPhone
```

If macOS asks *"Do you want the application node to accept incoming network connections?"*, click **Allow** (the
iPhone needs it). The database is created in `data/` on first start and kept across restarts.

### The development runner

| Command | What it does |
|---|---|
| `npm run dev:bg` | start in the background (one copy only; a running one is reported, nothing else is stopped) |
| `npm run dev:status` | running? pid, port, uptime, version, the addresses |
| `npm run dev:restart` | stop and start again (rarely needed) |
| `npm run dev:stop` | stop it |
| `npm run dev` | the same server in the foreground (Ctrl+C stops it) |

- A **backend change** (`server/`, `public/shared/cad.js`, `public/shared/rules.js`, `package.json`, `.env`) restarts
  the server by itself. A **screen change** needs only a browser refresh. A crash is restarted.
- **The test data is kept.** A restart is never a reset; only *Delete all test data* (console) or `npm run reset`
  (server stopped) clears it.
- **Log:** `.local/stemi-dev.log` (starts, restarts and why, errors, live-link connections; no passwords, cookies or
  secrets). `.local/` is not committed.
- **Changes from Claude Code arrive by themselves** with `DEV_AUTO_PULL=true` in `.env` (copy `.env.example` first);
  otherwise run `git pull`.

### Opening the screens

- **Crew (Mac):** <http://localhost:3000/crew>, log in as **crew@test.local** / **stemi-test** (*Fill in the test
  user*). Full screen with Ctrl+Cmd+F if you like; the layout fits the window (no scaled device frame).
- **ER Doctor (Mac, second window, or another computer / tablet):** <http://localhost:3000/er>. Tap
  **START · ENABLE ALARM SOUND** (browsers allow sound only after a tap; needed after each reload).
- **Cardiologist (iPhone, same Wi-Fi):** in Safari type the *Cardiologist on iPhone* address that `npm run dev:status`
  prints, for example `http://192.168.1.23:3000/cardiologist`. Tap **START · ENABLE ALARM SOUND**. For the test: silent
  mode off, volume up, Auto-Lock → Never, Safari in front. A locked phone or a background page cannot sound the alarm in
  this test build.
- **Test console:** <http://localhost:3000/control>.

---

## 2. The workflow, screen by screen

### Crew MDT

1. **Home:** *Active cases*, *Completed cases* (search by CAD number) and **NEW STEMI CASE**. An unsent case is kept
   on the tablet and shown here (*Continue the unsent case* / *Discard*).
2. **New STEMI case — one pathway in four steps** (left: the steps; each shows its status):
   1. **CAD number**, typed from the dispatch / MDT information. Accepted: `CAD#20261004-0123-1`, `cad # 20261004-0123-1`,
      `20261004-0123-1`, extra spaces, `2026100401231`. Stored as `20261004-0123-1`, shown as `CAD #20261004-0123-1`.
      An invalid number is refused with the reason. Online, an existing case under the number gives **CASE ALREADY
      EXISTS** → *Correct the CAD number* or **OPEN EXISTING CASE** (no second case, nothing changed). Offline, the number
      is kept and checked at SEND. Nothing generates CAD numbers.
   2. **ECG 1:** **+ ADD ECG IMAGE** — take a photo (tablet camera), choose an image file, or use a fictional test ECG
      image. Several images per ECG (Image 1 is the Primary). The acquisition time is the first image's time; *Change
      time* asks why. An unsent image can be removed (with confirmation); nothing is replaced or deleted after SEND.
   3. **Minimum data:** age (or estimated, or Unknown), sex, presenting complaint (or Other, described), symptom onset
      (time, quick *N min ago*, Approximate, or Unknown), BP, HR, SpO₂, GCS — each with Not obtained / Unable — plus the
      crew / unit (from the MDT login) and the ECG acquisition time. Every item needs an answer; errors are shown next
      to the field.
   4. **Review and SEND TO ER.** The ER is alerted at once; the Cardiologist is **not** alerted at this stage.
3. **The live case:** the pathway progress **CREW → ER → CARDIOLOGY → DECISION**, a status panel in plain words, the
   ECGs, the patient and vital signs, the AI decision support and the timeline. Status texts: SENT TO ER · ER DOCTOR
   REVIEWING · ER REVIEW COMPLETED / CARDIOLOGY NOT ACTIVATED · CARDIOLOGY ACTIVATED · CARDIOLOGIST REVIEWING · REPEAT ECG
   REQUESTED · REPEAT ECG SENT — CARDIOLOGIST REVIEWING · CONFIRMED STEMI · NOT STEMI / PATHWAY CLOSED · STEMI PATHWAY
   COMPLETED.
4. **After SEND** the CAD number and the sent data are locked. The crew can add **vital signs** (new readings; earlier
   values kept), a **treatment update**, another **image** of a sent ECG, and a **new / repeat ECG** (ECG 2, 3 …). They
   reach the ER and the Cardiologist silently.
5. **Outcomes arrive at once** and are acknowledged by the crew (no sound): the ER's *ER REVIEW COMPLETED / CARDIOLOGY
   NOT ACTIVATED* (with the reason), and each cardiologist decision.
6. **COMPLETE STEMI PATHWAY** — only while the current decision is CONFIRMED STEMI: *"COMPLETE STEMI PATHWAY? This
   will close the STEMI pathway for: CAD #… The STEMI case will remain available as read-only."* CANCEL / COMPLETE.
   Nothing to fill in: hospital, arrival, handover, receiving clinician, final vital signs, ePCR or transport status
   belong to ICCC and the ePCR and are never asked here.
7. **Case Summary** (read-only, nothing to fill in): CASE · ER REVIEW · CARDIOLOGY · ECGs · TIMELINE.

### ER Doctor

1. **New case alarm:** when a crew sends a case, a red band shows **NEW STEMI CASE — AWAITING ER ACCEPTANCE** with the
   CAD number, the patient basics, the ECG acquisition time and the unit, and the alarm sounds. It continues until an
   ER Doctor presses **ACCEPT CASE**. Nothing else ever sounds on this screen.
2. **ACCEPT CASE → ENTER YOUR NAME** (for example *Dr. Ahmed Mohammed*) **→ ACCEPT CASE.** The name must not be blank
   (2–80 characters, with letters; trimmed). It is remembered for this browser session, so the next case is accepted at
   once (*Accepting as Dr. … · Not you? Change clinician*). Each CAD number records who accepted it and when:
   **ACCEPTED BY Dr. … · Accepted at HH:MM**. **Change clinician** is in the top bar whenever no case is being
   reviewed.
3. **Review:** the original ECG at full width at once (ECG 1 / 2 / 3, every image, zoom, pan, full screen, compare),
   the patient strip, the full minimum data with times and earlier values, the crew / unit, the AI decision support,
   and the timeline.
4. **The ER assessment — a screening decision, not a STEMI diagnosis** (it must cover the latest ECG, which must have
   been viewed):
   - **ACTIVATE CARDIOLOGIST** — the same case goes to the Cardiologist queue at once, with an alarm there. The crew
     sees CARDIOLOGY ACTIVATED.
   - **UNCERTAIN — ACTIVATE CARDIOLOGIST** — activates at once; recorded as *ER Assessment: UNCERTAIN, Cardiology:
     ACTIVATED*.
   - **NOT SUSPICIOUS FOR STEMI** — opens **NOT SUSPICIOUS FOR STEMI — REASON REQUIRED**: ECG DOES NOT MEET STEMI
     CRITERIA · ALTERNATIVE DIAGNOSIS SUSPECTED · ECG CHANGES NOT CONSISTENT WITH ACUTE STEMI · CLINICAL PRESENTATION
     NOT CONSISTENT WITH STEMI · POOR ECG QUALITY — NOT DIAGNOSTIC · OTHER (explanation required; an optional comment
     for the others). The summary reads *ER REVIEW — CARDIOLOGY NOT ACTIVATED · Reason · Comment*; CONFIRM stays
     blocked until the reason (and the OTHER text) is given. CONFIRM closes the STEMI screening pathway (read-only,
     moved to Completed). The Cardiologist is never notified and no cardiologist decision is created. The crew sees
     **ER REVIEW COMPLETED / CARDIOLOGY NOT ACTIVATED** — never "NOT STEMI". The CAD incident is not changed.
5. **Queues:** New — awaiting acceptance · Active review · Cardiology activated / ongoing · Completed (search by CAD).
   After the assessment the ER keeps seeing the case silently: acknowledgement, decisions, repeat ECGs, closure.

### Cardiologist

1. **NEW CARDIOLOGY ACTIVATION** covers the screen with the alarm: CAD number, patient basics, the ER Doctor, the ER
   assessment (ACTIVATE or UNCERTAIN), when cardiology was activated and the ECG acquisition time. Only ER-activated
   cases ever reach this screen.
2. **ACKNOWLEDGE & OPEN → ENTER YOUR NAME → ACKNOWLEDGE & OPEN** (same name rules and session memory as the ER;
   *Change clinician* on the queue). The alarm stops; nothing else sounds for that case. Acknowledging is not a decision.
3. **The case:** the ER line (ER Doctor, acceptance, assessment, activation), the original ECG first, the patient strip,
   the clinical details, the AI decision support (collapsed on a phone), the timeline. On a phone the decision is
   docked at the bottom; on a tablet or desktop it is beside the ECG.
4. **Decisions (two steps, so an accidental decision is hard; each covers the latest ECG, which must have been
   viewed):**
   - **CONFIRMED STEMI** (optional note to the crew, optional AI feedback) — stays active; the crew can COMPLETE.
   - **NOT STEMI** (reason required) — the decision is stored, then the STEMI pathway closes automatically as a
     separate event (`Cardiologist decision: NOT STEMI` · `automatic following Cardiologist decision`): read-only,
     Completed, no cath-lab activation; the crew sees NOT STEMI / PATHWAY CLOSED. Never "CAD CANCELLED".
   - **UNCLEAR — REQUEST REPEAT ECG** (optional reasons, instruction, *within N min*) — stays active; the crew sees
     REPEAT ECG REQUESTED; COMPLETE is unavailable; the repeat ECG arrives silently on the ER and Cardiologist screens
     (announced, never swapped in); then the next decision. Every decision is kept.
5. **Queues:** New cardiology activations · Active review · Repeat ECG requested / active · Completed cardiology cases.
   Searching by CAD number also finds ER-closed cases, shown as **CARDIOLOGY NOT ACTIVATED** (no cardiologist
   involvement implied).

### The STEMI pathway's states

`DRAFT → SENT TO ER → ER REVIEWING →` either `ER REVIEW COMPLETED — CARDIOLOGY NOT ACTIVATED` (closed), or
`CARDIOLOGY ACTIVATED → CARDIOLOGIST REVIEWING →` `CONFIRMED STEMI → COMPLETE → COMPLETED` · `NOT STEMI → PATHWAY CLOSED`
· `REPEAT ECG REQUESTED → repeat ECG received → CARDIOLOGIST REVIEWING → next decision`.

The server derives the state and refuses what the state does not allow (complete before CONFIRMED STEMI, NOT
SUSPICIOUS without a reason, a cardiologist decision before activation, any change to a closed case, a duplicate CAD
number, jumping from SENT TO ER to a decision …). The STEMI pathway status is not the ICCC / CAD incident status:
closing the pathway never changes the CAD incident. Details: [docs/architecture.md](docs/architecture.md).

### Completed cases

ER-closed, NOT STEMI and completed cases move to *Completed* on every screen that saw them, open read-only by CAD
number, and the server refuses any change. There is no amendment workflow in this build.

### Realtime and alarms

Everything travels live without a refresh: SEND → ER; acceptance → crew; activation → crew and cardiologist;
acknowledgement → crew and ER; decisions → crew and ER; repeat ECG, vital signs and treatment updates → ER and
cardiologist; closure → everyone. Only two alarms exist — the ER's NEW STEMI CASE (until accepted) and the
cardiologist's NEW CARDIOLOGY ACTIVATION (until acknowledged). The connection status says CONNECTED, CONNECTION LOST —
RECONNECTING, or (crew, only when something is waiting on the tablet) OFFLINE — CHANGES SAVED LOCALLY.

### AI decision support (simulated)

A mock service (`server/ai/mock.js`) returns scripted findings for the fictional test ECGs; it does not read images and
sends nothing anywhere — no external AI service is connected and no ECG data leaves the server. One analysis per ECG,
shown unchanged to the crew, the ER and the cardiologist in a compact panel (rhythm, rate, ST, reciprocal, other,
overall) with: *"AI interpretation is decision support. The Cardiologist makes the final STEMI decision."* The AI
never activates cardiology, decides or closes anything. The interface (`server/ai/index.js`) is replaceable.

---

## 3. The test console (`/control`, TEST ONLY)

- **Cases:** every case with its status; **Take off screens / Return to screens** (hides a test case from the live
  screens; it stays in the database and its STEMI pathway is **not** closed).
- **Selected case:** the pathway timestamps (with intervals) and the full audit trail (time, person, role, action).
- **Test data:** a **pre-filled demo case** sent to the ER under a CAD number you type (checked like the crew's entry);
  **Delete all test data** (with confirmation; the crew test user stays).
- **Simulation:** test ECG findings, the next test photo's quality, the mock AI (completes / unavailable / stays
  processing).
- **Devices and server:** which screens are connected, the iPhone / ER addresses, the server version and uptime.

## 4. Tests

Each suite starts its own server on a random port with a temporary database: the development server and `data/` are
not touched. Browser suites need Playwright with Chromium (`npm install -g playwright && npx playwright install
chromium`; in the Claude Code cloud container run them with `NODE_PATH=$(npm root -g)`).

| Command | What it checks |
|---|---|
| `npm run test:api` | the server's rules through the API: every allowed transition and every refusal, closed-case security, name validation, roles, the console, a 0.4.0 case still opening |
| `npm run test:acceptance` | three browsers at once (crew tablet, ER desktop, cardiologist phone): SEND → ER alarm → accept → activate → cardiologist alarm → acknowledge → repeat ECG → CONFIRMED STEMI → COMPLETE, realtime, alarm rules |
| `npm run test:pathway` | UNCERTAIN, NOT SUSPICIOUS with a reason and with OTHER, NOT STEMI, names per CAD number (ER and cardiologist), searching completed cases |
| `npm run test:cad` | CAD number entry and normalisation, CASE ALREADY EXISTS, the unsent case across a reload, offline SEND and offline updates |
| `npm run test:visual` | screenshots of every major screen at desktop, tablet, portrait and phone sizes (`scripts/out/visual/`) with checks for overflow, tap-target size, alt text and accessible names |
| `npm test` | api, acceptance, pathway and cad in a row |

The 17 required scenarios: 1, 2, 3, 7, 8, 10, 11, 15, 16, 17 in `test:acceptance`; 4, 5, 6, 9, 12, 13 in
`test:pathway`; 14 and 15 in `test:api` (as well as the rules behind all of them).

## 5. Settings (`.env`, see `.env.example`)

| Variable | Default | What it does |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | where the server listens (`0.0.0.0` lets the iPhone connect) |
| `TEST_USER_PASSWORD` | `stemi-test` | the crew test user's password |
| `SESSION_SECRET` | generated | signs the crew login and the device sessions; generated once in `data/.session-secret` |
| `SESSION_HOURS` | `24` | crew login duration |
| `DATA_DIR` | `data` | the SQLite database and the ECG images |
| `AI_PROVIDER` / `MOCK_AI_DELAY_MS` | `mock` / `5000` | the simulated AI and how long it "processes" |
| `HEARTBEAT_MS` | `5000` | live-link heartbeat |
| `MAX_IMAGE_BYTES` | 8 MB | largest ECG image accepted |
| `DEV_AUTO_PULL` | `false` | the development runner fast-forwards this checkout from GitHub every 30 s |

Never put real secrets or patient data in `.env` (it is not committed).

## 6. The database

One SQLite file, `data/stemi-test.db`; ECG images in `data/images/` with their SHA-256 in the database. Starting a new
version **adds columns, it never wipes data**: cases made before 0.5.0 (no ER step) still open, read as sent directly
to the cardiologist. New in 0.5.0 on `cases`: the ER fields (`er_doctor_name`, `er_accepted_at`, `er_assessment`,
`er_assessment_at`, `er_non_activation_reason`, `er_non_activation_comment`, …), the cardiology fields
(`cardiology_activated_at`, `cardiology_activation_reason`, `cardiologist_name`, `cardiologist_acknowledged_at`,
`cardiologist_decision`, `cardiologist_decision_at`) beside `closure_reason`, `closure_source`, `closed_at`. The old
handover, destination and ETA tables stay so older databases open; nothing uses them. Full list:
[docs/architecture.md](docs/architecture.md). Look inside with `sqlite3 data/stemi-test.db`.

The audit trail (`audit_events`) records every significant event with time, CAD number, person, role (crew, er,
cardiologist, system, test-console) and action — for example *STEMI case opened … · CAD number manually entered by crew
from dispatch/MDT information*, *ER Doctor accepted the case: Dr. … · audible alarm stopped*, *ER Doctor assessment:
NOT SUSPICIOUS FOR STEMI — Dr. …*, *Reason: …*, *Cardiology not activated*, *STEMI screening pathway closed following
ER Doctor assessment*.

## 7. Project structure

```
stemi-app/
├── server/            index.js (routes) · auth.js (crew login, device sessions) · pathway.js (state machine)
│                      platform.js (actions, audit, alerts, snapshots, pushes) · live.js (SSE) · db.js · schema.sql
│                      seed.js · config.js · ai/ (interface + mock)
├── public/
│   ├── index.html     choose a screen
│   ├── crew/ er/ cardiologist/ control/ login/
│   └── shared/        ds.css (design system) · ui.js · clinical.js (ECG viewer, AI panel, timeline, summary, alarm)
│                      live.js · rules.js (names, ER reasons, state labels) · cad.js · ecg.js (fictional ECGs) · fonts/
├── scripts/           dev.js (runner) · reset.js · tests (api, acceptance, pathway, cad-entry, visual-qa, lib/)
├── samples/           fictional test ECG images
└── docs/              architecture.md · open-decisions.md · production-gaps.md
```

## 8. Troubleshooting

| Problem | What to do |
|---|---|
| The iPhone cannot open the page | Same Wi-Fi for both; type the address with `http://` and the port. Guest / office Wi-Fi often blocks device-to-device traffic: try the iPhone's Personal Hotspot. **System Settings → Network → Firewall** must allow `node`; on macOS 15+ **Privacy & Security → Local Network** must allow Terminal. Check `http://<Mac IP>:3000/health` from the iPhone. |
| No alarm sound | Tap START · ENABLE ALARM SOUND after every reload; silent mode off, volume up, page in front. A red banner means sound is blocked: tap it. |
| CONNECTION LOST | The server stopped, the Mac slept or the Wi-Fi changed: `npm run dev:status`; the screens reconnect by themselves. |
| Port in use | `npm run dev:status` tells whether it is this server; otherwise set another `PORT` in `.env`. |
| Start again with no cases | Test console → **Delete all test data**, or `npm run dev:stop && npm run reset && npm run dev:bg`. |

## 9. Known limits

- The alarms are browser sounds: they need the page open, in front, screen on. Production needs managed push with
  proof of delivery and escalation (not set: governance).
- Plain HTTP on the local network; fictional data only.
- Clinician identification is a typed name (see the top of this file). One crew unit (Ambulance 214). Every ER screen
  sees every sent case; every cardiologist screen sees every activation.
- The CAD number is checked for format and duplicates, not against dispatch (no CAD integration).
- No reminders or escalation; no destination / ETA (ICCC); no cath-lab or hospital screens; no amendment of closed
  cases.
- The simulated AI does not read images (for an uploaded file it says so).

## 10. What changed in 0.5.0

- **New ER Doctor step and screen (`/er`)** between the crew and the cardiologist, with its own alarm, name
  identification, the three assessments and the reason-required NOT SUSPICIOUS FOR STEMI closure.
- **The cardiologist receives only ER-activated cases**; no login (name per CAD number); queues; the decisions are
  unchanged.
- **Several cases at once** on every screen, with queues; per-role visibility; the server is the authority (state
  machine, `server/pathway.js`).
- **Complete redesign** on one design system (`public/shared/ds.css`): fluid layouts instead of scaled device frames,
  status badges with words and icons, accessible forms and dialogs, a new ECG viewer (zoom, pan, pinch, full screen,
  serial compare), a compact AI panel, a plain-words clinical timeline, the crew's pathway progress.
- **Removed:** the crew's destination / ETA and the *Complete the record* documentation (ICCC and ePCR own them; a
  short treatment update stays), the call simulation, reminder / escalation buttons, screen-ID debug tags, the
  cardiologist's login.
- **Audit wording:** *CAD number manually entered by crew from dispatch/MDT information*.
- Earlier versions: 0.4.0 closed the STEMI pathway without handover documentation (COMPLETE STEMI PATHWAY, NOT STEMI
  auto-close); 0.2.0 made the CAD number a manual crew entry. The 0.3.0 handover page and the direct crew → cardiologist
  route are gone.

Open decisions: [docs/open-decisions.md](docs/open-decisions.md). Before production: [docs/production-gaps.md](docs/production-gaps.md).
