ALTER TABLE banned_ips ADD COLUMN expires_at TEXT;
ALTER TABLE banned_ips ADD COLUMN auto_ban INTEGER NOT NULL DEFAULT 0 CHECK (auto_ban IN (0,1));
CREATE INDEX IF NOT EXISTS idx_banned_ips_expires ON banned_ips(expires_at);
CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT,
  action TEXT NOT NULL,
  target TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_security_events_ip_created ON security_events(ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_action_created ON security_events(action, created_at DESC);
