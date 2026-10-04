import {limits} from "./research-config.mjs";
const $=id=>document.getElementById(id);
const KEY="becsResearchEnginesV1";
let engines=[],running=false;
const node=(tag,text,className)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;};
function recipe(){
  const value={name:$("engine-name").value.trim(),query:$("engine-query").value.trim(),providers:[...document.querySelectorAll('input[name="provider"]:checked')].map(input=>input.value)};
  if(!value.name||value.name.length>limits.nameMax||value.query.length<limits.queryMin||value.query.length>limits.queryMax||!value.providers.length)throw Error("Name the engine, enter a public query, and choose at least one reader.");
  return value;
}
function validRecipe(value){return value&&typeof value.name==="string"&&value.name.length>0&&value.name.length<=limits.nameMax&&typeof value.query==="string"&&value.query.length>=limits.queryMin&&value.query.length<=limits.queryMax&&Array.isArray(value.providers)&&value.providers.length>=1&&value.providers.length<=2&&new Set(value.providers).size===value.providers.length&&value.providers.every(p=>p==="exa"||p==="parallel");}
function save(){try{localStorage.setItem(KEY,JSON.stringify(engines));$("save-status").textContent="Saved on this browser only. Paper wallet and server archive are unchanged.";return true;}catch{$("save-status").textContent="Browser storage unavailable. Recipes are session-only; your input is preserved.";return false;}}
function renderEngines(){
  const root=$("saved-engines");root.replaceChildren();
  if(!engines.length){root.append(node("p","No saved engines yet.","muted"));return;}
  engines.forEach((engine,index)=>{
    const card=node("article",undefined,"engine-card");card.append(node("h3",engine.name),node("small",`${engine.providers.join(" + ")} · Research only · Win rate not measured`),node("p",engine.query));
    const actions=node("div",undefined,"actions"),load=node("button","Load","quiet"),remove=node("button","Remove","quiet");
    load.type=remove.type="button";
    load.addEventListener("click",()=>{$("engine-name").value=engine.name;$("engine-query").value=engine.query;document.querySelectorAll('input[name="provider"]').forEach(input=>input.checked=engine.providers.includes(input.value));$("engine-name").focus();});
    remove.addEventListener("click",()=>{engines.splice(index,1);save();renderEngines();});
    actions.append(load,remove);card.append(actions);root.append(card);
  });
}
async function json(url,options={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),limits.clientTimeoutMs);
  try{const response=await fetch(url,{...options,signal:controller.signal,credentials:"same-origin",headers:{"Content-Type":"application/json",...options.headers}});const result=await response.json();if(!response.ok)throw Error(result.error||"Request unavailable.");return result;}finally{clearTimeout(timer);}
}
async function refreshStatus(){
  try{
    const status=await json("/api/research/status"),root=$("source-library");root.replaceChildren();
    for(const tool of status.catalog){
      const card=node("article",undefined,"source-card");card.append(node("h3",tool.name),node("span",tool.kind==="reader"?`Reader · ${tool.status}`:"Supporting tool","badge"),node("p",tool.role),node("p",tool.access),node("p",tool.note));root.append(card);
    }
    const notice=$("connection-status");notice.replaceChildren();
    if(!status.accountEnabled){notice.textContent="The private server account must be configured before research can run.";return;}
    const auth=await json("/api/auth/status");
    if(auth.authenticated)notice.textContent="Owner signed in. Research runs only when requested. Free access is limited; nothing switches to paid usage.";
    else{notice.append(node("span","Sign in with the BecsBot owner's GitHub account to run research. "));const login=node("a","Sign in");login.href="/api/auth/github";notice.append(login);}
  }catch{$("connection-status").textContent="Connection unavailable. Saved recipes are still accessible; no research or trades were started.";}
}
function renderResults(result){
  $("reader-results").replaceChildren();$("research-results").replaceChildren();
  const ready=result.providers.filter(p=>p.status==="ready").length;
  $("run-status").textContent=`${result.documentCount} unique documents from ${ready} reader${ready===1?"":"s"}. ${result.cached?"Cached batch; originally retrieved":"Retrieved"} ${new Date(result.retrievedAt).toLocaleString()}. Not trading signals.`;
  for(const reader of result.providers)$("reader-results").append(node("p",`${reader.id}: ${reader.status}${reader.error?" — "+reader.error:" · "+reader.documentCount+" documents"}`,"reader-state"));
  for(const doc of result.documents){
    let url;try{url=new URL(doc.url);if(url.protocol!=="https:"||url.username||url.password)continue;}catch{continue;}
    const card=node("article",undefined,"document"),link=node("a",doc.title||doc.host);link.href=url.href;link.target="_blank";link.rel="noopener noreferrer";
    card.append(link,node("small",`${doc.host} · Retrieved by ${doc.readers.join(" + ")}`),node("p",doc.excerpt));
    if(doc.readers.length>1)card.append(node("small","Both readers found this same document. It counts once."));
    $("research-results").append(card);
  }
  if(!result.documents.length)$("research-results").append(node("p",ready?"The readers returned no validated source documents.":"No reader succeeded. This is an unavailable result, not evidence that no opportunity exists.","muted"));
}
$("engine-form").addEventListener("submit",async event=>{
  event.preventDefault();if(running)return;
  let engine;try{engine=recipe();}catch(error){$("run-status").textContent=error.message;return;}
  running=true;$("run-engine").disabled=true;$("run-status").textContent="Research is running. No trading action is connected to this request.";$("reader-results").replaceChildren();$("research-results").replaceChildren();
  try{renderResults(await json("/api/research/query",{method:"POST",body:JSON.stringify({query:engine.query,providers:engine.providers})}));}
  catch(error){$("run-status").textContent=error.name==="AbortError"?"The request timed out. No trade was started.":error.message;}
  finally{running=false;$("run-engine").disabled=false;await refreshStatus();}
});
$("save-engine").addEventListener("click",()=>{
  try{const engine=recipe(),index=engines.findIndex(saved=>saved.name===engine.name);if(index<0&&engines.length>=limits.recipeCount)throw Error("Recipe limit reached. Remove one before adding another.");if(index>=0)engines[index]=engine;else engines.push(engine);save();renderEngines();}
  catch(error){$("save-status").textContent=error.message;}
});
try{const raw=localStorage.getItem(KEY);if(raw){if(raw.length>limits.recipeBytes)throw Error();const saved=JSON.parse(raw);if(!Array.isArray(saved)||saved.length>limits.recipeCount||!saved.every(validRecipe))throw Error();engines=saved;}}
catch{$("save-status").textContent="Saved research recipes could not be read. Existing storage was not overwritten.";}
renderEngines();await refreshStatus();
