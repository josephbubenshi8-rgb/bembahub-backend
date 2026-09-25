import * as db from "./db.js";

export const MT560_DATASET = "michsethowusu/english-bemba_sentence-pairs_mt560";
export const MT560_SOURCE_URL = "https://huggingface.co/datasets/michsethowusu/english-bemba_sentence-pairs_mt560";
export const MT560_SOURCE_LICENSE = "CC-BY-4.0 — attribution required; original source is OPUS MT560.";
export const MT560_TOTAL_ROWS = 381297;
export const MT560_FILE_URL = "https://huggingface.co/datasets/michsethowusu/english-bemba_sentence-pairs_mt560/resolve/main/data/train-00000-of-00001.parquet?download=true";

function clean(v){ return String(v ?? "").replace(/\s+/g," ").trim(); }
async function job(id){ const {rows}=await db.pool.query("SELECT * FROM translation_memory_import_jobs WHERE id=$1",[id]); return rows[0]||null; }
async function patch(id,p){
 const allowed=["status","next_offset","processed_rows","memory_imported_count","dictionary_imported_count","skipped_count","error_message","started_at","completed_at"];
 const keys=Object.keys(p).filter(k=>allowed.includes(k)); if(!keys.length)return job(id);
 const values=keys.map(k=>p[k]); const set=keys.map((k,i)=>k+"=$"+(i+1)).join(", "); values.push(id);
 const {rows}=await db.pool.query("UPDATE translation_memory_import_jobs SET "+set+",updated_at=now() WHERE id=$"+values.length+" RETURNING *",values); return rows[0]||null;
}
async function download(){
 const r=await fetch(MT560_FILE_URL,{redirect:"follow",headers:{"User-Agent":"BembaHub-MT560-Importer/1.0"},signal:AbortSignal.timeout(180000)});
 if(!r.ok)throw new Error("MT560 source HTTP "+r.status);
 const b=Buffer.from(await r.arrayBuffer());
 if(b.subarray(0,4).toString("ascii")!=="PAR1"||b.subarray(-4).toString("ascii")!=="PAR1")throw new Error("MT560 source is not valid Parquet.");
 return b;
}
async function insertMemory(items){
 if(!items.length)return 0; const vals=[]; const ph=[];
 items.forEach((e,i)=>{const n=i*6;vals.push("eng","bem",e.s,e.k,e.t,MT560_DATASET);ph.push("($"+(n+1)+",$"+(n+2)+",$"+(n+3)+",$"+(n+4)+",$"+(n+5)+",$"+(n+6)+",1,now(),now(),now())");});
 const q="INSERT INTO translation_memory (source_lang,target_lang,source_text,source_text_key,target_text,source,usage_count,created_at,updated_at,last_used_at) VALUES "+ph.join(",")+" ON CONFLICT (source_lang,target_lang,source_text_key) DO NOTHING";
 const r=await db.pool.query(q,vals); return r.rowCount||0;
}
let running=false;
export async function runMt560Job(id){
  if(running)return; running=true;
  try{
    let j=await getJob(id);
    if(!j||["completed","failed"].includes(j.status))return;
    await patch(id,{status:"running",started_at:j.started_at||new Date().toISOString(),error_message:null});
    const {asyncBufferFromUrl,parquetReadObjects}=await import("hyparquet");
    const file=await asyncBufferFromUrl({url:MT560_FILE_URL,requestInit:{headers:{"User-Agent":"BembaHub-MT560-Importer/1.0"}}});
    let offset=Number(j.next_offset||0), mem=Number(j.memory_imported_count||0), dict=Number(j.dictionary_imported_count||0), skip=Number(j.skipped_count||0);
    while(offset<MT560_TOTAL_ROWS){
      j=await getJob(id);
      if(!j||["completed","failed","paused"].includes(j.status))break;
      const end=Math.min(offset+MT560_BATCH_SIZE,MT560_TOTAL_ROWS);
      const rows=await parquetReadObjects({file,columns:["eng","bem"],rowStart:offset,rowEnd:end});
      const mb=[],dbatch=[];
      for(const row of rows){
        const en=clean(row.eng),bm=clean(row.bem);
        if(!en||!bm||en===bm){skip++;continue;}
        mb.push({s:en,t:bm,k:en.toLowerCase()});
        if(en.length<=60&&bm.length<=60&&/^[\p{L}][\p{L}'’\-]*$/u.test(en)&&/^[\p{L}][\p{L}'’\-]*$/u.test(bm)){
          dbatch.push({en,bm,sourceLang:"eng",targetLang:"bem",cat:"MT560",pos:"word",contrib:"OPUS MT560 / Bemba",status:"unverified"});
        }
      }
      mem+=await insertMemory(mb);
      if(dbatch.length){
        const res=await db.bulkImportDictionary({entries:dbatch,sourceName:"OPUS MT560 English-Bemba Parallel Dataset",sourceUrl:MT560_SOURCE_URL,sourceLicense:MT560_SOURCE_LICENSE,importedBy:j.created_by,defaultStatus:"unverified"});
        dict+=Number(res.importedCount||0); skip+=Number(res.skippedCount||0);
      }
      offset=end;
      await patch(id,{next_offset:offset,processed_rows:offset,memory_imported_count:mem,dictionary_imported_count:dict,skipped_count:skip});
      console.log("[MT560_PROGRESS]",JSON.stringify({id,processed:offset,total:MT560_TOTAL_ROWS,memoryImported:mem,dictionaryImported:dict,skipped:skip}));
    }
    j=await getJob(id);
    if(j&&j.status!=="paused"&&offset>=MT560_TOTAL_ROWS){
      await patch(id,{status:"completed",next_offset:MT560_TOTAL_ROWS,processed_rows:MT560_TOTAL_ROWS,memory_imported_count:mem,dictionary_imported_count:dict,skipped_count:skip,completed_at:new Date().toISOString()});
      await db.logActivity("MT560 English-Bemba import #"+id+" completed: "+mem.toLocaleString()+" translation pairs saved","green");
    }
  }catch(e){
    console.error("[MT560_IMPORT_FAILED]",e);
    await patch(id,{status:"failed",error_message:String(e?.message||e).slice(0,1000)}).catch(()=>{});
  }finally{running=false;}
}
export async function startMt560Job(createdBy){
 const {rows:active}=await db.pool.query("SELECT * FROM translation_memory_import_jobs WHERE status IN ('queued','running') ORDER BY id DESC LIMIT 1");
 if(active[0])return {conflict:true,job:active[0]};
 const {rows:done}=await db.pool.query("SELECT * FROM translation_memory_import_jobs WHERE status='completed' ORDER BY id DESC LIMIT 1");
 if(done[0])return {alreadyCompleted:true,conflict:false,job:done[0]};
 const {rows:created}=await db.pool.query("INSERT INTO translation_memory_import_jobs (source_name,source_url,source_license,dataset,split,total_rows,created_by,status) VALUES ($1,$2,$3,$4,'train',$5,$6,'queued') RETURNING *",["OPUS MT560 English-Bemba Parallel Dataset",MT560_SOURCE_URL,MT560_SOURCE_LICENSE,MT560_DATASET,MT560_TOTAL_ROWS,createdBy]);
 const j=created[0];setImmediate(()=>runMt560Job(j.id));return {conflict:false,job:j};
}
export async function resumeMt560JobAfterStartup(){const {rows}=await db.pool.query("SELECT id FROM translation_memory_import_jobs WHERE status IN ('queued','running') ORDER BY id DESC LIMIT 1");if(rows[0])setTimeout(()=>runMt560Job(rows[0].id),1500);}
export async function getMt560Job(id){return job(id);}
