# Unified STEMI Platform · crew ↔ cardiologist test build

**Version 0.4.0 · 4 October 2026 · built from the approved round-3 prototype (v0.2, "Connected crew and cardiologist")**

> **TEST BUILD · FICTIONAL DATA ONLY.** Use only fictional patients, simulated CAD numbers, simulated ECG images and the
> two test users. Never enter real patient information: this build runs over plain HTTP on a local Wi-Fi network and
> has no production security. The ECG AI is a **simulation**, not a clinical model. Not for clinical use.

One server runs on a Mac and serves two live views of the same CAD case:

| Device | Role | Address |
|---|---|---|
| The Mac's browser | Crew MDT (the approved landscape tablet layout) | `http://localhost:3000/crew` |
| An iPhone in Safari, on the same Wi-Fi | Cardiologist | `http://<the Mac's IP address>:3000/cardiologist` |
| The Mac's browser, second window (optional) | Test console: checklist, timestamps, audit trail, test controls | `http://localhost:3000/control` |

The EMT opens the STEMI pathway and **enters the CAD number manually** from the MDT / dispatch information (there is no
CAD integration in this phase, and nothing generates CAD numbers). The CAD number is the case identifier everywhere.
When the crew presses **Send to cardiologist**, the case is created under that CAD number (never a second case under
the same number), the case and ECG are stored on the server, the case appears on the
iPhone by itself, and the new-case alarm sounds until **ACKNOWLEDGE & OPEN**. Every later update (vital signs,
medication, ECG 2, AI result) arrives silently, marked NEW with its time. The cardiologist's decision appears on the
crew screen straight away. **NOT STEMI closes the STEMI pathway automatically**; otherwise the crew closes it from the
**Case summary** with **COMPLETE STEMI PATHWAY**. A closed pathway stays stored, auditable and read-only. Only the STEMI
pathway closes: the CAD incident belongs to ICCC / ACC and ePCR and is never closed or cancelled here.
Refreshing either page loses nothing.

---

## 1. Start on a Mac

You need a Mac and an iPhone on the same Wi-Fi network. Nothing else is installed apart from Node.js; the app has no
other dependencies.

1. **Install Node.js 22.13 or later.** Download the LTS installer for macOS from <https://nodejs.org> and run it
   (or, with Homebrew, `brew install node`). Check in Terminal:
   ```bash
   node --version        # must print v22.13.0 or later (v24 is fine)
   ```
2. **Unzip the project**, for example into your Documents folder, so you have `~/Documents/stemi-app`.
   Or clone the GitHub repository; the app is the `stemi-app` folder inside it:
   ```bash
   cd ~/Documents
   git clone -b claude/magical-faraday-sjzcvc https://github.com/hsajwani/hsajwani.git
   cd hsajwani/stemi-app
   ```
3. **Start the server** in Terminal:
   ```bash
   cd ~/Documents/stemi-app      # or ~/Documents/hsajwani/stemi-app
   npm start
   ```
   There is no `npm install` step (the app has no dependencies; running `npm install` anyway is harmless). The first
   start creates the test database in `data/`.
4. **If macOS asks** *"Do you want the application node to accept incoming network connections?"*, click **Allow**.
   Without it the iPhone cannot reach the Mac.
5. Terminal now shows the addresses to use, for example:
   ```
   Crew MDT (this computer):   http://localhost:3000/crew
   Cardiologist (iPhone):      http://192.168.1.23:3000/cardiologist
   Test console:               http://localhost:3000/control
   Test users: crew@test.local and cardio@test.local · password: stemi-test
   ```

Keep the Terminal window open while you test. **Ctrl+C** stops the server; `npm start` starts it again with the case
still there. To stop the Mac sleeping during a long test, start with `caffeinate -i npm start` instead.

### The crew MDT on the Mac

1. Open Safari or Chrome at **http://localhost:3000/crew**.
2. Log in as **crew@test.local**, password **stemi-test** (or press the crew quick-fill button).
3. Make the window full screen (**Ctrl+Cmd+F**). The screen keeps the MDT's landscape layout and scales to the window.

### The cardiologist on the iPhone

1. Connect the iPhone to the **same Wi-Fi** as the Mac.
2. In **Safari**, type the *Cardiologist (iPhone)* address exactly as Terminal printed it, including `http://`,
   for example `http://192.168.1.23:3000/cardiologist`.
3. Log in as **cardio@test.local**, password **stemi-test**.
4. Tap **START · ENABLE ALARM SOUND**. You hear a short test tone. A web page may only play sound after a tap, so
   this step is needed each time the page is opened or reloaded. If sound is blocked, a red banner says so.
5. For the test, set the iPhone so the alarm can be heard:
   - Silent mode **off** (ring/silent switch or Action button) and the volume **up**.
   - **Settings → Display & Brightness → Auto-Lock → Never** for the duration of the test.
   - Focus / Do Not Disturb **off**, and Safari **kept in front**, screen on.

   A locked phone, or Safari in the background, cannot sound the alarm in this test build. The production system
   needs real push notifications for that (see [docs/production-gaps.md](docs/production-gaps.md)).

Tip: add the page to the Home Screen only after the test works in Safari; Safari itself is the tested route.

---

## 2. The acceptance test (19 steps, then closing the STEMI pathway)

The two sample ECG images are in `samples/`. They are generated test images, marked *FICTIONAL TEST ECG · NOT A PATIENT*.
Use a fictional CAD number, for example `20261004-0123-1`.

| # | Device | Do this | You should see |
|---|---|---|---|
| 1 | Mac | Open `/crew` and log in | **New case** and **LIVE — CONNECTED · Last update HH:MM:SS** |
| 2 | Mac | **Open STEMI pathway** (or **New STEMI case** when a case is already shown) | The **CAD NUMBER** field |
| 3 | Mac | Type the CAD number, e.g. `20261004-0123-1` (`CAD#20261004-0123-1` and extra spaces are accepted) → **Continue: capture ECG** | **CAD #20261004-0123-1 · Entered manually** at the top of the workspace |
| 4 | Mac | **Upload** → choose `samples/test-ecg-1-borderline-anterior.jpg` (or tap the camera button for a simulated photo) | ECG 1 with the tablet's image check |
| 5 | Mac | Enter the minimum dataset: age, sex, complaint, onset, BP, HR, SpO2, GCS (each can be *Unknown* / *Not obtained*) | **Send to cardiologist** becomes available |
| 6 | Mac | **Send to cardiologist** | ECG RECEIVED, then CARDIOLOGIST ALERTED; the CAD number now shows *locked after send* |
| 7 | iPhone | Nothing; wait | **NEW CARDIAC CASE** with **the exact CAD number entered**, unit and *ECG received HH:MM* appears by itself |
| 8 | iPhone | Listen | The alarm sounds and repeats |
| 9 | iPhone | **ACKNOWLEDGE & OPEN** | ECG 1 opens |
| 10 | iPhone | Listen | The alarm stops |
| 11 | Mac | Nothing; watch | CARDIOLOGIST ACKNOWLEDGED, then CARDIOLOGIST REVIEWING (*Dr X is looking at the ECG…*) |
| 12 | Mac | Next to BP, **Update** → enter e.g. `94/60` → **Save and send** | The new BP in the record, the previous one kept |
| 13 | Mac | Treatments given → **Aspirin** → **Enter** → **Given** → **Save and send** | Aspirin in the record |
| 14 | Mac | **Capture new ECG (ECG 2)** → **Upload** → `samples/test-ecg-2-evolving-anterior.jpg` → **Send to cardiologist** | ECG 2 received |
| 15 | iPhone | Nothing; watch | NEW BP, NEW Aspirin and **NEW — ECG 2 received — HH:MM**, without refresh and **without sound** |
| 16 | iPhone | **Compare ECG 1 \| ECG 2** | The two ECGs side by side |
| 17 | iPhone | Open ECG 2 and scroll to **AI ECG interpretation** | The AI result, the same as on the crew screen, with *AI interpretation is decision support. The Cardiologist makes the final STEMI decision.* |
| 18 | iPhone | **Decide** → **CONFIRMED STEMI** → **Confirm STEMI** | The decision recorded with Dr X's name and time |
| 19 | Mac | Nothing; watch | **CONFIRMED STEMI** takes over the crew screen at once; press **Acknowledge** |

**Then closing the STEMI pathway** (the STEMI platform asks for no handover or ePCR documentation):

| # | Device | Do this | You should see |
|---|---|---|---|
| 20 | Mac | After CONFIRMED STEMI, nothing closes by itself: press **Case summary** at the top of the case | The STEMI pathway only: CAD number, status, the cardiologist's acknowledgement and decision (read-only), ECGs and serial ECGs with their AI interpretations, the STEMI timeline |
| 21 | Mac | **COMPLETE STEMI PATHWAY** → **COMPLETE** in *COMPLETE STEMI PATHWAY? … CAD #…* | Back on **My cases**: the case is under **Completed cases**, read-only |
| 22 | iPhone | Nothing; watch | **STEMI PATHWAY COMPLETED**, no sound, no decision buttons; under **Completed**, searchable by CAD number |
| 23 | Mac | Refresh, then **Completed cases** → find by CAD number → **View** | Still closed, everything kept, read-only |

**NOT STEMI** (try it with a new CAD number): on the iPhone **Decide → NOT STEMI**, pick a reason, **Confirm NOT
STEMI**. The crew sees at once **NOT STEMI · PATHWAY CLOSED** with the cardiologist and time; after **Acknowledge** the
case is under **Completed cases**. The iPhone shows **NOT STEMI — PATHWAY CLOSED** and no decision controls. No cath-lab
activation, no sound. **UNCLEAR / REQUEST REPEAT ECG** keeps the pathway active: the crew sees the request and sends
ECG 2, and the review continues.

The CAD number appears on the iPhone in the new-case alert, the case header, the ECG review screen and the timeline
(**Timeline** button), always as `CAD #20261004-0123-1`.

**CAD number checks to try** (the automated test does all of them):

| Do this on the Mac | You should see |
|---|---|
| **Continue** with the CAD NUMBER field empty | *Enter a valid CAD number before continuing.* (The CAD number is empty.) Nothing else is cleared |
| Enter an incomplete number, e.g. `20261004-0123` | The same message, with the expected format |
| Enter `  cad#20261004-0123-1  ` | Stored and shown as `CAD #20261004-0123-1` |
| Before Send, press **Correct** next to the CAD number | The CAD NUMBER field again; the correction is recorded in the audit trail when the case is sent |
| After Send | *Entered manually · locked after send*; the CAD number can no longer be edited |
| **My cases** → **New STEMI case** → enter the same CAD number again | **CASE ALREADY EXISTS · CAD #…** with **OPEN EXISTING CASE** (or **Correct the CAD number**). No second case is created and the existing case is not changed |
| Refresh the Mac page before and after Send | The CAD number, the draft and the case are still there |

The **test console** (`/control`) ticks each step off as the case record shows it happened, and shows the pathway
timestamps and the audit trail (time, user, role, action, CAD number). To run the test again, press **My cases** →
**New STEMI case** on the Mac and use a **different** CAD number (for example `20261004-0124-1`): the same number
would open the existing case. **Delete all test data** in the console makes every number free again.

Other things worth trying: **NOT STEMI** and **UNCLEAR / REQUEST REPEAT ECG**; a second image of the same ECG
(**Add ECG image**); refreshing either page mid-case; turning the Mac's Wi-Fi off for a moment (the crew screen shows
**CONNECTION LOST · Attempting to reconnect**, keeps what you enter and sends it on reconnection); and the console's
*AI analysis: Unavailable* and *Next photo: Glare* settings.

---

## 3. Test users

| Email | Password | Role | Shown as |
|---|---|---|---|
| `crew@test.local` | `stemi-test` | Crew | K. Ahmed, Paramedic · Ambulance 214 · Ras Al Khaimah (fictional) |
| `cardio@test.local` | `stemi-test` | Cardiologist | Dr X, Cardiologist · PCI Hospital A (placeholder) |

The crew user can only open `/crew` and the cardiologist only `/cardiologist`; either can open `/control`. The
password can be changed with `TEST_USER_PASSWORD` in `.env`. Login is deliberately simple and sits in one file
(`server/auth.js`) so it can be replaced by National Ambulance single sign-on.

---

## 4. The test console (`/control`)

It stands in for the prototype's *Simulate* panel. It never generates CAD numbers:

- **Close the active case** takes the active case off both screens (it stays in the database). One case is active
  at a time; the crew then opens the next one with **New STEMI case** and its own CAD number.
- **Pre-filled demo case (sent)**: type a CAD number in the field next to it (checked and normalised like the crew's
  entry; a number that already has a case is refused). The case arrives already sent by the crew, through the same
  crew actions the tablet uses: ECG 1 (the borderline sample image), the minimum dataset (58 y, male, chest pain,
  onset about 45 minutes ago, BP 142/88, HR 88, SpO₂ 97 %, GCS 15) and aspirin 300 mg. The cardiologist's phone gets
  the normal NEW CARDIAC CASE alarm and the mock AI analyses ECG 1. From there the crew can add ECG 2 and update vital
  signs. The audit trail records the CAD number as *entered manually in the test console (demo case)*. Use it for
  demonstrations; the acceptance test above starts on the crew MDT.
- **Delete all test data** wipes every case and image (the test users stay).
- **Simulation settings:** test ECG findings (borderline then evolving, or a clear STEMI pattern), the next simulated
  photo (good, glare, leads cut off), the AI (completes, unavailable, stays processing), screen IDs on the devices.
- **Reminder interval reached** and **Escalation threshold reached.** Reminder and escalation times are governance
  configurable and not set, so nothing reminds or escalates by itself; these buttons fire them.
- Which devices are connected, the 19-step checklist, the pathway timestamps and the audit trail.

---

## 5. How it works

```
 Mac ─────────────────────────────────────────────────────────┐        iPhone (same Wi-Fi)
 │ Browser /crew (crew MDT)     Browser /control (console)     │        Safari /cardiologist
 │        │ ▲                          ▲                       │             │ ▲
 │ actions│ │live case record          │                       │      actions│ │live case record
 │        ▼ │                          │                       │             ▼ │
 │ Node.js server  ── port 3000, all network interfaces ◄──────┼──── Wi-Fi ──┘ │
 │   platform rules · simulated AI · live stream ──────────────┼────────────────┘
 │   SQLite database data/stemi-test.db · images data/images/  │
 └─────────────────────────────────────────────────────────────┘
```

- **Stack:** Node.js 22+ standard library only: `node:http` for the web server, `node:sqlite` for the database,
  `node:crypto` for passwords and the login cookie. The screens are the approved prototype's own HTML, CSS and
  JavaScript, connected to the server instead of to the prototype's in-page simulation. No build step, no packages.
- **One case record, identified by the CAD number the EMT entered.** The crew tablet and the server share one rule
  (`public/shared/cad.js`): spaces are removed, a leading `CAD#` / `cad#` / `#` is dropped, and the number must look
  like `20261004-0123-1` (date, four digits, suffix). It is stored in that canonical form, the format the database
  already used, and shown as `CAD #20261004-0123-1`. Every row in the database carries it. There is no temporary
  STEMI ID and no generated number.
- **When the case is created:** the draft (CAD number, ECG, minimum dataset) stays on the tablet until **Send**, so
  the CAD number can be corrected freely before then. Entering it checks the platform for an existing case at once
  (when connected); Send checks again and creates the case. A number that already has a case gets **CASE ALREADY
  EXISTS** with **OPEN EXISTING CASE**: no second case, nothing overwritten. After Send the number is locked; an
  authorised, audited correction after Send is not built in this phase.
- **Real time:** the server pushes the whole case record to every open screen over Server-Sent Events whenever it
  changes, plus a heartbeat every 5 seconds. Screens send actions (Send, an update, acknowledge, decide) as HTTP
  requests. Each action has a unique id and is stored once, so resending after a lost connection is harmless.
- **Nothing is overwritten:** each new vital sign, correction, ECG and decision is a new row; the audit trail records
  time, user, role, action and CAD number for every event. The role is `crew` or `cardiologist` for a person's own
  action and `system` for the platform, the AI service and the destination engine (`cad-feed` only on cases made by
  version 0.1's simulated CAD feed). The first event of a case is *STEMI case opened by … — CAD #… · CAD number
  entered manually by crew (not from dispatch)*.
- **Alarm:** only for a new case, played by the cardiologist's page until ACKNOWLEDGE & OPEN reaches the server.
  Acknowledgement and decision are separate events, each with the cardiologist's identity and time.
- **AI:** one analysis per ECG, made once on the server and shown unchanged on both screens. It sits behind a small
  interface (`server/ai/index.js`) with one provider, `mock`, which returns scripted test findings. A validated AI
  service can replace it later without touching the screens.

More detail: [docs/architecture.md](docs/architecture.md).

---

## 6. Settings (environment variables)

Copy `.env.example` to `.env` to change anything; `npm start` reads `.env` if it exists. Defaults work as they are.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port of the server. The iPhone address uses it. |
| `HOST` | `0.0.0.0` | Listen on every network interface, so the iPhone can connect. `127.0.0.1` would allow this Mac only. |
| `TEST_USER_PASSWORD` | `stemi-test` | Password of both test users. |
| `SESSION_SECRET` | generated | Signs the login cookie. Left empty, a random one is made once in `data/.session-secret`. |
| `SESSION_HOURS` | `24` | How long a login lasts. |
| `DATA_DIR` | `data` | Folder for the database and the ECG images. |
| `AI_PROVIDER` | `mock` | The ECG AI service. Only `mock` (simulated) exists. |
| `MOCK_AI_DELAY_MS` | `5000` | How long the simulated AI takes before its result appears. |
| `HEARTBEAT_MS` | `5000` | Live-link heartbeat. Screens show CONNECTION LOST when heartbeats stop. |
| `MAX_IMAGE_BYTES` | `8388608` | Largest ECG image accepted (8 MB). |
| `ALERT_REMINDER_SECONDS` | empty | Not set: governance configurable (Q-72). Empty means no automatic reminder. |
| `ALERT_ESCALATION_SECONDS` | empty | Not set: governance configurable (Q-15, Q-54). Empty means no automatic escalation. |

Never put real secrets or real patient data in `.env`. It is excluded from git.

---

## 7. The database

- One SQLite file: `data/stemi-test.db`. ECG images are stored as files in `data/images/`, each with its SHA-256 hash
  in the database. The `data/` folder is never committed.
- The STEMI pathway's closure is on `cases`: `status = 'closed'`, `closed_at`, `closed_by`, `closure_reason`
  (`STEMI pathway completed` or `Cardiologist decision: NOT STEMI`) and `closure_source` (`crew` or `automatic following
  Cardiologist decision`). No separate closure record. The 0.3.0 handover tables (`arrivals`, `handovers`,
  `final_vitals`) are no longer used and are kept only so that existing test databases still open.
- `cases` records how the CAD number was entered: `cad_source` (`manual-crew`, or `manual-test-console` for the demo
  case), `cad_entered_at`, `cad_entered_by`. A database made by an earlier version gets these columns on start.
- The tables follow the case: `cases`, `patient_details`, `observations`, `treatments`, `ecgs`, `ecg_images`,
  `ai_interpretations`, `cardiologist_alerts`, `alert_followups`, `ecg_views`, `decisions`, `destinations`, `etas`,
  `case_updates`, `audit_events`, plus `users`, `ops` (every action received, once) and `settings`. The schema is
  `server/schema.sql` and is created on first start.
- **Start fresh:** press *Delete all test data* in the test console, or stop the server and run `npm run reset`.
- **Look inside** with the `sqlite3` tool that comes with macOS:
  ```bash
  sqlite3 data/stemi-test.db
  sqlite> .tables
  sqlite> SELECT datetime(at/1000,'unixepoch','localtime') AS time, cad, actor, role, action FROM audit_events ORDER BY at;
  ```
- The data layer is one file (`server/db.js`), so moving to PostgreSQL later changes that file and the schema, not
  the screens.

---

## 8. Project structure

```
stemi-app/
├── README.md                  this file
├── .env.example               every setting, with comments
├── package.json               npm start · npm run dev · npm run reset · npm run test:acceptance
├── docs/
│   ├── architecture.md        how the pieces fit, the live link, the data model, the AI interface
│   ├── production-gaps.md     what must change before any real patient use
│   └── open-decisions.md      open questions and the working defaults this build uses
├── server/
│   ├── index.js               web server: pages, API, live stream, images, test console actions
│   ├── platform.js            the platform rules: Send, updates, alert, acknowledgement, decision, audit
│   ├── live.js                Server-Sent Events: who is connected, heartbeat, broadcasting the case
│   ├── auth.js                test logins and the signed session cookie (replaceable by SSO)
│   ├── db.js                  SQLite access, password hashing, settings
│   ├── schema.sql             the database tables
│   ├── seed.js                test users; the active case
│   ├── config.js              settings from the environment
│   └── ai/
│       ├── index.js           the AI service interface (provider chosen by AI_PROVIDER)
│       └── mock.js            the simulated AI: scripted test findings
├── public/
│   ├── crew/                  crew MDT screens (from the approved prototype)
│   ├── cardiologist/          cardiologist screens, phone / tablet / workstation layouts, alarm
│   ├── control/               test console
│   ├── login/                 login page
│   └── shared/                live link, CAD number rule (cad.js, also used by the server), fictional ECG image generator, fonts
├── samples/                   fictional test ECG images for upload
└── scripts/
    ├── acceptance.js          automated test with two browsers: 19 steps, CAD number checks, CONFIRMED STEMI stays active, COMPLETE STEMI PATHWAY (needs Playwright)
    ├── pathway-test.js        NOT STEMI closes the pathway automatically; a repeat ECG request keeps it active
    ├── cad-entry-test.js      CAD number edge cases: offline entry, duplicate found at Send, correction
    ├── make-sample-ecgs.js    regenerates the sample ECG images
    └── reset.js               deletes the test data
```

---

## 9. Automated acceptance test

`scripts/acceptance.js` runs the 19 steps with two real browsers against a real server: a desktop window as the crew
MDT and an iPhone-sized window as the cardiologist, opened from the Mac's network address over plain HTTP as the
iPhone does. It counts every alarm tone to prove the alarm sounds for the new case only, then checks refresh,
offline entries, the audit trail and script errors. It uses its own temporary database and leaves `data/` alone.

```bash
npm install --no-save playwright && npx playwright install chromium   # once; not needed to run the app
npm run test:acceptance
npm run test:pathway
npm run test:cad
```

The acceptance test also checks the CAD number rules: nothing is generated, a blank or incomplete number is refused
inline, `cad#` and spaces are normalised, the number survives a refresh before Send, the exact number reaches the
iPhone's alert and header, it is locked after Send, a duplicate gives CASE ALREADY EXISTS (and is refused by the
server, as is a blank number) and OPEN EXISTING CASE opens the case unchanged. `npm run test:cad` covers a CAD number
entered offline that turns out to exist at Send (the ECG and minimum dataset stay as the draft), its correction, and
the correction in the audit trail.

It then checks that CONFIRMED STEMI keeps the pathway active, and completes it from the Case summary (no handover
fields), with the cardiologist's silent STEMI PATHWAY COMPLETED, read-only screens, the platform refusing changes, and
the closed case found by CAD number after a refresh. `npm run test:pathway` runs NOT STEMI (automatic closure, two audit
events, nothing called a CAD cancellation, everything kept, read-only, searchable) and the repeat ECG request (pathway
stays active, ECG 2 arrives, review continues).

Screenshots and the audit trail go to `scripts/out/`. The last runs passed 47 of 47 checks (acceptance), 15 of 15 (pathway) and 9 of 9
(CAD edge cases) on Node 22. In the 0.1 runs (Node 22 and Node 24) the
case reached the phone within about 1 second of Send, the decision reached the crew within about 50 ms, and no tone
played after acknowledgement.

---

## 10. Troubleshooting

| Problem | What to do |
|---|---|
| The iPhone cannot open the page | Check both are on the same Wi-Fi network. Type the address with `http://` and the port. Office and guest Wi-Fi often block device-to-device traffic: try a home network, or turn on the iPhone's Personal Hotspot, join it from the Mac, restart the server and use the new address it prints. Check **System Settings → Network → Firewall → Options** allows `node`. On macOS 15 or later, also check **System Settings → Privacy & Security → Local Network** allows Terminal. |
| Terminal printed the wrong IP address | Run `ipconfig getifaddr en0` for the Wi-Fi address and use `http://<that address>:3000/cardiologist`. |
| No alarm sound on the iPhone | Tap **START · ENABLE ALARM SOUND** after every reload. Silent mode off, volume up, no Bluetooth headphones connected, Safari in front. A red banner means sound is blocked: tap it. |
| The screens say CONNECTION LOST | The server stopped, the Mac slept or the Wi-Fi changed. Restart `npm start` if needed; both screens reconnect by themselves. |
| `npm start` says the port is in use | Another program uses port 3000. Run `PORT=3001 npm start` (or set `PORT` in `.env`) and use port 3001 in every address. |
| `npm start` says it needs Node.js 22.13 or later | Install the current LTS from nodejs.org, close Terminal, open it again and check `node --version`. |
| Logged out unexpectedly | A login lasts 24 hours. Safari must not block all cookies. |
| Start again with a clean slate | Test console → **Delete all test data**, or stop the server and run `npm run reset`. |

---

## 11. Known limits of this test build

- **The alarm is a browser sound.** It plays only while the cardiologist page is open, in front, with the screen on.
  The audit trail's *alert shown · audible alarm started* means the alert was on screen; it cannot prove the phone
  made a sound. Production alerting needs managed push notifications (see the production gaps).
- **Plain HTTP on the local network:** no encryption, so fictional data only. Browsers also withhold some features on
  plain HTTP, such as keeping the screen awake, hence Auto-Lock → Never.
- **One active case at a time**, one crew user and one cardiologist (Q-69, Q-73). Sending a new case makes it the
  active case; the previous one stays in the database.
- **The CAD number is typed by the EMT.** It is checked for format and for an existing case, not against dispatch
  (no CAD integration yet, Q-70). After Send it is locked: the authorised, audited correction is a later phase.
- **The duplicate check needs the connection.** A CAD number entered offline is checked when the case is sent.
- **Completing the STEMI pathway needs the connection** and all entries sent.
- **No amendment after closure.** A closed STEMI pathway cannot be reopened or corrected in this phase; that needs an
  authorised amendment workflow.
- **The destination** is always the placeholder *PCI Hospital A*; the deterministic destination policy engine is not
  built.
- **The simulated AI does not read images.** For an uploaded file it returns the scripted test findings and says so.
  Lead focus (zoomed lead crops) works on simulated photos only; uploaded files show the whole image.
- The sample ECG files print a fixed date and time on the image; the platform records the time of capture or upload.
- Reminders and escalations never fire by themselves (the times are not set); the test console fires them.
- Hospital, ED, cath-lab, ACC and administration screens are not built yet.

---

## 12. Before production

This build is for testing the workflow on two devices. Before any real patient information is used, it needs approved
hosting, HTTPS, National Ambulance single sign-on, managed push and escalation notifications with proof of delivery,
a production database with backups, InfoSec, privacy and data-governance approval, and a validated AI service
introduced in stages. The full list is in [docs/production-gaps.md](docs/production-gaps.md).

## 13. Open decisions

The build uses the round-3 prototype's working defaults wherever a decision is still open (for example one STEMI case
per CAD incident, Q-69, and how the CAD number reaches the tablet, Q-70). Each one is listed with its working default
in [docs/open-decisions.md](docs/open-decisions.md).

## 14. Changes in 0.4.0: the STEMI pathway closes; no handover documentation

- **System boundaries:** ICCC / ACC manages the operational incident and ePCR the patient care record; this platform
  manages only the STEMI pathway. The 0.3.0 handover requirements (receiving hospital, arrival and handover times,
  receiving area and clinician, final vitals) and the Transport and handover section are removed.
- **Case summary** (was *Handover*): the STEMI pathway only, from the shared record: CAD number, status, cardiologist
  acknowledgement and decision, ECGs and serial ECGs with AI interpretations, STEMI timeline. Nothing to fill in.
- **COMPLETE STEMI PATHWAY** at the bottom, with *COMPLETE STEMI PATHWAY? … CAD #… · CANCEL / COMPLETE*: records the
  time, the crew user, `closure_reason = STEMI pathway completed`, `closure_source = crew`; the case moves to Completed
  and is read-only.
- **NOT STEMI closes the pathway automatically**: the decision is saved with the cardiologist and time, then the
  pathway closes (`Cardiologist decision: NOT STEMI`, `automatic following Cardiologist decision`), with two separate
  audit events. Crew: *NOT STEMI · PATHWAY CLOSED*, then Completed. Cardiologist: *NOT STEMI — PATHWAY CLOSED*, no
  decision controls. No cath-lab activation; the CAD incident is never described as cancelled.
- **CONFIRMED STEMI** and **UNCLEAR / REQUEST REPEAT ECG** keep the pathway active, as before.
- **Status:** ACTIVE → CARDIOLOGIST REVIEWING → CONFIRMED STEMI (active) / REPEAT ECG REQUESTED (active) / NOT STEMI —
  PATHWAY CLOSED; a completed pathway shows STEMI PATHWAY COMPLETED (internal status `closed` for both).
- No alarm for any of this: the alarm is for a new case only.
- Tests: acceptance (47) updated; new `npm run test:pathway` (15).

## 15. Changes in 0.3.0: handover and closing the case (superseded by 0.4.0)

- **Lifecycle:** ACTIVE (draft) → ECG SUBMITTED (*awaiting cardiologist*) → CARDIOLOGIST REVIEWING (*under review*) →
  DECISION RECEIVED (*the decision*) → **TRANSPORTING** → **ARRIVED** → **HANDOVER IN PROGRESS** → **HANDOVER COMPLETED**
  (internal status `closed`). The existing states are kept; the new ones follow them on the crew status chip and in
  the crew's status list. *Start transport* is the existing *Departed scene*.
- **Crew:** a **Transport and handover** section in the workspace (Start transport, Mark arrived, Open handover), a
  **Handover** button at the top of the case, and the **Handover** page: arrival, transfer of care, final vitals,
  case summary, ECGs, treatments in time order, a compact timeline from the audit trail, the cardiologist's decision
  and the AI interpretation (both read-only), the missing items, and **COMPLETE HANDOVER & CLOSE CASE** with a
  confirmation. Nothing already in the case is re-entered.
- **Required before closure:** receiving hospital, arrival time, handover time (not before arrival), receiving
  clinician name and role, crew clinician, final vitals confirmed (again, if a value changed after confirming). RR,
  pain score, the receiving area and notes are optional; *Other* as area needs text. The server checks the same list.
- **Closed:** handover data, completion time and the crew user are saved; audit events; every screen updates. The
  case leaves the crew's active list and is under **Completed cases** (search by CAD number). The platform refuses any
  change to a closed case; viewing it is still recorded.
- **Cardiologist:** silent TRANSPORTING / ARRIVED / HANDOVER COMPLETED bands and NEW lines, no alarm; a closed case has
  no decision buttons; **Completed** in the review queue with search by CAD number, opened read-only. A new-case
  alert always takes over from a completed case being viewed.
- **Audit:** transport started, arrival marked or corrected (receiving hospital confirmed), handover page opened,
  final vitals confirmed (with the values), transfer of care recorded or updated, handover completed, case closed.
- **Test console:** lifecycle steps and timestamps; *Close the active case* is renamed *Take the active case off the
  screens* (it is not a handover).

## 16. Changes in 0.2.0: the EMT enters the CAD number

- **Crew:** Open STEMI pathway → **CAD NUMBER** (entered manually from the MDT) → ECG → minimum dataset → Send →
  continue documenting. The CAD number stays at the top of the workspace; **Correct** changes it until Send, then it
  is locked. Blank or invalid numbers get an inline message and nothing else is cleared. **New STEMI case** on the
  home screen starts the next case.
- **Duplicates:** a CAD number that already has a case gives **CASE ALREADY EXISTS · CAD #… · OPEN EXISTING CASE**
  (or correct the number). The platform refuses the duplicate too, so a second case can never be created.
- **No generated CAD numbers:** the simulated CAD feed and *New fictional CAD incident* are gone; the server starts
  with no active case. The test console has **Close the active case**, and its demo case takes a typed CAD number.
- **Audit:** *STEMI case opened by K. Ahmed, Paramedic (Ambulance 214) — CAD #… · CAD number entered manually by
  crew (not from dispatch)*; corrections before Send are listed; the case record stores how the number was entered.
- **Cardiologist:** unchanged; it shows the crew's CAD number in the alert, header, ECG review and timeline.
- **Fixed:** on the crew home screen, a case with CONFIRMED STEMI or a failed transmission turned its card into a
  full-screen red block with unreadable text (the failure screen's style also matched the card). The card now shows
  the intended red border.
- Acceptance test updated to 19 steps with the CAD checks; new `npm run test:cad`.

## 17. Changes in 0.1.1

- Every audit event now also records the **role** (`crew`, `cardiologist`, `system`, `cad-feed`). A database made by
  0.1 gets the new column on the next start; existing events are kept (their role is left empty).
- The AI sections on both screens use the wording of the brief: *AI interpretation is decision support. The
  Cardiologist makes the final STEMI decision.*
- The day's first simulated incident is `CAD #YYYYMMDD-0123-1`, matching the brief's example.
- The test console has **Pre-filled demo case (sent)** (see section 4).
- Kept as approved, not changed: the third decision is labelled **UNCLEAR / REQUEST REPEAT ECG** on the phone (the
  prototype's wording); it is the brief's REQUEST REPEAT ECG option.

## 18. What changed from the approved prototype

The screens, wording and workflow are the prototype's. These changes were needed to make it work on real devices:

- The prototype simulated the platform inside one page. Now a real server and database hold the case, and each view
  is its own page on its own device.
- The EMT enters the CAD number manually (0.2.0); in 0.1 it came from a simulated CAD feed in the test console.
- **Upload** of a real image file was added next to the simulated camera.
- A login page with the two test users; the names on screen come from the login.
- The device frames are gone: the crew screen fills the Mac window in the MDT's landscape layout, and the
  cardiologist screen fills the iPhone. On a larger screen the cardiologist gets the tablet or workstation layout.
- The iPhone needs one tap on **START · ENABLE ALARM SOUND** before it can sound, because browsers require it.
- On the iPhone's new-case alert, the CAD number sits on its own line under *Case*, so a phone screen never splits
  it across two lines.
- The prototype's *Simulate* panel became the test console, which also shows the checklist, timestamps and audit trail.
- Times are real (the server's clock), not a simulated clock.
- The crew's unsent draft and any entries made without a connection are kept in the Mac's browser until they reach
  the server, so a refresh loses nothing.
