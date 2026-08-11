-- BembaHub Postgres schema
-- Run automatically on server boot (see db.js -> initSchema()), safe to re-run (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  pass_hash     TEXT,
  role          TEXT NOT NULL DEFAULT 'visitor',
  pts           INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active',
  initials      TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT '#616161',
  theme         TEXT NOT NULL DEFAULT 'light',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS password_resets (
  token         TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at    TIMESTAMPTZ NOT NULL,
  used          BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS words (
  id            SERIAL PRIMARY KEY,
  en            TEXT NOT NULL,
  bm            TEXT NOT NULL,
  cat           TEXT NOT NULL DEFAULT 'General',
  pos           TEXT NOT NULL DEFAULT '',   -- part of speech
  pron          TEXT NOT NULL DEFAULT '',
  ex            TEXT NOT NULL DEFAULT '',
  synonyms      TEXT[] NOT NULL DEFAULT '{}',
  antonyms      TEXT[] NOT NULL DEFAULT '{}',
  contrib       TEXT NOT NULL DEFAULT 'System',
  status        TEXT NOT NULL DEFAULT 'approved'
);

CREATE TABLE IF NOT EXISTS pending (
  id            SERIAL PRIMARY KEY,
  type          TEXT NOT NULL,       -- 'word' | 'correction'
  en            TEXT NOT NULL,
  bm            TEXT,
  original      TEXT,
  suggested     TEXT,
  cat           TEXT,
  pos           TEXT DEFAULT '',
  pron          TEXT,
  ex            TEXT,
  synonyms      TEXT[] DEFAULT '{}',
  antonyms      TEXT[] DEFAULT '{}',
  reason        TEXT,
  by_name       TEXT NOT NULL,
  by_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS favorites (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word_id       INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, word_id)
);

CREATE TABLE IF NOT EXISTS history (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,       -- 'translation' | 'camera' | 'voice'
  input         TEXT NOT NULL,
  output        TEXT NOT NULL,
  source        TEXT DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity (
  id            SERIAL PRIMARY KEY,
  text          TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT 'green',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_words_en ON words (LOWER(en));
CREATE INDEX IF NOT EXISTS idx_words_bm ON words (LOWER(bm));
CREATE INDEX IF NOT EXISTS idx_history_user ON history (user_id, kind);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites (user_id);
