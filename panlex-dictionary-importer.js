import fs from "node:fs";
import readline from "node:readline";
import * as db from "./db.js";

export const PANLEX_FILE = "data/dictionary/panlex-english-bemba-words.jsonl";
export const PANLEX_SOURCE_NAME = "PanLex English-Bemba Lexicon";
export const PANLEX_SOURCE_URL = "https://huggingface.co/datasets/cointegrated/panlex-meanings";
export const PANLEX_SOURCE_LICENSE = "CC0-1.0 — public-domain dedication; PanLex attribution/citation requested.";
const BATCH_SIZE = 500;

async function alreadyImported() {
  const { rows } = await db.pool.query(
    "SELECT COALESCE(SUM(imported_count),0)::int AS imported, COALESCE(SUM(skipped_count),0)::int AS skipped FROM dictionary_imports WHERE source_name=$1",
    [PANLEX_SOURCE_NAME]
  );
  const recorded = Number(rows[0]?.imported || 0) + Number(rows[0]?.skipped || 0);
  if (recorded === 0) return false;

  // A previous run may have committed several batches before the process
  // stopped. Only skip the source when the recorded rows cover the whole
  // JSONL pack; otherwise restart from the beginning (bulk import is
  // idempotent) and finish the missing batches.
  const input = fs.createReadStream(PANLEX_FILE, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let totalRows = 0;
  try {
    for await (const line of rl) totalRows++;
  } finally {
    rl.close();
  }
  return recorded >= totalRows;
}

export async function runPanlexDictionaryImport() {
  if (!fs.existsSync(PANLEX_FILE)) {
    console.log("[PANLEX_LOCAL] No generated PanLex word pack; skipping.");
    return { skipped: true, imported: 0 };
  }

  if (await alreadyImported()) {
    console.log("[PANLEX_LOCAL] Word pack already imported; skipping.");
    return { skipped: true, imported: 0 };
  }

  const input = fs.createReadStream(PANLEX_FILE, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let batch = [];
  let lineNumber = 0;
  let imported = 0;
  let skipped = 0;

  const flush = async () => {
    if (!batch.length) return;
    const result = await db.bulkImportDictionary({
      entries: batch,
      sourceName: PANLEX_SOURCE_NAME,
      sourceUrl: PANLEX_SOURCE_URL,
      sourceLicense: PANLEX_SOURCE_LICENSE,
      importedBy: null,
      defaultStatus: "unverified",
    });
    imported += Number(result.importedCount || 0);
    skipped += Number(result.skippedCount || 0);
    batch = [];
    console.log("[PANLEX_LOCAL_PROGRESS]", JSON.stringify({ lineNumber, imported, skipped }));
  };

  try {
    for await (const line of rl) {
      lineNumber++;
      if (!line.trim()) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch (err) {
        throw new Error("Invalid PanLex JSONL at line " + lineNumber + ": " + err.message);
      }

      const en = String(row.eng || "").trim();
      const bm = String(row.bem || "").trim();
      if (!en || !bm) {
        skipped++;
        continue;
      }

      batch.push({
        en,
        bm,
        sourceLang: "eng",
        targetLang: "bem",
        cat: "General",
        pos: "word",
        contrib: "PanLex",
        source: "panlex",
        status: "unverified",
      });

      if (batch.length >= BATCH_SIZE) await flush();
    }

    await flush();
    await db.logActivity(
      "PanLex English-Bemba dictionary import completed: " +
      imported.toLocaleString() + " new entries",
      "green"
    );
    console.log("[PANLEX_LOCAL_COMPLETE]", JSON.stringify({
      lines: lineNumber,
      imported,
      skipped,
    }));
    return { skipped: false, imported, skippedRows: skipped };
  } finally {
    rl.close();
  }
}
