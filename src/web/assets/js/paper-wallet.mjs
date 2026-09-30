import {num,recentMark} from "./core.mjs";
import {launchDefaults} from "./filters.mjs";

export const STORE="becsPaperV1";
export const paperDefaults=Object.freeze({
  betUsd:1,reserveSol:.02,feeSol:.000005,impactPct:0,...launchDefaults,radarVersion:2,exitMultiple:0
});

export function freshPaper() {
  return {cashSol:.4,settings:{...paperDefaults},holds:{},bought:{},activity:[],realizedUsd:0,auto:false};
}

export function loadPaper(storage) {
  try {
    const old=JSON.parse(storage.getItem(STORE));
    if(!old||!Number.isFinite(old.cashSol)||old.cashSol<0||!old.holds||!old.bought)return freshPaper();
    const settings={...paperDefaults,...old.settings};
    if(old.settings?.radarVersion!==2)Object.assign(settings,launchDefaults,{radarVersion:2});
    delete settings.autoFeed;
    for(const [key,value] of Object.entries(paperDefaults))
      if(typeof value==="number"&&(!Number.isFinite(settings[key])||settings[key]<0))settings[key]=value;
    if(settings.betUsd<=0)settings.betUsd=1;
    if(settings.impactPct>50)settings.impactPct=0;
    if(settings.minOrganicScore>100)settings.minOrganicScore=0;
    return {...freshPaper(),...old,settings,activity:Array.isArray(old.activity)?old.activity:[],
      realizedUsd:Number.isFinite(old.realizedUsd)?old.realizedUsd:0,auto:false};
  } catch(_error) {
    return freshPaper();
  }
}

export function savePaper(storage,paper) {
  try {storage.setItem(STORE,JSON.stringify(paper));return true;} catch(_error) {return false;}
}

export function recordActivity(paper,kind,text,details={},now=Date.now()) {
  paper.activity.unshift({at:new Date(now).toISOString(),kind,text,...details});
  paper.activity.length=Math.min(paper.activity.length,500);
}

export function buyPaper({paper,row,amount,automatic=false,solRate,eligible,feed,now=Date.now()}) {
  if(!Number.isFinite(amount)||amount<=0)return {ok:false,message:"Enter a positive paper trade amount."};
  const price=num(row.priceUsd),settings={...paper.settings,betUsd:amount};
  if(row.isSus)return {ok:false,message:"Jupiter flagged this token as suspicious."};
  if(!eligible)return {ok:false,message:"This token is outside your paper filters."};
  if(paper.bought[row.mint])return {ok:false,message:"Already paper bought this mint once."};
  if(!solRate||!price)return {ok:false,message:"Need a current SOL and token price for a paper buy."};
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
  return {ok:true,message:automatic?null:"Paper bought "+row.symbol+" for "+formatUsd(settings.betUsd)+".",
    priceRecord:{priceUsd:price,source:"tokens",marketCap:row.marketCap,liquidityUsd:row.liquidityUsd}};
}

export function sellPaper({paper,mint,pct,dollars=null,automatic=false,solRate,mark,markAt,marketCap=null,now=Date.now()}) {
  const hold=paper.holds[mint],price=num(mark?.priceUsd);
  if(!hold||!solRate||!price||mark?.source!=="jupiter-v3"||!recentMark(markAt,120000,now))
    return {ok:false,message:"Need a recent Jupiter Price V3 mark for a paper sale."};
  const unit=price*(1-paper.settings.impactPct/100);
  const fraction=dollars==null?pct/100:Math.min(1,dollars/(hold.qty*unit));
  const gross=hold.qty*fraction*unit;
  if(!Number.isFinite(fraction)||fraction<=0||fraction>1)return {ok:false,message:"Invalid sale amount."};
  const fee=paper.settings.feeSol*solRate,net=gross-fee;
  if(net<=0)return {ok:false,message:"Paper sale amount is smaller than the estimated fee."};
  const basis=hold.investedUsd*fraction+hold.feesUsd*fraction;
  paper.cashSol+=net/solRate;
  paper.realizedUsd+=net-basis;
  hold.qty*=1-fraction;hold.investedUsd*=1-fraction;hold.feesUsd*=1-fraction;
  if(fraction===1||hold.qty<1e-12)delete paper.holds[mint];
  recordActivity(paper,"sell",(automatic?"Auto ":"")+"Paper sold "+formatUsd(gross)+" "+hold.symbol+" · "+formatUsd(net)+" after fee",
    {mint,symbol:hold.symbol,sizeUsd:gross,marketCap,source:automatic?"auto target":"manual"},now);
  return {ok:true,message:"Paper sold "+formatUsd(gross)+" of "+hold.symbol+".",gross,remaining:paper.holds[mint]?.qty||0};
}

export function portfolioSummary(paper,prices,priceTimes,now=Date.now()) {
  const holds=Object.values(paper.holds);
  const value=holds.reduce((sum,hold)=>sum+hold.qty*(num(prices[hold.mint]?.priceUsd)||num(hold.lastPrice)||0),0);
  const unrealized=holds.reduce((sum,hold)=>sum+hold.qty*(num(prices[hold.mint]?.priceUsd)||num(hold.lastPrice)||0)-hold.investedUsd-hold.feesUsd,0);
  return {holds,value,unrealized,pnl:paper.realizedUsd+unrealized,
    estimated:holds.some(hold=>!recentMark(priceTimes[hold.mint],120000,now))};
}

function formatUsd(value) {
  return Number.isFinite(value)?"$"+value.toLocaleString(undefined,{maximumFractionDigits:2,minimumFractionDigits:2}):"—";
}
