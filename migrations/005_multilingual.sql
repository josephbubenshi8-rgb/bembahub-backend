-- Migration 005: Multilingual dictionary upgrade (7 Zambian languages + English).
--
-- WHAT THIS DOES (additive only — no table is dropped, no row is deleted,
-- every existing Bemba entry keeps working exactly as before):
--
-- 1. Adds source_lang/target_lang to `words`, defaulting existing rows to
--    'eng'/'bem' — that's what every current row already is, so this is a
--    correct backfill, not a guess. `en`/`bm` keep their column names (a
--    rename would touch every existing query for no functional benefit) but
--    now mean "source_text"/"translated_text" for ANY language pair, not
--    just English-Bemba. Documented clearly in README.
-- 2. Adds unique_contributors, confidence_score, high_confidence, updated_at.
-- 3. Replaces the old (en,bm) uniqueness index with one scoped per language
--    pair — required by spec #18 ("English->Bemba and English->Nyanja are
--    completely separate entries", and more generally so the SAME phrase in
--    two different target languages never collides).
-- 4. Adds word_contributors — a join table recording which authenticated
--    user contributed to which word, which is what makes unique_contributors
--    a REAL count instead of a copy of usage_count. Anonymous/guest usage
--    still increments usage_count but can't add a unique contributor, since
--    there's no way to verify an anonymous request is a genuinely different
--    person (documented limitation, not silently faked).
-- 5. Adds dictionary_reports for the "Report translation" feature.
--
-- Safe to run more than once — every step is idempotent.

ALTER TABLE words ADD COLUMN IF NOT EXISTS source_lang        TEXT NOT NULL DEFAULT 'eng';
ALTER TABLE words ADD COLUMN IF NOT EXISTS target_lang        TEXT NOT NULL DEFAULT 'bem';
ALTER TABLE words ADD COLUMN IF NOT EXISTS unique_contributors INTEGER NOT NULL DEFAULT 0;
ALTER TABLE words ADD COLUMN IF NOT EXISTS confidence_score   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE words ADD COLUMN IF NOT EXISTS high_confidence    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE words ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT now();

-- Every existing row (from before this migration) is an English<->Bemba pair —
-- this backfill states a known fact, it does not invent language data.
UPDATE words SET source_lang = 'eng', target_lang = 'bem'
  WHERE source_lang = 'eng' AND target_lang = 'bem'; -- no-op guard; matches the column defaults

-- Give verified entries a baseline confidence so they don't read as "0% sure"
-- when they were, in fact, curated/approved before this scoring system existed.
UPDATE words SET confidence_score = 100 WHERE status = 'verified' AND confidence_score = 0;

-- The old global (en,bm) unique index doesn't account for language pairs —
-- drop and replace with one scoped to (source_lang, target_lang, en, bm).
DROP INDEX IF EXISTS idx_words_dedupe;
CREATE UNIQUE INDEX IF NOT EXISTS idx_words_dedupe_lang
  ON words (source_lang, target_lang, LOWER(TRIM(en)), LOWER(TRIM(bm)));

CREATE INDEX IF NOT EXISTS idx_words_lang_pair ON words (source_lang, target_lang);
CREATE INDEX IF NOT EXISTS idx_words_high_confidence ON words (high_confidence) WHERE high_confidence = true;

CREATE TABLE IF NOT EXISTS word_contributors (
  id         SERIAL PRIMARY KEY,
  word_id    INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(word_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_word_contributors_word ON word_contributors (word_id);

CREATE TABLE IF NOT EXISTS dictionary_reports (
  id         SERIAL PRIMARY KEY,
  word_id    INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason     TEXT NOT NULL, -- incorrect | wrong_language | spelling | offensive | duplicate | other
  status     TEXT NOT NULL DEFAULT 'open', -- open | reviewed
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dictionary_reports_word ON dictionary_reports (word_id, status);

-- Community "Submit Word" contributions should be language-aware too.
ALTER TABLE pending ADD COLUMN IF NOT EXISTS source_lang TEXT NOT NULL DEFAULT 'eng';
ALTER TABLE pending ADD COLUMN IF NOT EXISTS target_lang TEXT NOT NULL DEFAULT 'bem';

