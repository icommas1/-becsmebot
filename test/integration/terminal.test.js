const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp,createMarket}=require('../../src/basket');
const {createPriceHistory}=require('../../src/market/history');
const {rankSignals}=require('../../src/market/signals');
const SOL='So11111111111111111111111111111111111111112';
test('persisted charts prune invalid marks and rank observed multiples correctly',()=>{
 let time=100000000;const dir=fs.mkdtempSync(path.join(os.tmpdir(),'becs-history-'));
 try {const h=createPriceHistory({dataDir:dir,now:()=>time});h.sample([{mint:SOL,priceUsd:1},{mint:'invalid',priceUsd:NaN}]);
 time+=60000;h.sample([{mint:SOL,priceUsd:3}]);h.sample([{mint:SOL,priceUsd:4}]);
 const trails=createPriceHistory({dataDir:dir,now:()=>time}).snapshot([SOL,'invalid']);assert.equal(trails[SOL].length,2);assert.equal(trails.invalid,undefined);
 const [s]=rankSignals([{mint:SOL,symbol:'SOL',priceUsd:2,observedAt:time}],trails);assert.equal(s.multiple,2);assert.equal(s.peakMultiple,3);assert.equal(s.firstSeenAt,time-60000);
 time+=86400001;assert.deepEqual(h.snapshot([SOL]),{});
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('chart transport bounds trails, keeps endpoints and spikes, and leaves signal history intact',()=>{
 let time=100000000;const h=createPriceHistory({now:()=>time});
 for(let index=0;index<500;index++){
  const price=index===237?100:index===0?1:index===499?2:1+index/1000;
  h.sample([{mint:SOL,priceUsd:price}],time++);
 }
 const full=h.snapshot([SOL])[SOL],chart=h.chartSnapshot([SOL])[SOL];
 assert.equal(full.length,500);assert.ok(chart.length<=120);assert.deepEqual(chart[0],full[0]);assert.deepEqual(chart.at(-1),full.at(-1));
 assert.ok(chart.some(point=>point[1]===100));assert.ok(chart.every((point,index)=>index===0||point[0]>chart[index-1][0]));
});
test('chart revision changes when retained points expire',()=>{
 let time=100000000;const h=createPriceHistory({now:()=>time});
 h.sample([{mint:SOL,priceUsd:1}]);const revision=h.revision();
 time+=86400001;assert.ok(h.revision()>revision);assert.deepEqual(h.snapshot([SOL]),{});
});
test('market merges 19 feeds, preserves delayed feed timestamps and omitted V3 marks',async()=>{
 let failed=false,calls=[];
 const market=createMarket({dexRequest:async()=>[],request:async url=>{calls.push(url);if(url.startsWith('/price'))return {[SOL]:{usdPrice:200,blockId:42}};
 if(failed&&url.includes('toptrending'))throw Error('fixture delay');
 return [{id:SOL,symbol:'SOL',usdPrice:200,stats24h:{priceChange:2}}];}});
 await market.scan();const first=market.snapshot();assert.equal(Object.keys(first.feeds).length,19);assert.equal(first.radar.length,1);assert.equal(first.signals[0].multiple,1);assert.equal(calls.length,14);
 failed=true;await market.scan();const second=market.snapshot();assert.match(second.lastError,/fixture delay/);assert.equal(second.feeds['trending:5m'].at,first.feeds['trending:5m'].at);assert.equal(second.radar.length,1);
 const other='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGkZwyTDt1v';const marks=await market.paperPrices([SOL,other]);assert.equal(marks[other],null);assert.equal(marks[SOL].blockId,42);
});
test('fresh metadata cannot refresh a cached older price',async()=>{
 const market=createMarket({dexRequest:async()=>[],request:async url=>url.startsWith('/price')?{[SOL]:{usdPrice:200}}:url.includes('toptrending/5m')?[{id:SOL,symbol:'SOL',usdPrice:200}]:[{id:SOL,symbol:'SOL'}]});
 await market.scan();const s=market.snapshot();assert.equal(s.radar[0].priceFeed,'trending:5m');assert.equal(s.radar[0].observedAt,Date.parse(s.feeds['trending:5m'].at));
});
test('production APIs expose only signal data and block retired features', async () => {
 const market=createMarket({dexRequest:async()=>[],request:async()=>[]});
 const server=createApp(market).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 try {
  const basket=await fetch(base+'/api/basket');assert.equal(basket.status,200);
  assert.equal(basket.headers.get('x-content-type-options'),'nosniff');
  assert.match(basket.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal(basket.headers.get('access-control-allow-origin'),null);
  for(const route of ['/api/auth/status','/api/search?q=SOL','/api/memory','/assets/js/dashboard.mjs'])assert.equal((await fetch(base+route)).status,410);
  for(const route of ['/api/sell/quote','/api/paper/prices','/api/paper/commands'])assert.equal((await fetch(base+route,{method:'POST'})).status,410);
 }finally{await new Promise(r=>server.close(r));}
});
