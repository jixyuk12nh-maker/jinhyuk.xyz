ALTER TABLE hosted_scripts ADD COLUMN mode TEXT NOT NULL DEFAULT 'keyless' CHECK (mode IN ('keyless','key'));
ALTER TABLE hosted_scripts ADD COLUMN key_policy TEXT NOT NULL DEFAULT 'closed' CHECK (key_policy IN ('open','closed'));
CREATE TABLE IF NOT EXISTS script_keys (
  id TEXT PRIMARY KEY,
  script_id TEXT NOT NULL REFERENCES hosted_scripts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES api_users(id),
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_script_keys_script_user ON script_keys(script_id, user_id);
