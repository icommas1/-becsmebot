const test=require("node:test"),assert=require("node:assert/strict");
const {randomUUID}=require("node:crypto"),{Pool}=require("pg");
const {createStore,streamForUser}=require("../../src/paper/store");
const {createPaperService}=require("../../src/paper/service");
const {fixtureMarket,MINTS}=require("../fixtures/market");
const url=process.env.TEST_DATABASE_URL;

test("PostgreSQL: committed paper actions append verifiable BecsEvents and immutable local proofs",{skip:!url},async()=>{
  const store=createStore(url),db=new Pool({connectionString:url}),owner="event-fixture-"+randomUUID();
  const cmd=fields=>({requestId:randomUUID(),createdAt:new Date().toISOString(),...fields});
  try{
    await store.init();await store.ensureAccount(owner);
    const service=createPaperService({store,market:await fixtureMarket()});
    const buy=cmd({type:"buy",mint:MINTS[0],amount:1,automatic:false,feed:"recent"});
    const bought=await service.command(owner,buy);assert.equal(bought.ok,true);
    let page=await store.listEvents(owner,{limit:10});
    assert.deepEqual(page.events.map(event=>event.type),["paper.execution.completed","order.intent.created","decision.evaluated"]);
    assert.ok(page.events.every(event=>event.requestId===buy.requestId));
    let verification=await store.verifyEvents(owner);
    assert.equal(verification.valid,true);assert.equal(verification.complete,true);assert.equal(verification.eventCount,3);

    const replay=await service.command(owner,buy);assert.equal(replay.replayed,true);
    assert.equal((await store.verifyEvents(owner)).eventCount,3,"replay must not append duplicate audit events");

    const cash=cmd({type:"cash",cashSol:.5,revision:bought.revision});
    assert.equal((await service.command(owner,cash)).ok,true);
    verification=await store.verifyEvents(owner);assert.equal(verification.eventCount,4);assert.equal(verification.valid,true);

    const proof=await store.sealEvents(owner);assert.equal(proof.eventCount,4);
    const proofs=await store.listProofs(owner);assert.equal(proofs.proofs.length,1);assert.equal(proofs.proofs[0].rootHash,proof.rootHash);
    verification=await store.verifyEvents(owner);assert.equal(verification.proofsChecked,1);assert.equal(verification.proofsValid,true);

    const stream=streamForUser(owner);
    await assert.rejects(db.query("UPDATE becs_events SET type='tampered' WHERE stream_id=$1",[stream]),/append-only/);
    await assert.rejects(db.query("DELETE FROM becs_event_proofs WHERE stream_id=$1",[stream]),/append-only/);

    // Always roll back, including on the pre-fix schema: never destroy fixture history.
    const client=await db.connect();
    try{for(const table of ["becs_events","becs_event_proofs"]){
      await client.query("BEGIN");
      try{await assert.rejects(client.query("TRUNCATE "+table),/append-only/);}
      finally{await client.query("ROLLBACK");}
    }}finally{client.release();}

    const count=verification.eventCount;
    await assert.rejects(store.command(owner,cmd({}),null,async()=>({ok:true,auditEvents:[]})));
    assert.equal((await store.verifyEvents(owner)).eventCount,count,"rolled-back commands must not alter the event ledger");
  }finally{
    for(const table of ["paper_sessions","paper_requests","paper_accounts"])await db.query("DELETE FROM "+table+" WHERE user_id=$1",[owner]).catch(()=>{});
    await Promise.all([store.close(),db.end()]);
  }
});
