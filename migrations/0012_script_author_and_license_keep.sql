ALTER TABLE hosted_scripts ADD COLUMN created_by TEXT;

CREATE TABLE license_users_new (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  license_key TEXT NOT NULL UNIQUE,
  discord_id TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  reset_days INTEGER NOT NULL DEFAULT 14 CHECK (reset_days BETWEEN 1 AND 365),
  resets INTEGER NOT NULL DEFAULT 0,
  last_reset TEXT,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0,1)),
  hwid TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO license_users_new (id, project_id, license_key, discord_id, memo, reset_days, resets, last_reset, used, hwid, created_at)
  SELECT id, project_id, license_key, discord_id, memo, reset_days, resets, last_reset, used, hwid, created_at FROM license_users;
DROP TABLE license_users;
ALTER TABLE license_users_new RENAME TO license_users;
CREATE INDEX IF NOT EXISTS idx_license_users_project ON license_users(project_id);
