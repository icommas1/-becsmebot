const test=require("node:test");
const assert=require("node:assert/strict");

const modules=Promise.all([
  import("../../src/web/assets/js/core.mjs"),
  import("../../src/web/assets/js/filters.mjs"),
  import("../../src/web/assets/js/paper-wallet.mjs"),
  import("../../src/web/assets/js/api-client.mjs"),
  import("../../src/web/assets/js/dom.mjs")
]);
const mint="So11111111111111111111111111111111111111112";

test("feed diagnostics distinguish current, delayed and unknown sources",async()=>{
  const {feedStatus}=await import("../../src/web/assets/js/feed-status.mjs");
  const now=2_000_000_000_000,at=ms=>new Date(now-ms).toISOString();
  const view=feedStatus({
    recent:{count:2,at:at(30000),error:null},
    "dex:ads":{count:3,at:at(180000),error:"DexScreener unavailable"},
    "organic:1h":{count:0,at:null,error:null},
    "dex:profiles":{count:5,at:at(-1000),error:null},
    "trending:5m":{count:4,at:at(360000),error:null}
  },now);
  assert.equal(view.summary,"1/5 reporting · 2 delayed · 2 pending");
  assert.match(view.rows[0].text,/New launches · 2 tokens · Reporting · Updated just now/);
  assert.match(view.rows[1].text,/Dex paid ads · 3 cached tokens · Delayed · Updated 3m ago · DexScreener unavailable/);
  assert.match(view.rows[2].text,/Organic · 1h · 0 tokens · Pending · No successful scan yet/);
  assert.match(view.rows[3].text,/Pending · Scan time unavailable/);
  assert.match(view.rows[4].text,/Trending · 5m · 4 cached tokens · Delayed · Updated 6m ago/);
});

test("feed diagnostics mark disconnected caches and preserve their real update times",async()=>{
  const {feedStatus}=await import("../../src/web/assets/js/feed-status.mjs");
  const now=2_000_000_000_000,feeds={recent:{count:2,at:new Date(now-30000).toISOString()}};
  const saved=structuredClone(feeds);
  const disconnected=feedStatus(feeds,now,{connectionUnavailable:true});
  assert.match(disconnected.summary,/Connection unavailable/);
  assert.match(disconnected.rows[0].text,/2 cached tokens · Delayed · Updated just now · Connection unavailable/);
  assert.match(feedStatus(feeds,now+360000,{connectionUnavailable:true}).rows[0].text,/Updated 6m ago/);
  assert.equal(feedStatus(feeds,now).rows[0].state,"Reporting","a successful revalidation restores a fresh feed");
  assert.equal(feedStatus(feeds,now+360000).rows[0].state,"Delayed","reconnection cannot make old observations fresh");
  assert.deepEqual(feeds,saved,"display state must never modify provider timestamps");
});

test("dashboard filters remain shared, strict and deterministic",async()=>{
  const [core,filters,paperModule]=await modules;
  const now=2_000_000_000_000,settings={...paperModule.paperDefaults};
  const row={mint,symbol:"TEST",createdAt:new Date(now-600000).toISOString(),observedAt:now,
    priceUsd:.01,marketCap:50000,liquidityUsd:5000,feeds:["recent","trending:5m"]};
  const ui=filters.normalizeRadarUi({tab:"broken",source:"broken",launchVersion:1});
  assert.equal(ui.tab,"recent");assert.equal(ui.source,"5m");
  assert.equal(filters.passes(row,settings,now),true);
  assert.equal(filters.launchRows([row],settings,ui,now).length,1);
  for(const changed of [
    {marketCap:null},{marketCap:1000001},{liquidityUsd:1999},{createdAt:null},{isSus:true},
    {observedAt:now-180001},{observedAt:now+1},{priceUsd:null}
  ])assert.equal(filters.passes({...row,...changed},settings,now),false,JSON.stringify(changed));
  assert.equal(core.signalState({...row,change5m:8},{},now),"HEATING");
  assert.equal(core.signalState({...row,change5m:-1},{},now),"COOLING");
  assert.equal(core.signalStrength({...row,organicScore:null,volume5m:null,change5m:null}),1);
});

test("paper wallet migration preserves holdings and rejects unsafe settings",async()=>{
  const [_core,_filters,{loadPaper,paperDefaults}]=await modules;
  const stored={cashSol:7,holds:{saved:{symbol:"Keep"}},bought:{saved:true},settings:{maxCap:0,maxAge:0,impactPct:99,minOrganicScore:101}};
  const paper=loadPaper({getItem:()=>JSON.stringify(stored)});
  assert.equal(paper.cashSol,7);assert.equal(paper.holds.saved.symbol,"Keep");
  assert.equal(paper.settings.maxCap,paperDefaults.maxCap);
  assert.equal(paper.settings.maxAge,paperDefaults.maxAge);
  assert.equal(paper.settings.impactPct,0);assert.equal(paper.settings.minOrganicScore,0);
  assert.equal(paper.auto,false);
});

test("paper accounting buys and sells the correct position without I/O",async()=>{
  const [_core,_filters,{freshPaper,buyPaper,sellPaper}]=await modules;
  const now=2_000_000_000_000,paper=freshPaper();
  const row={mint,symbol:"TEST",priceUsd:.01,marketCap:50000,liquidityUsd:5000,observedAt:now,
    createdAt:new Date(now-600000).toISOString()};
  const bought=buyPaper({paper,row,amount:1,solRate:200,eligible:true,feed:"recent",now});
  assert.equal(bought.ok,true);assert.equal(paper.holds[mint].qty,100);
  assert.equal(paper.cashSol,.4-(1/200+.000005));assert.equal(paper.activity[0].source,"manual");
  assert.equal(buyPaper({paper,row,amount:1,solRate:200,eligible:true,feed:"recent",now}).ok,false);
  const stale=sellPaper({paper,mint,pct:100,dollars:1,solRate:200,mark:{priceUsd:.02,source:"jupiter-v3"},markAt:now-120001,now});
  assert.equal(stale.ok,false);assert.equal(paper.holds[mint].qty,100);
  const sold=sellPaper({paper,mint,pct:100,dollars:1,solRate:200,mark:{priceUsd:.02,source:"jupiter-v3"},markAt:now,now});
  assert.equal(sold.ok,true);assert.equal(paper.holds[mint].qty,50);
  assert.equal(paper.activity[0].mint,mint);assert.equal(paper.activity[0].kind,"sell");
});

test("dashboard API client uses only read and paper-price contracts",async()=>{
  const [,,, {createApiClient}]=await modules,calls=[];
  const client=createApiClient(async(url,options)=>{
    calls.push({url,options});
    if(url==="/api/basket"&&options.headers?.["If-None-Match"])return {status:304,ok:false};
    const body=url==="/api/basket"?{radar:[{mint,symbol:"TEST",priceUsd:2}],signals:[{mint,firstSeenAt:1,observedAt:2,multiple:2,peakMultiple:3}]}:
      url==="/api/history"?{scanAt:null,trails:{[mint]:[[1,2],[2,3]]}}:url.startsWith("/api/search")?{rows:[]}:{prices:{}};
    return {status:200,ok:true,headers:{get:()=>url==="/api/basket"?'W/"basket-1"':url==="/api/history"?'W/"history-1"':null},json:async()=>body};
  });
  const basket=await client.basket();assert.deepEqual(basket.signals,[{...basket.radar[0],firstSeenAt:1,observedAt:2,multiple:2,peakMultiple:3}]);
  assert.deepEqual(await client.basket(),basket);
  assert.deepEqual(await client.history(),{scanAt:null,trails:{[mint]:[[1,2],[2,3]]}});
  await client.search("A B");await client.paperPrices([mint]);
  assert.deepEqual(calls.map(call=>call.url),["/api/basket","/api/basket","/api/history","/api/search?q=A%20B","/api/paper/prices"]);
  assert.equal(calls[0].options.credentials,"same-origin");
  assert.equal(calls[1].options.headers["If-None-Match"],'W/"basket-1"');
  assert.equal(calls[4].options.method,"POST");
  assert.deepEqual(JSON.parse(calls[4].options.body),{mints:[mint]});
  assert.equal(calls.some(call=>call.url.includes("/api/sell")),false);
});

test("sparkline presentation receives and maps the supplied observation data",async()=>{
  const [,,,,{sparkline}]=await modules;
  function element(tag){return {tagName:tag,children:[],append(...children){this.children.push(...children);},setAttribute(name,value){this[name]=String(value);}};}
  const document={createElement:element,createElementNS:(_namespace,tag)=>element(tag)};
  const chart=sparkline(document,[[100,2],[200,4],[300,3]]).children[0];
  assert.equal(chart.children[0].points,"3.0,35.0 56.0,3.0 109.0,19.0");
  assert.equal(chart.children[0].stroke,"#59d6a2");
  assert.equal(chart["aria-label"],"Observed price trail from 3 scans");
});

test("paper price client batches oversized hold sets without live execution routes",async()=>{
  const [,,, {createApiClient}]=await modules,calls=[];
  const client=createApiClient(async(_url,options)=>{
    const mints=JSON.parse(options.body).mints;calls.push(mints.length);
    return {ok:true,json:async()=>({prices:Object.fromEntries(mints.map(mint=>[mint,null]))})};
  });
  const result=await client.allPaperPrices(Array.from({length:205},(_,index)=>mint+index));
  assert.deepEqual(calls,[100,100,5]);
  assert.equal(Object.keys(result).length,205);
});

test("stalled browser requests time out without discarding cached data and recover",async()=>{
  const [,,, {createApiClient}]=await modules;
  const snapshot={radar:[],signals:[]};let calls=0;
  const client=createApiClient(async(_url,options)=>{
    calls++;
    if(calls===2){
      assert.ok(options.signal instanceof AbortSignal,"request must have a cancellation signal");
      return new Promise((_resolve,reject)=>options.signal.addEventListener("abort",()=>reject(options.signal.reason),{once:true}));
    }
    if(calls===3){
      assert.equal(options.headers["If-None-Match"],'W/"saved"');
      return {status:304,ok:false};
    }
    return {status:200,ok:true,headers:{get:()=> 'W/"saved"'},json:async()=>snapshot};
  },{timeoutMs:10});
  assert.deepEqual(await client.basket(),snapshot);
  await assert.rejects(client.basket(),/timed out/i);
  assert.deepEqual(await client.basket(),snapshot);
});

test("request deadlines cover stalled response bodies for history, search and paper marks",async()=>{
  const [,,, {createApiClient}]=await modules;
  for(const action of [client=>client.history(),client=>client.search("TEST"),client=>client.paperPrices([mint])]){
    const client=createApiClient(async(_url,options)=>({ok:true,status:200,json:()=>
      new Promise((_resolve,reject)=>options.signal.addEventListener("abort",()=>reject(options.signal.reason),{once:true}))
    }),{timeoutMs:10});
    await assert.rejects(action(client),/timed out/i);
  }
});

test("Dex sources persist selection and share launch eligibility with Radar, Signals and auto",async()=>{
 const [,filters,{paperDefaults}]=await modules;
 const now=Date.now(),row={mint,feeds:["dex:top"],ranks:{"dex:top":3},priceUsd:.01,marketCap:50000,
  liquidityUsd:5000,createdAt:new Date(now-60000).toISOString(),observedAt:now};
 const ui=filters.normalizeRadarUi({tab:"dex:top",source:"24h",launchVersion:2,sort:"rank"});
 assert.equal(filters.selectedFeed(ui),"dex:top");assert.equal(filters.sortValue(row,ui,now),-3);
 assert.equal(filters.launchRows([row],paperDefaults,ui,now).length,1);
 assert.equal(filters.launchRows([{...row,priceUsd:null}],paperDefaults,ui,now).length,0);
 assert.equal(filters.launchRows([row],paperDefaults,{...ui,tab:"recent"},now).length,0);
 const {autoBuyCandidates}=await import("../../src/web/assets/js/trading/decision-engine.mjs");
 assert.equal(autoBuyCandidates({enabled:true,rows:[row],settings:paperDefaults,radarUi:ui,enteredAssets:{},now}).length,1);
});
