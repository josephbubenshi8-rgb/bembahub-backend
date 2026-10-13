-- Legacy dictionary rows created before language-pair fields were populated
-- use the original English (en) -> Bemba (bm) columns. Backfill only rows
-- where BOTH pair fields are missing; never overwrite an explicitly assigned
-- language pair or change verification status.
UPDATE words
SET source_lang = 'eng',
    target_lang = 'bem',
    updated_at = COALESCE(updated_at, now())
WHERE (source_lang IS NULL OR btrim(source_lang) = '')
  AND (target_lang IS NULL OR btrim(target_lang) = '')
  AND COALESCE(btrim(en), '') <> ''
  AND COALESCE(btrim(bm), '') <> '';
