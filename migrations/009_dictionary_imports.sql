-- Migration 009: Dictionary import + provenance
-- Provides a safe, repeatable bulk-import path for large licensed/public-domain
-- language packs without hardcoding thousands of entries into db.js.

ALTER TABLE words ADD COLUMN IF NOT EXISTS source_name TEXT NOT NULL DEFAULT '';
ALTER TABLE words ADD COLUMN IF NOT EXISTS source_url TEXT NOT NULL DEFAULT '';
ALTER TABLE words ADD COLUMN IF NOT EXISTS source_license TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_words_source_name ON words (source_name);

CREATE TABLE IF NOT EXISTS dictionary_imports (
  id SERIAL PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  source_license TEXT NOT NULL DEFAULT '',
  source_lang TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  verified_count INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dictionary_imports_pair
  ON dictionary_imports (source_lang, target_lang, created_at DESC);
