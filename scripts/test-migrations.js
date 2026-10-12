import fs from "node:fs";
import assert from "node:assert/strict";
import { pool, initSchema } from "../db.js";

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

  await initSchema();
  const { rows: appliedAfter } = await pool.query("SELECT COUNT(*)::int AS n FROM schema_migrations");
  assert.equal(appliedAfter[0].n, migrationFiles.length, "a second startup must not re-run or duplicate migration records");

  const { rows: retainedAfterRestart } = await pool.query(
    "SELECT target_lang FROM words WHERE en=$1 AND bm=$2 ORDER BY target_lang",
    ["BembaHub migration safety sample", "Same translation"]
  );
  assert.deepEqual(retainedAfterRestart.map((row) => row.target_lang), ["bem", "nya"],
    "multilingual rows must remain after a second startup");

  console.log("Migration tests passed: first boot, multilingual deduplication safety, and repeat startup.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
