import {num,recentMark} from "./core.mjs";
import {launchDefaults} from "./filters.mjs";
import {createLocalAccount,validAccount} from "./trading/contracts.mjs";
import {MAX_PAPER_RECEIPTS} from "./trading/paper-executor.mjs";

export const STORE="becsPaperV1";
export const paperDefaults=Object.freeze({
  betUsd:1,reserveSol:.02,feeSol:.000005,impactPct:0,...launchDefaults,radarVersion:2,exitMultiple:0
});

export function freshPaper() {
  return {account:createLocalAccount(),cashSol:.4,settings:{...paperDefaults},holds:{},bought:{},activity:[],receipts:[],realizedUsd:0,auto:false};
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
    return {...freshPaper(),...old,account:validAccount(old.account)&&old.account.executionMode==="paper"?{...old.account}:createLocalAccount(),settings,activity:Array.isArray(old.activity)?old.activity:[],
      receipts:Array.isArray(old.receipts)?old.receipts.slice(-MAX_PAPER_RECEIPTS):old.receipts===undefined?[]:old.receipts,
      realizedUsd:Number.isFinite(old.realizedUsd)?old.realizedUsd:0,auto:false};
  } catch(_error) {
    return freshPaper();
  }
}

export function savePaper(storage,paper) {
  try {storage.setItem(STORE,JSON.stringify(paper));return true;} catch(_error) {return false;}
}

// Compatibility exports keep existing callers on the same execution pipeline.
export {recordActivity} from "./trading/paper-executor.mjs";
export {buyPaper,sellPaper} from "./trading/paper-pipeline.mjs";

export function portfolioSummary(paper,prices,priceTimes,now=Date.now()) {
  const holds=Object.values(paper.holds);
  const value=holds.reduce((sum,hold)=>sum+hold.qty*(num(prices[hold.mint]?.priceUsd)||num(hold.lastPrice)||0),0);
  const unrealized=holds.reduce((sum,hold)=>sum+hold.qty*(num(prices[hold.mint]?.priceUsd)||num(hold.lastPrice)||0)-hold.investedUsd-hold.feesUsd,0);
  return {holds,value,unrealized,pnl:paper.realizedUsd+unrealized,
    estimated:holds.some(hold=>!recentMark(priceTimes[hold.mint],120000,now))};
}
