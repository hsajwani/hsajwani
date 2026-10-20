# Database · MASAR STEMI prototype 0.7.0

**SQLite — PROTOTYPE DATABASE unless approved for production.** The database holds fictional test data only. No real
patient information may ever be stored in it.

- **Engine:** SQLite through EF Core 10 (`Microsoft.EntityFrameworkCore.Sqlite`), in write-ahead log (WAL) mode.
- **File:** `{Storage:DataDirectory}/{Storage:DatabaseFileName}`, by default `data/stemi-test.db`. In the development
  environment this is `stemi-app/data/stemi-test.db` (see [configuration.md](configuration.md#storage)).
- **Code:** `src/Masar.Infrastructure/Persistence/` holds the following:
  - `MasarDbContext.cs`: the model;
  - `Migrations/`: the migrations;
  - `DatabaseInitializer.cs`: runs the migrations at start;
  - `SettingsStore.cs`.

  The entity classes are in `src/Masar.Domain/Entities/`.
- **Conventions:**
  - Every time is a Unix epoch time in **milliseconds** (UTC), stored as `INTEGER`.
  - Booleans are `INTEGER` 0/1.
  - Every case-related row carries the CAD number (`cad`), the case identifier (one case per CAD number, stored
    normalised as `YYYYMMDD-NNNN-N`).
  - Columns are snake_case. Each EF property maps to the snake_case form of its name (`MasarDbContext.SnakeCase`:
    `ErAlertShownAt` → `er_alert_shown_at`).

## How the code writes

The services follow one write model (`src/Masar.Application/Common/DbWrites.cs`, `Transactions.cs`):

- **Write-through.**
  - An insert is saved at once: `db.Insert(entity)` adds the row, saves it, then clears the change tracker.
  - An update is an `ExecuteUpdate` statement, run immediately.
  - Queries do not track entities: `QueryTrackingBehavior.NoTracking` is set in
    `src/Masar.Infrastructure/DependencyInjection.cs`.

  So every read returns what is in the database, and every write runs in the order the code makes it.
- **One unit of work per change.** `PlatformGate` (`src/Masar.Application/Common/PlatformGate.cs`) runs each change with
  one `DbContext` under one in-process lock. A group of writes that belong together runs in a transaction
  (`db.InTransaction(...)`). A failure rolls the whole group back.
- **Never overwritten.**
  - Minimum data (`patient_details`, `observations`) and treatments (`treatments`) are new rows for every entry. The
    history, with who entered what and when, is kept.
  - ECGs are numbered, never replaced; a repeat ECG is a new number.
  - Decisions are kept: a later decision is a new row.
- **The audit trail is append-only.**
  - `AuditWriter` (`src/Masar.Application/Common/AuditWriter.cs`) inserts `audit_events` rows one at a time, so their
    order is the order of the events.
  - Audit rows are never reworded or deleted by the pathway.
  - Two exceptions:
    - Correcting the CAD number of an **unsent** case moves every row of that case, audit included, to the corrected
      number. The correction itself is audited.
    - The test console's TEST ONLY "Delete all test data" deletes everything.
- **Insertion order.** Some lists must keep the order in which rows were inserted, even when two rows have the same
  time. Those queries order by SQLite's `rowid` with `FromSql`, exactly as the Node.js prototype did:
  - `CaseFactsLoader` (latest decision);
  - `MinimumDataReader` (minimum data);
  - `CaseRecordBuilder` (treatments, decisions, case updates).

## Tables

Foreign keys: the tables marked FK reference `cases(cad)`. EF Core's SQLite provider turns foreign-key enforcement on
for each connection. `audit_events` and `ops` deliberately have no foreign key, so an audit entry or a received action
is never lost because of a change to a case.

### Cases and people

| Table | Key | Purpose |
|---|---|---|
| `users` | `id` · `email` unique · `CHECK (role IN ('crew','cardiologist'))` | Login accounts. PROTOTYPE ONLY: one fictional crew test user (`u-crew-1`, `crew@test.local`, K. Ahmed, Paramedic, Ambulance 214). A cardiologist account made by 0.4.0 stays but can no longer log in. `password_hash` is an ASP.NET Core Identity PBKDF2 hash (a prototype scrypt hash is replaced at the next start). |
| `cases` | `cad` | One row per CAD number: the STEMI case and its pathway. |

Columns of `cases`, in their table order:

| Group | Columns |
|---|---|
| CAD entry | `cad`, `cad_source` (`manual-crew`, `manual-test-console`, or NULL for v0.1 cases), `cad_entered_at`, `cad_entered_by`, `created_cid` (the tablet's own id for the case, so a resent create is harmless) |
| Pathway closure | `status` (NULL while active, `closed` once closed), `handover_opened_at` (Case Summary first opened), `closed_at`, `closed_by`, `closed_user_id`, `closure_reason`, `closure_source` (the exact strings of `src/Masar.Domain/Pathway/PathwayClosure.cs`) |
| Case | `active` (0 = taken off the live screens by the test console; the pathway is not closed by this), `unit`, `emirate`, `crew_name`, `incident_type`, `dispatched_at`, `at_patient_at`, `created_at`, `pathway_opened_at`, `pathway_opened_by` |
| SEND | `submitted_at` (tablet time), `server_received_at` (NULL = unsent draft, never shown to the ER), `delivered_late`, `downtime_at`, `acknowledged_at`, `opened_at`, `compared_at` |
| ER Doctor step (0.5.0) | `er_alerted_at`, `er_alert_shown_at`, `er_doctor_name`, `er_accepted_at`, `er_assessment` (`activate`, `uncertain` or `not_suspicious`), `er_assessment_at`, `er_assessed_by`, `er_assessment_ecg`, `er_non_activation_reason`, `er_non_activation_comment`, `er_outcome_seen_at` |
| Cardiology (0.5.0) | `cardiology_activated_at`, `cardiology_activation_reason`, `cardiology_activated_by`, `cardiologist_name`, `cardiologist_acknowledged_at`, `cardiologist_decision`, `cardiologist_decision_at` |
| corpuls feed (0.6.0) | `corpuls_provider`, `corpuls_device_id`, `corpuls_device_label`, `corpuls_linked_at`, `corpuls_linked_by`, `corpuls_status` (`waiting`, `connected`, `reconnecting` or `disconnected`), `corpuls_status_at`, `corpuls_connected_once`, `corpuls_last_data_at`, `corpuls_link_ended_at`, `corpuls_link_end_reason`, `vitals_json`, `vitals_at`, `vitals_source`, `vitals_hist_at`, `draft_discarded_at` |

Notes on `cases`:
- The pathway **state is not stored**. It is derived from these columns by `PathwayStateMachine.DeriveState`
  (`src/Masar.Domain/Pathway/`), together with the alert, the latest decision and the number of ECGs.
- Names in `er_doctor_name`, `er_assessed_by`, `cardiology_activated_by` and `cardiologist_name` are typed by the
  clinician (Free-text ER Doctor Name — PROTOTYPE ONLY; Free-text Cardiologist Name — PROTOTYPE ONLY).

### What the crew sends

| Table | Key | Purpose |
|---|---|---|
| `patient_details` | `id` · FK | The crew's minimum data: `age`, `sex`, `complaint`, `onset`. One row per entry. Columns: `field`, `value_text`, `raw_json`, `taken_at`, `received_at`, `entered_by`, `entry_kind` (`sent`, `update`, `correct`, `clarify` or `fallback`), `reason`, `op_id`. |
| `observations` | `id` · FK | The same columns, for vital signs entered by the crew (`bp`, `hr`, `spo2`, `rr`) only as a manual fallback when corpuls cannot deliver them. `gcs` exists in cases of 0.5.0 and earlier. |
| `treatments` | `id` · FK | Treatment updates after SEND. Columns: `item_key`, `label`, `category`, `value_text`, `not_obtained`, `taken_at`, `received_at`, `entered_by`, `entry_kind` (`new`), `op_id`. |

### ECGs, images and the AI

| Table | Key | Purpose |
|---|---|---|
| `ecgs` | (`cad`, `n`) · FK | ECG 1, 2, 3 … of a case. They are numbered by the platform across every source, and a repeat is a new number. The columns are as follows. <br>• Times and sender: `acquired_at`, `sent_at`, `received_at`, `sent_by`. <br>• Images: `primary_image` (default 1). <br>• Fictional test pattern: `variant` (`border`, `clear`, `evolved` or `clear2`). <br>• Crew entry: `same_as_previous`, `time_reason`, `op_id`. <br>• Since 0.6.0: `source` (`corpuls`, `manual_fallback`, `test`, or NULL for photos of 0.5.0 and earlier), `device_id`, `source_event_id` (the provider's event id, so an ECG sent again is stored once), `source_seq` (the monitor's own count), `transmitted_at`, `device_hr` (heart rate reported with the 12-lead). |
| `ecg_images` | `id` · FK | One file in `{data}/images` per row. Several images can belong to one ECG; Image 1 is the primary. The columns are as follows. <br>• Link to the ECG: `ecg_n`, `i`. <br>• Times: `captured_at`, `uploaded_at`, `received_at`. <br>• Description: `kind`, `quality`. <br>• Source: `source` (`file`, `test-generator` or `corpuls`). <br>• The file: `file_name` (`img<12 hex>.jpg/.png/.svg`), `mime`, `bytes`, `sha256` (to check the file later). <br>• Crew entry: `added_after_send`, `uploaded_by`, `op_id`. <br>An upload is stored first with `ecg_n` NULL; the action that sends the ECG links it. |
| `ai_interpretations` | (`cad`, `ecg_n`) · FK | One AI analysis per ECG, shown unchanged on every screen. `status` is `proc` (processing), `ok`, `lim` (limited by quality), `wh` (not suitable) or `down` (unavailable). Other columns: `started_at`, `completed_at`, `provider`, `version`, `result_json`. Simulated AI Interpretation — PROTOTYPE ONLY: the only provider is the scripted mock. |

### ER, cardiology and the screens

| Table | Key | Purpose |
|---|---|---|
| `cardiologist_alerts` | `cad` · FK | The cardiology activation alert: `cardiologist`, `hospital` (placeholders: *Cardiologist on call* / *On-call cardiology*), `alerted_at`, `shown_at` (alarm started), `acknowledged_at`, `acknowledged_by`. |
| `decisions` | `id` · FK · `CHECK (kind IN ('confirm','not','repeat'))` | Every Cardiologist decision, kept. The columns are as follows. <br>• What and on which ECG: `kind`, `on_ecg` (must be the latest ECG). <br>• Content: `also_json`, `reason`, `note`, `advice`, `reasons_json`, `instruction`, `within_min`. <br>• AI feedback: `ai_feedback` (`Agree`, `Disagree` or `Did not use`). <br>• Times and who: `decided_at`, `received_at`, `decided_by`, `decided_by_title`, `user_id` (NULL: no account). <br>• Crew side: `delivered_at` (shown on the crew tablet), `crew_ack_at`. |
| `ecg_role_views` | (`cad`, `role`, `ecg_n`, `i`) | The first view of each ECG image per role (`er` or `cardiologist`): `viewed_at`, `viewed_by`. |
| `ecg_views` | (`cad`, `ecg_n`, `i`) | The cardiologist's first views as recorded by 0.4.0 and earlier. Read only. |
| `case_updates` | `id` · FK | The screens' silent "NEW" list: `kind` (`ecg`, `img`, `md`, `rec`, `ai` or `closed`), `text`, `ref_json`, `at`, `seen_at`. |

### The corpuls feed

| Table | Key | Purpose |
|---|---|---|
| `monitor_vitals` | `id` (autoincrement) · FK | A light history of the monitor's vital signs, not every sample and no waveforms. The columns are as follows. <br>• Times and origin: `at`, `received_at`, `device_id`, `source`. <br>• Values: `hr`, `spo2`, `bp_sys`, `bp_dia`, `bp_at`, `rr`. <br>• `event_id`. <br>• `why` says why the row was kept: <br>&nbsp;&nbsp;– `nibp`: each blood pressure measurement; <br>&nbsp;&nbsp;– `update`: explicit updates; <br>&nbsp;&nbsp;– `sample`: about one sample a minute, and the first after a status change; <br>&nbsp;&nbsp;– `at_send`: the values sent with the case. |
| `monitor_events` | `id` (autoincrement) · FK | The feed's significant moments, for the timeline: `kind` (`linked`, `connected`, `restored`, `lost`, `ended`, `ecg` or `fallback`), `text`, `at`. |

### Audit and actions

| Table | Key | Purpose |
|---|---|---|
| `audit_events` | `id` (autoincrement), no FK | The audit trail: `cad`, `at`, `actor` (the crew user, the name a clinician typed, *Platform*, *AI service (…)* or *corpuls feed (simulated)*), `user_id`, `role` (`crew`, `er`, `cardiologist`, `system` or `test-console`), `action` (the text), `kind` (`key` pathway event, `evt` technical event, `view` viewing), `device` (the prototype device session that sent the action). Routine monitor samples and heartbeats are never audited. |
| `ops` | `op_id`, no FK | Every action a screen sent, stored once. The id makes a resend after a reconnection harmless. Other columns: `cad`, `user_id` (crew user id or device session id), `role`, `kind`, `device_time`, `received_at`, `payload_json` (the action's data, as sent). |
| `settings` | `key` | Key–value settings (below). |

### Legacy tables (kept for old databases; nothing writes to them)

| Table | From | Content |
|---|---|---|
| `alert_followups` | 0.4.0 | Reminder / escalation entries (the feature was removed) |
| `destinations`, `etas` | 0.4.0 | Destination hospital and ETA (these belong to ICCC, not to the STEMI pathway) |
| `arrivals`, `handovers`, `final_vitals` | 0.3.0 | Handover documentation (this belongs to ICCC / ePCR) |

They are kept so that a database made by an earlier version opens and nothing written earlier is lost. Do not build
new features on them.

### Indexes

| Index | On |
|---|---|
| `ix_audit_cad` | `audit_events(cad, at)` |
| `ix_upd_cad` | `case_updates(cad, at)` |
| `ix_img_cad` | `ecg_images(cad, ecg_n)` |
| `ix_monv_cad` | `monitor_vitals(cad, at)` |
| `ix_mone_cad` | `monitor_events(cad, at)` |
| `ix_ecg_event` | `ecgs(source_event_id)` |

The `users.email` unique constraint and the composite primary keys create their own SQLite indexes.

## JSON columns

The JSON is compact, with camelCase names, and non-ASCII characters are stored as they are
(`src/Masar.Application/Common/JsonDefaults.cs`). The shapes match what the Node.js prototype stored.

| Column | Shape |
|---|---|
| `cases.vitals_json` | The latest monitor values: `{"hr":88,"spo2":98,"rr":17,"sys":132,"dia":78,"bpAt":<ms>,"at":<ms>}`. A value the monitor did not report is `null`; `bpAt` is the time of the blood pressure measurement and `at` the time of the sample. |
| `patient_details.raw_json`, `observations.raw_json` | The structured value the crew screen sent with the text value, stored as sent. Examples: age `{"v":58,"est":false}`, sex `{"v":"Male"}`, complaint `{"k":"cp"}`, onset `{"t":<ms>,"approx":true}` or `{"nv":"Unknown"}`. |
| `case_updates.ref_json` | What the entry refers to: `{"n":2}` for `ecg` and `ai`, `{"n":1,"i":2}` for `img`, `{"k":"age","corr":false}` for `md`, `{"k":"asp"}` for `rec`, `{}` for `closed`. |
| `decisions.also_json` | Earlier ECG numbers also reviewed: `[1]`. |
| `decisions.reasons_json` | Reasons ticked by the Cardiologist: `["…"]` (at most 8). |
| `ai_interpretations.result_json` | The scripted result (`src/Masar.Infrastructure/Ai/MockEcgAiProvider.cs`): `q` (image / feed quality text), `ver`, `pri` (primary image), `provider`, and for `ok` and `lim` also `rhy`, `rate`, `ste`, `std`, `cond`, `ser` (serial comparison `{vs, vsAcq, h, t}` or null), `imp` (impression), `conf`, `lim` (which parts are limited). `wh` and `down` store only `q`, `ver`, `pri`, `provider`. If the provider throws, the result is `{"ver":"AI service error"}` with status `down`. |
| `ops.payload_json` | The action's `data` object as the screen sent it (see [api.md](api.md)). |
| `final_vitals.values_json` | 0.3.0 only. |

### Settings

| Key | Value |
|---|---|
| `sim` | The test console's simulation choices (TEST ONLY): `{"find":"border","q":"good","ai":"ok","ids":false}`. `find` is the fictional ECG pattern of the manual fallback's test generator; `q` is the quality of the next fictional test photo; `ai` is the mock AI behaviour (`ok`, `down` or `proc`, where `proc` holds analyses at "processing"). |
| `epoch` | A base-36 time string that changes when the test data is reset, so open screens drop what they held. |
| `corpuls_sim` | The Mock Corpuls Provider's per-monitor settings, so they survive a restart: `{"SIM-C3-214":{"unit":"Ambulance 214","available":true,"paused":false,"signal":true,"target":{"hr":88,"spo2":98,"sys":132,"dia":78,"rr":17}}}`. These are simulation settings, not clinical data. |

## Migrations

Migrations are EF Core migrations in `src/Masar.Infrastructure/Persistence/Migrations/`. They are reproducible: a new
database built from them is identical to a database built by the Node.js prototype 0.6.1. The unit test
`DatabaseTests.A_database_created_by_the_nodejs_prototype_is_adopted_with_its_data_and_the_same_schema` compares the
two schemas.

| File | What |
|---|---|
| `20261020075608_InitialSchema.cs` | The **baseline**. It runs the prototype's own SQL: its `CREATE TABLE` statements verbatim, then the columns the prototype added on start, then the indexes. |
| `InitialSchemaSql.cs` | That SQL. **Never change this file**: it is the history every existing database was built with. |
| `20261020075608_InitialSchema.Designer.cs`, `MasarDbContextModelSnapshot.cs` | Generated by the EF Core tools. The snapshot describes the current model; the next migration is computed from it. |

### What happens at start

`DatabaseInitializer.Initialize()` runs before the server accepts requests (`src/Masar.Api/Hosting/StartupTasks.cs`).
It does three things:

1. It switches the database to WAL mode.
2. It checks whether the database was **created by the Node.js prototype** (versions 0.1 to 0.6.1). Such a database has
   a `cases` table and no `__EFMigrationsHistory` table. If so, it adopts the database in one transaction:
   - it runs the baseline `CREATE TABLE IF NOT EXISTS` statements (missing tables are created; existing ones are left
     alone);
   - it adds any of the prototype's later columns that are missing, checking each first, as the prototype did on every
     start;
   - it creates the indexes;
   - it records the baseline migration as applied.

   No row is changed or deleted.
3. It runs `Database.Migrate()`. A new database gets every migration; an existing one gets only those it lacks.

The steps are idempotent, so a restart changes nothing. EF Core 10 refuses to migrate when the model has changes that
are not in a migration. The unit test `DatabaseTests.A_clean_database_is_built_by_the_migrations_and_matches_the_model`
catches that before a release (`HasPendingModelChanges`).

### Adding a migration

1. Change the entity in `src/Masar.Domain/Entities/` and, if needed, its mapping in `MasarDbContext.cs`. Column names
   follow the snake_case rule automatically.
2. Create the migration from `stemi-app/`:

   ```sh
   dotnet tool restore
   dotnet ef migrations add <Name> \
     --project src/Masar.Infrastructure --startup-project src/Masar.Infrastructure \
     --output-dir Persistence/Migrations --namespace Masar.Infrastructure.Persistence.Migrations
   ```

   The tools build the model through `DesignTimeDbContextFactory` and never open a real database.
3. The tool may write the updated `MasarDbContextModelSnapshot.cs` into a folder named after the namespace
   (`src/Masar.Infrastructure/Masar/Infrastructure/Persistence/Migrations/`). Move it over the one in
   `Persistence/Migrations/` and delete the extra folder.
4. Review the generated `Up()` and `Down()`.
   - SQLite cannot alter most column definitions. For those changes EF rebuilds the table (create, copy, drop, rename);
     check that this is acceptable for the data.
   - Never edit `InitialSchemaSql.cs` or the baseline migration.
5. Run `dotnet test Masar.sln`. The database tests apply every migration to a clean database and to an adopted
   prototype database.
6. Document the change in this file and, for anything the screens see, in [api.md](api.md).

To apply migrations without starting the server, see [deployment.md](deployment.md#database-migrations).

## Backup

The data folder holds the database, `images/` (ECG files) and `keys/` (session keys). Back them up together.

- **With the server stopped:** copy the whole data folder. Include `stemi-test.db-wal` if it exists: it holds changes
  not yet written back into the main file.
- **While it runs:** take a consistent copy of the database with SQLite's online backup, for example
  `sqlite3 data/stemi-test.db ".backup '/backups/stemi-test.db'"` or `VACUUM INTO '/backups/stemi-test.db'`, then copy
  `images/`. Copying the `.db` file alone while the server writes can give an inconsistent copy.

Backup frequency, encryption and retention of backups are not decided ([open-decisions.md](open-decisions.md)).

## Reset (TEST ONLY)

- **While the server runs:** the test console (`/control`) has "Delete all test data" (`POST /api/control/reset`,
  `TestDataService`). It deletes every row of every case table (the list in `TestDataService.CaseTables`) and every
  image file, resets the simulated monitors and changes the epoch so open screens start afresh. The crew test user is
  kept.
- **With the server stopped:** `npm run reset` (`scripts/reset.js`) deletes `stemi-test.db` (with `-wal` and `-shm`)
  and `images/`. The next start rebuilds the database from the migrations and recreates the crew test user. It refuses
  to run while a server answers on the configured port. The generated crew password and the session keys are kept.

Neither may ever be used on anything but fictional test data. Production must have no such function
([security.md](security.md)).

## Retention

Nothing is deleted automatically. A discarded unsent case stays as a draft, and closed cases stay read-only for ever.
Only the TEST ONLY reset above deletes data. The retention period for cases, ECG images, the audit trail and backups is
a governance decision that has not been made ([open-decisions.md](open-decisions.md)).

## Moving to SQL Server or PostgreSQL

SQLite is the prototype database. If a server database is approved, the move has these parts:

1. Swap the provider: `UseSqlite` in `src/Masar.Infrastructure/DependencyInjection.cs` and
   `DesignTimeDbContextFactory.cs`, with the package in `Directory.Packages.props`. The connection string, with
   credentials, comes from configuration or a secret store.
2. Create a new baseline migration for that provider from the model. The SQLite baseline's SQL cannot be reused. Move
   the test data with a one-off export, if it is needed at all.
3. Revisit the SQLite-specific code:
   - **`rowid` ordering** with `FromSql` in `CaseFactsLoader`, `MinimumDataReader` and `CaseRecordBuilder`
     (`src/Masar.Application/Cases/`). A server database has no `rowid`: add an explicit sequence column (identity /
     insertion order) and order by it.
   - **`CaseService.Correct`** (`src/Masar.Application/Cases/CaseService.cs`) uses `PRAGMA defer_foreign_keys = ON`,
     `sqlite_master` and `pragma_table_info` to move a case to a corrected CAD number, primary key included. On another
     database, use deferred constraints (PostgreSQL), `ON UPDATE CASCADE`, or a surrogate case id with the CAD number as
     an ordinary unique column.
   - **`DatabaseInitializer`** uses `PRAGMA journal_mode = WAL`, `sqlite_master`, `pragma_table_info` and the prototype
     adoption. All of this is SQLite-only and can go once no prototype database needs adopting.
   - **`TestDataService`** issues `DELETE FROM "<table>"`, which is portable, and the whole function is TEST ONLY.
   - **`CaseQueryService.ListClosed`** uses `EF.Functions.Like`. SQLite's `LIKE` ignores ASCII case; SQL Server's
     depends on the collation and PostgreSQL's is case-sensitive. CAD numbers are stored in upper case, so this is
     minor.
4. Code that is already portable: the `SettingsStore` upsert (`ExecuteUpdate`, then insert), the snake_case mapping,
   the epoch-millisecond `INTEGER` times (`BIGINT`), and the boolean columns.
5. Concurrency: `PlatformGate` serialises changes inside one process only. A server database alone does not make the
   application able to scale out ([deployment.md](deployment.md#single-instance), [architecture.md](architecture.md)).
