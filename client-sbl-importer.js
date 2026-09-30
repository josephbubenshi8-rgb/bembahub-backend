import fs from "node:fs";
import readline from "node:readline";
import * as db from "./db.js";

export const SBL_FILE = "data/translation/client-sbl-2026.jsonl";
const BATCH_SIZE = 50;

async function alreadyImported() {
  const { rows } = await db.pool.query(
    "SELECT COUNT(*)::int AS total FROM translation_memory WHERE source=$1",
    ["client_sbl_2026"]
  );
  return Number(rows[0]?.total || 0) > 0;
}

export async function runClientSblImport() {
  if (!fs.existsSync(SBL_FILE)) {
    console.log("[SBL_LOCAL] No client SBL 2026 pack; skipping.");
    return { skipped: true, imported: 0 };
  }
  if (await alreadyImported()) {
    console.log("[SBL_LOCAL] Client SBL 2026 pack already imported; skipping.");
    return { skipped: true, imported: 0 };
  }
  const rl = readline.createInterface({input:fs.createReadStream(SBL_FILE,{encoding:"utf8"}),crlfDelay:Infinity});
  let batch=[], imported=0, skipped=0, lineNumber=0;
  const flush=async()=>{
    if(!batch.length)return;
    const values=[], ph=[];
    batch.forEach((r,i)=>{
      const n=i*6;
      values.push("eng","bem",r.eng,r.eng.toLowerCase(),r.bem,"client_sbl_2026");
      ph.push("($"+(n+1)+",$"+(n+2)+",$"+(n+3)+",$"+(n+4)+",$"+(n+5)+",$"+(n+6)+",1,now(),now(),now())");
    });
    const q="INSERT INTO translation_memory (source_lang,target_lang,source_text,source_text_key,target_text,source,usage_count,created_at,updated_at,last_used_at) VALUES "+ph.join(",")+" ON CONFLICT (source_lang,target_lang,source_text_key) DO NOTHING";
    const result=await db.pool.query(q,values);
    imported+=result.rowCount||0; batch=[];
    console.log("[SBL_LOCAL_PROGRESS]",JSON.stringify({lineNumber,imported,skipped}));
  };
  try {
    for await(const line of rl){
      lineNumber++; if(!line.trim())continue;
      let row; try{row=JSON.parse(line)}catch(err){throw new Error("Invalid SBL JSONL at line "+lineNumber+": "+err.message)}
      const en=String(row.eng||"").replace(/\s+/g," ").trim();
      const bm=String(row.bem||"").replace(/\s+/g," ").trim();
      if(!en||!bm||en===bm){skipped++;continue}
      batch.push({eng:en,bem:bm}); if(batch.length>=BATCH_SIZE)await flush();
    }
    await flush();
    await db.logActivity("Client SBL 2026 translation pack imported: "+imported.toLocaleString()+" pairs","green");
    console.log("[SBL_LOCAL_COMPLETE]",JSON.stringify({lines:lineNumber,imported,skipped}));
    return {skipped:false,imported,skippedRows:skipped};
  } finally { rl.close(); }
}
