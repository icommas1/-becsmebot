const test=require("node:test"),assert=require("node:assert/strict");
const baseline=require("../fixtures/paper-baseline.json");
const modules=Promise.all([
  import("../../src/web/assets/js/trading/decision-engine.mjs"),
  import("../../src/web/assets/js/trading/contracts.mjs"),
  import("../../src/web/assets/js/trading/paper-executor.mjs"),
  import("../../src/web/assets/js/trading/paper-pipeline.mjs"),
  import("../../src/web/assets/js/paper-wallet.mjs")
]);
const {row,now,solRate}=baseline;
function freeze(value) {
  if(value&&typeof value==="object") {Object.freeze(value);Object.values(value).forEach(freeze);}
  return value;
}

// Recorded from production main aeb73d2 before this refactor, including the
// old dashboard's target-exit flag. These are outcomes, not copied formulas.
for(const scenario of baseline.scenarios)test("production equivalence: "+scenario.name,async()=>{
  const [,,,pipeline,wallet]=await modules,paper=wallet.freshPaper();
  Object.assign(paper.settings,scenario.settings);
  for(const [index,op] of scenario.operations.entries()) {
    const result=op.kind==="buy"?pipeline.buyPaper({paper,row,amount:op.amount,automatic:!!op.automatic,solRate,feed:"recent",now}):
      pipeline.sellPaper({paper,mint:row.mint,pct:op.pct??100,dollars:op.dollars??null,automatic:!!op.automatic,
        solRate,mark:{priceUsd:op.price,source:op.source??"jupiter-v3"},markAt:now-(op.markAge??0),marketCap:50000,now});
    const {execution,...presentation}=result;
    assert.deepEqual(presentation,scenario.outcomes[index],"operation "+index);
    if(execution)assert.equal(execution.status,result.ok?"filled":"rejected");
  }
  const {account,...ledger}=paper;
  for(const entry of ledger.activity)if(entry.kind==="sell"){
    assert.ok(entry.basisUsd>0);
    assert.ok(entry.netUsd>=0);
    assert.ok(Math.abs(entry.realizedUsd-(entry.netUsd-entry.basisUsd))<1e-10);
    assert.equal(entry.entryCap,row.marketCap);
  }
  const baselineLedger=structuredClone(ledger);
  for(const entry of baselineLedger.activity)if(entry.kind==="sell")
    for(const field of ["basisUsd","netUsd","realizedUsd","entryCap"])delete entry[field];
  assert.deepEqual(baselineLedger,scenario.ledger);
  assert.equal(account.executionMode,"paper");
});

test("decisions are immutable, scoped and contain no execution objects",async()=>{
  const [engine,contracts,,,wallet]=await modules,paper=freeze(wallet.freshPaper());
  const args=freeze({account:paper.account,row:{...row},settings:paper.settings,enteredAssets:paper.bought,
    amount:1,solRate,feed:"recent",now});
  const before=structuredClone(args),decision=engine.decideBuy(args);
  assert.deepEqual(args,before);
  const [intent]=decision.intents;
  assert.equal(intent.userId,paper.account.userId);assert.equal(intent.accountId,paper.account.accountId);
  assert.equal(intent.strategy.id,"launch-v1");assert.equal(intent.strategy.version,"1");
  assert.deepEqual(intent.quantity,{value:1,mode:"quote",unit:"USD"});
  assert.equal(Object.isFrozen(intent),true);assert.equal(Object.isFrozen(intent.context),true);
  assert.equal(contracts.validOrderIntent(JSON.parse(JSON.stringify(intent))),true);
  assert.notEqual(engine.decideBuy(args).intents[0].intentId,intent.intentId);
  assert.equal(contracts.validOrderIntent({...intent,transaction:{instructions:[]}}),false);
  assert.equal(contracts.validOrderIntent({...intent,quantity:{...intent.quantity,route:[]}}),false);
  assert.deepEqual(engine.decideBuy({...args,amount:0}).intents,[]);
  // Strategy can express the same request for a future live account. No live
  // executor exists, and execution mode is not part of the provider-neutral intent.
  const live=engine.decideBuy({...args,account:{...args.account,executionMode:"live"}}).intents[0];
  assert.equal("executionMode" in live,false);
});

test("auto decisions preserve source, filters, buy-once and one-time target rules",async()=>{
  const [engine,,,,wallet]=await modules,paper=wallet.freshPaper();
  const other={...row,mint:"other",feeds:["organic:5m"]};
  const args=freeze({enabled:true,rows:[row,other,{...row,mint:"stale",observedAt:now-180001}],
    settings:paper.settings,radarUi:{tab:"recent",source:"5m"},enteredAssets:{},now});
  assert.deepEqual(engine.autoBuyCandidates(args),[row]);
  assert.deepEqual(engine.autoBuyCandidates({...args,enabled:false}),[]);
  assert.deepEqual(engine.autoBuyCandidates({...args,enteredAssets:{[row.mint]:true}}),[]);
  assert.deepEqual(engine.autoBuyCandidates({...args,radarUi:{tab:"organic",source:"5m"}}),[other]);
  const positions=freeze({[row.mint]:{mint:row.mint,entryPrice:.01},done:{mint:"done",entryPrice:.01,autoExited:true}});
  const exits=freeze({enabled:true,positions,settings:{exitMultiple:2},prices:{[row.mint]:{priceUsd:.02},done:{priceUsd:1}}});
  assert.deepEqual(engine.autoExitCandidates(exits),[positions[row.mint]]);
  assert.deepEqual(engine.autoExitCandidates({...exits,settings:{exitMultiple:1}}),[]);
});

test("separate users and accounts cannot execute into each other's ledger",async()=>{
  const [engine,,executor,,wallet]=await modules,a=wallet.freshPaper(),b=wallet.freshPaper();
  b.account.userId=a.account.userId; // one user with two trading accounts
  const intent=engine.decideBuy({account:a.account,row,amount:1,settings:a.settings,enteredAssets:a.bought,solRate,now}).intents[0];
  const before=structuredClone(b),otherExecutor=executor.createPaperExecutor({account:b.account,paper:b});
  assert.equal(otherExecutor.execute(intent,{row,solRate,now}).reason,"ownership-mismatch");
  assert.deepEqual(b,before);
  b.account.accountId=a.account.accountId;b.account.userId="another-user";
  assert.equal(otherExecutor.execute(intent,{row,solRate,now}).reason,"ownership-mismatch");
  const ownExecutor=executor.createPaperExecutor({account:a.account,paper:a});
  const result=ownExecutor.execute(intent,{row,solRate,now});
  assert.equal(result.status,"filled");assert.equal(result.intentId,intent.intentId);
  assert.equal(result.executionMode,"paper");assert.deepEqual(result.requested,intent.quantity);
  assert.equal(result.filledQuantity,100);assert.equal(result.filledQuoteQuantity,1);
  assert.equal(result.fillPrice,.01);assert.deepEqual(result.fees,{amount:.001,currency:"USD"});
  assert.equal(Object.keys(b.holds).length,0);
});

test("executor rechecks market data, reserve and disabled execution before mutation",async()=>{
  const [engine,,executor,,wallet]=await modules,paper=wallet.freshPaper();
  const intent=engine.decideBuy({account:paper.account,row,amount:1,settings:paper.settings,enteredAssets:paper.bought,solRate,now}).intents[0];
  const before=structuredClone(paper),exec=executor.createPaperExecutor({account:paper.account,paper});
  assert.equal(exec.execute(intent,{row,solRate,now:now+180001}).status,"rejected");
  assert.equal(exec.execute(intent,{row,solRate:null,now}).message,"Need a current SOL and token price for a paper buy.");
  assert.equal(exec.execute(intent,{row:{...row,observedAt:now+1},solRate,now}).status,"rejected");
  assert.equal(exec.execute({...intent,transaction:{}},{row,solRate,now}).reason,"invalid-intent");
  assert.deepEqual(paper,before);
  paper.cashSol=.02;
  assert.equal(exec.execute(intent,{row,solRate,now}).message,"Paper cash would fall below your SOL reserve.");
  assert.equal(paper.cashSol,.02);assert.deepEqual(paper.holds,{});
  assert.throws(()=>executor.createPaperExecutor({account:{...paper.account,executionMode:"live"},paper}),/disabled/);
  paper.account.executionMode="live";
  assert.equal(exec.execute(intent,{row,solRate,now}).reason,"execution-disabled");
  assert.deepEqual(paper.holds,{});
});

test("sale intent stays separate from a capped fill and stale rejection",async()=>{
  const [engine,,executor,pipeline,wallet]=await modules,paper=wallet.freshPaper();
  pipeline.buyPaper({paper,row,amount:1,solRate,feed:"recent",now});
  const intent=engine.decideSale({account:paper.account,positions:paper.holds,mint:row.mint,pct:100,dollars:10,now}).intents[0];
  const exec=executor.createPaperExecutor({account:paper.account,paper}),before=structuredClone(paper);
  const rejected=exec.execute(intent,{mark:{priceUsd:.02,source:"jupiter-v3"},markAt:now-120001,solRate,now});
  assert.equal(rejected.status,"rejected");assert.equal(rejected.filledQuantity,0);assert.equal(rejected.fillPrice,null);
  assert.deepEqual(paper,before);
  const fill=exec.execute(intent,{mark:{priceUsd:.02,source:"jupiter-v3"},markAt:now,solRate,now});
  assert.equal(fill.requested.value,10);assert.equal(fill.filledQuoteQuantity,2);assert.equal(fill.filledQuantity,100);
  assert.equal(paper.holds[row.mint],undefined);assert.equal(intent.quantity.value,10);
});

test("legacy storage migration adds stable ownership without losing paper history",async()=>{
  const [,,,,wallet]=await modules,legacy=structuredClone(baseline.scenarios[0].ledger);
  let stored=JSON.stringify({...legacy,auto:true});
  const storage={getItem:()=>stored,setItem:(_key,value)=>{stored=value;}};
  const loaded=wallet.loadPaper(storage),{account,...ledger}=loaded;
  assert.deepEqual(ledger,legacy);assert.notEqual(account.userId,account.accountId);
  wallet.savePaper(storage,loaded);
  assert.deepEqual(wallet.loadPaper(storage).account,account);
  assert.notEqual(wallet.freshPaper().account.accountId,account.accountId);
});
