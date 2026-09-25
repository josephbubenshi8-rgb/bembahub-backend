-- Migration 011: resumable Bemba-English MT560 translation-memory import.
CREATE TABLE IF NOT EXISTS translation_memory_import_jobs (
  id BIGSERIAL PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_url TEXT,
  source_license TEXT NOT NULL,
  dataset TEXT NOT NULL,
  split TEXT NOT NULL DEFAULT 'train',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','paused')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  next_offset INTEGER NOT NULL DEFAULT 0,
  processed_rows INTEGER NOT NULL DEFAULT 0,
  memory_imported_count INTEGER NOT NULL DEFAULT 0,
  dictionary_imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_translation_memory_import_jobs_status ON translation_memory_import_jobs(status);
CREATE INDEX IF NOT EXISTS idx_translation_memory_import_jobs_created_at ON translation_memory_import_jobs(created_at DESC);
