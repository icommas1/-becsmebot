const {Pool}=require("pg");
const {digest}=require("../events/becs-event");
const {limits,fail,bindingFor,poolOptions}=require("./config");
const uuid=value=>typeof value==="string"&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
function validateCursor({purchaseAfter=0,outcomeAfter=null}={}){
  if(!Number.isSafeInteger(purchaseAfter)||purchaseAfter<0||outcomeAfter!==null&&
    (!Number.isSafeInteger(outcomeAfter.at)||outcomeAfter.at<0||!uuid(outcomeAfter.purchaseId)||
      !/^(event|archive):[0-9a-f-]{36}$/i.test(outcomeAfter.sourceKey||"")))fail("invalid_report_cursor");
  return {purchaseAfter,outcomeAfter};
}
async function readReport(client,config,cursor={}){
  const {purchaseAfter,outcomeAfter}=validateCursor(cursor),binding=bindingFor(config);
  const state=(await client.query("SELECT * FROM superagent_observer_scopes WHERE scope_id=$1",[config.scopeId])).rows[0];
  if(!state||digest(state.binding)!==digest(binding))fail("observer_scope_unavailable");
  const purchases=(await client.query("SELECT purchase_id,sequence,evidence FROM superagent_observer_purchases WHERE scope_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3",
    [config.scopeId,purchaseAfter,limits.reportPage+1])).rows;
  const outcomes=(await client.query(`SELECT purchase_id,source_key,observed_at,evidence FROM superagent_observer_outcomes WHERE scope_id=$1
    AND ($2::bigint IS NULL OR (observed_at,purchase_id,source_key)>($2,$3::uuid,$4)) ORDER BY observed_at,purchase_id,source_key LIMIT $5`,
    [config.scopeId,outcomeAfter?.at??null,outcomeAfter?.purchaseId??null,outcomeAfter?.sourceKey??null,limits.reportPage+1])).rows;
  const p=purchases.slice(0,limits.reportPage),o=outcomes.slice(0,limits.reportPage),last=o.at(-1);
  return {schemaVersion:1,scope:binding,sourceVerification:"hash consistency and continuity; not external attestation",
    coverage:{eventVerifiedThrough:Number(state.event_sequence),archiveVerifiedThrough:Number(state.archive_sequence),
      currentSourceHeads:"not queried by this report",retention:"append-only; no automatic pruning",browserLocalTrades:"not ingested"},
    purchases:p.map(row=>({purchaseId:row.purchase_id,sequence:Number(row.sequence),...row.evidence})),
    outcomes:o.map(row=>({purchaseId:row.purchase_id,sourceKey:row.source_key,...row.evidence})),
    nextPurchaseAfter:purchases.length>limits.reportPage?Number(p.at(-1).sequence):null,
    nextOutcomeAfter:outcomes.length>limits.reportPage?{at:Number(last.observed_at),purchaseId:last.purchase_id,sourceKey:last.source_key}:null,
    hypotheses:[],learning:"not evaluated",predictiveImprovement:"not evaluated"};
}
function createReportReader(config){
  if(!config.enabled||!config.scopeId)fail("observer_disabled");
  // No schema initialization, ingestion or source pool is reachable from HTTP reads.
  const pool=new Pool({...poolOptions(),max:limits.reportConcurrent,connectionString:config.databaseUrl,
    options:"-c default_transaction_read_only=on"});
  pool.on("error",()=>{});
  async function report(cursor){
    validateCursor(cursor);const client=await pool.connect();let broken=false;
    try{
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result=await readReport(client,config,cursor);await client.query("COMMIT");return result;
    }catch(error){try{await client.query("ROLLBACK");}catch{broken=true;}throw error;}
    finally{client.release(broken);}
  }
  return {config,report,close:()=>pool.end()};
}
module.exports={createReportReader,readReport,validateCursor};
