-- Portable SQL: works on SQLite and, with the noted type changes, on PostgreSQL
-- (INTEGER PRIMARY KEY AUTOINCREMENT -> BIGSERIAL PRIMARY KEY, REAL -> NUMERIC(12,2)).
-- No personal data is stored: no users, devices, IPs or names of warehouse staff.

CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ean           TEXT,              -- canonical GTIN-13 (or EAN-8)
  article_no    TEXT,              -- manufacturer article number as printed
  article_norm  TEXT,              -- uppercase alphanumerics only, for matching
  brand         TEXT,
  name          TEXT NOT NULL,
  oem_numbers   TEXT NOT NULL DEFAULT '[]', -- JSON array of strings
  oem_norm      TEXT NOT NULL DEFAULT ' ',  -- " NUM1 NUM2 " normalized, for matching
  price         REAL,
  currency      TEXT,
  availability  TEXT,
  image_url     TEXT,
  product_url   TEXT,
  source        TEXT NOT NULL DEFAULT 'manual', -- manual | import | autodoc | scraper
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_products_ean ON products (ean) WHERE ean IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_products_article ON products (article_norm);
CREATE INDEX IF NOT EXISTS ix_products_url ON products (product_url);

CREATE TABLE IF NOT EXISTS scans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL,   -- what was scanned/typed
  code_type   TEXT NOT NULL,   -- ean | article | invalid
  found       INTEGER NOT NULL DEFAULT 0,
  source      TEXT,            -- local | autodoc | scraper | mock | null
  product_id  INTEGER,
  -- snapshot so history stays meaningful after catalog edits
  ean         TEXT,
  article_no  TEXT,
  brand       TEXT,
  name        TEXT,
  price       REAL,
  currency    TEXT,
  created_at  TEXT NOT NULL    -- ISO-8601 UTC
);
CREATE INDEX IF NOT EXISTS ix_scans_created ON scans (created_at);

CREATE TABLE IF NOT EXISTS lookup_cache (
  cache_key   TEXT PRIMARY KEY, -- provider:normalizedCode
  found       INTEGER NOT NULL,
  payload     TEXT,             -- JSON product or null
  fetched_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
