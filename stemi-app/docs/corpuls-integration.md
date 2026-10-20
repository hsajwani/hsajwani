# The corpuls integration · MASAR STEMI prototype 0.7.0

TEST BUILD · FICTIONAL DATA ONLY. **The corpuls integration in this build is simulated: Mock Corpuls Provider —
PROTOTYPE ONLY.** No real corpuls monitor and no corpuls.mission environment is connected. No vendor API was used or
assumed, and the build makes no network call to anything outside itself. National Ambulance and MEAD have **not**
approved a real integration. Nothing in this build says or implies that they have.

The integration code is C# in the ASP.NET Core backend:

| Part | File | Layer |
|---|---|---|
| The contract: the provider interface, the platform's event sink, the TEST ONLY simulator interface, the normalized events | `src/Masar.Application/Monitoring/CorpulsContract.cs` | Application |
| The platform's rules for the feed (link, checks, storage, audit, numbering, AI) | `src/Masar.Application/Monitoring/MonitorService.cs` | Application |
| The feed as the screens read it (case record `monitor`, the live `monitor` event) | `src/Masar.Application/Monitoring/MonitorRecord.cs`, `MonitorRecordReader.cs` | Application |
| Mock Corpuls Provider — PROTOTYPE ONLY (the simulated monitors) | `src/Masar.Infrastructure/Corpuls/MockCorpulsProvider.cs` | Infrastructure |
| The fictional 12-lead drawing | `src/Masar.Infrastructure/Corpuls/MockEcgRenderer.cs` | Infrastructure |
| The corpuls.mission placeholder (not implemented) | `src/Masar.Infrastructure/Corpuls/RealCorpulsMissionProvider.cs` | Infrastructure |
| Provider selection (`Corpuls:Provider`) | `src/Masar.Infrastructure/DependencyInjection.cs` | Infrastructure |
| The HTTP endpoints (link, demo acquisition, the test console's simulator) | `src/Masar.Api/Controllers/CorpulsController.cs`, `TestConsoleController.cs` | Api |

`server/integrations/corpuls/` and `server/monitor.js` are the LEGACY Node.js version of the same code, kept only while
the legacy server remains as a transition fallback.

## Target and what this build does

The target path for the monitor data:

```
CORPULS 3 → corpuls.mission → STEMI PLATFORM → ER DOCTOR → CARDIOLOGIST → STEMI DECISION
```

In this build:

```
corpuls3 (simulated, one per unit) ─┐
                                    │ MockCorpulsProvider (ICorpulsProvider, ICorpulsSimulator)
test console: CORPULS SIMULATOR ────┘   (stands in for corpuls.mission; fictional values and ECGs, no network)
                                    │
                                    ▼ normalized events: VitalsUpdated · EcgAcquired · ConnectionChanged
                                    │   (CorpulsContract.cs), handed to the platform's ICorpulsEventSink
                     MonitorService (the platform's consumer)
                     (checks, stores once, audits the significant moments, numbers the ECGs, runs the mock AI)
                                    │
                                    ▼ the case record (one per CAD number), pushed live (Server-Sent Events)
                     Crew MDT · ER Doctor · Cardiologist · test console
```

The screens never see the provider. They read only the case record, which carries the monitor's state, the latest
values and every ECG with its source. A real provider can replace the mock without changing any screen.

## The crew's flow with corpuls

```
OPEN STEMI PATHWAY → CAD number → LINK CORPULS → CONNECTING TO CORPULS… → CORPULS CONNECTED → live vital signs
  → ECG 1 RECEIVED FROM CORPULS → age, sex, presenting complaint, symptom onset → SEND TO ER
```

In the prototype's **demo mode** (`Corpuls:DemoMode`, on by default; `CORPULS_DEMO_MODE` in the development `.env`)
this runs by itself, as the future integration would: the simulated monitor connects about a second after LINK CORPULS, the live values appear at once and ECG 1
arrives about 3 s later. No test console, hardware or upload is needed (see *Demo mode* below).

1. The crew types the CAD number from the dispatch / MDT information. Entry and normalisation are unchanged: stored
   as `20261004-0123-1` and shown as `CAD #20261004-0123-1`.
2. **LINK CORPULS** checks the number and creates the case on the platform. It is still unsent and not visible to the
   ER. The case is then linked to the unit's monitor. The bar shows the feed starting step by step: **CONNECTING TO
   CORPULS…**, then **CORPULS CONNECTED · CAD #…** with a subtle *Simulated corpuls feed* tag (✓ CAD linked · ✓ Corpuls
   connected · ✓ Live vitals received · ✓ ECG 1 received). From then on every update attaches to that case; an update
   never creates a new case.
3. The vital signs appear by themselves as **LIVE FROM CORPULS · Updated N s ago**. While the 12-lead comes, the ECG
   card says **RECEIVING 12-LEAD ECG FROM CORPULS…**; then it appears by itself: **ECG 1 RECEIVED FROM CORPULS ·
   Acquired hh:mm:ss**.
4. The crew enters only what corpuls cannot know: age, sex, presenting complaint and symptom onset.
5. **SEND TO ER** becomes available when the CAD number is valid, an ECG exists and the four items are answered. The
   crew does not confirm the vital signs: the latest monitor values travel with the case automatically and are
   recorded with their time.
6. After SEND the crew follows the status. Repeat ECGs (ECG 2, 3 …) acquired on corpuls3 attach to the same CAD number
   and reach the ER and the Cardiologist silently. The crew acknowledges only the outcomes: the ER's outcome and each
   cardiologist decision. Monitor updates are never acknowledged.

The **manual ECG fallback** (photograph or upload the 12-lead) and manual vital signs remain available as a quiet link
while the feed works or is still connecting. They become prominent only when corpuls cannot deliver: connection lost,
a monitor that does not connect at all (CORPULS NOT CONNECTED, after 15 s), the feed ended on an open case, or no
connection to the platform. An ECG added this way is recorded as `manual_fallback` and audited as *Manual ECG fallback
used*.

## The provider contract (`src/Masar.Application/Monitoring/CorpulsContract.cs`)

A provider links a case (CAD number) to the monitor feed of the crew's unit. From then on it reports that feed as
normalized events, each carrying the CAD number. The platform uses **only** this interface, so a production provider
for corpuls.mission can replace the simulated one without changing a screen or a platform rule.

`ICorpulsProvider`:

| Member | What it does |
|---|---|
| `Name`, `Simulated`, `DemoMode` | What it is: `mock` (simulated) or `corpuls-mission` (not implemented). `DemoMode` is always false for a real provider. |
| `ExpectedIntervalMs` | How often vital signs normally arrive. It drives only the technical freshness indicator and is not a clinical threshold. |
| `Attach(ICorpulsEventSink sink)` | The platform registers itself (`MonitorService`) to receive the events. |
| `ConnectCase(CorpulsLinkRequest)` | Starts the feed for this case. The request carries the CAD number, the unit, an optional device id, and `AutoEcg`, the demo-only hint that the case has no ECG yet (a real provider ignores it). It returns `CorpulsLink(DeviceId, Label, Status, PreviousCad)`: the initial status is returned, not emitted, because the platform stores the link first. |
| `RelinkCase(oldCad, newCad)` | The CAD number of an unsent case was corrected: the feed follows the case. |
| `DisconnectCase(cad, reason)` | Stops the feed (pathway closed, unsent case discarded, monitor linked to another case). |
| `GetConnectionStatus(cad)`, `GetLatestVitals(cad)` | What the provider currently holds. |
| `Resume(links)` | After a platform restart: carry on with the feeds that were linked, silently. |

`ICorpulsEventSink` is the platform's side, implemented by `MonitorService`. It has `OnConnectionChanged`,
`OnVitalsUpdated` and `OnEcgAcquired`. Each returns the platform's verdict, a `CorpulsVerdict` (`Ok`, or `Error`, plus
`Dup`, `N` (the ECG number), `Closed`, `Held` and `Note`). A provider may log the verdict, never act on it. The sink
takes the platform's lock itself (`PlatformGate`), so a provider may call it from any thread.

`ICorpulsSimulator` — TEST ONLY, implemented only by the Mock Corpuls Provider. It is what the test console's CORPULS
SIMULATOR and the crew's simulated acquisition in demo mode can make the simulated monitor do: `Simulate`,
`ResetDemo`, `State`, `Reset`, the `Changed` event, `DemoEcgDelay` and `Defaults`. **It must never exist in a
production provider.**

### Normalized events

All times are epoch milliseconds. `EventId` is stable: an event sent again, for example after a reconnection, carries
the same id and the platform stores it once. Each record has a `Create` builder that every provider uses. Whatever the
provider received, what it emits has these ranges:
- out-of-range numbers become null;
- strings are cut to length (event id 120, CAD 40, device 80, reason 120 characters);
- an unknown status becomes `disconnected`.

| Event (prototype name) | Record and fields |
|---|---|
| `VITALS_UPDATED` | `VitalsUpdated`: `EventId, Cad, Timestamp, DeviceId, HeartRate (0–350), Spo2 (0–100), BpSystolic (0–350), BpDiastolic (0–300), BpMeasuredAt, RespiratoryRate (0–120), Explicit`; `Source` = `corpuls`. Non-invasive BP is measured intermittently, so it keeps its own time (`BpMeasuredAt`). A value that is not available is null. `Explicit` marks an update the tester sent at once (always kept in the history). |
| `ECG_ACQUIRED` | `EcgAcquired`: `EventId, Cad, Timestamp, EcgSequence (1–999), AcquiredAt, DeviceId, HeartRate (20–300), Image (Mime, Data), Meta (Sample, Label, Variant, Simulated)`. `EcgSequence` is the monitor's own count; the platform numbers the case's ECGs itself (ECG 1, 2, 3 … across every source). `Meta` holds provider details that are stored but never shown as clinical data. |
| `CORPULS_CONNECTION_CHANGED` | `ConnectionChanged`: `EventId, Cad, Timestamp, Status, DeviceId, Reason`. Status is one of `waiting`, `connected`, `reconnecting` or `disconnected` (`CorpulsStatuses`). |

ECG sources in a case: `corpuls`, `manual_fallback` and `test` (reserved). Older cases have photographed ECGs with no
source.

## The platform's rules (`MonitorService`)

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
| Connecting | CONNECTING TO CORPULS… (a transitional state, with the steps) | (the case is not sent yet) |
| Connected, first values on their way | CORPULS CONNECTED · RECEIVING LIVE MONITOR DATA… | — |
| Live | CORPULS CONNECTED · CAD #… and LIVE FROM CORPULS · Updated N s ago | the values in the patient strip with *corpuls · N s ago*; the details card has LIVE FROM CORPULS |
| Not connecting at all (15 s) | CORPULS NOT CONNECTED · MANUAL FALLBACK AVAILABLE | NO LIVE MONITOR DATA |
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

## The simulated feed (Mock Corpuls Provider — PROTOTYPE ONLY)

- **One simulated corpuls3 per unit:** Ambulance 214 → `SIM-C3-214`. Demo cases from the test console get their own
  `SIM-C3-DEMO-…` so they never take the crew's monitor.
- **Linking:** WAITING (shown as CONNECTING TO CORPULS…), then CONNECTED `Corpuls:SimConnectMs` (0.8 s) later if the
  simulated monitor is available.
- **Vital signs** come every `Corpuls:SimTickMs` (default 5 s). They change gradually and never randomly.
  - HR moves 2 /min per update towards its set value; in demo mode it also shows a monitor's small beat-to-beat
    variation (±1 /min, a fixed pattern).
  - SpO₂ moves 1 % per update.
  - RR moves 1 /min every 30 s.
  - NIBP is measured every `Corpuls:SimNibpSeconds` (default 120 s), and at once when the tester sends an update.
  - The default values are HR 88, SpO₂ 98, BP 132/78 and RR 17.
- **A 12-lead** comes when the crew "acquires" one: in demo mode ECG 1 by itself and a requested repeat from the crew
  screen; otherwise when the test console triggers it. It is a synthetic SVG on ECG paper:
  - Three internal samples are used: ECG Sample A (borderline, then evolving), B (evolved) and C (clear pattern); the
    demo uses A for ECG 1, B for ECG 2 and C after. The drawing is `MockEcgRenderer`: deterministic, never random,
    and byte-identical to the prototype's drawing.
  - Each sample sets the ST/T morphology.
  - The drawn rate is the HR the simulated monitor shows at that moment, so the 12-lead and the live HR agree.
  - Every image is marked *FICTIONAL TEST DATA · NOT A PATIENT* and *synthetic waveform, not a diagnosis*.
  - The samples are not validated diagnoses.
  - The mock AI returns its scripted findings for the sample, with the monitor's rate.
- **Acquisition while not connected:**
  - acquired while WAITING or RECONNECTING: held on the monitor and sent once connected;
  - acquired while DISCONNECTED: nothing is transmitted.
- **On reconnection** the feed resends its last ECG and last sample, as a real feed might. The platform stores each
  once.
- **Restarts:** the simulator's settings (available, paused, set values) survive a server restart. They are kept in
  the `settings` table under `corpuls_sim`. Linked feeds carry on without a false *connection lost*; in demo mode, a
  linked case still without an ECG gets its ECG 1.
- **Timers:** the simulated monitors' timers (connect, tick, automatic ECG 1, reconnection) run under the platform's
  lock (`PlatformGate`), like every change to a case. A timer cleared while it waited does nothing.

### Demo mode (`Corpuls:DemoMode`, the prototype default)

The basic demonstration needs nothing but the crew, ER and cardiologist screens:

- **Every LINK CORPULS starts a fresh simulated monitor** (available, signal on, data flowing, the default values),
  whatever an earlier demonstration left behind.
- **ECG 1 by itself:** `Corpuls:DemoEcgSeconds` (3) seconds after CORPULS CONNECTED the simulated crew acquires the
  first 12-lead — unless a 12-lead was already acquired on this link, or the tablet already holds a manual fallback
  ECG for the case (the case creation says so).
- **Repeat ECG:** when the Cardiologist requests one, the crew's REPEAT ECG REQUESTED panel offers **SIMULATE REPEAT ECG
  ACQUISITION** (*prototype only*: it stands in for the 12-lead acquired on corpuls3, because no physical monitor is
  connected). The platform asks the simulated provider for the acquisition; ECG 2 then arrives through the feed like
  any corpuls ECG, on the same CAD number, never as an upload. The audit records *Prototype demo: repeat 12-lead
  acquisition on the simulated corpuls3 started from the crew screen*, then *ECG 2 received from corpuls*.
  `POST /api/corpuls/demo-acquire` — crew only, demo mode only, open and linked cases only.
- **RESET CORPULS DEMO** (test console, `POST /api/control/corpuls/reset-demo`): every simulated monitor back to the
  clean state; a linked monitor reconnects and sends the default values at once; a linked case still without an ECG
  gets its ECG 1 again. Cases, ECGs and the record are not touched.
- **Closed or discarded cases** get nothing automatic: the feed ends with the case, pending timers stop, and late
  events are refused like any other.
- `Corpuls:DemoMode=false` (`CORPULS_DEMO_MODE=false` in `.env`): the simulated monitor does only what the test console
  tells it (the automated corpuls test suite runs this way).

### The test console's CORPULS SIMULATOR (TEST ONLY)

These controls exist only at `/control`, never on the crew, ER or cardiologist screens.

- The demo mode (on or off) and **RESET CORPULS DEMO**.
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

## RealCorpulsMissionProvider (`src/Masar.Infrastructure/Corpuls/RealCorpulsMissionProvider.cs`)

This is a placeholder: **not implemented**. With `Corpuls:Provider=corpuls-mission` the build:
- makes no network call and receives nothing;
- keeps every linked case connecting, then CORPULS NOT CONNECTED (with the fallback prominent);
- leaves the manual ECG fallback as the only way to add an ECG.

The real provider must emit exactly the normalized events above, so that no screen and no platform rule changes.

## Selecting the provider

`Corpuls:Provider` chooses the implementation of `ICorpulsProvider` at start (`src/Masar.Infrastructure/DependencyInjection.cs`):
- `mock` selects the Mock Corpuls Provider — PROTOTYPE ONLY;
- `corpuls-mission` selects the placeholder;
- any other value stops the server.

The simulation settings are `Corpuls:SimTickMs`, `SimNibpSeconds`, `SimConnectMs`, `DemoMode` and `DemoEcgSeconds`
([configuration.md](configuration.md#corpuls--mock-corpuls-provider--prototype-only)).

## Writing the real provider (once the information below exists)

1. Implement `ICorpulsProvider` in `src/Masar.Infrastructure/Corpuls/`.
   - Create every event with the record's `Create` builder.
   - Hand events to the attached `ICorpulsEventSink`; it is safe to call from any thread.
   - Keep the provider's connection state per CAD number.
   - **Do not implement `ICorpulsSimulator`.**
2. Put the endpoint and settings in an options class bound from configuration. Credentials go in a secret store or in
   environment variables, never in `appsettings.json` or git ([security.md](security.md#secrets)).
3. Register it for `Corpuls:Provider=corpuls-mission` in `DependencyInjection.cs`, in place of the placeholder.
4. Add tests:
   - unit tests of the payload mapping, from the vendor's documented examples;
   - the existing end-to-end `test:corpuls` checks, against a vendor sandbox or a recorded fixture.

   The platform rules in `MonitorService` (checks, duplicates, closed cases, audit) stay as they are and are covered
   already.
5. Information Security review, a data-sharing agreement, and clinical-safety approval come **before** any real monitor
   data flows.

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
