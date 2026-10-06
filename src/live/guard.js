const crypto=require("node:crypto");

function canonical(value){return JSON.stringify(value,Object.keys(value).sort());}
function signature(intent){return crypto.createHash("sha256").update(canonical(intent)).digest("hex");}

function reject(reason,message){return {ok:false,reason,message};}

function createLiveExecutionGuard({config,now=Date.now}={}) {
  if(!config)throw Error("Live execution config is required");
  const receipts=new Map();

  function remember(intent,result) {
    receipts.set(intent.intentId,{signature:signature(intent),result:structuredClone(result)});
    while(receipts.size>config.receiptLimit)receipts.delete(receipts.keys().next().value);
  }

  function check(intent,context={}) {
    if(!config.enabled)return reject("live-disabled","Live execution is disabled");
    if(!intent||typeof intent!=="object")return reject("invalid-intent","Order intent is required");
    if(intent.accountId!==config.accountId)return reject("wrong-account","Intent account is not authorized for live execution");
    if(context.walletPublicKey!==config.walletPublicKey)return reject("wrong-wallet","Live wallet does not match configured wallet");
    const created=Date.parse(intent.createdAt);
    if(!Number.isFinite(created)||created>now()+30000||now()-created>config.intentMaxAgeMs)
      return reject("stale-intent","Order intent is stale or invalid");
    const prior=receipts.get(intent.intentId);
    if(prior) {
      if(prior.signature!==signature(intent))return reject("intent-conflict","Intent ID was reused with different fields");
      return {ok:false,reason:"duplicate-intent",message:"Intent already completed",duplicateResult:structuredClone(prior.result)};
    }
    if(context.emergencyStop===true)return reject("emergency-stop","Emergency stop is active");
    if(context.marketFresh!==true)return reject("stale-market","Fresh market context is required");
    if(!Number.isFinite(context.solBalance)||context.solBalance<config.minSolReserve)
      return reject("reserve","Configured SOL reserve is unavailable");
    if(!Number.isInteger(context.openPositions)||context.openPositions<0)
      return reject("positions","Open position count is unavailable");
    if(intent.side==="buy"&&context.openPositions>=config.maxOpenPositions)
      return reject("position-limit","Maximum open positions reached");
    if(intent.quantity?.mode==="quote"&&intent.quantity?.unit==="USD"&&
      (!Number.isFinite(intent.quantity.value)||intent.quantity.value<=0||intent.quantity.value>config.maxOrderUsd))
      return reject("size-limit","Order exceeds configured live size limit");
    if(!Number.isInteger(context.slippageBps)||context.slippageBps<1||context.slippageBps>config.maxSlippageBps)
      return reject("slippage","Slippage exceeds configured live limit");
    if(intent.side==="sell"&&context.hasPosition!==true)
      return reject("position","Sell intent has no owned live position");
    return {ok:true};
  }

  return {check,remember,receipt:(id)=>receipts.get(id)?.result||null};
}

module.exports={createLiveExecutionGuard};
