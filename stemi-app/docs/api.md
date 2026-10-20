# HTTP API and live events · MASAR STEMI Coordination Platform 0.7.0

> **PROTOTYPE · FICTIONAL TEST DATA ONLY.** The sessions described here are prototype sessions, not secure
> authentication; the corpuls and AI data are simulated ([handover.md](handover.md#production-readiness-labels)).
>
> **Compatibility.** These are the contracts of the screens in `public/`. Every name below is read by the browser code.
> Do not rename, remove or change the meaning of a field, an event or a status code without changing `public/` and this
> document in the same change, and record it as a breaking change in [handover.md](handover.md). Adding a field is safe.

Source of truth: `src/Masar.Api/Controllers/*`, `src/Masar.Api/Contracts/ApiContracts.cs`,
`src/Masar.Application/**` (results and records), `src/Masar.Domain/Pathway/PathwayStateMachine.cs` (refusals).

**Contents:** [1 Conventions](#1-conventions) · [2 Sessions and roles](#2-sessions-and-roles) ·
[3 Pages and files](#3-pages-and-static-files) · [4 Health and session](#4-health-and-session) ·
[5 Cases](#5-cases) · [6 ECG images](#6-ecg-images) · [7 The corpuls feed](#7-the-corpuls-feed-crew) ·
[8 Clinical actions](#8-clinical-actions-post-apiops) · [9 Live events](#live-events) ·
[10 The case record](#the-case-record) · [AI result](#ai-result) · [Monitor record](#monitor-record) ·
[11 Test console](#11-test-console-api-test-only)

---

## 1. Conventions

- **JSON** request and response bodies; property names in camelCase. A body that is not valid JSON → `400
  {"error":"Bad JSON"}`. JSON bodies are limited to 1 MB (larger → 413).
- **Times** are Unix epoch **milliseconds** (UTC). `null` means "not (yet) happened" or "not known".
- **Optional fields** marked *(optional)* are **left out** of the JSON when they do not apply; all other fields are
  always present (possibly `null`).
- **Errors** are `{ "error": "<message for the user>" }`, sometimes with more fields. The messages are shown on the
  screens as they are.
- **CAD number**: any typed form is accepted (`CAD#20261004-0123-1`, `cad # 20261004-0123-1`, extra spaces,
  `2026100401231`) and normalised to the canonical form `YYYYMMDD-NNNN-N`, for example `20261004-0123-1`
  (`src/Masar.Domain/Rules/CadNumber.cs`). Invalid: `{"error":"Enter a valid CAD number before continuing.",
  "detail": …}` with detail *The CAD number is empty.* · *Incomplete or not a CAD number. Expected format:
  20261004-0123-1* · *The date part YYYYMMDD is not a valid date. Expected format: 20261004-0123-1*.
- **Caching**: every API answer and page is sent with `Cache-Control: no-store` (static files: `no-cache`; images:
  `private, max-age=86400, immutable`). Every answer also carries `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY`.
- **Unknown address**: 404 — `{"error":"Not found"}` under `/api`, the text `Not found` elsewhere.

## 2. Sessions and roles

PROTOTYPE ONLY (`src/Masar.Api/Security/`). Two kinds of session, both ASP.NET Core authentication cookies (HttpOnly,
SameSite=Lax, Path=/, protected with the Data Protection keys in `data/keys/`):

| Session | Cookie | Obtained by | Lifetime |
|---|---|---|---|
| Crew login | `stemi_sid` | `POST /api/login` | `Sessions:CrewSessionHours` (24 h), not sliding |
| Device session for `er`, `cardiologist`, `control` | `stemi_dev_er`, `stemi_dev_cardiologist`, `stemi_dev_control` | opening `/er`, `/cardiologist` or `/control` | `Sessions:DeviceSessionDays` (30 days), not sliding |

**The screen names its role** on every API request: header `X-Stemi-Role: crew | er | cardiologist | control`, or the
query parameter `?role=` (used by the event stream); without either, `crew`. A device role is accepted only with that
role's device session; any other value is treated as the crew and needs the crew login.

| Without a valid session | Answer |
|---|---|
| role `crew` | `401 {"error":"Not logged in"}` |
| role `er`, `cardiologist`, `control` | `401 {"error":"No session for this screen: reload the page"}` |

The endpoints below say who may call them; another role gets `403` with the message given.

## 3. Pages and static files

| Method, path | Who | Answer |
|---|---|---|
| `GET /` | anyone | role chooser |
| `GET /login` | anyone | crew login page |
| `GET /crew` | crew login | the crew MDT; without the login `302` to `/login?next=%2Fcrew` |
| `GET /er`, `/cardiologist`, `/control` | anyone | the screen; issues that role's device session on the first visit (`Set-Cookie`) |
| `GET /assets/{path}` | anyone | a file of the screens' folder (`Frontend:RootPath`), `Cache-Control: no-cache` |
| `GET /favicon.ico` | anyone | `204` |

Each page is HTML with `<!--APP-->` replaced by `<script>window.APP={"role":…,"user":…,"version":"0.7.0"};</script>`:
`role` is `null` for `/` and `/login`; `user` is the crew user (see `GET /api/me`) on `/crew`, otherwise `null`.

## 4. Health and session

### `GET /health`
No session. Is the server alive? Nothing about cases, users, settings or secrets.

```json
{"status":"ok","app":"stemi-unified-platform","environment":"development","version":"0.7.0",
 "port":3000,"pid":12345,"startedAt":"2026-10-20T08:03:22.262Z","uptimeSeconds":42}
```

`environment` is the ASP.NET Core environment name in lower case (`development`, `production`, …).

### `POST /api/login` — crew test login (PROTOTYPE ONLY)
No session needed. Body `{ "email": "crew@test.local", "password": "…" }` (the e-mail is trimmed and lower-cased).

| Status | Body |
|---|---|
| 200 | `{ "role": "crew", "name": "K. Ahmed" }` and `Set-Cookie: stemi_sid=…` |
| 401 | `{"error":"Email or password not recognised"}` |
| 401 | `{"error":"This login is for the crew MDT only. The ER Doctor and Cardiologist screens need no login: open /er or /cardiologist."}` (a non-crew account of an earlier version) |

### `POST /api/logout`
No session needed. `200 {"ok":true}`; the crew cookie is cleared.

### `GET /api/ping`
No session needed. `200 { "ok": true, "now": <server time> }`.

### `GET /api/me`
Any screen session. `200 { "role": "<role>", "user": <crew user or null>, "version": "0.7.0" }` with the crew user
`{ "id", "email", "role", "name", "title", "org", "unit", "emirate", "device": null }` for the crew, `null` otherwise.

### `GET /api/info`
Any screen session (used by the test console).

```json
{ "version": "0.7.0", "aiProvider": "mock",
  "corpuls": { "name": "mock", "simulated": true, "demo": true, "every": 5000 },
  "clients": 3,
  "presence": { "crew": { "up": true, "at": 1792483495320 }, "er": { "up": null, "at": null }, "cardiologist": { "up": false, "at": 1792483501002 } },
  "urls": [ { "name": "en0", "er": "http://192.168.1.20:3000/er", "cardiologist": "http://192.168.1.20:3000/cardiologist" } ] }
```

`presence[role].up` is `null` until a screen of that role has connected once since the server started. `urls` lists
the computer's IPv4 network addresses (`en0` first).

## 5. Cases

All case endpoints need a screen session. The **case command response** (`CaseCommandResponse`) used by the crew's
commands has these fields:

| Field | Meaning |
|---|---|
| `status` | the outcome: `created` · `same` · `exists` · `invalid` · `corrected` · `opened` · `missing` · `other-unit` · `sent` · `discarded` · `closed` · `incomplete` · `completed` · `linked` · `error` |
| `cad` | the CAD number concerned (canonical) |
| `ok` *(optional)* | `true` on success |
| `code` *(optional)* | on refusal, the outcome again (`invalid`, `exists`, `missing` …) |
| `error`, `detail` *(optional)* | the message to show |
| `existing` *(optional)* | the case already under that CAD number: `{ cad, active, submittedAt, unit, openedAt, closedAt }` |
| `state`, `kind` *(optional)* | the case's state (`incomplete`); its closure kind (`closed`) |
| `already` *(optional)* | `true` when the corpuls link already existed |
| `rec` *(optional)* | the case record ([§10](#the-case-record)) |

### `GET /api/cases/check?cad=`
Crew only (`403 {"error":"Only the crew opens cases"}`). Is the CAD number valid, and is there already a case under
it? `200 { "ok": false, "cad", "error", "detail" }` · `{ "ok": true, "cad", "exists": false }` ·
`{ "ok": true, "cad", "exists": true, "existing": {…} }`. Not used by the current screens (they create directly).

### `POST /api/cases` — create the case under a CAD number
Crew only (`Only the crew opens cases`).

| Body field | Meaning |
|---|---|
| `cad` | the CAD number as typed |
| `cid` *(optional)* | the tablet's own id for this case (first 64 characters kept): a resent create with the same `cid` is harmless |
| `openedAt` *(optional)* | when the pathway was opened on the tablet; kept if within the last 24 h and not more than 60 s ahead, otherwise the server time |
| `hist` *(optional)* | `[ { "v": <CAD number>, "t": <time> } ]`: the numbers typed before confirming (last 10); each change is audited as a correction before sending |
| `link` *(optional)* | `true`: link the unit's corpuls monitor at once |
| `autoEcg` *(optional)* | `false`: no automatic simulated ECG 1 (the tablet already holds a manual fallback ECG); default `true` |

| Status | Body |
|---|---|
| 201 | `{ "status": "created", "cad", "ok": true, "rec" }` |
| 200 | `{ "status": "same", "cad", "ok": true, "rec" }` — the same `cid` again (links the monitor if `link` and not linked) |
| 400 | `{ "status": "invalid", "cad", "code": "invalid", "error", "detail" }` |
| 409 | `{ "status": "exists", "cad", "code": "exists", "existing" }` — CASE ALREADY EXISTS; no second case is created |

### `GET /api/cases?q=` — completed cases
Any role. `200 { "cases": [ <case summary> ] }`: closed cases whose CAD number contains `q` (normalised; only digits,
capital letters and `-` kept), newest closure first, at most 50, only those the screen may open (crew: own unit; ER:
sent cases; Cardiologist: activated cases, and ER-closed cases only when `q` has at least 4 characters; test console:
all). Case summary:

```json
{ "cad", "unit", "state", "legacy", "active", "created", "closedAt", "closedBy", "kind",
  "pt": { "age", "sex", "complaint" }, "ecgAt", "er": { "name", "assessment", "reason" },
  "cardio": { "activated", "name", "decision" } }
```

### `GET /api/cases/view?cad=` — one case, read-only
Any role. `200 { "rec": <case record> }`, or `404 {"error":"No case with this CAD number for this screen"}` when there
is no such case or the screen may not open it (crew: own unit; ER: sent cases; Cardiologist: activated or closed cases;
test console: all).

### `POST /api/cases/complete` (also `/api/cases/close`) — COMPLETE STEMI PATHWAY
Crew only (`Only the crew completes the STEMI pathway`). Body `{ "cad" }`.

| Status | Body |
|---|---|
| 200 | `{ "status": "completed", "cad", "ok": true }` — closed: reason *STEMI pathway completed*, source *crew*; read-only; the corpuls feed ends |
| 404 | `{ "status": "missing", "cad", "code": "missing", "error": "There is no case with this CAD number for this tablet" }` |
| 409 | `{ "status": "closed", "cad", "kind", "code": "closed", "error": "This STEMI pathway is already closed: it is read-only." }` |
| 409 | `{ "status": "incomplete", "cad", "state", "code": "incomplete", "error": "COMPLETE STEMI PATHWAY is available only while the current Cardiologist decision is CONFIRMED STEMI." }` |

### `POST /api/cases/open` — OPEN EXISTING CASE
Crew only (`Only the crew opens cases`). Body `{ "cad" }`. Opens the existing case on the tablet; nothing is created.
A case taken off the screens returns to them; a discarded unsent case is taken up again.

| Status | Body |
|---|---|
| 200 | `{ "status": "opened", "cad", "ok": true, "rec" }` |
| 400 | `invalid` (as for create) |
| 404 | `{ "status": "missing", "cad", "code": "missing", "error": "There is no case with this CAD number" }` |
| 403 | `{ "status": "other-unit", "cad", "code": "other-unit", "error": "This CAD number belongs to a case of another unit" }` |

### `POST /api/cases/correct` — correct the CAD number before SEND
Crew only (`Only the crew corrects a CAD number`). Body `{ "cad": <current>, "to": <corrected> }`. Moves the unsent
case — with anything already received from corpuls — to the corrected number in one transaction (every table that
carries the CAD number); the corpuls feed follows; the screens drop the old number.

| Status | Body |
|---|---|
| 200 | `{ "status": "corrected", "cad": <new>, "ok": true, "rec" }`, or `"same"` when the number did not change |
| 400 | `invalid` (the new number) |
| 409 | `{ "status": "exists", "cad", "code": "exists", "existing" }` — the new number is taken |
| 404 | `{ "status": "missing", …, "error": "There is no unsent case with this CAD number on this tablet" }` |
| 409 | `{ "status": "sent", …, "code": "sent", "error": "The case was already sent: its CAD number is locked." }` |

### `POST /api/cases/discard` — discard an unsent case
Crew only (`Only the crew discards an unsent case`). Body `{ "cad" }`. The case stays stored as an unsent draft
(OPEN EXISTING CASE can take it up again); its corpuls feed ends; nothing reached the ER.

| Status | Body |
|---|---|
| 200 | `{ "status": "discarded", "cad", "ok": true }` (also when it was already discarded) |
| 404 | `{ "status": "missing", …, "error": "There is no unsent case with this CAD number on this tablet" }` |
| 409 | `{ "status": "sent", …, "code": "sent", "error": "The case was already sent: it cannot be discarded." }` |

## 6. ECG images

### `POST /api/images?cad=<CAD number>&src=file|test-generator`
Crew only (`403 {"error":"Only the crew uploads ECG images"}`). The manual ECG fallback: the request body is the image
itself, `Content-Type: image/jpeg` or `image/png`. `cad` must be the canonical CAD number (not normalised here). The
image is stored with its SHA-256 but belongs to no ECG until a `submit`, `ecg` or `img` action names it (`imageId`).

| Status | Body |
|---|---|
| 200 | `{ "id": "img…", "url": "/files/img…", "sha256": "<hex>" }` |
| 415 | `{"error":"JPEG or PNG only"}` |
| 404 | `{"error":"There is no case with this CAD number for this tablet"}` |
| 409 | `{"error":"This STEMI pathway is closed: it is read-only"}` |
| 413 | `{"error":"Too large"}` (over `Storage:MaxImageBytes`, default 8 MiB) |
| 400 | `{"error":"Empty image"}` |

`src=file` marks an uploaded file; anything else `test-generator` (the fictional test ECG generator).

### `GET /files/{id}`
Any valid session (crew, or any device session): `401 {"error":"Not signed in"}` otherwise. The stored image
(`image/svg+xml` for corpuls ECGs drawn by the platform, `image/png`, `image/jpeg`), with
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'` and `X-Content-Type-Options: nosniff`. Unknown
id: `404 Not found`.

## 7. The corpuls feed (crew)

### `POST /api/corpuls/link`
Crew only (`Only the crew links the corpuls monitor`). Body `{ "cad" }`. Links the case to the unit's monitor (the case
must exist). A monitor still linked to another case ends that case's feed (one monitor serves one patient).

| Status | Body |
|---|---|
| 200 | `{ "status": "linked", "cad", "ok": true, "already": true?, "rec" }` (`already` when the link existed; nothing changes) |
| 404 | `{ "status": "missing", "cad", "code": "missing", "error": "There is no case with this CAD number for this tablet: enter the CAD number first." }` |
| 409 | `{ "status": "closed", "cad", "code": "closed", "error": "This STEMI pathway is closed: it is read-only." }` |

### `POST /api/corpuls/demo-acquire` — PROTOTYPE ONLY (demo mode)
Crew only (`Only the crew acquires the simulated 12-lead`). Body `{ "cad" }`. Stands in for a 12-lead acquired on the
monitor (no physical monitor is connected): the ECG then arrives through the simulated feed like any corpuls ECG.
Answer `{ "ok", "code", "status", "cad", "n" (optional), "held" (optional), "error" (optional) }`:

| `status` | HTTP | Meaning / `error` |
|---|---|---|
| `ok` | 200 | `n`: the ECG number; `held`: the monitor holds it until it is connected |
| `missing` | 404 | *There is no case with this CAD number for this tablet.* |
| `off` | 409 | *The simulated corpuls demo is not on in this build.* (`cad` is null) |
| `closed` | 409 | *This STEMI pathway is closed: it is read-only.* |
| `unlinked` | 409 | *This case is not linked to the simulated corpuls monitor.* |
| `refused` | 409 | the simulated monitor's reason (for example not connected) |

## 8. Clinical actions: `POST /api/ops`

The crew, ER Doctor and Cardiologist screens send their clinical actions here, in order
(`src/Masar.Api/Controllers/ActionsController.cs`, `src/Masar.Application/Actions/ActionService.cs`).

**Request:** `{ "ops": [ { "id", "cad", "k", "t", "data" } ] }`, 1 to 200 actions.

| Field | Meaning |
|---|---|
| `id` | a unique id for the action (string, at most 80 characters). The action is stored once: the same id again is answered `dup` and changes nothing (a resend after a reconnection is harmless). |
| `cad` | the case's CAD number |
| `k` | the action kind (tables below) |
| `t` | the device time of the action (ms); kept when within the last 48 h and not more than 60 s ahead of the server, otherwise the server's time |
| `data` | the action's fields (object) |

**Answer:** `200 { "results": [ … ], "now": <server time> }`, one result per action, in order:
`{ "id", "ok": true, "rcv": <server receive time> }` · `{ "id", "ok": true, "dup": true, "rcv" }` ·
`{ "id", "ok": false, "error", "status" }`.

| Whole request refused | Answer |
|---|---|
| test console (or any non-clinical role) | `403 {"error":"This screen does not record clinical actions"}` |
| no actions, or more than 200 | `400 {"error":"No actions"}` |

| One action refused | `status` | `error` |
|---|---|---|
| not readable (`id` not a string or longer than 80, `k` missing) | 400 | *This action could not be read.* |
| no case under `cad`, or a crew action on another unit's case | 404 | *There is no case with this CAD number for this screen.* |
| refused by the state machine | 409 | see below |
| not an action of this role | 403 | *"&lt;k&gt;" is not an action for the &lt;role&gt; screen.* |
| refused by the action's own rules | 400 / 409 | see the tables |
| unexpected failure (logged) | 500 | *The server could not store this action.* |

Each action is applied in its own transaction: a refused action changes nothing, and the next actions of the batch are
still applied. The audit trail records every accepted action; a crew entry received more than 5 s after it was saved
on the tablet keeps both times in its audit text (*… · saved on the tablet hh:mm:ss, received on reconnection*, or
*… · received hh:mm:ss, on reconnection*).

**State machine refusals (409)** — `PathwayStateMachine.Guard`:

| When | Message |
|---|---|
| the case is closed, and the action is not `viewed`, `seen`, `compare`, `decrcv`, `decack`, `erack`, `hopen`, `er_shown` or `shown` | *This STEMI pathway is closed: it is read-only.* |
| crew `ecg`, `img`, `md`, `rec`, `note`, `hopen`, `decrcv`, `decack`, `erack` on an unsent case | *Send the case before adding to it.* |
| any ER action on an unsent case | *This case has not been sent to the ER.* |
| ER `er_assess` before ACCEPT CASE | *Accept the case before recording the ER assessment.* |
| ER `er_assess` when the assessment exists | *The ER assessment for this case is already recorded.* |
| any Cardiologist action before cardiology was activated | *Cardiology has not been activated for this case: no cardiologist action can be recorded.* |
| Cardiologist `decision` before ACKNOWLEDGE & OPEN | *Acknowledge the case before recording a decision.* |

**Shared rules for the fields:**

- *Names* (`name`): trimmed, inner spaces collapsed, control characters removed, 2–80 characters, at least one letter.
  Refusals (400): *Enter your name.* · *Enter your full name (at least 2 characters).* · *The name is too long (at most 80
  characters).* · *Enter a name that contains letters.* The name is PROTOTYPE ONLY identification.
- *Free text*: control characters removed (line breaks kept), trimmed, cut to the length given (default 500).
- *The latest ECG* (`on`): an ER assessment or a Cardiologist decision names the ECG it covers; it must be the case's
  latest ECG. Missing or not an integer: 400 *The decision must name the ECG it covers.* Older: 409 *ECG &lt;N&gt; has
  arrived since this screen was updated. Review ECG &lt;N&gt; before recording this.*

### Crew actions

| `k` | `data` | Effect | Refusals (besides the state machine) |
|---|---|---|---|
| `open` | — | nothing (kept for tablets of 0.4; the opening is recorded when the case is created) | — |
| `submit` | `sendAt`, `late` (a first attempt failed), `md` `{ <field>: { v, raw, t, fb } }`, `ecg` (optional: a manual fallback ECG `{ n, acq, variant, pri, same, timeWhy, imgs: [ { i, kind, q, at, imageId } ] }`) | **SEND TO ER**: the case is received (`submitted_at`, `server_received_at`, `er_alerted_at`); the minimum data is stored (a vital sign with `fb: true` as a manual fallback entry); a fallback ECG is stored as the next ECG with its images; the latest monitor values are recorded as sent with the case; the ER is alerted (not the Cardiologist); the AI is started for a fallback ECG. A resend after the case was received changes nothing. | 400 *An ECG is needed to send the case: wait for the ECG from corpuls, or use the manual ECG fallback.* · 400 when one of the four items `age`, `sex`, `complaint`, `onset` has no answer (`v` empty) or an impossible one — *Enter the age (or an estimate), or choose Unknown.* · *Age: a whole number from 0 to 120 years.* (`raw.v`, unless `raw.nv`) · *Choose the sex, or Unknown.* · *Choose the presenting complaint (or the reason for the ECG).* · *Describe the presenting complaint.* (`raw.k` = `oth` without `raw.other`) · *Enter the symptom onset time, or choose Unknown.* · *The onset time cannot be in the future.* (`raw.t` more than 5 min ahead, unless `raw.nv`) · 409 *Image &lt;i&gt; of ECG &lt;n&gt; was not found on the server* |
| `ecg` | `ecg` `{ n, acq, variant, pri, same, timeWhy, imgs }`, `sendAt` | a manual fallback ECG after SEND: stored as the next ECG number (if an ECG from corpuls took the number meanwhile, this one becomes the next and the audit says so); images linked; NEW list entry; AI started | 400 *This ECG could not be read.* · 409 *The case has &lt;N&gt; ECG(s): the next ECG is ECG &lt;N+1&gt;, not ECG &lt;n&gt;.* · 400 *ECG &lt;n&gt; needs at least one image.* · 409 image not found |
| `img` | `n`, `img` `{ i, imageId, kind, q, at }` | another image of the same manual ECG (not a new ECG) | 400 *This image could not be read.* · 409 *ECG &lt;n&gt; is not on the server.* · 409 *ECG &lt;n&gt; came from corpuls: a photo is added as a new ECG with the manual ECG fallback.* · 409 *ECG &lt;n&gt; already has an Image &lt;i&gt;. Nothing is replaced: add it again as a new image.* (the same image again is accepted without change) |
| `md` | `k` (`age`, `sex`, `complaint`, `onset`, `bp`, `hr`, `spo2`, `rr`, `gcs`), `v` (≤ 120), `raw`, `at`, `kind` (`update` · `correct` · `clarify` · `fallback`; default `update`), `why` (≤ 200) | a new minimum-data entry; the previous value is kept | 400 *Unknown field.* · 400 *&lt;Label&gt;: no value.* |
| `rec` | `k` (item key, letters, digits and `-`, ≤ 24; default `otx`), `label` (≤ 60), `v` (≤ 300), `at` | a treatment update, shown silently to the ER and the Cardiologist | 400 *A treatment update needs a treatment and what was done.* |
| `hopen` | — | the Case Summary was opened (recorded once) | — |
| `decrcv` | `id` (decision id) | the decision was shown on the tablet (recorded once) | — |
| `decack` | `id` | the crew acknowledged the decision (recorded once) | — |
| `erack` | — | the crew acknowledged the ER outcome *cardiology not activated* (recorded once) | — |
| `note` | `text` | a note in the audit trail | — |

ECG fields: `n` the ECG number the tablet expects; `acq` acquisition time; `variant` the fictional test pattern
(`border` · `evolved` · `clear` · `clear2`, ≤ 20 characters); `pri` the primary image (default 1); `same` same as the
previous ECG; `timeWhy` why the time was adjusted (≤ 200); `imgs` the uploaded images (`kind` default `full`, `q`
quality default `good`). Minimum-data entry: `v` the value shown, `raw` the structured value (any JSON), `t` when it was
taken.

### ER Doctor actions

| `k` | `data` | Effect | Refusals (besides the state machine) |
|---|---|---|---|
| `er_shown` | — | the NEW STEMI CASE alert was shown (alarm started); recorded once, while SENT TO ER | — |
| `er_accept` | `name` | **ACCEPT CASE**: the ER Doctor's name and the time; the alarm stops. Already accepted: nothing changes (the first ER Doctor is kept). | name refusals |
| `er_assess` | `kind` (`activate` · `uncertain` · `not_suspicious`), `on`, `name` (optional; default the accepting ER Doctor), `reason`, `comment` | `activate` / `uncertain`: the assessment, **cardiology activated**, the cardiologist alert; the Cardiologist is alerted. `not_suspicious`: the assessment with its reason and comment; the STEMI screening pathway **closes** (reason *ER Doctor assessment: NOT SUSPICIOUS FOR STEMI*, source *ER Doctor screening decision*); no cardiologist alert, no cardiologist decision. | name refusals · the latest-ECG rule · 409 *View ECG N before recording the assessment.* (the ER Doctor's screen has not recorded a `viewed` action for ECG N) · 400 *Select the reason why cardiology is not activated.* · 400 *OTHER needs an explanation: describe the reason.* · 400 *Unknown ER assessment.* |
| `viewed` | `n`, `i`, `name` (optional) | the ER's first view of image `i` of ECG `n` (recorded once per image) | — |
| `compare` | `ns` (ECG numbers), `name` (optional) | the serial ECG comparison was opened (audit) | — |
| `note` | `text`, `name` (optional) | a note in the audit trail | — |

`reason` keys for `not_suspicious`: `criteria` (ECG DOES NOT MEET STEMI CRITERIA), `alternative` (ALTERNATIVE DIAGNOSIS
SUSPECTED), `not-acute` (ECG CHANGES NOT CONSISTENT WITH ACUTE STEMI), `clinical` (CLINICAL PRESENTATION NOT CONSISTENT
WITH STEMI), `quality` (POOR ECG QUALITY — NOT DIAGNOSTIC), `other` (OTHER: `comment` required). `comment` ≤ 500.

### Cardiologist actions

| `k` | `data` | Effect | Refusals (besides the state machine) |
|---|---|---|---|
| `shown` | — | the NEW CARDIOLOGY ACTIVATION alert was shown (alarm started); recorded once | — |
| `ack` | `name` | **ACKNOWLEDGE & OPEN**: the Cardiologist's name and the time; the alarm stops. Already acknowledged: nothing changes. | name refusals |
| `viewed` | `n`, `i`, `name` (optional) | the Cardiologist's first view of an image; the first view after acknowledgement records *review started* | — |
| `seen` | `ids` | marks NEW list entries seen (kept for screens of 0.4) | — |
| `compare` | `ns`, `name` (optional) | the serial ECG comparison was opened | — |
| `decision` | `k` (`confirm` · `not` · `repeat`), `on`, `name` (optional; default the acknowledging Cardiologist), `reason` (≤ 300; required for `not`), `note` (to the crew, ≤ 500), `adv` (advice, ≤ 500), `instr` (instruction, ≤ 300), `reasons` (up to 8 texts of ≤ 100), `also` (earlier ECG numbers also reviewed), `within` (minutes, 1–240), `ai` (`Agree` · `Disagree` · `Did not use`) | a decision; every decision is kept. `not` then **closes the pathway automatically** (reason *Cardiologist decision: NOT STEMI*, source *automatic following Cardiologist decision*). | 400 *Unknown decision.* · name refusals · the latest-ECG rule · 409 *View ECG N before deciding.* (no `viewed` action for ECG N from a Cardiologist screen) · 400 *NOT STEMI needs a reason.* |
| `note` | `text`, `name` (optional) | a note in the audit trail | — |

<a id="live-events"></a>
## 9. Live events: `GET /api/stream?role=<role>`

Server-Sent Events (`Content-Type: text/event-stream`), with the screen's session. The stream starts with
`retry: 2000` (reconnect after 2 s). Each event is `event: <name>` and `data: <one line of JSON>`.

| Event | Sent | Data |
|---|---|---|
| `init` | first; again after a test-data reset | `{ "now": <server time>, "epoch": "<data epoch>", "role" }` — the epoch changes when the test data is reset; a screen that sees a new epoch drops what it held |
| `cfg` | on connecting; when the test console changes a simulation choice | `{ "sim": { "find", "q", "ai", "ids" } }` ([§11](#11-test-console-api-test-only)) |
| `cases` | on connecting; after a test-data reset | `{ "list": [ <case record> ], "at" }` — every open case the screen may see (test console: every open case and the 12 most recently closed) |
| `presence` | test console only: on connecting; when a role comes online or goes offline (8 s after its last screen closed) | `{ "crew": { "up", "at" }, "er": {…}, "cardiologist": {…} }`; `up` is `null` until a screen of that role has connected once |
| `case` | after every change to a case the screen may see | `{ "cad", "rec": <case record>, "at" }`; `rec: null` when the case leaves the screen (for example taken off the screens, CAD number corrected) |
| `monitor` | a new vital-signs sample of a case the screen holds | `{ "cad", "mon": <monitor record>, "at" }` |
| `corpuls` | test console only: a simulated monitor changed | the simulator state ([§11](#11-test-console-api-test-only)) |
| `hb` | every `Live:HeartbeatMs` (5 s) | `{ "at": <server time> }` |

Which screen receives a case is decided on the server (`src/Masar.Application/Cases/CaseVisibility.cs`): crew — its
own unit's active cases; ER — every active case sent to the ER; Cardiologist — every active case where cardiology was
activated; test console — every case. The screens treat 12 s without any event as a lost connection.

<a id="the-case-record"></a>
## 10. The case record

One record per CAD number, the same on every screen (`src/Masar.Application/Cases/CaseRecord.cs`, built by
`CaseRecordBuilder.cs`). Sent by `GET /api/cases/view`, the `case` and `cases` events, and as `rec` in case commands.

| Field | Type | Meaning |
|---|---|---|
| `cad` | string | the CAD number |
| `unit`, `emirate` | string | the crew's unit and emirate |
| `crew` | string | who opened the case (*K. Ahmed, Paramedic*) |
| `state` | string | the pathway state ([clinical-workflow.md](clinical-workflow.md#4-states)) |
| `legacy` | bool | made before 0.5.0 (no ER step; read as already cardiology-activated) |
| `active` | bool | `false` when the test console took the case off the live screens |
| `created` | ms | created on the platform |
| `cadEntry` | `{ src, at, by }` | how the CAD number was entered: `manual-crew` · `manual-test-console` · `simulated-feed` (cases of 0.1); when it was confirmed; by whom |
| `path` | `{ at, by }` | when and by whom the STEMI pathway was opened |
| `sub` | `{ send, rcv, late }` or null | SEND: the tablet's time, the server's receive time, delivered after a failed first attempt; `null` while a draft |
| `er` | object | `alerted` (ER alerted at SEND), `shown` (alert first shown), `name` (ER Doctor who accepted), `accepted`, `assessment` (`activate` · `uncertain` · `not_suspicious`), `at`, `by`, `on` (ECG covered), `reason` (NOT SUSPICIOUS reason label), `comment`, `crewAck` (the crew acknowledged the outcome) |
| `cardio` | object | `activated` (for a legacy case the alert time), `by` (ER Doctor who activated), `reason` (*ER Doctor assessment: ACTIVATE CARDIOLOGIST* / *… UNCERTAIN*), `alerted`, `shown`, `ack` (acknowledged), `name` (the Cardiologist), `opened` (review started), `decision` (latest kind), `decisionAt` |
| `pt` | `{ <field>: [ entry ] }` | the crew's minimum data, every entry oldest first; entry `{ id, v, raw, t, rcv, by, kind, why }` — `kind`: `sent` · `update` · `correct` · `clarify` · `fallback`; `why` is `""` when none |
| `rec` | `{ <item key>: { label, group, vers: [ { id, v, nv, t, rcv, by, kind } ] } }` | treatment updates (`nv`: not obtained) |
| `ecgs` | `[ ecg ]` | ECG 1, 2, 3 … (below) |
| `dec` | `[ decision ]` | every Cardiologist decision, oldest first (below) |
| `upd` | `[ { id, at, kind, text, ref } ]` | the silent NEW list, oldest first; `kind`: `ecg` · `img` · `md` · `rec` · `ai` · `closed`; `ref` for example `{ "n": 2 }` |
| `audit` | `[ { t, text, who, role, kind, i } ]` | the audit trail, oldest first; `role`: `crew` · `er` · `cardiologist` · `system` · `test-console`; `kind`: `key` · `evt` · `view`; `i` the position |
| `views` | `{ "er": {…}, "cardiologist": {…} }` | first view of each image per role, keyed `"<ECG number>\|<image number>"` (for example `"2\|1"`), value the time |
| `hopen` | ms or null | the Case Summary was first opened |
| `discarded` | ms or null | the unsent case was discarded on the tablet |
| `closed` | `{ at, by, reason, source, kind }` or null | the closure; `kind`: `completed` · `not-stemi` · `er-not-activated` |
| `monitor` | object or null | the corpuls feed ([below](#monitor-record)); `null` when the case was never linked and has no monitor values |

**ECG** `{ n, acq, variant, pri, same, sent, rcv, by, why, imgs, ai, src, dev, seq, tx }`: `n` the number (across every
source); `acq` acquired; `variant` the fictional test pattern; `pri` the primary image; `same` same as the previous
ECG; `sent` / `rcv` sent and received; `by` the sender (the crew member, or *corpuls feed (simulated)*); `why` the
reason for an adjusted time (`""` when none); `imgs` `[ { i, kind, q, at, rcv, after, src, url } ]` (`q` quality,
`after` added after SEND, `src` `file` · `test-generator` · `corpuls`, `url` `/files/<id>`); `ai` the AI analysis
([below](#ai-result)) or `null` before it starts; `src` `corpuls` · `manual_fallback` · `test`, or `null` for crew
photos of 0.5.0 and earlier; `dev` the monitor; `seq` the monitor's own 12-lead count; `tx` transmitted.

**Decision** `{ id, k, at, rcv, by, byT, on, also, reason, note, adv, reasons, instr, within, ai, dlv, crewAck }`: `k`
`confirm` · `not` · `repeat`; `byT` *&lt;name&gt;, Cardiologist*; `on` the ECG covered; `also` earlier ECGs also
reviewed; texts are `""` when empty; `within` minutes or null; `ai` the AI feedback or null; `dlv` shown on the crew
tablet; `crewAck` acknowledged by the crew.

<a id="ai-result"></a>
### AI result

`ecgs[].ai` — Simulated AI Interpretation, PROTOTYPE ONLY (`src/Masar.Infrastructure/Ai/MockEcgAiProvider.cs`).

| Field | Meaning |
|---|---|
| `st` | `proc` (processing) · `ok` (completed) · `lim` (limited by image quality) · `wh` (image not suitable) · `down` (unavailable: AI failed or switched off in the test console) |
| `start` | when the analysis started |
| `done` | when it completed (absent while `proc`) |
| `q` | the image quality statement |
| `ver` | the provider's version text (*SIMULATED AI (mock service, test build) · not a clinical model*) |
| `pri` | the image analysed |
| `provider` | `mock` |
| `rhy`, `rate`, `ste`, `std`, `cond` | rhythm, rate (for a corpuls ECG the rate the monitor reported), ST elevation, reciprocal ST depression, conduction (`ok` and `lim` only) |
| `ser` | serial comparison with the previous ECG, or `null` for ECG 1: `{ vs, vsAcq, h, t }` (previous ECG number and time, heading, text) (`ok` and `lim` only) |
| `imp` | the overall impression (`ok` and `lim` only) |
| `conf` | the confidence statement (`ok` and `lim` only) |
| `lim` | `{ "ste": 1, "std": 1, "imp": 1 }` when limited by image quality, otherwise `{}` (`ok` and `lim` only) |

The same analysis is shown unchanged on every screen. It is decision support only.

<a id="monitor-record"></a>
### Monitor record

`rec.monitor`, and `mon` in the `monitor` event (`src/Masar.Application/Monitoring/MonitorRecord.cs`).

| Field | Meaning |
|---|---|
| `provider` | `mock` (simulated) · `corpuls-mission` |
| `simulated`, `demo` | a simulated feed; the prototype demo mode |
| `device`, `label` | the monitor's id (for example `SIM-C3-214`) and label |
| `linked`, `by` | when and by whom the case was linked |
| `status`, `statusAt` | `waiting` · `connected` · `reconnecting` · `disconnected`, since when |
| `ended`, `endWhy` | the feed ended (pathway closed, unsent case discarded, monitor linked to another case) and why |
| `last` | the last data received |
| `every` | how often values normally arrive (ms) — drives only the technical freshness indicator, never a clinical rule |
| `v` | the latest values `{ hr, spo2, rr, sys, dia, bpAt, at }` (blood pressure keeps its own measurement time), or null |
| `hist` | up to 12 history rows, newest first: `{ at, hr, spo2, sys, dia, bpAt, rr, source, why }`; `why`: `nibp` · `update` · `sample` · `at_send` |
| `log` | the feed's moments, oldest first: `{ at, kind, text }`; `kind`: `linked` · `connected` · `lost` · `restored` · `ended` · `ecg` · `fallback` |

<a id="11-test-console-api-test-only"></a>
## 11. Test console API — TEST ONLY

`src/Masar.Api/Controllers/TestConsoleController.cs`. Only the test console's device session (`X-Stemi-Role:
control`); any other role gets `403 {"error":"Test console only"}`. Any other address under `/api/control/` is `404
{"error":"Not found"}`. Must not exist in production.

| Method, path | Body | Answer |
|---|---|---|
| `GET /api/control/cases` | — | `{ "cases": [ <case summary> ] }`, every case, newest first (100) |
| `GET /api/control/corpuls` | — | the simulator state (below) |
| `POST /api/control/corpuls/reset-demo` | — | RESET CORPULS DEMO: every simulated monitor back to the clean demo state (cases and records untouched). `200 { "ok": true, "monitors": <n>, "sim" }`, or `409 { "ok": false, "error", "sim" }` with a non-simulated provider |
| `POST /api/control/corpuls/{command}` | `{ "cad", "sample"?, "hr"?, "spo2"?, "sys"?, "dia"?, "rr"? }` | drives the simulated monitor of the case (commands below). `200` when accepted, `409` when refused: `{ "ok", "error"?, "note"?, "dup"?, "n"?, "closed"?, "held"?, "sim" }` |
| `POST /api/control/sim` | `{ "find"?, "q"?, "ai"? }` | the simulation choices; unknown values are ignored. `{ "sim": { "find", "q", "ai", "ids" } }`; broadcast as `cfg`; `ai` `ok` or `down` lets analyses held at "processing" finish |
| `POST /api/control/reset` | — | **delete all test data**: every case, record, audit entry and image; the simulated monitors start afresh; a new data epoch, so every screen starts again. The crew test user and the simulation choices are kept. `{ "ok": true }` |
| `POST /api/control/screens` | `{ "cad", "on" }` | take a case off the live screens (`on: false`) or return it; the STEMI pathway is **not** closed. `{ "ok": <case found> }` |
| `POST /api/control/demo-case` | `{ "cad" }` | a pre-filled fictional case under the typed CAD number: created, linked to its own simulated monitor (`SIM-C3-DEMO-<last 5 digits>`), ECG 1 acquired on it, the minimum data, SEND. `200 { "ok": true, "cad" }` · `400 { …, "code": "invalid", "error": "<error> <detail>" }` · `409 { …, "code": "exists", "error": "CASE ALREADY EXISTS: CAD #<cad>. No second case was created." }` · `500 { …, "code": "error", "error" }` |

**Simulation choices:** `find` `border` · `clear` — the fictional test ECG pattern of the manual fallback, and the
demo case's ECG sample (`clear` → Sample C, otherwise A); `q` `good` · `glare` · `cut` — the quality of the next
fictional test photo; `ai` `ok` · `down` · `proc` — the mock AI completes, is unavailable, or stays processing; `ids`
always `false` in this build.

**Simulator commands** (`{command}`), with the platform's verdicts:

| Command | Effect | Refused with |
|---|---|---|
| `connect` | the monitor available and signal on; it comes online (resending its last ECG and sample if it had been connected) | — |
| `disconnect` | the monitor unavailable: `disconnected` | — |
| `reconnect` | `reconnecting`, online 1.5 s later | note *Already connected.* when connected |
| `signal-loss` | `reconnecting` until the signal is restored | *The simulated monitor is not connected.* |
| `restore-signal` | signal on; online at once when reconnecting | — |
| `pause` / `resume` | stops / restarts the periodic samples (`resume` sends one at once) | — |
| `set` | the values the monitor moves towards: `hr` 20–250, `spo2` 50–100, `sys` 40–300, `dia` 20–200, `rr` 4–60 (simulation limits, not clinical thresholds) | *&lt;Name&gt;: &lt;low&gt;–&lt;high&gt; in this simulator.* · *BP: the systolic value must be higher than the diastolic.* |
| `send-vitals` | a sample with the set values now, with a new blood pressure | *The simulated monitor is not connected: nothing can be sent.* |
| `trigger-ecg` | a 12-lead acquired now; `sample` `A` · `B` · `C` (default: A for ECG 1, B for ECG 2, C after); held while `waiting` / `reconnecting`, sent once connected | *The simulated monitor is not connected: a 12-lead acquired now cannot be transmitted. Connect it first, or the crew uses the manual ECG fallback.* |

For a case that is closed or no longer linked, only `trigger-ecg` and `send-vitals` are possible (to try "late" data,
which the platform must refuse); other commands: *This case is no longer linked to the simulated monitor.* Other
refusals: *There is no case with this CAD number.* · *CAD #&lt;cad&gt; has no corpuls link.* · *Unknown simulator
action.* · *The corpuls simulator works only with the simulated provider (Corpuls:Provider = mock).* The platform's
own verdicts on an event: *No case with CAD #&lt;cad&gt;: the monitor data was not added.* · *CAD #&lt;cad&gt; is
closed and read-only: the monitor data was not added.* (`closed: true`) · *Monitor &lt;id&gt; is not linked to CAD
#&lt;cad&gt;: its data was not added.* · *The ECG arrived without its image: nothing was added.* A resent event is
answered `dup: true` and stored once.

**Simulator state** (`GET /api/control/corpuls`, `sim` in the answers above, the `corpuls` event):

```json
{ "provider": "mock", "simulated": true, "demo": true, "demoEcgMs": 3000, "every": 5000,
  "defaults": { "hr": 88, "spo2": 98, "sys": 132, "dia": 78, "rr": 17 },
  "devices": [ { "id": "SIM-C3-214", "unit": "Ambulance 214", "cad": "20261020-0101-1",
                 "label": "corpuls3 SIM-C3-214 · Ambulance 214 (simulated)", "status": "connected", "statusAt": 0,
                 "available": true, "paused": false, "signal": true,
                 "target": { "hr": 88, "spo2": 98, "sys": 132, "dia": 78, "rr": 17 },
                 "cur": { "hr": 88, "spo2": 98, "rr": 17 }, "bp": { "sys": 132, "dia": 78, "at": 0 },
                 "seq": 1, "held": 0, "autoEcg": false } ],
  "cases": [ { "cad", "unit", "device", "label", "status", "last", "ended", "closed", "sent", "linked" } ] }
```

`defaults` is `null` and `devices` empty with a non-simulated provider; `status` of a device also has `idle` (not
linked); `held` counts the 12-leads waiting on the monitor; `cases` are the 30 most recently linked cases.
