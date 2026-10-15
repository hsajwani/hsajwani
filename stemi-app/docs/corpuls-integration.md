# The corpuls integration · test build 0.6.0

TEST BUILD · FICTIONAL DATA ONLY. **The corpuls integration in this build is simulated.** No real corpuls monitor
and no corpuls.mission environment is connected. No vendor API was used or assumed, and the build makes no network
call to anything outside itself. National Ambulance and MEAD have **not** approved a real integration. Nothing in this
build says or implies that they have.

## Target and what this build does

The target path for the monitor data:

```
CORPULS 3 → corpuls.mission → STEMI PLATFORM → ER DOCTOR → CARDIOLOGIST → STEMI DECISION
```

In this build:

```
corpuls3 (simulated, one per unit) ─┐
                                    │ MockCorpulsProvider          server/integrations/corpuls/mock-provider.js
test console: CORPULS SIMULATOR ────┘   (stands in for corpuls.mission; fictional values and ECGs, no network)
                                    │
                                    ▼ normalized events: VITALS_UPDATED · ECG_ACQUIRED · CORPULS_CONNECTION_CHANGED
                                    │                                  server/integrations/corpuls/contract.js
                     the platform's consumer                           server/monitor.js
                     (checks, stores once, audits the significant moments, numbers the ECGs, runs the mock AI)
                                    │
                                    ▼ the case record (one per CAD number), pushed live (SSE)
                     Crew MDT · ER Doctor · Cardiologist · test console
```

The screens never see the provider. They read only the case record, which carries the monitor's state, the latest
values and every ECG with its source. A real provider can replace the mock without changing any screen.

## The crew's flow with corpuls

```
OPEN STEMI PATHWAY → CAD number → LINK CORPULS → CORPULS CONNECTED → ECG 1 appears → vital signs appear
  → age, sex, presenting complaint, symptom onset → SEND TO ER
```

1. The crew types the CAD number from the dispatch / MDT information. Entry and normalisation are unchanged: stored
   as `20261004-0123-1` and shown as `CAD #20261004-0123-1`.
2. **LINK CORPULS** checks the number and creates the case on the platform. It is still unsent and not visible to the
   ER. The case is then linked to the unit's monitor. The bar says WAITING FOR CORPULS, then **CORPULS CONNECTED · CAD
   #…**. From then on every update attaches to that case; an update never creates a new case.
3. The 12-lead acquired on corpuls3 appears by itself: **ECG 1 RECEIVED FROM CORPULS · Acquired hh:mm:ss**. The
   vital signs appear by themselves as **LIVE FROM CORPULS · Updated N s ago**.
4. The crew enters only what corpuls cannot know: age, sex, presenting complaint and symptom onset.
5. **SEND TO ER** becomes available when the CAD number is valid, an ECG exists and the four items are answered. The
   crew does not confirm the vital signs: the latest monitor values travel with the case automatically and are
   recorded with their time.
6. After SEND the crew follows the status. Repeat ECGs (ECG 2, 3 …) acquired on corpuls3 attach to the same CAD number
   and reach the ER and the Cardiologist silently. The crew acknowledges only the outcomes: the ER's outcome and each
   cardiologist decision. Monitor updates are never acknowledged.

The **manual ECG fallback** (photograph or upload the 12-lead) and manual vital signs remain available. They are
secondary and become prominent only when corpuls is not available: waiting, connection lost, feed ended, offline, or
no ECG yet when everything else is complete. An ECG added this way is recorded as `manual_fallback` and audited as
*Manual ECG fallback used*.

## The provider contract (`server/integrations/corpuls/contract.js`)

A provider links a case (CAD number) to the monitor feed of the crew's unit. From then on it reports that feed as
normalized events, each carrying the CAD number.

| Member | What it does |
|---|---|
| `name`, `simulated` | what it is (`mock`, simulated; `corpuls-mission`, not implemented) |
| `expectedIntervalMs` | how often vital signs normally arrive. It drives only the technical freshness indicator and is not a clinical threshold. |
| `connectCase({ cad, unit, device_id? })` | starts the feed for this case → `{ device_id, label, status }` |
| `relinkCase(oldCad, newCad)` | the CAD number of an unsent case was corrected: the feed follows the case |
| `disconnectCase(cad, reason)` | stops the feed (pathway closed, unsent case discarded, monitor linked to another case) |
| `getConnectionStatus(cad)`, `getLatestVitals(cad)`, `getECGs(cad)` | what the provider currently holds |
| `resume(links)` | after a platform restart: carry on with the feeds that were linked, silently |
| `onVitalsUpdate(fn)`, `onECGAcquired(fn)`, `onConnectionStatusChanged(fn)` | the platform's handlers. Each returns the platform's verdict (`{ ok }` or `{ ok: false, error }`); a provider may log it, never act on it. |

### Normalized events

All times are epoch milliseconds. `event_id` is stable: an event sent again, for example after a reconnection,
carries the same id and the platform stores it once.

| Event | Fields |
|---|---|
| `VITALS_UPDATED` | `event_id, cad, timestamp, source, device_id, heart_rate, spo2, bp_systolic, bp_diastolic, bp_measured_at, respiratory_rate`. Non-invasive BP is measured intermittently, so it keeps its own time (`bp_measured_at`). A value that is not available is `null`. |
| `ECG_ACQUIRED` | `event_id, cad, timestamp, ecg_sequence, acquired_at, source, device_id, heart_rate, image { mime, data }, meta`. `ecg_sequence` is the monitor's own count; the platform numbers the case's ECGs itself (ECG 1, 2, 3 … across every source). `meta` holds provider details that are stored but never shown as clinical data. |
| `CORPULS_CONNECTION_CHANGED` | `event_id, cad, timestamp, status, device_id, reason`. Status is one of `waiting`, `connected`, `reconnecting` or `disconnected`. |

ECG sources in a case: `corpuls`, `manual_fallback` and `test` (reserved). Older cases have photographed ECGs with no
source.

## The platform's rules (`server/monitor.js`)

- **Every event is checked first.** The CAD number must exist, the case must be open, and the event's monitor must be
  the one linked to that case, with the link not ended. Otherwise the event is refused and changes nothing. Data
  arriving late for a closed case is refused, so a closed case stays read-only.
- **One monitor serves one patient.** Linking a monitor to a new case ends its feed to the previous case, which keeps
  everything it received. A corrected CAD number moves the case, its feed and its data together. Discarding an
  unsent case ends its feed.
- **Closing the STEMI pathway ends the feed.** That covers COMPLETE, NOT STEMI and the ER's NOT SUSPICIOUS. The last
  values stay with the case. A lost connection never closes the pathway, cancels a case or triggers a decision.
- **Vital signs:** a sample that is not newer than the last one is ignored (resends, reordering). The latest values
  live on the case together with their time.
- **ECGs:** each one is stored once (by `event_id`) and never overwritten. It is numbered by the platform and given
  its own acquisition time, source, device, image, AI analysis and review history. It reaches the ER and the
  Cardiologist silently: announced, never swapped in.
- **Connection:** one *Corpuls connection lost* per outage, whatever the feed does while the outage lasts, and one
  *Corpuls connection restored* on return. No duplicates.
- **Freshness is technical only.** A connected feed with no new values for more than 3 × `expectedIntervalMs` is shown
  as *LAST DATA RECEIVED hh:mm:ss · N min ago*. Old values are never shown as current. No clinical threshold is
  implied or invented.

### What the screens show

| Situation | Crew | ER Doctor and Cardiologist |
|---|---|---|
| Live | CORPULS CONNECTED · CAD #… and LIVE FROM CORPULS · Updated N s ago | the values in the patient strip with *corpuls · N s ago*; the details card has LIVE FROM CORPULS |
| No new values | LAST DATA RECEIVED hh:mm:ss | the same |
| Connection lost | CORPULS CONNECTION LOST · Last data received hh:mm:ss · MANUAL FALLBACK AVAILABLE | LIVE MONITOR DATA TEMPORARILY UNAVAILABLE · Last data received hh:mm:ss (the last values stay, with their time) |
| Restored | CORPULS CONNECTED again (*Corpuls connection restored* in the timeline) | live again |
| Pathway closed | CORPULS FEED ENDED; the last values are kept | MONITOR FEED ENDED |

The ECG stays the main element on every screen. The vital signs are a compact strip or panel beside it.

### What is stored

- On `cases`: `corpuls_provider`, `corpuls_device_id`, `corpuls_device_label`, `corpuls_linked_at`,
  `corpuls_linked_by`, `corpuls_status`, `corpuls_status_at`, `corpuls_connected_once`, `corpuls_last_data_at`,
  `corpuls_link_ended_at`, `corpuls_link_end_reason`, `vitals_json` (the latest values), `vitals_at`,
  `vitals_source`, `vitals_hist_at` and `draft_discarded_at`.
- On `ecgs`: `source`, `device_id`, `source_event_id`, `source_seq`, `transmitted_at` and `device_hr`.
- `monitor_vitals` is a light history, not a waveform store. It keeps each blood pressure measurement, each explicit
  update, at most about one routine sample a minute, and the values sent with the case (`at_send`).
- `monitor_events` holds the feed's significant moments for the timeline.
- No raw waveforms. The ECG is stored as the image the feed delivered (here, an SVG drawn by the platform). `/files`
  serves it with `Content-Security-Policy: default-src 'none'` and `nosniff`.

### Audit

Audited:
- *Corpuls feed linked to CAD #…*
- *Corpuls monitor connected*
- *ECG n received from corpuls · acquired hh:mm:ss*
- *Corpuls connection lost* and *restored*
- *Corpuls feed unlinked (reason)*
- *Latest monitor values sent with the case: HR … · SpO₂ … · BP … · RR …* at SEND
- *Manual ECG fallback used*
- a monitor link moved to another case

Never audited: routine samples, heartbeats, or individual HR changes.

## The simulated feed (MockCorpulsProvider)

- **One simulated corpuls3 per unit:** Ambulance 214 → `SIM-C3-214`. Demo cases from the test console get their own
  `SIM-C3-DEMO-…` so they never take the crew's monitor.
- **Linking:** WAITING, then CONNECTED about 0.8 s later if the simulated monitor is available.
- **Vital signs** come every `CORPULS_SIM_TICK_MS` (default 5 s). They change gradually and never randomly.
  - HR moves 2 /min per update towards its set value.
  - SpO₂ moves 1 % per update.
  - RR moves 1 /min every 30 s.
  - NIBP is measured every `CORPULS_SIM_NIBP_SECONDS` (default 120 s), and at once when the tester sends an update.
  - The default values are HR 84, SpO₂ 97, BP 142/88 and RR 18.
- **A 12-lead** comes only when the test console triggers it. It is a synthetic SVG on ECG paper:
  - Three internal samples are used: ECG Sample A (borderline, then evolving), B (evolved) and C (clear pattern).
  - Each sample sets the ST/T morphology.
  - The drawn rate is the simulated monitor's HR at that moment, and the HR then drifts towards the sample's own rate.
  - Every image is marked *FICTIONAL TEST DATA · NOT A PATIENT* and *synthetic waveform, not a diagnosis*.
  - The samples are not validated diagnoses.
  - The mock AI returns its scripted findings for the sample, with the monitor's rate.
- **Acquisition while not connected:**
  - acquired while WAITING or RECONNECTING: held on the monitor and sent once connected;
  - acquired while DISCONNECTED: nothing is transmitted.
- **On reconnection** the feed resends its last ECG and last sample, as a real feed might. The platform stores each
  once.
- **Restarts:** the simulator's settings (available, paused, set values) survive a server restart, and linked feeds
  carry on without a false *connection lost*.

### The test console's CORPULS SIMULATOR (TEST ONLY)

These controls exist only at `/control`, never on the crew, ER or cardiologist screens.

- Choose a case. Its linked simulated monitor and status are shown.
- **Connection:** CONNECT MONITOR, DISCONNECT MONITOR, RECONNECT, SIMULATE SIGNAL LOSS, RESTORE SIGNAL, PAUSE DATA /
  RESUME DATA.
- **Vital signs:** SET HR, SET SpO₂, SET BP systolic, SET BP diastolic, SET RR. Each sets the value the monitor moves
  towards; HR and SpO₂ move gradually. SEND VITALS UPDATE sends the set values at once, with a new BP measurement.
  The simulator's limits (HR 20–250, SpO₂ 50–100, systolic 40–300, diastolic 20–200 and below systolic, RR 4–60) say
  what this simulator accepts. They are not clinical thresholds.
- **12-lead ECG:** choose Sample A, B or C, then TRIGGER ECG 1, 2 or 3 (the next number of the case).
- For a closed case, *trigger ECG* and *send vitals* try late data from its former monitor. The platform must refuse
  them, and does.

## RealCorpulsMissionProvider (`server/integrations/corpuls/real-provider.js`)

This is a placeholder: **not implemented**. With `CORPULS_PROVIDER=corpuls-mission` the build:
- makes no network call and receives nothing;
- keeps every linked case WAITING FOR CORPULS;
- leaves the manual ECG fallback as the only way to add an ECG.

The real provider must emit exactly the normalized events above, so that no screen and no platform rule changes.

## What MEAD / corpuls must provide before a real provider can be written

None of this is known or assumed in this build.

1. **Authentication method:** how the platform authenticates to corpuls.mission (for example OAuth 2.0 client
   credentials or mutual TLS), token lifetime and rotation, and who issues and stores the credentials.
2. **Endpoint / API documentation:** the base URLs per environment, the resources and operations, versioning, rate
   limits and error codes.
3. **ECG payload format:**
   - the format: PDF, PNG, vendor format, SCP-ECG, DICOM, HL7 aECG …;
   - lead layout, sampling rate, filters and calibration;
   - the measurements and statements the device includes (heart rate, intervals);
   - how the acquisition time is given;
   - whether the ECG arrives as an image, a waveform, or both.
4. **Vital-signs payload format and units:**
   - which parameters, units and resolution;
   - how NIBP measurement times are given;
   - artefact or invalid flags;
   - trends versus single readings.
5. **Event / webhook mechanism:**
   - push (webhook, stream) or poll, and the interval;
   - ordering guarantees, delivery guarantees (at-least-once?), resend behaviour;
   - idempotency keys;
   - what happens to events produced while the platform is unreachable.
6. **CAD / mission mapping:**
   - how a CAD number, or the incident, maps to a corpuls.mission mission and a monitor;
   - who creates the mission and when;
   - what happens to ECGs acquired before the case is linked;
   - corrections of a wrong CAD number;
   - one patient or several per mission.
7. **Device / unit identifiers:** monitor serial numbers, how a monitor is paired with an ambulance, and how changes of
   pairing are reported.
8. **Sandbox / test access:** a non-production environment, test credentials, test devices or a device simulator, and
   synthetic test ECGs.
9. **Data retention:** how long corpuls.mission keeps data, deletion, and what the platform may store and for how long.
10. **Connection, retry and heartbeat requirements:** keep-alive, reconnection and back-off, and how loss of a monitor's
    connection is reported (the platform's freshness indicator needs the expected update interval).
11. **Clock synchronisation:** the time source of the monitor and of corpuls.mission, time zones, and acceptable drift.
12. **Security and data-protection approvals:**
    - National Ambulance InfoSec review;
    - the data-sharing agreement with MEAD;
    - hosting and data residency;
    - the clinical-safety and privacy approvals required before real patient data flows.

## Open questions for the platform (decisions, not vendor information)

- Should the link be automatic when the CAD number is confirmed (as built: LINK CORPULS does both), or should the crew
  pick the monitor?
- How should ECGs acquired before the CAD number was entered be handled? (Not built: only ECGs acquired after linking
  attach.)
- Who decides the expected update interval and the wording for missing data? The build shows only the time of the
  last data; it has no clinical threshold.
- Does the manual fallback need a reason (for example, monitor unavailable)? (Not built.)
