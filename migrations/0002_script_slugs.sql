ALTER TABLE hosted_scripts ADD COLUMN slug TEXT;
UPDATE hosted_scripts SET slug = id WHERE slug IS NULL OR slug = '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_hosted_scripts_slug ON hosted_scripts(slug);
