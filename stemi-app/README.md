# STEMI Coordination Platform · test build

**Version 0.6.1 · 15 October 2026 · corpuls → Crew → ER Doctor → Cardiologist**

> **TEST BUILD · FICTIONAL DATA ONLY.** Use only fictional patients, simulated CAD numbers, sample ECG images and the
> test users. Never enter real patient information: this build runs over plain HTTP on a local network and has no
> production security. The ECG AI is a **simulation**, not a clinical model. Not for clinical use.
>
> **The corpuls integration is simulated.** The ECGs and vital signs come from a simulated corpuls feed
> (*MockCorpulsProvider*). In its **demo mode** (the default) the demonstration runs by itself: LINK CORPULS connects
> the simulated monitor, the live values appear and ECG 1 arrives a few seconds later. **No real corpuls monitor and no
> corpuls.mission environment is connected**, no vendor API is used, and nothing leaves the server. The real connection
> (*RealCorpulsMissionProvider*) is a placeholder until MEAD / corpuls provide the interface. National Ambulance and
> MEAD have not approved a real integration. Details: [docs/corpuls-integration.md](docs/corpuls-integration.md).
>
> **Prototype clinician identification only.** The ER Doctor and the Cardiologist type their name; it is recorded
> against each CAD number. A typed name is **not** secure authentication and gives no identity assurance. Production
> needs the organisation's identity provider — hospital / National Ambulance single sign-on (for example Microsoft
> Entra ID), staff ID, badge or PIN. See [docs/production-gaps.md](docs/production-gaps.md).

A narrow, time-critical STEMI coordination platform. It is **not** an ePCR, an ICCC / CAD replacement, a hospital EMR
or a handover form. One case per CAD number travels the whole pathway and every screen sees the same case. The ECG and
the vital signs come from the monitor; the crew adds only what the monitor cannot know:

```
CORPULS 3 → corpuls.mission → STEMI PLATFORM → ER DOCTOR → CARDIOLOGIST → STEMI DECISION
(simulated in this build: MockCorpulsProvider; in demo mode it plays the monitor by itself)

CREW: OPEN STEMI PATHWAY → CAD number → LINK CORPULS → CORPULS CONNECTED → ECG 1 arrives → vital signs arrive
      → age, sex, complaint, onset → SEND TO ER
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
| Test console | `http://localhost:3000/control` | TEST ONLY: the CORPULS SIMULATOR, demo cases, simulations, devices, audit trail, reset. |
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
- **Test console:** <http://localhost:3000/control>. Its **CORPULS SIMULATOR** plays the crew's monitor: connect it,
  trigger the 12-lead ECGs, change the vital signs, lose and restore the connection (section 3).

---

## 2. The workflow, screen by screen

### Crew MDT

The crew screen is built around the corpuls feed: very little is entered by hand.

1. **Home:** **OPEN STEMI PATHWAY**, *Active cases*, *Completed cases* (search by CAD number). An unsent case is kept
   on the tablet and shown here (*Continue the unsent case* / *Discard*).
2. **CAD number**, typed from the dispatch / MDT information. Accepted: `CAD#20261004-0123-1`, `cad # 20261004-0123-1`,
   `20261004-0123-1`, extra spaces, `2026100401231`. Stored as `20261004-0123-1`, shown as `CAD #20261004-0123-1`. An
   invalid number is refused with the reason; an existing case gives **CASE ALREADY EXISTS** → *Correct the CAD
   number* or **OPEN EXISTING CASE** (no second case). Nothing generates CAD numbers.
3. **LINK CORPULS** creates the (still unsent) case on the platform and links it to the unit's corpuls3. The bar
   shows the feed starting, step by step: **CONNECTING TO CORPULS…** (✓ CAD linked), then **CORPULS CONNECTED ·
   CAD #…** with a small *Simulated corpuls feed* tag (✓ Corpuls connected · ✓ Live vitals received · Receiving ECG 1
   → ✓ ECG 1 received). Every monitor update from then on attaches to this CAD number; an update never creates a new
   case. Until SEND the case is not visible to the ER. The number can still be corrected (*Change* → **SAVE CAD NUMBER**): the case
   and its corpuls data move with it.
4. **The vital signs arrive by themselves:** HR, SpO₂, BP (with its measurement time) and RR in a compact panel, **LIVE
   FROM CORPULS · Updated N s ago** (about a second after LINK CORPULS in the demo). Old values are never shown as
   current: *LAST DATA RECEIVED hh:mm:ss* when no new values arrive (a technical indicator, not a clinical rule).
5. **The ECG arrives by itself:** while it comes the card says **RECEIVING 12-LEAD ECG FROM CORPULS…**; then the 12-lead
   appears large, **ECG 1 RECEIVED FROM CORPULS · Acquired hh:mm:ss** (in the demo about 3 s after CORPULS CONNECTED).
   Nothing to photograph or upload.
6. **The crew enters only four items:** age (or estimated, or Unknown), sex, presenting complaint (or Other,
   described) and symptom onset (time, *N min ago*, Approximate, or Unknown). The crew / unit comes from the MDT login.
7. **SEND TO ER** (one button, always at hand) becomes available when the CAD number is valid, an ECG exists and the
   four items are answered; a list beside it shows what is still missing. The vital signs are not confirmed by the
   crew: the latest monitor values travel with the case automatically, with their time. The ER is alerted at once;
   the Cardiologist is **not** alerted at this stage.
8. **After SEND the crew follows the status:** the pathway progress **CREW → ER → CARDIOLOGY → DECISION**, a status
   panel in plain words (SENT TO ER · ER DOCTOR REVIEWING · ER REVIEW COMPLETED / CARDIOLOGY NOT ACTIVATED · CARDIOLOGY
   ACTIVATED · CARDIOLOGIST REVIEWING · REPEAT ECG REQUESTED · REPEAT ECG SENT — CARDIOLOGIST REVIEWING · CONFIRMED STEMI
   · NOT STEMI / PATHWAY CLOSED · STEMI PATHWAY COMPLETED), the ECGs, the live monitor values, the AI decision support
   and the timeline. Monitor updates are never acknowledged; only the ER's outcome and each cardiologist decision are
   (no sound).
9. **Repeat ECGs:** when the Cardiologist requests one, the crew is told to *acquire a new 12-lead on corpuls3*. ECG 2
   (3 …) attaches to the same CAD number by itself and reaches the ER and the Cardiologist silently. Earlier ECGs are
   never overwritten. In the demo, no physical corpuls3 is connected, so the status panel offers **SIMULATE REPEAT ECG
   ACQUISITION** (*prototype only*): it stands in for the 12-lead acquired on the monitor, and ECG 2 then arrives from
   the simulated corpuls feed — it is not an upload.
10. **Manual fallback (secondary):** *Manual ECG fallback* (photograph or upload the 12-lead) and *Enter vital signs
    manually (fallback)* stay available as a quiet link while the feed works. They become prominent only when corpuls
    cannot deliver: **CORPULS CONNECTION LOST · Last data received hh:mm:ss · MANUAL FALLBACK AVAILABLE**, corpuls not
    connecting at all (*CORPULS NOT CONNECTED*), the feed ended on an open case, or no connection to the platform. A fallback ECG is recorded as *manual fallback* and audited (*Manual ECG fallback used*). A lost
    connection never closes the pathway, cancels the case or triggers a decision.
11. **COMPLETE STEMI PATHWAY** — only while the current decision is CONFIRMED STEMI: *"COMPLETE STEMI PATHWAY? This
    will close the STEMI pathway for: CAD #… The STEMI case will remain available as read-only."* CANCEL / COMPLETE.
    Closing ends the corpuls feed (the last values are kept). Nothing to fill in: hospital, arrival, handover,
    receiving clinician, final vital signs, ePCR or transport status belong to ICCC and the ePCR.
12. **Case Summary** (read-only, nothing to fill in): CASE (with the latest monitor data, its time, and the monitor
    feed) · ER REVIEW · CARDIOLOGY · ECGs (each with its source: from corpuls or manual fallback) · TIMELINE. It is not
    an ePCR.

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
   each with its source and acquisition time; the patient strip with the latest monitor values (*corpuls · N s ago*);
   the clinical details (the four crew items, the vital signs from corpuls with their times and earlier readings, the
   ECG acquisition list, the crew / unit); the AI decision support and the timeline. When the feed drops: **LIVE
   MONITOR DATA TEMPORARILY UNAVAILABLE · Last data received hh:mm:ss** (the last values stay, with their time).
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
3. **The case:** the ER line (ER Doctor, acceptance, assessment, activation), the original ECG first, the patient strip
   with the latest monitor values, the clinical details, the AI decision support (collapsed on a phone), the timeline.
   On a phone the decision is docked at the bottom; on a tablet or desktop it is beside the ECG. Monitor updates and
   repeat ECGs arrive silently; LIVE MONITOR DATA TEMPORARILY UNAVAILABLE when the feed drops.
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
acknowledgement → crew and ER; decisions → crew and ER; corpuls ECGs, monitor values and connection changes, and
treatment updates → every screen that sees the case; closure → everyone. Monitor values travel as a small `monitor`
event (not the whole case). Only two alarms exist — the ER's NEW STEMI CASE (until accepted) and the
cardiologist's NEW CARDIOLOGY ACTIVATION (until acknowledged). The connection status says CONNECTED, CONNECTION LOST —
RECONNECTING, or (crew, only when something is waiting on the tablet) OFFLINE — CHANGES SAVED LOCALLY.

### AI decision support (simulated)

A mock service (`server/ai/mock.js`) returns scripted findings for the fictional test ECGs (for a corpuls ECG: the
findings scripted for its sample, with the rate the monitor reported); it does not read images and sends nothing
anywhere — no external AI service is connected and no ECG data leaves the server. One analysis per ECG,
shown unchanged to the crew, the ER and the cardiologist in a compact panel (rhythm, rate, ST, reciprocal, other,
overall) with: *"AI interpretation is decision support. The Cardiologist makes the final STEMI decision."* The AI
never activates cardiology, decides or closes anything. The interface (`server/ai/index.js`) is replaceable.

---

## 3. The simulated corpuls integration

- **What is simulated:** the crew's corpuls3 and corpuls.mission. Each unit has one simulated monitor (Ambulance 214 →
  `SIM-C3-214`). Its values are fictional and never random: HR and SpO₂ move gradually towards the values set in the
  simulator, RR changes every 30 s, the non-invasive BP is measured every `CORPULS_SIM_NIBP_SECONDS` (default 2 min) and
  keeps its measurement time. A 12-lead is a synthetic ECG drawn by the server from internal samples (*ECG Sample A /
  B / C*), marked FICTIONAL TEST DATA · NOT A PATIENT, at the monitor's current heart rate; in demo mode ECG 1 comes by
  itself and a repeat from the crew screen's simulated acquisition, otherwise when the tester triggers it. The samples
  are not validated diagnoses.
- **The architecture:** `server/integrations/corpuls/` holds the provider contract (`contract.js`: the provider
  interface and the normalized events VITALS_UPDATED, ECG_ACQUIRED, CORPULS_CONNECTION_CHANGED with the states
  waiting · connected · reconnecting · disconnected), **MockCorpulsProvider** (`mock-provider.js`, `mock-ecg.js`) and
  **RealCorpulsMissionProvider** (`real-provider.js`, a placeholder: not implemented, no network call).
  `server/monitor.js` is the platform's side: it checks every event (the CAD number exists, the case is open, the
  monitor is the one linked), stores each ECG once and numbers it, keeps the latest values with their time and a light
  history, and audits only the significant moments. The screens see only the case record. `CORPULS_PROVIDER` picks the
  provider.
- **Manual upload is the fallback only.** The primary path is the feed; the photo / upload of the 12-lead and the
  manual vital signs remain for when corpuls is not available.
- **What MEAD / corpuls must still provide** before a real provider can be written: authentication, API
  documentation, the ECG and vital-signs payload formats and units, the event / webhook mechanism (push or poll,
  ordering, delivery guarantees, resend), the CAD / mission mapping, device and unit identifiers, sandbox / test
  access and test devices, data retention, connection / retry / heartbeat requirements, clock synchronisation, and the
  security and data-protection approvals. The full list and the platform's own open questions:
  [docs/corpuls-integration.md](docs/corpuls-integration.md).

### The demonstration (demo mode, the default)

Nothing in the test console is needed for the basic demonstration:

```
OPEN STEMI PATHWAY → enter the CAD number → LINK CORPULS → CORPULS CONNECTED → live vital signs appear
  → ECG 1 appears by itself → age / sex / complaint / onset → SEND TO ER
  → ER Doctor: ACCEPT CASE → ACTIVATE CARDIOLOGIST → Cardiologist: ACKNOWLEDGE & OPEN → decision
  (UNCLEAR — REQUEST REPEAT ECG → crew: SIMULATE REPEAT ECG ACQUISITION → ECG 2 from corpuls → decision)
```

- Every LINK CORPULS starts a **fresh** simulated monitor: connected about a second later, HR 88 · SpO₂ 98 % · BP
  132/78 · RR 17 (HR with the small beat-to-beat variation of a real monitor, as a fixed pattern — never random), and
  ECG 1 (*ECG Sample A*, borderline) about `CORPULS_DEMO_ECG_SECONDS` (3) seconds after CORPULS CONNECTED. Values keep
  updating every `CORPULS_SIM_TICK_MS` (5 s).
- A requested repeat ECG comes from the crew screen's SIMULATE REPEAT ECG ACQUISITION (ECG 2 is *Sample B*, evolved;
  ECG 3 *Sample C*). The audit records it as a prototype action, then *ECG 2 received from corpuls*.
- No automatic ECG 1 when the tablet already holds a manual fallback ECG for the case.
- **RESET CORPULS DEMO** (test console, TEST ONLY) puts every simulated monitor back to that clean state (connected,
  default values; a linked case still without an ECG gets its ECG 1 again). Cases and ECGs are not touched.
- `CORPULS_DEMO_MODE=false` switches the demo off: the simulated monitor then does only what the console tells it.

### Advanced demonstration (test console → CORPULS SIMULATOR — TEST ONLY)

1. Choose the case: its simulated monitor and status are shown.
2. **SET HR / SpO₂ / BP systolic / BP diastolic / RR** change the values the monitor moves towards; **SEND VITALS
   UPDATE** sends the set values at once, with a new BP measurement.
3. **TRIGGER ECG 2 / 3** (or ECG 1 with the demo mode off), with **ECG Sample A / B / C**: the crew acquired a 12-lead
   on corpuls3; it attaches to the same CAD number by itself.
4. **DISCONNECT MONITOR**, **RECONNECT**, **SIMULATE SIGNAL LOSS** / **RESTORE SIGNAL** and **PAUSE DATA** / **RESUME
   DATA** show the connection states (the crew's fallback becomes prominent). A 12-lead triggered during a signal loss
   is held and sent on reconnection; nothing is duplicated.

These controls exist only in the console, never on the crew, ER or cardiologist screens.

## 4. The test console (`/control`, TEST ONLY)

- **CORPULS SIMULATOR:** the demo mode (on / off) with **RESET CORPULS DEMO**, and the simulated monitor of the
  selected case (section 3).
- **Cases:** every case with its status; **Take off screens / Return to screens** (hides a test case from the live
  screens; it stays in the database and its STEMI pathway is **not** closed).
- **Selected case:** the pathway timestamps (with intervals) and the full audit trail (time, person, role, action).
- **Test data:** a **pre-filled demo case** sent to the ER under a CAD number you type (checked like the crew's entry):
  created under that number, linked to a simulated monitor of its own, ECG 1 acquired on it, the minimum data, SEND;
  **Delete all test data** (with confirmation; the crew test user stays).
- **Simulation:** the fictional test ECG pattern and the next test photo's quality (both for the manual fallback), the
  mock AI (completes / unavailable / stays processing).
- **Devices and server:** which screens are connected, the iPhone / ER addresses, the server version and uptime.

## 5. Tests

Each suite starts its own server on a random port with a temporary database: the development server and `data/` are
not touched. Browser suites need Playwright with Chromium (`npm install -g playwright && npx playwright install
chromium`; in the Claude Code cloud container run them with `NODE_PATH=$(npm root -g)`).

| Command | What it checks |
|---|---|
| `npm run test:api` | the server's rules through the API: every allowed transition and every refusal, closed-case security, name validation, roles, the console, a 0.4.0 case still opening |
| `npm run test:demo` | the prototype demo mode: LINK CORPULS → connected, live values and ECG 1 with no console input (1), SEND TO ER after ECG 1 (2), the fallback not prominent while connected (3) and prominent after a connection loss (4), the repeat ECG simulated from the crew screen arriving as ECG 2 from corpuls (5), no automatic events for a closed case (6), RESET CORPULS DEMO |
| `npm run test:corpuls` | the corpuls flow end to end with the demo mode off (every acquisition is the test's own) (crew, ER, cardiologist and the simulator): tests A–L — link, connect, ECG 1, vital signs, SEND, repeat ECGs 2 and 3, connection loss and fallback, reconnection without duplicates, refusal of unlinked or late data, closure, the Case Summary — plus pause, signal loss with a held ECG, a server restart, and the corpuls.mission placeholder |
| `npm run test:acceptance` | three browsers at once (crew tablet, ER desktop, cardiologist phone): corpuls ECG → SEND → ER alarm → accept → activate → cardiologist alarm → acknowledge → repeat ECG from corpuls → CONFIRMED STEMI → COMPLETE, realtime, alarm rules |
| `npm run test:pathway` | UNCERTAIN, NOT SUSPICIOUS with a reason and with OTHER, NOT STEMI, names per CAD number (ER and cardiologist), searching completed cases |
| `npm run test:cad` | CAD number entry and normalisation, LINK CORPULS, CASE ALREADY EXISTS, correcting the number of an unsent case (its corpuls feed moves with it), the unsent case across a reload and its discard, offline entry (manual fallback offered) and offline SEND and updates |
| `npm run test:visual` | screenshots of every major screen at desktop, tablet, portrait and phone sizes (`scripts/out/visual/`), including the corpuls states (waiting, connected, ECG 1, vital signs, missing items, ready, sent, repeat, connection lost, fallback, the ER and the Cardiologist with live and lost monitor data, the simulator), with checks for overflow, tap-target size, alt text and accessible names |
| `npm test` | api, demo, corpuls, acceptance, pathway and cad in a row |

The 17 required scenarios: 1, 2, 3, 7, 8, 10, 11, 15, 16, 17 in `test:acceptance`; 4, 5, 6, 9, 12, 13 in
`test:pathway`; 14 and 15 in `test:api` (as well as the rules behind all of them).

## 6. Settings (`.env`, see `.env.example`)

| Variable | Default | What it does |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | where the server listens (`0.0.0.0` lets the iPhone connect) |
| `TEST_USER_PASSWORD` | `stemi-test` | the crew test user's password |
| `SESSION_SECRET` | generated | signs the crew login and the device sessions; generated once in `data/.session-secret` |
| `SESSION_HOURS` | `24` | crew login duration |
| `DATA_DIR` | `data` | the SQLite database and the ECG images |
| `AI_PROVIDER` / `MOCK_AI_DELAY_MS` | `mock` / `5000` | the simulated AI and how long it "processes" |
| `CORPULS_PROVIDER` | `mock` | `mock`: the simulated corpuls feed. `corpuls-mission`: the placeholder for the real interface (not implemented: nothing connects, the manual fallback is the only ECG path) |
| `CORPULS_SIM_TICK_MS` | `5000` | the simulated monitor's vital-signs update interval (also the expected interval behind the technical freshness indicator) |
| `CORPULS_SIM_NIBP_SECONDS` | `120` | how often the simulated monitor measures the blood pressure |
| `CORPULS_SIM_CONNECT_MS` | `800` | how long the simulated monitor takes to connect after LINK CORPULS |
| `CORPULS_DEMO_MODE` | `true` | the prototype demo: LINK CORPULS starts a fresh simulated feed that connects, sends live values and ECG 1 by itself; the crew can simulate a requested repeat ECG. `false`: the simulated monitor does only what the test console tells it |
| `CORPULS_DEMO_ECG_SECONDS` | `3` | demo mode: seconds from CORPULS CONNECTED to the automatic ECG 1 |
| `HEARTBEAT_MS` | `5000` | live-link heartbeat |
| `MAX_IMAGE_BYTES` | 8 MB | largest ECG image accepted |
| `DEV_AUTO_PULL` | `false` | the development runner fast-forwards this checkout from GitHub every 30 s |

Never put real secrets or patient data in `.env` (it is not committed).

## 7. The database

One SQLite file, `data/stemi-test.db`; ECG images in `data/images/` with their SHA-256 in the database. Starting a new
version **adds columns, it never wipes data**: cases made before 0.6.0 (photographed ECGs, crew-entered vital signs)
and before 0.5.0 (no ER step) still open.

New in 0.6.0: on `cases` the corpuls link and feed (`corpuls_provider`, `corpuls_device_id`, `corpuls_device_label`,
`corpuls_linked_at`, `corpuls_linked_by`, `corpuls_status`, `corpuls_status_at`, `corpuls_last_data_at`,
`corpuls_link_ended_at`, `corpuls_link_end_reason`, …) and the latest monitor values (`vitals_json`, `vitals_at`,
`vitals_source`); on `ecgs` the source (`corpuls` · `manual_fallback`), `device_id`, `source_event_id`, `source_seq`,
`transmitted_at`, `device_hr`; the tables `monitor_vitals` (a light history: each BP measurement, explicit updates,
about one sample a minute, the values sent with the case — no waveforms) and `monitor_events` (the feed's significant
moments). New in 0.5.0 on `cases`: the ER fields (`er_doctor_name`, `er_accepted_at`, `er_assessment`,
`er_assessment_at`, `er_non_activation_reason`, `er_non_activation_comment`, …), the cardiology fields
(`cardiology_activated_at`, `cardiology_activation_reason`, `cardiologist_name`, `cardiologist_acknowledged_at`,
`cardiologist_decision`, `cardiologist_decision_at`) beside `closure_reason`, `closure_source`, `closed_at`. The old
handover, destination and ETA tables stay so older databases open; nothing uses them. Full list:
[docs/architecture.md](docs/architecture.md). Look inside with `sqlite3 data/stemi-test.db`.

The audit trail (`audit_events`) records every significant event with time, CAD number, person, role (crew, er,
cardiologist, system, test-console) and action — for example *STEMI case opened … · CAD number manually entered by crew
from dispatch/MDT information*, *ER Doctor accepted the case: Dr. … · audible alarm stopped*, *ER Doctor assessment:
NOT SUSPICIOUS FOR STEMI — Dr. …*, *Reason: …*, *Cardiology not activated*, *STEMI screening pathway closed following
ER Doctor assessment*. From 0.6.0 also: *Corpuls feed linked to CAD #…*, *Corpuls monitor connected*, *ECG n
received from corpuls · acquired …*, *Corpuls connection lost / restored*, *Corpuls feed unlinked (STEMI pathway
closed)*, *Latest monitor values sent with the case: …*, *Manual ECG fallback used*. Routine monitor samples and
heartbeats are never audited.

## 8. Project structure

```
stemi-app/
├── server/            index.js (routes) · auth.js (crew login, device sessions) · pathway.js (state machine)
│                      platform.js (actions, audit, alerts, snapshots, pushes) · live.js (SSE) · db.js · schema.sql
│                      monitor.js (the corpuls feed on the platform's side) · seed.js · config.js · ai/ (interface + mock)
│                      integrations/corpuls/  contract.js · mock-provider.js · mock-ecg.js · real-provider.js · index.js
├── public/
│   ├── index.html     choose a screen
│   ├── crew/ er/ cardiologist/ control/ login/
│   └── shared/        ds.css (design system) · ui.js · clinical.js (ECG viewer, AI panel, timeline, summary, alarm)
│                      live.js · rules.js (names, ER reasons, state labels) · cad.js · ecg.js (fictional ECGs) · fonts/
├── scripts/           dev.js (runner) · reset.js · tests (api, corpuls, acceptance, pathway, cad-entry, visual-qa, lib/)
├── samples/           fictional test ECG images
└── docs/              architecture.md · corpuls-integration.md · open-decisions.md · production-gaps.md
```

## 9. Troubleshooting

| Problem | What to do |
|---|---|
| The iPhone cannot open the page | Same Wi-Fi for both; type the address with `http://` and the port. Guest / office Wi-Fi often blocks device-to-device traffic: try the iPhone's Personal Hotspot. **System Settings → Network → Firewall** must allow `node`; on macOS 15+ **Privacy & Security → Local Network** must allow Terminal. Check `http://<Mac IP>:3000/health` from the iPhone. |
| No alarm sound | Tap START · ENABLE ALARM SOUND after every reload; silent mode off, volume up, page in front. A red banner means sound is blocked: tap it. |
| CONNECTION LOST | The server stopped, the Mac slept or the Wi-Fi changed: `npm run dev:status`; the screens reconnect by themselves. |
| Port in use | `npm run dev:status` tells whether it is this server; otherwise set another `PORT` in `.env`. |
| The crew screen shows CORPULS CONNECTION LOST or CORPULS NOT CONNECTED | An earlier test disconnected the simulated monitor: test console → CORPULS SIMULATOR → **RESET CORPULS DEMO** (or **CONNECT MONITOR** for that case). |
| No ECG appears after LINK CORPULS | In demo mode ECG 1 arrives about 3 s after CORPULS CONNECTED. With `CORPULS_DEMO_MODE=false`: CORPULS SIMULATOR → **TRIGGER ECG 1**. Or use the crew's *Manual ECG fallback*. |
| Start again with no cases | Test console → **Delete all test data**, or `npm run dev:stop && npm run reset && npm run dev:bg`. |

## 10. Known limits

- The alarms are browser sounds: they need the page open, in front, screen on. Production needs managed push with
  proof of delivery and escalation (not set: governance).
- Plain HTTP on the local network; fictional data only.
- Clinician identification is a typed name (see the top of this file). One crew unit (Ambulance 214). Every ER screen
  sees every sent case; every cardiologist screen sees every activation.
- The CAD number is checked for format and duplicates, not against dispatch (no CAD integration).
- No reminders or escalation; no destination / ETA (ICCC); no cath-lab or hospital screens; no amendment of closed
  cases.
- The simulated AI does not read images (for an uploaded file it says so).
- The corpuls feed is simulated (no real monitor, no corpuls.mission). One monitor per unit; a monitor serves one case
  at a time. ECGs acquired on the monitor before the case was linked do not attach. The *stale data* indicator is
  technical (3 × the expected update interval), not a clinical threshold.

## 11. What changed in 0.6.1 — prototype demo mode

- **The demonstration runs by itself** (`CORPULS_DEMO_MODE`, on by default): LINK CORPULS starts a fresh simulated
  feed — CONNECTING TO CORPULS… → CORPULS CONNECTED → live HR / SpO₂ / BP / RR → ECG 1 RECEIVED FROM CORPULS about 3 s
  later. No test console, no hardware, no upload needed for the basic demonstration.
- **No dead-end screens:** the crew sees transitional states (connecting, receiving live monitor data, receiving the
  12-lead) and a step line (CAD linked · Corpuls connected · Live vitals · ECG 1); *WAITING FOR ECG FROM CORPULS* and
  *No ECG has arrived from corpuls yet* are gone. A monitor that does not connect at all says CORPULS NOT CONNECTED
  and offers the fallback.
- **Repeat ECG in the demo:** SIMULATE REPEAT ECG ACQUISITION on the crew's REPEAT ECG REQUESTED panel (prototype only);
  ECG 2 arrives from the simulated corpuls feed on the same CAD number.
- **Manual fallback quiet while corpuls works:** prominent only on connection loss, a monitor that never connects, a
  feed ended on an open case, or no connection.
- **Subtle SIMULATED CORPULS FEED tag** in the crew's corpuls bar; the ECG is drawn at the monitor's heart rate.
- **Test console:** demo mode status and **RESET CORPULS DEMO**; all advanced controls kept.
- New demo values (HR 88 · SpO₂ 98 % · BP 132/78 · RR 17); new test suite `npm run test:demo`.

## 12. What changed in 0.6.0

- **Corpuls-driven crew workflow:** OPEN STEMI PATHWAY → CAD number → **LINK CORPULS** → the ECG and the vital signs
  arrive from the (simulated) corpuls feed → the crew enters only age, sex, presenting complaint and symptom onset →
  SEND TO ER. One page, landscape tablet first; one SEND with a list of what is missing; no confirmation of vital
  signs.
- **Provider architecture** (`server/integrations/corpuls/`): the provider contract with normalized events,
  MockCorpulsProvider (gradual, non-random simulation; synthetic 12-leads from ECG Samples A / B / C) and the
  RealCorpulsMissionProvider placeholder. `server/monitor.js` checks, stores and audits the feed.
- **Repeat ECGs from corpuls** attach to the same CAD number by themselves (ECG 2, 3 …), silently, never overwriting.
- **Connection states** on every screen (CORPULS CONNECTED · WAITING FOR CORPULS · CORPULS CONNECTION LOST / LIVE MONITOR
  DATA TEMPORARILY UNAVAILABLE · feed ended), with the time of the last data; one lost / restored event per outage.
- **Manual ECG upload and manual vital signs become the fallback** (recorded as *manual fallback*, audited).
- **ER Doctor and Cardiologist:** the latest monitor values in the patient strip and details, each ECG's source;
  workflows unchanged.
- **Case Summary:** the latest monitor data with its time, the monitor feed, each ECG's source.
- **Test console:** CORPULS SIMULATOR — TEST ONLY; demo cases now come through the simulated feed.
- **The unsent case lives on the platform** from LINK CORPULS (invisible to the ER until SEND), so the feed can attach;
  its CAD number can still be corrected, and the case is discarded with its feed ended.
- New test suite `npm run test:corpuls`; the other suites follow the new flow.

## 13. What changed in 0.5.0

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
