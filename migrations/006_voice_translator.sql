-- Migration 006: Voice Translator support.
--
-- WHAT THIS DOES:
-- 1. Adds `translation_method` to `history` (text|voice|ocr|chat) — the field
--    requested by spec so voice usage can be distinguished from typed/camera
--    usage in analytics. Backfills existing rows from the pre-existing `kind`
--    column (translation->text, camera->ocr, voice->voice) so no history is
--    lost or left inconsistent; NOT a replacement for `kind`, which stays
--    exactly as-is for backward compatibility with existing queries/frontend.
-- 2. Adds `source_lang` / `target_lang` to `history` so "voice translations
--    by language pair" can be a real query instead of a guess. Existing rows
--    predate multilingual support and are left NULL — genuinely unknown data
--    stays NULL rather than being backfilled with a fabricated guess.
--
-- Nothing here drops, renames, or deletes any existing column, table, or row.
-- Safe to run more than once (every step is idempotent).

ALTER TABLE history ADD COLUMN IF NOT EXISTS translation_method TEXT;
ALTER TABLE history ADD COLUMN IF NOT EXISTS source_lang TEXT;
ALTER TABLE history ADD COLUMN IF NOT EXISTS target_lang TEXT;

UPDATE history SET translation_method = CASE
  WHEN kind = 'camera' THEN 'ocr'
  WHEN kind = 'voice' THEN 'voice'
  ELSE 'text'
END
WHERE translation_method IS NULL;

CREATE INDEX IF NOT EXISTS idx_history_method ON history(translation_method);
CREATE INDEX IF NOT EXISTS idx_history_voice_langs ON history(source_lang, target_lang) WHERE kind = 'voice';
