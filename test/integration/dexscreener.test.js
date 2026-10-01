const test=require('node:test'),assert=require('node:assert/strict');
const {createMarket}=require('../../src/market/market');
const {DEX_FEEDS,discoveryMints,createDexClient}=require('../../src/market/dexscreener');
const {isValid}=require('../../src/api/validation');
const {MINTS,SOL}=require('../fixtures/market');
const token=(id,price=.01)=>({id,symbol:'DEX',usdPrice:price,mcap:50000,liquidity:10000,
  createdAt:new Date(Date.now()-60000).toISOString()});
test('Dex discovery filters chains, validates mints, deduplicates and bounds each source',()=>{
 const data=[{chainId:'ethereum',tokenAddress:MINTS[0]}, {chainId:'solana',tokenAddress:'invalid'},
  {chainId:'solana',tokenAddress:MINTS[0]}, {chainId:'solana',tokenAddress:MINTS[0]}];
 assert.deepEqual(discoveryMints(data),[MINTS[0]]);
 assert.throws(()=>discoveryMints({bad:true}),/Invalid upstreamDexDiscovery/);
 const bs58=require('bs58').default;
 const many=Array.from({length:60},(_,i)=>({chainId:'solana',tokenAddress:bs58.encode(new Uint8Array(32).fill(i+1))}));
 assert.equal(discoveryMints(many).length,50);
});
test('Dex membership enriches exact mints with Jupiter, merges overlaps and leaves missing marks unavailable',async()=>{
 const calls=[];
 const market=createMarket({dexRequest:async()=>MINTS.slice(0,3).map(tokenAddress=>({chainId:'solana',tokenAddress,usdPrice:9999})),
 request:async url=>{calls.push(url);if(url.startsWith('/price'))return {[SOL]:{usdPrice:200}};
 if(url.includes('/search?'))return [token(MINTS[0]),token(MINTS[1]),token(MINTS[4])];
 return [token(MINTS[0])];}});
 await market.scan();const snapshot=market.snapshot();
 assert.equal(snapshot.radar.length,3);assert.ok(isValid('snapshot',snapshot));
 const existing=snapshot.radar.find(row=>row.mint===MINTS[0]);assert.equal(existing.feeds.length,19);
 assert.equal(existing.priceUsd,.01);assert.equal(existing.ranks['dex:top'],1);
 const missing=snapshot.radar.find(row=>row.mint===MINTS[2]);assert.equal(missing.priceUsd,null);assert.equal(missing.observedAt,null);
 assert.ok(!snapshot.trails[MINTS[2]]);assert.ok(!snapshot.radar.some(row=>row.mint===MINTS[4]));
 const batches=calls.filter(url=>url.includes('/search?'));assert.equal(batches.length,1);
 assert.deepEqual(new URL('https://fixture'+batches[0]).searchParams.get('query').split(','),MINTS.slice(0,3));
});
test('Dex failures retain old marks without refreshing timestamps and recover independently',async()=>{
 let mode='ok';
 const market=createMarket({dexRequest:async path=>{
 if(mode==='dex-failed'&&path.includes('top/v1'))throw Error('fixture Dex outage');
 return [{chainId:'solana',tokenAddress:MINTS[0]}];},request:async url=>{
 if(url.startsWith('/price'))return {[SOL]:{usdPrice:200}};
 if(url.includes('/search?')){if(mode==='enrichment-failed')throw Error('fixture enrichment outage');return [token(MINTS[0])];}
 return [token(MINTS[1])];}});
 await market.scan();const first=market.snapshot();
 mode='dex-failed';await market.scan();const second=market.snapshot();
 assert.equal(second.feeds['dex:top'].at,first.feeds['dex:top'].at);assert.match(second.feeds['dex:top'].error,/Dex outage/);
 assert.equal(second.feeds.recent.error,undefined);assert.equal(second.feeds['dex:ads'].error,undefined);
 mode='enrichment-failed';await market.scan();const third=market.snapshot();
 const old=second.radar.find(row=>row.mint===MINTS[0]),retained=third.radar.find(row=>row.mint===MINTS[0]);
 assert.equal(retained.observedAt,old.observedAt);assert.equal(third.feeds['dex:ads'].at,second.feeds['dex:ads'].at);
 assert.match(third.feeds['dex:ads'].error,/enrichment/);assert.equal(third.feeds.recent.error,undefined);
 mode='ok';await market.scan();assert.equal(market.snapshot().lastError,null);
 assert.ok(DEX_FEEDS.every(([name])=>!market.snapshot().feeds[name].error));
});
test('Dex transport rejects invalid paths, upstream failures, oversized bodies and excessive concurrency',async()=>{
 const request=createDexClient({fetchImpl:async()=>new Response(JSON.stringify([]))});
 assert.deepEqual(await request(DEX_FEEDS[0][1]),[]);
 await assert.rejects(request('/orders/unapproved'),/Unsupported/);
 await assert.rejects(createDexClient({fetchImpl:async()=>new Response('',{status:429})})(DEX_FEEDS[0][1]),/429/);
 await assert.rejects(createDexClient({fetchImpl:async()=>new Response('x'.repeat(1048577))})(DEX_FEEDS[0][1]),/too large/);
 const resolvers=[];const pending=createDexClient({fetchImpl:()=>new Promise(r=>{resolvers.push(r);})});
 // Six outstanding requests are permitted; no seventh request can be admitted.
 const jobs=Array.from({length:6},()=>pending(DEX_FEEDS[0][1]));
 await assert.rejects(pending(DEX_FEEDS[0][1]),/busy/);
 // Resolve each stub via a separate resolver so the test never needs network access.
 for(const resolve of resolvers)resolve(new Response("[]"));
 await Promise.all(jobs);
});
