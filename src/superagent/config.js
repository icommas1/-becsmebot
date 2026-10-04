const {digest}=require("../events/becs-event");

const CONTRACT_REVISION="9fb32fe01ef7b7b714c6a49ba84831adaf5ba9c0";
const limits=Object.freeze({eventPage:50,archivePage:1,pagesPerRun:4,reportPage:100,
  markMaxAgeMs:180000,radarRows:1000,matchedPurchases:1000,poolSize:2,sourcePoolSize:1,
  connectionMs:5000,statementMs:15000,queryMs:20000,idleMs:10000,transactionIdleMs:60000,
  reportConcurrent:1,reportRequestsPerMinute:30,cursorBytes:512,reportClientMs:45000});
const text=(value,max)=>typeof value==="string"&&value.length>0&&value.length<=max&&!/[\x00-\x1f]/.test(value);
const fail=code=>{throw Object.assign(Error(code),{observerCode:code});};

function observerConfig(env=process.env){
  if(env.SUPERAGENT_OBSERVER_ENABLED!=="true")return {enabled:false};
  const required=name=>{const value=env[name];if(!text(value,2048))fail("observer_configuration_required");return value;};
  const config={enabled:true,sourceId:required("SUPERAGENT_SOURCE_ID"),ownerId:required("SUPERAGENT_OWNER_ID"),
    accountId:required("SUPERAGENT_ACCOUNT_ID"),archiveStream:required("SUPERAGENT_ARCHIVE_STREAM"),
    eventDatabaseUrl:required("SUPERAGENT_EVENT_DATABASE_URL"),archiveDatabaseUrl:required("SUPERAGENT_ARCHIVE_DATABASE_URL"),
    databaseUrl:required("SUPERAGENT_DATABASE_URL"),executionMode:"paper",contractRevision:CONTRACT_REVISION};
  if(!text(config.sourceId,120)||!text(config.ownerId,160)||!text(config.accountId,160)||!text(config.archiveStream,120))
    fail("invalid_observer_scope");
  const databaseIdentity=url=>{const parsed=new URL(url);return parsed.hostname.toLowerCase()+":"+(parsed.port||"5432")+parsed.pathname;};
  for(const url of [config.databaseUrl,config.eventDatabaseUrl,config.archiveDatabaseUrl]){
    try{const parsed=new URL(url);if(!["postgres:","postgresql:"].includes(parsed.protocol)||parsed.pathname.length<2)fail("invalid_observer_database");}
    catch{fail("invalid_observer_database");}
  }
  if([config.eventDatabaseUrl,config.archiveDatabaseUrl].some(url=>databaseIdentity(url)===databaseIdentity(config.databaseUrl)))
    fail("separate_observer_database_required");
  config.scopeId=digest({sourceId:config.sourceId,ownerId:config.ownerId,accountId:config.accountId,executionMode:config.executionMode});
  return Object.freeze(config);
}
function reportConfig(env=process.env,paper={enabled:false}){
  if(env.SUPERAGENT_REPORT_ENABLED!=="true")return {enabled:false};
  if(!paper.enabled)fail("report_owner_authentication_required");
  // Reuse the ingestion scope validation without requiring ingestion credentials.
  const config=observerConfig({...env,SUPERAGENT_OBSERVER_ENABLED:"true",
    SUPERAGENT_DATABASE_URL:env.SUPERAGENT_REPORT_DATABASE_URL,
    SUPERAGENT_EVENT_DATABASE_URL:paper.databaseUrl,SUPERAGENT_ARCHIVE_DATABASE_URL:paper.databaseUrl});
  if(config.ownerId!=="github:"+paper.ownerId)fail("report_owner_configuration_mismatch");
  const {eventDatabaseUrl,archiveDatabaseUrl,...report}=config;
  return Object.freeze(report);
}
const bindingFor=config=>({sourceId:config.sourceId,ownerId:config.ownerId,accountId:config.accountId,
  executionMode:config.executionMode,archiveStream:config.archiveStream,contractRevision:config.contractRevision});
const poolOptions=()=>({max:limits.poolSize,connectionTimeoutMillis:limits.connectionMs,statement_timeout:limits.statementMs,
  query_timeout:limits.queryMs,idle_in_transaction_session_timeout:limits.transactionIdleMs,idleTimeoutMillis:limits.idleMs});
module.exports={CONTRACT_REVISION,limits,text,fail,observerConfig,reportConfig,bindingFor,poolOptions};
