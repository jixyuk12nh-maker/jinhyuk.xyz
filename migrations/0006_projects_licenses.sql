CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_name ON projects(name COLLATE NOCASE);
ALTER TABLE hosted_scripts ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE hosted_scripts ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT','ACTIVE'));
ALTER TABLE hosted_scripts ADD COLUMN version TEXT NOT NULL DEFAULT 'v0.0.0.1';
ALTER TABLE hosted_scripts ADD COLUMN silent INTEGER NOT NULL DEFAULT 0 CHECK (silent IN (0,1));
ALTER TABLE hosted_scripts ADD COLUMN heartbeat INTEGER NOT NULL DEFAULT 1 CHECK (heartbeat IN (0,1));
ALTER TABLE hosted_scripts ADD COLUMN lightweight INTEGER NOT NULL DEFAULT 0 CHECK (lightweight IN (0,1));
ALTER TABLE hosted_scripts ADD COLUMN secure_loader INTEGER NOT NULL DEFAULT 1 CHECK (secure_loader IN (0,1));
CREATE INDEX IF NOT EXISTS idx_hosted_scripts_project ON hosted_scripts(project_id);
INSERT OR IGNORE INTO projects (id, name) SELECT 'default-project', 'Default' WHERE EXISTS (SELECT 1 FROM hosted_scripts);
UPDATE hosted_scripts SET project_id = 'default-project' WHERE project_id IS NULL AND EXISTS (SELECT 1 FROM projects WHERE id = 'default-project');
CREATE TABLE IF NOT EXISTS script_files (
  id TEXT PRIMARY KEY,
  script_id TEXT NOT NULL REFERENCES hosted_scripts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_script_files_script ON script_files(script_id);
CREATE TABLE IF NOT EXISTS license_users (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_license_users_project ON license_users(project_id);
CREATE TABLE IF NOT EXISTS banned_ips (
  ip TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
