import type { StellaFitnessDatabase } from "./db.js";

export const SCHEMA_VERSION = 1;

const INITIAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  version INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS program_cycles (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  program_id TEXT NOT NULL,
  program_version TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS raw_artifacts (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  mime_type TEXT,
  local_path TEXT,
  sha256 TEXT,
  captured_at TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS training_sessions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cycle_id TEXT REFERENCES program_cycles(id) ON DELETE SET NULL,
  source_artifact_id TEXT REFERENCES raw_artifacts(id) ON DELETE SET NULL,
  performed_at TEXT NOT NULL,
  program_week INTEGER,
  program_day TEXT,
  session_kind TEXT,
  extraction_confidence TEXT,
  user_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (user_confirmed IN (0, 1))
) STRICT;

CREATE TABLE IF NOT EXISTS exercise_observations (
  id TEXT PRIMARY KEY,
  training_session_id TEXT NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  exercise_id TEXT,
  raw_label TEXT NOT NULL,
  load_kg REAL,
  reps_json TEXT,
  total_reps INTEGER,
  duration_seconds INTEGER,
  confidence TEXT NOT NULL,
  user_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (user_confirmed IN (0, 1)),
  notes TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS body_weights (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  measured_at TEXT NOT NULL,
  weight_kg REAL NOT NULL,
  source TEXT NOT NULL,
  user_confirmed INTEGER NOT NULL DEFAULT 1 CHECK (user_confirmed IN (0, 1))
) STRICT;

CREATE TABLE IF NOT EXISTS diet_observations (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source_artifact_id TEXT REFERENCES raw_artifacts(id) ON DELETE SET NULL,
  observed_at TEXT NOT NULL,
  description TEXT NOT NULL,
  protein_min_g REAL,
  protein_max_g REAL,
  carbs_min_g REAL,
  carbs_max_g REAL,
  confidence TEXT NOT NULL,
  user_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (user_confirmed IN (0, 1)),
  uncertainty_json TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS subjective_claims (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  observed_at TEXT NOT NULL,
  claim_type TEXT NOT NULL,
  content TEXT NOT NULL,
  source_message_ref TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS derived_metrics (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  generated_at TEXT NOT NULL,
  name TEXT NOT NULL,
  window TEXT,
  value_json TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  algorithm_version TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS diagnosis_runs (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  model_ref TEXT NOT NULL,
  model_output_json TEXT,
  status TEXT NOT NULL,
  error TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS audit_runs (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  diagnosis_run_id TEXT NOT NULL REFERENCES diagnosis_runs(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  model_ref TEXT NOT NULL,
  user_belief_json TEXT NOT NULL,
  model_output_json TEXT,
  status TEXT NOT NULL,
  error TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  diagnosis_run_id TEXT REFERENCES diagnosis_runs(id) ON DELETE SET NULL,
  audit_run_id TEXT REFERENCES audit_runs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  decision_type TEXT NOT NULL,
  decision_json TEXT NOT NULL,
  policy_version TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_training_sessions_profile_time
  ON training_sessions(profile_id, performed_at);
CREATE INDEX IF NOT EXISTS idx_body_weights_profile_time
  ON body_weights(profile_id, measured_at);
CREATE INDEX IF NOT EXISTS idx_diet_observations_profile_time
  ON diet_observations(profile_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_derived_metrics_profile_time
  ON derived_metrics(profile_id, generated_at);
`;

export function initializeSchema(database: StellaFitnessDatabase): void {
  database.exec("BEGIN IMMEDIATE;");

  try {
    database.exec(INITIAL_SCHEMA_SQL);

    const row = database.prepare("SELECT version FROM schema_meta LIMIT 1").get() as
      | { version: number }
      | undefined;

    if (!row) {
      database.prepare("INSERT INTO schema_meta(version) VALUES (?)").run(
        SCHEMA_VERSION,
      );
    } else if (row.version !== SCHEMA_VERSION) {
      throw new Error(
        `Unsupported Stella Fitness schema version: ${row.version}`,
      );
    }

    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}
