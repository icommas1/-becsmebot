const assert=require("node:assert/strict");
const {assertSchema}=require("../src/api/validation");
async function smoke(base,{request=fetch,now=Date.now,maxAgeMs=300000}={}){
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
  const age=now()-Date.parse(health.lastScanAt);
  assert.ok(Number.isFinite(age)&&age>=0&&age<=maxAgeMs,"Market scan is stale or missing");
  assert.ok(snapshot.solUsd>0&&now()-snapshot.solPriceAt>=0&&now()-snapshot.solPriceAt<=maxAgeMs,"SOL USD mark is stale or missing");
  assert.equal(Object.keys(snapshot.feeds).length,13,"Missing configured feeds");
  for(const [name,feed]of Object.entries(snapshot.feeds)){
    const feedAge=now()-Date.parse(feed.at);
    assert.ok(!feed.error&&Number.isFinite(feedAge)&&feedAge>=0&&feedAge<=maxAgeMs,name+" feed is delayed");
  }
  const html=await(await get("/")).text();
  for(const id of ["radar-map","dock-buy","dock-sell","brand-logo"])assert.ok(html.includes('id="'+id+'"'),"Missing UI "+id);
  const logo=await get("/assets/becs-logo.jpg");
  assert.ok(logo.headers.get("content-type")?.startsWith("image/jpeg"),"Logo MIME type");
  assert.ok((await logo.arrayBuffer()).byteLength>100,"Logo is empty");
  // Read-only: never call order, wallet, search or price POST endpoints.
  return {radar:snapshot.radar.length,signals:snapshot.signals.length,scanAgeSeconds:Math.round(age/1000)};
}
if(require.main===module){
  const base=process.env.SMOKE_BASE_URL||"https://becsbot-production.up.railway.app";
  const retries=Math.min(24,Math.max(1,Number(process.env.SMOKE_ATTEMPTS)||1));
  (async()=>{for(let i=0;i<retries;i++){
    try{console.log("Smoke passed",await smoke(base));return;}
    catch(error){if(i===retries-1)throw error;console.log("Waiting for a healthy deployment ("+(i+1)+"/"+retries+")");await new Promise(r=>setTimeout(r,5000));}
  }})().catch(error=>{console.error("Smoke failed: "+error.message);process.exitCode=1;});
}
module.exports={smoke};
