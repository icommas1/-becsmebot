const test=require("node:test"),assert=require("node:assert/strict");
const {randomUUID}=require("node:crypto"),{Pool}=require("pg");
const {createResearchArchive}=require("../../src/archive/store");
const {createArchiveCapture}=require("../../src/archive/capture");
const {fixtureMarket}=require("../fixtures/market");
const fs=require("node:fs"),path=require("node:path"),{tmpdir}=require("node:os");
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

test("PostgreSQL: meaningful evidence survives lost receipts, collector replacement and isolated retrieval",{skip:!url},async()=>{
  const streamId="recovery-"+randomUUID(),otherId="other-"+randomUUID(),dataDir=fs.mkdtempSync(path.join(tmpdir(),"becs-db-recovery-"));
  let archive=createResearchArchive(url,{streamId});const other=createResearchArchive(url,{streamId:otherId});
  try{
    await archive.init();await other.init();
    const market=await fixtureMarket(),payload=market.researchSnapshot();assert.ok(payload.radar.length>0);
    let lost=true;
    const transport={streamId,record:async value=>{const receipt=await archive.record(value);if(lost){lost=false;throw Error("Lost commit response");}return receipt;}};
    let capture=createArchiveCapture({archive:transport,dataDir,logger:{log(){},error(){}}});
    await capture.capture({kind:"market.scan",source:"market",occurredAt:Date.parse(payload.scanAt),payload});
    assert.equal(capture.status().pendingRecords,1);assert.equal((await archive.head()).recordCount,1);
    const before=await archive.readRecord(1),witness=await archive.retainedEvidence();
    assert.deepEqual(before.payload,JSON.parse(JSON.stringify(payload)));assert.ok(witness.radarRows>0);assert.ok(witness.providerFeeds>0);
    await archive.close();archive=createResearchArchive(url,{streamId});
    // No init call: paused-process retrieval is read-only against the saved schema.
    assert.deepEqual(await archive.readRecord(1),before);assert.deepEqual(await archive.retainedEvidence(),witness);
    capture=createArchiveCapture({archive,dataDir,logger:{log(){},error(){}}});await capture.flush();
    assert.equal(capture.status().pendingRecords,0);assert.equal((await archive.head()).recordCount,1);
    assert.equal((await archive.verify()).valid,true);
    const next=await archive.record({kind:"runtime.started",source:"runtime",payload:{restart:true}});
    let page=await archive.listRecords({limit:1});assert.equal(page.records[0].sequence,next.sequence);assert.equal(page.nextBeforeSequence,2);
    page=await archive.listRecords({limit:1,beforeSequence:page.nextBeforeSequence});assert.deepEqual(page.records[0],before.record);
    assert.equal((await archive.listRecords({limit:1,beforeSequence:1})).records.length,0);
    assert.equal(await archive.readRecord(999),null);
    assert.equal(await other.readRecord(1),null);assert.deepEqual((await other.listRecords()).records,[]);
    await assert.rejects(other.record({recordId:before.record.recordId,kind:"market.scan",source:"market",occurredAt:before.record.occurredAt,payload}),/ID conflict/);
    await other.record({kind:"market.scan",source:"market",payload:{radar:[{mint:"other"}],signals:[],providerRows:{}}});
    assert.equal((await other.readRecord(1)).payload.radar[0].mint,"other");assert.deepEqual(await archive.readRecord(1),before);
    await assert.rejects(archive.listRecords({limit:101}),/read range/);
    await assert.rejects(archive.readRecord(0),/sequence/);
  }finally{await Promise.all([archive.close(),other.close()]);fs.rmSync(dataDir,{recursive:true,force:true});}
});
