import {SELECTED_TOOLS,marketSources,sourceSummary,archiveLabel,walletLabel} from './source-catalog.mjs';
import {readStatusResponse} from './source-status.mjs';
const $=id=>document.getElementById(id);
const state={health:null,archive:null,wallet:null};
const connected={health:false,archive:false,wallet:false};
const endpoints={health:'/health',archive:'/health/archive',wallet:'/api/wallet-intel'};
const controllers=new Set();
let pending=false,stopped=false,timer=null;
function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
function field(list,label,value){list.append(node('dt',label),node('dd',value));}
function renderTools(){
  const query=$('tool-search').value.trim().toLowerCase();
  const tools=SELECTED_TOOLS.filter(tool=>`${tool.name} ${tool.group} ${tool.role}`.toLowerCase().includes(query));
  $('tool-count').textContent=`${tools.length} of ${SELECTED_TOOLS.length} selected tools`;
  $('tools').replaceChildren(...tools.map(tool=>{
    const card=node('article',undefined,'card');card.dataset.tool=tool.id;
    card.append(node('span',tool.group,'badge'),node('h3',tool.name),node('p',tool.role));
    const details=node('dl');field(details,'Selection',tool.status);field(details,'BecsBot connection',tool.runtime);field(details,'Cost',tool.cost);field(details,'Hit rate','Not measured');
    card.append(details,node('p',tool.boundary));return card;
  }));
}
function renderStatus(){
  const rows=marketSources(state.health,Date.now(),connected.health);
  const summary=sourceSummary(rows);
  $('summary').textContent=`${summary.reporting} / ${summary.configured} configured feeds reporting · ${summary.reportingOrigins} reporting provider families`;
  $('connection').textContent=connected.health?'Backend status received. Feed timestamps determine freshness.':'Backend status unavailable. Any retained values are cached, not current confirmations.';
  $('execution').textContent=connected.health&&state.health?.tradingEnabled===false?'Live trading disabled':'Execution status unavailable';
  $('archive').textContent=archiveLabel(state.archive,connected.archive);
  $('wallet').textContent=walletLabel(state.wallet,connected.wallet);
  $('feeds').replaceChildren(...rows.map(feed=>{
    const card=node('article',undefined,'card');card.dataset.feed=feed.id;
    card.append(node('span',`${feed.origin} · ${feed.status}`,'badge'),node('h3',feed.name));
    const list=node('dl');field(list,'Observed entries',feed.count===null?'Unavailable':`${feed.count}${feed.cached?' (cached)':''}`);
    field(list,'Last successful update',feed.ageMs===null?'Unavailable':`${Math.floor(feed.ageMs/1000)} seconds ago`);
    field(list,'Evidence type',feed.paidPromotion?'Paid promotion':feed.category);
    card.append(list);return card;
  }));
}
async function load(key,url){
  const controller=new AbortController();controllers.add(controller);
  const timeout=setTimeout(()=>controller.abort(),10000);
  try{
    const response=await fetch(url,{cache:'no-store',credentials:'same-origin',signal:controller.signal});
    const value=await readStatusResponse(key,response);
    if(!stopped&&navigator.onLine!==false){state[key]=value;connected[key]=true;}
  }catch(_error){connected[key]=false;}
  finally{clearTimeout(timeout);controllers.delete(controller);}
}
async function refresh(){
  renderStatus();
  if(pending||stopped||document.hidden)return;
  if(navigator.onLine===false){Object.keys(connected).forEach(key=>connected[key]=false);renderStatus();return;}
  pending=true;$('refresh').disabled=true;
  try{await Promise.all(Object.entries(endpoints).map(([key,url])=>load(key,url)));}
  finally{pending=false;$('refresh').disabled=false;if(!stopped)renderStatus();}
}
function start(){if(timer!==null)return;stopped=false;timer=setInterval(()=>void refresh(),15000);void refresh();}
function stop(){stopped=true;clearInterval(timer);timer=null;controllers.forEach(controller=>controller.abort());Object.keys(connected).forEach(key=>connected[key]=false);}
$('tool-search').addEventListener('input',renderTools);
$('refresh').addEventListener('click',()=>void refresh());
window.addEventListener('offline',()=>{Object.keys(connected).forEach(key=>connected[key]=false);controllers.forEach(controller=>controller.abort());renderStatus();});
window.addEventListener('online',()=>void refresh());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
window.addEventListener('pagehide',stop);
window.addEventListener('pageshow',()=>start());
renderTools();start();
