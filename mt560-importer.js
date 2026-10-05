import fs from "node:fs";
import readline from "node:readline";
import * as db from "./db.js";

export const MT560_DATASET = "michsethowusu/english-bemba_sentence-pairs_mt560";
export const MT560_SOURCE_URL = "https://huggingface.co/datasets/michsethowusu/english-bemba_sentence-pairs_mt560";
export const MT560_SOURCE_LICENSE = "CC-BY-4.0 — attribution required; original source is OPUS MT560.";
export const MT560_TOTAL_ROWS = 381297;
export const MT560_FILE = "data/translation/mt560-english-bemba.jsonl";
const BATCH_SIZE = 500;

function clean(v){ return String(v ?? "").replace(/\s+/g," ").trim(); }
async function job(id){ const {rows}=await db.pool.query("SELECT * FROM translation_memory_import_jobs WHERE id=$1",[id]); return rows[0]||null; }
async function patch(id,p){
  const allowed=["status","next_offset","processed_rows","memory_imported_count","dictionary_imported_count","skipped_count","error_message","started_at","completed_at"];
  const keys=Object.keys(p).filter(k=>allowed.includes(k)); if(!keys.length)return job(id);
  const values=keys.map(k=>p[k]); const set=keys.map((k,i)=>k+"=$"+(i+1)).join(", "); values.push(id);
  const {rows}=await db.pool.query("UPDATE translation_memory_import_jobs SET "+set+",updated_at=now() WHERE id=$"+values.length+" RETURNING *",values);
  return rows[0]||null;
}
async function insertMemory(items){
  if(!items.length)return 0;
  const vals=[]; const ph=[];
  items.forEach((e,i)=>{
    const n=i*6;
    vals.push("eng","bem",e.s,e.k,e.t,MT560_DATASET);
    ph.push("($"+(n+1)+",$"+(n+2)+",$"+(n+3)+",$"+(n+4)+",$"+(n+5)+",$"+(n+6)+",1,now(),now(),now())");
  });
  const q="INSERT INTO translation_memory (source_lang,target_lang,source_text,source_text_key,target_text,source,usage_count,created_at,updated_at,last_used_at) VALUES "+ph.join(",")+" ON CONFLICT (source_lang,target_lang,source_text_key) DO NOTHING";
  const r=await db.pool.query(q,vals);
  return r.rowCount||0;
}
let running=false;

export async function runMt560Job(id){
  if(running)return;
  running=true;
  let rl=null;
  try{
    let j=await job(id);
    if(!j||["completed","failed"].includes(j.status))return;
    if(!fs.existsSync(MT560_FILE)) throw new Error("MT560 local JSONL pack is missing: "+MT560_FILE);

    await patch(id,{status:"running",started_at:j.started_at||new Date().toISOString(),error_message:null});

    const resumeOffset=Number(j.next_offset||0);\n    let offset=resumeOffset, validPairCount=0, mem=Number(j.memory_imported_count||0), dict=Number(j.dictionary_imported_count||0), skip=Number(j.skipped_count||0), lineNumber=0;
    const input=fs.createReadStream(MT560_FILE,{encoding:"utf8"});
    rl=readline.createInterface({input,crlfDelay:Infinity});

    const batch=[];
    const flush=async()=>{
      if(!batch.length)return;
      mem+=await insertMemory(batch);
      const dbatch=[];
      for(const e of batch){
        const en=e.s,bm=e.t;
        if(en.length<=60&&bm.length<=60&&/^[\p{L}][\p{L}'’\-]*$/u.test(en)&&/^[\p{L}][\p{L}'’\-]*$/u.test(bm)){
          dbatch.push({en,bm,sourceLang:"eng",targetLang:"bem",cat:"MT560",pos:"word",contrib:"OPUS MT560 / Bemba",status:"unverified"});
        }
      }
      if(dbatch.length){
        const res=await db.bulkImportDictionary({entries:dbatch,sourceName:"OPUS MT560 English-Bemba Parallel Dataset",sourceUrl:MT560_SOURCE_URL,sourceLicense:MT560_SOURCE_LICENSE,importedBy:j.created_by,defaultStatus:"unverified"});
        dict+=Number(res.importedCount||0);
        skip+=Number(res.skippedCount||0);
      }
      batch.length=0;
    };

    for await(const line of rl){
      lineNumber++;
      j=await job(id);
      if(!j||["failed","paused"].includes(j.status))break;
      if(!line.trim())continue;
      let row;
      try{ row=JSON.parse(line); }catch(e){ throw new Error("Invalid MT560 JSONL at line "+lineNumber+": "+e.message); }
      const en=clean(row.eng),bm=clean(row.bem);
      if(!en||!bm||en===bm){skip++;continue;}
      batch.push({s:en,k:en.toLowerCase(),t:bm});
      offset++;
      if(batch.length>=BATCH_SIZE){
        await flush();
        await patch(id,{next_offset:offset,processed_rows:offset,memory_imported_count:mem,dictionary_imported_count:dict,skipped_count:skip});
        console.log("[MT560_PROGRESS]",JSON.stringify({id,processed:offset,total:MT560_TOTAL_ROWS,memoryImported:mem,dictionaryImported:dict,skipped:skip}));
      }
    }
    await flush();
    await patch(id,{next_offset:offset,processed_rows:offset,memory_imported_count:mem,dictionary_imported_count:dict,skipped_count:skip});

    j=await job(id);
    if(j&&j.status!=="paused"&&offset>=MT560_TOTAL_ROWS){
      await patch(id,{status:"completed",next_offset:offset,processed_rows:offset,memory_imported_count:mem,dictionary_imported_count:dict,skipped_count:skip,completed_at:new Date().toISOString()});
      await db.logActivity("MT560 English-Bemba import #"+id+" completed: "+mem.toLocaleString()+" translation pairs saved","green");
      console.log("[MT560_COMPLETE]",JSON.stringify({id,processed:offset,total:MT560_TOTAL_ROWS,memoryImported:mem,dictionaryImported:dict,skipped:skip}));
    }
  }catch(e){
    console.error("[MT560_IMPORT_FAILED]",e);
    await patch(id,{status:"failed",error_message:String(e?.message||e).slice(0,1000)}).catch(()=>{});
  }finally{
    if(rl)rl.close();
    running=false;
  }
}

export async function startMt560Job(createdBy){
  const {rows:active}=await db.pool.query("SELECT * FROM translation_memory_import_jobs WHERE status IN ('queued','running') ORDER BY id DESC LIMIT 1");
  if(active[0])return {conflict:true,job:active[0]};
  const {rows:done}=await db.pool.query("SELECT * FROM translation_memory_import_jobs WHERE status='completed' ORDER BY id DESC LIMIT 1");
  if(done[0])return {alreadyCompleted:true,conflict:false,job:done[0]};
  const {rows:created}=await db.pool.query("INSERT INTO translation_memory_import_jobs (source_name,source_url,source_license,dataset,split,total_rows,created_by,status) VALUES ($1,$2,$3,$4,'train',$5,$6,'queued') RETURNING *",["OPUS MT560 English-Bemba Parallel Dataset",MT560_SOURCE_URL,MT560_SOURCE_LICENSE,MT560_DATASET,MT560_TOTAL_ROWS,createdBy]);
  const j=created[0];
  setImmediate(()=>runMt560Job(j.id));
  return {conflict:false,job:j};
}
export async function resumeMt560JobAfterStartup(){
  const {rows}=await db.pool.query("SELECT id FROM translation_memory_import_jobs WHERE status IN ('queued','running') ORDER BY id DESC LIMIT 1");
  if(rows[0])setTimeout(()=>runMt560Job(rows[0].id),1500);
}
export async function getMt560Job(id){return job(id);}
