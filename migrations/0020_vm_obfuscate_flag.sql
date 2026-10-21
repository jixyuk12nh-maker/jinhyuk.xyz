ALTER TABLE hosted_scripts ADD COLUMN vm_obfuscate INTEGER NOT NULL DEFAULT 1 CHECK (vm_obfuscate IN (0,1));
