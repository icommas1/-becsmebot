const {Pool}=require('pg');
const {randomUUID,randomBytes,createHash,verify}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {digest,canonical}=require('../events/becs-event');
const {isValid}=require('../api/validation');
const {limits}=require('./config');
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
function createAgentRegistry(config){
  if(!config.enabled)throw Error('Agent registry disabled');
  const pool=new Pool({connectionString:config.databaseUrl,max:limits.poolSize,connectionTimeoutMillis:limits.connectionMs,
    statement_timeout:limits.statementMs,idle_in_transaction_session_timeout:limits.transactionIdleMs});
  pool.on('error',()=>{});let ready;
  const init=()=>ready||(ready=pool.query(readFileSync(require.resolve('./schema.sql'),'utf8')).catch(e=>{ready=null;throw e;}));
  function owner(user){if(user!==config.owner)fail(403,'Owner required.');}
  async function transaction(user,fn){
    owner(user);await init();if(pool.waitingCount>=limits.waitingRequests)fail(503,'Agent registry busy.');
    const c=await pool.connect();
    try{await c.query('BEGIN');const now=Number((await c.query('SELECT (extract(epoch FROM clock_timestamp())*1000)::bigint AS now')).rows[0].now);
      const result=await fn(c,now);await c.query('COMMIT');return result;
    }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
  }
  async function candidate(c,user,id,{current=true}={}){
    const row=(await c.query('SELECT * FROM agent_candidates WHERE bundle_hash=$1 AND owner_id=$2 FOR UPDATE',[id,user])).rows[0];
    if(!row)fail(404,'Candidate not found.');
    if(digest(row.bundle)!==id||current&&(row.bundle.policyHash!==config.policyHash||row.bundle.verifierHash!==config.verifierHash||row.bundle.image!==config.image))
      fail(409,'Candidate policy or integrity changed.');
    return row;
  }
  const audit=(c,user,id,kind,now,details={})=>c.query('INSERT INTO agent_audit(owner_id,bundle_hash,kind,occurred_at,details) VALUES($1,$2,$3,$4,$5)',[user,id,kind,now,details]);
  async function register(user,input){
    if(!isValid('agentCandidateRequest',input)||Buffer.byteLength(input.code)>config.policy.maxSourceBytes)fail(400,'Invalid candidate.');
    const bundle={version:1,name:input.name,code:input.code,codeHash:hash(input.code),capability:config.policy.capability,
      permissions:config.policy.permissions,policyHash:config.policyHash,verifierHash:config.verifierHash,image:config.image};
    const id=digest(bundle);
    return transaction(user,async(c,now)=>{
      await c.query('SELECT singleton FROM agent_control WHERE singleton=true FOR UPDATE');
      const prior=(await c.query('SELECT bundle_hash FROM agent_candidates WHERE bundle_hash=$1 AND owner_id=$2',[id,user])).rows[0];
      if(prior)return {bundleHash:id,status:'existing'};
      const budget=await c.query('UPDATE agent_control SET candidate_count=candidate_count+1 WHERE singleton=true AND candidate_count<$1 RETURNING candidate_count',[config.policy.maxCandidates]);
      if(!budget.rowCount)fail(409,'Candidate capacity reached.');
      await c.query('INSERT INTO agent_candidates(bundle_hash,owner_id,bundle,created_at) VALUES($1,$2,$3,$4)',[id,user,bundle,now]);
      await audit(c,user,id,'candidate.created',now);return {bundleHash:id,status:'candidate'};
    });
  }
  async function reserve(user,id){return transaction(user,async(c,now)=>{
    const row=await candidate(c,user,id);
    if(row.status!=='candidate'||row.attempts>=config.policy.maxAttemptsPerCandidate)fail(409,'Candidate evaluation budget exhausted or already reviewed.');
    const day=Math.floor(now/86400000);
    await c.query('INSERT INTO agent_daily_budgets(day,used) VALUES($1,0) ON CONFLICT DO NOTHING',[day]);
    const budget=await c.query('UPDATE agent_daily_budgets SET used=used+1 WHERE day=$1 AND used<$2 RETURNING used',[day,config.policy.maxEvaluationsPerDay]);
    if(!budget.rowCount)fail(409,'Daily evaluation budget exhausted.');
    await c.query('UPDATE agent_candidates SET attempts=attempts+1 WHERE bundle_hash=$1',[id]);
    const evaluationId=randomUUID(),nonce=randomBytes(32).toString('hex'),expiresAt=now+config.policy.reservationMs;
    await c.query('INSERT INTO agent_evaluations(evaluation_id,bundle_hash,nonce_hash,reserved_at,expires_at) VALUES($1,$2,$3,$4,$5)',[evaluationId,id,hash(nonce),now,expiresAt]);
    await audit(c,user,id,'evaluation.reserved',now,{evaluationId});
    return {bundle:row.bundle,bundleHash:id,evaluationId,nonce,reservedAt:now,expiresAt,policy:config.policy};
  });}
  async function attest(user,id,input){
    if(!isValid('agentAttestationRequest',input))fail(400,'Invalid evaluation receipt.');
    const {report,signature}=input;
    if(!verify(null,Buffer.from(JSON.stringify(canonical(report))),config.publicKey,Buffer.from(signature,'base64')))fail(403,'Evaluator signature invalid.');
    return transaction(user,async(c,now)=>{
      await candidate(c,user,id);
      const row=(await c.query('SELECT * FROM agent_evaluations WHERE evaluation_id=$1 AND bundle_hash=$2 FOR UPDATE',[report.evaluationId,id])).rows[0];
      if(!row||row.status!=='reserved'||Number(row.expires_at)<=now||row.nonce_hash!==hash(report.nonce))fail(409,'Evaluation expired or already consumed.');
      if(report.bundleHash!==id||report.policyHash!==config.policyHash||report.verifierHash!==config.verifierHash||report.image!==config.image||
        report.completedAt<Number(row.reserved_at)||report.completedAt>now+limits.clockSkewMs||now-report.completedAt>config.policy.evaluationMaxAgeMs)
        fail(409,'Evaluation does not match the reserved candidate.');
      const passed=report.isolationVerified&&report.total===config.policy.cases.length&&report.passed===report.total;
      await c.query('UPDATE agent_evaluations SET status=$2,report=$3,signature=$4 WHERE evaluation_id=$1',[report.evaluationId,passed?'passed':'failed',report,signature]);
      await audit(c,user,id,'evaluation.completed',now,{evaluationId:report.evaluationId,passed});
      return {evaluationId:report.evaluationId,status:passed?'passed':'failed'};
    });
  }
  async function passedEvaluation(c,id,evaluationId,now){
    const row=(await c.query("SELECT * FROM agent_evaluations WHERE evaluation_id=$1 AND bundle_hash=$2 AND status='passed'",[evaluationId,id])).rows[0];
    if(!row||!isValid('agentEvaluationReport',row.report)||!verify(null,Buffer.from(JSON.stringify(canonical(row.report))),config.publicKey,Buffer.from(row.signature,'base64'))||
      now-row.report.completedAt>config.policy.evaluationMaxAgeMs||row.report.policyHash!==config.policyHash||row.report.verifierHash!==config.verifierHash||
      row.report.bundleHash!==id||row.report.evaluationId!==evaluationId||hash(row.report.nonce)!==row.nonce_hash||
      row.report.completedAt<Number(row.reserved_at)||row.report.completedAt>now+limits.clockSkewMs||
      row.report.image!==config.image||!row.report.isolationVerified||row.report.total!==config.policy.cases.length||row.report.passed!==row.report.total)
      fail(409,'Fresh successful evaluation required.');
    return row;
  }
  async function approve(user,id,evaluationId){return transaction(user,async(c,now)=>{
    const row=await candidate(c,user,id);if(row.status!=='candidate')fail(409,'Candidate already reviewed.');
    await passedEvaluation(c,id,evaluationId,now);
    // Never prune replay records. A lost/expired approval needs a fresh bounded evaluation.
    if((await c.query('SELECT token_hash FROM agent_approvals WHERE evaluation_id=$1',[evaluationId])).rowCount)
      fail(409,'Approval already issued for this evaluation.');
    const token=randomBytes(32).toString('hex'),expiresAt=now+config.policy.approvalMs;
    await c.query('INSERT INTO agent_approvals(token_hash,bundle_hash,evaluation_id,expires_at) VALUES($1,$2,$3,$4)',[hash(token),id,evaluationId,expiresAt]);
    await audit(c,user,id,'promotion.approved',now,{evaluationId});return {approvalToken:token,expiresAt,evaluationId};
  });}
  async function promote(user,id,{evaluationId,approvalToken}){return transaction(user,async(c,now)=>{
    const row=await candidate(c,user,id);if(row.status!=='candidate')fail(409,'Candidate already reviewed.');
    await passedEvaluation(c,id,evaluationId,now);
    const receipt=await c.query('UPDATE agent_approvals SET consumed_at=$4 WHERE token_hash=$1 AND bundle_hash=$2 AND evaluation_id=$3 AND consumed_at IS NULL AND expires_at>$4 RETURNING token_hash',
      [hash(approvalToken),id,evaluationId,now]);
    if(!receipt.rowCount)fail(409,'Approval expired, mismatched or already consumed.');
    await c.query("UPDATE agent_candidates SET status='reviewed' WHERE bundle_hash=$1",[id]);
    await audit(c,user,id,'candidate.reviewed',now,{evaluationId});
    return {bundleHash:id,status:'reviewed',executionEnabled:false};
  });}
  async function inspect(user,id){return transaction(user,async(c)=>{
    const row=await candidate(c,user,id,{current:false});
    const evaluations=(await c.query('SELECT evaluation_id,status,reserved_at,expires_at,report FROM agent_evaluations WHERE bundle_hash=$1 ORDER BY reserved_at,evaluation_id',[id])).rows
      .map(({report,...r})=>({...r,report:report?{...report,nonce:undefined}:null}));
    const auditRows=(await c.query('SELECT sequence,kind,occurred_at,details FROM agent_audit WHERE bundle_hash=$1 AND owner_id=$2 ORDER BY sequence LIMIT 100',[id,user])).rows;
    return {bundleHash:id,bundle:row.bundle,status:row.status,attempts:row.attempts,evaluations,audit:auditRows,executionEnabled:false};
  });}
  return {register,reserve,attest,approve,promote,inspect,init,close:()=>pool.end()};
}
module.exports={createAgentRegistry};
