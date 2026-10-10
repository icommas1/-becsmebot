/* Becs — Terminal Pro Mini App. Real API-backed UI; no invented operational metrics. */
(() => {
'use strict';
const tg = window.Telegram?.WebApp;
try { tg?.ready(); tg?.expand(); tg?.setHeaderColor('#0b1320'); tg?.setBackgroundColor('#090f1b'); } catch (_) {}
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/assets/sw.js').catch(()=>{});

const ICONS = {
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  routes:'<circle cx="6" cy="4" r="2"/><path d="M6 6v10a4 4 0 0 0 4 4h4"/><circle cx="17" cy="20" r="2"/><path d="M6 12h8a4 4 0 0 0 4-4V6"/><circle cx="18" cy="4" r="2"/>',
  filter:'<path d="M4 5h16l-6 7v6l-4 2v-8z"/>',
  queue:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  send:'<path d="m21 3-7.5 18-4-7.5L2 10zM9.5 13.5 21 3"/>',
  document:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
  copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  bolt:'<path d="m13 2-9 12h7l-1 8 10-12h-7z"/>',
  brain:'<path d="M12 6a4 4 0 0 0-7 2 4 4 0 0 0-1 7 4 4 0 0 0 7 3v-12M12 6a4 4 0 0 1 7 2 4 4 0 0 1 1 7 4 4 0 0 1-7 3V6M9 9v4m6-4v4M11 15H8m8 0h-3"/>',
  shield:'<path d="m12 22 1-.5C18 19 21 15 21 9V5l-9-3-9 3v4c0 6 3 10 8 12.5z"/><path d="m9 12 2 2 4-4"/>',
  activity:'<polyline points="3 12 7 12 10 5 14 19 17 12 21 12"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2 2-.1-.1a1.7 1.7 0 0 0-1.9-.3l-.3.1V21h-3v-.3a1.7 1.7 0 0 0-1.9-.3l-.1.1-2-2 .1-.1A1.7 1.7 0 0 0 8 16.5l-.1-.3H5v-3h.3a1.7 1.7 0 0 0 .3-1.9l-.1-.1 2-2 .1.1a1.7 1.7 0 0 0 1.9.3l.3-.1V5h3v.3a1.7 1.7 0 0 0 1.9.3l.1-.1 2 2-.1.1a1.7 1.7 0 0 0-.3 1.9l.1.3H20v3h-.3z" transform="translate(-1 -1)"/>',
  person:'<circle cx="12" cy="8" r="4"/><path d="M4 21c1-5 15-5 16 0"/>',
  check:'<path d="m4 12 5 5L20 6"/>',
  warning:'<path d="m12 3 10 18H2z"/><path d="M12 9v4m0 4h.01"/>',
  pause:'<rect x="5" y="4" width="5" height="16" rx="1"/><rect x="14" y="4" width="5" height="16" rx="1"/>',
  play:'<path d="m7 4 13 8-13 8z"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chevron:'<path d="m9 18 6-6-6-6"/>',
  refresh:'<path d="M3 12a9 9 0 0 1 15-6l3 3M21 3v6h-6M21 12a9 9 0 0 1-15 6l-3-3M3 21v-6h6"/>',
  flask:'<path d="M9 3h6m-5 0v7l-6 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-6-9V3M7 16h10"/>',
  bot:'<rect x="3" y="7" width="18" height="14" rx="4"/><path d="M12 3v4M8 13h.01M16 13h.01M9 17h6"/>',
  lock:'<rect x="4" y="11" width="16" height="11" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
  trash:'<path d="M3 6h18M8 6V4h8v2m3 0-1 15H6L5 6m5 4v8m4-8v8"/>',
  edit:'<path d="m4 16-1 5 5-1 12-12-4-4zM14 6l4 4"/>',
  logout:'<path d="M9 4H4v16h5M14 7l5 5-5 5m5-5H8"/>',
  server:'<rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/><path d="M7 7h.01M7 17h.01"/>',
  arrowdown:'<path d="M12 3v18m-7-7 7 7 7-7"/>'
};
const icon = (name, cls='') => `<span class="ico ${cls}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]||ICONS.activity}</svg></span>`;
const safe = text => String(text ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const fmt = number => Intl.NumberFormat().format(number||0);
const age = value => { if (!value) return ''; const seconds=Math.max(0,Math.floor(Date.now()/1000-value)); return seconds<60?'just now':seconds<3600?Math.floor(seconds/60)+'m ago':seconds<86400?Math.floor(seconds/3600)+'h ago':new Date(value*1000).toLocaleDateString(); };
const navigate = name => { state.page=name; render(); window.scrollTo({top:0,behavior:'smooth'}); };
const modes = [{id:'express',title:'Express',sub:'Fastest',ico:'bolt',cls:'mode-express',help:'Forward with essential route checks; no AI or optional content filters in the critical path.'},{id:'smart',title:'Smart',sub:'Filtered',ico:'filter',cls:'mode-smart',help:'Use local keyword, address, regex and duplicate rules before queueing.'},{id:'hybrid',title:'Hybrid',sub:'AI Assist',ico:'brain',cls:'mode-hybrid',help:'Local filters decide first; AI can analyze afterward without blocking delivery.'},{id:'ai-gated',title:'AI-Gated',sub:'AI Decision',ico:'shield',cls:'mode-ai-gated',help:'Require AI approval before forwarding. If AI is unavailable, messages are held for review.'}];
const nav=[['home','Home','home'],['routes','Routes','routes'],['filters','Smart Filters','filter'],['queue','Queue','queue'],['inspector','Inspector','activity'],['more','More','more']];
const state={page:'home',overview:null,routes:[],jobs:[],reviews:[],chats:[],inspections:[],inspectorKind:'all',jobTab:'all',simResult:null,modeExplain:'smart',busy:false,apiError:'',chatSearch:'',editing:null};
const dom = id => document.getElementById(id);

async function request(path,options={}) {
 const headers={'Accept':'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})};
 const auth=sessionStorage.getItem('becs_key'); if(auth)headers['X-Becs-Key']=auth;
 if(tg?.initData)headers['X-Telegram-Init-Data']=tg.initData;
 let response;
 try { response=await fetch('/api'+path,{...options,headers,cache:'no-store'}); }
 catch {throw new Error('Becs server is unreachable. Start the FastAPI service and try again.');}
 const payload=await response.json().catch(()=>({detail:response.statusText}));
 if(!response.ok){const e=new Error(typeof payload.detail==='string'?payload.detail:JSON.stringify(payload.detail||'Request failed'));e.status=response.status;throw e;}
 return payload;
}
function toast(message,isError=false){const el=document.createElement('div');el.className='toast'+(isError?' error':'');el.textContent=message;dom('toastRegion').append(el);setTimeout(()=>el.remove(),4200);}
async function reload(full=true){
 try{
  const calls=[request('/overview'),request('/routes')];
  if(full)calls.push(request('/jobs?limit=100'),request('/reviews'),request('/inspector?limit=100'));
  const result=await Promise.all(calls);
  state.overview=result[0];state.routes=result[1].routes;
  if(full){state.jobs=result[2].jobs;state.reviews=result[3].reviews;state.inspections=result[4].items;}
  state.apiError='';render();
 }catch(e){state.apiError=e.message;render();}
}
function renderNav(){
 const html=nav.map(([id,label,ico])=>`<button class="nav-item ${state.page===id?'active':''}" data-nav="${id}">${icon(ico)} ${label}</button>`).join('');
 dom('sideNav').innerHTML=html;
 dom('bottomNav').innerHTML=nav.map(([id,label,ico])=>`<button class="bottom-tab ${state.page===id?'active':''}" data-nav="${id}" aria-label="${label}" ${state.page===id?'aria-current="page"':''}>${icon(ico)}<span>${label}</span></button>`).join('');
 dom('crumb').textContent=({home:'Overview',routes:'Routes',filters:'Regex Lab',queue:'Delivery Queue',inspector:'Message Inspector',more:'System Settings'})[state.page];
 const active=state.overview?.telegram?.authorized;
 dom('sideDot').classList.toggle('online',!!active);
 dom('sideConnection').textContent=active?'Personal account connected':'Telegram not connected';
}
function pageHead(eyebrow,title,desc,action=''){
 return `<div class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subheading">${desc}</p></div>${action?`<div class="head-actions">${action}</div>`:''}</div>`;
}
function pill(value,type=''){return `<span class="pill ${type}">${safe(value)}</span>`;}
function panel(title,content,action=''){return `<section class="panel"><div class="panel-header"><h2>${title}</h2>${action}</div>${content}</section>`;}
function metric(title,count,ico,desc){return `<div class="metric-card"><div class="metric-top">${title}${icon(ico)}</div><div class="metric-value">${fmt(count)}</div><div class="metric-foot">${desc}</div></div>`;}
function empty(ico,title,desc,action=''){return `<div class="empty-state">${icon(ico)}<strong>${title}</strong><p>${desc}</p>${action}</div>`;}
function modeTiles(){return `<div class="mode-grid">${modes.map(m=>`<button class="mode-tile ${state.modeExplain===m.id?'selected':''}" data-mode="${m.id}">${icon(m.ico,m.cls)}<span>${m.title}</span><small>${m.sub}</small></button>`).join('')}</div><div class="mode-explainer">${safe(modes.find(m=>m.id===state.modeExplain).help)}</div>`;}
function activityRow(evt){
 const colors={forwarded:['send','success'],duplicate:['copy','warn'],error:['warning','warn'],blocked:['shield','warn'],review:['brain','warn'],route:['routes',''],queued:['clock',''],ai:['brain',''],contract:['document','']};
 const [ico,cls]=colors[evt.kind]||['activity',''];
 return `<div class="activity-row"><span class="event-icon ${cls}">${icon(ico)}</span><div class="route-detail"><strong>${safe(evt.kind.charAt(0).toUpperCase()+evt.kind.slice(1))}</strong><small>${safe(evt.detail)}</small></div><span class="event-time">${age(evt.created_at)}</span></div>`;
}
function briefRoute(route){const m=modes.find(x=>x.id===route.mode)||modes[1];return `<div class="route-brief"><span class="route-glyph">${icon(m.ico,m.cls)}</span><div class="route-detail"><strong>${safe(route.name)}</strong><small>${m.title} · ${route.sources.length} sources → ${route.destinations.length} destinations</small></div>${pill(route.enabled?'Enabled':'Draft',route.enabled?'success':'')}</div>`;}
function overviewPage(){
 const o=state.overview;const st=o.stats;const status=o.telegram;
 const note=status.authorized?'Connection authorized':status.configured?'Sign in to enable forwarding':'API credentials not configured';
 const chart=o.graph||[];const max=Math.max(1,...chart);
 const chartHtml=`<div class="terminal-chart" role="img" aria-label="Actual messages delivered each hour over the past 12 hours">${chart.map(v=>`<div class="bar" title="${v} sent" style="height:${Math.max(2,v/max*100)}%"></div>`).join('')}</div><div class="chart-labels"><span>12 HOURS AGO</span><span>${chart.some(Boolean)?'LIVE DELIVERY RECORDS':'AWAITING FIRST DELIVERY'}</span><span>NOW</span></div>`;
 const accountStatus=status.authorized?['Connected','good']:status.configured?['Sign in required','warning']:['Needs setup','warning'];
 const rows=[['person','Telegram account',note,...accountStatus],['routes','Forwarding engine',o.paused?'Paused':'Ready for routes',o.paused?'Paused':'Enabled',o.paused?'warning':'good'],['brain','AI provider',o.ai_configured?'Key configured — optional':'Local filters work without AI',o.ai_configured?'Configured':'Optional',o.ai_configured?'good':''],['queue','Outgoing queue',o.cooldown_seconds?`Account cooldown: ${o.cooldown_seconds}s`:'One personal account · sequential sends',`${st.queued} pending`,o.cooldown_seconds?'warning':st.failed?'warning':'']];
 const health=`<div class="health-list">${rows.map(([ico,label,desc,right,dot])=>`<div class="health-row"><span class="left-icon">${icon(ico)}</span><div><div class="status-main">${label}</div><div class="status-sub">${safe(desc)}</div></div><div class="status-right"><span class="dot ${dot||''}"></span>${safe(right)}</div></div>`).join('')}</div>`;
 const quick=`<div class="quick-grid">${[['plus','New route','new-route'],['flask','Regex lab','open-filters'],['queue','View queue','open-queue'],[o.paused?'play':'pause',o.paused?'Resume':'Pause',o.paused?'resume':'pause']].map(([ico,label,act])=>`<button class="quick-tool" data-action="${act}">${icon(ico)}<span>${label}</span></button>`).join('')}</div>`;
 return `${pageHead('PERSONAL TERMINAL / LIVE DATA','Command Center','Real controls, crypto routing and delivery status — all in one place.',`<button class="button button-primary" data-action="new-route">${icon('plus')} New route</button>`)}
 <div class="top-hero"><div class="hero-left"><span class="hero-symbol">${icon(o.paused?'pause':'shield')}</span><div><b>${o.paused?'Forwarding is paused':status.authorized?'Personal account connected':'Connect your personal Telegram account'}</b><small>${status.authorized?'Ready to process eligible incoming messages':'Setup is required before live forwarding can begin'}</small></div></div><button class="button button-small button-subtle" data-action="open-settings">${status.authorized?'Account details':'Setup'} ${icon('chevron')}</button></div>
 <div class="summary-grid">${metric('FORWARDED',''+st.forwarded,'send','Confirmed deliveries')}${metric('CONTRACTS',st.contracts,'document','Address candidates seen')}${metric('DUPLICATES',st.duplicates,'copy','Suppressed deliveries')}${metric('ROUTES',st.enabled_routes,'routes',st.routes+' total configurations')}</div>
 <div class="dashboard-cols">
 <div style="display:flex;flex-direction:column;gap:17px">${panel('System status',health,`<button class="small-link" data-action="open-settings">Details →</button>`)}${panel('Routing modes',modeTiles(),`<button class="small-link" data-action="open-routes">Manage →</button>`)}${panel('Delivery activity',chartHtml,`<button class="small-link" data-action="open-queue">Queue →</button>`)}</div>
 <div style="display:flex;flex-direction:column;gap:17px">${panel('Quick actions',quick)}${panel('My automations',o.stats.routes?state.routes.slice(0,5).map(briefRoute).join(''):empty('routes','No routes yet','Create your first crypto forwarding route with the Route Builder.',`<button class="button button-small" data-action="new-route">${icon('plus')} Create a route</button>`),`<button class="small-link" data-action="open-routes">View all →</button>`)}${panel('Recent activity',o.activity.length?o.activity.slice(0,6).map(activityRow).join(''):empty('activity','No live events yet','Activity appears here when you create routes, process messages, or test deliveries.'))}</div></div>
 <div style="margin-top:17px">${panel('Queue intelligence',`<div class="queue-strip"><div class="queue-metric"><span>WAITING</span><strong>${st.queued}</strong></div><div class="queue-metric"><span>FAILED</span><strong>${st.failed}</strong></div><div class="queue-metric"><span>REQUIRES REVIEW</span><strong>${st.reviews}</strong></div><div class="queue-metric"><span>DELIVERY STRATEGY</span><strong>${o.cooldown_seconds?`${o.cooldown_seconds}s wait`:'Sequential'}</strong></div><button class="button button-small" data-action="open-queue">Inspect queue ${icon('chevron')}</button></div>`)}</div><p class="footer-label">BECS PERSONAL TERMINAL · ACTUAL STORED METRICS · NO LIVE CONNECTION UNTIL SIGN-IN</p>`;
}
function routesPage(){
 const action=`<button class="button button-primary" data-action="new-route">${icon('plus')} New route</button>`;
 const content=state.routes.map(r=>{
  const m=modes.find(x=>x.id===r.mode)||modes[1];
  return `<article class="route-card"><div class="route-head"><span class="route-glyph">${icon(m.ico,m.cls)}</span><div class="route-detail"><div class="route-name">${safe(r.name)}</div><div class="route-meta">Route #${r.id} · ${m.title}</div></div>${pill(r.enabled?'Enabled':'Paused',r.enabled?'success':'')}</div><div class="route-tags">${pill(`${r.network.toUpperCase()} FORMAT`)}${pill(r.dedup_minutes?`${r.dedup_minutes}m dedupe`:'No dedupe')}${r.require_contract?pill('Contract required'):''}</div><div class="route-arrows"><span>${r.sources.length} source${r.sources.length===1?'':'s'}</span>${icon('arrow')}<span>${r.destinations.length} destination${r.destinations.length===1?'':'s'}</span></div><div class="route-meta" style="margin-top:9px">${safe(r.sources.slice(0,3).join(', ')||'Not selected')} → ${safe(r.destinations.slice(0,2).join(', ')||'Not selected')}</div><div class="route-footer"><label class="toggle" title="Enable or disable route"><input type="checkbox" data-route-toggle="${r.id}" ${r.enabled?'checked':''}><span></span></label><div class="route-buttons"><button class="button button-small" data-edit="${r.id}">${icon('edit')} Edit</button><button class="button button-small button-danger" data-delete="${r.id}">${icon('trash')}</button></div></div></article>`;
 }).join('');
 return `${pageHead('ROUTING / AUTOMATIONS','Forwarding Routes','Build a route, assign a mode, select authorized chats, and configure contract filters.',action)}
 <div class="top-hero"><div class="hero-left"><span class="hero-symbol">${icon('routes')}</span><div><b>One personal Telegram account</b><small>Multiple configurable routes · one outbound send at a time</small></div></div>${pill(`${state.routes.filter(r=>r.enabled).length} active`,'success')}</div>
 ${content?`<div class="route-list">${content}</div>`:empty('routes','No routes configured','Create your first Express, Smart, Hybrid or AI-Gated crypto route.',`<button class="button button-primary" data-action="new-route">${icon('plus')} Build first route</button>`)}`;
}
const filterPresets=[
 {id:'solana',label:'Solana contracts',network:'solana',contract:true,pattern:''},
 {id:'evm',label:'EVM contracts',network:'evm',contract:true,pattern:''},
 {id:'both',label:'Any token address',network:'both',contract:true,pattern:''},
 {id:'launch',label:'Launch signals',network:'both',contract:true,pattern:'launch|presale|liquidity|🚀'},
 {id:'marketcap',label:'Market cap (MC)',network:'both',contract:true,pattern:'\\b(?:mc|market\\s*cap)\\s*[:=$ ]*\\s*\\$?\\d+(?:\\.\\d+)?\\s*[kmb]\\b'},
 {id:'xposts',label:'X / Twitter posts',network:'both',contract:true,pattern:'https?://(?:www\\.)?(?:x\\.com|twitter\\.com)/[A-Za-z0-9_]+/status/\\d+'},
 {id:'dex',label:'DEX links',network:'both',contract:true,pattern:'https?://(?:www\\.)?(?:dexscreener\\.com|dextools\\.io|geckoterminal\\.com)/\\S+'},
 {id:'social',label:'Social mentions',network:'both',contract:true,pattern:'@stonkpairs|https?://(?:www\\.)?(?:x\\.com|twitter\\.com)/\\S+'},
 {id:'emoji',label:'Emoji signals',network:'both',contract:true,pattern:'📊|📈|🎁|🚀|🔥|💎'},
 {id:'clear',label:'Clear preset',network:'both',contract:true,pattern:''}
];
function routePresetDropdown(){
 return '<div class="field becs-template-field"><label for="routeTemplate">Templates</label><select id="routeTemplate" aria-label="Filter templates"><option value="">Choose a template…</option>'+
 filterPresets.map(p=>'<option value="'+safe(p.id)+'">'+safe(p.label)+'</option>').join('')+'</select><span class="field-help">Optional. Templates prefill rules; they never save or activate a route.</span></div>';
}
function applyFilterPreset(id,route=false){
 const p=filterPresets.find(x=>x.id===id);if(!p)return;
 const n=dom(route?'routeNetwork':'labNetwork'),c=dom(route?'routeContract':'labContract'),rx=dom(route?'routePattern':'labPattern');
 if(n)n.value=p.network;if(c)c.checked=p.contract;if(rx)rx.value=p.pattern;
 toast(p.label+' preset applied. Review before saving.');
}
const currentSimRoute=()=>({name:'Filter Lab',mode:'smart',enabled:false,sources:[],destinations:[],allowed:dom('labAllow')?.value||'',blocked:dom('labBlock')?.value||'',pattern:dom('labPattern')?.value||'',match_mode:dom('labMatch')?.value||'any',network:dom('labNetwork')?.value||'both',require_contract:dom('labContract')?.checked||false,dedup_minutes:60,delivery_style:'native'});
function filtersPage(){
 const addresses=state.simResult?.addresses||[];const res=state.simResult;
 return `${pageHead('CRYPTO ENGINE / LOCAL TEST','Crypto Filter Lab','Test contract detection, custom regex, keyword rules and blacklists without forwarding anything.')}
 <div class="lab-grid"><section class="panel"><div class="panel-header"><h2>Message and filter rules</h2>${pill('SAFE SIMULATION')}</div>
 <div class="field"><label>Incoming crypto message</label><textarea id="labMessage" rows="6" placeholder="Paste any Telegram crypto message here...">${safe(state.labText??'NEW SOL launch · CA: So11111111111111111111111111111111111111112 · liquidity locked')}</textarea></div>
 <div class="field"><label>Smart Filters V2 — quick rules</label><div style="display:flex;gap:8px;flex-wrap:wrap">${filterPresets.map(p=>`<button type="button" class="button button-small" data-filter-preset="${p.id}">${safe(p.label)}</button>`).join('')}</div><span class="field-help">Presets fill the form. Test filter previews the decision without forwarding.</span></div><div class="form-grid"><div class="field"><label>Blockchain format</label><select id="labNetwork"><option value="both">Solana + EVM</option><option value="solana">Solana only</option><option value="evm">Ethereum / EVM only</option></select></div><div class="field"><label>Keyword logic</label><select id="labMatch"><option value="any">Match ANY keyword</option><option value="all">Match ALL keywords</option></select></div></div>
 <div class="field"><label>Allowed keywords (comma-separated)</label><input id="labAllow" value="${safe(state.labAllow??'launch, liquidity, CA')}" placeholder="launch, liquidity, CA"></div>
 <div class="field"><label>Blocked keywords</label><input id="labBlock" value="${safe(state.labBlock??'scam, giveaway')}" placeholder="scam, giveaway"></div>
 <div class="field"><label>Custom regex (optional)</label><input id="labPattern" spellcheck="false" value="${safe(state.labPattern??'')}" placeholder="\\b(launch|presale)\\b"><span class="field-help">Timeout-protected regex. Custom patterns require a match when provided.</span></div>
 <label class="checkboxline"><input type="checkbox" id="labContract"> Require an address-format match</label>
 <button class="button button-primary" data-action="run-sim">${icon('flask')} Test filter</button></section>
 <section class="panel"><div class="panel-header"><h2>Decision inspector</h2>${pill('LOCAL ONLY')}</div>${res?`<div class="lab-result"><div style="display:flex;justify-content:space-between;align-items:center"><b>Evaluation result</b>${pill(res.decision.toUpperCase(),res.decision==='forward'?'success':res.decision==='invalid'?'error':'warn')}</div><p class="helper-line">${safe(res.reason)}</p></div><div class="result-detail"><span>Address candidates</span><b>${addresses.length}</b></div><div class="result-detail"><span>Keyword matches</span><b>${safe(res.allowed_hits.join(', ')||'None')}</b></div><div class="result-detail"><span>Blacklist hits</span><b>${safe(res.blocked_hits.join(', ')||'None')}</b></div><div class="result-detail"><span>Custom regex</span><b>${res.regex_match?'Matched':'Not matched / inactive'}</b></div><div class="divider"></div><h3 class="section-title">Extracted addresses</h3>${addresses.length?`<div class="tag-list">${addresses.map(a=>`<span class="chip">${safe(a.network)} · ${safe(a.address)}</span>`).join('')}</div>`:'<p class="helper-line">No valid Solana / EVM address-format candidates found.</p>'}<p class="small-help">Address-format detection does not prove token-mint validity or confirm on-chain contracts. The simulator makes no network requests.</p>`:empty('flask','Ready to test','Set up filter rules and click Test filter to see the exact decision.')}</section></div>`;
}
function inspectorPage(){
 const rows=state.inspections.filter(x=>state.inspectorKind==='all'||x.kind===state.inspectorKind);
 const kinds=['all','contract','blocked','duplicate','queued','forwarded','review','error'];
 return `${pageHead('AUDIT / LIVE ROUTING','Live Message Inspector','Actual routing decisions, duplicate suppression and delivery events.')}
 <section class="panel"><div class="panel-header"><h2>Recorded events</h2><button class="button button-small" data-action="refresh-inspector">${icon('refresh')} Refresh</button></div>
 <div class="queue-tabs">${kinds.map(k=>`<button class="tab-button ${state.inspectorKind===k?'active':''}" data-inspector-kind="${k}">${safe(k)}</button>`).join('')}</div>
 ${rows.length?rows.map(x=>`<div class="job-line"><span class="event-icon ${x.kind==='forwarded'?'success':'warn'}">${icon(x.kind==='duplicate'?'copy':x.kind==='forwarded'?'check':'activity')}</span><div class="job-details"><b>${safe(x.kind.toUpperCase())} · ${safe(x.route_name||'Route #'+(x.route_id??'?'))}</b><small>${safe(x.detail)}</small><small>Source ${safe(x.source_id||'—')} → Destination ${safe(x.destination_id||'—')} · ${age(x.created_at)}</small></div></div>`).join(''):empty('activity','No recorded events','New messages processed by enabled routes will appear here.')}</section>
 <p class="small-help">Recorded events only, not samples. Blocked events include filter reasons but do not yet include message IDs. Queued does not mean delivered; check Queue for confirmed sends.</p>`;
}
async function refreshInspector(){try{state.inspections=(await request('/inspector?limit=100')).items;render();}catch(e){toast(e.message,true);}}
function queuePage(){
 const jobs=state.jobs.filter(j=>state.jobTab==='all'||j.status===state.jobTab);
 const tabs=[['all','All'],['queued','Pending'],['sent','Delivered'],['failed','Failed'],['review','Review']];
 const tabHtml=`<div class="queue-tabs">${tabs.map(([id,label])=>`<button class="tab-button ${state.jobTab===id?'active':''}" data-jobtab="${id}">${label}${id==='review'&&state.reviews.length?` (${state.reviews.length})`:''}</button>`).join('')}</div>`;
 const reviews=state.reviews.map(r=>`<div class="job-line"><span class="event-icon warn">${icon('brain')}</span><div class="job-details"><b>AI review · Route #${r.route_id}</b><small>${safe(r.reason)}</small><small>${safe(r.text.slice(0,160))}</small></div><div class="job-actions" style="display:flex;flex-direction:column;gap:6px"><button class="button button-small" data-approve="${r.id}">Approve</button><button class="button button-small button-danger" data-reject="${r.id}">Reject</button></div></div>`).join('');
 const jobsHtml=jobs.map(j=>`<div class="job-line"><span class="event-icon ${j.status==='sent'?'success':j.status==='failed'?'warn':''}">${icon(j.status==='sent'?'check':j.status==='failed'?'warning':'queue')}</span><div class="job-details"><b>Message #${j.message_id} → ${safe(j.destination_id)}</b><small>Route #${j.route_id} · ${safe(j.status)} · ${age(j.created_at)}</small><small>${safe(j.message_preview.slice(0,110)||'Media message / forwarded content')}</small>${j.error?`<small style="color:#edb7ad">${safe(j.error)}</small>`:''}</div>${j.status==='failed'?`<div class="job-actions"><button class="button button-small" data-retry="${j.id}">Retry</button></div>`:''}</div>`).join('');
 return `${pageHead('OPERATIONS / DELIVERY','Sequential Queue','Pending sends, Telegram cooldowns, failures and manual AI review.',`<button class="button" data-action="refresh">${icon('refresh')} Refresh</button>`)}
 <div class="summary-grid">${metric('PENDING',state.overview?.stats.queued||0,'clock','Waiting to send')}${metric('DELIVERED',state.overview?.stats.forwarded||0,'send','Confirmed on Telegram')}${metric('FAILED',state.overview?.stats.failed||0,'warning','Manual retry available')}${metric('REVIEW',state.reviews.length,'brain','Held for approval')}</div>
 <div class="panel"><div class="panel-header"><h2>Delivery & review history</h2>${pill('ACCOUNT SEQUENTIAL')}</div>${tabHtml}${state.jobTab==='review'?(reviews||empty('shield','No pending reviews','AI-Gated messages requiring human review will appear here.')):(jobsHtml||empty('queue','No jobs in this view','Jobs appear after Telegram receives qualifying messages through an enabled route.'))}</div>
 <div class="notice" style="margin-top:15px">${icon('shield')} Messages are delivered one at a time. Telegram-imposed cooldowns are respected. This page contains actual locally stored events, not sample forwards.</div>`;
}
function morePage(){
 const o=state.overview||{}; const t=o.telegram||{};
 return `${pageHead('SYSTEM / PERSONAL EDITION','Account & Settings','Configure your single personal Telegram account, control bot, and optional AI provider.')}
 <div class="dashboard-cols"><div style="display:flex;flex-direction:column;gap:17px"><section class="panel login-card"><div class="panel-header"><h2>Personal Telegram connection</h2>${pill(t.authorized?'Authorized':t.configured?'Not signed in':'Unconfigured',t.authorized?'success':'warn')}</div>
 <div class="notice">${icon('lock')} Login codes and two-step passwords must only be entered here over trusted HTTPS or on your local computer. Never provide them to a Telegram bot chat.</div>
 <div class="divider"></div>
 ${t.authorized?`<div class="notice good">Personal account authorized. Becs can load chats and listen for messages matching enabled routes.</div><p class="helper-line">${safe(t.detail||'Telegram session authorized')}</p><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:17px"><button class="button" data-action="load-chats">${icon('refresh')} Load chats</button><button class="button button-danger" data-action="disconnect">${icon('logout')} Disconnect</button></div>`:
 `<div class="setup-steps"><span class="step">1</span> Obtain Telegram API ID and hash at my.telegram.org, then place them in your private server .env</div><div class="setup-steps"><span class="step">2</span> Enter your personal phone number and request an official Telegram login challenge.</div><div class="setup-steps"><span class="step">3</span> Enter the code here; complete two-step verification if required.</div><div class="field"><label>Phone number (international format)</label><input id="phone" autocomplete="tel" type="tel" placeholder="+1 555 000 0000"></div><button class="button button-primary" data-action="login-start" ${!t.configured?'disabled title="Server API ID/hash not configured"':''}>Send Telegram code</button><div id="authStage" class="hidden" style="margin-top:14px"><div class="field"><label>Telegram code</label><input id="telegramCode" autocomplete="one-time-code" placeholder="Login code"></div><button class="button" data-action="login-code">Verify code</button><div id="twoFactor" class="field hidden" style="margin-top:15px"><label>Telegram 2-step verification password</label><input id="telegramPassword" type="password" placeholder="Two-step password"><button class="button" data-action="login-password">Verify password</button></div></div>`}
 </section>${panel('Security model',`<div class="health-list"><div class="health-row">${icon('shield')}<div><div class="status-main">Authorized destinations only</div><div class="status-sub">Telegram permissions always apply</div></div></div><div class="health-row">${icon('lock')}<div><div class="status-main">Session stays on server</div><div class="status-sub">Never stored in browser local storage</div></div></div><div class="health-row">${icon('queue')}<div><div class="status-main">Account-aware queue</div><div class="status-sub">Sequential sends and flood-wait handling</div></div></div></div>`)}</div>
 <div style="display:flex;flex-direction:column;gap:17px">${panel('Service configuration',`<div class="health-list"><div class="health-row">${icon('bot')}<div><div class="status-main">Telegram control bot</div><div class="status-sub">Commands /start /status /pause /resume /routes</div></div><span class="right-flex">${pill(o.bot_configured?'Configured':'Needs .env',o.bot_configured?'success':'warn')}</span></div><div class="health-row">${icon('brain')}<div><div class="status-main">Optional Gemini AI gateway</div><div class="status-sub">External API only for selected route modes</div></div><span class="right-flex">${pill(o.ai_configured?'Configured':'Off',o.ai_configured?'success':'')}</span></div><div class="health-row">${icon('server')}<div><div class="status-main">FastAPI + SQLite backend</div><div class="status-sub">Local or self-hosted; no deployment requested</div></div><span class="right-flex">${pill('Running','success')}</span></div></div>`)}${panel('Telegram chats',state.chats.length?`<div style="max-height:290px;overflow-y:auto">${state.chats.map(c=>`<div class="route-brief"><span class="route-glyph">${icon(c.kind==='private'?'person':'document')}</span><div class="route-detail"><strong>${safe(c.title)}</strong><small>${safe(c.kind)} · ${safe(c.id)}</small></div><button class="button button-small" data-copy="${safe(c.id)}">Copy ID</button></div>`).join('')}</div>`:empty('person','No chats loaded','Sign in and press Load chats to see available source and destination identifiers.'),`<button class="small-link" data-action="load-chats">Load →</button>`)}</div></div>`;
}
function gatePage(){
 return `<div class="page-head"><div><p class="eyebrow">SECURE ACCESS</p><h1>Becs access required</h1><p class="subheading">Open this inside your authorized Telegram Mini App, or enter your configured server access key.</p></div></div><section class="panel login-card"><div class="notice warn">${icon('lock')} ${safe(state.apiError||'Protected backend')}</div><div class="field" style="margin-top:20px"><label>BECS_ADMIN_TOKEN</label><input id="adminKey" type="password" autocomplete="off" placeholder="Enter your server access key"></div><button class="button button-primary" data-action="unlock">Unlock Becs</button><p class="small-help">Your key stays in this browser tab session only. Local development on 127.0.0.1 is permitted without a key.</p></section>`;
}
function render(){renderNav();dom('mainView').innerHTML=state.apiError?gatePage():state.page==='home'?overviewPage():state.page==='routes'?routesPage():state.page==='filters'?filtersPage():state.page==='queue'?queuePage():state.page==='inspector'?inspectorPage():morePage();}

function newRouteDefaults(m='smart'){return {name:'',mode:m,enabled:false,sources:[],destinations:[],allowed:'',blocked:'',pattern:'',match_mode:'any',network:'both',require_contract:false,dedup_minutes:60,delivery_style:'native'};}
function field(label,id,value='',placeholder='',help='',type='text'){return `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${safe(value)}" placeholder="${safe(placeholder)}">${help?`<span class="field-help">${help}</span>`:''}</div>`;}
function selectField(label,id,value,opts,help=''){return `<div class="field"><label for="${id}">${label}</label><select id="${id}">${opts.map(([v,t])=>`<option value="${safe(v)}" ${value===v?'selected':''}>${safe(t)}</option>`).join('')}</select>${help?`<span class="field-help">${help}</span>`:''}</div>`;}
function routeModal(route=null){
 const r=route||newRouteDefaults();state.editing=route?.id||null;
 dom('modalTitle').textContent=route?'Edit '+r.name:'Create forwarding route';
 const chatOptions=`<div class="modal-section"><h3 class="section-title">Select Telegram chats</h3>
 <button type="button" class="button button-small" data-action="refresh-route-chats">Refresh chats</button> <span id="routeChatCount" class="field-help">${state.chats.length} chats loaded</span>
 <div class="field"><label for="sourceChatSearch">Search sources</label><input id="sourceChatSearch" type="search" placeholder="Search your source chats"></div><div id="sourceChatList" style="max-height:170px;overflow:auto"></div>
 <div class="field"><label for="destChatSearch">Search destinations</label><input id="destChatSearch" type="search" placeholder="Search your destination chats"></div><div id="destChatList" style="max-height:170px;overflow:auto"></div>
 <p class="field-help">Only checked chats are selected. No manual source IDs.</p></div>`;
 const preset=r.pattern||'';
 const prefix=key=>preset.includes('(?=[\\\\s\\\\S]*'+key+')');
 const reqLink=prefix('https?://'),reqNumber=prefix('\\\\d'),reqMention=prefix('@');
 const network=r.network||'both';
 dom('modalBody').innerHTML=`<form id="routeForm" class="becs-smart-form">
 <div class="field"><label for="routeName">Route name</label><input id="routeName" required minlength="2" maxlength="100" value="${safe(r.name)}" placeholder="Crypto signals"></div>
 <input id="routeSources" type="hidden" value="${safe(r.sources.join(', '))}">
 <input id="routeDests" type="hidden" value="${safe(r.destinations.join(', '))}">
 <input id="routeMode" type="hidden" value="smart"><input id="routeMatch" type="hidden" value="${safe(r.match_mode||'any')}">
 <input id="routeNetwork" type="hidden" value="${safe(network)}">
 <input id="routePattern" type="hidden" value="${safe(r.pattern||'')}">
 <input id="routeStyle" type="hidden" value="text">
 <input id="routeCooldown" type="hidden" value="${safe(r.dedup_minutes??60)}">
 <input id="routeContract" type="checkbox" checked hidden>
 <section class="becs-smart-panel">
 <div class="becs-smart-heading"><div><h3>Smart Filters</h3><p>Forward only what matters. Use keywords, regex, or token detection.</p></div>
 <div class="becs-template-wrap"><label for="routeTemplate" class="sr-only">Templates</label><select id="routeTemplate"><option value="">Templates</option>${filterPresets.map(p=>`<option value="${safe(p.id)}">${safe(p.label)}</option>`).join('')}</select></div></div>
 <div class="becs-filter-modes" role="group" aria-label="Filter mode">
 ${[['all','All'],['token','Token Only'],['keywords','Keywords'],['both','Token + Keywords']].map(([v,t])=>`<button type="button" class="becs-mode-button ${v===(r.allowed||r.pattern?'both':'token')?'active':''}" data-filter-mode="${v}" aria-pressed="${v===(r.allowed||r.pattern?'both':'token')?'true':'false'}">${t}</button>`).join('')}
 </div>
 <div class="field"><label for="routeAllow">Keywords to INCLUDE (match any)</label><textarea id="routeAllow" rows="2" placeholder="📊 | 📈 | 🎁 | @stonkpairs | dex | mc\\s*\\$?\\d+[kK]?">${safe(r.allowed||'')}</textarea><span class="field-help">Comma-separated plain terms, or prefix regex with re: (example: re:📊|📈|🎁).</span></div>
 <div class="field"><label for="routeBlock">Keywords to EXCLUDE (skip if matched)</label><textarea id="routeBlock" rows="2" placeholder="scam, rug, giveaway">${safe(r.blocked||'')}</textarea><span class="field-help">Blacklist always wins. Use re: for a full regex.</span></div>
 <div class="field"><label>Token Address Detection</label><div class="becs-toggles">
 <label><input id="routeSolana" type="checkbox" ${network!=='evm'?'checked':''}> Solana (Base58)</label>
 <label><input id="routeEvm" type="checkbox" ${network!=='solana'?'checked':''}> EVM (0x...)</label>
 <label><input type="checkbox" checked disabled> Send only contract address</label></div></div>
 <div class="field"><label>Message Requirements (optional)</label><div class="becs-toggles">
 <label><input id="routeReqLink" type="checkbox" ${reqLink?'checked':''}> Contains a link</label>
 <label><input id="routeReqNumber" type="checkbox" ${reqNumber?'checked':''}> Contains a number</label>
 <label><input id="routeReqMention" type="checkbox" ${reqMention?'checked':''}> Contains @username</label></div></div>
 <div class="becs-filter-info">All Unicode emojis are supported. Filter rules check messages in memory; only detected addresses are sent.</div>
 </section>
 ${chatOptions}
 <label class="checkboxline"><input id="routeEnabled" type="checkbox" ${r.enabled?'checked':''}> Enable route after saving</label>
 <div class="modal-actions"><button type="button" class="button" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">Save Filters & Route</button></div></form>`;
 dom('modal').classList.remove('hidden');dom('modal').classList.add('becs-compact-route');renderChatPicker();if(!state.chats.length)refreshRouteChats();
}
function renderChatPicker(){
 for(const [role,searchId,listId,selectedId] of [['source','sourceChatSearch','sourceChatList','routeSources'],['destination','destChatSearch','destChatList','routeDests']]){
  const container=dom(listId);if(!container)continue;
  const q=(dom(searchId)?.value||'').trim().toLowerCase();
  const selected=new Set((dom(selectedId)?.value||'').split(',').map(x=>x.trim()).filter(Boolean));
  const items=state.chats.filter(chat=>(chat.title+' '+(chat.username||'')+' '+chat.id).toLowerCase().includes(q));
  container.innerHTML=items.length?items.map(chat=>`<label class="route-brief" style="cursor:pointer"><input type="checkbox" data-pickchat="${safe(chat.id)}" data-role="${role}" ${selected.has(String(chat.id))?'checked':''}><span class="route-detail"><strong>${safe(chat.title)}</strong><small>${safe(chat.username||chat.kind)} · ${safe(chat.id)}</small></span></label>`).join(''):'<p class="field-help">No matching chats. Refresh the list or add a public @username.</p>';
 }
}
function togglePickedChat(id,role,checked){
 const input=dom(role==='source'?'routeSources':'routeDests');
 const other=dom(role==='source'?'routeDests':'routeSources');
 if(checked&&other.value.split(',').map(x=>x.trim()).includes(id)){toast('A chat cannot be both source and destination',true);renderChatPicker();return;}
 const values=input.value.split(',').map(x=>x.trim()).filter(Boolean);
 input.value=(checked?[...new Set([...values,id])]:values.filter(x=>x!==id)).join(', ');
 renderChatPicker();
}
async function addChatReference(role){
 const input=dom(role==='source'?'sourceReference':'destReference');const reference=input?.value.trim();if(!reference)return;
 try{
  const item=await request('/telegram/resolve',{method:'POST',body:JSON.stringify({reference,role})});
  const other=dom(role==='source'?'routeDests':'routeSources');
  if(other.value.split(',').map(x=>x.trim()).includes(item.id))throw new Error('This chat is already selected on the other side');
  const target=dom(role==='source'?'routeSources':'routeDests');
  target.value=[...new Set([...target.value.split(',').map(x=>x.trim()).filter(Boolean),item.id])].join(', ');
  if(!state.chats.some(c=>c.id===item.id))state.chats.push(item);
  input.value='';renderChatPicker();toast(item.title+' validated and added');
 }catch(e){toast(e.message,true);}
}
async function refreshRouteChats(){
 try{const data=await request('/telegram/chats');state.chats=data.chats;renderChatPicker();toast(state.chats.length+' chats loaded');}
 catch(e){toast(e.message,true);}
}
function closeModal(){dom('modal').classList.add('hidden');dom('modal').classList.remove('becs-compact-route');state.editing=null;}
function collectRoute(){
 const terms=id=>(dom(id)?.value||'').split(',').map(x=>x.trim()).filter(Boolean);
 const sol=dom('routeSolana').checked,evm=dom('routeEvm').checked;
 if(!sol&&!evm)throw Error('Select Solana, EVM, or both');
 const req=[];
 if(dom('routeReqLink').checked)req.push('(?=[\\\\s\\\\S]*https?://)');
 if(dom('routeReqNumber').checked)req.push('(?=[\\\\s\\\\S]*\\\\d)');
 if(dom('routeReqMention').checked)req.push('(?=[\\\\s\\\\S]*@[A-Za-z0-9_]+)');
 let pattern=req.join('');
 if(pattern)pattern='(?s)'+pattern+'.*';
 if(pattern.length>250)throw Error('Optional requirements exceed regex limit');
 const mode=document.querySelector('.becs-mode-button.active')?.dataset.filterMode||'token';
 let allowed=dom('routeAllow').value.trim();
 if(mode==='all'||mode==='token')allowed='';
 if((mode==='keywords'||mode==='both')&&!allowed)throw Error('Enter at least one included keyword or regex');
 return {name:dom('routeName').value.trim(),mode:'smart',enabled:dom('routeEnabled').checked,
 sources:[...new Set(terms('routeSources'))],destinations:[...new Set(terms('routeDests'))],
 allowed,blocked:dom('routeBlock').value.trim(),pattern,match_mode:'any',
 network:sol&&evm?'both':sol?'solana':'evm',require_contract:true,
 dedup_minutes:Math.max(0,Number(dom('routeCooldown').value)||0),delivery_style:'text'};
}
async function saveRoute(event){event.preventDefault();try{const payload=collectRoute();const wasEditing=!!state.editing;const path=wasEditing?`/routes/${state.editing}`:'/routes';await request(path,{method:wasEditing?'PUT':'POST',body:JSON.stringify(payload)});closeModal();toast(wasEditing?'Route saved':'Route created');await reload();}catch(e){toast(e.message,true);}}
async function toggleRoute(id,checked){const route=state.routes.find(r=>r.id===id);if(!route)return;try{const {id:unused,created_at,updated_at,...body}=route;await request('/routes/'+id,{method:'PUT',body:JSON.stringify({...body,enabled:checked})});await reload();toast(checked?'Route enabled':'Route paused');}catch(e){toast(e.message,true);await reload(false);}}
async function deleteRoute(id){if(!confirm('Delete this route? All its saved configuration will be removed.'))return;try{await request('/routes/'+id,{method:'DELETE'});toast('Route deleted');await reload();}catch(e){toast(e.message,true);}}
async function simulate(){state.labText=dom('labMessage').value;state.labAllow=dom('labAllow').value;state.labBlock=dom('labBlock').value;state.labPattern=dom('labPattern').value;const route=currentSimRoute();try{state.simResult=await request('/simulate',{method:'POST',body:JSON.stringify({text:state.labText,route})});render();dom('labNetwork').value=route.network;dom('labMatch').value=route.match_mode;dom('labContract').checked=route.require_contract;}catch(e){toast(e.message,true);}}
async function updatePause(paused){try{await request(paused?'/control/pause':'/control/resume',{method:'POST'});await reload(false);toast(paused?'All forwarding paused':'Forwarding resumed');}catch(e){toast(e.message,true);}}
async function loadChats(){try{const data=await request('/telegram/chats');state.chats=data.chats;toast(`${state.chats.length} Telegram chats loaded`);render();}catch(e){toast(e.message,true);}}
async function login(method,body,btn){if(btn)btn.disabled=true;try{const result=await request('/telegram/'+method,{method:'POST',body:JSON.stringify(body)});toast(result.message||'Telegram authentication updated');if(result.status==='code_sent'){dom('authStage')?.classList.remove('hidden');}if(result.status==='password_required'){dom('twoFactor')?.classList.remove('hidden');}if(result.status==='authorized'){await reload();}}catch(e){toast(e.message,true);}finally{if(btn)btn.disabled=false;}}
async function reviewItem(id,approve){try{await request('/reviews/'+id,{method:'POST',body:JSON.stringify({approve})});await reload();toast(approve?'Approved for sequential forwarding':'Review rejected');}catch(e){toast(e.message,true);}}
async function retryJob(id){try{await request('/jobs/'+id+'/retry',{method:'POST'});await reload();toast('Job requeued');}catch(e){toast(e.message,true);}}
const actionMap={
 'new-route':()=>routeModal(), 'open-routes':()=>navigate('routes'),'open-filters':()=>navigate('filters'),'open-queue':()=>navigate('queue'),'open-settings':()=>navigate('more'),
 'refresh':()=>reload(),'refresh-inspector':refreshInspector, 'pause':()=>updatePause(true), 'resume':()=>updatePause(false),'close-modal':closeModal,
 'run-sim':simulate,'load-chats':loadChats,
 'refresh-route-chats':refreshRouteChats,'resolve-source':()=>addChatReference('source'),'resolve-destination':()=>addChatReference('destination'),
 'disconnect':async()=>{if(!confirm('Disconnect the server from Telegram? The saved session will remain available for reconnect.'))return;try{await request('/telegram/disconnect',{method:'POST'});await reload();toast('Telegram disconnected');}catch(e){toast(e.message,true);}},
 'login-start':(el)=>login('start',{phone:dom('phone').value},el),
 'login-code':(el)=>login('code',{code:dom('telegramCode').value},el),
 'login-password':(el)=>login('password',{password:dom('telegramPassword').value},el),
 'unlock':async()=>{sessionStorage.setItem('becs_key',dom('adminKey').value);await reload();if(state.apiError)toast('Invalid access key or server configuration',true);}
};
document.addEventListener('change',event=>{
 if(event.target?.id==='routeTemplate' && event.target.value){
 const p=filterPresets.find(x=>x.id===event.target.value);
 if(p){dom('routeSolana').checked=p.network!=='evm';dom('routeEvm').checked=p.network!=='solana';
 dom('routeAllow').value=p.pattern?'re:'+p.pattern:'';
 document.querySelectorAll('.becs-mode-button').forEach(b=>{const active=b.dataset.filterMode===(p.pattern?'both':'token');b.classList.toggle('active',active);b.setAttribute('aria-pressed',active?'true':'false');});
 toast(p.label+' template loaded. Save to apply.');}
}
});
document.addEventListener('click',async event=>{
 const target=event.target.closest('[data-nav],[data-mode],[data-action],[data-edit],[data-delete],[data-jobtab],[data-retry],[data-approve],[data-reject],[data-copy],[data-usechat],[data-filter-preset],[data-route-preset],[data-filter-mode],[data-inspector-kind]');if(!target)return;
 if(target.dataset.filterPreset){applyFilterPreset(target.dataset.filterPreset);return;}
 if(target.dataset.filterMode){document.querySelectorAll('.becs-mode-button').forEach(b=>{const active=b===target;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active?'true':'false');});return;}
 if(target.dataset.routePreset){applyFilterPreset(target.dataset.routePreset,true);return;}
 if(target.dataset.inspectorKind){state.inspectorKind=target.dataset.inspectorKind;render();return;}
 if(target.dataset.nav){navigate(target.dataset.nav);return;}
 if(target.dataset.mode){state.modeExplain=target.dataset.mode;render();return;}
 if(target.dataset.action){await actionMap[target.dataset.action]?.(target);return;}
 if(target.dataset.edit){const r=state.routes.find(x=>x.id===Number(target.dataset.edit));if(r)routeModal(r);return;}
 if(target.dataset.delete){await deleteRoute(Number(target.dataset.delete));return;}
 if(target.dataset.jobtab){state.jobTab=target.dataset.jobtab;render();return;}
 if(target.dataset.retry){await retryJob(Number(target.dataset.retry));return;}
 if(target.dataset.approve){await reviewItem(Number(target.dataset.approve),true);return;}
 if(target.dataset.reject){await reviewItem(Number(target.dataset.reject),false);return;}
 if(target.dataset.copy){try{await navigator.clipboard.writeText(target.dataset.copy);toast('Chat ID copied');}catch{toast('Clipboard unavailable; copy the ID manually',true);}return;}
 if(target.dataset.usechat){let input=dom(target.dataset.which==='source'?'routeSources':'routeDests');let vals=input.value.split(',').map(x=>x.trim()).filter(Boolean);if(!vals.includes(target.dataset.usechat))vals.push(target.dataset.usechat);input.value=vals.join(', ');toast('Chat added to '+target.dataset.which+'s');}
});
document.addEventListener('change',event=>{const t=event.target;if(t.dataset.routeToggle){toggleRoute(Number(t.dataset.routeToggle),t.checked);}if(t.dataset.pickchat){togglePickedChat(t.dataset.pickchat,t.dataset.role,t.checked);}});
document.addEventListener('input',event=>{if(['sourceChatSearch','destChatSearch','routeSources','routeDests'].includes(event.target.id))renderChatPicker();});
document.addEventListener('submit',event=>{if(event.target.id==='routeForm')saveRoute(event);});
dom('accountButton').addEventListener('click',()=>navigate('more'));
dom('refreshBtn').addEventListener('click',()=>reload());
dom('modalClose').addEventListener('click',closeModal);
dom('modal').addEventListener('click',event=>{if(event.target===dom('modal'))closeModal();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!dom('modal').classList.contains('hidden'))closeModal();});
reload();
})();
