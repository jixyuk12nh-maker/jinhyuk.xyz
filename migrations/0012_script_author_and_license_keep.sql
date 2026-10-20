-- 스크립트 작성자 기록 (브라우저 열람·원문 조회 권한 판단에 사용). 기존 스크립트는 NULL이며 소유자만 열람 가능.
ALTER TABLE hosted_scripts ADD COLUMN created_by TEXT;

-- 라이선스 사용자는 프로젝트 삭제 후에도 남도록 project_id를 FK 없이 NULL 허용으로 재생성한다.
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
