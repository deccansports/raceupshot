PRAGMA foreign_keys = ON;

-- Provider credentials are never stored here. Secret references resolve only
-- inside trusted Worker code.
CREATE TABLE timing_provider_accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('FEIBOT','MANUAL','RACE_UPSHOT')),
  display_name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  account_key_secret_ref TEXT NOT NULL,
  secret_key_secret_ref TEXT NOT NULL,
  region TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  last_tested_at TEXT,
  last_success_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE event_timing_integrations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  provider_account_id TEXT REFERENCES timing_provider_accounts(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  provider_event_uuid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  enabled INTEGER NOT NULL DEFAULT 1,
  sync_participants INTEGER NOT NULL DEFAULT 1,
  sync_contests INTEGER NOT NULL DEFAULT 1,
  sync_timing_points INTEGER NOT NULL DEFAULT 1,
  sync_realtime INTEGER NOT NULL DEFAULT 1,
  sync_leaderboards INTEGER NOT NULL DEFAULT 1,
  sync_results INTEGER NOT NULL DEFAULT 1,
  enabled_for_web INTEGER NOT NULL DEFAULT 1,
  enabled_for_mobile INTEGER NOT NULL DEFAULT 1,
  participant_interval_seconds INTEGER NOT NULL DEFAULT 300,
  realtime_interval_seconds INTEGER NOT NULL DEFAULT 10,
  leaderboard_interval_seconds INTEGER NOT NULL DEFAULT 15,
  result_interval_seconds INTEGER NOT NULL DEFAULT 60,
  last_tested_at TEXT,
  last_success_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, provider)
);

CREATE TABLE event_platform_settings (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  live_settings_json TEXT NOT NULL,
  mobile_settings_json TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE contest_provider_mappings (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES event_categories(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_contest_uuid TEXT NOT NULL,
  provider_contest_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, provider, provider_contest_uuid),
  UNIQUE(event_id, provider, category_id)
);

CREATE TABLE participant_provider_mappings (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  participant_uid TEXT NOT NULL,
  athlete_uid TEXT,
  registration_id TEXT,
  provider TEXT NOT NULL,
  provider_participant_uuid TEXT NOT NULL,
  bib TEXT,
  contest_id TEXT,
  provider_contest_uuid TEXT,
  email_hash TEXT,
  matched_by TEXT,
  mapping_status TEXT NOT NULL DEFAULT 'UNMATCHED',
  confidence REAL,
  confirmed_by TEXT REFERENCES users(id),
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, provider, provider_participant_uuid)
);
CREATE INDEX participant_mapping_event_idx ON participant_provider_mappings(event_id);
CREATE INDEX participant_mapping_athlete_idx ON participant_provider_mappings(event_id, athlete_uid);
CREATE INDEX participant_mapping_bib_idx ON participant_provider_mappings(event_id, contest_id, bib);
CREATE INDEX participant_mapping_email_idx ON participant_provider_mappings(event_id, email_hash);

CREATE TABLE live_participants (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  participant_uid TEXT NOT NULL,
  athlete_uid TEXT,
  provider_participant_uuid TEXT,
  bib TEXT,
  contest_id TEXT,
  normalized_name TEXT,
  email_hash TEXT,
  privacy_status TEXT NOT NULL DEFAULT 'PUBLIC'
    CHECK (privacy_status IN ('PUBLIC','ANONYMOUS','PRIVATE')),
  race_status TEXT NOT NULL DEFAULT 'NOT_STARTED',
  latest_split_id TEXT,
  latest_timestamp TEXT,
  source_updated_at TEXT,
  possible_delete_count INTEGER NOT NULL DEFAULT 0,
  provider_deleted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, participant_uid)
);
CREATE INDEX live_participants_event_idx ON live_participants(event_id);
CREATE INDEX live_participants_event_bib_idx ON live_participants(event_id, bib);
CREATE INDEX live_participants_event_athlete_idx ON live_participants(event_id, athlete_uid);
CREATE INDEX live_participants_event_name_idx ON live_participants(event_id, normalized_name);
CREATE INDEX live_participants_event_status_idx ON live_participants(event_id, race_status);

CREATE TABLE athlete_event_privacy_overrides (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  participant_uid TEXT NOT NULL,
  athlete_uid TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('PUBLIC','ANONYMOUS','PRIVATE')),
  reason TEXT,
  set_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, participant_uid)
);

CREATE TABLE timing_sync_runs (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  module TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  records_received INTEGER NOT NULL DEFAULT 0,
  records_created INTEGER NOT NULL DEFAULT 0,
  records_updated INTEGER NOT NULL DEFAULT 0,
  records_skipped INTEGER NOT NULL DEFAULT 0,
  records_deleted INTEGER NOT NULL DEFAULT 0,
  records_rejected INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  rate_limited INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX timing_sync_event_module_idx ON timing_sync_runs(event_id, module, started_at);
CREATE UNIQUE INDEX timing_sync_idempotency_idx ON timing_sync_runs(event_id, module, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE notification_events (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  participant_uid TEXT,
  event_type TEXT NOT NULL,
  source_state TEXT,
  target_state TEXT,
  deduplication_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notification_deliveries (
  id TEXT PRIMARY KEY,
  notification_event_id TEXT NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  athlete_uid TEXT,
  push_token_hash TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE result_claims (
  id TEXT PRIMARY KEY,
  athlete_uid TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  participant_uid TEXT NOT NULL,
  result_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  evidence_json TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(athlete_uid, event_id, participant_uid)
);
