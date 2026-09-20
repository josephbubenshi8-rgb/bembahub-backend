-- Migration 007: Full-text translation memory.
-- Stores sentences, paragraphs and full-page translations for reuse.

CREATE TABLE IF NOT EXISTS translation_memory (
  id BIGSERIAL PRIMARY KEY,
  source_lang TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  source_text TEXT NOT NULL,
  source_text_key TEXT NOT NULL,
  target_text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'ai',
  usage_count INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_translation_memory_source
  ON translation_memory (source_lang, target_lang, source_text_key);

CREATE INDEX IF NOT EXISTS idx_translation_memory_pair
  ON translation_memory (source_lang, target_lang);

CREATE INDEX IF NOT EXISTS idx_translation_memory_recent
  ON translation_memory (last_used_at DESC);
