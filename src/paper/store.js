const {readFileSync}=require("node:fs");
const {randomUUID,randomBytes,createHash}=require("node:crypto");
const {Pool}=require("pg");
const {limits}=require("./config");
const hash=value=>createHash("sha256").update(value).digest("hex");
const fault=(status,message)=>Object.assign(Error(message),{status});
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
      const result=await evaluate(row.ledger);
      if(!result.ok)return {...view(row),...result};
      row.ledger.auto=false;
      if(Buffer.byteLength(JSON.stringify(row.ledger))>limits.maxLedgerBytes)throw fault(409,"Paper account storage limit reached.");
      row.revision=Number(row.revision)+1;
      await client.query("UPDATE paper_accounts SET ledger=$2,revision=$3 WHERE user_id=$1",[userId,row.ledger,row.revision]);
      await client.query("INSERT INTO paper_requests(user_id,request_id,fingerprint,created_at,sequence,result) VALUES($1,$2,$3,$4,$5,$6)",[userId,input.requestId,fingerprint,at,row.revision,result]);
      // The watermark also rejects expired receipts after eviction, including after reset.
      const removed=await client.query("DELETE FROM paper_requests WHERE user_id=$1 AND sequence <= $2 RETURNING created_at",[userId,row.revision-limits.receipts]);
      if(removed.rows.length)await client.query("UPDATE paper_accounts SET replay_before=GREATEST(replay_before,$2) WHERE user_id=$1",[userId,Math.max(...removed.rows.map(r=>Number(r.created_at)))]);
      return {...view(row),...result};
    });
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
  return {init,ensureAccount,read,command,createSession,session,logout,flow,consumeFlow,close:()=>pool.end()};
}
module.exports={createStore,hash,fault};
