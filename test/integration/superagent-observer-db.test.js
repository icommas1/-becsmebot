const test=require("node:test"),assert=require("node:assert/strict");
const {randomUUID}=require("node:crypto"),{Pool}=require("pg");
const {execFile}=require("node:child_process"),{promisify}=require("node:util");
const {createStore,streamForUser}=require("../../src/paper/store");
const {createPaperService}=require("../../src/paper/service");
const {createResearchArchive}=require("../../src/archive/store");
const {observerConfig}=require("../../src/superagent/config");
const {createObserver}=require("../../src/superagent/observer");
const {createReportReader}=require("../../src/superagent/report");
const {assertSchema}=require("../../src/api/validation");
const {fixtureMarket,MINTS}=require("../fixtures/market");
const url=process.env.TEST_DATABASE_URL;

test("PostgreSQL observer: source-only reads, durable restart, atomic rollback, duplicates, delayed purchases, and isolation",{skip:!url},async()=>{
  const db=new Pool({connectionString:url}),name="observer_"+randomUUID().replaceAll("-",""),owner="observer-fixture-"+randomUUID();
  const targetUrl=new URL(url);targetUrl.pathname="/"+name;
  const role="report_"+randomUUID().replaceAll("-","");let reader,rolePool;
  const store=createStore(url),archive=createResearchArchive(url,{streamId:"observer-archive-"+randomUUID(),now:()=>Date.now()+1000}),observers=[];
  let target,workerEnv,config;
  const make=cfg=>{const observer=createObserver(cfg);observers.push(observer);return observer;};
  try{
    await db.query("CREATE DATABASE "+name);target=new Pool({connectionString:targetUrl.toString()});
    await store.init();await store.ensureAccount(owner);await archive.init();
    const market=await fixtureMarket(),service=createPaperService({store,market}),account=(await store.read(owner)).paper.account;
    const command=fields=>service.command(owner,{requestId:randomUUID(),createdAt:new Date().toISOString(),...fields});
    // 49 prior events force decision/intent/fill across the 50-event boundary.
    for(let i=0;i<49;i++){const view=await store.read(owner);await command({type:"cash",cashSol:.4,revision:view.revision});}
    const bought=await command({type:"buy",mint:MINTS[0],amount:1,automatic:false,feed:"recent"});assert.equal(bought.ok,true);
    await command({type:"sell",mint:MINTS[0],dollars:1,automatic:false});
    const purchaseEvents=(await store.listEvents(owner,{limit:10})).events;
    const boughtAt=Date.parse(purchaseEvents.find(e=>e.requestId===bought.execution.intentId&&e.type==="paper.execution.completed").occurredAt);
    const scanAt=boughtAt+1;
    // Archived provider sample already exists when ingestion begins. Source marks aren't live fetches.
    const receipt=await archive.record({kind:"market.scan",source:"market",occurredAt:scanAt,payload:{schemaVersion:1,
      scanAt:new Date(scanAt).toISOString(),radar:[{mint:MINTS[0],priceUsd:.02,observedAt:scanAt,priceFeed:"recent",isSus:false},
        {mint:MINTS[1],priceUsd:.99,observedAt:scanAt,priceFeed:"recent",isSus:false}]}});
    workerEnv={...process.env,SUPERAGENT_OBSERVER_ENABLED:"true",SUPERAGENT_SOURCE_ID:"fixture-source",SUPERAGENT_OWNER_ID:owner,
      SUPERAGENT_ACCOUNT_ID:account.accountId,SUPERAGENT_ARCHIVE_STREAM:archive.streamId,
      SUPERAGENT_EVENT_DATABASE_URL:url,SUPERAGENT_ARCHIVE_DATABASE_URL:url,SUPERAGENT_DATABASE_URL:targetUrl.toString()};
    config=observerConfig(workerEnv);let observer=make(config);
    reader=createReportReader(config);await assert.rejects(reader.report(),/does not exist/);
    assert.equal((await target.query("SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'superagent_%'")).rows[0].count,"0","report reads never initialize missing schema");
    await reader.close();reader=null;await observer.init();
    // A DB failure after copied evidence but before checkpoint must roll back both.
    await target.query("CREATE FUNCTION fixture_abort_checkpoint() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''fixture abort''; END;'");
    await target.query("CREATE TRIGGER fixture_abort BEFORE UPDATE ON superagent_observer_scopes FOR EACH ROW EXECUTE FUNCTION fixture_abort_checkpoint()");
    await assert.rejects(observer.step(),/fixture abort/);
    assert.equal(Number((await target.query("SELECT count(*) FROM superagent_observer_events")).rows[0].count),0);
    await target.query("DROP TRIGGER fixture_abort ON superagent_observer_scopes");
    const first=await observer.step();assert.equal(first.verifiedThrough,50);assert.equal(first.purchases,0);
    await observer.close();observers.splice(observers.indexOf(observer),1);
    // Real process exit immediately after a committed step, without delivering an acknowledgment.
    await promisify(execFile)(process.execPath,["-e",`const {observerConfig}=require('./src/superagent/config');const {createObserver}=require('./src/superagent/observer');
      const observer=createObserver(observerConfig());observer.step().then(()=>process.exit(0)).catch(()=>process.exit(1));`],
      {cwd:require("node:path").resolve(__dirname,"../.."),env:workerEnv,timeout:30000});
    observer=make(config);const result=await observer.run();assert.equal(result.complete,true);
    const report=await observer.report();assert.equal(report.purchases.length,1);assert.equal(report.outcomes.length,2);
    assert.equal(report.purchases[0].executionMode,"paper");assert.equal(report.purchases[0].references.length,3);
    const mark=report.outcomes.find(row=>row.classification==="observed-market-mark");
    assert.equal(mark.reference.recordHash,receipt.recordHash);assert.ok(mark.priceRatioToEntry>1);assert.equal(mark.asset,MINTS[0]);
    assert.equal(report.hypotheses.length,0);assert.equal(report.predictiveImprovement,"not evaluated");
    assertSchema("superagentReport",report);
    // A real SELECT-only login can serve the report without migrations or ingestion rights.
    await db.query("CREATE ROLE "+role+" LOGIN PASSWORD 'fixture_only'");
    await target.query("GRANT CONNECT ON DATABASE "+name+" TO "+role);
    await target.query("GRANT USAGE ON SCHEMA public TO "+role);
    await target.query("GRANT SELECT ON superagent_observer_scopes,superagent_observer_purchases,superagent_observer_outcomes TO "+role);
    const readUrl=new URL(targetUrl);readUrl.username=role;readUrl.password="fixture_only";
    reader=createReportReader({...config,databaseUrl:readUrl.toString()});
    assert.deepEqual(await reader.report(),report);await reader.close();reader=createReportReader({...config,databaseUrl:readUrl.toString()});
    assert.deepEqual(await reader.report(),report,"reader restart leaves checkpoint and observations unchanged");
    rolePool=new Pool({connectionString:readUrl.toString()});
    await assert.rejects(rolePool.query("UPDATE superagent_observer_scopes SET event_sequence=0"),/permission denied/);
    await assert.rejects(rolePool.query("SELECT * FROM superagent_observer_events"),/permission denied/);
    const session=await store.createSession(owner);assert.deepEqual(await store.reportIdentity(session),{userId:owner,accountId:account.accountId,executionMode:"paper"});
    assert.equal(await store.reportIdentity("invalid-session"),null);await store.logout(session);assert.equal(await store.reportIdentity(session),null);
    await observer.run();assert.deepEqual(await observer.report(),report,"a lost acknowledgment/restart must not duplicate observations");
    await Promise.all([observer.run(),make(config).run()]);
    assert.deepEqual(await observer.report(),report,"concurrent workers share the durable scope lock");
    const firstOutcome=report.outcomes[0],firstAt=firstOutcome.observedAt??firstOutcome.occurredAt;
    assert.equal((await observer.report({outcomeAfter:{at:firstAt,purchaseId:firstOutcome.purchaseId,sourceKey:firstOutcome.sourceKey}})).outcomes.length,1);
    await assert.rejects(target.query("DELETE FROM superagent_observer_outcomes"),/append-only/);
    await assert.rejects(target.query("TRUNCATE superagent_observer_purchases CASCADE"),/append-only/);
    const ledgerBefore=await store.read(owner),eventHeadBefore=await store.verifyEvents(owner),archiveHeadBefore=await archive.head();
    await observer.run();assert.deepEqual(await store.read(owner),ledgerBefore);assert.deepEqual(await store.verifyEvents(owner),eventHeadBefore);
    assert.deepEqual(await archive.head(),archiveHeadBefore,"observer must never mutate BecsBot source history");
    // A forged/truncated mutable source head fails without advancing the observer cursor.
    const stream=streamForUser(owner),head=(await db.query("SELECT * FROM becs_event_streams WHERE stream_id=$1",[stream])).rows[0];
    try{
      await db.query("UPDATE becs_event_streams SET head_sequence=head_sequence+1,event_count=event_count+1 WHERE stream_id=$1",[stream]);
      await assert.rejects(observer.step(),/event_chain_incomplete/);assert.deepEqual(await observer.report(),report);
    }finally{await db.query("UPDATE becs_event_streams SET head_sequence=$2,event_count=$3 WHERE stream_id=$1",[stream,head.head_sequence,head.event_count]);}
    await assert.rejects(make(observerConfig({...workerEnv,SUPERAGENT_ACCOUNT_ID:"another-account"})).run(),/source_owner_account_mismatch/);
    const otherOwner="observer-other-"+randomUUID();await store.ensureAccount(otherOwner);
    const otherAccount=(await store.read(otherOwner)).paper.account.accountId;
    const isolated=make(observerConfig({...workerEnv,SUPERAGENT_OWNER_ID:otherOwner,SUPERAGENT_ACCOUNT_ID:otherAccount}));
    await isolated.run();assert.equal((await isolated.report()).purchases.length,0);assert.equal((await isolated.report()).outcomes.length,0);
    // A late-recorded purchase forces archive replay, including earlier already-checkpointed marks.
    const view=await store.read(owner);await command({type:"reset",cashSol:.4,revision:view.revision});
    let release,notify;const waiting=new Promise(resolve=>{release=resolve;}),evaluated=new Promise(resolve=>{notify=resolve;});
    const delayedStore={...store,command:(user,input,fingerprint,evaluate,now)=>store.command(user,input,fingerprint,async paper=>{
      const result=await evaluate(paper);notify(result);await waiting;return result;
    },now)};
    const delayedService=createPaperService({store:delayedStore,market});
    const pendingBuy=delayedService.command(owner,{requestId:randomUUID(),createdAt:new Date().toISOString(),type:"buy",mint:MINTS[1],amount:1,automatic:false,feed:"recent"});
    try{
      const pendingResult=await evaluated;assert.equal(pendingResult.ok,true);
      const laterAt=Date.parse(pendingResult.execution.completedAt)+1;
      await archive.record({kind:"market.scan",source:"market",occurredAt:laterAt,payload:{schemaVersion:1,scanAt:new Date(laterAt).toISOString(),
        radar:[{mint:MINTS[1],priceUsd:.03,observedAt:laterAt,priceFeed:"recent",isSus:false}]}});
      await observer.run();assert.equal((await observer.report()).coverage.archiveVerifiedThrough,2);
      assert.equal((await observer.report()).purchases.length,1,"the pending source transaction is invisible to ingestion");
    }finally{release();await pendingBuy;}
    await observer.step();assert.equal((await observer.report()).coverage.archiveVerifiedThrough,0);
    await observer.run();const after=await observer.report();assert.equal(after.purchases.length,2);
    assert.equal(after.outcomes.length,3,"archive replay retains each source outcome once");
    const secondPage=await observer.report({purchaseAfter:after.purchases[0].sequence});
    assert.equal(secondPage.purchases.length,1);assert.equal(secondPage.purchases[0].asset,MINTS[1]);
    assert.equal(after.outcomes.filter(o=>o.classification==="observed-market-mark"&&o.asset===MINTS[1]).length,1);
    assert.equal(after.outcomes.filter(o=>o.classification==="recorded-paper-sale").length,1,"reset does not fabricate exits");
    // A report cannot be rebound to another source/contract while retaining the same scope.
    await assert.rejects(make({...config,archiveStream:"changed"}).report(),/observer_scope_unavailable/);
    // Permanent history beyond one page remains reachable through independent cursors.
    for(let i=0;i<101;i++)await archive.record({kind:"market.scan",source:"market",occurredAt:scanAt+i+1,payload:{schemaVersion:1,
      scanAt:new Date(scanAt+i+1).toISOString(),radar:[{mint:MINTS[0],priceUsd:.02,observedAt:scanAt+i+1,priceFeed:"recent",isSus:false}]}});
    while(!(await observer.run()).complete){}
    const page=assertSchema("superagentReport",await reader.report());assert.equal(page.outcomes.length,100);assert.ok(page.nextOutcomeAfter);
    const tail=assertSchema("superagentReport",await reader.report({outcomeAfter:page.nextOutcomeAfter}));assert.equal(tail.outcomes.length,4);
    assert.equal(tail.nextOutcomeAfter,null);assert.equal(new Set([...page.outcomes,...tail.outcomes].map(o=>o.purchaseId+o.sourceKey)).size,104);
    assert.deepEqual(tail.purchases,page.purchases,"outcome pagination never advances purchases");
  }finally{
    await Promise.all([reader?.close(),rolePool?.end()]);
    await Promise.all(observers.map(observer=>observer.close()));
    await Promise.all([store.close(),archive.close(),target?.end()]);
    await db.query("DROP DATABASE IF EXISTS "+name+" WITH (FORCE)");await db.query("DROP ROLE IF EXISTS "+role);await db.end();
  }
});
