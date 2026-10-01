// Operational limits only. Trading defaults remain in paper-wallet.mjs.
const limits=Object.freeze({receipts:500,requestAgeMs:86400000,futureSkewMs:30000,
  sessionMs:7*86400000,flowMs:600000,maxLedgerBytes:5*1024*1024,marketTimeoutMs:45000});
function paperConfig(env=process.env) {
  if(env.PAPER_ACCOUNTS_ENABLED!=="true")return {enabled:false};
  const required=["DATABASE_URL","PUBLIC_ORIGIN","GITHUB_CLIENT_ID","GITHUB_CLIENT_SECRET","PAPER_GITHUB_USER_ID"];
  for(const key of required)if(!env[key]?.trim())throw Error(key+" is required for server paper accounts");
  let origin;try{origin=new URL(env.PUBLIC_ORIGIN);}catch{throw Error("Invalid PUBLIC_ORIGIN");}
  if(origin.protocol!=="https:"||origin.origin!==env.PUBLIC_ORIGIN||!/^\d+$/.test(env.PAPER_GITHUB_USER_ID))
    throw Error("Server paper accounts require an HTTPS origin and numeric GitHub user ID");
  return {enabled:true,databaseUrl:env.DATABASE_URL,origin:origin.origin,clientId:env.GITHUB_CLIENT_ID,
    clientSecret:env.GITHUB_CLIENT_SECRET,ownerId:env.PAPER_GITHUB_USER_ID};
}
module.exports={paperConfig,limits};
