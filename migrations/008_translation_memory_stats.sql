-- Migration 008: Translation-memory reporting foundation.
-- Gives the dashboard/admin tools one stable query surface for measuring
-- saved translations and how often they are reused.

CREATE OR REPLACE VIEW translation_memory_stats AS
SELECT
  COUNT(*)::int AS saved_entries,
  COALESCE(SUM(usage_count), 0)::int AS total_reuses,
  COUNT(DISTINCT source_lang || '->' || target_lang)::int AS language_pairs,
  COALESCE(MAX(updated_at), now()) AS last_updated_at
FROM translation_memory;

CREATE OR REPLACE VIEW translation_memory_by_pair AS
SELECT
  source_lang,
  target_lang,
  COUNT(*)::int AS saved_entries,
  COALESCE(SUM(usage_count), 0)::int AS total_reuses,
  MAX(last_used_at) AS last_used_at
FROM translation_memory
GROUP BY source_lang, target_lang;
