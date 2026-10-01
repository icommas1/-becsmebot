import {num,recentMark} from "../core.mjs";
import {executionResult,validAccount,validOrderIntent} from "./contracts.mjs";

/** @returns {import('./contracts.mjs').Executor} */
export function createPaperExecutor({account,paper}) {
  if(!validAccount(account)||account.executionMode!=="paper")throw Error("Live execution is disabled");
  return Object.freeze({execute(intent,market) {
    const now=market.now??Date.now();
    const reject=(reason,message)=>executionResult(intent,{reason,message,now});
    if(!validOrderIntent(intent))return reject("invalid-intent","Invalid order intent.");
    if(!validAccount(account)||account.executionMode!=="paper"||!validAccount(paper.account)||paper.account.executionMode!=="paper")
      return reject("execution-disabled","Live execution is disabled.");
    if(intent.userId!==account.userId||intent.accountId!==account.accountId||
      paper.account.userId!==account.userId||paper.account.accountId!==account.accountId)
      return reject("ownership-mismatch","Order account does not own this paper ledger.");
    if(intent.side==="buy"&&!market.row)return reject("missing-market","Need a current SOL and token price for a paper buy.");
    const fill=intent.side==="buy"?fillBuy(paper,intent,{...market,now}):fillSale(paper,intent,{...market,now});
    return executionResult(intent,{status:fill.ok?"filled":"rejected",reason:fill.ok?null:"paper-rejected",
      message:fill.message,filledQuantity:fill.filledQuantity,filledQuoteQuantity:fill.ok?fill.gross:0,
      fillPrice:fill.fillPrice,fee:fill.fee,now});
  }});
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
  paper.cashSol+=net/solRate;
  paper.realizedUsd+=net-basis;
  hold.qty*=1-fraction;hold.investedUsd*=1-fraction;hold.feesUsd*=1-fraction;
  if(fraction===1||hold.qty<1e-12)delete paper.holds[mint];
  if(automatic&&paper.holds[mint])paper.holds[mint].autoExited=true;
  recordActivity(paper,"sell",(automatic?"Auto ":"")+"Paper sold "+formatUsd(gross)+" "+hold.symbol+" · "+formatUsd(net)+" after fee",
    {mint,symbol:hold.symbol,sizeUsd:gross,marketCap,source:automatic?"auto target":"manual"},now);
  return {ok:true,filledQuantity,fillPrice:unit,fee,message:"Paper sold "+formatUsd(gross)+" of "+hold.symbol+".",gross,remaining:paper.holds[mint]?.qty||0};
}

function formatUsd(value) {
  return Number.isFinite(value)?"$"+value.toLocaleString(undefined,{maximumFractionDigits:2,minimumFractionDigits:2}):"—";
}
