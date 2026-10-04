const test=require("node:test"),assert=require("node:assert/strict");
const {randomUUID}=require("node:crypto");
const {createEventDraft,materializeEvent}=require("../../src/events/becs-event");
const {observerConfig,CONTRACT_REVISION}=require("../../src/superagent/config");
const {projectEvent,observedFill,archivedMarks}=require("../../src/superagent/evidence");
const {MINTS}=require("../fixtures/market");
const env={SUPERAGENT_OBSERVER_ENABLED:"true",SUPERAGENT_SOURCE_ID:"fixture",SUPERAGENT_OWNER_ID:"owner-a",SUPERAGENT_ACCOUNT_ID:"account-a",
  SUPERAGENT_ARCHIVE_STREAM:"archive",SUPERAGENT_DATABASE_URL:"postgresql://fixture/target",SUPERAGENT_EVENT_DATABASE_URL:"postgresql://fixture/source",
  SUPERAGENT_ARCHIVE_DATABASE_URL:"postgresql://fixture/source"};
function events(){
  const requestId=randomUUID(),accountId="account-a",strategy={id:"launch-v1",version:"1"},createdAt=new Date(100000).toISOString();
  const drafts=[
    {type:"decision.evaluated",payload:{decision:{side:"buy",reason:"manual-buy",source:"manual",automatic:false},secret:"never-copy"}},
    {type:"order.intent.created",payload:{intentId:requestId,accountId,asset:MINTS[0],side:"buy",strategy,createdAt,
      quantity:{value:1,mode:"quote",unit:"USD",secret:"never-copy"}}},
    {type:"paper.execution.completed",occurredAt:100100,payload:{intentId:requestId,accountId,executionMode:"paper",status:"filled",filledQuantity:100,
      filledQuoteQuantity:1,fillPrice:.01,fees:{amount:.001,currency:"USD"},createdAt,completedAt:new Date(100100).toISOString()}}
  ];
  let previousHash=null;
  return drafts.map((draft,i)=>{
    const event=materializeEvent({draft:createEventDraft({source:"paper-service",occurredAt:100000,requestId,accountId,strategy,...draft}),
      streamId:"fixture",sequence:i+1,previousHash});previousHash=event.eventHash;return event;
  });
}
test("observer configuration defaults off, requires explicit scoped databases, and contains no live switch",()=>{
  assert.deepEqual(observerConfig({}),{enabled:false});
  const config=observerConfig(env);assert.equal(config.executionMode,"paper");assert.equal(config.contractRevision,CONTRACT_REVISION);
  assert.notEqual(config.scopeId,observerConfig({...env,SUPERAGENT_OWNER_ID:"owner-b"}).scopeId);
  assert.notEqual(config.scopeId,observerConfig({...env,SUPERAGENT_ACCOUNT_ID:"account-b"}).scopeId);
  for(const key of Object.keys(env).filter(key=>key!=="SUPERAGENT_OBSERVER_ENABLED"))assert.throws(()=>observerConfig({...env,[key]:""}));
  assert.throws(()=>observerConfig({...env,SUPERAGENT_DATABASE_URL:env.SUPERAGENT_EVENT_DATABASE_URL}),/separate_observer/);
  assert.throws(()=>observerConfig({...env,SUPERAGENT_DATABASE_URL:"postgres://different-role@fixture:5432/source?sslmode=require"}),/separate_observer/);
  assert.throws(()=>observerConfig({...env,SUPERAGENT_DATABASE_URL:"https://not-a-database"}),/invalid_observer_database/);
});
test("observer copies a correlated recorded purchase with paper provenance and source references; no arbitrary payload fields",()=>{
  const projected=events().map(event=>projectEvent(event,{accountId:"account-a"}));
  const purchase=observedFill(...projected);
  assert.equal(purchase.classification,"recorded-paper-purchase");assert.equal(purchase.executionMode,"paper");
  assert.equal(purchase.asset,MINTS[0]);assert.equal(purchase.references.length,3);
  assert.equal(JSON.stringify(purchase).includes("never-copy"),false);
  assert.equal(projectEvent(events()[0],{accountId:"account-b"}),null);
  assert.throws(()=>observedFill(undefined,projected[1],projected[2]),/missing_purchase_context/);
  assert.throws(()=>observedFill({...projected[0],requestId:randomUUID()},projected[1],projected[2]),/conflicting_purchase_context/);
  assert.throws(()=>observedFill(projected[0],projected[1],{...projected[2],occurredAt:100099}),/invalid_fill_timestamp/);
});
test("corrupted evidence and forged live provenance fail closed",()=>{
  const e=events()[2];assert.throws(()=>projectEvent({...e,payload:{...e.payload,fillPrice:999}},{accountId:"account-a"}),/invalid_observed_event/);
  const live=materializeEvent({draft:createEventDraft({type:e.type,source:e.source,payload:{...e.payload,executionMode:"live"},
    requestId:e.requestId,accountId:e.accountId,strategy:e.strategy}),streamId:e.streamId,sequence:1});
  assert.throws(()=>projectEvent(live,{accountId:"account-a"}),/unsupported_execution_provenance/);
});
test("archive outcomes accept only canonical, positive, nonsuspicious, timely observed prices and reject ambiguous/future scans",()=>{
  const record={occurred_at:500000,captured_at:500001},row={mint:MINTS[0],priceUsd:.02,priceFeed:"recent",isSus:false,observedAt:499000};
  const payload={schemaVersion:1,scanAt:new Date(500000).toISOString(),radar:[row]};
  assert.equal(archivedMarks(payload,record).length,1);
  for(const change of [{isSus:true},{observedAt:500001},{observedAt:1},{priceUsd:0},{priceUsd:NaN},{mint:"bad"},{priceFeed:null}])
    assert.deepEqual(archivedMarks({...payload,radar:[{...row,...change}]},record),[]);
  assert.throws(()=>archivedMarks({...payload,radar:[row,{...row,priceUsd:.03}]},record),/ambiguous_archived_mark/);
  assert.throws(()=>archivedMarks(payload,{...record,captured_at:499999}),/conflicting_market_timestamp/);
  assert.throws(()=>archivedMarks({...payload,schemaVersion:2},record),/unsupported_market_archive_contract/);
});
