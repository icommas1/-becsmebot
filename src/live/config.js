const LIMITS=Object.freeze({
  maxOrderUsd:100,
  maxOpenPositions:10,
  minSolReserve:0.05,
  maxSlippageBps:500,
  intentMaxAgeMs:30000,
  receipts:500
});

function number(env,key,fallback,{min=0,max=Number.MAX_SAFE_INTEGER,integer=false}={}) {
  if(env[key]==null||env[key]==="")return fallback;
  const value=Number(env[key]);
  if(!Number.isFinite(value)||(integer&&!Number.isInteger(value))||value<min||value>max)
    throw Error(key+" is invalid");
  return value;
}

function liveConfig(env=process.env) {
  const enabled=env.LIVE_EXECUTION_ENABLED==="true";
  const config={
    enabled,
    accountId:(env.LIVE_ACCOUNT_ID||"").trim(),
    walletPublicKey:(env.LIVE_WALLET_PUBLIC_KEY||"").trim(),
    maxOrderUsd:number(env,"LIVE_MAX_ORDER_USD",LIMITS.maxOrderUsd,{min:1,max:10000}),
    maxOpenPositions:number(env,"LIVE_MAX_OPEN_POSITIONS",LIMITS.maxOpenPositions,{min:1,max:100,integer:true}),
    minSolReserve:number(env,"LIVE_MIN_SOL_RESERVE",LIMITS.minSolReserve,{min:0.001,max:100}),
    maxSlippageBps:number(env,"LIVE_MAX_SLIPPAGE_BPS",LIMITS.maxSlippageBps,{min:1,max:5000,integer:true}),
    intentMaxAgeMs:number(env,"LIVE_INTENT_MAX_AGE_MS",LIMITS.intentMaxAgeMs,{min:1000,max:300000,integer:true}),
    receiptLimit:LIMITS.receipts
  };
  if(enabled) {
    if(!config.accountId)throw Error("LIVE_ACCOUNT_ID is required when live execution is enabled");
    if(!config.walletPublicKey)throw Error("LIVE_WALLET_PUBLIC_KEY is required when live execution is enabled");
    if(!env.SOLANA_PRIVATE_KEY?.trim())throw Error("SOLANA_PRIVATE_KEY is required when live execution is enabled");
  }
  return Object.freeze(config);
}

module.exports={liveConfig,LIMITS};
