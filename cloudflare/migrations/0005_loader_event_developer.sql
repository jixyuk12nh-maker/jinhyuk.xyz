ALTER TABLE loader_events ADD COLUMN developer_id TEXT;
CREATE INDEX IF NOT EXISTS idx_loader_events_developer_created ON loader_events(developer_id, created_at DESC);
UPDATE loader_events SET developer_id = (
  SELECT s.developer_id FROM scripts s WHERE s.script_name = loader_events.script_name AND s.developer_id IS NOT NULL LIMIT 1
) WHERE developer_id IS NULL AND (
  SELECT COUNT(DISTINCT s.developer_id) FROM scripts s WHERE s.script_name = loader_events.script_name AND s.developer_id IS NOT NULL
) = 1;
