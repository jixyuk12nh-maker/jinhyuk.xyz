PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  allowed_place_ids TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_verified_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_licenses_product ON licenses(product_id);

CREATE TABLE IF NOT EXISTS scripts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_key TEXT NOT NULL,
  script_name TEXT NOT NULL,
  script_key TEXT NOT NULL,
  protected_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  loader_mode TEXT NOT NULL DEFAULT 'keyless' CHECK (loader_mode IN ('keyless', 'key')),
  product_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(username_key, script_key)
);
CREATE INDEX IF NOT EXISTS idx_scripts_user ON scripts(username_key, updated_at DESC);

-- Loader request events for basic usage and abuse monitoring.
CREATE TABLE IF NOT EXISTS loader_events (
  id TEXT PRIMARY KEY,
  script_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  country TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_loader_events_script_created ON loader_events(script_name, created_at DESC);
