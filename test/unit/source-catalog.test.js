const test=require('node:test');
const assert=require('node:assert/strict');
const catalog=import('../../src/web/assets/js/source-catalog.mjs');
const NOW=1790952000000;
const at=delta=>new Date(NOW+delta).toISOString();
test('exactly the eight owner-selected tools; selection is not runtime connectivity',async()=>{
  const {SELECTED_TOOLS}=await catalog;
  assert.deepEqual(SELECTED_TOOLS.map(tool=>tool.name),['Google Drive','GSC Wizard','Parallel Search','Railway','GitHub','MagicPath','Exa','Supabase']);
  assert.equal(new Set(SELECTED_TOOLS.map(tool=>tool.id)).size,8);
  for(const tool of SELECTED_TOOLS){assert.equal(tool.hitRate,null);assert.ok(Object.isFrozen(tool));}
  const readers=SELECTED_TOOLS.filter(tool=>tool.runtime.startsWith('On-demand research'));
  assert.deepEqual(readers.map(tool=>tool.id),['parallel-search','exa']);
  assert.ok(SELECTED_TOOLS.filter(tool=>!readers.includes(tool)).every(tool=>tool.runtime==='No bot-side adapter'&&tool.cost==='Not verified'));
});
test('nineteen configured feeds are two provider families, not nineteen independent votes',async()=>{
  const {FEED_CATALOG,marketSources,sourceSummary}=await catalog;
  const feeds=Object.fromEntries(FEED_CATALOG.map(feed=>[feed.id,{at:at(-1000),count:0}]));
  assert.deepEqual(sourceSummary(marketSources({feeds},NOW,true)),{configured:19,reporting:19,reportingOrigins:2});
});
test('fresh zero-entry feed is reporting, not missing',async()=>{
  const {feedState}=await catalog;
  const row=feedState({at:at(-1),count:0},NOW,true);
  assert.equal(row.status,'Reporting');assert.equal(row.count,0);assert.equal(row.cached,false);
});
test('five-minute display cutoff ages retained feeds without changing their timestamp',async()=>{
  const {feedState}=await catalog;
  assert.equal(feedState({at:at(-300000),count:3},NOW).status,'Reporting');
  const row=feedState({at:at(-300001),count:3},NOW);
  assert.equal(row.status,'Delayed');assert.equal(row.cached,true);assert.equal(row.at,at(-300001));
});
test('connection and provider failures never show reporting',async()=>{
  const {feedState}=await catalog;
  assert.equal(feedState({at:at(-1),count:3},NOW,false).status,'Disconnected');
  assert.equal(feedState({at:at(-1),count:3,error:'failed'},NOW,true).status,'Delayed');
});
test('missing, invalid and future timestamps remain unavailable',async()=>{
  const {feedState}=await catalog;
  assert.equal(feedState(null,NOW).status,'Pending');
  for(const stamp of ['not-a-time',at(1)]){const row=feedState({at:stamp,count:1},NOW);assert.equal(row.status,'Invalid timestamp');assert.equal(row.at,null);assert.equal(row.ageMs,null);}
});
test('untrusted counts are not converted to numbers',async()=>{
  const {feedState}=await catalog;
  for(const count of [-1,NaN,Infinity,'3',1.1])assert.equal(feedState({count},NOW).count,null);
});
test('missing backend cannot manufacture reporting feeds; unexpected feed IDs are not attributed',async()=>{
  const {marketSources,sourceSummary}=await catalog;
  assert.equal(sourceSummary(marketSources(null,NOW,false)).reporting,0);
  const rows=marketSources({feeds:{invented:{at:at(-1),count:1}}},NOW,true);
  assert.equal(rows.length,19);assert.equal(sourceSummary(rows).reporting,0);
});
test('paid promotions stay labeled and support tools stay separate',async()=>{
  const {FEED_CATALOG,SELECTED_TOOLS}=await catalog;
  assert.deepEqual(FEED_CATALOG.filter(feed=>feed.paidPromotion).map(feed=>feed.id),['dex:ads','dex:boosts','dex:top']);
  assert.match(SELECTED_TOOLS.find(tool=>tool.id==='gsc-wizard').boundary,/Not a market-wide/);
});
test('archive and wallet failures stay unknown rather than falsely disabled',async()=>{
  const {archiveLabel,walletLabel}=await catalog;
  assert.equal(archiveLabel({enabled:false,healthy:true},true),'Archive capture paused');
  assert.equal(archiveLabel({enabled:false,healthy:true},false),'Archive status unavailable');
  assert.equal(archiveLabel({enabled:true,healthy:false},true),'Archive capture needs attention');
  assert.equal(walletLabel({enabled:false},true),'Wallet intelligence disabled');
  assert.equal(walletLabel(null,false),'Wallet-intelligence status unavailable');
});
test('reject malformed endpoint payloads independently',async()=>{
  const {validStatusPayload}=await catalog;
  assert.equal(validStatusPayload('health',{ok:true,tradingEnabled:false,feeds:{}}),true);
  assert.equal(validStatusPayload('health',{ok:true,tradingEnabled:false,feeds:[]}),false);
  assert.equal(validStatusPayload('archive',{enabled:false,healthy:true}),true);
  assert.equal(validStatusPayload('wallet',{enabled:false,providers:{}}),true);
  for(const value of [null,[],{},'ok'])assert.equal(validStatusPayload('health',value),false);
});
