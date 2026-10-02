const test=require("node:test"),assert=require("node:assert/strict");
const {randomUUID}=require("node:crypto"),{Client}=require("pg");
const {verifyDatabase}=require("../../src/operations/verify-storage");
const {createResearchArchive}=require("../../src/archive/store");
const {createStore,streamForUser}=require("../../src/paper/store");
const {createPaperService}=require("../../src/paper/service");
const {createEventDraft,materializeEvent}=require("../../src/events/becs-event");
const {fixtureMarket,MINTS}=require("../fixtures/market");
const url=process.env.TEST_DATABASE_URL;

test("PostgreSQL: read-only verifier covers old events past the web window, proofs, paper state and research",{skip:!url},async()=>{
  const admin=new Client({connectionString:url});await admin.connect();
  const schema="verification_"+randomUUID().replaceAll("-","");
  await admin.query("CREATE SCHEMA "+schema);
  const scoped=new URL(url);scoped.searchParams.set("options","-c search_path="+schema);
  const client=new Client({connectionString:scoped.href}),archive=createResearchArchive(scoped.href),store=createStore(scoped.href);
  try{
    await client.connect();await archive.init();await store.ensureAccount("restore-fixture");
    await archive.record({kind:"market.scan",source:"fixture",payload:{price:1,evidence:[1,2,3]}});
    await archive.record({kind:"market.scan",source:"fixture",payload:{price:1,evidence:[1,2,3]}});
    const service=await createPaperService({store,market:await fixtureMarket()});
    await service.command("restore-fixture",{type:"buy",mint:MINTS[0],amount:1,automatic:false,feed:"recent",requestId:randomUUID(),createdAt:new Date().toISOString()});
    await store.sealEvents("restore-fixture");
    const stream="long-fixture",events=[];let previousHash=null;
    const draft=createEventDraft({type:"fixture",source:"test",payload:{kept:true}});
    for(let sequence=1;sequence<=5001;sequence++){
      const e=materializeEvent({draft,streamId:stream,sequence,previousHash});previousHash=e.eventHash;events.push(e);
    }
    await client.query("INSERT INTO becs_event_streams VALUES($1,$2,$3,$2)",[stream,events.length,previousHash]);
    await client.query(`INSERT INTO becs_events(event_id,stream_id,sequence,occurred_at,type,source,schema_version,payload,payload_hash,previous_hash,event_hash)
      SELECT (e->>'eventId')::uuid,e->>'streamId',(e->>'sequence')::bigint,(e->>'occurredAt')::bigint,e->>'type',e->>'source',
      (e->>'schemaVersion')::integer,e->'payload',e->>'payloadHash',e->>'previousHash',e->>'eventHash' FROM jsonb_array_elements($1::jsonb) e`,[JSON.stringify(events)]);
    const query=client.query.bind(client),seen=[];
    client.query=(sql,args)=>{assert.match(sql,/^(SELECT|BEGIN|COMMIT|ROLLBACK)\b/);seen.push(sql);return query(sql,args);};
    const first=await verifyDatabase(client,{pageSize:37}),second=await verifyDatabase(client,{pageSize:100});
    assert.deepEqual(second,first,"page boundaries must not change the restored-state fingerprint");
    assert.equal(first.events.records,5004);assert.equal(first.events.proofs,1);assert.equal(first.events.unprovedEvents,5001);
    assert.equal(first.research.records,2);assert.equal(first.research.payloads,1);
    assert.equal(first.paper.accounts,1);assert.equal(first.paper.receipts,1);
    assert.ok(seen.some(sql=>sql==="BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"));
    client.query=query;
    await client.query("UPDATE becs_event_streams SET head_hash=$2 WHERE stream_id=$1",[streamForUser("restore-fixture"),"0".repeat(64)]);
    await assert.rejects(verifyDatabase(client),{integrityCode:"invalid_event_head"});
    const state=await client.query("SELECT current_setting('transaction_read_only') AS value");
    assert.equal(state.rows[0].value,"off","failed verification rolls back its read-only transaction");
  }finally{
    await Promise.all([archive.close(),store.close(),client.end()]);
    await admin.query("DROP SCHEMA "+schema+" CASCADE");await admin.end();
  }
});
