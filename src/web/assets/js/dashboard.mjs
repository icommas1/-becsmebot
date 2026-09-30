import {num,recentMark,short,usd,tokenPrice} from "./core.mjs";
import {launchDefaults,normalizeRadarUi,paperReady as rowPaperReady,passes as rowPasses,
  selectedFeed as currentFeed,launchRows as filterLaunchRows} from "./filters.mjs";
import {freshPaper,loadPaper,recordActivity,savePaper,buyPaper as applyPaperBuy,
  sellPaper as applyPaperSale,portfolioSummary} from "./paper-wallet.mjs";
import {createApiClient} from "./api-client.mjs";
import {node as createNode} from "./dom.mjs";
import {createRadarView} from "./radar-view.mjs";
import {createPaperView} from "./paper-view.mjs";

const RADAR_UI_STORE = "becsRadarUiV1", TRAIL_STORE = "becsRadarTrailV1";
function saved(key,fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (_) { return fallback; } }
let radarUi=normalizeRadarUi(saved(RADAR_UI_STORE,{}));
let trail=saved(TRAIL_STORE,{scan:null,points:{}}),radarPage=0;
if(!trail||typeof trail.points!=="object"||!trail.points)trail={scan:null,points:{}};
let paper=loadPaper(localStorage),snapshot=null,prices={},priceTimes={},refreshing=false;
let searchRows=[],searchTimer=null,searchStatus="";
const api=createApiClient();
const $=id=>document.getElementById(id);
function save(){if(!savePaper(localStorage,paper))message("Phone storage is full; paper trades may not persist.");}
function saveRadar() { try { localStorage.setItem(RADAR_UI_STORE,JSON.stringify(radarUi)); } catch (_) {} }
function sampleRadar(s) {
  if(s.trails) {for(const [mint,points] of Object.entries(s.trails)) trail.points[mint]=points;return;}
  if(!s.lastScanAt||s.lastScanAt===trail.scan)return;
  trail.scan=s.lastScanAt;const at=Date.parse(s.lastScanAt);
  for(const row of s.radar||[]) if(num(row.priceUsd)) {const points=trail.points[row.mint]||[];points.push([at,row.priceUsd]);trail.points[row.mint]=points.slice(-1440);}
}
let toastTimer;
function message(value) {
  $("message").textContent=value;$("toast").textContent=value;
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$("toast").textContent="";},4500);
}
function node(tag,className,value){return createNode(document,tag,className,value);}
function solUsd(){return recentMark(snapshot?.solPriceAt,180000)?num(snapshot?.solUsd):null;}
function paperReady(row){return rowPaperReady(row);}
function passes(row){return rowPasses(row,paper.settings);}
function selectedFeed(){return currentFeed(radarUi);}
function launchRows(rows){return filterLaunchRows(rows,paper.settings,radarUi);}
function buy(row,automatic=false,amount=paper.settings.betUsd){
  const result=applyPaperBuy({paper,row,amount,automatic,solRate:solUsd(),eligible:passes(row),feed:selectedFeed()});
  if(!result.ok)return message(result.message);
  prices[row.mint]=result.priceRecord;save();render();if(result.message)message(result.message);
}
function sellPaper(mint,pct,dollars=null,automatic=false){
  const token=currentToken(),result=applyPaperSale({paper,mint,pct,dollars,automatic,solRate:solUsd(),
    mark:prices[mint],markAt:priceTimes[mint],marketCap:token?.mint===mint?token.marketCap:null});
  if(!result.ok)return message(result.message);
  save();render();message(result.message);
}
function renderRadar(){radarView.renderRadar();}
function renderSignals(){radarView.renderSignals();}
function render(){radarView.renderFilterSummary();renderRadar();renderSignals();paperView.renderWallet();paperView.renderHolds();paperView.renderDock();paperView.renderTape();}
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
    lastMarkAt=Date.now();runAutoExits();save();render();
  }catch(error){message("Paper price update: "+error.message);}
  finally{marking=false;}
}
function runAutoBuys() {if(paper.auto)for(const row of launchRows(snapshot?.radar||[]))if(!paper.bought[row.mint])buy(row,true);}
function runAutoExits() {
  if(!paper.auto||paper.settings.exitMultiple<=1)return;
  for(const h of Object.values(paper.holds))if(num(prices[h.mint]?.priceUsd)/h.entryPrice>=paper.settings.exitMultiple&&!h.autoExited) {
    const before=h.qty;sellPaper(h.mint,100,1,true);
    if(h.qty<before&&paper.holds[h.mint])paper.holds[h.mint].autoExited=true;
  }
}
async function refresh() {
  if (refreshing) return;refreshing=true;
  try {
    const s=await api.basket();snapshot=s;sampleRadar(s);
    const scanned=s.lastScanAt?new Date(s.lastScanAt).toLocaleTimeString():"pending";
    $("status").textContent=(s.paused?"Scans paused":s.running?"Scanning":"Updated")+" · "+scanned+(s.lastError?" · "+s.lastError:"");
    $("market-status").textContent="Jupiter scan "+scanned+(s.lastError?" · Some data delayed":" · 5m / 1h / 6h / 24h feeds");
    document.body.dataset.scanning=String(!!s.running);$("scan-state").textContent=s.running?"SCANNING":s.lastError?"DELAYED":"REST / 60s";
    observeContacts(s);runAutoBuys();render();await refreshPrices();
  } catch(error) { $("status").textContent=error.message;message(error.message); }
  finally { refreshing=false; }
}
let selectedMint=null,selectedFallback=null,dockAmount=1;

const getState=()=>({paper,snapshot,prices,priceTimes,radarUi,trail,searchRows,searchStatus,radarPage,
  selectedMint,dockAmount,contactTape});
const paperView=createPaperView({document,getState,actions:{
  solUsd,currentToken:()=>currentToken(),canSell:(mint)=>canSell(mint),sell:(...args)=>sellPaper(...args),message
}});
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
function selectToken(row,forceSheet=false){selectedMint=row.mint;selectedFallback=row;paperView.renderDock();paperView.renderSheet();if(forceSheet||typeof matchMedia==='undefined'||matchMedia('(max-width:800px)').matches)$('token-sheet').showModal?.();}
for(const amount of [1,5,10]){const button=node('button','','$'+amount);button.dataset.amount=String(amount);button.onclick=()=>{dockAmount=amount;$('dock-amount').value=amount;paperView.renderDock();};$('dock-sizes').append(button);}
$('dock-amount').onchange=()=>{const amount=Number($('dock-amount').value);if(!Number.isFinite(amount)||amount<=0){$('dock-amount').value=dockAmount;return message('Enter a positive dollar amount.');}dockAmount=amount;paperView.renderDock();};
$('dock-token').onclick=()=>{const row=currentToken();if(row)selectToken(row,true);else setTerminalView('radar');};$('dock-buy').onclick=executeBuy;$('dock-sell').onclick=executeSell;$('sheet-buy').onclick=executeBuy;$('sheet-sell').onclick=executeSell;$('sheet-close').onclick=()=>$('token-sheet').close?.();
function observeContacts(s){for(const row of launchRows(s.radar||[])){if(seenContacts.has(row.mint))continue;seenContacts.add(row.mint);contactTape.unshift({at:new Date().toISOString(),text:'DETECTED → '+row.symbol+' · MC '+compactUsd(row.marketCap)+' · '+selectedFeed()});}contactTape.length=Math.min(contactTape.length,50);if(seenContacts.size>5000)seenContacts.clear();}
for(const input of document.querySelectorAll("[data-setting]")) {
  const name=input.dataset.setting;input.value=paper.settings[name];input.addEventListener("change",()=>{
    const value=Number(input.value);if (!Number.isFinite(value)||value<0||(name==="betUsd"&&value<=0)||(name==="impactPct"&&value>50)||(name==="minOrganicScore"&&value>100)) {input.value=paper.settings[name];return message("Enter a valid value for this setting.");}
    const next={...paper.settings,[name]:value};if(next.maxCap&&next.minCap>next.maxCap||next.maxAge&&next.minAge>next.maxAge){input.value=paper.settings[name];return message("Minimum cannot exceed maximum.");}paper.settings=next;radarPage=0;save();render();message("Shared settings saved.");
  });
}
$("cash-input").value=paper.cashSol;
$("set-cash").onclick=()=>{const value=Number($("cash-input").value);if(!Number.isFinite(value)||value<0) return message("Enter a valid SOL amount.");paper.cashSol=value;recordActivity(paper,"adjust","Set paper cash to "+short(value)+" SOL");save();render();message("Paper cash updated.");};
$("reset-paper").onclick=()=>{if(!confirm("Reset paper holds, history, and bought-once list?"))return;const cash=Number($("cash-input").value);const settings=paper.settings;paper={...freshPaper(),cashSol:Number.isFinite(cash)&&cash>=0?cash:.4,settings};prices={};priceTimes={};save();render();message("Paper wallet reset.");};
$("fresh-preset").onclick=()=>{Object.assign(paper.settings,launchDefaults);radarUi.tab="recent";radarUi.sort="age";radarUi.direction="asc";$("radar-sort").value="age";radarPage=0;for(const input of document.querySelectorAll("[data-setting]"))input.value=paper.settings[input.dataset.setting];save();saveRadar();render();message("Fresh-launch filters restored.");};
$("auto").onclick=()=>{paper.auto=!paper.auto;save();render();message(paper.auto?"Auto paper on while this page is open.":"Auto paper off.");runAutoBuys();};
for(const [tab,label] of [["recent","New launches"],["trending","Trending launches"],["traded","Active launches"],["organic","Organic launches"]]) {
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
  const valid=["radar","paper","activity","settings","signals","connections"];
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
  try { localStorage.setItem("becsTerminalView",view); } catch (_) {}
}
for(const button of document.querySelectorAll(".view-nav [data-view]"))
  button.onclick=()=>setTerminalView(button.dataset.view);
setTerminalView(localStorage.getItem("becsTerminalView")||"radar");
render();refresh();setInterval(refresh,10000);
