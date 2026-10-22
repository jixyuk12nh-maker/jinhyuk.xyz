// 자동 생성 파일 (scripts/build-schema.mjs). 직접 고치지 마세요.
export const MIGRATIONS = [
 {
  "name": "0001_hosted_scripts.sql",
  "sql": "CREATE TABLE IF NOT EXISTS hosted_scripts (\n  id TEXT PRIMARY KEY,\n  name TEXT NOT NULL,\n  object_key TEXT NOT NULL UNIQUE,\n  byte_size INTEGER NOT NULL,\n  sha256 TEXT NOT NULL,\n  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),\n  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))\n);\nCREATE INDEX IF NOT EXISTS idx_hosted_scripts_created_at ON hosted_scripts(created_at DESC);\n"
 },
 {
  "name": "0002_script_slugs.sql",
  "sql": "ALTER TABLE hosted_scripts ADD COLUMN slug TEXT;\nUPDATE hosted_scripts SET slug = id WHERE slug IS NULL OR slug = '';\nCREATE UNIQUE INDEX IF NOT EXISTS idx_hosted_scripts_slug ON hosted_scripts(slug);\n"
 },
 {
  "name": "0003_roles_api_keys.sql",
  "sql": "CREATE TABLE IF NOT EXISTS api_users (\n  id TEXT PRIMARY KEY,\n  username TEXT NOT NULL UNIQUE,\n  role TEXT NOT NULL CHECK (role IN ('owner','admin','user')),\n  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),\n  created_by TEXT,\n  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),\n  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))\n);\nCREATE TABLE IF NOT EXISTS api_keys (\n  id TEXT PRIMARY KEY,\n  user_id TEXT NOT NULL REFERENCES api_users(id),\n  key_hash TEXT NOT NULL UNIQUE,\n  key_prefix TEXT NOT NULL,\n  created_by TEXT,\n  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),\n  expires_at TEXT,\n  revoked_at TEXT,\n  revoked_by TEXT,\n  last_used_at TEXT\n);\nCREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);\nCREATE TABLE IF NOT EXISTS api_audit_logs (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  user_id TEXT,\n  key_id TEXT,\n  action TEXT NOT NULL,\n  target TEXT,\n  status TEXT NOT NULL,\n  ip TEXT,\n  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))\n);\nCREATE INDEX IF NOT EXISTS idx_api_audit_created ON api_audit_logs(created_at DESC);\nDROP TABLE IF EXISTS admin_tokens;\n"
 },
 {
  "name": "0004_script_keys.sql",
  "sql": "ALTER TABLE hosted_scripts ADD COLUMN mode TEXT NOT NULL DEFAULT 'keyless' CHECK (mode IN ('keyless','key'));\nALTER TABLE hosted_scripts ADD COLUMN key_policy TEXT NOT NULL DEFAULT 'closed' CHECK (key_policy IN ('open','closed'));\nCREATE TABLE IF NOT EXISTS script_keys (\n  id TEXT PRIMARY KEY,\n  script_id TEXT NOT NULL REFERENCES hosted_scripts(id) ON DELETE CASCADE,\n  user_id TEXT NOT NULL REFERENCES api_users(id),\n  key_hash TEXT NOT NULL UNIQUE,\n  key_prefix TEXT NOT NULL,\n  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),\n  created_by TEXT,\n  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),\n  expires_at TEXT,\n  last_used_at TEXT\n);\nCREATE INDEX IF NOT EXISTS idx_script_keys_script_user ON script_keys(script_id, user_id);\n"
 },
 {
  "name": "0005_hwid_lock.sql",
  "sql": "ALTER TABLE hosted_scripts ADD COLUMN hwid_lock INTEGER NOT NULL DEFAULT 0 CHECK (hwid_lock IN (0,1));\nALTER TABLE script_keys ADD COLUMN hwid TEXT;\n"
 },
 {
  "name": "0006_projects_licenses.sql",
  "sql": "CREATE TABLE IF NOT EXISTS projects (\n  id TEXT PRIMARY KEY,\n  name TEXT NOT NULL,\n  created_by TEXT,\n  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))\n);\nCREATE UNIQUE INDEX IF NOT EXISTS idx_projects_name ON projects(name COLLATE NOCASE);\nALTER TABLE hosted_scripts ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;\nALTER TABLE hosted_scripts ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT','ACTIVE'));\nALTER TABLE hosted_scripts ADD COLUMN version TEXT NOT NULL DEFAULT 'v0.0.0.1';\nALTER TABLE hosted_scripts ADD COLUMN silent INTEGER NOT NULL DEFAULT 0 CHECK (silent IN (0,1));\nALTER TABLE hosted_scripts ADD COLUMN heartbeat INTEGER NOT NULL DEFAULT 1 CHECK (heartbeat IN (0,1));\nALTER TABLE hosted_scripts ADD COLUMN lightweight INTEGER NOT NULL DEFAULT 0 CHECK (lightweight IN (0,1));\nALTER TABLE hosted_scripts ADD COLUMN secure_loader INTEGER NOT NULL DEFAULT 1 CHECK (secure_loader IN (0,1));\nCREATE INDEX IF NOT EXISTS idx_hosted_scripts_project ON hosted_scripts(project_id);\nINSERT OR IGNORE INTO projects (id, name) SELECT 'default-project', 'Default' WHERE EXISTS (SELECT 1 FROM hosted_scripts);\nUPDATE hosted_scripts SET project_id = 'default-project' WHERE project_id IS NULL AND EXISTS (SELECT 1 FROM projects WHERE id = 'default-project');\nCREATE TABLE IF NOT EXISTS script_files (\n  id TEXT PRIMARY KEY,\n  script_id TEXT NOT NULL REFERENCES hosted_scripts(id) ON DELETE CASCADE,\n  name TEXT NOT NULL,\n  byte_size INTEGER NOT NULL,\n  object_key TEXT NOT NULL UNIQUE,\n  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))\n);\nCREATE INDEX IF NOT EXISTS idx_script_files_script ON script_files(script_id);\nCREATE TABLE IF NOT EXISTS license_users (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,\n  license_key TEXT NOT NULL UNIQUE,\n  discord_id TEXT NOT NULL DEFAULT '',\n  memo TEXT NOT NULL DEFAULT '',\n  reset_days INTEGER NOT NULL DEFAULT 14 CHECK (reset_days BETWEEN 1 AND 365),\n  resets INTEGER NOT NULL DEFAULT 0,\n  last_reset TEXT,\n  used INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0,1)),\n  hwid TEXT,\n  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))\n);\nCREATE INDEX IF NOT EXISTS idx_license_users_project ON license_users(project_id);\nCREATE TABLE IF NOT EXISTS banned_ips (\n  ip TEXT PRIMARY KEY,\n  reason TEXT NOT NULL DEFAULT '',\n  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))\n);\n"
 },
 {
  "name": "0007_api_key_labels.sql",
  "sql": "ALTER TABLE api_keys ADD COLUMN label TEXT;\n"
 },
 {
  "name": "0008_api_key_project.sql",
  "sql": "ALTER TABLE api_keys ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;\n"
 },
 {
  "name": "0009_api_key_token.sql",
  "sql": "ALTER TABLE api_keys ADD COLUMN token TEXT;\n"
 },
 {
  "name": "0010_key_run_failures.sql",
  "sql": "CREATE TABLE IF NOT EXISTS key_run_failures (\n  ip TEXT PRIMARY KEY,\n  fail_count INTEGER NOT NULL DEFAULT 0,\n  window_start TEXT NOT NULL,\n  blocked_until TEXT\n);\n"
 },
 {
  "name": "0011_drop_key_run_failures.sql",
  "sql": "DROP TABLE IF EXISTS key_run_failures;\n"
 },
 {
  "name": "0012_script_author_and_license_keep.sql",
  "sql": "ALTER TABLE hosted_scripts ADD COLUMN created_by TEXT;\n\nCREATE TABLE license_users_new (\n  id TEXT PRIMARY KEY,\n  project_id TEXT,\n  license_key TEXT NOT NULL UNIQUE,\n  discord_id TEXT NOT NULL DEFAULT '',\n  memo TEXT NOT NULL DEFAULT '',\n  reset_days INTEGER NOT NULL DEFAULT 14 CHECK (reset_days BETWEEN 1 AND 365),\n  resets INTEGER NOT NULL DEFAULT 0,\n  last_reset TEXT,\n  used INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0,1)),\n  hwid TEXT,\n  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))\n);\nINSERT INTO license_users_new (id, project_id, license_key, discord_id, memo, reset_days, resets, last_reset, used, hwid, created_at)\n  SELECT id, project_id, license_key, discord_id, memo, reset_days, resets, last_reset, used, hwid, created_at FROM license_users;\nDROP TABLE license_users;\nALTER TABLE license_users_new RENAME TO license_users;\nCREATE INDEX IF NOT EXISTS idx_license_users_project ON license_users(project_id);\n"
 },
 {
  "name": "0013_script_raw_and_obfuscated.sql",
  "sql": "ALTER TABLE hosted_scripts ADD COLUMN raw_object_key TEXT;\nALTER TABLE hosted_scripts ADD COLUMN obfuscated INTEGER NOT NULL DEFAULT 0 CHECK (obfuscated IN (0,1));\n"
 },
 {
  "name": "0014_script_key_token.sql",
  "sql": "ALTER TABLE script_keys ADD COLUMN token TEXT;\n"
 },
 {
  "name": "0015_script_key_limits_and_meta.sql",
  "sql": "ALTER TABLE script_keys ADD COLUMN memo TEXT NOT NULL DEFAULT '';\nALTER TABLE script_keys ADD COLUMN discord_id TEXT NOT NULL DEFAULT '';\nALTER TABLE api_users ADD COLUMN script_key_limit INTEGER CHECK (script_key_limit IS NULL OR script_key_limit BETWEEN 0 AND 1000000);\n"
 },
 {
  "name": "0016_security_turnstile.sql",
  "sql": "ALTER TABLE banned_ips ADD COLUMN expires_at TEXT;\nALTER TABLE banned_ips ADD COLUMN auto_ban INTEGER NOT NULL DEFAULT 0 CHECK (auto_ban IN (0,1));\nCREATE INDEX IF NOT EXISTS idx_banned_ips_expires ON banned_ips(expires_at);\nCREATE TABLE IF NOT EXISTS security_events (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  ip TEXT,\n  action TEXT NOT NULL,\n  target TEXT,\n  status TEXT NOT NULL,\n  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))\n);\nCREATE INDEX IF NOT EXISTS idx_security_events_ip_created ON security_events(ip, created_at DESC);\nCREATE INDEX IF NOT EXISTS idx_security_events_action_created ON security_events(action, created_at DESC);\n"
 },
 {
  "name": "0017_script_delivery_sessions.sql",
  "sql": "CREATE TABLE IF NOT EXISTS script_delivery_sessions (\n  id TEXT PRIMARY KEY,\n  token_hash TEXT NOT NULL UNIQUE,\n  script_id TEXT NOT NULL,\n  key_type TEXT NOT NULL CHECK (key_type IN ('license','script','decoy')),\n  key_id TEXT,\n  key_hash TEXT NOT NULL,\n  hwid TEXT,\n  initial_ip TEXT,\n  next_chunk INTEGER NOT NULL DEFAULT 0 CHECK (next_chunk BETWEEN 0 AND 6),\n  expires_at TEXT NOT NULL,\n  revoked_at TEXT,\n  decoy INTEGER NOT NULL DEFAULT 0 CHECK (decoy IN (0,1)),\n  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))\n);\nCREATE INDEX IF NOT EXISTS idx_delivery_sessions_expiry ON script_delivery_sessions(expires_at);\nCREATE INDEX IF NOT EXISTS idx_delivery_sessions_script_created ON script_delivery_sessions(script_id, created_at DESC);\n"
 },
 {
  "name": "0018_served_script_integrity.sql",
  "sql": "ALTER TABLE hosted_scripts ADD COLUMN served_sha256 TEXT;\nCREATE INDEX IF NOT EXISTS idx_hosted_scripts_served_sha256 ON hosted_scripts(served_sha256);\n"
 },
 {
  "name": "0019_delivery_chunk_order.sql",
  "sql": "ALTER TABLE script_delivery_sessions ADD COLUMN chunk_order TEXT;\n"
 },
 {
  "name": "0020_vm_obfuscate_flag.sql",
  "sql": "ALTER TABLE hosted_scripts ADD COLUMN vm_obfuscate INTEGER NOT NULL DEFAULT 1 CHECK (vm_obfuscate IN (0,1));\n"
 }
];
