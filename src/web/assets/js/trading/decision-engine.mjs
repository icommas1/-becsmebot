import {num} from "../core.mjs";
import {launchRows,passes} from "../filters.mjs";
import {createOrderIntent} from "./contracts.mjs";

const noAction=message=>({intents:[],message});

// All inputs are snapshots. Decisions never change a ledger or perform I/O.
export function decideBuy({account,strategy,row,amount,settings,enteredAssets,solRate,
  automatic=false,feed="recent",now=Date.now()}) {
  if(!Number.isFinite(amount)||amount<=0)return noAction("Enter a positive paper trade amount.");
  if(row.isSus)return noAction("Jupiter flagged this token as suspicious.");
  if(!passes(row,settings,now))return noAction("This token is outside your paper filters.");
  if(enteredAssets[row.mint])return noAction("Already paper bought this mint once.");
  if(!solRate||!num(row.priceUsd))return noAction("Need a current SOL and token price for a paper buy.");
  return {intents:[createOrderIntent({account,strategy,asset:row.mint,side:"buy",
    quantity:{value:amount,mode:"quote",unit:"USD"},automatic,source:automatic?feed:"manual",
    reason:automatic?"matching-launch":"manual-buy",now})],message:null};
}

export function decideSale({account,strategy,positions,mint,pct,dollars=null,automatic=false,now=Date.now()}) {
  if(!positions[mint])
    return noAction("Need a recent Jupiter Price V3 mark for a paper sale.");
  const quantity=dollars==null?{value:pct/100,mode:"position_fraction",unit:"fraction"}:
    {value:dollars,mode:"quote",unit:"USD"};
  if(!Number.isFinite(quantity.value)||quantity.value<=0||quantity.mode==="position_fraction"&&quantity.value>1)
    return noAction("Invalid sale amount.");
  return {intents:[createOrderIntent({account,strategy,asset:mint,side:"sell",quantity,automatic,
    source:automatic?"auto target":"manual",reason:automatic?"multiple-target":"manual-sale",now})],message:null};
}

export function autoBuyCandidates({enabled,rows,settings,radarUi,enteredAssets,now=Date.now()}) {
  return enabled?launchRows(rows,settings,radarUi,now).filter(row=>!enteredAssets[row.mint]):[];
}

export function autoExitCandidates({enabled,positions,settings,prices}) {
  if(!enabled||settings.exitMultiple<=1)return [];
  return Object.values(positions).filter(hold=>
    num(prices[hold.mint]?.priceUsd)/hold.entryPrice>=settings.exitMultiple&&!hold.autoExited);
}
