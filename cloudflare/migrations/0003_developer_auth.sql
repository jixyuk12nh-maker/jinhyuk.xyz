CREATE TABLE IF NOT EXISTS developers (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_key TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'developer' CHECK (role IN ('developer', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_developers_status ON developers(status, role);

CREATE TABLE IF NOT EXISTS products (
  product_id TEXT PRIMARY KEY,
  developer_id TEXT NOT NULL,
  script_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (developer_id) REFERENCES developers(id),
  FOREIGN KEY (script_id) REFERENCES scripts(id)
);
CREATE INDEX IF NOT EXISTS idx_products_developer ON products(developer_id, status);

ALTER TABLE scripts ADD COLUMN developer_id TEXT;
CREATE INDEX IF NOT EXISTS idx_scripts_developer ON scripts(developer_id, updated_at DESC);
