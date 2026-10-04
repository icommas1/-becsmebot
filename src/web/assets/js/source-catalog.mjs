// Selected development/research tools are not automatically runtime data feeds.
export const SELECTED_TOOLS = Object.freeze([
  {id:'google-drive',name:'Google Drive',group:'Documents',role:'Supporting documents and approved research files',boundary:'Private files are not published or ingested automatically.'},
  {id:'gsc-wizard',name:'GSC Wizard',group:'Website analytics',role:'Search performance for authorized websites',boundary:'Not a market-wide search-trend or Solana trading feed.'},
  {id:'parallel-search',name:'Parallel Search',group:'Research',role:'Discover public sources and extract evidence',boundary:'Record the original source; search results are not executable prices.'},
  {id:'railway',name:'Railway',group:'Operations',role:'Application hosting and deployment operations',boundary:'An operations tool, not an independent market signal.'},
  {id:'github',name:'GitHub',group:'Development',role:'Source code, reviews and automated tests',boundary:'A development tool, not an independent market signal.'},
  {id:'magicpath',name:'MagicPath',group:'Design',role:'Interface prototypes and command-center design',boundary:'A design tool; prototypes do not establish implemented behavior.'},
  {id:'exa',name:'Exa',group:'Research',role:'Discover public sources and supporting research',boundary:'Two readers of the same original report count as one origin, not two confirmations.'},
  {id:'supabase',name:'Supabase',group:'Storage',role:'Optional structured storage integration',boundary:'Selection does not migrate the existing PostgreSQL database or resume archive capture.'}
].map(tool=>Object.freeze({...tool,status:'Selected',
  runtime:['exa','parallel-search'].includes(tool.id)?'On-demand research; availability shown in workspace':'No bot-side adapter',
  cost:['exa','parallel-search'].includes(tool.id)?'Limited keyless access; no paid fallback':'Not verified',hitRate:null})));

const intervals=['5m','1h','6h','24h'];
export const FEED_CATALOG=Object.freeze([
  ...['trending','traded','organic'].flatMap(category=>intervals.map(interval=>({id:`${category}:${interval}`,name:`${category} · ${interval}`,origin:'Jupiter',category:'Market',paidPromotion:false}))),
  {id:'recent',name:'Recent launches',origin:'Jupiter',category:'Market',paidPromotion:false},
  ...Object.entries({profiles:'Token profiles',updates:'Profile updates',takeovers:'Community takeovers',ads:'Paid advertisements',boosts:'Latest paid boosts',top:'Top paid boosts'}).map(([id,name])=>({id:`dex:${id}`,name,origin:'DexScreener',category:'Discovery',paidPromotion:['ads','boosts','top'].includes(id)}))
].map(Object.freeze));
export const FEED_FRESH_MS=300000; // Existing terminal/production-smoke display cutoff, not a trade rule.
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

export function feedState(feed,now=Date.now(),connected=true) {
  const value=isObject(feed)?feed:{};
  const at=typeof value.at==='string'?Date.parse(value.at):NaN;
  const valid=Number.isFinite(at)&&at>0&&at<=now;
  const ageMs=valid?now-at:null;
  const count=Number.isSafeInteger(value.count)&&value.count>=0?value.count:null;
  const error=typeof value.error==='string'&&value.error.length>0;
  let status='Pending';
  if(!connected)status='Disconnected';
  else if(error)status='Delayed';
  else if(valid)status=ageMs<=FEED_FRESH_MS?'Reporting':'Delayed';
  else if(value.at!=null)status='Invalid timestamp';
  return {status,count,ageMs,at:valid?value.at:null,cached:count!==null&&status!=='Reporting'};
}

export function marketSources(health,now=Date.now(),connected=false) {
  const feeds=isObject(health?.feeds)?health.feeds:{};
  return FEED_CATALOG.map(feed=>({...feed,...feedState(Object.hasOwn(feeds,feed.id)?feeds[feed.id]:null,now,connected)}));
}

export function sourceSummary(rows) {
  const reporting=rows.filter(row=>row.status==='Reporting');
  return {configured:rows.length,reporting:reporting.length,reportingOrigins:new Set(reporting.map(row=>row.origin)).size};
}

export function archiveLabel(value,connected) {
  if(!connected||!isObject(value)||typeof value.enabled!=='boolean')return 'Archive status unavailable';
  if(!value.enabled)return 'Archive capture paused';
  return value.healthy===true?'Archive capture enabled':'Archive capture needs attention';
}

export function walletLabel(value,connected) {
  if(!connected||!isObject(value)||typeof value.enabled!=='boolean')return 'Wallet-intelligence status unavailable';
  return value.enabled?'Wallet intelligence enabled; see provider evidence':'Wallet intelligence disabled';
}

export function validStatusPayload(key,value) {
  if(!isObject(value))return false;
  if(key==='health')return value.ok===true&&typeof value.tradingEnabled==='boolean'&&isObject(value.feeds);
  if(key==='archive')return typeof value.enabled==='boolean'&&typeof value.healthy==='boolean';
  if(key==='wallet')return typeof value.enabled==='boolean'&&isObject(value.providers);
  return false;
}
