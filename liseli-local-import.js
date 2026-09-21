import fs from "node:fs";
import readline from "node:readline";
import * as db from "./db.js";

const FILE = "data/dictionary/liseli-7-language.jsonl";
const SOURCE_NAME = "Liseli — Zambian Language Dataset";
const SOURCE_URL = "https://huggingface.co/datasets/GiJoeHansFranz/Liseli";
const SOURCE_LICENSE = "CC-BY-SA-4.0 — retain attribution and comply with upstream licenses.";
const LANG_MAP = {
  bemba: "bem",
  nyanja: "nya",
  tonga: "toi",
  lozi: "loz",
  luvale: "lue",
  lunda: "lun",
  kaonde: "kqn",
};
const BATCH_SIZE = 500;
const EXPECTED_ROWS = 43010;

async function alreadyImported() {
  const { rows } = await db.pool.query(
    "SELECT COALESCE(SUM(imported_count),0)::int AS total FROM dictionary_imports WHERE source_name=$1",
    [SOURCE_NAME]
  );
  return Number(rows[0]?.total || 0) >= EXPECTED_ROWS;
}

async function main() {
  if (!fs.existsSync(FILE)) {
    console.log("[LISELI_LOCAL] No generated Liseli pack yet; skipping.");
    return;
  }

  await db.initSchema();

  if (await alreadyImported()) {
    console.log("[LISELI_LOCAL] Dictionary pack already imported; skipping.");
    return;
  }

  console.log("[LISELI_LOCAL] Importing generated Liseli JSONL pack...");

  const input = fs.createReadStream(FILE, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  let batch = [];
  let lineNumber = 0;
  let imported = 0;
  let skipped = 0;

  const flush = async () => {
    if (!batch.length) return;
    const result = await db.bulkImportDictionary({
      entries: batch,
      sourceName: SOURCE_NAME,
      sourceUrl: SOURCE_URL,
      sourceLicense: SOURCE_LICENSE,
      importedBy: null,
      defaultStatus: "unverified",
    });
    imported += Number(result.importedCount || 0);
    skipped += Number(result.skippedCount || 0);
    batch = [];
    console.log("[LISELI_LOCAL_PROGRESS]", JSON.stringify({
      lines: lineNumber,
      imported,
      skipped,
    }));
  };

  try {
    for await (const line of rl) {
      lineNumber++;
      if (!line.trim()) continue;

      let row;
      try {
        row = JSON.parse(line);
      } catch (err) {
        throw new Error("Invalid JSONL at line " + lineNumber + ": " + err.message);
      }

      const target = LANG_MAP[String(row.language || "").trim().toLowerCase()];
      const english = String(row.english || "").trim();
      const translation = String(row.translation || "").trim();

      if (!target || !english || !translation) {
        skipped++;
        continue;
      }

      batch.push({
        en: english,
        bm: translation,
        sourceLang: "eng",
        targetLang: target,
        cat: "General",
        contrib: "Liseli dataset",
        source: "liseli",
        status: String(row.status || "").trim().toLowerCase() === "verified"
          ? "verified"
          : "unverified",
      });

      if (batch.length >= BATCH_SIZE) {
        await flush();
      }
    }

    await flush();

    await db.logActivity(
      "Liseli 7-language local pack imported: " +
      imported.toLocaleString() + " entries",
      "green"
    );

    console.log("[LISELI_LOCAL_COMPLETE]", JSON.stringify({
      lines: lineNumber,
      imported,
      skipped,
    }));
  } finally {
    rl.close();
    await db.pool.end();
  }
}

main().catch(async (err) => {
  console.error("[LISELI_LOCAL_FAILED]", err);
  try { await db.pool.end(); } catch (_) {}
  process.exit(1);
});
