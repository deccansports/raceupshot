PRAGMA foreign_keys = ON;

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE permissions (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  description TEXT
);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','invited')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE TABLE user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sport TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  description TEXT,
  starts_at TEXT,
  venue TEXT,
  city TEXT,
  state TEXT,
  country TEXT NOT NULL DEFAULT 'IND',
  live_refresh_seconds INTEGER NOT NULL DEFAULT 15,
  cache_version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE INDEX events_status_starts_idx ON events(status, starts_at);

CREATE TABLE event_categories (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  slug TEXT NOT NULL,
  sport TEXT NOT NULL,
  distance REAL,
  distance_unit TEXT DEFAULT 'km',
  ranking_mode TEXT NOT NULL DEFAULT 'chip_time',
  starts_at TEXT,
  cutoff_seconds INTEGER,
  display_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(event_id, slug)
);
CREATE TABLE age_groups (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  min_age INTEGER,
  max_age INTEGER,
  gender TEXT
);
CREATE TABLE start_waves (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES event_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  starts_at TEXT NOT NULL
);
CREATE TABLE timing_points (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  distance REAL,
  discipline TEXT,
  sequence INTEGER NOT NULL,
  reader_identifier TEXT,
  latitude REAL,
  longitude REAL,
  public_label TEXT,
  visible INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(event_id, code)
);
CREATE TABLE event_documents (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL, r2_key TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE event_sponsors (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL, logo_r2_key TEXT, url TEXT, display_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE event_announcements (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL, body TEXT NOT NULL, published_at TEXT
);

CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  external_id TEXT,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  category_id TEXT NOT NULL REFERENCES event_categories(id) ON DELETE RESTRICT,
  bib_number TEXT NOT NULL,
  chip_id TEXT,
  full_name TEXT NOT NULL,
  gender TEXT,
  date_of_birth TEXT,
  age_group_id TEXT REFERENCES age_groups(id),
  email TEXT,
  phone TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  club TEXT,
  privacy_setting TEXT NOT NULL DEFAULT 'public',
  timing_status TEXT NOT NULL DEFAULT 'not_started',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, bib_number),
  UNIQUE(event_id, external_id),
  UNIQUE(event_id, chip_id)
);
CREATE INDEX participants_event_name_idx ON participants(event_id, full_name);

CREATE TABLE participant_results (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES event_categories(id) ON DELETE RESTRICT,
  status TEXT NOT NULL,
  start_time TEXT,
  finish_time TEXT,
  gun_seconds INTEGER,
  chip_seconds INTEGER,
  penalty_seconds INTEGER NOT NULL DEFAULT 0,
  overall_rank INTEGER,
  gender_rank INTEGER,
  age_group_rank INTEGER,
  rank_version INTEGER,
  ranked_at TEXT,
  published_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(participant_id, category_id)
);
CREATE INDEX results_category_rank_idx ON participant_results(category_id, overall_rank);
CREATE TABLE result_splits (
  id TEXT PRIMARY KEY,
  result_id TEXT NOT NULL REFERENCES participant_results(id) ON DELETE CASCADE,
  timing_point_id TEXT NOT NULL REFERENCES timing_points(id) ON DELETE RESTRICT,
  clock_time TEXT,
  elapsed_seconds INTEGER,
  split_rank INTEGER,
  UNIQUE(result_id, timing_point_id)
);
CREATE TABLE timing_reads (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  timing_point_id TEXT NOT NULL REFERENCES timing_points(id) ON DELETE RESTRICT,
  chip_id TEXT NOT NULL,
  provider_read_id TEXT,
  read_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw_payload TEXT,
  UNIQUE(event_id, provider_read_id)
);
CREATE INDEX timing_reads_event_point_time_idx ON timing_reads(event_id, timing_point_id, read_at);
CREATE TABLE result_penalties (
  id TEXT PRIMARY KEY, result_id TEXT NOT NULL REFERENCES participant_results(id) ON DELETE CASCADE,
  seconds INTEGER NOT NULL, reason TEXT NOT NULL, created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE result_revisions (
  id TEXT PRIMARY KEY, result_id TEXT NOT NULL REFERENCES participant_results(id) ON DELETE CASCADE,
  before_json TEXT, after_json TEXT NOT NULL, created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE imports (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  type TEXT NOT NULL, mode TEXT NOT NULL, r2_key TEXT NOT NULL, status TEXT NOT NULL,
  valid_rows INTEGER DEFAULT 0, rejected_rows INTEGER DEFAULT 0,
  created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT
);
CREATE TABLE import_templates (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT, mapping_json TEXT NOT NULL,
  created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE import_errors (
  id TEXT PRIMARY KEY, import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  row_number INTEGER, code TEXT NOT NULL, message TEXT NOT NULL, row_json TEXT
);

CREATE TABLE cms_pages (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, excerpt TEXT,
  content_html TEXT, seo_title TEXT, meta_description TEXT, status TEXT NOT NULL DEFAULT 'draft',
  published_at TEXT, created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE cms_page_revisions (
  id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES cms_pages(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL, created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(page_id, revision)
);
CREATE TABLE cms_blocks (
  id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES cms_pages(id) ON DELETE CASCADE,
  type TEXT NOT NULL, payload_json TEXT NOT NULL, display_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE media (
  id TEXT PRIMARY KEY, r2_key TEXT NOT NULL UNIQUE, filename TEXT NOT NULL, mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL, uploaded_by TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE certificate_templates (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL, template_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE certificates (
  id TEXT PRIMARY KEY, result_id TEXT NOT NULL REFERENCES participant_results(id) ON DELETE CASCADE,
  verification_code TEXT NOT NULL UNIQUE, r2_key TEXT, issued_at TEXT, revoked_at TEXT
);
CREATE TABLE contact_enquiries (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, organization TEXT, email TEXT NOT NULL, phone TEXT,
  event_name TEXT, event_type TEXT, event_date TEXT, participant_count INTEGER, city TEXT,
  services_json TEXT, message TEXT, status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE notification_templates (
  id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, channel TEXT NOT NULL, subject TEXT, body TEXT NOT NULL
);
CREATE TABLE notification_jobs (
  id TEXT PRIMARY KEY, template_id TEXT REFERENCES notification_templates(id), recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', payload_json TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE api_integrations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, api_key_hash TEXT NOT NULL, secret_ciphertext TEXT NOT NULL,
  allowed_event_ids_json TEXT NOT NULL, permissions_json TEXT NOT NULL, rate_limit INTEGER NOT NULL DEFAULT 600,
  status TEXT NOT NULL DEFAULT 'active', last_request_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE api_request_logs (
  id TEXT PRIMARY KEY, integration_id TEXT REFERENCES api_integrations(id), request_id TEXT NOT NULL,
  event_id TEXT, method TEXT NOT NULL, path TEXT NOT NULL, status_code INTEGER NOT NULL,
  idempotency_key TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX api_idempotency_idx ON api_request_logs(integration_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE system_settings (
  key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_by TEXT REFERENCES users(id), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), action TEXT NOT NULL, entity_type TEXT NOT NULL,
  entity_id TEXT, before_json TEXT, after_json TEXT, ip_address TEXT, user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX audit_entity_time_idx ON audit_logs(entity_type, entity_id, created_at);
