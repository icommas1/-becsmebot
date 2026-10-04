const {readFileSync}=require("node:fs");
const {gunzipSync}=require("node:zlib");
const {Pool}=require("pg");
const {digest,verifyEvent}=require("../events/becs-event");
const {eventFromRow,streamForUser}=require("../paper/store");
const {verifyArchiveEnvelope,verifyArchivePayload,MAX_PAYLOAD_BYTES}=require("../archive/store");
const {limits,fail,bindingFor,poolOptions}=require("./config");
const {readReport,validateCursor}=require("./report");
const {projectEvent,observedFill,archivedMarks}=require("./evidence");

function createObserver(config){
  if(!config.enabled||!config.scopeId)fail("observer_disabled");
  const binding=bindingFor(config),options=poolOptions();
  const target=new Pool({...options,connectionString:config.databaseUrl});
  const events=new Pool({...options,max:limits.sourcePoolSize,connectionString:config.eventDatabaseUrl,options:"-c default_transaction_read_only=on"});
  const archive=new Pool({...options,max:limits.sourcePoolSize,connectionString:config.archiveDatabaseUrl,options:"-c default_transaction_read_only=on"});
  for(const pool of [target,events,archive])pool.on("error",()=>{});
  let ready;
  function init(){return ready||(ready=transaction(target,async client=>{
    // Coordinate first startup across processes as well as subsequent scope work.
    await client.query("SELECT pg_advisory_xact_lock(622103)");
    await client.query(readFileSync(require.resolve("./schema.sql"),"utf8"));
  }).catch(error=>{ready=null;throw error;}));}
  async function transaction(pool,fn,{readOnly=false}={}){
    const client=await pool.connect();let broken=false;
    try{
      await client.query(readOnly?"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY":"BEGIN");
      const result=await fn(client);await client.query("COMMIT");return result;
    }catch(error){try{await client.query("ROLLBACK");}catch{broken=true;}throw error;}
    finally{client.release(broken);}
  }
  function checkHead(head,after,hash){
    if(!Number.isSafeInteger(head.sequence)||head.sequence<after||head.count!==head.sequence||
      (head.sequence===0?head.hash!==null:! /^[0-9a-f]{64}$/.test(head.hash||"")))fail("invalid_source_head");
    if(head.sequence===after&&head.hash!==hash)fail("source_anchor_changed");
  }
  async function eventPage(state){
    return transaction(events,async client=>{
      const account=(await client.query("SELECT account_id FROM paper_accounts WHERE user_id=$1",[config.ownerId])).rows[0];
      if(account?.account_id!==config.accountId)fail("source_owner_account_mismatch");
      const streamId=streamForUser(config.ownerId),after=Number(state.event_sequence);
      const row=(await client.query("SELECT * FROM becs_event_streams WHERE stream_id=$1",[streamId])).rows[0];
      const head={sequence:Number(row?.head_sequence||0),hash:row?.head_hash??null,count:Number(row?.event_count||0)};
      checkHead(head,after,state.event_hash);
      if(after){
        const anchor=(await client.query("SELECT * FROM becs_events WHERE stream_id=$1 AND sequence=$2",[streamId,after])).rows[0];
        const event=anchor&&eventFromRow(anchor);
        if(!event||event.eventHash!==state.event_hash||!verifyEvent(event,{previousHash:event.previousHash}))fail("source_anchor_changed");
      }
      const rows=(await client.query("SELECT * FROM becs_events WHERE stream_id=$1 AND sequence>$2 AND sequence<=$3 ORDER BY sequence LIMIT $4",
        [streamId,after,head.sequence,limits.eventPage])).rows.map(eventFromRow);
      let sequence=after,previousHash=state.event_hash;
      for(const event of rows){
        if(!verifyEvent(event,{streamId,sequence:++sequence,previousHash}))fail("event_chain_invalid");
        previousHash=event.eventHash;
      }
      if(sequence===head.sequence?previousHash!==head.hash:rows.length!==limits.eventPage)fail("event_chain_incomplete");
      return {rows,head,sequence,hash:previousHash};
    },{readOnly:true});
  }
  async function archivePage(state){
    return transaction(archive,async client=>{
      const after=Number(state.archive_sequence);
      const row=(await client.query("SELECT * FROM research_archive_streams WHERE stream_id=$1",[config.archiveStream])).rows[0];
      // An absent archive is a missing prerequisite, never an empty verified archive.
      if(!row)fail("archive_stream_unavailable");
      const head={sequence:Number(row.head_sequence),hash:row.head_hash??null,count:Number(row.record_count)};
      checkHead(head,after,state.archive_hash);
      if(after){
        const anchor=(await client.query("SELECT * FROM research_archive_records WHERE stream_id=$1 AND sequence=$2",[config.archiveStream,after])).rows[0];
        if(!anchor||anchor.record_hash!==state.archive_hash||!verifyArchiveEnvelope(anchor))fail("source_anchor_changed");
      }
      const rows=(await client.query(`SELECT r.*,p.encoding,p.payload,p.compressed_bytes,p.uncompressed_bytes
        FROM research_archive_records r LEFT JOIN research_archive_payloads p ON p.payload_hash=r.payload_hash
        WHERE r.stream_id=$1 AND r.sequence>$2 AND r.sequence<=$3 ORDER BY r.sequence LIMIT $4`,
        [config.archiveStream,after,head.sequence,limits.archivePage])).rows;
      let sequence=after,previousHash=state.archive_hash;
      for(const record of rows){
        if(Number(record.sequence)!==++sequence||(record.previous_hash??null)!==previousHash||
          !verifyArchiveEnvelope(record)||!verifyArchivePayload(record))fail("archive_chain_invalid");
        previousHash=record.record_hash;
      }
      if(sequence===head.sequence?previousHash!==head.hash:rows.length!==limits.archivePage)fail("archive_chain_incomplete");
      return {rows,head,sequence,hash:previousHash};
    },{readOnly:true});
  }
  async function append(client,table,fields,values,keys){
    // Names are internal constants; all external values remain SQL parameters.
    const params=values.map((_,i)=>"$"+(i+1));
    await client.query(`INSERT INTO ${table}(${fields.join(",")}) VALUES(${params.join(",")}) ON CONFLICT DO NOTHING`,values);
    const keyIndices=keys.map(key=>fields.indexOf(key));
    const existing=(await client.query(`SELECT evidence FROM ${table} WHERE ${keys.map((key,i)=>key+"=$"+(i+1)).join(" AND ")}`,
      keyIndices.map(i=>values[i]))).rows[0];
    if(!existing||digest(existing.evidence)!==digest(values[fields.indexOf("evidence")]))fail("observer_duplicate_conflict");
  }
  async function outcome(client,purchase,key,at,evidence){
    await append(client,"superagent_observer_outcomes",["scope_id","purchase_id","source_key","observed_at","evidence"],
      [config.scopeId,purchase.purchase_id,key,at,evidence],["scope_id","purchase_id","source_key"]);
  }
  async function ingestEvents(client,page){
    let purchases=0;
    for(const event of page.rows){
      const evidence=projectEvent(event,config);if(!evidence)continue;
      await append(client,"superagent_observer_events",["scope_id","event_id","sequence","event_hash","evidence"],
        [config.scopeId,event.eventId,event.sequence,event.eventHash,evidence],["scope_id","event_id"]);
      if(event.type!=="paper.execution.completed")continue;
      const context=(await client.query("SELECT evidence FROM superagent_observer_events WHERE scope_id=$1 AND sequence BETWEEN $2 AND $3 ORDER BY sequence",
        [config.scopeId,event.sequence-2,event.sequence-1])).rows.map(row=>row.evidence);
      const fill=observedFill(context[0],context[1],evidence);
      if(fill.side==="buy"){
        await append(client,"superagent_observer_purchases",["scope_id","purchase_id","sequence","asset","occurred_at","evidence"],
          [config.scopeId,event.eventId,event.sequence,fill.asset,fill.occurredAt,fill],["scope_id","purchase_id"]);
        purchases++;
      }else{
        const purchase=(await client.query(`SELECT p.* FROM superagent_observer_purchases p WHERE p.scope_id=$1 AND p.asset=$2 AND p.sequence<$3
          AND NOT EXISTS (SELECT 1 FROM superagent_observer_events e WHERE e.scope_id=p.scope_id AND e.sequence>p.sequence AND e.sequence<$3
          AND e.evidence->>'type'='paper.wallet.reset') ORDER BY p.sequence DESC LIMIT 1`,[config.scopeId,fill.asset,event.sequence])).rows[0];
        if(purchase&&fill.occurredAt>=Number(purchase.occurred_at))await outcome(client,purchase,"event:"+event.eventId,fill.occurredAt,fill);
      }
    }
    await client.query(`UPDATE superagent_observer_scopes SET event_sequence=$2,event_hash=$3,
      archive_sequence=CASE WHEN $4 THEN 0 ELSE archive_sequence END,archive_hash=CASE WHEN $4 THEN NULL ELSE archive_hash END WHERE scope_id=$1`,
      [config.scopeId,page.sequence,page.hash,purchases>0]);
    return purchases;
  }
  async function ingestArchive(client,page){
    for(const record of page.rows){
      if(record.kind!=="market.scan"||record.source!=="market")continue;
      const payload=JSON.parse(gunzipSync(record.payload,{maxOutputLength:MAX_PAYLOAD_BYTES}).toString("utf8"));
      const reference={kind:"research-archive",streamId:record.stream_id,sequence:Number(record.sequence),recordId:record.record_id,
        recordHash:record.record_hash,payloadHash:record.payload_hash,metadataHash:record.metadata_hash,schemaVersion:Number(record.schema_version)};
      const marks=new Map(archivedMarks(payload,record).map(mark=>[mark.asset,mark]));
      const purchases=(await client.query("SELECT * FROM superagent_observer_purchases WHERE scope_id=$1 AND asset=ANY($2::text[]) LIMIT $3",
        [config.scopeId,[...marks.keys()],limits.matchedPurchases+1])).rows;
      if(purchases.length>limits.matchedPurchases)fail("observer_mark_capacity_reached");
      for(const purchase of purchases){
          const mark=marks.get(purchase.asset);if(mark.observedAt<=Number(purchase.occurred_at))continue;
          const priceRatio=mark.priceUsd/purchase.evidence.fill.fillPrice;
          if(!Number.isFinite(priceRatio)||priceRatio<=0)fail("invalid_observed_price_ratio");
          await outcome(client,purchase,"archive:"+record.record_id,mark.observedAt,{classification:"observed-market-mark",executionMode:"paper",
            ...mark,priceRatioToEntry:priceRatio,meaning:"sampled market price versus recorded fill; not a realized return or executable quote",
            reference});
      }
    }
    await client.query("UPDATE superagent_observer_scopes SET archive_sequence=$2,archive_hash=$3 WHERE scope_id=$1",
      [config.scopeId,page.sequence,page.hash]);
  }
  async function step(){
    await init();
    return transaction(target,async client=>{
      await client.query("INSERT INTO superagent_observer_scopes(scope_id,binding) VALUES($1,$2) ON CONFLICT DO NOTHING",[config.scopeId,binding]);
      const state=(await client.query("SELECT * FROM superagent_observer_scopes WHERE scope_id=$1 FOR UPDATE",[config.scopeId])).rows[0];
      if(digest(state.binding)!==digest(binding))fail("observer_scope_binding_changed");
      const eventBatch=await eventPage(state);
      if(eventBatch.rows.length){
        const purchases=await ingestEvents(client,eventBatch);
        return {phase:"events",verifiedThrough:eventBatch.sequence,sourceHead:eventBatch.head.sequence,purchases,complete:false};
      }
      // Finish event backfill first. Each newly discovered purchase replays archive history
      // from genesis, so a delayed execution cannot miss already checkpointed market marks.
      const archiveBatch=await archivePage(state);await ingestArchive(client,archiveBatch);
      return {phase:"archive",verifiedThrough:archiveBatch.sequence,sourceHead:archiveBatch.head.sequence,
        complete:archiveBatch.sequence===archiveBatch.head.sequence};
    });
  }
  async function run(){
    const pages=[];
    for(let i=0;i<limits.pagesPerRun;i++){const page=await step();pages.push(page);if(page.complete)break;}
    return {complete:pages.at(-1).complete,pages};
  }
  async function report(cursor={}){
    validateCursor(cursor);await init();
    return transaction(target,client=>readReport(client,config,cursor),{readOnly:true});
  }
  return {init,step,run,report,close:()=>Promise.all([target.end(),events.end(),archive.end()])};
}
module.exports={createObserver};
