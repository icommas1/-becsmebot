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

test("enabled research archive commits runtime and completed scans with startup diagnostics",async()=>{
  const market=await fixtureMarket(),records=[],logs=[];
  const dataDir=mkdtempSync(path.join(tmpdir(),"becs-runtime-"));
  const {encode}=require("../../src/archive/store");
  const runtime=start({env:{JUPITER_API_KEY:"fixture",PORT:"0",DATA_DIR:dataDir,RESEARCH_ARCHIVE_ENABLED:"true",DATABASE_URL:"fixture"},
    marketFactory:()=>market,logger:{log:value=>logs.push(value),error:value=>assert.fail(value)},
    archiveFactory:()=>({record:async record=>{encode(record.payload);records.push(record);return {sequence:records.length};},close:async()=>{}})});
  try{
    if(!runtime.server.listening)await once(runtime.server,"listening");
    await new Promise(resolve=>setImmediate(resolve));
    await runtime.shutdown();
    assert.deepEqual(records.map(record=>record.kind),["runtime.started","market.scan"]);
    assert.ok(logs.some(line=>line==="Research archive market.scan committed sequence 2"));
    assert.ok(records[1].payload.radar.length>0);
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
