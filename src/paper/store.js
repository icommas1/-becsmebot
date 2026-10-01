const {readFileSync}=require("node:fs");
const {randomUUID,randomBytes,createHash}=require("node:crypto");
const {Pool}=require("pg");
const {limits}=require("./config");
const {materializeEvent,verifyChain}=require("../events/becs-event");
const {createLocalHashProofProvider}=require("../proof/local-hash");

const hash=value=>createHash("sha256").update(value).digest("hex");
const fault=(status,message)=>Object.assign(Error(message),{status});
const EVENT_BATCH_SIZE=32,EVENT_BATCH_MAX=128,VERIFY_MAX_EVENTS=5000;
const proofProvider=createLocalHashProofProvider();
const streamForUser=userId=>"paper:"+hash(userId);

function createStore(connectionString) {
  const pool=new Pool({connectionString,max:4,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,
    statement_timeout:10000,idle_in_transaction_session_timeout:60000});
  pool.on("error",()=>{}); // Requests return sanitized 503s; never log credentials.
  let ready;
  function init(){return ready||(ready=pool.query(readFileSync(require.resolve("./schema.sql"),"utf8")).catch(e=>{ready=null;throw e;}));}
  async function transaction(fn) {
    await init();
    if(pool.waitingCount>=20)throw fault(503,"Paper account is busy. Retry shortly.");
    const client=await pool.connect();let broken=false;
    try{await client.query("BEGIN");const result=await fn(client);await client.query("COMMIT");return result;}
    catch(error){try{await client.query("ROLLBACK");}catch{broken=true;}throw error;}
    finally{client.release(broken);}
  }
  async function ensureAccount(userId) {
    const {freshPaper}=await import("../web/assets/js/paper-wallet.mjs");
    const ledger=freshPaper();ledger.account={userId,accountId:"paper-"+randomUUID(),executionMode:"paper"};
    await init();await pool.query("INSERT INTO paper_accounts(user_id,account_id,ledger) VALUES($1,$2,$3) ON CONFLICT(user_id) DO NOTHING",[userId,ledger.account.accountId,ledger]);
  }
  const view=row=>({paper:row.ledger,revision:Number(row.revision)});
  async function read(userId) {
    await init();const {rows}=await pool.query("SELECT ledger,revision FROM paper_accounts WHERE user_id=$1",[userId]);
    if(!rows[0])throw fault(401,"Sign in again.");return view(rows[0]);
  }

  const eventFromRow=row=>({
    schemaVersion:Number(row.schema_version),eventId:row.event_id,streamId:row.stream_id,sequence:Number(row.sequence),
    occurredAt:Number(row.occurred_at),type:row.type,source:row.source,payload:row.payload,payloadHash:row.payload_hash,
    previousHash:row.previous_hash??null,eventHash:row.event_hash,requestId:row.request_id??null,accountId:row.account_id??null,
    strategy:row.strategy_id?{id:row.strategy_id,version:row.strategy_version}:null
  });
  const publicEvent=event=>{
    const {streamId,...safe}=event;return {...safe,occurredAt:new Date(event.occurredAt).toISOString()};
  };
  const proofFromRow=row=>({
    proofId:row.proof_id,provider:row.provider,firstSequence:Number(row.first_sequence),lastSequence:Number(row.last_sequence),
    eventCount:Number(row.event_count),rootHash:row.root_hash,createdAt:new Date(Number(row.created_at)).toISOString()
  });

  async function maybeSealEvents(client,streamId,{force=false}={}) {
    const last=(await client.query("SELECT last_sequence FROM becs_event_proofs WHERE stream_id=$1 AND provider=$2 ORDER BY last_sequence DESC LIMIT 1",
      [streamId,proofProvider.id])).rows[0];
    const after=last?Number(last.last_sequence):0;
    const {rows}=await client.query("SELECT * FROM becs_events WHERE stream_id=$1 AND sequence>$2 ORDER BY sequence ASC LIMIT $3",
      [streamId,after,EVENT_BATCH_MAX]);
    if(!rows.length||!force&&rows.length<EVENT_BATCH_SIZE)return null;
    const events=rows.map(eventFromRow),proof=proofProvider.prove(events);
    await client.query(`INSERT INTO becs_event_proofs(proof_id,stream_id,first_sequence,last_sequence,event_count,root_hash,provider,proof,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[proof.proofId,streamId,proof.firstSequence,proof.lastSequence,proof.eventCount,
      proof.rootHash,proof.provider,proof,proof.createdAt]);
    return proof;
  }

  async function appendEvents(client,userId,drafts) {
    if(!Array.isArray(drafts)||!drafts.length)return [];
    const streamId=streamForUser(userId);
    await client.query("INSERT INTO becs_event_streams(stream_id) VALUES($1) ON CONFLICT(stream_id) DO NOTHING",[streamId]);
    const row=(await client.query("SELECT * FROM becs_event_streams WHERE stream_id=$1 FOR UPDATE",[streamId])).rows[0];
    let sequence=Number(row.head_sequence),previousHash=row.head_hash??null;
    const events=[];
    for(const draft of drafts){
      const event=materializeEvent({draft,streamId,sequence:++sequence,previousHash});
      await client.query(`INSERT INTO becs_events(event_id,stream_id,sequence,occurred_at,type,source,schema_version,payload,payload_hash,previous_hash,event_hash,
        request_id,account_id,strategy_id,strategy_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [event.eventId,event.streamId,event.sequence,event.occurredAt,event.type,event.source,event.schemaVersion,event.payload,event.payloadHash,
          event.previousHash,event.eventHash,event.requestId,event.accountId,event.strategy?.id??null,event.strategy?.version??null]);
      previousHash=event.eventHash;events.push(event);
    }
    await client.query("UPDATE becs_event_streams SET head_sequence=$2,head_hash=$3,event_count=event_count+$4 WHERE stream_id=$1",
      [streamId,sequence,previousHash,events.length]);
    await maybeSealEvents(client,streamId);
    return events;
  }

  async function command(userId,input,fingerprint,evaluate,now=Date.now()) {
    return transaction(async client=>{
      const {rows}=await client.query("SELECT * FROM paper_accounts WHERE user_id=$1 FOR UPDATE",[userId]);
      const row=rows[0];if(!row)throw fault(401,"Sign in again.");
      const prior=(await client.query("SELECT fingerprint,result FROM paper_requests WHERE user_id=$1 AND request_id=$2",[userId,input.requestId])).rows[0];
      if(prior){if(prior.fingerprint!==fingerprint)throw fault(409,"Request ID was already used for another action.");return {...view(row),...prior.result,replayed:true};}
      const at=Date.parse(input.createdAt);
      if(at<=Number(row.replay_before)||at<now-limits.requestAgeMs||at>now+limits.futureSkewMs)
        throw fault(409,"Paper request has expired. Refresh before placing a new action.");
      if(input.revision!=null&&input.revision!==Number(row.revision))throw fault(409,"Paper account changed on another page. Refresh and try again.");
      const evaluated=await evaluate(row.ledger),auditEvents=Array.isArray(evaluated.auditEvents)?evaluated.auditEvents:[];
      const result={...evaluated};delete result.auditEvents;
      if(!result.ok)return {...view(row),...result};
      row.ledger.auto=false;
      if(Buffer.byteLength(JSON.stringify(row.ledger))>limits.maxLedgerBytes)throw fault(409,"Paper account storage limit reached.");
      row.revision=Number(row.revision)+1;
      await client.query("UPDATE paper_accounts SET ledger=$2,revision=$3 WHERE user_id=$1",[userId,row.ledger,row.revision]);
      await client.query("INSERT INTO paper_requests(user_id,request_id,fingerprint,created_at,sequence,result) VALUES($1,$2,$3,$4,$5,$6)",[userId,input.requestId,fingerprint,at,row.revision,result]);
      await appendEvents(client,userId,auditEvents);
      // The watermark also rejects expired receipts after eviction, including after reset.
      const removed=await client.query("DELETE FROM paper_requests WHERE user_id=$1 AND sequence <= $2 RETURNING created_at",[userId,row.revision-limits.receipts]);
      if(removed.rows.length)await client.query("UPDATE paper_accounts SET replay_before=GREATEST(replay_before,$2) WHERE user_id=$1",[userId,Math.max(...removed.rows.map(r=>Number(r.created_at)))]);
      return {...view(row),...result};
    });
  }

  async function listEvents(userId,{limit=50,beforeSequence=null}={}) {
    await init();const streamId=streamForUser(userId),safeLimit=Math.min(100,Math.max(1,Number(limit)||50));
    const params=[streamId,safeLimit];let where="";
    if(beforeSequence!=null){params.splice(1,0,beforeSequence);where=" AND sequence<$2";}
    const sql=beforeSequence==null?
      "SELECT * FROM becs_events WHERE stream_id=$1 ORDER BY sequence DESC LIMIT $2":
      "SELECT * FROM becs_events WHERE stream_id=$1"+where+" ORDER BY sequence DESC LIMIT $3";
    const rows=(await pool.query(sql,params)).rows.map(eventFromRow);
    return {events:rows.map(publicEvent),nextBeforeSequence:rows.length===safeLimit?rows.at(-1).sequence:null};
  }

  async function listProofs(userId,{limit=20}={}) {
    await init();const streamId=streamForUser(userId),safeLimit=Math.min(100,Math.max(1,Number(limit)||20));
    const rows=(await pool.query("SELECT * FROM becs_event_proofs WHERE stream_id=$1 ORDER BY last_sequence DESC LIMIT $2",[streamId,safeLimit])).rows;
    return {proofs:rows.map(proofFromRow)};
  }

  async function sealEvents(userId) {
    return transaction(async client=>maybeSealEvents(client,streamForUser(userId),{force:true}));
  }

  async function verifyEvents(userId) {
    await init();const streamId=streamForUser(userId);
    const stream=(await pool.query("SELECT * FROM becs_event_streams WHERE stream_id=$1",[streamId])).rows[0];
    if(!stream)return {valid:true,complete:true,eventCount:0,verifiedEvents:0,headHash:null,metadataValid:true,
      proofProvider:proofProvider.id,proofsChecked:0,proofsValid:true,proofsComplete:true};
    const stats=(await pool.query("SELECT count(*) AS count,COALESCE(max(sequence),0) AS max_sequence FROM becs_events WHERE stream_id=$1",[streamId])).rows[0];
    const eventCount=Number(stats.count),maxSequence=Number(stats.max_sequence),metadataValid=
      eventCount===Number(stream.event_count)&&maxSequence===Number(stream.head_sequence);
    const start=Math.max(1,maxSequence-VERIFY_MAX_EVENTS+1);
    const events=(await pool.query("SELECT * FROM becs_events WHERE stream_id=$1 AND sequence>=$2 ORDER BY sequence ASC",[streamId,start])).rows.map(eventFromRow);
    const complete=start===1,chain=verifyChain(events,{streamId,startSequence:start,startPreviousHash:complete?null:events[0]?.previousHash??null});
    const headMatches=chain.headHash===(stream.head_hash??null)&&(!events.length||events.at(-1).sequence===Number(stream.head_sequence));
    const proofRows=(await pool.query("SELECT * FROM becs_event_proofs WHERE stream_id=$1 AND provider=$2 ORDER BY last_sequence ASC LIMIT 1001",
      [streamId,proofProvider.id])).rows,proofsComplete=proofRows.length<=1000;
    let proofsValid=true,proofsChecked=0;
    for(const row of proofRows.slice(0,1000)){
      const proof={...row.proof,firstSequence:Number(row.first_sequence),lastSequence:Number(row.last_sequence),eventCount:Number(row.event_count),
        rootHash:row.root_hash,provider:row.provider,streamId};
      const range=(await pool.query("SELECT * FROM becs_events WHERE stream_id=$1 AND sequence BETWEEN $2 AND $3 ORDER BY sequence ASC",
        [streamId,proof.firstSequence,proof.lastSequence])).rows.map(eventFromRow);
      proofsChecked++;if(!proofProvider.verify(range,proof)){proofsValid=false;break;}
    }
    return {valid:chain.valid&&headMatches&&metadataValid&&proofsValid,complete,eventCount,verifiedEvents:events.length,
      headHash:stream.head_hash??null,metadataValid,proofProvider:proofProvider.id,proofsChecked,proofsValid,proofsComplete};
  }

  async function createSession(userId) {
    const token=randomBytes(32).toString("base64url"),now=Date.now();
    await transaction(async c=>{
      await c.query("SELECT user_id FROM paper_accounts WHERE user_id=$1 FOR UPDATE",[userId]);
      await c.query("DELETE FROM paper_sessions WHERE expires_at <= $1",[now]);
      await c.query("DELETE FROM paper_sessions WHERE token_hash IN (SELECT token_hash FROM paper_sessions WHERE user_id=$1 ORDER BY expires_at DESC OFFSET 9)",[userId]);
      await c.query("INSERT INTO paper_sessions VALUES($1,$2,$3)",[hash(token),userId,now+limits.sessionMs]);
    });return token;
  }
  async function session(token) {
    if(!/^[\w-]{43}$/.test(token||""))return null;
    await init();return (await pool.query("SELECT user_id FROM paper_sessions WHERE token_hash=$1 AND expires_at>$2",[hash(token),Date.now()])).rows[0]?.user_id||null;
  }
  async function logout(token){await init();await pool.query("DELETE FROM paper_sessions WHERE token_hash=$1",[hash(token)]);}
  async function flow(state,verifier) {
    await transaction(async c=>{
      // Serialize pruning so the flow table remains bounded under concurrent starts.
      await c.query("SELECT pg_advisory_xact_lock(431104)");
      await c.query("DELETE FROM paper_oauth_flows WHERE expires_at<=$1",[Date.now()]);
      await c.query("DELETE FROM paper_oauth_flows WHERE state_hash IN (SELECT state_hash FROM paper_oauth_flows ORDER BY expires_at DESC OFFSET 99)");
      await c.query("INSERT INTO paper_oauth_flows VALUES($1,$2,$3)",[hash(state),verifier,Date.now()+limits.flowMs]);
    });
  }
  async function consumeFlow(state){await init();return (await pool.query("DELETE FROM paper_oauth_flows WHERE state_hash=$1 AND expires_at>$2 RETURNING verifier",[hash(state),Date.now()])).rows[0]?.verifier;}
  return {init,ensureAccount,read,command,listEvents,listProofs,sealEvents,verifyEvents,createSession,session,logout,flow,consumeFlow,close:()=>pool.end()};
}
module.exports={createStore,hash,fault,streamForUser,EVENT_BATCH_SIZE};
