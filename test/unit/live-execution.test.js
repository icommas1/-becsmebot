const test=require("node:test");
const assert=require("node:assert/strict");
const {liveConfig}=require("../../src/live/config");
const {createLiveExecutionGuard}=require("../../src/live/guard");
const {createLiveExecutor}=require("../../src/live/executor");

function intent(overrides={}) {
  return {intentId:"i-1",accountId:"acct-live",createdAt:new Date(100000).toISOString(),asset:"mint",
    side:"buy",quantity:{value:1,mode:"quote",unit:"USD"},...overrides};
}
function context(overrides={}) {
  return {walletPublicKey:"wallet",marketFresh:true,solBalance:1,openPositions:0,
    slippageBps:100,hasPosition:false,...overrides};
}

test("live config defaults disabled and requires no signer",()=>{
  assert.equal(liveConfig({}).enabled,false);
});

test("enabled live config fails closed without dedicated wallet secret",()=>{
  assert.throws(()=>liveConfig({LIVE_EXECUTION_ENABLED:"true",LIVE_ACCOUNT_ID:"acct-live",LIVE_WALLET_PUBLIC_KEY:"wallet"}),
    /SOLANA_PRIVATE_KEY/);
});

test("guard blocks disabled execution",()=>{
  const guard=createLiveExecutionGuard({config:{...liveConfig({}),accountId:"acct-live",walletPublicKey:"wallet"},now:()=>100000});
  assert.equal(guard.check(intent(),context()).reason,"live-disabled");
});

test("guard enforces account wallet freshness reserve positions size and slippage",()=>{
  const config={enabled:true,accountId:"acct-live",walletPublicKey:"wallet",maxOrderUsd:5,maxOpenPositions:2,
    minSolReserve:.05,maxSlippageBps:200,intentMaxAgeMs:30000,receiptLimit:500};
  const guard=createLiveExecutionGuard({config,now:()=>100000});
  assert.equal(guard.check(intent({accountId:"other"}),context()).reason,"wrong-account");
  assert.equal(guard.check(intent(),context({walletPublicKey:"other"})).reason,"wrong-wallet");
  assert.equal(guard.check(intent({createdAt:new Date(1).toISOString()}),context()).reason,"stale-intent");
  assert.equal(guard.check(intent(),context({emergencyStop:true})).reason,"emergency-stop");
  assert.equal(guard.check(intent(),context({marketFresh:false})).reason,"stale-market");
  assert.equal(guard.check(intent(),context({solBalance:.01})).reason,"reserve");
  assert.equal(guard.check(intent(),context({openPositions:2})).reason,"position-limit");
  assert.equal(guard.check(intent({quantity:{value:6,mode:"quote",unit:"USD"}}),context()).reason,"size-limit");
  assert.equal(guard.check(intent(),context({slippageBps:201})).reason,"slippage");
  assert.equal(guard.check(intent({side:"sell"}),context()).reason,"position");
  assert.equal(guard.check(intent(),context()).ok,true);
});

test("executor is idempotent after a successful fill",async()=>{
  const config={enabled:true,accountId:"acct-live",walletPublicKey:"wallet",maxOrderUsd:5,maxOpenPositions:2,
    minSolReserve:.05,maxSlippageBps:200,intentMaxAgeMs:30000,receiptLimit:500};
  const guard=createLiveExecutionGuard({config,now:()=>100000});
  let orders=0,executes=0;
  const executor=createLiveExecutor({guard,
    order:async()=>{orders++;return {transaction:"tx",requestId:"r1"};},
    sign:async()=> "signed",
    execute:async()=>{executes++;return {status:"Success",signature:"sig"};}
  });
  const first=await executor.execute(intent(),context());
  const second=await executor.execute(intent(),context());
  assert.equal(first.status,"filled");assert.deepEqual(second,first);
  assert.equal(orders,1);assert.equal(executes,1);
});
