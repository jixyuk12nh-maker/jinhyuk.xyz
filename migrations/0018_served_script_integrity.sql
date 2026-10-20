ALTER TABLE hosted_scripts ADD COLUMN served_sha256 TEXT;
CREATE INDEX IF NOT EXISTS idx_hosted_scripts_served_sha256 ON hosted_scripts(served_sha256);
