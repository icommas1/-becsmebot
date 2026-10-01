import {num,recentMark} from "../core.mjs";
import {executionResult,validAccount,validOrderIntent} from "./contracts.mjs";

export const MAX_PAPER_RECEIPTS=500;
const MAX_SIGNATURE_LENGTH=2048;

function intentSignature(intent) {
  const {strategy,quantity,constraints,context}=intent;
  return JSON.stringify([intent.intentId,intent.userId,intent.accountId,strategy.id,strategy.version,
    intent.createdAt,intent.asset,intent.side,quantity.value,quantity.mode,quantity.unit,
    constraints.orderType,constraints.reduceOnly,constraints.capToPosition,
    context.reason,context.source,context.automatic]);
}

function validReceipts(receipts,account) {
  if(!Array.isArray(receipts)||receipts.length>MAX_PAPER_RECEIPTS)return false;
  const seen=new Set();
  for(const receipt of receipts) {
    if(!receipt||typeof receipt.intentId!=="string"||!receipt.intentId||seen.has(receipt.intentId)||
      typeof receipt.signature!=="string"||receipt.signature.length>MAX_SIGNATURE_LENGTH||
      receipt.result?.status!=="filled"||receipt.result.intentId!==receipt.intentId||
      receipt.result.userId!==account.userId||receipt.result.accountId!==account.accountId||
      receipt.result.executionMode!=="paper")return false;
    seen.add(receipt.intentId);
  }
  return true;
}

/** @returns {import('./contracts.mjs').Executor} */
export function createPaperExecutor({account,paper}) {
  if(!validAccount(account)||account.executionMode!=="paper")throw Error("Live execution is disabled");
  return Object.freeze({execute(intent,market) {
    const validNow=Number.isFinite(market?.now)&&Number.isFinite(new Date(market.now).getTime());
    const now=validNow?market.now:Date.now();
    const reject=(reason,message)=>executionResult(intent,{reason,message,now});
    if(!validOrderIntent(intent))return reject("invalid-intent","Invalid order intent.");
    if(!validAccount(account)||account.executionMode!=="paper"||!validAccount(paper?.account)||paper.account.executionMode!=="paper")
      return reject("execution-disabled","Live execution is disabled.");
    if(intent.userId!==account.userId||intent.accountId!==account.accountId||
      paper.account.userId!==account.userId||paper.account.accountId!==account.accountId)
      return reject("ownership-mismatch","Order account does not own this paper ledger.");
    if(!validLedger(paper))return reject("invalid-ledger","Paper ledger is unavailable or invalid.");
    const signature=intentSignature(intent);
    if(signature.length>MAX_SIGNATURE_LENGTH)return reject("invalid-intent","Invalid order intent.");
    const prior=paper.receipts.find(receipt=>receipt.intentId===intent.intentId);
    if(prior)return prior.signature===signature?structuredClone(prior.result):
      reject("intent-id-conflict","Order intent ID was already used for another request.");
    if(!market||typeof market!=="object"||market.now!=null&&!validNow)
      return reject("invalid-market","Invalid paper market context.");
    if(intent.side==="buy"&&!market.row)return reject("missing-market","Need a current SOL and token price for a paper buy.");
    if(intent.side==="sell"&&!validHold(paper.holds[intent.asset]))
      return reject("invalid-ledger","Paper holding is unavailable or invalid.");
    const fill=intent.side==="buy"?fillBuy(paper,intent,{...market,now}):fillSale(paper,intent,{...market,now});
    const result=executionResult(intent,{status:fill.ok?"filled":"rejected",reason:fill.ok?null:"paper-rejected",
      message:fill.message,filledQuantity:fill.filledQuantity,filledQuoteQuantity:fill.ok?fill.gross:0,
      fillPrice:fill.fillPrice,fee:fill.fee,now});
    if(fill.ok) {
      paper.receipts.push({intentId:intent.intentId,signature,result:structuredClone(result)});
      if(paper.receipts.length>MAX_PAPER_RECEIPTS)paper.receipts.shift();
    }
    return result;
  }});
}

function validLedger(paper) {
  const settings=paper.settings;
  return Number.isFinite(paper.cashSol)&&paper.cashSol>=0&&Number.isFinite(paper.realizedUsd)&&
    paper.holds&&typeof paper.holds==="object"&&!Array.isArray(paper.holds)&&
    paper.bought&&typeof paper.bought==="object"&&!Array.isArray(paper.bought)&&
    Array.isArray(paper.activity)&&validReceipts(paper.receipts,paper.account)&&settings&&
    ["feeSol","reserveSol","impactPct"].every(key=>Number.isFinite(settings[key])&&settings[key]>=0);
}

function validHold(hold) {
  return hold&&Number.isFinite(hold.qty)&&hold.qty>0&&
    Number.isFinite(hold.investedUsd)&&hold.investedUsd>=0&&
    Number.isFinite(hold.feesUsd)&&hold.feesUsd>=0;
}

export function recordActivity(paper,kind,text,details={},now=Date.now()) {
  paper.activity.unshift({at:new Date(now).toISOString(),kind,text,...details});
  paper.activity.length=Math.min(paper.activity.length,500);
}

function fillBuy(paper,intent,{row,solRate,now}) {
  const amount=intent.quantity.value,automatic=intent.context.automatic,feed=intent.context.source;
  const price=num(row.priceUsd),settings={...paper.settings,betUsd:amount};
  if(row.isSus)return {ok:false,message:"Jupiter flagged this token as suspicious."};
  if(paper.bought[row.mint])return {ok:false,message:"Already paper bought this mint once."};
  if(row?.mint!==intent.asset||!recentMark(row.observedAt,180000,now)||!Number.isFinite(solRate)||solRate<=0||!price)return {ok:false,message:"Need a current SOL and token price for a paper buy."};
  const solCost=settings.betUsd/solRate,total=solCost+settings.feeSol;
  if(paper.cashSol+1e-10<total+settings.reserveSol)return {ok:false,message:"Paper cash would fall below your SOL reserve."};
  const entry=price*(1+settings.impactPct/100);
  paper.cashSol=Math.max(0,paper.cashSol-total);
  paper.holds[row.mint]={mint:row.mint,symbol:row.symbol,qty:settings.betUsd/entry,entryPrice:entry,
    entryCap:row.marketCap,investedUsd:settings.betUsd,feesUsd:settings.feeSol*solRate,
    boughtAt:new Date(now).toISOString(),lastPrice:price};
  paper.bought[row.mint]={...row};
  recordActivity(paper,"buy",(automatic?"Auto ":"")+"paper buy "+row.symbol+" "+formatUsd(settings.betUsd),
    {mint:row.mint,symbol:row.symbol,sizeUsd:settings.betUsd,marketCap:row.marketCap,source:automatic?feed:"manual"},now);
  return {ok:true,filledQuantity:settings.betUsd/entry,fillPrice:entry,fee:settings.feeSol*solRate,gross:settings.betUsd,
    message:automatic?null:"Paper bought "+row.symbol+" for "+formatUsd(settings.betUsd)+"."};
}

function fillSale(paper,intent,{solRate,mark,markAt,marketCap=null,now}) {
  const mint=intent.asset,automatic=intent.context.automatic,
    dollars=intent.quantity.mode==="quote"?intent.quantity.value:null;
  const hold=paper.holds[mint],price=num(mark?.priceUsd);
  if(!hold||!Number.isFinite(solRate)||solRate<=0||!price||mark?.source!=="jupiter-v3"||!recentMark(markAt,120000,now))
    return {ok:false,message:"Need a recent Jupiter Price V3 mark for a paper sale."};
  const unit=price*(1-paper.settings.impactPct/100);
  const fraction=dollars==null?intent.quantity.value:Math.min(1,dollars/(hold.qty*unit));
  const gross=hold.qty*fraction*unit;
  if(!Number.isFinite(fraction)||fraction<=0||fraction>1)return {ok:false,message:"Invalid sale amount."};
  const fee=paper.settings.feeSol*solRate,net=gross-fee;
  if(net<=0)return {ok:false,message:"Paper sale amount is smaller than the estimated fee."};
  const filledQuantity=hold.qty*fraction;
  const basis=hold.investedUsd*fraction+hold.feesUsd*fraction;
  const entryCap=hold.entryCap;
  const realizedUsd=net-basis;
  paper.cashSol+=net/solRate;
  paper.realizedUsd+=realizedUsd;
  hold.qty*=1-fraction;hold.investedUsd*=1-fraction;hold.feesUsd*=1-fraction;
  if(fraction===1||hold.qty<1e-12)delete paper.holds[mint];
  if(automatic&&paper.holds[mint])paper.holds[mint].autoExited=true;
  recordActivity(paper,"sell",(automatic?"Auto ":"")+"Paper sold "+formatUsd(gross)+" "+hold.symbol+" · "+formatUsd(net)+" after fee",
    {mint,symbol:hold.symbol,sizeUsd:gross,marketCap,source:automatic?"auto target":"manual",
      entryCap,basisUsd:basis,netUsd:net,realizedUsd},now);
  return {ok:true,filledQuantity,fillPrice:unit,fee,message:"Paper sold "+formatUsd(gross)+" of "+hold.symbol+".",gross,remaining:paper.holds[mint]?.qty||0};
}

function formatUsd(value) {
  return Number.isFinite(value)?"$"+value.toLocaleString(undefined,{maximumFractionDigits:2,minimumFractionDigits:2}):"—";
}
