const assert=require("node:assert/strict");
const {FEEDS}=require("../src/market/tokens");
const {DEX_FEEDS}=require("../src/market/dexscreener");
const feedNames=[...FEEDS,...DEX_FEEDS].map(([name])=>name);
const {assertSchema}=require("../src/api/validation");
async function smoke(base,{request=fetch,now=Date.now,maxAgeMs=300000,requireMarketData=false}={}){
  const url=new URL(base);
  if(!["https:","http:"].includes(url.protocol)||url.username||url.password||url.search||url.hash)
    throw Error("Use a plain HTTP(S) origin without credentials");
  const origin=url.origin;
  const get=async route=>{
    const response=await request(origin+route,{signal:AbortSignal.timeout(15000),redirect:"error"});
    assert.equal(response.status,200,route+" HTTP status");return response;
  };
  const health=assertSchema("health",await(await get("/health")).json());
  const snapshot=assertSchema("snapshot",await(await get("/api/basket")).json());
  const history=assertSchema("historyResponse",await(await get("/api/history")).json());
  assert.equal(health.tradingEnabled,false,"Health unexpectedly enables real trading");
  assert.equal(snapshot.tradingEnabled,false,"Snapshot unexpectedly enables real trading");
  assert.equal(health.manualSell.enabled,false,"Health unexpectedly enables manual selling");
  assert.equal(snapshot.manualSell.enabled,false,"Snapshot unexpectedly enables manual selling");
  const age=now()-Date.parse(health.lastScanAt);
  assert.ok(Number.isFinite(age)&&age>=0&&age<=maxAgeMs,"Market scan is stale or missing");
  assert.deepEqual(Object.keys(snapshot.feeds).sort(),[...feedNames].sort(),"Missing configured feeds");
  const solAge=now()-snapshot.solPriceAt;
  const solFresh=snapshot.solUsd>0&&Number.isFinite(solAge)&&solAge>=0&&solAge<=maxAgeMs;
  let healthyFeeds=0;
  for(const [name,feed]of Object.entries(snapshot.feeds)){
    const feedAge=now()-Date.parse(feed.at);
    const healthy=!feed.error&&Number.isFinite(feedAge)&&feedAge>=0&&feedAge<=maxAgeMs;
    if(healthy)healthyFeeds++;
    else if(requireMarketData)assert.fail(name+" feed is delayed");
  }
  if(requireMarketData)assert.ok(solFresh,"SOL USD mark is stale or missing");
  const html=await(await get("/")).text();
  assert.ok(html.includes('src="/assets/js/launch.mjs"'),"Missing launch module");
  assert.ok(!html.includes("Fresh launches"),"Launch shell includes article-like Radar content");
  assert.ok((await(await get("/terminal")).text()).includes('src="/assets/js/launch.mjs"'),"Missing terminal route");
  const fragment=await(await get("/assets/terminal-fragment.html")).text();
  for(const id of ["radar-map","dock-buy","dock-sell","brand-logo"])assert.ok(fragment.includes('id="'+id+'"'),"Missing UI "+id);
  const launcher=await(await get("/assets/js/launch.mjs")).text();
  assert.ok(launcher.includes('import("./dashboard.mjs")'),"Missing dashboard boot");
  const manifest=await(await get("/assets/manifest.webmanifest")).json();
  assert.equal(manifest.start_url,"/terminal","Home-screen route");
  const logo=await get("/assets/becs-logo.jpg");
  assert.ok(logo.headers.get("content-type")?.startsWith("image/jpeg"),"Logo MIME type");
  assert.ok((await logo.arrayBuffer()).byteLength>100,"Logo is empty");
  // Read-only: never call order, wallet, search or price POST endpoints.
  return {radar:snapshot.radar.length,signals:snapshot.signals.length,chartMints:Object.keys(history.trails).length,scanAgeSeconds:Math.round(age/1000),
    marketData:{solFresh,healthyFeeds,totalFeeds:feedNames.length,degraded:!solFresh||healthyFeeds<feedNames.length}};
}
if(require.main===module){
  const base=process.env.SMOKE_BASE_URL||"https://becsbot-production.up.railway.app";
  const retries=Math.min(24,Math.max(1,Number(process.env.SMOKE_ATTEMPTS)||1));
  const requireMarketData=process.env.SMOKE_REQUIRE_MARKET_DATA==="1";
  (async()=>{for(let i=0;i<retries;i++){
    try{console.log("Smoke passed",await smoke(base,{requireMarketData}));return;}
    catch(error){if(i===retries-1)throw error;console.log("Waiting for a healthy deployment ("+(i+1)+"/"+retries+")");await new Promise(r=>setTimeout(r,5000));}
  }})().catch(error=>{console.error("Smoke failed: "+error.message);process.exitCode=1;});
}
module.exports={smoke};
