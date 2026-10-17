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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(username_key, script_key)
);
CREATE INDEX IF NOT EXISTS idx_scripts_user ON scripts(username_key, updated_at DESC);
