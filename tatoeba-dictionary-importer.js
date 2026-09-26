import fs from "node:fs";
import readline from "node:readline";
import * as db from "./db.js";

export const TATOEBA_FILE = "data/dictionary/tatoeba-english-bemba-words.jsonl";
export const TATOEBA_SOURCE_NAME = "Tatoeba English-Bemba Word Pairs";
export const TATOEBA_SOURCE_URL = "https://tatoeba.org/";
export const TATOEBA_SOURCE_LICENSE = "CC-BY-2.0-FR — attribution required; credit Tatoeba.org and its contributors.";
const BATCH_SIZE = 500;

async function alreadyImported() {
  const { rows } = await db.pool.query(
    "SELECT COALESCE(SUM(imported_count),0)::int AS total FROM dictionary_imports WHERE source_name=$1",
    [TATOEBA_SOURCE_NAME]
  );
  return Number(rows[0]?.total || 0) > 0;
}

export async function runTatoebaDictionaryImport() {
  if (!fs.existsSync(TATOEBA_FILE)) {
    console.log("[TATOEBA_LOCAL] No generated Tatoeba word pack; skipping.");
    return { skipped: true, imported: 0 };
  }

  if (await alreadyImported()) {
    console.log("[TATOEBA_LOCAL] Word pack already imported; skipping.");
    return { skipped: true, imported: 0 };
  }

  const input = fs.createReadStream(TATOEBA_FILE, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let batch = [];
  let lineNumber = 0;
  let imported = 0;
  let skipped = 0;

  const flush = async () => {
    if (!batch.length) return;
    const result = await db.bulkImportDictionary({
      entries: batch,
      sourceName: TATOEBA_SOURCE_NAME,
      sourceUrl: TATOEBA_SOURCE_URL,
      sourceLicense: TATOEBA_SOURCE_LICENSE,
      importedBy: null,
      defaultStatus: "unverified",
    });
    imported += Number(result.importedCount || 0);
    skipped += Number(result.skippedCount || 0);
    batch = [];
    console.log("[TATOEBA_LOCAL_PROGRESS]", JSON.stringify({ lineNumber, imported, skipped }));
  };

  try {
    for await (const line of rl) {
      lineNumber++;
      if (!line.trim()) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch (err) {
        throw new Error("Invalid Tatoeba JSONL at line " + lineNumber + ": " + err.message);
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
        contrib: "Tatoeba",
        source: "tatoeba",
        status: "unverified",
      });

      if (batch.length >= BATCH_SIZE) await flush();
    }

    await flush();
    await db.logActivity(
      "Tatoeba English-Bemba dictionary import completed: " +
        imported.toLocaleString() + " new entries",
      "green"
    );
    console.log("[TATOEBA_LOCAL_COMPLETE]", JSON.stringify({
      lines: lineNumber,
      imported,
      skipped,
    }));
    return { skipped: false, imported, skippedRows: skipped };
  } finally {
    rl.close();
  }
}
