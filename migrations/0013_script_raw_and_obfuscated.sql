ALTER TABLE hosted_scripts ADD COLUMN raw_object_key TEXT;
ALTER TABLE hosted_scripts ADD COLUMN obfuscated INTEGER NOT NULL DEFAULT 0 CHECK (obfuscated IN (0,1));
