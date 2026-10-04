-- Unified STEMI Platform · first functional multi-device test build
-- TEST DATA ONLY. Every row is fictional. No real patient information may be stored here.
-- All times are epoch milliseconds. Every case object carries the CAD number (cad), the primary case identifier.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('crew','cardiologist')),
  name          TEXT NOT NULL,          -- e.g. K. Ahmed / Dr X (fictional)
  title         TEXT NOT NULL,          -- Paramedic / Cardiologist
  org           TEXT,                   -- PCI Hospital A (placeholder)
  unit          TEXT,                   -- Ambulance 214 (crew only)
  emirate       TEXT
);

-- one row per CAD case; the CAD number is the operational case identifier (Q-44)
CREATE TABLE IF NOT EXISTS cases (
  cad                 TEXT PRIMARY KEY,
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

-- ECG 1, ECG 2, ECG 3 …: one row per acquisition
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
  kind TEXT, quality TEXT, source TEXT NOT NULL,      -- source: test-generator | file
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
CREATE TABLE IF NOT EXISTS ecg_views (
  cad TEXT NOT NULL, ecg_n INTEGER NOT NULL, i INTEGER NOT NULL, viewed_at INTEGER NOT NULL, viewed_by TEXT,
  PRIMARY KEY (cad, ecg_n, i)
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

-- what the cardiologist sees as NEW (silent updates)
CREATE TABLE IF NOT EXISTS case_updates (
  id TEXT PRIMARY KEY, cad TEXT NOT NULL REFERENCES cases(cad), kind TEXT NOT NULL,
  text TEXT NOT NULL, ref_json TEXT, at INTEGER NOT NULL, seen_at INTEGER
);

-- the audit timeline: timestamp, user, action, CAD number
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, cad TEXT NOT NULL, at INTEGER NOT NULL,
  actor TEXT, user_id TEXT, action TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'evt'
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
