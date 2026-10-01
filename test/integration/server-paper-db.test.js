const test=require("node:test"),assert=require("node:assert/strict");
const {randomUUID}=require("node:crypto"),{Pool}=require("pg");
const {createStore}=require("../../src/paper/store");
const {createPaperService}=require("../../src/paper/service");
const {fixtureMarket,MINTS}=require("../fixtures/market");
const url=process.env.TEST_DATABASE_URL;
test("PostgreSQL: concurrent fills, restart/replay, rollback, bounded eviction, ownership and sessions",{skip:!url},async()=>{
  const store=createStore(url),second=createStore(url),db=new Pool({connectionString:url});
  const owner="fixture-"+randomUUID(),other="fixture-"+randomUUID();
  const cmd=fields=>({requestId:randomUUID(),createdAt:new Date().toISOString(),...fields});
  try{
    await store.init();await store.ensureAccount(owner);await store.ensureAccount(other);
    const market=await fixtureMarket(),service=createPaperService({store,market}),another=createPaperService({store:second,market});
    const buy=cmd({type:"buy",mint:MINTS[0],amount:1,automatic:false,feed:"recent"});
    const results=await Promise.all([service.command(owner,buy),another.command(owner,buy)]);
    assert.equal(results.filter(r=>r.replayed).length,1);assert.deepEqual(results[0].execution,results[1].execution);
    let ledger=await store.read(owner);assert.equal(ledger.revision,1);assert.equal(ledger.paper.activity.length,1);
    assert.equal((await store.read(other)).paper.cashSol,.4);
    const sale=cmd({type:"sell",mint:MINTS[0],dollars:1,automatic:false});
    const sold=await service.command(owner,sale);assert.equal(sold.ok,true);
    // New service/store instances represent another process/device; no provider needed for replay.
    const restarted=createPaperService({store:second,market:{snapshot:()=>{throw Error("must not fetch");}}});
    assert.deepEqual((await restarted.command(owner,sale)).execution,sold.execution);
    await assert.rejects(service.command(owner,{...sale,dollars:2}),{status:409});
    ledger=await store.read(owner);assert.equal(ledger.revision,2);
    const before=structuredClone(ledger);
    const old=cmd({type:"buy",mint:MINTS[1],amount:1,automatic:false,feed:"recent"});old.createdAt=new Date(Date.now()-86400001).toISOString();
    await assert.rejects(service.command(owner,old),{status:409});
    await assert.rejects(service.command(owner,{...old,createdAt:new Date(Date.now()+60000).toISOString()}),{status:409});
    await assert.rejects(store.command(owner,cmd({}),"failure",async paper=>{paper.cashSol=0;throw Error("simulated interruption");}),/interruption/);
    assert.deepEqual(await store.read(owner),before);
    // A rejected order leaves no receipt, so the same ID can retry after recovery.
    const retry=cmd({type:"buy",mint:MINTS[1],amount:1,automatic:false,feed:"recent"});
    const unavailable=createPaperService({store,market:{terminalSnapshot:()=>({...market.terminalSnapshot(),solPriceAt:null})}});
    assert.equal((await unavailable.command(owner,retry)).ok,false);
    assert.equal((await service.command(owner,retry)).ok,true);
    ledger=await store.read(owner);
    // Force receipt insertion failure AFTER ledger UPDATE to prove database rollback.
    await assert.rejects(store.command(owner,cmd({}),null,async paper=>{paper.cashSol=0;return {ok:true};}));
    assert.deepEqual(await store.read(owner),ledger);
    const invalid=cmd({type:"buy",mint:MINTS[0],amount:1,automatic:false,feed:"recent",userId:other});
    await assert.rejects(service.command(owner,invalid),{status:400});
    await assert.rejects(service.command(owner,cmd({type:"cash",cashSol:1,revision:0})),{status:409});
    const reset=cmd({type:"reset",cashSol:.4,revision:ledger.revision});await service.command(owner,reset);
    await service.command(owner,buy);assert.equal((await store.read(owner)).paper.activity.length,0,"old buy must not return after reset");
    // Real SQL pruning, including the expired-receipt rejection watermark.
    for(let i=0;i<500;i++)await store.command(owner,cmd({}),"bound"+i,async()=>({ok:true}));
    const count=await db.query("SELECT count(*) FROM paper_requests WHERE user_id=$1",[owner]);assert.equal(Number(count.rows[0].count),500);
    await assert.rejects(service.command(owner,buy),{status:409});
    assert.equal((await store.read(owner)).paper.cashSol,.4);
    const token=await store.createSession(owner);assert.equal(await second.session(token),owner);assert.equal(await store.session("fake"),null);
    await store.logout(token);assert.equal(await second.session(token),null);
    const state=randomUUID();await store.flow(state,"verifier");assert.equal(await second.consumeFlow(state),"verifier");assert.equal(await store.consumeFlow(state),undefined);
  }finally{
    for(const table of ["paper_sessions","paper_requests","paper_accounts"])await db.query("DELETE FROM "+table+" WHERE user_id=ANY($1)",[[owner,other]]).catch(()=>{});
    await Promise.all([store.close(),second.close(),db.end()]);
  }
});
