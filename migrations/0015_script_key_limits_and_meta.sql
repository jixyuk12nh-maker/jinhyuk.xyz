ALTER TABLE script_keys ADD COLUMN memo TEXT NOT NULL DEFAULT '';
ALTER TABLE script_keys ADD COLUMN discord_id TEXT NOT NULL DEFAULT '';
ALTER TABLE api_users ADD COLUMN script_key_limit INTEGER CHECK (script_key_limit IS NULL OR script_key_limit BETWEEN 0 AND 1000000);
