# Open decisions in this build

Where a decision is still open, the build uses the round-3 prototype's working default (spec
`04-connected-crew-cardiologist.md`, v0.2, 3 October 2026) and the test console stands in for anything not built.
None of these defaults is confirmed. Reminder and escalation times are governance configurable and not set; the
build invents no numbers, rosters, response times or hospital capabilities.

## Questions requiring a decision

| # | Question | What this build does (working default) |
|---|---|---|
| Q-69 | Can one CAD incident have more than one STEMI patient? | One STEMI case per CAD number. Entering a CAD number that already has a case gives CASE ALREADY EXISTS with OPEN EXISTING CASE; a second case is never created. |
| Q-70 | How does the CAD number reach the tablet in V1? | The EMT enters it manually from the MDT / dispatch information (decided 4 Oct 2026 for this phase; CAD integration later). Checked for format and for an existing case, locked after Send. No temporary ID. Q-51 (CAD number format) also open; the build uses `YYYYMMDD-NNNN-1` from the example in the brief; the day's first incident is `YYYYMMDD-0123-1`, later ones random. |
| Q-71 | May a cardiologist acknowledge while offline? | No: ACKNOWLEDGE & OPEN needs a connection and the alarm continues. |
| Q-72 | What does a reminder do, to whom, how often? | Nothing automatic. *Reminder interval reached* in the test console repeats the alert to the same cardiologist and the crew sees it. `ALERT_REMINDER_SECONDS` is empty. |
| Q-73 | Several new cases at once for one cardiologist? | Not built: one active case at a time. |
| Q-74 | Crew changes after the decision? | They arrive silently as NEW, with no alarm and no automatic re-review; the cardiologist can record a new decision. |
| Q-75 | Should the crew tablet sound when the decision arrives? | No sound. The decision takes over the crew screen until acknowledged; the cardiologist sees when it was shown and acknowledged. |
| Q-11, Q-43 | Who reviews, and who is escalation level 1? | The single cardiologist test user is the on-duty cardiologist of the placeholder PCI Hospital A. *Escalation threshold reached* alerts a fictional "Backup cardiologist (Dr Y)" at level 1 and "ACC duty officer" at level 2, as text only. |
| Q-15, Q-54 | Escalation thresholds | Not set. `ALERT_ESCALATION_SECONDS` is empty; the console button fires an escalation. |
| Q-21 | The approved STEMI downtime route and number | Shown as the placeholder *approved downtime number (Q-21)*. |
| Q-22 | Who decides the destination | The deterministic destination policy engine is not built. The case always gets the placeholder recommendation *PCI Hospital A*; the crew can confirm or change it as in the prototype. |
| Q-26 | Does V1 show the AI or run it in shadow mode first? | The AI is shown, as the round-3 design (3 October 2026 AI visibility decision) specifies. It is a simulation. |
| Q-56, Q-57 | Crew pick lists; reasons for a destination change | The prototype's illustrative lists. |
| Q-59 | Patient details on the lock screen | Not applicable: the test build has no push notifications. |

## Design choices not yet confirmed

The round-3 spec lists 26 design choices made where neither the brief nor an earlier decision settled the detail
(for example the alarm starts when the alert is on screen, the alert covers the screen until ACKNOWLEDGE & OPEN,
silent updates are blue, two guards on every decision, one panel name *AI ECG interpretation*, and the impression
names the STEMI pattern, not coronary occlusion). The build keeps each one as the prototype shows it; each still
needs a yes or no.

## Not built in this round

Hospital, ED and cath-lab screens; cath-lab activation (D-04), destination transfer (D-07) and activation query
(D-08); the backup cardiologist's and ACC's screens; administration; several cases at once; lock-screen push;
handover and case closure.
