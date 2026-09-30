const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp,createMarket}=require('../src/basket');
const {createPriceHistory}=require('../src/price-history');
const {createJupiterClient}=require('../src/jupiter-client');
const {rankSignals}=require('../src/signals');
const SOL='So11111111111111111111111111111111111111112';
test('serialized Jupiter queue respects reset, recovers errors and rejects overflow',async()=>{
 let time=100000,active=0,max=0,calls=0;const starts=[];
 const request=createJupiterClient({apiKey:'fixture',now:()=>time,wait:async ms=>{time+=ms;},maxPending:2,
 fetchImpl:async()=>{starts.push(time);active++;max=Math.max(active,max);await Promise.resolve();active--;calls++;return {ok:calls!==1,status:calls===1?429:200,headers:{get:()=>105},json:async()=>({ok:true})};}});
 const a=request('/one'),b=request('/two');await assert.rejects(request('/overflow'),/busy/);await Promise.all([a,b]);
 assert.equal(max,1);assert.ok(starts[1]>=105250);assert.ok(starts[2]-starts[1]>=2200);
 let n=0;const failing=createJupiterClient({apiKey:'fixture',gapMs:0,fetchImpl:async()=>({ok:++n>1,status:500,json:async()=>({}),headers:{get:()=>null}})});
 await assert.rejects(failing('/bad'),/500/);assert.deepEqual(await failing('/good'),{});
});
test('persisted charts prune invalid marks and rank observed multiples correctly',()=>{
 let time=100000000;const dir=fs.mkdtempSync(path.join(os.tmpdir(),'becs-history-'));
 try {const h=createPriceHistory({dataDir:dir,now:()=>time});h.sample([{mint:SOL,priceUsd:1},{mint:'invalid',priceUsd:NaN}]);
 time+=60000;h.sample([{mint:SOL,priceUsd:3}]);h.sample([{mint:SOL,priceUsd:4}]);
 const trails=createPriceHistory({dataDir:dir,now:()=>time}).snapshot([SOL,'invalid']);assert.equal(trails[SOL].length,2);assert.equal(trails.invalid,undefined);
 const [s]=rankSignals([{mint:SOL,symbol:'SOL',priceUsd:2,observedAt:time}],trails);assert.equal(s.multiple,2);assert.equal(s.peakMultiple,3);assert.equal(s.firstSeenAt,time-60000);
 time+=86400001;assert.deepEqual(h.snapshot([SOL]),{});
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('market merges 13 feeds, preserves delayed feed timestamps and omitted V3 marks',async()=>{
 let failed=false,calls=[];
 const market=createMarket({request:async url=>{calls.push(url);if(url.startsWith('/price'))return {[SOL]:{usdPrice:200,blockId:42}};
 if(failed&&url.includes('toptrending'))throw Error('fixture delay');
 return [{id:SOL,symbol:'SOL',usdPrice:200,stats24h:{priceChange:2}}];}});
 await market.scan();const first=market.snapshot();assert.equal(Object.keys(first.feeds).length,13);assert.equal(first.radar.length,1);assert.equal(first.signals[0].multiple,1);assert.equal(calls.length,14);
 failed=true;await market.scan();const second=market.snapshot();assert.match(second.lastError,/fixture delay/);assert.equal(second.feeds['trending:5m'].at,first.feeds['trending:5m'].at);assert.equal(second.radar.length,1);
 const other='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGkZwyTDt1v';const marks=await market.paperPrices([SOL,other]);assert.equal(marks[other],null);assert.equal(marks[SOL].blockId,42);
});
test('fresh metadata cannot refresh a cached older price',async()=>{
 const market=createMarket({request:async url=>url.startsWith('/price')?{[SOL]:{usdPrice:200}}:url.includes('toptrending/5m')?[{id:SOL,symbol:'SOL',usdPrice:200}]:[{id:SOL,symbol:'SOL'}]});
 await market.scan();const s=market.snapshot();assert.equal(s.radar[0].priceFeed,'trending:5m');assert.equal(s.radar[0].observedAt,Date.parse(s.feeds['trending:5m'].at));
});
test('public APIs reject signing, invalid inputs and excessive requests',async()=>{
 const app=createApp({snapshot:()=>({radar:[],feeds:{}}),search:async()=>[],paperPrices:async mints=>Object.fromEntries(mints.map(m=>[m,null]))});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try {
 assert.equal((await fetch(base+'/api/basket')).status,200);
 assert.equal((await fetch(base+'/api/auth/status')).status,404);
 assert.equal((await fetch(base+'/api/sell/quote',{method:'POST',headers:{'x-dashboard-key':'anything'}})).status,410);
 assert.equal((await fetch(base+'/api/search?q=x')).status,400);
 assert.equal((await fetch(base+'/api/paper/prices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mints:['invalid']})})).status,400);
 assert.equal((await fetch(base+'/api/paper/prices',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
 let response;for(let i=0;i<31;i++)response=await fetch(base+'/api/search?q=SOL');assert.equal(response.status,429);
 }finally{await new Promise(r=>server.close(r));}
});
