ALTER TABLE hosted_scripts ADD COLUMN hwid_lock INTEGER NOT NULL DEFAULT 0 CHECK (hwid_lock IN (0,1));
ALTER TABLE script_keys ADD COLUMN hwid TEXT;
