const test=require("node:test"),assert=require("node:assert/strict");
const {once}=require("node:events");
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
