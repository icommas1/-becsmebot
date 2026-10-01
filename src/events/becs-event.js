const {createHash,randomUUID}=require("node:crypto");

const SCHEMA_VERSION=1;
const MAX_EVENT_BYTES=128*1024;
const HASH=/^[a-f0-9]{64}$/;

function canonical(value){
  if(value===null||typeof value==="string"||typeof value==="boolean")return value;
  if(typeof value==="number"){
    if(!Number.isFinite(value))throw Error("BecsEvent payload contains a non-finite number");
    return value;
  }
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==="object"){
    const out={};
    for(const key of Object.keys(value).sort()){
      if(value[key]===undefined)throw Error("BecsEvent payload contains undefined");
      out[key]=canonical(value[key]);
    }
    return out;
  }
  throw Error("BecsEvent payload contains an unsupported value");
}

function digest(value){
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function validText(value,max=120){
  return typeof value==="string"&&value.length>0&&value.length<=max;
}

function createEventDraft({type,source,payload,occurredAt=Date.now(),requestId=null,accountId=null,strategy=null}){
  const at=typeof occurredAt==="string"?Date.parse(occurredAt):Number(occurredAt);
  if(!validText(type,100)||!validText(source,100)||!Number.isSafeInteger(at)||at<0)throw Error("Invalid BecsEvent draft");
  if(requestId!=null&&!validText(requestId,100)||accountId!=null&&!validText(accountId,160))throw Error("Invalid BecsEvent metadata");
  if(strategy!=null&&(!validText(strategy.id,100)||!validText(strategy.version,100)))throw Error("Invalid BecsEvent strategy");
  const normalized=canonical(payload);
  if(Buffer.byteLength(JSON.stringify(normalized))>MAX_EVENT_BYTES)throw Error("BecsEvent payload is too large");
  return Object.freeze({type,source,payload:normalized,occurredAt:at,requestId,accountId,
    strategy:strategy?Object.freeze({id:strategy.id,version:strategy.version}):null});
}

function materializeEvent({draft,streamId,sequence,previousHash=null,eventId=randomUUID()}){
  if(!draft||!validText(streamId,220)||!Number.isSafeInteger(sequence)||sequence<1||
    previousHash!=null&&!HASH.test(previousHash)||!validText(eventId,100))throw Error("Invalid BecsEvent chain context");
  const payloadHash=digest(draft.payload);
  const envelope={
    schemaVersion:SCHEMA_VERSION,eventId,streamId,sequence,occurredAt:draft.occurredAt,
    type:draft.type,source:draft.source,payloadHash,previousHash,
    requestId:draft.requestId,accountId:draft.accountId,strategy:draft.strategy
  };
  return Object.freeze({...envelope,payload:draft.payload,eventHash:digest(envelope)});
}

function verifyEvent(event,{streamId,sequence,previousHash=null}={}){
  if(!event||event.schemaVersion!==SCHEMA_VERSION)return false;
  if(streamId!=null&&event.streamId!==streamId||sequence!=null&&event.sequence!==sequence||
    (event.previousHash??null)!==(previousHash??null))return false;
  try{
    if(event.payloadHash!==digest(event.payload))return false;
    const envelope={
      schemaVersion:event.schemaVersion,eventId:event.eventId,streamId:event.streamId,sequence:event.sequence,
      occurredAt:event.occurredAt,type:event.type,source:event.source,payloadHash:event.payloadHash,
      previousHash:event.previousHash??null,requestId:event.requestId??null,accountId:event.accountId??null,
      strategy:event.strategy??null
    };
    return HASH.test(event.eventHash||"")&&event.eventHash===digest(envelope);
  }catch{return false;}
}

function verifyChain(events,{streamId=null,startPreviousHash=null,startSequence=1}={}){
  let previous=startPreviousHash,sequence=startSequence;
  for(const event of events){
    if(!verifyEvent(event,{streamId:streamId??event.streamId,sequence,previousHash:previous}))
      return {valid:false,verified:sequence-startSequence,failedSequence:sequence,headHash:previous};
    previous=event.eventHash;sequence++;
  }
  return {valid:true,verified:events.length,failedSequence:null,headHash:previous};
}

module.exports={SCHEMA_VERSION,MAX_EVENT_BYTES,canonical,digest,createEventDraft,materializeEvent,verifyEvent,verifyChain};
