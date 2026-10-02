const {createHash}=require("node:crypto");
const {verifyEvent,digest}=require("../events/becs-event");
const {verifyArchivePayload,verifyArchiveEnvelope}=require("../archive/store");
const {eventFromRow}=require("../paper/store");
const {createLocalHashProofProvider}=require("../proof/local-hash");

const fail=code=>{throw Object.assign(Error(code),{integrityCode:code});};
const integer=value=>Number.isSafeInteger(Number(value))&&Number(value)>=0;

// No schema initialization, persisted checkpoint, or public endpoint. Every query
// reads one consistent snapshot; keyset pages remove the web endpoint's 5,000-event cap.
async function verifyDatabase(client,{pageSize=100}={}){
  if(!Number.isInteger(pageSize)||pageSize<1||pageSize>100)fail("invalid_page_size");
  const fingerprint=createHash("sha256"),proofProvider=createLocalHashProofProvider();
  const result={version:1,research:{present:false,streams:0,records:0,payloads:0},
    paper:{present:false,accounts:0,receipts:0},events:{present:false,streams:0,records:0,proofs:0,unprovedEvents:0}};
  const remember=(kind,row)=>fingerprint.update(JSON.stringify([kind,digest(row)])+"\n");
  const rows=async(sql,args=[])=>(await client.query(sql,args)).rows;
  async function present(tables){
    const flags=await rows("SELECT to_regclass(name) IS NOT NULL AS present FROM unnest($1::text[]) AS name",[tables]);
    const count=flags.filter(r=>r.present).length;
    if(count&&count!==tables.length)fail("incomplete_storage_schema");
    return count>0;
  }
  // Table/column names are fixed source-code constants, never supplied by a caller.
  async function* scan(table,key,limit=pageSize){
    let after="";
    for(;;){const page=await rows(`SELECT * FROM ${table} WHERE ${key}>$1 ORDER BY ${key} ASC LIMIT $2`,[after,limit]);
      if(!page.length)return;
      for(const row of page)yield row;
      after=page.at(-1)[key];
    }
  }
  async function countMatches(table,expected){
    if(Number((await rows(`SELECT count(*) AS n FROM ${table}`))[0].n)!==expected)fail("orphan_or_missing_records");
  }
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try{
    result.research.present=await present(["research_archive_streams","research_archive_records","research_archive_payloads"]);
    if(result.research.present){
      // One compressed payload at a time, with the runtime's bounded decompressor.
      for await(const row of scan("research_archive_payloads","payload_hash",1)){
        if(!verifyArchivePayload(row))fail("invalid_archive_payload");
        const {payload,...metadata}=row;
        remember("payload",{...metadata,storedHash:createHash("sha256").update(payload).digest("hex")});
        result.research.payloads++;
      }
      for await(const stream of scan("research_archive_streams","stream_id")){
        if(!integer(stream.head_sequence)||!integer(stream.record_count))fail("invalid_archive_head");
        let sequence=0,previous=null;
        for(;;){
          const page=await rows("SELECT r.*,p.payload_hash AS stored_payload_hash FROM research_archive_records r LEFT JOIN research_archive_payloads p ON p.payload_hash=r.payload_hash WHERE r.stream_id=$1 AND r.sequence>$2 ORDER BY r.sequence LIMIT $3",[stream.stream_id,sequence,pageSize]);
          if(!page.length)break;
          for(const row of page){
            if(Number(row.sequence)!==sequence+1||(row.previous_hash||null)!==previous||
              !row.stored_payload_hash||!verifyArchiveEnvelope(row))fail("invalid_archive_chain");
            sequence++;previous=row.record_hash;remember("record",row);result.research.records++;
          }
        }
        if(sequence!==Number(stream.head_sequence)||sequence!==Number(stream.record_count)||previous!==(stream.head_hash||null))fail("invalid_archive_head");
        remember("research_stream",stream);result.research.streams++;
      }
      await countMatches("research_archive_records",result.research.records);
    }
    result.events.present=await present(["becs_event_streams","becs_events","becs_event_proofs"]);
    if(result.events.present){
      for await(const stream of scan("becs_event_streams","stream_id")){
        if(!integer(stream.head_sequence)||!integer(stream.event_count))fail("invalid_event_head");
        let sequence=0,previous=null,proved=0,proofId="";
        for(;;){
          const page=await rows("SELECT * FROM becs_events WHERE stream_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3",[stream.stream_id,sequence,pageSize]);
          if(!page.length)break;
          for(const row of page){const event=eventFromRow(row);
            if(!verifyEvent(event,{streamId:stream.stream_id,sequence:sequence+1,previousHash:previous}))fail("invalid_event_chain");
            sequence++;previous=event.eventHash;remember("event",row);result.events.records++;
          }
        }
        if(sequence!==Number(stream.head_sequence)||sequence!==Number(stream.event_count)||previous!==(stream.head_hash||null))fail("invalid_event_head");
        // Proof IDs give every row a unique cursor, including malformed overlapping ranges.
        for(;;){
          const page=await rows("SELECT * FROM becs_event_proofs WHERE stream_id=$1 AND proof_id::text>$2 ORDER BY proof_id::text LIMIT $3",[stream.stream_id,proofId,pageSize]);
          if(!page.length)break;
          for(const row of page){
            const proof={proofId:row.proof_id,provider:row.provider,streamId:row.stream_id,firstSequence:Number(row.first_sequence),
              lastSequence:Number(row.last_sequence),eventCount:Number(row.event_count),rootHash:row.root_hash,createdAt:Number(row.created_at)};
            if(proof.provider!==proofProvider.id||!integer(proof.eventCount)||proof.eventCount<1||proof.eventCount>128||
              proof.lastSequence-proof.firstSequence+1!==proof.eventCount||proof.firstSequence<1||proof.lastSequence>sequence||
              digest(proof)!==digest(row.proof))fail("invalid_event_proof");
            const range=(await rows("SELECT * FROM becs_events WHERE stream_id=$1 AND sequence BETWEEN $2 AND $3 ORDER BY sequence LIMIT 129",
              [stream.stream_id,proof.firstSequence,proof.lastSequence])).map(eventFromRow);
            if(!proofProvider.verify(range,proof))fail("invalid_event_proof");
            remember("proof",row);result.events.proofs++;proved+=proof.eventCount;
          }
          proofId=page.at(-1).proof_id;
        }
        // Coverage is contiguous from one; count/sum alone would miss overlap plus gaps.
        const coverage=(await rows("SELECT EXISTS(SELECT 1 FROM (SELECT first_sequence,lag(last_sequence,1,0::bigint) OVER(ORDER BY first_sequence,last_sequence) AS previous_end FROM becs_event_proofs WHERE stream_id=$1) ranges WHERE first_sequence<>previous_end+1) AS invalid",[stream.stream_id]))[0];
        if(coverage.invalid||proved>sequence)fail("invalid_proof_coverage");
        result.events.unprovedEvents+=sequence-proved;remember("event_stream",stream);result.events.streams++;
      }
      await countMatches("becs_events",result.events.records);await countMatches("becs_event_proofs",result.events.proofs);
    }
    result.paper.present=await present(["paper_accounts","paper_requests"]);
    if(result.paper.present){
      for await(const row of scan("paper_accounts","user_id")){
        if(row.ledger?.account?.executionMode!=="paper"||row.ledger.account.userId!==row.user_id||row.ledger.account.accountId!==row.account_id||
          !Number.isFinite(row.ledger.cashSol)||row.ledger.cashSol<0||!integer(row.revision)||!integer(row.replay_before))fail("invalid_paper_account");
        remember("account",row);result.paper.accounts++;
        let after="";
        for(;;){
          const page=await rows("SELECT * FROM paper_requests WHERE user_id=$1 AND request_id::text>$2 ORDER BY request_id::text LIMIT $3",[row.user_id,after,pageSize]);
          if(!page.length)break;
          for(const receipt of page){
            if(!integer(receipt.sequence)||Number(receipt.sequence)>Number(row.revision)||receipt.result?.ok!==true)fail("invalid_paper_receipt");
            remember("receipt",receipt);result.paper.receipts++;
          }
          after=page.at(-1).request_id;
        }
      }
      await countMatches("paper_requests",result.paper.receipts);
    }
    if(!result.research.present&&!result.paper.present&&!result.events.present)fail("no_becs_storage_found");
    await client.query("COMMIT");
    return {...result,fingerprint:fingerprint.digest("hex")};
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}
}
module.exports={verifyDatabase};
