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
CREATE TABLE IF NOT EXISTS loader_events (
  id TEXT PRIMARY KEY,
  developer_id TEXT,
  script_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  country TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_loader_events_script_created ON loader_events(script_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loader_events_developer_created ON loader_events(developer_id, created_at DESC);
CREATE TABLE IF NOT EXISTS developers (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_key TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'developer' CHECK (role IN ('developer', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_developers_status ON developers(status, role);

CREATE TABLE IF NOT EXISTS products (
  product_id TEXT PRIMARY KEY,
  developer_id TEXT NOT NULL,
  script_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (developer_id) REFERENCES developers(id),
  FOREIGN KEY (script_id) REFERENCES scripts(id)
);
CREATE INDEX IF NOT EXISTS idx_products_developer ON products(developer_id, status);
ALTER TABLE scripts ADD COLUMN developer_id TEXT;
CREATE INDEX IF NOT EXISTS idx_scripts_developer ON scripts(developer_id, updated_at DESC);
