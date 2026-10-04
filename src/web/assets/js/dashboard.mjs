import {compactUsd,num,recentMark,short} from "./core.mjs";
import {launchDefaults,normalizeRadarUi,
  selectedFeed as currentFeed,launchRows as filterLaunchRows} from "./filters.mjs";
import {freshPaper,loadPaper,recordActivity,savePaper} from "./paper-wallet.mjs";
import {buyPaper as applyPaperBuy,sellPaper as applyPaperSale} from "./trading/paper-pipeline.mjs";
import {autoBuyCandidates,autoExitCandidates} from "./trading/decision-engine.mjs";
import {createServerPaper} from "./server-paper.mjs";
import {createApiClient} from "./api-client.mjs";
import {node as createNode} from "./dom.mjs";
import {createRadarView} from "./radar-view.mjs";
import {createPaperView} from "./paper-view.mjs";
import {createPerformanceView} from "./paper-performance.mjs";

const RADAR_UI_STORE = "becsRadarUiV1", TRAIL_STORE = "becsRadarTrailV1";
const SIGN_IN_REQUIRED = "Sign in with GitHub to reconnect your server paper account.";
const storage=(()=>{try{return globalThis.localStorage;}catch(_error){return {
  getItem:()=>null,setItem:()=>{throw Error("Browser storage unavailable");}
};}})();
function saved(key,fallback) { try { return JSON.parse(storage.getItem(key)) || fallback; } catch (_) { return fallback; } }
let radarUi=normalizeRadarUi(saved(RADAR_UI_STORE,{}));
let trail=saved(TRAIL_STORE,{scan:null,points:{}}),radarPage=0;
if(!trail||typeof trail.points!=="object"||!trail.points)trail={scan:null,points:{}};
let paper=loadPaper(storage),snapshot=null,prices={},priceTimes={},refreshing=false,marketUnavailable=false;
let searchRows=[],searchTimer=null,searchStatus="";
const api=createApiClient();
let accountMode="loading",serverPaper=null,serverRevision=0,accountRefreshing=false,accountError=null;
function syncAccountControls(){
  for(const input of document.querySelectorAll("[data-setting]"))input.value=paper.settings[input.dataset.setting];
  $("cash-input").value=paper.cashSol;
}
function accountStatus(){
  const needsSignIn=accountError?.status===401;
  $("account-status").textContent=needsSignIn?"Sign-in required · server paper actions are blocked":accountError?"Paper account unavailable · retrying automatically":accountMode==="server"?"Server paper account · saved across devices":accountMode==="local"?"Local paper wallet · saved on this browser":"Checking paper account…";
  if(needsSignIn)$("account-login").hidden=false;
  else if(accountMode==="server")$("account-login").hidden=true;
  $("retry-paper").hidden=!serverPaper?.pending;
}
function receiveAccount(result){if(result.revision<serverRevision)return;const auto=paper.auto;paper=result.paper;paper.auto=auto;serverRevision=result.revision;syncAccountControls();accountStatus();render();}
async function serverAction(action,retry=false){
  try{const result=await (retry?serverPaper.retry():serverPaper.send(action));accountError=null;receiveAccount(result);if(result.message)message(result.message);return result.ok;}
  catch(error){paper.auto=false;if(error.status===401)accountError=error;
    message((error.status===401?SIGN_IN_REQUIRED:error.message)+(serverPaper.pending?" Use Retry pending action; do not place it again.":""));render();return false;}
  finally{accountStatus();}
}
async function initializeAccount(){
  serverPaper??=createServerPaper({storage:{getItem:key=>globalThis.sessionStorage.getItem(key),setItem:(key,value)=>globalThis.sessionStorage.setItem(key,value),removeItem:key=>globalThis.sessionStorage.removeItem(key)}});
  const capability=await serverPaper.request("/api/paper/capabilities");
  if(!capability.enabled){accountMode="local";$("account-login").hidden=true;return;}
  const status=await serverPaper.request("/api/auth/status");
  if(!status.authenticated){accountMode="local";$("account-login").hidden=false;return;}
  const result=await serverPaper.read();serverPaper.attach(result.paper);accountMode="server";
  receiveAccount(result);$("account-logout").hidden=false;
  if(serverPaper.pending)message("A previous paper action needs a retry to confirm its result.");
}
async function refreshAccount(){
  if(accountRefreshing||serverPaper?.busy||serverPaper?.pending&&accountMode!=="loading")return;
  accountRefreshing=true;
  try{
    if(accountMode==="loading")await initializeAccount();
    else if(accountMode==="server")receiveAccount(await serverPaper.read());
    accountError=null;
  }catch(error){
    paper.auto=false;accountError=error;
    message(error.status===401?SIGN_IN_REQUIRED:"Paper account unavailable. Retrying automatically. "+error.message);render();
  }finally{accountRefreshing=false;accountStatus();}
}
function accountReady(){
  if(accountError){message(accountError.status===401?SIGN_IN_REQUIRED:"Paper account unavailable. Wait for it to reconnect.");return false;}
  if(accountMode==="loading"){message("Wait for the paper account check, or reload to retry.");return false;}
  return true;
}
const $=id=>document.getElementById(id);
function save(){if(accountMode!=="local")return true;const persisted=savePaper(storage,paper);if(!persisted)message("Browser storage is unavailable or full; paper trades and settings may not persist.");return persisted;}
function saveRadar() { try { storage.setItem(RADAR_UI_STORE,JSON.stringify(radarUi)); } catch (_) {} }
async function loadRadarHistory(s) {
  if(!s.lastScanAt||s.lastScanAt===trail.scan)return;
  try {
    const history=await api.history();
    trail={scan:s.lastScanAt,points:history.trails||{}};
    try { storage.setItem(TRAIL_STORE,JSON.stringify(trail)); } catch (_) {}
  } catch (_) { /* Keep the last usable chart while the separate history request is unavailable. */ }
}
let toastTimer;
function message(value) {
  $("message").textContent=value;$("toast").textContent=value;
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$("toast").textContent="";},4500);
}
function node(tag,className,value){return createNode(document,tag,className,value);}
function solUsd(){return recentMark(snapshot?.solPriceAt,180000)?num(snapshot?.solUsd):null;}
function selectedFeed(){return currentFeed(radarUi);}
function launchRows(rows){return filterLaunchRows(rows,paper.settings,radarUi);}
async function buy(row,automatic=false,amount=paper.settings.betUsd){
  if(!accountReady())return false;
  if(accountMode==="server"){
    const ok=await serverAction({type:"buy",mint:row.mint,amount,automatic,feed:selectedFeed()});
    if(ok&&!automatic)await refreshPrices(true);return ok;
  }
  const result=applyPaperBuy({paper,row,amount,automatic,solRate:solUsd(),feed:selectedFeed()});
  if(!result.ok)return message(result.message);
  prices[row.mint]=result.priceRecord;const persisted=save();render();if(persisted&&result.message)message(result.message);
}
async function sellPaper(mint,pct,dollars=null,automatic=false){
  if(!accountReady())return false;
  if(accountMode==="server")return serverAction({type:"sell",mint,dollars,automatic});
  const token=currentToken(),result=applyPaperSale({paper,mint,pct,dollars,automatic,solRate:solUsd(),
    mark:prices[mint],markAt:priceTimes[mint],marketCap:token?.mint===mint?token.marketCap:null});
  if(!result.ok)return message(result.message);
  const persisted=save();render();if(persisted)message(result.message);
}
function renderRadar(){radarView.renderRadar();}
function renderSignals(){radarView.renderSignals();}
function render(){radarView.renderFilterSummary();renderRadar();renderSignals();paperView.renderWallet();paperView.renderHolds();paperView.renderDock();paperView.renderTape();performanceView.render();}
let marking=false,lastMarkAt=0;
async function refreshPrices(force=false) {
  const mints=Object.keys(paper.holds);if(!mints.length||marking||!force&&Date.now()-lastMarkAt<30000)return;
  marking=true;
  try {
    for(let i=0;i<mints.length;i+=100) {
      const chunk=mints.slice(i,i+100),result=await api.paperPrices(chunk);
      for(const mint of chunk) {if(!paper.holds[mint])continue;const data=result.prices[mint];
        if(num(data?.priceUsd)){prices[mint]={...data,source:"jupiter-v3"};priceTimes[mint]=data.observedAt;paper.holds[mint].lastPrice=data.priceUsd;}
        else {delete prices[mint];delete priceTimes[mint];}
      }
    }
    lastMarkAt=Date.now();await runAutoExits();save();render();
  }catch(error){message("Paper price update: "+error.message);}
  finally{marking=false;}
}
async function runAutoBuys() {
  for(const row of autoBuyCandidates({enabled:paper.auto,rows:snapshot?.radar||[],settings:paper.settings,
    radarUi,enteredAssets:paper.bought})){if(!paper.auto||serverPaper?.busy||serverPaper?.pending)break;await buy(row,true);}
}
async function runAutoExits() {
  for(const hold of autoExitCandidates({enabled:paper.auto,positions:paper.holds,settings:paper.settings,prices}))
    {if(!paper.auto||serverPaper?.busy||serverPaper?.pending)break;await sellPaper(hold.mint,100,1,true);}
}
function renderMarketStatus() {
  radarView.renderFeeds();
  if(marketUnavailable){
    $("market-status").textContent=snapshot?"Market connection unavailable · Showing cached data":"Market connection unavailable · Waiting for data";
    document.body.dataset.scanning="false";$("scan-state").textContent="DISCONNECTED";
    return;
  }
  if(!snapshot)return;
  const s=snapshot,scanned=s.lastScanAt?new Date(s.lastScanAt).toLocaleTimeString():"pending";
  $("status").textContent=(s.paused?"Scans paused":s.running?"Scanning":"Updated")+" · "+scanned+(s.lastError?" · "+s.lastError:"");
  $("market-status").textContent="Jupiter + DexScreener scan "+scanned+(s.lastError?" · Some data delayed":" · 5m / 1h / 6h / 24h feeds");
  document.body.dataset.scanning=String(!!s.running);$("scan-state").textContent=s.running?"SCANNING":s.lastError?"DELAYED":"REST / 60s";
}
async function refresh() {
  // Age cached observations even when an earlier request is still waiting.
  renderMarketStatus();
  if (refreshing) return;refreshing=true;$("refresh").disabled=true;$("refresh").setAttribute("aria-busy","true");
  try {
    const s=await api.basket().catch(error=>{marketUnavailable=true;throw error;});
    snapshot=s;marketUnavailable=false;renderMarketStatus();await loadRadarHistory(s);
    observeContacts(s);await runAutoBuys();render();await refreshPrices();
  } catch(error) { renderMarketStatus();$("status").textContent=error.message;message(error.message); }
  finally { refreshing=false;$("refresh").disabled=false;$("refresh").setAttribute("aria-busy","false"); }
}
let selectedMint=null,selectedFallback=null,dockAmount=1;

const getState=()=>({paper,snapshot,prices,priceTimes,radarUi,trail,searchRows,searchStatus,radarPage,marketUnavailable,
  selectedMint,dockAmount,contactTape});
const paperView=createPaperView({document,getState,actions:{
  solUsd,currentToken:()=>currentToken(),canSell:(mint)=>canSell(mint),sell:(...args)=>sellPaper(...args),message
}});
const performanceView=createPerformanceView({document,getPaper:()=>paper});
const radarView=createRadarView({document,getState,actions:{
  solUsd,currentToken:()=>currentToken(),canSell:(mint)=>canSell(mint),sell:(...args)=>sellPaper(...args),
  buy:(...args)=>buy(...args),refreshPrices:(...args)=>refreshPrices(...args),
  selectToken:(...args)=>selectToken(...args),selectTokenState:row=>{selectedMint=row.mint;selectedFallback=row;},
  setRadarPage:page=>{radarPage=page;}
}});
const seenContacts=new Set(),contactTape=[];
function executeBuy(){const row=currentToken();if(!row)return;buy(row,false,dockAmount);refreshPrices(true);paperView.renderDock();}
function executeSell(){if(selectedMint)sellPaper(selectedMint,100,dockAmount);paperView.renderDock();}

function canSell(mint){return Boolean(paper.holds[mint]&&solUsd()&&prices[mint]?.source==='jupiter-v3'&&num(prices[mint]?.priceUsd)&&recentMark(priceTimes[mint],120000));}
function currentToken(){return (snapshot?.radar||[]).find(row=>row.mint===selectedMint)||searchRows.find(row=>row.mint===selectedMint)||selectedFallback;}
function selectToken(row,forceSheet=false){
  const changed=selectedMint!==row.mint;selectedMint=row.mint;selectedFallback=row;
  paperView.renderDock();paperView.renderSheet();
  if(forceSheet||typeof matchMedia==='undefined'||matchMedia('(max-width:800px)').matches){
    const sheet=$('token-sheet');sheet.showModal?.();
    // Browsers can restore a dialog's previous scroll when it enters the top layer.
    if(changed)sheet.scrollTop=0;
  }
}
for(const amount of [1,5,10]){const button=node('button','','$'+amount);button.dataset.amount=String(amount);button.onclick=()=>{dockAmount=amount;$('dock-amount').value=amount;paperView.renderDock();};$('dock-sizes').append(button);}
$('dock-amount').onchange=()=>{const amount=Number($('dock-amount').value);if(!Number.isFinite(amount)||amount<=0){$('dock-amount').value=dockAmount;return message('Enter a positive dollar amount.');}dockAmount=amount;paperView.renderDock();};
$('dock-token').onclick=()=>{const row=currentToken();if(row)selectToken(row,true);else setTerminalView('radar');};$('dock-buy').onclick=executeBuy;$('dock-sell').onclick=executeSell;$('sheet-buy').onclick=executeBuy;$('sheet-sell').onclick=executeSell;$('sheet-close').onclick=()=>$('token-sheet').close?.();
// Closing a refreshed sheet must not return focus to a discarded card or scroll
// the underlying market panel. The dock token is stable across all refreshes.
$('token-sheet').addEventListener('close',()=>$('dock-token').focus({preventScroll:true}));
$('token-sheet').addEventListener('click',event=>{
  if(event.target!==$('token-sheet'))return;
  const bounds=$('token-sheet').getBoundingClientRect();
  if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)
    $('token-sheet').close();
});
function observeContacts(s){for(const row of launchRows(s.radar||[])){if(seenContacts.has(row.mint))continue;seenContacts.add(row.mint);contactTape.unshift({at:new Date().toISOString(),text:'DETECTED → '+row.symbol+' · MC '+compactUsd(row.marketCap)+' · '+selectedFeed()});}contactTape.length=Math.min(contactTape.length,50);if(seenContacts.size>5000)seenContacts.clear();}
for(const input of document.querySelectorAll("[data-setting]")) {
  const name=input.dataset.setting;input.value=paper.settings[name];input.addEventListener("change",async()=>{
    if(!accountReady()){input.value=paper.settings[name];return;}
    const value=Number(input.value);if (!Number.isFinite(value)||value<0||(name==="betUsd"&&value<=0)||(name==="impactPct"&&value>50)||(name==="minOrganicScore"&&value>100)) {input.value=paper.settings[name];return message("Enter a valid value for this setting.");}
    const next={...paper.settings,[name]:value};if(next.maxCap&&next.minCap>next.maxCap||next.maxAge&&next.minAge>next.maxAge){input.value=paper.settings[name];return message("Minimum cannot exceed maximum.");}if(accountMode==="server"){await serverAction({type:"settings",settings:{[name]:value},revision:serverRevision});syncAccountControls();return;}paper.settings=next;radarPage=0;const persisted=save();render();if(persisted)message("Shared settings saved.");
  });
}
$("cash-input").value=paper.cashSol;
$("set-cash").onclick=()=>{if(!accountReady())return;const value=Number($("cash-input").value);if(!Number.isFinite(value)||value<0) return message("Enter a valid SOL amount.");if(accountMode==="server")return serverAction({type:"cash",cashSol:value,revision:serverRevision});paper.cashSol=value;recordActivity(paper,"adjust","Set paper cash to "+short(value)+" SOL");const persisted=save();render();if(persisted)message("Paper cash updated.");};
$("reset-paper").onclick=()=>{if(!accountReady())return;if(!confirm("Reset paper holds, history, and bought-once list?"))return;const cash=Number($("cash-input").value);if(accountMode==="server")return serverAction({type:"reset",cashSol:Number.isFinite(cash)&&cash>=0?cash:.4,revision:serverRevision});const settings=paper.settings,account=paper.account;paper={...freshPaper(),account,cashSol:Number.isFinite(cash)&&cash>=0?cash:.4,settings};prices={};priceTimes={};const persisted=save();render();if(persisted)message("Paper wallet reset.");};
$("fresh-preset").onclick=async()=>{if(!accountReady())return;if(accountMode==="server"&&!await serverAction({type:"settings",settings:{...launchDefaults},revision:serverRevision}))return;Object.assign(paper.settings,launchDefaults);radarUi.tab="recent";radarUi.sort="age";radarUi.direction="asc";$("radar-sort").value="age";radarPage=0;for(const input of document.querySelectorAll("[data-setting]"))input.value=paper.settings[input.dataset.setting];const persisted=save();saveRadar();render();if(persisted)message("Fresh-launch filters restored.");};
$("auto").onclick=()=>{if(!accountReady())return;if(serverPaper?.pending)return message("Resolve the pending paper action first.");paper.auto=!paper.auto;const persisted=save();render();if(persisted)message(paper.auto?"Auto paper on while this page is open.":"Auto paper off.");runAutoBuys();};
for(const [tab,label] of [["recent","New launches"],["trending","Trending launches"],["traded","Active launches"],["organic","Organic launches"],["dex:profiles","Dex profiles"],["dex:updates","Dex updates"],["dex:takeovers","Dex takeovers"],["dex:ads","Dex paid ads"],["dex:boosts","Dex latest boosts (paid)"],["dex:top","Dex top boosts (paid)"]]) {
  const b=node("button","",label);b.dataset.tab=tab;b.onclick=()=>{radarUi.tab=tab;radarPage=0;saveRadar();render();};$("radar-tabs").append(b);
}
$("radar-search").oninput=()=>{
  radarPage=0;clearTimeout(searchTimer);
  const query=$("radar-search").value.trim();
  searchRows=[];searchStatus=query.length<2?"Enter at least 2 characters":"Searching Jupiter…";renderRadar();
  if(query.length<2)return;
  searchTimer=setTimeout(async()=>{
    try {
      const result=await api.search(query);
      if($("radar-search").value.trim()!==query)return;
      searchRows=result.rows;searchStatus=result.rows.length+" Jupiter search results";renderRadar();
    } catch(error) {if($("radar-search").value.trim()===query){searchStatus="Search: "+error.message;renderRadar();}}
  },450);
};
$("radar-source").value=radarUi.source;$("radar-source").onchange=()=>{radarUi.source=$("radar-source").value;radarPage=0;saveRadar();render();};
$("radar-sort").value=radarUi.sort;$("radar-sort").onchange=()=>{radarUi.sort=$("radar-sort").value;radarPage=0;saveRadar();render();};
$("sort-direction").onclick=()=>{radarUi.direction=radarUi.direction==="desc"?"asc":"desc";radarPage=0;saveRadar();render();};
for(const button of document.querySelectorAll("[data-sort]")) button.onclick=()=>{
  radarUi.sort=button.dataset.sort;$("radar-sort").value=radarUi.sort;radarPage=0;saveRadar();render();
};
$("text-size").value=radarUi.size;
function applyTextSize() {document.documentElement.style.setProperty("--scale",{small:.9,regular:1,large:1.2}[radarUi.size]||1);}
saveRadar();applyTextSize();$("text-size").onchange=()=>{radarUi.size=$("text-size").value;applyTextSize();saveRadar();};
$("page-size").value=String(radarUi.pageSize);$("page-size").onchange=()=>{radarUi.pageSize=Number($("page-size").value);radarPage=0;saveRadar();render();};
$("previous").onclick=()=>{radarPage=Math.max(0,radarPage-1);renderRadar();};
$("next").onclick=()=>{radarPage++;renderRadar();};
$("refresh").onclick=refresh;
$("brand-logo").onclick=()=>$("brand-sheet").showModal();
$("brand-close").onclick=()=>$("brand-sheet").close();
function setTerminalView(view) {
  const valid=["radar","performance","paper","activity","settings","signals","connections"];
  view=valid.includes(view)?view:"radar";
  document.body.dataset.view=view;
  $("mode-label").textContent="PAPER MODE";
  $("mode-label").className="pill paper";
  for(const button of document.querySelectorAll(".view-nav [data-view]")) {
    button.className=button.dataset.view===view?"selected":"";
    button.setAttribute("aria-current",button.dataset.view===view?"page":"false");
  }
  const dock=view==="radar"||view==="signals"?"paper":view;
  for(const panel of document.querySelectorAll("[data-view-panel]")) panel.className=
    panel.dataset.viewPanel===dock?"dock-panel active":"dock-panel";
  try { storage.setItem("becsTerminalView",view); } catch (_) {}
}
for(const button of document.querySelectorAll(".view-nav [data-view]"))
  button.onclick=()=>setTerminalView(button.dataset.view);
let terminalView="radar";try{terminalView=storage.getItem("becsTerminalView")||"radar";}catch(_error){}
setTerminalView(terminalView);
$("account-login").onclick=()=>{location.href="/api/auth/github";};
$("account-logout").onclick=async()=>{
  if(serverPaper.busy||serverPaper.pending)return message("Resolve the pending paper action before signing out.");
  try{await serverPaper.request("/api/auth/logout",{method:"POST"});location.reload();}catch(error){message(error.message);}
};
$("retry-paper").onclick=()=>serverAction(null,true);
// A returning phone tab revalidates immediately; only success clears disconnection.
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")refresh();});
window.addEventListener("online",refresh);
window.addEventListener("offline",()=>{marketUnavailable=true;renderMarketStatus();});
// Private account availability must never gate public market rendering or polling.
render();refreshAccount();refresh();setInterval(refreshAccount,15000);setInterval(refresh,15000);
