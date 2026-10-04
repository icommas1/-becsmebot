import {requestTimeoutMs} from "./memory-config.mjs";
const element=id=>document.getElementById(id);
const node=(tag,text)=>{const value=document.createElement(tag);value.textContent=text;return value;};
let busy=false,generation=0,reloadOnVisible=false;
function clear(){generation++;element("report").hidden=true;element("export").hidden=true;
  for(const id of ["coverage","categories","provenance","limitations"])element(id).replaceChildren();}
function field(list,label,value){const group=node("div","");group.append(node("dt",label),node("dd",String(value)));list.append(group);}
async function get(path){const response=await fetch(path,{credentials:"same-origin",cache:"no-store",signal:AbortSignal.timeout(requestTimeoutMs)});
  if(!response.ok)throw Object.assign(Error("evidence_unavailable"),{status:response.status});return response.json();}
async function load(){
  if(busy)return;busy=true;clear();const current=generation;element("refresh").disabled=true;element("sign-in").hidden=true;
  element("status").textContent="Loading retained event evidence…";
  try{
    if(!(await get("/api/paper/capabilities")).enabled){element("status").textContent="Server paper accounts are disabled. No owner evidence has been loaded.";return;}
    const report=await get("/api/memory/coverage");if(current!==generation||document.hidden)return;
    const source=report.source;
    for(const [label,value] of [["Evidence status",source.status],["Retained events",source.retained],["Verified events",source.verified],
      ["Complete retained stream",source.complete?"Yes":"No"],["Recorded head sequence",source.headSequence],
      ["Snapshot time",report.snapshotAt||"Unavailable"],["Semantic memory",report.memory.status==="not_implemented"?"Not implemented":"Unavailable"]])field(element("coverage"),label,value);
    for(const entry of source.categories){const card=node("article","");card.append(node("h3",entry.eventType),node("p",entry.category+" · "+entry.retained+" retained events"));element("categories").append(card);}
    for(const entry of source.provenance){const card=node("article","");card.append(node("h3",entry.source),node("p",(entry.strategyId||"No strategy reference")+" @ "+(entry.strategyVersion||"Unavailable")),node("p",entry.records+" recorded events"));element("provenance").append(card);}
    for(const text of report.limitations)element("limitations").append(node("li",text));
    element("report").hidden=false;element("export").hidden=false;
    element("status").textContent=source.status==="verified"?"Retained stream verified within this report's bounds. This is not a backup or a learning result.":
      source.status==="empty"?"No retained server-paper events. No memory or outcomes are inferred.":
      source.status==="partial"?"Partial evidence verification. Coverage is incomplete; inspect the limits before drawing conclusions.":
      source.status==="invalid"?"Event integrity check failed. This evidence is not verified.":"Retained event evidence is unavailable.";
  }catch(error){if(current!==generation)return;clear();element("sign-in").hidden=error.status!==401;
    element("status").textContent=error.status===401?"Sign in with the GitHub owner account, then refresh.":"Evidence report unavailable. No owner evidence is shown.";
  }finally{busy=false;element("refresh").disabled=false;if(reloadOnVisible&&!document.hidden){reloadOnVisible=false;load();}}
}
element("refresh").addEventListener("click",()=>load());
document.addEventListener("visibilitychange",()=>{if(document.hidden)clear();else if(busy)reloadOnVisible=true;else load();});
window.addEventListener("pagehide",clear);window.addEventListener("pageshow",event=>{if(event.persisted)load();});load();
