const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {createApp}=require("../../src/api/app");
const {createMarket}=require("../../src/market/market");
const {createPriceHistory}=require("../../src/market/history");
const {isValid}=require("../../src/api/validation");
const {fixtureMarket,SOL,MINTS}=require("../fixtures/market");
const {smoke}=require("../../scripts/smoke");
async function serve(t,market){const server=createApp(market).listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));t.after(()=>new Promise(r=>server.close(r)));return "http://127.0.0.1:"+server.address().port;}
test("all public response contracts and read-only smoke work against a real HTTP server",async t=>{
  const market=await fixtureMarket(),base=await serve(t,market);
  const stylesheet=await fetch(base+"/assets/dashboard.css");
  assert.equal(stylesheet.status,200);assert.match(stylesheet.headers.get("content-type"),/^text\/css/);
  for(const [route,schema]of [["/health","health"],["/api/basket","snapshot"],["/api/history","historyResponse"],["/api/search?q=FRESH","searchResponse"]]){
    const r=await fetch(base+route);assert.equal(r.status,200);assert.ok(isValid(schema,await r.json()));
  }
  const r=await fetch(base+"/api/paper/prices",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mints:[SOL,MINTS[0]]})});
  assert.equal(r.status,200);assert.ok(isValid("priceResponse",await r.json()));
  const called=[];await smoke(base,{request:(url,options)=>{called.push({url,method:options.method||"GET"});return fetch(url,options);}});
  assert.deepEqual(called.map(c=>c.method),["GET","GET","GET","GET","GET"]);
  assert.equal(called.length,5);
});
test("browser payloads preserve Radar and Signals while separating bounded chart history",async t=>{
  const market=await fixtureMarket(),full=market.snapshot(),base=await serve(t,market);
  const basketResponse=await fetch(base+"/api/basket"),basket=await basketResponse.json();
  assert.equal("trails" in basket,false);
  assert.deepEqual(basket.radar,full.radar);
  assert.deepEqual(basket.signals.map(s=>s.mint),full.signals.map(s=>s.mint));
  assert.ok(basket.signals.every(s=>Object.keys(s).sort().join(",")==="firstSeenAt,mint,multiple,observedAt,peakMultiple"));
  const history=await(await fetch(base+"/api/history")).json();
  assert.ok(isValid("historyResponse",history));
  assert.ok(Object.values(history.trails).every(points=>points.length<=120));
  const hydrated=basket.signals.map(signal=>({...basket.radar.find(row=>row.mint===signal.mint),...signal}));
  assert.deepEqual(hydrated,full.signals);
  assert.ok(Buffer.byteLength(JSON.stringify(basket))+Buffer.byteLength(JSON.stringify(history))<Buffer.byteLength(JSON.stringify(full))*2);
  const unchanged=await fetch(base+"/api/basket",{headers:{"If-None-Match":basketResponse.headers.get("etag")}});
  assert.equal(unchanged.status,304);
  const historyResponse=await fetch(base+"/api/history");
  assert.equal((await fetch(base+"/api/history",{headers:{"If-None-Match":historyResponse.headers.get("etag")}})).status,304);
});
test("ETags from a previous server instance cannot suppress changed market data after restart",async t=>{
  const markets=[];
  for(const price of [200,250]){
    const market=createMarket({request:async url=>url.startsWith("/price")?{[SOL]:{usdPrice:price}}:[{id:SOL,symbol:"SOL",usdPrice:price}]});
    await market.scan();markets.push(market);
  }
  const first=await serve(t,markets[0]),restarted=await serve(t,markets[1]);
  for(const route of ["/api/basket","/api/history"]){
    const original=await fetch(first+route);
    const response=await fetch(restarted+route,{headers:{"If-None-Match":original.headers.get("etag")}});
    assert.equal(response.status,200,route+" must invalidate the previous instance validator");
    const value=await response.json();
    if(route==="/api/basket")assert.equal(value.solUsd,250);
    else assert.equal(value.trails[SOL].at(-1)[1],250);
  }
});
test("response schema violations return 503 instead of exposing malformed data",async t=>{
  const market=await fixtureMarket();const base=await serve(t,{snapshot:market.snapshot,search:async()=>[{mint:"invalid"}],paperPrices:async()=>({[SOL]:{priceUsd:0,observedAt:Date.now()}})});
  assert.equal((await fetch(base+"/api/search?q=SOL")).status,503);
  assert.equal((await fetch(base+"/api/paper/prices",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mints:[SOL]})})).status,503);
  assert.equal((await fetch(base+"/api/paper/prices",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mints:[SOL],unknown:true})})).status,400);
});
test("a provider-facing route failure does not take down cached read-only routes",async t=>{
  const market=await fixtureMarket();
  const base=await serve(t,{snapshot:market.snapshot,search:async()=>{throw Error("provider unavailable");},paperPrices:market.paperPrices});
  const failed=await fetch(base+"/api/search?q=SOL");assert.equal(failed.status,503);
  assert.deepEqual(await failed.json(),{error:"Market data temporarily unavailable"});
  assert.equal((await fetch(base+"/health")).status,200);
  assert.equal((await fetch(base+"/api/basket")).status,200);
});
test("malformed upstream feeds retain their actual prior data and timestamp",async()=>{
  let invalid=false;
  const market=createMarket({request:async url=>url.startsWith("/price")?{[SOL]:{usdPrice:200}}:invalid?{bad:true}:[{id:SOL,usdPrice:200}]});
  await market.scan();const first=market.snapshot();invalid=true;await market.scan();const second=market.snapshot();
  assert.equal(second.radar[0].priceUsd,200);
  assert.equal(second.radar[0].observedAt,first.radar[0].observedAt);
  assert.match(second.lastError,/Invalid upstreamTokens/);
  assert.ok(isValid("snapshot",second));
});
test("omitted provider prices are cached as unavailable and duplicate mint jobs are coalesced",async()=>{
  let calls=0;const market=createMarket({request:async()=>{calls++;await new Promise(r=>setImmediate(r));return {};}});
  const [a,b]=await Promise.all([market.paperPrices([SOL,SOL]),market.paperPrices([SOL])]);
  assert.equal(calls,1);assert.deepEqual(a,{[SOL]:null});assert.deepEqual(a,b);
  await market.paperPrices([SOL]);assert.equal(calls,1);
});
test("explicit null provider prices degrade to unavailable without rejecting valid siblings",async()=>{
  const other=MINTS[0];
  const market=createMarket({request:async()=>({[SOL]:null,[other]:{usdPrice:"2.5",blockId:7}})});
  const result=await market.paperPrices([SOL,other]);
  assert.equal(result[SOL],null);assert.equal(result[other].priceUsd,2.5);assert.equal(result[other].blockId,7);
  assert.ok(Number.isInteger(result[other].observedAt));
});
test("persisted corrupt, unsorted and future points cannot become a signal baseline",()=>{
  const now=Date.now(),dir=fs.mkdtempSync(path.join(os.tmpdir(),"becs-corrupt-"));
  try{
    fs.writeFileSync(path.join(dir,"market-history.json"),JSON.stringify({[SOL]:[[now-1000,3],[now+10000,.1],[now-2000,2],[now-2000,5],[now-90000000,1]],bad:null}));
    const history=createPriceHistory({dataDir:dir,now:()=>now});
    assert.deepEqual(history.snapshot([SOL,"bad"]),{[SOL]:[[now-2000,2],[now-1000,3]]});
    history.sample([{mint:SOL,priceUsd:.1}],now+10000);
    assert.deepEqual(history.snapshot([SOL])[SOL],[[now-2000,2],[now-1000,3]]);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test("smoke rejects stale scans and accidentally enabled real trading",async t=>{
  const market=await fixtureMarket();let mode="stale";
  const project=()=>({...market.snapshot(),...(mode==="stale"?{lastScanAt:new Date(Date.now()-600000).toISOString()}:{tradingEnabled:true})});
  const base=await serve(t,{...market,snapshot:project,terminalSnapshot:project});
  await assert.rejects(smoke(base),/stale or missing/);mode="live";
  await assert.rejects(smoke(base),/Invalid snapshot data|HTTP status/);
});
test("smoke distinguishes service health from optional provider readiness",async t=>{
  const market=await fixtureMarket();
  const project=()=>{const snapshot=market.snapshot();return {...snapshot,solUsd:null,solPriceAt:null,
    feeds:Object.fromEntries(Object.entries(snapshot.feeds).map(([name,feed])=>[name,{...feed,error:"provider unavailable"}]))};};
  const degraded={...market,snapshot:project,terminalSnapshot:project};
  const base=await serve(t,degraded);
  const result=await smoke(base);assert.equal(result.marketData.degraded,true);assert.equal(result.marketData.healthyFeeds,0);
  await assert.rejects(smoke(base,{requireMarketData:true}),/feed is delayed/);
});
