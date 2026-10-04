const test=require("node:test"),assert=require("node:assert/strict");
const {createApp}=require("../../src/api/app");
const {fixtureMarket}=require("../fixtures/market");
const {fixtureReport}=require("../fixtures/superagent-report");
const {reportConfig,limits}=require("../../src/superagent/config");
test("report configuration is independent, disabled by default, and bound to the authenticated owner",()=>{
  assert.deepEqual(reportConfig({}),{enabled:false});
  const env={SUPERAGENT_REPORT_ENABLED:"true",SUPERAGENT_REPORT_DATABASE_URL:"postgres://read:fixture@observer/reports",
    SUPERAGENT_SOURCE_ID:"fixture-source",SUPERAGENT_OWNER_ID:"github:123",SUPERAGENT_ACCOUNT_ID:"paper-fixture",SUPERAGENT_ARCHIVE_STREAM:"fixture-archive"};
  const paper={enabled:true,ownerId:"123",databaseUrl:"postgres://source:fixture@source/paper"};
  assert.throws(()=>reportConfig(env),/report_owner_authentication_required/);
  assert.throws(()=>reportConfig({...env,SUPERAGENT_OWNER_ID:"github:456"},paper),/report_owner_configuration_mismatch/);
  assert.throws(()=>reportConfig({...env,SUPERAGENT_REPORT_DATABASE_URL:paper.databaseUrl},paper),/separate_observer_database_required/);
  const config=reportConfig(env,paper);assert.equal(config.ownerId,"github:123");assert.equal(config.executionMode,"paper");
  assert.equal(config.eventDatabaseUrl,undefined);assert.equal(config.archiveDatabaseUrl,undefined);
});
test("HTTP report rejects unauthenticated, cross-owner/account, cross-site and client-scoped reads; errors are sanitized",async()=>{
  const config={enabled:true,ownerId:"123",origin:"https://becs.example"};let identity=null,calls=0,broken=false,invalid=false,waiting=null,entered;
  const reader={config:fixtureReport().scope,report:async cursor=>{calls++;if(waiting){entered();await waiting;}assert.equal(cursor.purchaseAfter,0);
    if(broken)throw Error("postgres://owner:secret@private/production");const report=fixtureReport();if(invalid)report.secret="never expose";return report;}};
  const store={reportIdentity:async()=>identity};
  const server=createApp(await fixtureMarket(),{config,store,reportReader:reader}).listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));
  const base="http://127.0.0.1:"+server.address().port,call=(path="/api/superagent/report",headers={})=>fetch(base+path,{headers});
  try{
    const shell=await call("/superagent");assert.equal(shell.status,200);assert.equal(shell.headers.get("cache-control"),"no-store");
    assert.equal((await shell.text()).includes("paper-fixture"),false);
    assert.deepEqual(await (await call("/api/superagent/capabilities")).json(),{enabled:true});
    assert.equal((await call()).status,401);
    identity={userId:"github:456",accountId:"paper-fixture",executionMode:"paper"};assert.equal((await call()).status,401);
    identity={userId:"github:123",accountId:"other",executionMode:"paper"};assert.equal((await call()).status,403);
    identity={userId:"github:123",accountId:"paper-fixture",executionMode:"live"};assert.equal((await call()).status,403);
    identity={userId:"github:123",accountId:"paper-fixture",executionMode:"paper"};
    assert.equal((await call(undefined,{Origin:"https://other.example"})).status,403);
    assert.equal((await call(undefined,{"Sec-Fetch-Site":"cross-site"})).status,403);
    for(const query of ["owner=github:456","accountId=other","purchaseAfter=-1","purchaseAfter=9007199254740992","purchaseAfter=1&purchaseAfter=2","outcomeAfter=null","outcomeAfter=%7B%7D"])
      assert.equal((await call("/api/superagent/report?"+query)).status,400,query);
    assert.equal(calls,0);const response=await call();assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");
    assert.deepEqual(await response.json(),fixtureReport());assert.equal(response.headers.get("access-control-allow-origin"),null);
    broken=true;assert.deepEqual(await (await call()).json(),{error:"Recorded report temporarily unavailable."});broken=false;
    invalid=true;assert.equal((await call()).status,503);invalid=false;
    let release;const started=new Promise(r=>{entered=r;});waiting=new Promise(r=>{release=r;});const first=call();await started;
    assert.equal((await call()).status,503);release();assert.equal((await first).status,200);waiting=null;
    for(let i=0;i<limits.reportRequestsPerMinute;i++)await call();assert.equal((await call()).status,429);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test("report stays disabled without its reader even when paper sign-in is enabled",async()=>{
  const server=createApp(await fixtureMarket(),{config:{enabled:true,ownerId:"123"},store:{}}).listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));
  try{const base="http://127.0.0.1:"+server.address().port;
    assert.deepEqual(await (await fetch(base+"/api/superagent/capabilities")).json(),{enabled:false});
    assert.equal((await fetch(base+"/api/superagent/report")).status,404);
  }finally{await new Promise(r=>server.close(r));}
});
