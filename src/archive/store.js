const {readFileSync}=require("node:fs");
const {randomUUID}=require("node:crypto");
const {gzipSync,gunzipSync}=require("node:zlib");
const {Pool}=require("pg");
const {canonical,digest}=require("../events/becs-event");

const SCHEMA_VERSION=1;
const ENCODING="gzip-json-v1";
const MAX_PAYLOAD_BYTES=32*1024*1024;

function text(value,max){
  return typeof value==="string"&&value.length>0&&value.length<=max;
}
function atMillis(value){
  const n=typeof value==="string"?Date.parse(value):Number(value);
  if(!Number.isSafeInteger(n)||n<0)throw Error("Invalid research archive timestamp");
  return n;
}
function encode(value){
  const normalized=canonical(value);
  const json=JSON.stringify(normalized),raw=Buffer.from(json);
  if(raw.length>MAX_PAYLOAD_BYTES)throw Error("Research archive payload is too large");
  const compressed=gzipSync(raw,{level:6});
  return {normalized,hash:digest(normalized),rawBytes:raw.length,compressed};
}
function envelopeHash(value){return digest(value);}

function createResearchArchive(connectionString,{streamId="becs-research-v1",now=Date.now}={}){
  if(!connectionString)throw Error("Research archive database URL is required");
  if(!text(streamId,120))throw Error("Invalid research archive stream");
  const pool=new Pool({connectionString,max:2,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,
    statement_timeout:15000,idle_in_transaction_session_timeout:60000});
  pool.on("error",()=>{});
  let ready;
  function init(){
    return ready||(ready=pool.query(readFileSync(require.resolve("./schema.sql"),"utf8")).then(async()=>{
      await pool.query("INSERT INTO research_archive_streams(stream_id,created_at) VALUES($1,$2) ON CONFLICT(stream_id) DO NOTHING",[streamId,now()]);
    }).catch(error=>{ready=null;throw error;}));
  }
  async function record({kind,source,payload,occurredAt=now(),metadata={}}){
    if(!text(kind,120)||!text(source,120))throw Error("Invalid research archive record");
    const occurred=atMillis(occurredAt),captured=atMillis(now());
    const body=encode(payload),meta=canonical(metadata),metadataHash=digest(meta),recordId=randomUUID();
    await init();
    const client=await pool.connect();let broken=false;
    try{
      await client.query("BEGIN");
      const stream=(await client.query("SELECT head_sequence,head_hash FROM research_archive_streams WHERE stream_id=$1 FOR UPDATE",[streamId])).rows[0];
      const sequence=Number(stream.head_sequence)+1,previousHash=stream.head_hash||null;
      const envelope={schemaVersion:SCHEMA_VERSION,recordId,streamId,sequence,occurredAt:occurred,capturedAt:captured,
        kind,source,payloadHash:body.hash,metadataHash,previousHash};
      const recordHash=envelopeHash(envelope);
      await client.query(
        "INSERT INTO research_archive_payloads(payload_hash,encoding,payload,uncompressed_bytes,compressed_bytes,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(payload_hash) DO NOTHING",
        [body.hash,ENCODING,body.compressed,body.rawBytes,body.compressed.length,captured]
      );
      await client.query(
        "INSERT INTO research_archive_records(record_id,stream_id,sequence,occurred_at,captured_at,kind,source,schema_version,payload_hash,metadata,metadata_hash,previous_hash,record_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
        [recordId,streamId,sequence,occurred,captured,kind,source,SCHEMA_VERSION,body.hash,meta,metadataHash,previousHash,recordHash]
      );
      await client.query("UPDATE research_archive_streams SET head_sequence=$2,head_hash=$3,record_count=record_count+1 WHERE stream_id=$1",[streamId,sequence,recordHash]);
      await client.query("COMMIT");
      return {recordId,streamId,sequence,recordHash,payloadHash:body.hash,occurredAt:occurred,capturedAt:captured};
    }catch(error){
      try{await client.query("ROLLBACK");}catch{broken=true;}
      throw error;
    }finally{client.release(broken);}
  }
  async function stats(){
    await init();
    const {rows}=await pool.query(
      "SELECT s.stream_id,s.head_sequence,s.head_hash,s.record_count,COALESCE(sum(p.compressed_bytes),0)::bigint AS compressed_bytes,COALESCE(sum(p.uncompressed_bytes),0)::bigint AS uncompressed_bytes FROM research_archive_streams s LEFT JOIN research_archive_records r ON r.stream_id=s.stream_id LEFT JOIN research_archive_payloads p ON p.payload_hash=r.payload_hash WHERE s.stream_id=$1 GROUP BY s.stream_id,s.head_sequence,s.head_hash,s.record_count",
      [streamId]
    );
    const row=rows[0];
    return {streamId,headSequence:Number(row?.head_sequence||0),headHash:row?.head_hash||null,recordCount:Number(row?.record_count||0),
      compressedBytes:Number(row?.compressed_bytes||0),uncompressedBytes:Number(row?.uncompressed_bytes||0)};
  }
  async function verify({limit=5000}={}){
    await init();
    if(!Number.isInteger(limit)||limit<1||limit>5000)throw Error("Invalid archive verification limit");
    const {rows}=await pool.query(
      "SELECT r.*,p.encoding,p.payload FROM research_archive_records r JOIN research_archive_payloads p ON p.payload_hash=r.payload_hash WHERE r.stream_id=$1 ORDER BY r.sequence ASC LIMIT $2",
      [streamId,limit]
    );
    let previousHash=null,expected=1;
    for(const row of rows){
      if(Number(row.sequence)!==expected||(row.previous_hash||null)!==previousHash)return {valid:false,verified:expected-1,failedSequence:expected};
      if(row.encoding!==ENCODING)return {valid:false,verified:expected-1,failedSequence:expected};
      let payload;
      try{payload=JSON.parse(gunzipSync(row.payload).toString("utf8"));}catch{return {valid:false,verified:expected-1,failedSequence:expected};}
      if(digest(payload)!==row.payload_hash||digest(row.metadata)!==row.metadata_hash)return {valid:false,verified:expected-1,failedSequence:expected};
      const envelope={schemaVersion:Number(row.schema_version),recordId:row.record_id,streamId:row.stream_id,sequence:Number(row.sequence),
        occurredAt:Number(row.occurred_at),capturedAt:Number(row.captured_at),kind:row.kind,source:row.source,
        payloadHash:row.payload_hash,metadataHash:row.metadata_hash,previousHash:row.previous_hash||null};
      if(envelopeHash(envelope)!==row.record_hash)return {valid:false,verified:expected-1,failedSequence:expected};
      previousHash=row.record_hash;expected++;
    }
    const s=await stats();
    const complete=rows.length===s.recordCount;
    return {valid:complete?previousHash===s.headHash:true,complete,verified:rows.length,recordCount:s.recordCount,headHash:s.headHash};
  }
  return {init,record,stats,verify,close:()=>pool.end(),streamId};
}
module.exports={SCHEMA_VERSION,ENCODING,MAX_PAYLOAD_BYTES,encode,createResearchArchive};
