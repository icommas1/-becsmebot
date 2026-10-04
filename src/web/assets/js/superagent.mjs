import {requestTimeoutMs} from "./superagent-config.mjs";
const element=id=>document.getElementById(id);
let busy=false,purchaseAfter=0,outcomeAfter=null,generation=0,reloadOnVisible=false;
const buttons=[element("refresh"),element("more-purchases"),element("more-outcomes")];
const node=(tag,text)=>{const value=document.createElement(tag);value.textContent=text;return value;};
const date=value=>new Date(value).toISOString();
const number=value=>Number(value).toLocaleString("en-US",{maximumSignificantDigits:8});
function field(list,label,value){const group=node("div","");group.append(node("dt",label),node("dd",value));list.append(group);}
function clear(){generation++;element("report").hidden=true;for(const id of ["purchases","outcomes","coverage"])element(id).replaceChildren();purchaseAfter=0;outcomeAfter=null;}
function card(row){
  const article=node("article",""),list=node("dl",""),mark=row.classification==="observed-market-mark";
  article.append(node("span","PAPER"),node("h3",mark?"Sampled market mark":row.side==="buy"?"Recorded purchase":"Recorded sale"));
  article.firstChild.className="badge";
  field(list,"Asset",row.asset);field(list,"Purchase reference",row.purchaseId);
  field(list,"Observed time (UTC)",date(mark?row.observedAt:row.occurredAt));
  if(mark){field(list,"Sampled price (USD)",number(row.priceUsd));field(list,"Price / recorded entry",number(row.priceRatioToEntry)+"×");
    field(list,"Price source",row.priceFeed);field(list,"Meaning",row.meaning);}
  else{field(list,"Recorded fill price (USD)",number(row.fill.fillPrice));field(list,"Recorded quantity",number(row.fill.filledQuantity));
    field(list,"Recorded gross value (USD)",number(row.fill.filledQuoteQuantity));field(list,"Recorded fee (USD)",number(row.fill.fees.amount));
    field(list,"Decision",row.decision.reason);field(list,"Decision source",row.decision.source+(row.decision.automatic?" · automatic":" · manual"));
    field(list,"Strategy version",row.strategy.id+" @ "+row.strategy.version);}
  article.append(list);const details=node("details","");details.append(node("summary","Source references"),node("pre",JSON.stringify(row.references||[row.reference],null,2)));article.append(details);
  return article;
}
async function get(path){
  const response=await fetch(path,{credentials:"same-origin",cache:"no-store",signal:AbortSignal.timeout(requestTimeoutMs)});
  if(!response.ok)throw Object.assign(Error("report_unavailable"),{status:response.status});return response.json();
}
async function load(kind="refresh"){
  if(busy)return;busy=true;buttons.forEach(button=>button.disabled=true);element("sign-in").hidden=true;
  if(kind==="refresh")clear();element("status").textContent="Loading recorded evidence…";
  const current=generation;
  try{
    if(kind==="refresh"&&!(await get("/api/superagent/capabilities")).enabled){element("status").textContent="Recorded report is disabled. No observation data has been loaded.";return;}
    const query=new URLSearchParams({purchaseAfter:String(kind==="purchases"?purchaseAfter:0)});
    if(kind==="outcomes"&&outcomeAfter)query.set("outcomeAfter",JSON.stringify(outcomeAfter));
    const report=await get("/api/superagent/report?"+query);
    if(current!==generation||document.hidden)return;
    const coverage=element("coverage");coverage.replaceChildren();
    for(const [label,value] of [["Source",report.scope.sourceId],["Owner",report.scope.ownerId],["Account",report.scope.accountId],
      ["Source contract revision",report.scope.contractRevision],["Events verified through",report.coverage.eventVerifiedThrough],
      ["Archive verified through",report.coverage.archiveVerifiedThrough]])field(coverage,label,String(value));
    if(kind!=="outcomes"){
      report.purchases.forEach(row=>element("purchases").append(card(row)));purchaseAfter=report.nextPurchaseAfter;
      element("more-purchases").hidden=purchaseAfter===null;element("purchases-empty").hidden=element("purchases").childElementCount!==0;
    }
    if(kind!=="purchases"){
      report.outcomes.forEach(row=>element("outcomes").append(card(row)));outcomeAfter=report.nextOutcomeAfter;
      element("more-outcomes").hidden=outcomeAfter===null;element("outcomes-empty").hidden=element("outcomes").childElementCount!==0;
    }
    element("report").hidden=false;element("status").textContent="Report page loaded at "+date(Date.now())+". Retained history; source freshness is not established.";
  }catch(error){
    if(error.status===401||error.status===403){clear();element("sign-in").hidden=error.status!==401;
      element("status").textContent=error.status===401?"Sign in with the GitHub owner account, then return here and refresh.":"The signed-in account does not match this report. No observation data is shown.";}
    else{element("status").textContent="Recorded report unavailable. Retry with Refresh report. Any visible cards were loaded earlier.";}
  }finally{busy=false;buttons.forEach(button=>button.disabled=false);if(reloadOnVisible&&!document.hidden){reloadOnVisible=false;load();}}
}
element("refresh").addEventListener("click",()=>load());
element("more-purchases").addEventListener("click",()=>load("purchases"));
element("more-outcomes").addEventListener("click",()=>load("outcomes"));
document.addEventListener("visibilitychange",()=>{if(document.hidden)clear();else if(busy)reloadOnVisible=true;else load();});
window.addEventListener("pagehide",clear);
window.addEventListener("pageshow",event=>{if(event.persisted)load();});
load();
