const test=require("node:test"),assert=require("node:assert/strict");
const {row,now,solRate}=require("../fixtures/paper-baseline.json");
const modules=Promise.all([
  import("../../src/web/assets/js/trading/decision-engine.mjs"),
  import("../../src/web/assets/js/trading/paper-executor.mjs"),
  import("../../src/web/assets/js/paper-wallet.mjs")
]);

test("filled buy and partial sale replay without another ledger mutation, including after reload",async()=>{
  const [engine,executor,wallet]=await modules,paper=wallet.freshPaper();
  const buy=engine.decideBuy({account:paper.account,row,amount:1,settings:paper.settings,enteredAssets:paper.bought,now}).intents[0];
  const exec=executor.createPaperExecutor({account:paper.account,paper});
  const first=exec.execute(buy,{row,solRate,now});
  assert.equal(first.status,"filled");
  const afterBuy=structuredClone(paper);
  assert.deepEqual(exec.execute(buy,null),first); // A replay needs no market lookup.
  assert.deepEqual(paper,afterBuy);

  const sale=engine.decideSale({account:paper.account,positions:paper.holds,mint:row.mint,pct:100,dollars:1,now}).intents[0];
  const mark={priceUsd:.02,source:"jupiter-v3"};
  const sold=exec.execute(sale,{mark,markAt:now,solRate,now});
  assert.equal(sold.status,"filled");
  const afterSale=structuredClone(paper);
  assert.deepEqual(exec.execute(sale,{mark:null,solRate:null,now:now+120001}),sold);
  assert.deepEqual(paper,afterSale);
  const returned=exec.execute(sale,null);
  returned.requested.value=999;
  assert.deepEqual(exec.execute(sale,null),sold);

  let stored;
  const storage={getItem:()=>stored??null,setItem:(_key,value)=>{stored=value;}};
  assert.equal(wallet.savePaper(storage,paper),true);
  const reloaded=wallet.loadPaper(storage);
  assert.equal(reloaded.account.accountId,paper.account.accountId);
  const replayed=executor.createPaperExecutor({account:reloaded.account,paper:reloaded}).execute(sale,null);
  assert.deepEqual(replayed,sold);
  assert.deepEqual(reloaded,{...paper,auto:false});
});

test("intent ID collision rejects a changed request, while a rejected fill can be retried",async()=>{
  const [engine,executor,wallet]=await modules,paper=wallet.freshPaper();
  const exec=executor.createPaperExecutor({account:paper.account,paper});
  const intent=engine.decideBuy({account:paper.account,row,amount:1,settings:paper.settings,enteredAssets:paper.bought,now}).intents[0];
  assert.equal(exec.execute(intent,{row,solRate:null,now}).status,"rejected");
  const filled=exec.execute(intent,{row,solRate,now});
  assert.equal(filled.status,"filled");
  const before=structuredClone(paper);
  assert.equal(exec.execute({...intent,quantity:{...intent.quantity,value:5}},{row,solRate,now}).reason,"intent-id-conflict");
  assert.deepEqual(paper,before);
  assert.equal(exec.execute({...intent,userId:"another-user"},{row,solRate,now}).reason,"ownership-mismatch");
  assert.deepEqual(paper,before);
  paper.receipts[0].result.accountId="different-account";
  const corrupt=structuredClone(paper);
  assert.equal(exec.execute(intent,{row,solRate,now}).reason,"invalid-ledger");
  assert.deepEqual(paper,corrupt);
});

test("the paper receipt journal is bounded and older activity and holds migrate intact",async()=>{
  const [engine,executor,wallet]=await modules,paper=wallet.freshPaper();
  paper.settings.feeSol=0;
  const exec=executor.createPaperExecutor({account:paper.account,paper});
  const buy=engine.decideBuy({account:paper.account,row,amount:1,settings:paper.settings,enteredAssets:paper.bought,now}).intents[0];
  assert.equal(exec.execute(buy,{row,solRate,now}).status,"filled");
  let latest;
  for(let i=0;i<501;i++){
    latest=engine.decideSale({account:paper.account,positions:paper.holds,mint:row.mint,pct:.1,now}).intents[0];
    assert.equal(exec.execute(latest,{mark:{priceUsd:.02,source:"jupiter-v3"},markAt:now,solRate,now}).status,"filled");
  }
  assert.equal(paper.receipts.length,executor.MAX_PAPER_RECEIPTS);
  assert.equal(paper.receipts.some(receipt=>receipt.intentId===buy.intentId),false);
  assert.equal(paper.receipts.at(-1).intentId,latest.intentId);
  assert.equal(paper.activity.length,500);
  assert.ok(paper.holds[row.mint].qty>0);
  const legacy={...paper};delete legacy.receipts;
  const restored=wallet.loadPaper({getItem:()=>JSON.stringify(legacy)});
  assert.deepEqual(restored.holds,legacy.holds);
  assert.deepEqual(restored.activity,legacy.activity);
  assert.deepEqual(restored.receipts,[]);
});
