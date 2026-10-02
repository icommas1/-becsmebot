const test=require("node:test"),assert=require("node:assert/strict");
const {randomUUID}=require("node:crypto"),{Pool}=require("pg");
const {createResearchArchive}=require("../../src/archive/store");
const url=process.env.TEST_DATABASE_URL;

test("PostgreSQL: permanent research archive is append-only, content-addressed and verifiable",{skip:!url},async()=>{
  const streamId="research-"+randomUUID(),archive=createResearchArchive(url,{streamId}),db=new Pool({connectionString:url});
  try{
    await archive.init();
    const first=await archive.record({kind:"market.scan",source:"market",occurredAt:Date.now(),payload:{mint:"A",price:1,optional:undefined},metadata:{scan:1}});
    const second=await archive.record({kind:"market.scan",source:"market",occurredAt:Date.now(),payload:{mint:"A",price:1},metadata:{scan:2}});
    assert.equal(first.sequence,1);assert.equal(second.sequence,2);
    assert.equal(first.payloadHash,second.payloadHash,"identical payloads should share one content-addressed blob");
    const count=await db.query("SELECT count(*) FROM research_archive_payloads WHERE payload_hash=$1",[first.payloadHash]);
    assert.equal(Number(count.rows[0].count),1);
    const stats=await archive.stats();assert.equal(stats.recordCount,2);assert.equal(stats.headSequence,2);
    const verified=await archive.verify();assert.equal(verified.valid,true);assert.equal(verified.complete,true);assert.equal(verified.recordCount,2);
    const page=await archive.verify({limit:1});assert.equal(page.complete,false);assert.equal(page.verified,1);
    const end=await archive.verify({limit:1,afterSequence:page.verified,previousHash:page.previousHash,target:page.target});
    assert.equal(end.valid,true);assert.equal(end.complete,true);assert.equal(end.verified,2);
    const retry=await archive.record({recordId:first.recordId,kind:"market.scan",source:"market",occurredAt:first.occurredAt,
      payload:{mint:"A",price:1},metadata:{scan:1}});
    assert.deepEqual(retry,first);assert.equal((await archive.head()).recordCount,2);
    await assert.rejects(archive.record({recordId:first.recordId,kind:"market.scan",source:"market",occurredAt:first.occurredAt,
      payload:{mint:"A",price:2},metadata:{scan:1}}),/ID conflict/);
    await assert.rejects(db.query("UPDATE research_archive_records SET kind='tampered' WHERE stream_id=$1",[streamId]),/append-only/);
    await assert.rejects(db.query("DELETE FROM research_archive_payloads WHERE payload_hash=$1",[first.payloadHash]),/append-only/);
    // Disposable CI database only. Guard must reject the statement before any truncation.
    await assert.rejects(db.query("TRUNCATE research_archive_records"),/append-only/);
  }finally{await Promise.all([archive.close(),db.end()]);}
});
