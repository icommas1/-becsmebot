const {Client}=require("pg");
const {verifyDatabase}=require("../src/operations/verify-storage");

async function main(){
  const connectionString=process.env.STORAGE_VERIFY_DATABASE_URL;
  if(!connectionString)throw Object.assign(Error(),{integrityCode:"verification_database_required"});
  const client=new Client({connectionString,connectionTimeoutMillis:5000,statement_timeout:15000,
    idle_in_transaction_session_timeout:60000,options:"-c default_transaction_read_only=on"});
  try{await client.connect();console.log(JSON.stringify(await verifyDatabase(client)));}
  finally{await client.end();}
}
if(require.main===module)main().catch(error=>{
  // No database messages, connection strings, account IDs, or payloads in logs.
  console.error("Storage verification failed: "+(error.integrityCode||"database_unavailable"));process.exitCode=1;
});
module.exports={main};
