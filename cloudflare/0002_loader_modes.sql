-- Run this migration once against an existing D1 database.
ALTER TABLE scripts ADD COLUMN loader_mode TEXT NOT NULL DEFAULT 'keyless' CHECK (loader_mode IN ('keyless', 'key'));
ALTER TABLE scripts ADD COLUMN product_id TEXT;
CREATE TABLE IF NOT EXISTS loader_events (
  id TEXT PRIMARY KEY,
  script_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  country TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_loader_events_script_created ON loader_events(script_name, created_at DESC);
