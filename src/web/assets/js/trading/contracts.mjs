/**
 * Internal, provider-neutral contracts. Account ownership is routing context, not
 * authentication; the browser-local owner is never a wallet address.
 *
 * @typedef {{userId:string,accountId:string,executionMode:'paper'|'live'}} TradingAccount
 * @typedef {{id:string,version:string}} Strategy
 * @typedef {{intentId:string,userId:string,accountId:string,strategy:Strategy,
 * createdAt:string,asset:string,side:'buy'|'sell',
 * quantity:{value:number,mode:'quote'|'position_fraction',unit:'USD'|'fraction'},
 * constraints:{orderType:'market',reduceOnly:boolean,capToPosition:boolean},
 * context:{reason:string,source:string,automatic:boolean}}} OrderIntent
 * @typedef {{intentId:string,userId:string,accountId:string,executionMode:'paper',
 * status:'filled'|'rejected',requested:OrderIntent['quantity'],
 * filledQuantity:number,filledQuoteQuantity:number,fillPrice:number|null,
 * fees:{amount:number,currency:'USD'},reason:string|null,message:string|null,
 * createdAt:string,completedAt:string}} ExecutionResult
 * @typedef {{execute(intent:OrderIntent,market:object):ExecutionResult}} Executor
 */

export const currentStrategy=Object.freeze({id:"launch-v1",version:"1"});

export function createLocalAccount() {
  return {userId:"local-user-"+crypto.randomUUID(),accountId:"paper-account-"+crypto.randomUUID(),executionMode:"paper"};
}

export function validAccount(account) {
  return Boolean(account&&typeof account.userId==="string"&&account.userId.length>0&&
    typeof account.accountId==="string"&&account.accountId.length>0&&["paper","live"].includes(account.executionMode));
}

export function createOrderIntent({account,strategy=currentStrategy,asset,side,quantity,automatic=false,
  source="manual",reason,now=Date.now(),intentId=crypto.randomUUID()}) {
  if(!validAccount(account))throw Error("A scoped trading account is required");
  const intent={intentId,userId:account.userId,accountId:account.accountId,
    strategy:{...strategy},createdAt:new Date(now).toISOString(),asset,side,quantity:{...quantity},
    constraints:{orderType:"market",reduceOnly:side==="sell",capToPosition:side==="sell"&&quantity.mode==="quote"},
    context:{reason,source,automatic}};
  if(!validOrderIntent(intent))throw Error("Invalid order intent");
  for(const field of ["strategy","quantity","constraints","context"])Object.freeze(intent[field]);
  return Object.freeze(intent);
}

export function validOrderIntent(intent) {
  const q=intent?.quantity,c=intent?.constraints,context=intent?.context;
  const keys=(value,allowed)=>value&&Object.keys(value).every(key=>allowed.includes(key));
  return Boolean(keys(intent,["intentId","userId","accountId","strategy","createdAt","asset","side","quantity","constraints","context"])&&
    keys(intent.strategy,["id","version"])&&keys(q,["value","mode","unit"])&&
    keys(c,["orderType","reduceOnly","capToPosition"])&&keys(context,["reason","source","automatic"])&&
    typeof intent.intentId==="string"&&intent.intentId.length>0&&
    typeof intent.userId==="string"&&intent.userId.length>0&&typeof intent.accountId==="string"&&intent.accountId.length>0&&
    typeof intent.strategy?.id==="string"&&intent.strategy.id.length>0&&
    typeof intent.strategy.version==="string"&&intent.strategy.version.length>0&&
    Number.isFinite(Date.parse(intent.createdAt))&&typeof intent.asset==="string"&&intent.asset.length>0&&
    ["buy","sell"].includes(intent.side)&&Number.isFinite(q?.value)&&q.value>0&&
    (q.mode==="quote"&&q.unit==="USD"||intent.side==="sell"&&q.mode==="position_fraction"&&q.unit==="fraction"&&q.value<=1)&&
    c?.orderType==="market"&&c.reduceOnly===(intent.side==="sell")&&c.capToPosition===(intent.side==="sell"&&q.mode==="quote")&&
    typeof context?.reason==="string"&&typeof context.source==="string"&&typeof context.automatic==="boolean");
}

export function executionResult(intent,{status="rejected",reason=null,message=null,filledQuantity=0,
  filledQuoteQuantity=0,fillPrice=null,fee=0,now=Date.now()}={}) {
  return {intentId:intent?.intentId??null,userId:intent?.userId??null,accountId:intent?.accountId??null,
    executionMode:"paper",status,requested:intent?.quantity?{...intent.quantity}:null,
    filledQuantity,filledQuoteQuantity,fillPrice,fees:{amount:fee,currency:"USD"},reason,message,
    createdAt:intent?.createdAt??null,completedAt:new Date(now).toISOString()};
}
