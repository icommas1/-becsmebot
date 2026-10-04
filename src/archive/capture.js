const fs=require("node:fs"),path=require("node:path");
const {randomUUID}=require("node:crypto");
const {gunzipSync}=require("node:zlib");
const {encode,MAX_PAYLOAD_BYTES}=require("./store");
const {archiveLimits}=require("./config");

const MAX_QUEUE_BYTES=archiveLimits.queueBytes;
const disabledStatus=()=>({runtimeEvidence:null,retainedEvidence:null,enabled:false,healthy:false,pendingRecords:0,pendingBytes:0,blockedRecords:0,
  lastCommittedAt:null,lastMarketAt:null,lastSequence:0,verifiedThrough:0,verificationComplete:false,failures:0,lastError:null});

// This spool is delivery state, not a second permanent archive. Delete only after a DB receipt.
function createArchiveCapture({archive,dataDir,logger=console,now=Date.now,maxBytes=MAX_QUEUE_BYTES}){
  const directory=path.join(dataDir,"research-pending",archive.streamId||"becs-research-v1");
  const state={...disabledStatus(),enabled:true},blocked=new Map();
  let busy=null,verification=null,integrityFailed=false,spoolFailed=false;
  const kinds=new Set();
  function fail(code){state.failures++;state.lastError=code;logger.error?.("Research archive: "+code);}
  function files(){
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
    // A process can die after fsync but before rename. Recover complete temporary
    // records; keep incomplete/conflicting ones visible and stop collection.
    const pending=fs.readdirSync(directory).filter(name=>name.endsWith(".json.gz")||name.endsWith(".json.gz.tmp"));
    state.pendingRecords=pending.length;
    state.pendingBytes=pending.reduce((sum,name)=>sum+fs.statSync(path.join(directory,name)).size,0);
    const temporary=pending.filter(name=>name.endsWith(".json.gz.tmp"));
    if(temporary.length)spoolFailed=true;
    for(const name of temporary){
      const temp=path.join(directory,name),file=temp.slice(0,-4);
      const raw=gunzipSync(fs.readFileSync(temp),{maxOutputLength:MAX_PAYLOAD_BYTES});
      const record=JSON.parse(raw.toString("utf8"));
      if(!/^[0-9a-f-]{36}$/.test(record.recordId||"")||!name.endsWith("-"+record.recordId+".json.gz.tmp"))throw Error("Invalid pending record");
      if(fs.existsSync(file)){
        const existing=gunzipSync(fs.readFileSync(file),{maxOutputLength:MAX_PAYLOAD_BYTES});
        if(!existing.equals(raw))throw Error("Conflicting pending record");
        fs.unlinkSync(temp); // Identical durable copy remains; no evidence is discarded.
      }else fs.renameSync(temp,file);
      syncDirectory();
    }
    spoolFailed=false;
    const entries=fs.readdirSync(directory).filter(name=>name.endsWith(".json.gz")).sort();
    state.pendingRecords=entries.length;
    state.pendingBytes=entries.reduce((sum,name)=>sum+fs.statSync(path.join(directory,name)).size,0);
    return entries;
  }
  function syncDirectory(){const fd=fs.openSync(directory,"r");try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  function persist(record){
    const bytes=encode(record).compressed;files();
    if(state.pendingBytes+bytes.length>maxBytes)throw Error("queue capacity");
    const file=path.join(directory,String(now()).padStart(16,"0")+"-"+record.recordId+".json.gz");
    const temp=file+".tmp",fd=fs.openSync(temp,"w",0o600);
    try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fs.renameSync(temp,file);syncDirectory();files();
  }
  function capture(record){
    // Sources stop scanning while blocked: never replace the last unpersisted observation.
    if(blocked.has(record.source))throw Error("Archive source has pending evidence");
    const entry={...record,recordId:randomUUID(),occurredAt:record.occurredAt??now()};
    try{persist(entry);}catch{blocked.set(record.source,entry);fail("capture_pending");}
    return flush();
  }
  function canCapture(){return blocked.size===0&&!spoolFailed;}
  async function verifyPage(){
    if(!archive.verify||integrityFailed)return;
    const result=await archive.verify(verification?{
      afterSequence:verification.verified,previousHash:verification.previousHash,
      target:verification.complete?null:verification.target,limit:archiveLimits.verificationPage
    }:{limit:archiveLimits.verificationPage});
    if(!result.valid){integrityFailed=true;fail("integrity_failed");return;}
    verification=result;state.verifiedThrough=result.verified;state.verificationComplete=result.complete;
  }
  function flush(){
    if(busy)return busy;
    busy=(async()=>{
      try{
        // Drain existing durable work first so a capacity block can recover.
        for(const name of files().slice(0,archiveLimits.deliveryBatch)){
          const file=path.join(directory,name);
          let record;
          try{record=JSON.parse(gunzipSync(fs.readFileSync(file),{maxOutputLength:MAX_PAYLOAD_BYTES}).toString("utf8"));}
          catch(error){spoolFailed=true;throw error;}
          const receipt=await archive.record(record);
          state.lastCommittedAt=now();state.lastSequence=Math.max(state.lastSequence,receipt.sequence);
          if(record.kind==="market.scan")state.lastMarketAt=Math.max(state.lastMarketAt||0,Number(new Date(record.occurredAt)));
          if(!kinds.has(record.kind)){kinds.add(record.kind);logger.log("Research archive "+record.kind+" committed sequence "+receipt.sequence);}
          fs.unlinkSync(file);syncDirectory();
        }
        for(const [source,record] of blocked){persist(record);blocked.delete(source);}
        files();spoolFailed=false;await verifyPage();
        if(!state.retainedEvidence&&archive.retainedEvidence)state.retainedEvidence=await archive.retainedEvidence();
        if(!integrityFailed)state.lastError=null;
      }catch{fail("delivery_or_verification_pending");}
    })().finally(()=>{busy=null;});
    return busy;
  }
  function status(){
    const fresh=state.lastMarketAt!==null&&now()-state.lastMarketAt<archiveLimits.freshMs;
    return {...state,blockedRecords:blocked.size,healthy:fresh&&!state.lastError&&!blocked.size&&
      state.pendingRecords===0&&state.verificationComplete&&state.verifiedThrough>=state.lastSequence};
  }
  return {capture,flush,canCapture,status};
}
module.exports={createArchiveCapture,disabledStatus,MAX_QUEUE_BYTES};
