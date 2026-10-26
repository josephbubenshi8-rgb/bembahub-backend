import fs from "node:fs";
import assert from "node:assert/strict";
import { pool, initSchema, findDictionaryHints } from "../db.js";

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

  // Exercise the real database-backed dictionary-hint function, not a copied
  // implementation. These rows are deliberately unique to this test.
  const hintRows = [
    ["zzyzx bembahub phrase 2026", "test target phrase"],
    ["zzyzx", "test target"],
    ["qwertybembahub unrelated term", "unrelated target"],
  ];
  for (const [en, bm] of hintRows) {
    await pool.query(
      "INSERT INTO words (en,bm,source_lang,target_lang,status,contrib) VALUES ($1,$2,'eng','bem','verified','dictionary-hint-test')",
      [en, bm]
    );
  }

  const phraseHints = await findDictionaryHints(
    "Please bring zzyzx bembahub phrase 2026, because zzyzx is ready.",
    "eng",
    "bem"
  );
  assert(phraseHints.some((hint) => hint.source.toLowerCase() === "zzyzx bembahub phrase 2026"),
    "a complete multiword phrase should be found");
  assert(phraseHints.some((hint) => hint.source.toLowerCase() === "zzyzx"),
    "the shorter term should also be found when present as a separate word");
  assert(
    phraseHints.findIndex((hint) => hint.source.toLowerCase() === "drinking water") <
      phraseHints.findIndex((hint) => hint.source.toLowerCase() === "water"),
    "longer phrases should be returned before their shorter contained terms"
  );
  assert(!phraseHints.some((hint) => hint.source.toLowerCase() === "qwertybembahub unrelated term"),
    "unrelated dictionary terms must not be included");

  const boundaryHints = await findDictionaryHints("The zzyzxmelon is ripe.", "eng", "bem");
  assert(!boundaryHints.some((hint) => hint.source.toLowerCase() === "water"),
    "zzyzx must not match inside the unrelated word zzyzxmelon");

  const unsupportedPairHints = await findDictionaryHints("water", "eng", "nya");
  assert.deepEqual(unsupportedPairHints, [],
    "English-to-Nyanja must not receive hints from the English-Bemba-only dictionary");

  const emptyHints = await findDictionaryHints("   ", "eng", "bem");
  assert.deepEqual(emptyHints, [], "empty source text should return no hints");

  // Confirm a second application startup does not rerun migrations or damage
  // multilingual dictionary entries.
  await initSchema();
  const { rows: appliedAfter } = await pool.query("SELECT COUNT(*)::int AS n FROM schema_migrations");
  assert.equal(appliedAfter[0].n, migrationFiles.length,
    "a second startup must not re-run or duplicate migration records");
  const { rows: retainedAfterRestart } = await pool.query(
    "SELECT target_lang FROM words WHERE en=$1 AND bm=$2 ORDER BY target_lang",
    ["BembaHub migration safety sample", "Same translation"]
  );
  assert.deepEqual(retainedAfterRestart.map((row) => row.target_lang), ["bem", "nya"],
    "multilingual rows must remain after a second startup");

  console.log("Migration tests passed: boot, multilingual deduplication, repeat startup.");
  console.log("Dictionary hint tests passed: phrases, word boundaries, unrelated terms, unsupported pairs, empty input.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Clean up only the unique test rows created above.
    await pool.query("DELETE FROM words WHERE contrib='dictionary-hint-test'").catch(() => {});
    await pool.query("DELETE FROM words WHERE en='BembaHub migration safety sample' AND contrib='migration-test'").catch(() => {});
    await pool.end();
  });
