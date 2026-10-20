CREATE TABLE IF NOT EXISTS script_delivery_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  script_id TEXT NOT NULL,
  key_type TEXT NOT NULL CHECK (key_type IN ('license','script','decoy')),
  key_id TEXT,
  key_hash TEXT NOT NULL,
  hwid TEXT,
  initial_ip TEXT,
  next_chunk INTEGER NOT NULL DEFAULT 0 CHECK (next_chunk BETWEEN 0 AND 6),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  decoy INTEGER NOT NULL DEFAULT 0 CHECK (decoy IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_delivery_sessions_expiry ON script_delivery_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_delivery_sessions_script_created ON script_delivery_sessions(script_id, created_at DESC);
