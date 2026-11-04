import fs from "node:fs";
import assert from "node:assert/strict";
import {
  pool,
  initSchema,
  findVerifiedWordMatch,
  findVerifiedWordMatches,
  findWordMatch,
  findTranslationMemory,
  recordTranslationMemory,
} from "../db.js";

async function main() {
  await initSchema();

  const migrationFiles = fs.readdirSync("migrations").filter((name) => name.endsWith(".sql"));
  const { rows: appliedBefore } = await pool.query("SELECT COUNT(*)::int AS n FROM schema_migrations");
  assert.equal(appliedBefore[0].n, migrationFiles.length, "every migration should be recorded after first startup");

  // These rows deliberately share en/bm text but belong to different language
  // pairs. The legacy migration must not collapse valid multilingual entries.
  await pool.query(
    "INSERT INTO words (en,bm,source_lang,target_lang,status,contrib) " +
    "VALUES ($1,$2,'eng','bem','verified','migration-test'), ($1,$2,'eng','nya','verified','migration-test')",
    ["BembaHub migration safety sample", "Same translation"]
  );

  const legacyMigration = fs.readFileSync("migrations/004_dictionary_growth.sql", "utf8");
  await pool.query(legacyMigration);

  const { rows: retained } = await pool.query(
    "SELECT id, target_lang FROM words WHERE en=$1 AND bm=$2 ORDER BY target_lang",
    ["BembaHub migration safety sample", "Same translation"]
  );
  assert.deepEqual(retained.map((row) => row.target_lang), ["bem", "nya"],
    "migration 004 must retain identical text pairs from different language pairs");

  // Batch lookup used by the long-text dictionary-first translator.
  const batchPhrase = "BembaHub batch dictionary regression";
  try {
    await pool.query(
      "INSERT INTO words (en,bm,source_lang,target_lang,status,contrib) " +
      "VALUES ($1,'Icibemba A','eng','bem','verified','batch-lookup-test'), " +
      "($2,'Icibemba B','eng','bem','verified','batch-lookup-test')",
      ["knownalpha", "knownbeta"]
    );
    const batch = await findVerifiedWordMatches(
      ["knownalpha", "unknownword", "knownbeta", "knownalpha"],
      "eng",
      "bem"
    );
    assert.equal(batch.knownalpha?.translation, "Icibemba A");
    assert.equal(batch.knownbeta?.translation, "Icibemba B");
    assert.equal(batch.unknownword, undefined,
      "unknown words must be left for AI rather than fabricated dictionary hits");
  } finally {
    await pool.query("DELETE FROM words WHERE contrib='batch-lookup-test'");
  }

  // Regression test: exact verified dictionary entries must outrank stale AI
  // translation memory, and a later AI save must not overwrite that trusted value.
  const priorityPhrase = "BembaHub verified priority regression sample";
  const priorityKey = priorityPhrase.toLowerCase();
  try {
    await pool.query(
      "INSERT INTO words (en,bm,source_lang,target_lang,status,contrib) " +
      "VALUES ($1,'Verified translation','eng','bem','verified','translation-priority-test'), " +
      "($1,'Old unverified translation','eng','bem','unverified','translation-priority-test')",
      [priorityPhrase]
    );

    const verified = await findVerifiedWordMatch(priorityPhrase, "eng", "bem");
    assert.equal(verified?.translation, "Verified translation",
      "the exact verified dictionary entry should be found separately");

    const preferred = await findWordMatch(priorityPhrase, "eng", "bem");
    assert.equal(preferred?.translation, "Verified translation",
      "normal dictionary lookup should prefer the verified entry");

    const cachedOnly = await findWordMatch(priorityPhrase, "eng", "bem", { skipVerified: true });
    assert.equal(cachedOnly?.translation, "Old unverified translation",
      "skipVerified should expose only the unverified cached candidate");

    await recordTranslationMemory({
      sourceText: priorityPhrase,
      targetText: "Stale AI translation",
      sourceLang: "eng",
      targetLang: "bem",
      source: "ai",
      userId: null,
    });
    await recordTranslationMemory({
      sourceText: priorityPhrase,
      targetText: "Verified translation",
      sourceLang: "eng",
      targetLang: "bem",
      source: "dictionary",
      userId: null,
    });
    await recordTranslationMemory({
      sourceText: priorityPhrase,
      targetText: "Later AI translation",
      sourceLang: "eng",
      targetLang: "bem",
      source: "ai",
      userId: null,
    });

    const memory = await findTranslationMemory(priorityPhrase, "eng", "bem");
    assert.equal(memory?.translation, "Verified translation",
      "verified dictionary output should replace stale memory and resist later AI overwrites");

    const { rows: storedMemory } = await pool.query(
      "SELECT target_text, source FROM translation_memory WHERE source_lang='eng' AND target_lang='bem' AND source_text_key=$1",
      [priorityKey]
    );
    assert.equal(storedMemory[0]?.target_text, "Verified translation");
    assert.equal(storedMemory[0]?.source, "dictionary");
  } finally {
    await pool.query(
      "DELETE FROM translation_memory WHERE source_lang='eng' AND target_lang='bem' AND source_text_key=$1",
      [priorityKey]
    );
    await pool.query(
      "DELETE FROM words WHERE en=$1 AND contrib='translation-priority-test'",
      [priorityPhrase]
    );
  }

  await initSchema();
  const { rows: appliedAfter } = await pool.query("SELECT COUNT(*)::int AS n FROM schema_migrations");
  assert.equal(appliedAfter[0].n, migrationFiles.length, "a second startup must not re-run or duplicate migration records");

  const { rows: retainedAfterRestart } = await pool.query(
    "SELECT target_lang FROM words WHERE en=$1 AND bm=$2 ORDER BY target_lang",
    ["BembaHub migration safety sample", "Same translation"]
  );
  assert.deepEqual(retainedAfterRestart.map((row) => row.target_lang), ["bem", "nya"],
    "multilingual rows must remain after a second startup");

  console.log("Database tests passed: first boot, multilingual deduplication safety, verified-dictionary priority, translation-memory protection, and repeat startup.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
