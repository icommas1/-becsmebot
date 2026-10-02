const test=require("node:test"),assert=require("node:assert/strict");
const {archiveConfig}=require("../../src/archive/config");
const {encode,ENCODING}=require("../../src/archive/store");
const {gunzipSync}=require("node:zlib");
const {canonical}=require("../../src/events/becs-event");
const {createMarket}=require("../../src/market/market");

test("research archive config is opt-in and can reuse DATABASE_URL",()=>{
  assert.deepEqual(archiveConfig({}),{enabled:false,databaseUrl:null,streamId:"becs-research-v1"});
  assert.deepEqual(archiveConfig({RESEARCH_ARCHIVE_ENABLED:"true",DATABASE_URL:"postgres://example"}),
    {enabled:true,databaseUrl:"postgres://example",streamId:"becs-research-v1"});
  assert.throws(()=>archiveConfig({RESEARCH_ARCHIVE_ENABLED:"true"}),/requires/);
});

test("research archive payload hashes are canonical and compressed",()=>{
  const a=encode({b:2,a:[1,true]}),b=encode({a:[1,true],b:2});
  assert.equal(a.hash,b.hash);
  assert.equal(Buffer.compare(a.compressed,b.compressed),0);
  assert.ok(a.compressed.length>0);
  assert.equal(ENCODING,"gzip-json-v1");
});

test("research archive accepts optional absent evidence without mutating or weakening audit validation",()=>{
  const payload={price:null,optional:undefined,nested:{missing:undefined,known:2},items:[undefined,{missing:undefined}]};
  const expected={price:null,nested:{known:2},items:[null,{}]};
  const encoded=encode(payload);
  assert.deepEqual(JSON.parse(gunzipSync(encoded.compressed)),expected);
  assert.equal(encoded.hash,encode(expected).hash);
  assert.ok(Object.hasOwn(payload,"optional"));
  assert.throws(()=>canonical({optional:undefined}),/undefined/);
  assert.throws(()=>encode({price:NaN}),/non-finite/);
});

test("a completed market scan can be archived with optional Radar fields absent",async()=>{
  const mint="So11111111111111111111111111111111111111112";
  const market=createMarket({dexRequest:async()=>[],request:async url=>url.startsWith("/price")?
    {[mint]:{usdPrice:200}}:[{id:mint,usdPrice:200,stats6h:{}}]});
  await market.scan();
  const snapshot=market.researchSnapshot();
  assert.ok(snapshot.radar.length>0);
  assert.ok(snapshot.radar.some(row=>Object.values(row).includes(undefined)));
  const encoded=encode(snapshot);
  assert.deepEqual(JSON.parse(gunzipSync(encoded.compressed)),JSON.parse(JSON.stringify(snapshot)));
});

test("disabled research capture keeps public scans identical without retained provider evidence",async()=>{
  const mint="So11111111111111111111111111111111111111112";
  const options={dexRequest:async()=>[],request:async url=>url.startsWith("/price")?
    {[mint]:{usdPrice:200}}:[{id:mint,usdPrice:200,stats6h:{}}]};
  const paused=createMarket({...options,captureResearch:false});
  await paused.scan();
  assert.ok(paused.terminalSnapshot().radar.length>0);
  assert.equal(Object.keys(paused.terminalSnapshot().feeds).length,19);
  assert.equal(paused.researchSnapshot(),null);
});
