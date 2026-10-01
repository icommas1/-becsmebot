const test=require("node:test"),assert=require("node:assert/strict");
const {archiveConfig}=require("../../src/archive/config");
const {encode,ENCODING}=require("../../src/archive/store");

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
