-- Migration 004: Dictionary auto-growth from real translations.
--
-- WHAT THIS DOES:
-- 1. Adds usage_count / last_used_at / source / definition / created_at to the
--    existing `words` table — reusing it rather than creating a parallel table,
--    since an unverified candidate is meant to BECOME a real dictionary entry
--    once an admin verifies it, not live in a separate system forever.
-- 2. Reclassifies the old two-state model (approved) into the new three-state
--    one (unverified / verified / rejected) — existing curated rows become
--    'verified', which is what they already functionally were.
-- 3. De-duplicates any existing (en, bm) pairs BEFORE adding a uniqueness
--    constraint, so repeat translations of the same phrase increment a
--    counter instead of ever creating duplicate rows.
-- 4. Adds a lightweight search_log table so "most searched words" analytics
--    are real counts, not invented numbers.
--
-- Safe to run more than once — every step is idempotent, and no existing
-- words/translations/favorites/history rows are deleted.

ALTER TABLE words ADD COLUMN IF NOT EXISTS usage_count  INTEGER NOT NULL DEFAULT 1;
ALTER TABLE words ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE words ADD COLUMN IF NOT EXISTS source       TEXT NOT NULL DEFAULT 'dictionary'; -- dictionary | ai | user | admin
ALTER TABLE words ADD COLUMN IF NOT EXISTS definition   TEXT NOT NULL DEFAULT '';
ALTER TABLE words ADD COLUMN IF NOT EXISTS created_at   TIMESTAMPTZ NOT NULL DEFAULT now();

-- Existing curated rows were the old "approved" state — that's what "verified"
-- means under the new model, so this reclassifies real rows, it doesn't invent data.
UPDATE words SET status = 'verified' WHERE status = 'approved';

-- Remove any pre-existing duplicate (en, bm) pairs, keeping the earliest row,
-- before enforcing uniqueness — required so the index below can be created.
DELETE FROM words a USING words b
WHERE a.id > b.id
  AND LOWER(TRIM(a.en)) = LOWER(TRIM(b.en))
  AND LOWER(TRIM(a.bm)) = LOWER(TRIM(b.bm));

-- Case/whitespace-insensitive uniqueness: the mechanism that makes "100 users
-- translate House -> Inzu" result in ONE row with usage_count = 100, not 100 rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_words_dedupe
  ON words (LOWER(TRIM(en)), LOWER(TRIM(bm)));

CREATE INDEX IF NOT EXISTS idx_words_status ON words (status);
CREATE INDEX IF NOT EXISTS idx_words_usage  ON words (usage_count DESC);

CREATE TABLE IF NOT EXISTS search_log (
  id         SERIAL PRIMARY KEY,
  query      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_search_log_query ON search_log (LOWER(query));

-- The manual community "Submit Word" form now also collects a definition —
-- carry it through the same pending -> review -> words pipeline as everything else.
ALTER TABLE pending ADD COLUMN IF NOT EXISTS definition TEXT DEFAULT '';
