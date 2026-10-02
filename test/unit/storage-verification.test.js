const test=require("node:test"),assert=require("node:assert/strict");
const {encode,verifyArchivePayload}=require("../../src/archive/store");
const {verifyDatabase}=require("../../src/operations/verify-storage");

test("stored payload verification rejects corruption, wrong sizes and unsupported encodings",()=>{
  const encoded=encode({price:1,rawEvidence:[{x:2}]}),row={encoding:"gzip-json-v1",payload:encoded.compressed,
    payload_hash:encoded.hash,compressed_bytes:encoded.compressed.length,uncompressed_bytes:encoded.rawBytes};
  assert.equal(verifyArchivePayload(row),true);
  for(const patch of [{payload:Buffer.from("corrupt")},{payload_hash:"0".repeat(64)},
    {compressed_bytes:1},{uncompressed_bytes:1},{encoding:"unknown"}])assert.equal(verifyArchivePayload({...row,...patch}),false);
});

test("full verifier rejects partial schemas and never initializes tables",async()=>{
  const queries=[],client={query:async(sql)=>{queries.push(sql);return {rows:sql.startsWith("SELECT")?[{present:true},{present:false},{present:false}]:[]};}};
  await assert.rejects(verifyDatabase(client),{integrityCode:"incomplete_storage_schema"});
  assert.equal(queries.at(-1),"ROLLBACK");assert.ok(queries.every(sql=>/^(SELECT|BEGIN|ROLLBACK)/.test(sql)));
  await assert.rejects(verifyDatabase(client,{pageSize:1000}),{integrityCode:"invalid_page_size"});
});
