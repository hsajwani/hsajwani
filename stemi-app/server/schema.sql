-- Unified STEMI Platform · first functional multi-device test build
-- TEST DATA ONLY. Every row is fictional. No real patient information may be stored here.
-- All times are epoch milliseconds. Every case object carries the CAD number (cad), the primary case identifier.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('crew','cardiologist')),  -- 0.5.0: only crew logs in; ER and cardiologist type their name
  name          TEXT NOT NULL,          -- e.g. K. Ahmed / Dr X (fictional)
  title         TEXT NOT NULL,          -- Paramedic / Cardiologist
  org           TEXT,                   -- PCI Hospital A (placeholder)
  unit          TEXT,                   -- Ambulance 214 (crew only)
  emirate       TEXT
);

-- one row per CAD case; the CAD number is the operational case identifier (Q-44).
-- The crew (EMT) enters the CAD number manually; it is stored normalised (YYYYMMDD-NNNN-N, see public/shared/cad.js).
CREATE TABLE IF NOT EXISTS cases (
  cad                 TEXT PRIMARY KEY,
  cad_source          TEXT,             -- manual-crew | manual-test-console (demo) | NULL: simulated CAD feed (v0.1 cases)
  cad_entered_at      INTEGER,          -- when the crew confirmed the CAD number on the tablet
  cad_entered_by      TEXT,
  created_cid         TEXT,             -- the tablet's id for this case, so a resent "create" is not taken for a duplicate
  -- the STEMI pathway's own closure (never the operational CAD incident, which belongs to ICCC / ePCR)
  status              TEXT,             -- NULL while the pathway is active; 'closed' once closed (read-only from then on)
  handover_opened_at  INTEGER,          -- the case summary page was first opened (column name kept from 0.3.0)
  closed_at           INTEGER,
  closed_by           TEXT,             -- the crew user, or the cardiologist whose NOT STEMI decision closed it
  closed_user_id      TEXT,
  closure_reason      TEXT,             -- 'STEMI pathway completed' | 'Cardiologist decision: NOT STEMI' | 'ER Doctor assessment: NOT SUSPICIOUS FOR STEMI'
  closure_source      TEXT,             -- 'crew' | 'automatic following Cardiologist decision' | 'ER Doctor screening decision'
  -- 0.5.0 (added on start by server/db.js; empty in older cases, which went straight to the cardiologist):
  -- er_alerted_at, er_alert_shown_at, er_doctor_name, er_accepted_at, er_assessment (activate | uncertain | not_suspicious),
  -- er_assessment_at, er_assessed_by, er_assessment_ecg, er_non_activation_reason, er_non_activation_comment, er_outcome_seen_at,
  -- cardiology_activated_at, cardiology_activation_reason, cardiology_activated_by,
  -- cardiologist_name, cardiologist_acknowledged_at, cardiologist_decision, cardiologist_decision_at
  -- 0.6.0, the corpuls feed (added on start by server/db.js): corpuls_provider, corpuls_device_id, corpuls_device_label,
  -- corpuls_linked_at, corpuls_linked_by, corpuls_status (waiting | connected | reconnecting | disconnected),
  -- corpuls_status_at, corpuls_connected_once, corpuls_last_data_at, corpuls_link_ended_at, corpuls_link_end_reason,
  -- vitals_json (the latest monitor values: hr, spo2, rr, sys, dia, bpAt, at), vitals_at, vitals_source, vitals_hist_at,
  -- draft_discarded_at (an unsent case discarded on the tablet; it stays a draft, nothing reached the ER)
  active              INTEGER NOT NULL DEFAULT 1,
  unit                TEXT NOT NULL,
  emirate             TEXT NOT NULL,
  crew_name           TEXT NOT NULL,
  incident_type       TEXT NOT NULL,
  dispatched_at       INTEGER,
  at_patient_at       INTEGER,
  created_at          INTEGER NOT NULL,
  pathway_opened_at   INTEGER,
  pathway_opened_by   TEXT,
  submitted_at        INTEGER,          -- crew pressed SEND (tablet time)
  server_received_at  INTEGER,          -- the server stored the case and ECG 1
  delivered_late      INTEGER NOT NULL DEFAULT 0,
  downtime_at         INTEGER,
  acknowledged_at     INTEGER,
  opened_at           INTEGER,
  compared_at         INTEGER
);

-- patient details and vital signs of the minimum dataset. A new value never replaces an old one: every entry is a row.
CREATE TABLE IF NOT EXISTS patient_details (
  id TEXT PRIMARY KEY, cad TEXT NOT NULL REFERENCES cases(cad), field TEXT NOT NULL,
  value_text TEXT, raw_json TEXT, taken_at INTEGER, received_at INTEGER NOT NULL,
  entered_by TEXT, entry_kind TEXT NOT NULL, reason TEXT, op_id TEXT
);
CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY, cad TEXT NOT NULL REFERENCES cases(cad), field TEXT NOT NULL,
  value_text TEXT, raw_json TEXT, taken_at INTEGER, received_at INTEGER NOT NULL,
  entered_by TEXT, entry_kind TEXT NOT NULL, reason TEXT, op_id TEXT
);

-- medications, treatments, risks, history, condition, comments and other observations from "Complete the record"
CREATE TABLE IF NOT EXISTS treatments (
  id TEXT PRIMARY KEY, cad TEXT NOT NULL REFERENCES cases(cad), item_key TEXT NOT NULL,
  label TEXT NOT NULL, category TEXT, value_text TEXT, not_obtained INTEGER NOT NULL DEFAULT 0,
  taken_at INTEGER, received_at INTEGER NOT NULL, entered_by TEXT, entry_kind TEXT NOT NULL, op_id TEXT
);

-- ECG 1, ECG 2, ECG 3 …: one row per acquisition, numbered by the platform across every source.
-- 0.6.0 adds: source (corpuls | manual_fallback | test; empty for the crew photos of 0.5.0 and earlier), device_id,
-- source_event_id (the provider's event id: an ECG sent again is stored once), source_seq (the monitor's own count),
-- transmitted_at (when the provider sent it), device_hr (the heart rate the monitor reported with the 12-lead)
CREATE TABLE IF NOT EXISTS ecgs (
  cad TEXT NOT NULL REFERENCES cases(cad), n INTEGER NOT NULL,
  acquired_at INTEGER, sent_at INTEGER, received_at INTEGER,
  primary_image INTEGER NOT NULL DEFAULT 1, variant TEXT, same_as_previous INTEGER NOT NULL DEFAULT 0,
  sent_by TEXT, time_reason TEXT, op_id TEXT,
  PRIMARY KEY (cad, n)
);

-- several images of the same printout belong to one ECG (Image 1 Primary, Image 2, Image 3)
CREATE TABLE IF NOT EXISTS ecg_images (
  id TEXT PRIMARY KEY, cad TEXT NOT NULL REFERENCES cases(cad), ecg_n INTEGER, i INTEGER,
  captured_at INTEGER, uploaded_at INTEGER NOT NULL, received_at INTEGER,
  kind TEXT, quality TEXT, source TEXT NOT NULL,      -- source: test-generator | file | corpuls (simulated feed)
  file_name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
  added_after_send INTEGER NOT NULL DEFAULT 0, uploaded_by TEXT, op_id TEXT
);

-- one analysis per ECG, made once and shown unchanged on every screen
CREATE TABLE IF NOT EXISTS ai_interpretations (
  cad TEXT NOT NULL REFERENCES cases(cad), ecg_n INTEGER NOT NULL,
  status TEXT NOT NULL,                 -- proc | ok | lim | wh | down
  started_at INTEGER, completed_at INTEGER, provider TEXT, version TEXT, result_json TEXT,
  PRIMARY KEY (cad, ecg_n)
);

CREATE TABLE IF NOT EXISTS cardiologist_alerts (
  cad TEXT PRIMARY KEY REFERENCES cases(cad), cardiologist TEXT NOT NULL, hospital TEXT NOT NULL,
  alerted_at INTEGER NOT NULL, shown_at INTEGER, acknowledged_at INTEGER, acknowledged_by TEXT
);
CREATE TABLE IF NOT EXISTS alert_followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT, cad TEXT NOT NULL REFERENCES cases(cad),
  kind TEXT NOT NULL, level INTEGER, target TEXT, at INTEGER NOT NULL
);
-- ecg_views: the cardiologist's first view of each image (0.4.0 and earlier). From 0.5.0 ecg_role_views records the
-- first view per role (er | cardiologist), so the ER Doctor's and the Cardiologist's reviews are kept apart
CREATE TABLE IF NOT EXISTS ecg_views (
  cad TEXT NOT NULL, ecg_n INTEGER NOT NULL, i INTEGER NOT NULL, viewed_at INTEGER NOT NULL, viewed_by TEXT,
  PRIMARY KEY (cad, ecg_n, i)
);
CREATE TABLE IF NOT EXISTS ecg_role_views (
  cad TEXT NOT NULL, role TEXT NOT NULL, ecg_n INTEGER NOT NULL, i INTEGER NOT NULL, viewed_at INTEGER NOT NULL, viewed_by TEXT,
  PRIMARY KEY (cad, role, ecg_n, i)
);

-- acknowledgement and decision are separate events
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY, cad TEXT NOT NULL REFERENCES cases(cad),
  kind TEXT NOT NULL CHECK (kind IN ('confirm','not','repeat')),
  on_ecg INTEGER, also_json TEXT, reason TEXT, note TEXT, advice TEXT, reasons_json TEXT,
  instruction TEXT, within_min INTEGER, ai_feedback TEXT,
  decided_at INTEGER NOT NULL, received_at INTEGER NOT NULL,
  decided_by TEXT NOT NULL, decided_by_title TEXT, user_id TEXT,
  delivered_at INTEGER, crew_ack_at INTEGER
);

CREATE TABLE IF NOT EXISTS destinations (
  id TEXT PRIMARY KEY, cad TEXT NOT NULL REFERENCES cases(cad), hospital TEXT NOT NULL,
  status TEXT NOT NULL, reason TEXT, why TEXT, from_hospital TEXT,
  at INTEGER NOT NULL, received_at INTEGER NOT NULL, set_by TEXT
);
CREATE TABLE IF NOT EXISTS etas (
  id TEXT PRIMARY KEY, cad TEXT NOT NULL REFERENCES cases(cad), minutes INTEGER NOT NULL,
  departed_at INTEGER, at INTEGER NOT NULL, received_at INTEGER NOT NULL, set_by TEXT, why TEXT
);

-- arrivals, handovers, final_vitals: the 0.3.0 handover documentation. No longer used (handover belongs to ICCC / ePCR,
-- not to the STEMI pathway); kept so that existing test databases still open, and nothing written earlier is lost.
-- arrival at the receiving hospital. A correction before closure is a new row; the latest row is the current one
CREATE TABLE IF NOT EXISTS arrivals (
  id TEXT PRIMARY KEY, cad TEXT NOT NULL REFERENCES cases(cad), hospital TEXT NOT NULL, arrived_at INTEGER NOT NULL,
  kind TEXT NOT NULL,                   -- mark | correct
  received_at INTEGER NOT NULL, set_by TEXT, op_id TEXT
);
-- transfer of care. Each save is a new row (earlier details kept); the latest row is the one used at closure
CREATE TABLE IF NOT EXISTS handovers (
  id TEXT PRIMARY KEY, cad TEXT NOT NULL REFERENCES cases(cad), handover_at INTEGER, hospital TEXT,
  area TEXT, area_other TEXT, clinician_name TEXT, clinician_role TEXT, crew_clinician TEXT, notes TEXT,
  saved_at INTEGER NOT NULL, received_at INTEGER NOT NULL, saved_by TEXT, op_id TEXT
);
-- the crew confirmed the final vital signs at handover: the latest recorded values at that moment (they are rows in
-- observations / treatments; this only records which ones were confirmed, and when)
CREATE TABLE IF NOT EXISTS final_vitals (
  id TEXT PRIMARY KEY, cad TEXT NOT NULL REFERENCES cases(cad), values_json TEXT NOT NULL,
  confirmed_at INTEGER NOT NULL, received_at INTEGER NOT NULL, confirmed_by TEXT, op_id TEXT
);

-- the corpuls monitor's vital signs: a light history, not every sample (each blood pressure measurement, about one row
-- a minute otherwise, the values at SEND and the first sample after a reconnection). The latest values are on the case.
CREATE TABLE IF NOT EXISTS monitor_vitals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, cad TEXT NOT NULL REFERENCES cases(cad), at INTEGER NOT NULL, received_at INTEGER NOT NULL,
  device_id TEXT, source TEXT NOT NULL, hr INTEGER, spo2 INTEGER, bp_sys INTEGER, bp_dia INTEGER, bp_at INTEGER, rr INTEGER,
  event_id TEXT, why TEXT
);
-- the feed's significant moments (linked, connected, connection lost, restored, ended, manual fallback): the timeline
-- reads them; the audit trail records them too. Routine samples and heartbeats are never recorded here
CREATE TABLE IF NOT EXISTS monitor_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, cad TEXT NOT NULL REFERENCES cases(cad), at INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL
);

-- what the cardiologist sees as NEW (silent updates)
CREATE TABLE IF NOT EXISTS case_updates (
  id TEXT PRIMARY KEY, cad TEXT NOT NULL REFERENCES cases(cad), kind TEXT NOT NULL,
  text TEXT NOT NULL, ref_json TEXT, at INTEGER NOT NULL, seen_at INTEGER
);

-- the audit timeline: timestamp, user, role, action, CAD number
-- role: crew | er | cardiologist for a person's action (actor = the name they entered); system for the platform and the
-- AI service; test-console for the test console; device: the prototype device session that sent the action
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, cad TEXT NOT NULL, at INTEGER NOT NULL,
  actor TEXT, user_id TEXT, role TEXT, action TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'evt'
);

-- every action a device sent, once (the id makes a resend after reconnection harmless)
CREATE TABLE IF NOT EXISTS ops (
  op_id TEXT PRIMARY KEY, cad TEXT NOT NULL, user_id TEXT, role TEXT, kind TEXT NOT NULL,
  device_time INTEGER, received_at INTEGER NOT NULL, payload_json TEXT
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE INDEX IF NOT EXISTS ix_audit_cad ON audit_events(cad, at);
CREATE INDEX IF NOT EXISTS ix_upd_cad ON case_updates(cad, at);
CREATE INDEX IF NOT EXISTS ix_img_cad ON ecg_images(cad, ecg_n);
CREATE INDEX IF NOT EXISTS ix_monv_cad ON monitor_vitals(cad, at);
CREATE INDEX IF NOT EXISTS ix_mone_cad ON monitor_events(cad, at);
