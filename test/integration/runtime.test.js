const test=require("node:test"),assert=require("node:assert/strict");
const {once}=require("node:events");
const {mkdtempSync,rmSync}=require("node:fs");
const {tmpdir}=require("node:os"),path=require("node:path");
const {readConfig,start}=require("../../src/basket");
const {fixtureMarket}=require("../fixtures/market");

test("runtime configuration is explicit and rejects unusable ports",()=>{
  assert.throws(()=>readConfig({}),/JUPITER_API_KEY is required/);
  assert.throws(()=>readConfig({JUPITER_API_KEY:"fixture",PORT:"not-a-port"}),/PORT must be an integer/);
  assert.deepEqual(readConfig({JUPITER_API_KEY:" fixture ",PORT:"0",DATA_DIR:" /tmp/becs-test "}),
    {apiKey:"fixture",port:0,dataDir:"/tmp/becs-test"});
});

test("production runtime starts, scans and shuts down cleanly",async()=>{
  const market=await fixtureMarket();let scans=0;const originalScan=market.scan;
  market.scan=async()=>{scans++;return originalScan();};
  const logs=[],runtime=start({env:{JUPITER_API_KEY:"fixture",PORT:"0"},logger:{log:value=>logs.push(value)},marketFactory:()=>market});
  if(!runtime.server.listening)await once(runtime.server,"listening");
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(scans,1);assert.match(logs[0],/running on port \d+/);
  const response=await fetch("http://127.0.0.1:"+runtime.server.address().port+"/health");
  assert.equal(response.status,200);
  await runtime.shutdown();assert.equal(runtime.server.listening,false);
});

test("wallet intelligence polling stays disabled without a key and starts when configured",async()=>{
  const market=await fixtureMarket();let scans=0;
  const walletIntelFactory=({config})=>({
    scanMs:config.scanMs,scan:async()=>{scans++;},
    snapshot:()=>({enabled:config.enabled,updatedAt:null,lastError:null,running:false,
      providers:{nansen:{enabled:config.enabled,records:0,lastSuccessAt:null,lastError:null}},tokens:[]}),
    revision:()=>0
  });
  let runtime=start({env:{JUPITER_API_KEY:"fixture",PORT:"0"},marketFactory:()=>market,walletIntelFactory,logger:{log:()=>{}}});
  if(!runtime.server.listening)await once(runtime.server,"listening");
  await new Promise(resolve=>setImmediate(resolve));assert.equal(scans,0);await runtime.shutdown();

  runtime=start({env:{JUPITER_API_KEY:"fixture",NANSEN_API_KEY:"nansen-fixture",PORT:"0"},marketFactory:()=>market,walletIntelFactory,logger:{log:()=>{}}});
  if(!runtime.server.listening)await once(runtime.server,"listening");
  await new Promise(resolve=>setImmediate(resolve));assert.equal(scans,1);await runtime.shutdown();
});

test("paused owner archive reads retained evidence without writing or delaying public scans",async()=>{
  const market=await fixtureMarket();let scans=0,release;
  market.scan=async()=>{scans++;};
  const witness={sequence:7,occurredAt:1,capturedAt:2,recordHash:"a".repeat(64),payloadHash:"b".repeat(64),
    radarRows:3,signalRows:2,providerFeeds:1};
  const archive={retainedEvidence:()=>new Promise(resolve=>{release=()=>resolve(witness);}),close:async()=>{},
    init:()=>assert.fail("Paused reader must not initialize schemas"),record:()=>assert.fail("Paused reader must not write")};
  const runtime=start({env:{JUPITER_API_KEY:"fixture",PORT:"0",PAPER_ACCOUNTS_ENABLED:"true",RESEARCH_ARCHIVE_ENABLED:"false",
    DATABASE_URL:"postgresql://fixture:fixture@127.0.0.1:1/fixture",PUBLIC_ORIGIN:"https://becs.example",
    GITHUB_CLIENT_ID:"fixture",GITHUB_CLIENT_SECRET:"fixture",PAPER_GITHUB_USER_ID:"123"},
    marketFactory:options=>{assert.equal(options.captureResearch,false);return market;},archiveFactory:()=>archive,
    logger:{log(){},error(value){assert.fail(value);}}});
  try{
    if(!runtime.server.listening)await once(runtime.server,"listening");await runtime.ready();
    assert.equal(scans,1,"Slow storage reads must not hold up public scans");assert.ok(release);
    release();await new Promise(resolve=>setImmediate(resolve));
    const response=await fetch("http://127.0.0.1:"+runtime.server.address().port+"/health/archive");
    assert.equal(response.status,200);const status=await response.json();
    assert.equal(status.enabled,false);assert.equal(status.runtimeEvidence,null);assert.deepEqual(status.retainedEvidence,witness);
  }finally{release?.();await runtime.shutdown();}
});

test("enabled research archive commits runtime and completed scans with startup diagnostics",async()=>{
  const market=await fixtureMarket(),records=[],logs=[];
  const dataDir=mkdtempSync(path.join(tmpdir(),"becs-runtime-"));
  const {encode}=require("../../src/archive/store");
  const runtime=start({env:{JUPITER_API_KEY:"fixture",PORT:"0",DATA_DIR:dataDir,RESEARCH_ARCHIVE_ENABLED:"true",DATABASE_URL:"fixture"},
    marketFactory:()=>market,logger:{log:value=>logs.push(value),error:value=>assert.fail(value)},
    archiveFactory:()=>({record:async record=>{encode(record.payload);records.push(record);return {sequence:records.length};},close:async()=>{}})});
  try{
    if(!runtime.server.listening)await once(runtime.server,"listening");
    await runtime.ready();
    await new Promise(resolve=>setImmediate(resolve));
    await runtime.shutdown();
    assert.deepEqual(records.map(record=>record.kind),["runtime.started","market.scan"]);
    assert.ok(logs.some(line=>line==="Research archive market.scan committed sequence 2"));
    assert.ok(records[1].payload.radar.length>0);
    assert.equal(records[0].payload.configuration.paperAccountsEnabled,false);
    assert.equal(records[1].metadata.runtimeEvidence.evidenceHash,require("../../src/events/becs-event").digest(records[0].payload));
    assert.deepEqual(runtime.archiveStatus().runtimeEvidence,records[1].metadata.runtimeEvidence);
  }finally{await runtime.shutdown();rmSync(dataDir,{recursive:true,force:true});}
});

test("shutdown waits for in-flight market evidence before closing the archive",async()=>{
  const dataDir=mkdtempSync(path.join(tmpdir(),"becs-drain-")),market=await fixtureMarket();
  let release,closed=false;const records=[];
  market.scan=()=>new Promise(resolve=>{release=resolve;});
  const runtime=start({env:{JUPITER_API_KEY:"fixture",PORT:"0",DATA_DIR:dataDir,RESEARCH_ARCHIVE_ENABLED:"true",DATABASE_URL:"fixture"},
    marketFactory:()=>market,logger:{log(){},error(value){assert.fail(value);}},
    archiveFactory:()=>({record:async value=>{assert.equal(closed,false);records.push(value);return {sequence:records.length};},close:async()=>{closed=true;}})});
  try{
    if(!runtime.server.listening)await once(runtime.server,"listening");
    await runtime.ready();
    const stopping=runtime.shutdown();await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,false);
    release();await stopping;assert.equal(closed,true);assert.ok(records.some(value=>value.kind==="market.scan"));
  }finally{release?.();await runtime.shutdown();rmSync(dataDir,{recursive:true,force:true});}
});

test("archive health exposes aggregate verification state without private evidence",async()=>{
  const {createApp}=require("../../src/api/app"),{disabledStatus}=require("../../src/archive/capture");
  const market=await fixtureMarket(),state={...disabledStatus(),enabled:true,lastError:"capture_pending"};
  const server=createApp(market,undefined,undefined,()=>state).listen(0,"127.0.0.1");
  await once(server,"listening");
  try{
    const response=await fetch("http://127.0.0.1:"+server.address().port+"/health/archive");
    assert.equal(response.status,503);assert.deepEqual(await response.json(),state);
    assert.equal((await fetch("http://127.0.0.1:"+server.address().port+"/health")).status,200);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test("archive catch-up advances bounded pages promptly, backs off failures and stops with runtime",async t=>{
  const market=await fixtureMarket(),dataDir=mkdtempSync(path.join(tmpdir(),"becs-catchup-"));
  let calls=0,sequence=50,offline=false;
  t.mock.timers.enable({apis:["setTimeout"]});
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  const archive={record:async()=>({sequence:++sequence}),close:async()=>{},verify:async({afterSequence=0,limit})=>{
    calls++;assert.equal(limit,10);if(offline)throw Error("offline");
    const verified=Math.min(sequence,afterSequence+limit);
    return {valid:true,verified,complete:verified===sequence,previousHash:"a".repeat(64),target:{headSequence:sequence}};
  }};
  const runtime=start({env:{JUPITER_API_KEY:"fixture",PORT:"0",DATA_DIR:dataDir,RESEARCH_ARCHIVE_ENABLED:"true",DATABASE_URL:"fixture"},
    marketFactory:()=>market,archiveFactory:()=>archive,logger:{log(){},error(){}}});
  try{
    if(!runtime.server.listening)await once(runtime.server,"listening");
    await runtime.ready();await settle();
    const first=calls;t.mock.timers.tick(1000);await settle();assert.equal(calls,first+1);
    offline=true;t.mock.timers.tick(1000);await settle();const failed=calls;
    assert.equal(runtime.archiveStatus().lastError,"delivery_or_verification_pending");
    offline=false;t.mock.timers.tick(1000);await settle();assert.equal(calls,failed,"failure keeps ten-second backoff");
    t.mock.timers.tick(9000);await settle();assert.equal(calls,failed+1);
    for(let i=0;i<10&&!runtime.archiveStatus().verificationComplete;i++){t.mock.timers.tick(1000);await settle();}
    assert.equal(runtime.archiveStatus().verificationComplete,true);
    const caughtUp=calls;t.mock.timers.tick(1000);await settle();assert.equal(calls,caughtUp,"healthy archive returns to normal cadence");
    await runtime.shutdown();const closed=calls;t.mock.timers.tick(20000);await settle();assert.equal(calls,closed);
  }finally{await runtime.shutdown();t.mock.timers.reset();rmSync(dataDir,{recursive:true,force:true});}
});

test("production smoke verifies archive health and deployed revision using GETs only",async()=>{
  const {createApp}=require("../../src/api/app"),{disabledStatus}=require("../../src/archive/capture");
  const {smoke}=require("../../scripts/smoke"),{runtimeEvidence}=require("../../src/archive/runtime-evidence");
  const commit="a".repeat(40),provenance=await runtimeEvidence({env:{RAILWAY_GIT_COMMIT_SHA:commit},marketScanMs:60000,
    walletIntelEnabled:false,walletIntelScanMs:60000,paperAccountsEnabled:false,streamId:"test"});
  const state={...disabledStatus(),enabled:true,healthy:true,runtimeEvidence:provenance.reference};
  const server=createApp(await fixtureMarket(),undefined,undefined,()=>state,{commit}).listen(0,"127.0.0.1");
  await once(server,"listening");
  try{
    const base="http://127.0.0.1:"+server.address().port,request=(url,options)=>{
      assert.equal(options.method,undefined);assert.ok(!url.includes("/api/paper/commands"));return fetch(url,options);
    };
    const result=await smoke(base,{request,requireArchive:true,expectedCommit:commit});assert.equal(result.archive.healthy,true);
    await assert.rejects(smoke(base,{request,requireArchive:true,expectedCommit:"b".repeat(40)}),/Deployed commit/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test("paused research skips evidence capture while markets and independent release checks work",async()=>{
  const {smoke}=require("../../scripts/smoke");
  const market=await fixtureMarket(),commit="c".repeat(40);let received,scans=0,evidenceReads=0;
  const originalScan=market.scan;
  market.scan=async()=>{scans++;await originalScan();};
  market.researchSnapshot=()=>{evidenceReads++;return {};};
  const runtime=start({env:{JUPITER_API_KEY:"fixture",PORT:"0",RESEARCH_ARCHIVE_ENABLED:"false",RAILWAY_GIT_COMMIT_SHA:commit},
    marketFactory:options=>{received=options;return market;},
    archiveFactory:()=>assert.fail("Paused archive must not connect to storage"),logger:{log(){},error(value){assert.fail(value);}}});
  try{
    if(!runtime.server.listening)await once(runtime.server,"listening");
    await runtime.ready();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(scans,1);assert.equal(received.captureResearch,false);assert.equal(evidenceReads,0);
    const base="http://127.0.0.1:"+runtime.server.address().port;
    const result=await smoke(base,{archiveMode:"disabled",expectedCommit:commit});
    assert.equal(result.archive.enabled,false);assert.equal(result.release.commit,commit);
    await assert.rejects(smoke(base,{archiveMode:"disabled",expectedCommit:"d".repeat(40)}),/Deployed commit/);
    await assert.rejects(smoke(base,{archiveMode:"required"}),/Research archive is disabled/);
    await assert.rejects(smoke(base,{archiveMode:"typo"}),/archive mode/);
  }finally{await runtime.shutdown();}
});

test("disabled archive expectation rejects unexpected collection",async()=>{
  const {createApp}=require("../../src/api/app"),{disabledStatus}=require("../../src/archive/capture");
  const {smoke}=require("../../scripts/smoke");
  const state={...disabledStatus(),enabled:true,healthy:true};
  const server=createApp(await fixtureMarket(),undefined,undefined,()=>state).listen(0,"127.0.0.1");
  await once(server,"listening");
  try{await assert.rejects(smoke("http://127.0.0.1:"+server.address().port,{archiveMode:"disabled"}),/expected to be disabled/);}
  finally{await new Promise(resolve=>server.close(resolve));}
});

test("paused production smoke requires the pinned retained record without claiming full archive health",async()=>{
  const {createApp}=require("../../src/api/app"),{disabledStatus}=require("../../src/archive/capture");
  const {smoke}=require("../../scripts/smoke"),expectedRetainedRecordHash="e".repeat(64);
  const witness={sequence:4,occurredAt:1,capturedAt:2,recordHash:expectedRetainedRecordHash,payloadHash:"f".repeat(64),
    radarRows:3,signalRows:2,providerFeeds:1};
  const state={...disabledStatus(),retainedEvidence:witness},calls=[];
  const server=createApp(await fixtureMarket(),undefined,undefined,()=>state).listen(0,"127.0.0.1");
  await once(server,"listening");
  try{
    const base="http://127.0.0.1:"+server.address().port,options={archiveMode:"disabled",expectedRetainedRecordHash,
      request:(url,settings)=>{calls.push(url);assert.equal(settings.method,undefined);return fetch(url,settings);}};
    const result=await smoke(base,options);
    assert.equal(result.archive.retainedEvidence.recordHash,expectedRetainedRecordHash);
    assert.equal(result.archive.enabled,false);assert.equal(result.archive.healthy,false);
    assert.equal(result.archive.verificationComplete,false);assert.equal(calls.length,11);
    state.retainedEvidence=null;
    await assert.rejects(smoke(base,options),/Retained research evidence is missing/);
    state.retainedEvidence={...witness,recordHash:"a".repeat(64)};
    await assert.rejects(smoke(base,options),/Retained research record differs from expected witness/);
    state.retainedEvidence=null;
    await smoke(base,{archiveMode:"disabled"});
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test("smoke rejects an invalid retained-record pin before making requests",async()=>{
  const {smoke}=require("../../scripts/smoke");
  for(const pin of ["bad", "E".repeat(64), "e".repeat(63)]){
    await assert.rejects(smoke("http://127.0.0.1:1",{expectedRetainedRecordHash:pin,
      request:()=>assert.fail("Invalid pins must not reach HTTP")}),/Invalid retained record hash/);
  }
});
