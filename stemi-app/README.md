# Unified STEMI Platform · crew ↔ cardiologist test build

**Version 0.1 · 4 October 2026 · built from the approved round-3 prototype (v0.2, "Connected crew and cardiologist")**

> **TEST BUILD · FICTIONAL DATA ONLY.** Use only fictional patients, simulated CAD numbers, simulated ECG images and the
> two test users. Never enter real patient information: this build runs over plain HTTP on a local Wi-Fi network and
> has no production security. The ECG AI is a **simulation**, not a clinical model. Not for clinical use.

One server runs on a Mac and serves two live views of the same CAD case:

| Device | Role | Address |
|---|---|---|
| The Mac's browser | Crew MDT (the approved landscape tablet layout) | `http://localhost:3000/crew` |
| An iPhone in Safari, on the same Wi-Fi | Cardiologist | `http://<the Mac's IP address>:3000/cardiologist` |
| The Mac's browser, second window (optional) | Test console: simulated CAD feed, checklist, timestamps, audit trail | `http://localhost:3000/control` |

When the crew presses **Send to cardiologist**, the case and ECG are stored on the server, the case appears on the
iPhone by itself, and the new-case alarm sounds until **ACKNOWLEDGE & OPEN**. Every later update (vital signs,
medication, ECG 2, AI result) arrives silently, marked NEW with its time. The cardiologist's decision appears on the
crew screen straight away. Refreshing either page loses nothing.

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
3. **Start the server** in Terminal:
   ```bash
   cd ~/Documents/stemi-app
   npm start
   ```
   There is no `npm install` step. The first start creates the test database in `data/`.
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

## 2. The first acceptance test (18 steps)

The two sample ECG images are in `samples/`. They are generated test images, marked *FICTIONAL TEST ECG · NOT A PATIENT*.

| # | Device | Do this | You should see |
|---|---|---|---|
| 1 | Mac | Open `/crew` and log in | The active CAD incident and **LIVE — CONNECTED · Last update HH:MM:SS** |
| 2 | Mac | **Open STEMI pathway** | The case under its CAD number, e.g. **CAD #20261004-0123-1** |
| 3 | Mac | **Upload** → choose `samples/test-ecg-1-borderline-anterior.jpg` (or tap the camera button for a simulated photo) | ECG 1 with the tablet's image check |
| 4 | Mac | Enter the minimum dataset: age, sex, complaint, onset, BP, HR, SpO2, GCS (each can be *Unknown* / *Not obtained*) | **Send to cardiologist** becomes available |
| 5 | Mac | **Send to cardiologist** | ECG RECEIVED, then CARDIOLOGIST ALERTED |
| 6 | iPhone | Nothing; wait | **NEW CARDIAC CASE** with CAD #, unit and *ECG received HH:MM* appears by itself |
| 7 | iPhone | Listen | The alarm sounds and repeats |
| 8 | iPhone | **ACKNOWLEDGE & OPEN** | ECG 1 opens |
| 9 | iPhone | Listen | The alarm stops |
| 10 | Mac | Nothing; watch | CARDIOLOGIST ACKNOWLEDGED, then CARDIOLOGIST REVIEWING (*Dr X is looking at the ECG…*) |
| 11 | Mac | Next to BP, **Update** → enter e.g. `94/60` → **Save and send** | The new BP in the record, the previous one kept |
| 12 | Mac | Treatments given → **Aspirin** → **Enter** → **Given** → **Save and send** | Aspirin in the record |
| 13 | Mac | **Capture new ECG (ECG 2)** → **Upload** → `samples/test-ecg-2-evolving-anterior.jpg` → **Send to cardiologist** | ECG 2 received |
| 14 | iPhone | Nothing; watch | NEW BP, NEW Aspirin and **NEW — ECG 2 received — HH:MM**, without refresh and **without sound** |
| 15 | iPhone | **Compare ECG 1 \| ECG 2** | The two ECGs side by side |
| 16 | iPhone | Open ECG 2 and scroll to **AI ECG interpretation** | The AI result, the same as on the crew screen, with *AI interpretation is decision support only. Final STEMI decision: Cardiologist.* |
| 17 | iPhone | **Decide** → **CONFIRMED STEMI** → **Confirm STEMI** | The decision recorded with Dr X's name and time |
| 18 | Mac | Nothing; watch | **CONFIRMED STEMI** takes over the crew screen at once; press **Acknowledge** |

The **test console** (`/control`) ticks each step off as the case record shows it happened, and shows the pathway
timestamps and the audit trail (time, user, action, CAD number). To run the test again, press
**New fictional CAD incident** there: both screens start the new case.

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

It stands in for the CAD feed and for the prototype's *Simulate* panel:

- **New fictional CAD incident** starts a new simulated incident (CAD number, Ambulance 214, chest pain) on both
  screens. One case is active at a time.
- **Delete all test data** wipes every case and image (the test users stay).
- **Simulation settings:** test ECG findings (borderline then evolving, or a clear STEMI pattern), the next simulated
  photo (good, glare, leads cut off), the AI (completes, unavailable, stays processing), screen IDs on the devices.
- **Reminder interval reached** and **Escalation threshold reached.** Reminder and escalation times are governance
  configurable and not set, so nothing reminds or escalates by itself; these buttons fire them.
- Which devices are connected, the 18-step checklist, the pathway timestamps and the audit trail.

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
- **One case record, identified by the CAD number.** Every row in the database carries the CAD number. There is no
  temporary STEMI ID.
- **Real time:** the server pushes the whole case record to every open screen over Server-Sent Events whenever it
  changes, plus a heartbeat every 5 seconds. Screens send actions (Send, an update, acknowledge, decide) as HTTP
  requests. Each action has a unique id and is stored once, so resending after a lost connection is harmless.
- **Nothing is overwritten:** each new vital sign, correction, ECG and decision is a new row; the audit trail records
  time, user, action and CAD number for every event.
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
- The tables follow the case: `cases`, `patient_details`, `observations`, `treatments`, `ecgs`, `ecg_images`,
  `ai_interpretations`, `cardiologist_alerts`, `alert_followups`, `ecg_views`, `decisions`, `destinations`, `etas`,
  `case_updates`, `audit_events`, plus `users`, `ops` (every action received, once) and `settings`. The schema is
  `server/schema.sql` and is created on first start.
- **Start fresh:** press *Delete all test data* in the test console, or stop the server and run `npm run reset`.
- **Look inside** with the `sqlite3` tool that comes with macOS:
  ```bash
  sqlite3 data/stemi-test.db
  sqlite> .tables
  sqlite> SELECT datetime(at/1000,'unixepoch','localtime') AS time, cad, actor, action FROM audit_events ORDER BY at;
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
│   ├── seed.js                test users and the simulated CAD incident
│   ├── config.js              settings from the environment
│   └── ai/
│       ├── index.js           the AI service interface (provider chosen by AI_PROVIDER)
│       └── mock.js            the simulated AI: scripted test findings
├── public/
│   ├── crew/                  crew MDT screens (from the approved prototype)
│   ├── cardiologist/          cardiologist screens, phone / tablet / workstation layouts, alarm
│   ├── control/               test console
│   ├── login/                 login page
│   └── shared/                live link, fictional ECG image generator, fonts
├── samples/                   fictional test ECG images for upload
└── scripts/
    ├── acceptance.js          automated 18-step test with two browsers (needs Playwright)
    ├── make-sample-ecgs.js    regenerates the sample ECG images
    └── reset.js               deletes the test data
```

---

## 9. Automated acceptance test

`scripts/acceptance.js` runs the 18 steps with two real browsers against a real server: a desktop window as the crew
MDT and an iPhone-sized window as the cardiologist, opened from the Mac's network address over plain HTTP as the
iPhone does. It counts every alarm tone to prove the alarm sounds for the new case only, then checks refresh,
offline entries, the audit trail and script errors. It uses its own temporary database and leaves `data/` alone.

```bash
npm install --no-save playwright && npx playwright install chromium   # once; not needed to run the app
npm run test:acceptance
```

Screenshots and the audit trail go to `scripts/out/`. The last run passed 27 of 27 checks on Node 22 and Node 24: the
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
- **One active case at a time**, one crew user and one cardiologist (Q-69, Q-73).
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

## 14. What changed from the approved prototype

The screens, wording and workflow are the prototype's. These changes were needed to make it work on real devices:

- The prototype simulated the platform inside one page. Now a real server and database hold the case, and each view
  is its own page on its own device.
- The CAD incident comes from the test console's simulated CAD feed.
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
