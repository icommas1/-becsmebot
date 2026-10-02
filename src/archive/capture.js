const fs=require("node:fs"),path=require("node:path");
const {randomUUID}=require("node:crypto");
const {gunzipSync}=require("node:zlib");
const {encode,MAX_PAYLOAD_BYTES}=require("./store");

const MAX_QUEUE_BYTES=128*1024*1024;
const disabledStatus=()=>({runtimeEvidence:null,enabled:false,healthy:false,pendingRecords:0,pendingBytes:0,blockedRecords:0,
  lastCommittedAt:null,lastMarketAt:null,lastSequence:0,verifiedThrough:0,verificationComplete:false,failures:0,lastError:null});

// This spool is delivery state, not a second permanent archive. Delete only after a DB receipt.
function createArchiveCapture({archive,dataDir,logger=console,now=Date.now,maxBytes=MAX_QUEUE_BYTES}){
  const directory=path.join(dataDir,"research-pending",archive.streamId||"becs-research-v1");
  const state={...disabledStatus(),enabled:true},blocked=new Map();
  let busy=null,verification=null,integrityFailed=false;
  const kinds=new Set();
  function fail(code){state.failures++;state.lastError=code;logger.error?.("Research archive: "+code);}
  function files(){
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
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
  function canCapture(){return blocked.size===0;}
  async function verifyPage(){
    if(!archive.verify||integrityFailed)return;
    const result=await archive.verify(verification?{
      afterSequence:verification.verified,previousHash:verification.previousHash,
      target:verification.complete?null:verification.target,limit:10
    }:{limit:10});
    if(!result.valid){integrityFailed=true;fail("integrity_failed");return;}
    verification=result;state.verifiedThrough=result.verified;state.verificationComplete=result.complete;
  }
  function flush(){
    if(busy)return busy;
    busy=(async()=>{
      try{
        // Drain existing durable work first so a capacity block can recover.
        for(const name of files().slice(0,10)){
          const file=path.join(directory,name);
          const record=JSON.parse(gunzipSync(fs.readFileSync(file),{maxOutputLength:MAX_PAYLOAD_BYTES}).toString("utf8"));
          const receipt=await archive.record(record);
          state.lastCommittedAt=now();state.lastSequence=Math.max(state.lastSequence,receipt.sequence);
          if(record.kind==="market.scan")state.lastMarketAt=Math.max(state.lastMarketAt||0,Number(new Date(record.occurredAt)));
          if(!kinds.has(record.kind)){kinds.add(record.kind);logger.log("Research archive "+record.kind+" committed sequence "+receipt.sequence);}
          fs.unlinkSync(file);syncDirectory();
        }
        for(const [source,record] of blocked){persist(record);blocked.delete(source);}
        files();await verifyPage();
        if(!integrityFailed)state.lastError=null;
      }catch{fail("delivery_or_verification_pending");}
    })().finally(()=>{busy=null;});
    return busy;
  }
  function status(){
    const fresh=state.lastMarketAt!==null&&now()-state.lastMarketAt<300000;
    return {...state,blockedRecords:blocked.size,healthy:fresh&&!state.lastError&&!blocked.size&&
      state.pendingRecords===0&&state.verificationComplete&&state.verifiedThrough>=state.lastSequence};
  }
  return {capture,flush,canCapture,status};
}
module.exports={createArchiveCapture,disabledStatus,MAX_QUEUE_BYTES};
