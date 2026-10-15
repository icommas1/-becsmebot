/* Becs — Terminal Pro Mini App. Real API-backed UI; no invented operational metrics. */
(() => {
'use strict';
const tg = window.Telegram?.WebApp;
try { tg?.ready(); tg?.expand(); tg?.setHeaderColor('#0b1320'); tg?.setBackgroundColor('#090f1b'); } catch (_) {}
// Hosted release deliberately registers no service worker.

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
const navigate = name => { if(state.access!=='approved'||(['users','backups'].includes(name)&&!state.me?.is_admin))return; state.page=name; render(); if(name==='users')loadUsers(); if(name==='backups')loadBackupStatus(); window.scrollTo({top:0,behavior:'smooth'}); };
const modes = [{id:'express',title:'Express',sub:'Fastest',ico:'bolt',cls:'mode-express',help:'Forward with essential route checks; no AI or optional content filters in the critical path.'},{id:'smart',title:'Smart',sub:'Filtered',ico:'filter',cls:'mode-smart',help:'Use local keyword, address, regex and duplicate rules before queueing.'},{id:'hybrid',title:'Hybrid',sub:'AI Assist',ico:'brain',cls:'mode-hybrid',help:'Local filters decide first; AI can analyze afterward without blocking delivery.'},{id:'ai-gated',title:'AI-Gated',sub:'AI Decision',ico:'shield',cls:'mode-ai-gated',help:'Require AI approval before forwarding. If AI is unavailable, messages are held for review.'}];
const nav=[['home','Home','home'],['routes','Routes','routes'],['filters','Smart Filters','filter'],['queue','Queue','queue'],['inspector','Inspector','activity'],['more','More','more']];
const state={page:'home',overview:null,routes:[],jobs:[],reviews:[],chats:[],inspections:[],inspectorKind:'all',jobTab:'all',simResult:null,modeExplain:'smart',busy:false,apiError:'',chatSearch:'',editing:null,me:null,access:'checking',users:[],invites:[],usersLoaded:false,usersLoading:false,usersError:'',userBusy:false,inviteBusy:false,invite:null,userConfirm:null,modalKind:null,loadVersion:0,accessVersion:0};
const dom = id => document.getElementById(id);

async function request(path, options = {}) {
  const signed = tg?.initData || '';
  if (!signed) {
    const error = new Error('Open Becs from @mock_becs_bot in Telegram, then launch the Mini App again.');
    error.status = 401;
    error.reason = 'missing_telegram_launch';
    state.me = null;
    state.access = 'unknown';
    state.accessVersion++;
    clearWorkspace();
    state.apiError = error.message;
    render();
    throw error;
  }
  const requestAccessVersion = state.accessVersion;
  const headers = {
    Accept: 'application/json',
    ...(options.body ? {'Content-Type': 'application/json'} : {}),
    ...(options.headers || {}),
    'X-Telegram-Init-Data': signed,
  };
  let response;
  try {
    response = await fetch('https://api.example.test/api' + path, {
      ...options,
      headers,
      cache: 'no-store',
      credentials: 'omit',
    });
  } catch {
    throw new Error('Becs is temporarily unreachable. Try again in a moment.');
  }
  const payload = await response.json().catch(() => ({detail: response.statusText}));
  if (!response.ok) {
    const detail = payload.detail;
    const error = new Error(typeof detail === 'string' ? detail : detail?.message || 'Request failed');
    error.status = response.status;
    error.reason = payload.reason || detail?.reason || '';
    if (error.status === 401) {
      error.message = 'Your Telegram launch is missing, invalid or expired. Close Becs and reopen it from @mock_becs_bot in Telegram.';
      state.me = null;
      state.access = 'unknown';
      state.accessVersion++;
      clearWorkspace();
      state.apiError = error.message;
      render();
    } else if (error.status === 403 && [
      'access_pending', 'access_revoked', 'access_rejected',
      'not_invited', 'access_not_invited',
    ].includes(error.reason)) {
      denyAccess(error.reason.replace(/^access_/, ''));
    }
    throw error;
  }
  if (requestAccessVersion !== state.accessVersion) {
    throw new Error('Your access changed. Check access again.');
  }
  return payload;
}
function toast(message,isError=false){const el=document.createElement('div');el.className='toast'+(isError?' error':'');el.textContent=message;dom('toastRegion').append(el);setTimeout(()=>el.remove(),4200);}
function clearWorkspace(){
 state.backupGeneration=(state.backupGeneration||0)+1;clearPreparedBackup();state.backupStatus=null;state.backupLast=null;state.backupError='';state.backupBusy=false;
 state.overview=null;state.routes=[];state.jobs=[];state.reviews=[];state.chats=[];state.inspections=[];state.simResult=null;
 state.users=[];state.invites=[];state.usersLoaded=false;state.usersError='';state.invite=null;state.userConfirm=null;
 for(const key of ['labText','labAllow','labBlock','labPattern'])delete state[key];
 closeModal(true);dom('toastRegion').replaceChildren();
}
function denyAccess(status){
 state.accessVersion++;state.access=status;state.page='home';state.apiError='';clearWorkspace();render();
}
async function reload(full=true,options={}){
 const version=++state.loadVersion;const accessVersion=state.accessVersion;
 const preserve=options.preserve;
 try{
  const me=await request('/me');if(version!==state.loadVersion||accessVersion!==state.accessVersion)return;
  const oldId=state.me?.user?.telegram_id;const changed=oldId!==undefined&&String(oldId)!==String(me.user?.telegram_id);
  if(changed){state.accessVersion++;clearWorkspace();state.me=me;return reload(full,options);}state.me=me;
  const status=me.user?.status||'not_invited';
  if(status!=='approved'){denyAccess(status);return;}
  state.access='approved';
  const calls=[request('/overview'),request('/routes')];
  if(full)calls.push(request('/jobs?limit=100'),request('/reviews'),request('/inspector?limit=100'));
  const result=await Promise.all(calls);
  if(version!==state.loadVersion||accessVersion!==state.accessVersion||state.access!=='approved')return;
  state.overview=result[0];state.routes=result[1].routes;
  if(full){state.jobs=result[2].jobs;state.reviews=result[3].reviews;state.inspections=result[4].items;}
  state.apiError='';
  if(preserve&&!changed&&(['more','filters'].includes(state.page)||!dom('modal').classList.contains('hidden'))){renderNav();}else render();
  if(state.page==='users'&&state.me.is_admin)await loadUsers();
 }catch(e){
  if(version!==state.loadVersion||accessVersion!==state.accessVersion)return;
  if(['pending','revoked','rejected','not_invited'].includes(state.access)){toast(e.message,true);return;}
  if(e.status===401||e.status===403){state.me=null;state.access='unknown';clearWorkspace();}
  state.apiError=e.message;render();
 }
}
function renderNav(){
 const allowed=state.access==='approved'&&!state.apiError;dom('sideNav').classList.toggle('hidden',!allowed);dom('bottomNav').classList.toggle('hidden',!allowed);dom('accountButton').disabled=!allowed;
 const current=['users','backups'].includes(state.page)?'more':state.page;
 const html=nav.map(([id,label,ico])=>`<button class="nav-item ${current===id?'active':''}" data-nav="${id}">${icon(ico)} ${label}</button>`).join('');
 dom('sideNav').innerHTML=html;
 dom('bottomNav').innerHTML=nav.map(([id,label,ico])=>`<button class="bottom-tab ${current===id?'active':''}" data-nav="${id}" aria-label="${label}" ${current===id?'aria-current="page"':''}>${icon(ico)}<span>${label}</span></button>`).join('');
 dom('crumb').textContent=({home:'Overview',routes:'Routes',filters:'Regex Lab',queue:'Delivery Queue',inspector:'Message Inspector',more:'System Settings',users:'Users',backups:'Backups'})[state.page];
 const active=state.overview?.telegram?.authorized;
 dom('sideDot').classList.toggle('online',!!active);
 dom('sideConnection').textContent=!allowed?'Private workspace':active?'Personal account connected':'Telegram not connected';
 dom('accountButton').setAttribute('aria-label',state.me?.user?.display_name?`${state.me.user.display_name} · My account`:'My account');
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
function legacyOverviewPage(){
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
function overviewPage(){
 const o=state.overview;const st=o.stats||{};const status=o.telegram||{};const operational=!!status.authorized&&!o.paused;
 const quick=[['plus','New Route','Choose chats','new-route'],['filter','Add Filter','Preset or custom','open-filters'],['activity','View Activity','Recent deliveries','open-queue'],['person','Connections','Telegram accounts','open-settings']];
 const presets=[['send','SOL contracts','solana'],['document','EVM contracts','evm'],['filter','Token addresses','both'],['bolt','Launch signals','launch'],['plus','Custom','custom']];
 return `<div class="becs-dashboard">
 <div class="becs-command"><div><h1>becs<span>.</span></h1><small>TELEGRAM FORWARDING</small></div><button class="becs-live-pill ${operational?'':'offline'}" data-action="open-settings"><span class="dot"></span><span><b>${operational?'Online':o.paused?'Paused':'Setup needed'}</b><small>${operational?'Ready to forward':status.authorized?'Forwarding paused':'Connect Telegram'}</small></span></button></div>
 <section class="becs-power-area"><div class="becs-power-left"><button class="becs-power-btn ${o.paused?'is-paused':''}" data-action="${o.paused?'resume':'pause'}" title="${o.paused?'Resume':'Pause'} forwarding" aria-label="${o.paused?'Resume':'Pause'} forwarding">${icon('play')}</button><div class="becs-power-copy"><small>FORWARDING</small><strong>${o.paused?'Paused':operational?'Active':'Not ready'}</strong><p>${status.authorized?'Tap to '+(o.paused?'resume':'pause'):'Telegram connection required'}</p></div></div><div class="becs-counts"><div class="becs-count" data-action="open-queue">${icon('send')}<span><b>${fmt(st.forwarded)}</b><small>Messages Forwarded</small></span></div><div class="becs-count" data-action="open-routes">${icon('routes')}<span><b>${fmt(st.enabled_routes)}</b><small>Telegram Routes</small></span></div><div class="becs-count" data-action="open-queue">${icon('queue')}<span><b>${fmt(st.queued)}</b><small>In Queue</small></span></div></div></section>
 <div class="becs-quick-grid">${quick.map(([ico,label,detail,action])=>`<button class="becs-quick-tile" data-action="${action}">${icon(ico)}<b>${label}</b><small>${detail}</small></button>`).join('')}</div>
 ${panel('Telegram Routes',state.routes.length?state.routes.slice(0,5).map(r=>`<div class="becs-list-row">${icon('routes')}<span><strong>${safe(r.name)}</strong><small>${r.sources.length} sources → ${r.destinations.length} destinations · ${safe(r.mode)}</small></span>${pill(r.enabled?'Active':'Paused',r.enabled?'success':'')}</div>`).join(''):empty('routes','No Telegram routes','Create a route to start forwarding.',`<button class="button button-small" data-action="new-route">New route</button>`),`<button class="small-link" data-action="open-routes">See all (${state.routes.length}) →</button>`)}
 ${panel('The Orphanage',`<div class="becs-preset-grid"><button class="becs-preset" data-action="new-express">${icon('bolt')}<b>Express Route</b></button><button class="becs-preset" data-action="new-route">${icon('routes')}<b>Custom Route</b></button><button class="becs-preset" data-action="open-filters">${icon('filter')}<b>Smart Filters</b></button></div><p class="becs-disclaimer">Quick configurations for the existing Telegram forwarding engine.</p>`)}
 ${panel('Filter Presets',`<div class="becs-preset-grid">${presets.map(([ico,label,id])=>`<button class="becs-preset" data-action="preset-${id}">${icon(ico)}<b>${label}</b></button>`).join('')}</div>`,`<button class="small-link" data-action="open-filters">See all →</button>`)}
 ${panel('Recent Activity',o.activity?.length?o.activity.slice(0,5).map(activityRow).join(''):empty('activity','No activity yet','Verified forwarding events appear here.'),`<button class="small-link" data-action="open-queue">See all →</button>`)}
 <p class="becs-disclaimer">Live statistics are supplied by your authorized Railway workspace; no sample routes or metrics are displayed.</p></div>`;
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
const currentSimRoute=()=>({name:'Filter Lab',mode:'smart',enabled:false,sources:[],destinations:[],allowed:dom('labAllow')?.value||'',blocked:dom('labBlock')?.value||'',pattern:dom('labPattern')?.value||'',match_mode:dom('labMatch')?.value||'any',network:dom('labNetwork')?.value||'both',require_contract:true,dedup_minutes:60,delivery_style:'native'});
function filtersPage(){
 const addresses=state.simResult?.addresses||[];const res=state.simResult;
 return `${pageHead('CRYPTO ENGINE / LOCAL TEST','Crypto Filter Lab','Test contract detection, custom regex, keyword rules and blacklists without forwarding anything.')}
 <div class="lab-grid"><section class="panel"><div class="panel-header"><h2>Message and filter rules</h2>${pill('SAFE SIMULATION')}</div>
 <div class="field"><label>Incoming crypto message</label><textarea id="labMessage" rows="6" placeholder="Paste any Telegram crypto message here...">${safe(state.labText??'NEW SOL launch · CA: So11111111111111111111111111111111111111112 · liquidity locked')}</textarea></div>
 <div class="field"><label>Smart Filters V2 — quick rules</label><div style="display:flex;gap:8px;flex-wrap:wrap">${filterPresets.map(p=>`<button type="button" class="button button-small" data-filter-preset="${p.id}">${safe(p.label)}</button>`).join('')}</div><span class="field-help">Presets fill the form. Test filter previews the decision without forwarding.</span></div><div class="form-grid"><div class="field"><label>Blockchain format</label><select id="labNetwork"><option value="both">Solana + EVM</option><option value="solana">Solana only</option><option value="evm">Ethereum / EVM only</option></select></div><div class="field"><label>Keyword logic</label><select id="labMatch"><option value="any">Match ANY keyword</option><option value="all">Match ALL keywords</option></select></div></div>
 <div class="field"><label>Allowed keywords (comma-separated)</label><input id="labAllow" value="${safe(state.labAllow??'launch, liquidity, CA')}" placeholder="launch, liquidity, CA"></div>
 <div class="field"><label>Blocked keywords</label><input id="labBlock" value="${safe(state.labBlock??'scam, giveaway')}" placeholder="scam, giveaway"></div>
 <div class="field"><label>Custom regex (optional)</label><input id="labPattern" spellcheck="false" value="${safe(state.labPattern??'')}" placeholder="\\b(launch|presale)\\b"><span class="field-help">Timeout-protected regex. Custom patterns require a match when provided.</span></div>
 <label class="checkboxline"><input type="checkbox" id="labContract" checked disabled> Address-format match required for every delivery</label>
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
async function openAdminStatus(){
 const box=dom('ownerStatusPanel');if(!box||!state.me?.is_admin)return;
 try{
  const info=await request('/admin/status');
  if(!box.isConnected||state.access!=='approved'||!state.me?.is_admin)return;box.style.display='block';
  const rows=[['API',info.components.api],['Database',info.components.sqlite],['Worker',info.components.worker],['Telegram',info.telegram.authorized?'Connected':'Disconnected'],['Bot API',info.bot_configured?'Configured':'Missing'],['Forwarding',info.paused?'Paused':'Enabled'],['Active routes',info.counts.active_routes],['Queued',info.counts.queued],['Sending',info.counts.sending],['Failed',info.counts.failed],['Cooldown',info.cooldown_seconds+'s'],['Uptime',Math.floor(info.uptime_seconds/60)+' min']];
  dom('ownerStatusRows').innerHTML=rows.map(([k,v])=>`<div class="health-row"><span class="status-main">${safe(k)}</span><strong class="right-flex">${safe(v)}</strong></div>`).join('');
 }catch(e){if(!box.isConnected)return;if(e.status===403){box.remove();return;}const rows=box.querySelector('#ownerStatusRows');if(rows)rows.textContent='Status unavailable';}
}
function morePage(){
 const o=state.overview||{}; const t=o.telegram||{};
 return `${pageHead('SYSTEM / PERSONAL EDITION','Account & Settings','Your private workspace and your own Telegram connection.')}
 ${state.me?.is_admin?`<button class="users-settings-link" data-action="open-users"><span class="route-glyph">${icon('person')}</span><span><strong>Users</strong><small>Manage invitations and access · owner + 2 users</small></span>${icon('chevron')}</button>`:''}
 ${state.me?.is_admin?`<button class="users-settings-link" data-action="open-backups"><span class="route-glyph">${icon('document')}</span><span><strong>Backups</strong><small>Export all approved workspaces · save your own copy</small></span>${icon('chevron')}</button>`:''}
 <div class="notice" style="margin-bottom:17px">${icon('lock')} The administrator can export approved users’ routes, chat identifiers, filters and pause setting for recovery. Sessions, secrets and message history are excluded.</div>
 ${state.me?.is_admin?`<section class="panel" id="ownerStatusPanel" style="margin-bottom:17px;display:none"><div class="panel-header"><h2>Owner · System Status</h2><button class="button button-small" data-action="owner-status">Refresh</button></div><div id="ownerStatusRows" class="health-list">Checking access…</div></section>`:''}
 <div class="dashboard-cols"><div style="display:flex;flex-direction:column;gap:17px"><section class="panel login-card"><div class="panel-header"><h2>Personal Telegram connection</h2>${pill(t.authorized?'Authorized':t.configured?'Not signed in':'Unconfigured',t.authorized?'success':'warn')}</div>
 <div class="notice">${icon('lock')} Login codes and two-step passwords must only be entered here over trusted HTTPS or on your local computer. Never provide them to a Telegram bot chat.</div>
 <div class="divider"></div>
 ${t.authorized?`<div class="notice good">Personal account authorized. Becs can load chats and listen for messages matching enabled routes.</div><p class="helper-line">${safe(t.detail||'Telegram session authorized')}</p><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:17px"><button class="button" data-action="load-chats">${icon('refresh')} Load chats</button><button class="button button-danger" data-action="disconnect">${icon('logout')} Disconnect</button></div>`:
 `<div class="setup-steps"><span class="step">1</span> ${state.me?.is_admin?'Configure the server Telegram API ID and hash if needed.':'Your access is approved. Connect your own Telegram account below.'}</div><div class="setup-steps"><span class="step">2</span> Enter your personal phone number and request an official Telegram login challenge.</div><div class="setup-steps"><span class="step">3</span> Enter the code here; complete two-step verification if required.</div><div class="field"><label>Phone number (international format)</label><input id="phone" autocomplete="tel" type="tel" placeholder="+1 555 000 0000"></div><button class="button button-primary" data-action="login-start" ${!t.configured?'disabled title="Server API ID/hash not configured"':''}>Send Telegram code</button><div id="authStage" class="hidden" style="margin-top:14px"><div class="field"><label>Telegram code</label><input id="telegramCode" autocomplete="one-time-code" placeholder="Login code"></div><button class="button" data-action="login-code">Verify code</button><div id="twoFactor" class="field hidden" style="margin-top:15px"><label>Telegram 2-step verification password</label><input id="telegramPassword" type="password" placeholder="Two-step password"><button class="button" data-action="login-password">Verify password</button></div></div>`}
 </section>${panel('Security model',`<div class="health-list"><div class="health-row">${icon('shield')}<div><div class="status-main">Authorized destinations only</div><div class="status-sub">Telegram permissions always apply</div></div></div><div class="health-row">${icon('lock')}<div><div class="status-main">Session stays on server</div><div class="status-sub">Never stored in browser local storage</div></div></div><div class="health-row">${icon('queue')}<div><div class="status-main">Account-aware queue</div><div class="status-sub">Sequential sends and flood-wait handling</div></div></div></div>`)}</div>
 <div style="display:flex;flex-direction:column;gap:17px">${panel('Service configuration',`<div class="health-list"><div class="health-row">${icon('bot')}<div><div class="status-main">Telegram control bot</div><div class="status-sub">Commands /start /status /pause /resume /routes</div></div><span class="right-flex">${pill(o.bot_configured?'Configured':'Needs .env',o.bot_configured?'success':'warn')}</span></div><div class="health-row">${icon('brain')}<div><div class="status-main">Optional Gemini AI gateway</div><div class="status-sub">External API only for selected route modes</div></div><span class="right-flex">${pill(o.ai_configured?'Configured':'Off',o.ai_configured?'success':'')}</span></div><div class="health-row">${icon('server')}<div><div class="status-main">FastAPI + SQLite backend</div><div class="status-sub">Private workspace API hosted on Railway</div></div><span class="right-flex">${pill('Running','success')}</span></div></div>`)}${panel('Telegram chats',state.chats.length?`<div style="max-height:290px;overflow-y:auto">${state.chats.map(c=>`<div class="route-brief"><span class="route-glyph">${icon(c.kind==='private'?'person':'document')}</span><div class="route-detail"><strong>${safe(c.title)}</strong><small>${safe(c.kind)} · ${safe(c.id)}</small></div><button class="button button-small" data-copy="${safe(c.id)}">Copy ID</button></div>`).join('')}</div>`:empty('person','No chats loaded','Sign in and press Load chats to see available source and destination identifiers.'),`<button class="small-link" data-action="load-chats">Load →</button>`)}</div></div>`;
}
function clearPreparedBackup(){
 if(state.backupUrl)URL.revokeObjectURL(state.backupUrl);
 state.backupUrl=null;state.backupFile=null;
}
function backupVersion(){return state.accessVersion+':'+(state.backupGeneration||0);}
function backupAllowed(version){return version===backupVersion()&&state.access==='approved'&&state.me?.is_admin;}
async function loadBackupStatus(){
 if(!state.me?.is_admin||state.access!=='approved')return;
 const version=backupVersion();
 try{const data=await request('/admin/backups/status');if(!backupAllowed(version))return;state.backupStatus=data;state.backupError='';}
 catch(e){if(!backupAllowed(version))return;state.backupError=e.message;if(e.status===401||e.status===403){state.backupGeneration=(state.backupGeneration||0)+1;state.backupBusy=false;clearPreparedBackup();}}
 if(state.page==='backups')render();
}
function backupsPage(){
 const last=state.backupLast,current=state.backupStatus;
 const changed=last&&current&&last.checksum!==current.configuration_checksum;
 const old=last&&(Date.now()-last.time>7*86400000||(current&&last.schema!==current.schema_version));
 const advice=changed?'Configuration changed since the last preparation. Export a fresh copy.':old?'A fresh backup is recommended: the last preparation is over a week old or the format changed.':!last?'No backup prepared in this app session. Export and save a copy before data-affecting updates, migrations or server moves.':'Prepared in this app session. Save it yourself, and export again after important changes or before data-affecting updates.';
 return `<div class="users-page"><button class="users-back" data-action="open-settings">${icon('chevron')} More</button>${pageHead('PRIVATE RECOVERY / OWNER','Backups','One organized ZIP. You choose where to save it.')}
 <section class="panel"><div class="panel-header"><h2>Portable configuration backup</h2><button class="button button-small" data-action="backup-refresh">Refresh</button></div><div style="padding:20px"><p>${current?`${safe(current.workspace_count)} approved workspaces`:'Approved workspaces'}: separate routes, filters, chat IDs and pause settings, with a manifest, checksums and recovery guide.</p><p class="field-help">Pending and revoked workspaces, login sessions, secrets, invitations, messages and queued sends are excluded. Restoring requires reconnecting Telegram and approving members again.</p><div class="notice warn">${safe(advice)}</div><p class="field-help">${last?'Last prepared: '+safe(new Date(last.time).toLocaleString())+' · this session only.':'Preparation history is kept only in memory.'} This does not confirm a saved copy.</p>
 ${state.backupError?`<p role="alert" class="notice warn">${safe(state.backupError)}</p>`:''}
 <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px"><button class="button button-primary" data-action="backup-prepare" ${state.backupBusy?'disabled':''}>${state.backupBusy?'Preparing…':'Export Backup'}</button>${state.backupFile?'<button class="button" data-action="backup-save">Save / Share ZIP</button>':''}</div>
 <p class="field-help">The file is unencrypted and contains private configuration. Save it to Files, your own private cloud folder or offline storage. Nothing is uploaded automatically. It is outside Railway only after you save your copy.</p>
 <p class="field-help">On iPhone, tap Save / Share ZIP, then Save to Files if offered. If Telegram blocks saving, try Telegram Desktop. Opening an external browser does not carry your Telegram sign-in; do not copy login data or tokens into a URL.</p></div></section></div>`;
}
async function prepareBackup(){
 if(state.backupBusy||!state.me?.is_admin||state.access!=='approved')return;
 const version=backupVersion();state.backupBusy=true;state.backupError='';clearPreparedBackup();render();
 try{
  const data=await request('/admin/backups/export');if(!backupAllowed(version))return;
  if(!Number.isFinite(Date.parse(data.created_at))||data.schema_version!==1||!/^[a-f0-9]{64}$/.test(data.configuration_checksum)||typeof data.content_base64!=='string'||data.content_base64.length>8388608||!/^becs-backup-\d{4}-\d{2}-\d{2}-\d{6}-UTC\.zip$/.test(data.filename))throw new Error('Invalid backup response.');
  const decoded=atob(data.content_base64);if(decoded.length>6291456||decoded.slice(0,2)!=='PK')throw new Error('Invalid backup archive.');
  const bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));
  state.backupFile=new File([bytes],data.filename,{type:'application/zip'});
  state.backupLast={time:Date.parse(data.created_at),checksum:data.configuration_checksum,schema:data.schema_version};
  state.backupStatus=null;
  toast('Backup prepared. Tap Save / Share ZIP to save your copy.');
 }catch(e){if(backupAllowed(version)){state.backupError=e.message;clearPreparedBackup();}}
 finally{if(backupAllowed(version)){state.backupBusy=false;if(state.page==='backups')render();}}
}
async function saveBackup(){
 if(!state.backupFile||!state.me?.is_admin||state.access!=='approved')return;
 const file=state.backupFile,version=backupVersion();
 try{
  if(navigator.canShare?.({files:[file]})&&navigator.share){
   await navigator.share({files:[file],title:'Becs configuration backup'});
   if(backupAllowed(version))toast('Share sheet finished. Check that your copy was saved.');
  }else{
   if(state.backupUrl)URL.revokeObjectURL(state.backupUrl);
   state.backupUrl=URL.createObjectURL(file);
   const a=document.createElement('a');a.href=state.backupUrl;a.download=file.name;a.rel='noopener';document.body.append(a);a.click();a.remove();
   toast('Download requested. Check Downloads or Files for your ZIP.');
  }
 }catch(e){if(backupAllowed(version)&&e.name!=='AbortError'){state.backupError='Saving was not completed. Try again or use Telegram Desktop.';render();}}
}
function gatePage() {
  return `<section class="access-card">
    <span class="access-symbol">${icon('lock')}</span>
    <p class="eyebrow">BECS / SECURE TELEGRAM ACCESS</p>
    <h1>Open Becs in Telegram</h1>
    <p>Open @mock_becs_bot in Telegram and launch Becs using the Mini App button.</p>
    <div class="notice warn" role="alert">${safe(state.apiError || 'A verified Telegram launch is required.')}</div>
    <p>If this launch has expired, close the Mini App and open it again from the bot.</p>
    <button class="button button-primary" data-action="retry-access">${icon('refresh')} Check access</button>
    <div class="access-footer">Invite-only access. Each approved person gets a private workspace.</div>
  </section>`;
}
function accessPage(){
 const status=state.access;const pending=status==='pending';const revoked=status==='revoked'||status==='rejected';
 const title=pending?'Approval pending':revoked?'Access revoked':status==='checking'?'Checking your access…':'Private access only';
 const detail=pending?'Your invitation has been accepted. The owner needs to approve your access before you can connect Telegram.':revoked?'Your access to Becs is no longer active. Contact the owner if you need access again.':status==='checking'?'Verifying your Telegram identity.':'Ask the owner for an invite link, open it in Telegram, and tap Start. No separate signup or password is needed.';
 return `<section class="access-card"><span class="access-symbol ${revoked?'revoked':''}">${icon(pending?'clock':'lock')}</span><p class="eyebrow">BECS / PRIVATE WORKSPACE</p><h1>${title}</h1><p>${detail}</p>${state.me?.user?.display_name?`<div class="access-identity">${icon('person')}<span>${safe(state.me.user.display_name)}</span></div>`:''}${status==='checking'?'':`<button class="button button-primary" data-action="retry-access">${icon('refresh')} Check access</button>`}<div class="access-footer">${pending?'Once approved, you’ll get your own routes, chats and queue.':'Each approved person gets a separate workspace. The administrator can export approved users’ routes and settings for backup; sessions and message history are excluded.'}</div></section>`;
}
function render(){
 renderNav();
 dom('mainView').innerHTML=state.apiError?gatePage():state.access!=='approved'?accessPage():!state.overview?accessPage():state.page==='home'?overviewPage():state.page==='routes'?routesPage():state.page==='filters'?filtersPage():state.page==='queue'?queuePage():state.page==='inspector'?inspectorPage():state.page==='users'&&state.me?.is_admin?usersPage():state.page==='backups'&&state.me?.is_admin?backupsPage():morePage();
 if(!state.apiError&&state.access==='approved'&&state.page==='more'&&state.me?.is_admin)openAdminStatus();
}

const userId = user => String(user.telegram_id??user.user_id??'');
const ownerUser = user => user.is_owner||user.role==='admin'||user.role==='owner';
const userName = user => user.display_name||'Telegram user';
const activeUserCount = () => state.users.filter(user=>user.status==='approved').length;
const capacity = () => Number(state.me?.capacity)||3;
const atCapacity = () => state.usersLoaded&&activeUserCount()>=capacity();
const expiryTime = value => typeof value==='number'?value*1000:Date.parse(value);
const expiryLabel = value => {const date=new Date(expiryTime(value));return Number.isFinite(date.getTime())?date.toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'soon';};
function accessError(error){
 const reason=error.reason||error.message;
 if(/capacity|three-account limit|workspaces? (?:are )?full|capacity_full/i.test(reason))return 'All 3 workspaces are in use. Revoke an approved user’s access before approving someone else.';
 if(/expired/i.test(reason))return 'This invitation has expired. Create a new invite link.';
 if(/used|consumed/i.test(reason))return 'This invitation has already been used. Refresh Users to check the person’s status.';
 if(/revoked/i.test(reason))return 'This invitation or access was revoked. Refresh Users before trying again.';
 if(error.status===403)return 'Owner access is required. Refresh to check your access.';
 return error.message||'Could not update access. Try again.';
}
async function loadUsers(){
 if(!state.me?.is_admin||state.access!=='approved'||state.usersLoading)return;
 const version=state.accessVersion;state.usersLoading=true;state.usersError='';
 if(state.page==='users'&&!state.usersLoaded)render();
 try{
  const data=await request('/admin/users');
  if(version!==state.accessVersion||!state.me?.is_admin)return;
  state.users=Array.isArray(data.users)?data.users:[];state.usersLoaded=true;
  if(data.capacity)state.me.capacity=data.capacity;
  try{const data=await request('/admin/invites');if(version===state.accessVersion)state.invites=Array.isArray(data.invites)?data.invites:[];}
  catch(error){if(version===state.accessVersion)state.usersError='Users loaded. Invitation status is unavailable; refresh to try again.';}
 }catch(error){if(version===state.accessVersion)state.usersError=accessError(error);}
 finally{state.usersLoading=false;if(version===state.accessVersion&&state.page==='users')render();}
}
function usersPage(){
 const active=activeUserCount();const pending=state.users.filter(user=>user.status==='pending').length;
 const userRows=[...state.users].sort((a,b)=>Number(ownerUser(b))-Number(ownerUser(a))).map(user=>{
  const owner=ownerUser(user),status=user.status,uid=userId(user);
  const label=owner?'Owner':status==='approved'?'Approved':status==='pending'?'Pending approval':status==='revoked'?'Revoked':status==='rejected'?'Rejected':'Not active';
  const tone=status==='approved'?'success':status==='pending'?'warn':'';
  const controls=owner?`<span class="owner-locked">${icon('lock')} Owner access</span>`:status==='pending'?`<button class="button button-small button-primary" data-user-action="approve" data-user-id="${safe(uid)}" ${atCapacity()?'disabled title="All workspaces are in use"':''}>Approve</button><button class="button button-small button-subtle" data-user-action="reject" data-user-id="${safe(uid)}">Reject</button>`:status==='approved'?`<button class="button button-small button-subtle user-revoke" data-user-action="revoke" data-user-id="${safe(uid)}">Revoke</button>`:status==='revoked'?`<button class="button button-small button-subtle" data-user-action="reinvite" data-user-id="${safe(uid)}" ${atCapacity()?'disabled':''}>Reinvite</button>`:'';
  return `<article class="user-row" data-user-row="${safe(uid)}"><div class="user-avatar ${owner?'owner-avatar':''}">${icon(owner?'shield':'person')}</div><div class="user-info"><strong>${safe(userName(user))}${owner?'<span class="user-you">you</span>':''}</strong><small>Telegram ID ${safe(uid)}</small><div class="user-status">${pill(label,tone)}</div></div><div class="user-actions">${controls}</div></article>`;
 }).join('');
 const liveInvites=state.invites.filter(invite=>!invite.used_at&&!invite.redeemed_at&&!invite.revoked_at&&(!invite.status||['active','expired'].includes(invite.status)));
 const inviteRows=liveInvites.map(invite=>{const expired=expiryTime(invite.expires_at)<=Date.now();return `<div class="invite-row"><span class="invite-glyph">${icon(expired?'clock':'send')}</span><div><strong>${expired?'Expired invitation':'Unused invitation'}</strong><small>#${safe(String(invite.id).slice(0,8))} · ${expired?'Expired':'Expires'} ${safe(expiryLabel(invite.expires_at))}</small></div>${expired?'':`<button class="button button-small button-subtle" data-invite-revoke="${safe(invite.id)}">Revoke</button>`}</div>`;}).join('');
 return `<div class="users-page"><button class="users-back" data-action="open-settings">${icon('chevron')} More</button>${pageHead('PRIVATE ACCESS / OWNER','Users','Invite people you trust. Approve each person before their workspace opens.',`<button class="button button-primary" data-action="invite-user" ${!state.usersLoaded||atCapacity()?'disabled':''}>${icon('plus')} Invite User</button>`)}
 <section class="users-capacity"><span class="users-capacity-icon">${icon('shield')}</span><div><strong>${active} of ${capacity()} workspaces in use</strong><small>Owner + 2 users · each workspace is separate</small></div><span class="seat-dots" aria-hidden="true">${Array.from({length:capacity()},(_,i)=>`<i class="${i<active?'used':''}"></i>`).join('')}</span></section>
 ${state.usersError?`<div class="notice warn users-notice" role="alert">${safe(state.usersError)}</div>`:''}${atCapacity()?'<div class="notice users-notice">All workspaces are in use. Revoke an approved user’s access to make room.</div>':''}
 <section class="panel users-panel"><div class="panel-header"><h2>People ${pending?`<span class="pending-count">${pending} pending</span>`:''}</h2><button class="button button-small button-subtle" data-action="users-refresh" aria-label="Refresh users" ${state.usersLoading?'disabled':''}>${icon('refresh')}</button></div>${userRows||`<div class="users-empty">${state.usersLoading?'Loading people…':'Could not load people. Refresh to try again.'}</div>`}</section>
 ${inviteRows?`<section class="panel users-panel invites-panel"><div class="panel-header"><h2>Invitations</h2><span class="field-help">Single-use links</span></div>${inviteRows}</section>`:''}
 <div class="users-how"><span>${icon('lock')}</span><p>Invite → Telegram Start → owner approval<br><small>Then each person connects their own Telegram account. Routes, chats, queues and sessions stay separate.</small></p></div></div>`;
}
function usersDialog(title,kind){
 if(state.userBusy||state.inviteBusy||!state.me?.is_admin)return false;
 dom('toastRegion').replaceChildren();
 state.modalOpener=document.activeElement;state.modalKind=kind;
 dom('modal').classList.remove('becs-compact-route');dom('modal').classList.add('users-modal');
 dom('modal').querySelector('.eyebrow').textContent='PRIVATE ACCESS / OWNER';dom('modalTitle').textContent=title;
 dom('modal').classList.remove('hidden');return true;
}
function openInvite(target=null){
 if(!state.usersLoaded||atCapacity()||!usersDialog('Invite User','invite'))return;
 state.invite={url:'',id:null,expires_at:null,error:'',target};renderInvite();
 dom('modalBody').querySelector('button')?.focus();
}
function renderInvite(){
 const invite=state.invite;if(!invite||state.modalKind!=='invite')return;
 const expired=invite.expires_at&&expiryTime(invite.expires_at)<=Date.now();if(expired)invite.url='';
 dom('modalBody').innerHTML=`<p class="users-dialog-description">${invite.target?`Reinvite ${safe(invite.target.name)} (Telegram ID ${safe(invite.target.id)}). This link works only for that account. They’ll open it in Telegram`:'Share a private, single-use link with one person. They’ll open it in Telegram'} and tap Start, then wait for your approval.</p><div class="invite-steps"><span>1 <b>Send invite</b></span><span>2 <b>They tap Start</b></span><span>3 <b>You approve</b></span></div>
 ${invite.error?`<div class="notice warn" role="alert">${safe(invite.error)}</div>`:''}
 ${invite.url?`<div class="field invite-link-field"><label for="privateInviteLink">Private invite link</label><input id="privateInviteLink" type="text" value="${safe(invite.url)}" readonly autocomplete="off" spellcheck="false"><span class="field-help">Expires ${safe(expiryLabel(invite.expires_at))}. Copy now; this link won’t be shown again after you close this window.</span></div><button class="button button-primary" data-action="copy-invite">${icon('copy')} Copy invite link</button>`:expired?'<div class="notice warn">This invitation has expired. Close this window and create a new invite.</div>':`<p class="helper-line">Creating a link does not grant access or reserve a workspace.</p>`}
 <div class="modal-actions"><button class="button" data-action="close-modal" ${state.inviteBusy?'disabled':''}>${invite.id?'Done':'Cancel'}</button>${!invite.id?`<button class="button button-primary" data-action="create-invite" ${state.inviteBusy?'disabled':''}>${icon('plus')} ${state.inviteBusy?'Creating…':'Create invite link'}</button>`:''}</div>`;
 dom('modalClose').disabled=state.inviteBusy;
}
async function createInvite(){
 if(state.inviteBusy||!state.invite||state.invite.id||!state.me?.is_admin)return;
 const invite=state.invite;state.inviteBusy=true;invite.error='';renderInvite();
 try{
  const result=await request(invite.target?`/admin/users/${encodeURIComponent(invite.target.id)}/reinvite`:'/admin/invites',{method:'POST'});
  if(state.invite!==invite||state.access!=='approved')return;
  const url=new URL(result.url);if(url.protocol!=='https:'||url.hostname!=='t.me')throw Error('The server returned an invalid invitation link. Refresh Users to revoke it.');
  Object.assign(invite,{id:result.id,url:result.url,expires_at:result.expires_at});
  if(!Number.isFinite(expiryTime(invite.expires_at)))throw Error('Invitation expiry is unavailable. Refresh Users to revoke this link.');
  const delay=expiryTime(invite.expires_at)-Date.now();
  state.inviteTimer=setTimeout(()=>{if(state.invite===invite){invite.url='';renderInvite();}},Math.max(0,Math.min(delay,2147483647)));
  void loadUsers();
 }catch(error){if(state.invite===invite){invite.url='';invite.error=accessError(error);}}
 finally{state.inviteBusy=false;if(state.invite===invite)renderInvite();else dom('modalClose').disabled=false;}
}
async function copyInvite(){
 const invite=state.invite;if(!invite?.url)return;
 if(expiryTime(invite.expires_at)<=Date.now()){invite.url='';renderInvite();return;}
 try{await navigator.clipboard.writeText(invite.url);if(state.invite===invite&&state.modalKind==='invite')toast('Invite link copied. Share it privately with one person.');}
 catch{if(state.invite===invite&&state.modalKind==='invite'){dom('privateInviteLink')?.select();toast('Select and copy the invite link above.',true);}}
}
function openUserAction(id,action){
 const user=state.users.find(item=>userId(item)===String(id));
 if(!user||ownerUser(user)||!['approve','reject','revoke','reinvite'].includes(action)||state.userBusy)return;
 if(action==='reinvite'){if(user.status==='revoked')openInvite(Object.freeze({id:userId(user),name:userName(user)}));return;}
 if(action==='approve'&&(user.status!=='pending'||atCapacity()))return;
 if(action==='revoke'&&user.status!=='approved')return;
 if(action==='reject'&&user.status!=='pending')return;
 const title={approve:'Approve access?',reject:'Reject this request?',revoke:'Revoke access?'}[action];
 if(!usersDialog(title,'user-action'))return;
 state.userConfirm=Object.freeze({id:userId(user),name:userName(user),action});
 const detail={approve:'This person will get a private workspace and can connect their own Telegram account.',reject:'This person won’t be able to open a workspace. They’ll need a new invitation to request access again.',revoke:'This person will lose workspace access and their forwarding will stop. Your workspace and other users are unaffected.'}[action];
 dom('modalBody').innerHTML=`<div class="confirm-person">${icon('person')}<div><strong>${safe(userName(user))}</strong><small>Telegram ID ${safe(userId(user))}</small></div></div><p class="users-dialog-description">${detail}</p><div id="userActionError" role="alert"></div><div class="modal-actions"><button class="button" data-action="close-modal">Cancel</button><button class="button ${action==='approve'?'button-primary':'button-danger'}" data-action="confirm-user">${action==='approve'?'Approve access':action==='revoke'?'Revoke access':'Reject request'}</button></div>`;
 dom('modalBody').querySelector('[data-action="close-modal"]').focus();
}
function openInviteRevocation(id){
 const invite=state.invites.find(item=>String(item.id)===String(id));if(!invite||invite.used_at||invite.redeemed_at||invite.revoked_at||(invite.status&&invite.status!=='active')||expiryTime(invite.expires_at)<=Date.now()||!usersDialog('Revoke invitation?','user-action'))return;
 state.userConfirm=Object.freeze({id:String(invite.id),action:'revoke-invite'});
 dom('modalBody').innerHTML=`<p class="users-dialog-description">Invitation #${safe(String(invite.id).slice(0,8))}, expiring ${safe(expiryLabel(invite.expires_at))}, will stop working. This won’t change anyone’s approved access.</p><div id="userActionError" role="alert"></div><div class="modal-actions"><button class="button" data-action="close-modal">Cancel</button><button class="button button-danger" data-action="confirm-user">Revoke invitation</button></div>`;
 dom('modalBody').querySelector('[data-action="close-modal"]').focus();
}
async function confirmUserAction(){
 const target=state.userConfirm;if(!target||state.userBusy||!state.me?.is_admin)return;
 state.userBusy=true;dom('modal').querySelectorAll('button').forEach(button=>button.disabled=true);
 try{
  await request(target.action==='revoke-invite'?`/admin/invites/${encodeURIComponent(target.id)}`:`/admin/users/${encodeURIComponent(target.id)}/${target.action}`,{method:target.action==='revoke-invite'?'DELETE':'POST'});
  if(state.userConfirm!==target)return;
  closeModal(true);toast(target.action==='approve'?'Access approved':target.action==='reject'?'Request rejected':target.action==='revoke-invite'?'Invitation revoked':'Access revoked');
  await loadUsers();
 }catch(error){if(state.userConfirm===target){const box=dom('userActionError');box.className='notice warn';box.textContent=accessError(error);}}
 finally{state.userBusy=false;if(state.userConfirm===target)dom('modal').querySelectorAll('button').forEach(button=>button.disabled=false);}
}

function newRouteDefaults(m='smart'){return {name:'',mode:m,enabled:false,sources:[],destinations:[],allowed:'',blocked:'',pattern:'',match_mode:'any',network:'both',require_contract:false,dedup_minutes:60,delivery_style:'native'};}
function field(label,id,value='',placeholder='',help='',type='text'){return `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${safe(value)}" placeholder="${safe(placeholder)}">${help?`<span class="field-help">${help}</span>`:''}</div>`;}
function selectField(label,id,value,opts,help=''){return `<div class="field"><label for="${id}">${label}</label><select id="${id}">${opts.map(([v,t])=>`<option value="${safe(v)}" ${value===v?'selected':''}>${safe(t)}</option>`).join('')}</select>${help?`<span class="field-help">${help}</span>`:''}</div>`;}
function routeModal(route=null){
 state.modalKind='route';state.modalOpener=document.activeElement;const r=route||newRouteDefaults();state.editing=route?.id||null;
 dom('modalTitle').textContent=route?'Edit '+r.name:'Create forwarding route';
 const chatOptions=`<div class="modal-section"><h3 class="section-title">Select Telegram chats</h3>
 <button type="button" class="button button-small" data-action="refresh-route-chats">Refresh chats</button> <span id="routeChatCount" class="field-help">${state.chats.length} chats loaded</span>
 <div class="field"><label for="sourceChatSearch">Search sources</label><input id="sourceChatSearch" type="search" placeholder="Search your source chats"></div><div id="sourceChatList" style="max-height:170px;overflow:auto"></div>
 <div class="field"><label for="destChatSearch">Search destinations</label><input id="destChatSearch" type="search" placeholder="Search your destination chats"></div><div id="destChatList" style="max-height:170px;overflow:auto"></div>
 <p class="field-help">Only checked chats are selected. No manual source IDs.</p></div>`;
 const preset=r.pattern||'';
 const prefix=key=>preset.includes('(?=[\\s\\S]*'+key+')');
 const reqLink=prefix('https?://'),reqNumber=prefix('\\d'),reqMention=prefix('@[A-Za-z0-9_]+');
 const network=r.network||'both';
 dom('modalBody').innerHTML=`<form id="routeForm" class="becs-smart-form">
 <div class="field"><label for="routeName">Route name</label><input id="routeName" required minlength="2" maxlength="100" value="${safe(r.name)}" placeholder="Crypto signals"></div>
 <input id="routeSources" type="hidden" value="${safe(r.sources.join(', '))}">
 <input id="routeDests" type="hidden" value="${safe(r.destinations.join(', '))}">
 <input id="routeMode" type="hidden" value="${safe(r.mode||'smart')}"><input id="routeMatch" type="hidden" value="${safe(r.match_mode||'any')}">
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
function closeModal(force=false){if(!force&&(state.userBusy||state.inviteBusy))return;dom('modal').classList.add('hidden');dom('modal').classList.remove('becs-compact-route','users-modal');dom('modalBody').replaceChildren();dom('modalTitle').textContent='Becs';dom('modalClose').disabled=false;state.editing=null;state.invite=null;state.userConfirm=null;state.modalKind=null;clearTimeout(state.inviteTimer);dom('modal').querySelector('.eyebrow').textContent='AUTOMATION WORKSPACE';if(state.modalOpener?.isConnected)state.modalOpener.focus();}
function collectRoute(){
 const terms=id=>(dom(id)?.value||'').split(',').map(x=>x.trim()).filter(Boolean);
 const sol=dom('routeSolana').checked,evm=dom('routeEvm').checked;
 if(!sol&&!evm)throw Error('Select Solana, EVM, or both');
 const req=[];
 if(dom('routeReqLink').checked)req.push('(?=[\\s\\S]*https?://)');
 if(dom('routeReqNumber').checked)req.push('(?=[\\s\\S]*\\d)');
 if(dom('routeReqMention').checked)req.push('(?=[\\s\\S]*@[A-Za-z0-9_]+)');
 let pattern=req.join('');
 if(pattern)pattern='(?s)'+pattern+'.*';
 else pattern=dom('routePattern').value||'';
 if(pattern.length>250)throw Error('Optional requirements exceed regex limit');
 const mode=document.querySelector('.becs-mode-button.active')?.dataset.filterMode||'token';
 let allowed=dom('routeAllow').value.trim();
 if(mode==='all'||mode==='token')allowed='';
 if((mode==='keywords'||mode==='both')&&!allowed)throw Error('Enter at least one included keyword or regex');
 return {name:dom('routeName').value.trim(),mode:dom('routeMode').value,enabled:dom('routeEnabled').checked,
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
 'open-backups':()=>navigate('backups'),'backup-refresh':loadBackupStatus,'backup-prepare':prepareBackup,'backup-save':saveBackup,'owner-status':openAdminStatus,'open-users':()=>navigate('users'),'users-refresh':()=>loadUsers(),'invite-user':()=>openInvite(),'create-invite':createInvite,'copy-invite':copyInvite,'confirm-user':confirmUserAction,
 'retry-access':async(el)=>{if(el.disabled)return;el.disabled=true;await reload();if(el.isConnected)el.disabled=false;},
 'new-route':()=>routeModal(), 'new-express':()=>routeModal(newRouteDefaults('express')), 'open-orphanage':()=>navigate('filters'), 'preset-solana':()=>{navigate('filters');applyFilterPreset('solana');}, 'preset-evm':()=>{navigate('filters');applyFilterPreset('evm');}, 'preset-both':()=>{navigate('filters');applyFilterPreset('both');}, 'preset-launch':()=>{navigate('filters');applyFilterPreset('launch');}, 'preset-dex':()=>{navigate('filters');applyFilterPreset('dex');}, 'preset-custom':()=>navigate('filters'), 'open-routes':()=>navigate('routes'),'open-filters':()=>navigate('filters'),'open-queue':()=>navigate('queue'),'open-settings':()=>navigate('more'),
 'refresh':()=>reload(true,{preserve:true}),'refresh-inspector':refreshInspector, 'pause':()=>updatePause(true), 'resume':()=>updatePause(false),'close-modal':()=>closeModal(),
 'run-sim':simulate,'load-chats':loadChats,
 'refresh-route-chats':refreshRouteChats,'resolve-source':()=>addChatReference('source'),'resolve-destination':()=>addChatReference('destination'),
 'disconnect':async()=>{if(!confirm('Disconnect the server from Telegram? The saved session will remain available for reconnect.'))return;try{await request('/telegram/disconnect',{method:'POST'});await reload();toast('Telegram disconnected');}catch(e){toast(e.message,true);}},
 'login-start':(el)=>login('start',{phone:dom('phone').value},el),
 'login-code':(el)=>login('code',{code:dom('telegramCode').value},el),
 'login-password':(el)=>login('password',{password:dom('telegramPassword').value},el),
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
 const target=event.target.closest('[data-user-action],[data-invite-revoke],[data-nav],[data-mode],[data-action],[data-edit],[data-delete],[data-jobtab],[data-retry],[data-approve],[data-reject],[data-copy],[data-usechat],[data-filter-preset],[data-route-preset],[data-filter-mode],[data-inspector-kind]');if(!target||target.disabled)return;
 if(state.access!=='approved'&&target.dataset.action!=='retry-access')return;
 if(target.dataset.userAction){openUserAction(target.dataset.userId,target.dataset.userAction);return;}
 if(target.dataset.inviteRevoke){openInviteRevocation(target.dataset.inviteRevoke);return;}
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
dom('refreshBtn').addEventListener('click',()=>reload(true,{preserve:true}));
dom('modalClose').addEventListener('click',()=>closeModal());
dom('modal').addEventListener('click',event=>{if(event.target===dom('modal'))closeModal();});
document.addEventListener('keydown',event=>{if(dom('modal').classList.contains('hidden'))return;if(event.key==='Escape')closeModal();if(event.key==='Tab'&&state.modalKind!=='route'){const nodes=[...dom('modal').querySelectorAll('button:not(:disabled),input:not(:disabled),a[href]')].filter(node=>node.offsetParent!==null);if(!nodes.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
// Ordered capabilities come from the authenticated workspace overview.
const upgradeLevel = () => Number(state.overview?.upgrade_level || 0);
const upgradeOriginalRender = render;
const upgradeOriginalRouteModal = routeModal;
const upgradeOriginalCollectRoute = collectRoute;
const upgradeOriginalClearWorkspace = clearWorkspace;
const upgradeOriginalRequest = request;

clearWorkspace = function () {
 state.upgradeBackup = null;
 state.upgradeBackupGeneration = (state.upgradeBackupGeneration || 0) + 1;
 state.upgradeBackupLoading = false;
 state.upgradeViewState = {};
 state.upgradePresets = [];
 upgradeOriginalClearWorkspace();
};

request = async function (path, options = {}) {
 if (upgradeLevel() < 7 || options.signal) return upgradeOriginalRequest(path, options);
 const controller = new AbortController();
 const timer = setTimeout(() => controller.abort(), 15000);
 try { return await upgradeOriginalRequest(path, {...options, signal:controller.signal}); }
 catch (error) {
  if (controller.signal.aborted) throw new Error('The request took too long. Your existing routes are still running; retry when connected.');
  throw error;
 } finally { clearTimeout(timer); }
};

collectRoute = function () {
 return {...upgradeOriginalCollectRoute(), match_mode:dom('routeMatch')?.value||'any', shadow_mode:!!dom('routeShadow')?.checked};
};

routeModal = function (route = null) {
 upgradeOriginalRouteModal(route);
 if (upgradeLevel() < 1) return;
 const field = document.createElement('section');
 field.className = 'upgrade-shadow-control';
 field.innerHTML = `<label class="checkboxline"><input id="routeShadow" type="checkbox" ${route?.shadow_mode?'checked':''}> Shadow Mode — observe without sending</label><p class="field-help">An enabled shadow route records what would pass or repeat. It never queues deliveries. Switching a live route to Shadow Mode holds its pending jobs for review.</p>`;
 dom('routeForm').querySelector('.becs-smart-panel').before(field);
 if (upgradeLevel() >= 4) installPresetControls();
};

async function installPresetControls() {
 const form = dom('routeForm');
 const version = state.accessVersion;
 if (!form) return;
 const section = document.createElement('section');
 section.className = 'upgrade-presets';
 section.innerHTML = `<h3>My filter presets</h3><div class="upgrade-actions"><select id="upgradePreset" aria-label="Saved filter preset"><option value="">Choose a saved preset</option></select><button type="button" class="button button-small" data-upgrade-action="apply-preset">Apply</button><button type="button" class="button button-small" data-upgrade-action="delete-preset">Delete selected</button></div><label for="upgradePresetName">Save these rules as</label><div class="upgrade-actions"><input id="upgradePresetName" maxlength="80" placeholder="Preset name"><button type="button" class="button button-small" data-upgrade-action="save-preset">Save preset</button></div><p class="field-help">Only filters are saved. Chats, enabled state and delivery mode stay with the route.</p>`;
 form.querySelector('.becs-smart-panel').after(section);
 try {
  const data = await request('/presets');
  if (!section.isConnected || version !== state.accessVersion) return;
  state.upgradePresets = data.presets;
  dom('upgradePreset').innerHTML = '<option value="">Choose a saved preset</option>' + data.presets.map(p=>`<option value="${p.id}">${safe(p.name)}</option>`).join('');
 } catch (error) { if (section.isConnected) section.insertAdjacentHTML('beforeend',`<p role="alert">${safe(error.message)}</p>`); }
}

function upgradeDecisionRows(items) {
 return items.length ? items.map(row=>`<details class="upgrade-decision"><summary><strong>${safe(row.decision.replaceAll('_',' '))}</strong> · ${safe(row.route_name||'Removed route')} <span>${safe(row.address||'No eligible address')}</span></summary><dl><dt>Why</dt><dd>${safe(row.reason)}</dd><dt>Source</dt><dd>${safe(row.source_id)} · message ${row.message_id}</dd><dt>Destination</dt><dd>${safe(row.destination_id||'Not queued')}</dd><dt>Delivery</dt><dd>${row.shadow?'Shadow only — no send':'See Queue for the final delivery outcome'}</dd><dt>Observed</dt><dd>${safe(new Date(row.created_at*1000).toLocaleString())}</dd></dl></details>`).join('') : '<p>No matching observations yet. Enabled routes will populate this view as new messages arrive.</p>';
}

async function loadUpgradeDecisions(container) {
 const version = state.accessVersion;
 try {
  const data = await request(upgradeLevel() >= 2 ? '/decisions' : '/shadow');
  if (!container.isConnected || state.accessVersion !== version) return;
  container.innerHTML = upgradeDecisionRows(data.items) + `<p class="field-help">${safe(data.scope)} Up to ${data.maximum_records} records / ${data.retention_days} days.</p>`;
 } catch (error) { if (container.isConnected) container.innerHTML = `<p role="alert">${safe(error.message)}</p>`; }
}

function captureUpgradeView() {
 if (upgradeLevel() < 7 || state.access !== 'approved') return;
 const values = {};
 for (const id of ['labMessage','labAllow','labBlock','labPattern','labNetwork','labMatch','labContract']) {
  const element = dom(id);
  if (element) values[id] = {value:element.value,checked:element.checked};
 }
 state.upgradeViewState ||= {};
 state.upgradeViewState[state.upgradeRenderedPage || state.page] = values;
 const focused = document.activeElement;
 state.upgradeFocus = focused?.id && values[focused.id] ? {id:focused.id,start:focused.selectionStart,end:focused.selectionEnd} : null;
}

render = function () {
 captureUpgradeView();
 upgradeOriginalRender();
 if (state.access !== 'approved' || state.apiError || upgradeLevel() < 1) return;
 const main = dom('mainView');
 if (state.page === 'routes' && upgradeLevel() >= 3) {
  for (const card of main.querySelectorAll('.route-card')) {
   const id = Number(card.querySelector('[data-edit]')?.dataset.edit);
   const health = state.overview.route_health?.find(row=>row.id===id);
   if (!health) continue;
   const section = document.createElement('div');
   section.className = 'upgrade-route-health';
   section.innerHTML = `<span>${health.shadow_mode?'Shadow Mode':'Live delivery'}</span><span>${health.delivered} delivered · ${health.queued} queued · ${health.failed} need review</span><span>Last observed: ${health.last_seen?age(health.last_seen):'Awaiting activity'}${health.oldest_queued_seconds?' · Oldest queued '+health.oldest_queued_seconds+'s':''}</span>`;
   card.querySelector('.route-footer').before(section);
  }
 }
 if (state.page === 'inspector' || state.page === 'queue') {
  const section = document.createElement('section');
  section.className = 'panel upgrade-panel';
  section.innerHTML = `<div class="panel-header"><h2>${upgradeLevel()>=2?'Why this happened':'Shadow observations'}</h2>${upgradeLevel()>=5?'<button class="button button-small" data-upgrade-action="compare-sources">Compare sources</button>':''}</div><div class="upgrade-decisions">Loading observations…</div>`;
  main.append(section);
  loadUpgradeDecisions(section.querySelector('.upgrade-decisions'));
 }
 if (state.page === 'home' && upgradeLevel() >= 5) {
  const button = document.createElement('button');
  button.className = 'button upgrade-source-button';
  button.dataset.upgradeAction = 'compare-sources';
  button.textContent = 'Compare signal sources';
  main.append(button);
 }
 if (state.page === 'backups' && state.me?.is_admin && upgradeLevel() >= 6) {
  const section = document.createElement('section');
  section.className = 'panel upgrade-panel';
  section.innerHTML = `<div class="panel-header"><h2>Preview a configuration backup</h2></div><div class="upgrade-backup-body"><label for="upgradeBackupFile">Choose a Becs configuration ZIP (up to 6 MiB)</label><input id="upgradeBackupFile" type="file" accept=".zip,application/zip"><div id="upgradeBackupPreview">Previewing does not change routes.</div></div>`;
  main.append(section);
  if (state.upgradeBackup) showUpgradeBackupPreview();
 }
 if (upgradeLevel() >= 7) {
  for (const [id,value] of Object.entries(state.upgradeViewState?.[state.page] || {})) {
   const element = dom(id);
   if (element) { element.value=value.value; if (element.type==='checkbox') element.checked=value.checked; }
  }
  const focus = state.upgradeFocus;
  if (focus && dom(focus.id)) {
   dom(focus.id).focus({preventScroll:true});
   try { dom(focus.id).setSelectionRange(focus.start,focus.end); } catch (_) {}
  }
 }
 state.upgradeRenderedPage = state.page;
};

async function compareUpgradeSources() {
 state.modalKind = 'source-comparison';
 dom('modalTitle').textContent = 'Source comparison';
 dom('modalBody').innerHTML = '<p>Loading observed sources…</p>';
 dom('modal').classList.remove('hidden');
 const body = dom('modalBody');
 try {
  const data = await request('/sources/comparison');
  if (state.modalKind !== 'source-comparison' || !body.isConnected) return;
  body.innerHTML = `<p class="field-help">${safe(data.scope)}</p><div class="upgrade-table-wrap"><table class="upgrade-table"><thead><tr><th>Source</th><th>Unique addresses</th><th>First observed</th><th>Repeat mentions</th></tr></thead><tbody>${data.sources.map(row=>`<tr><td>${safe(state.chats.find(chat=>chat.id===row.source_id)?.title||row.source_id)}</td><td>${row.unique_addresses}</td><td>${row.first_observations}</td><td>${row.repeat_percent}%</td></tr>`).join('')}</tbody></table></div>${data.sources.length?'':'<p>No observations yet. This starts collecting with the upgrade; it does not scan chat history.</p>'}`;
 } catch (error) { if (state.modalKind==='source-comparison') body.textContent=error.message; }
}

async function previewUpgradeBackup(file) {
 state.upgradeBackup = null;
 const container = dom('upgradeBackupPreview');
 if (!file || file.size > 6*1024*1024) throw new Error('Choose a configuration ZIP no larger than 6 MiB.');
 const generation = (state.upgradeBackupGeneration || 0) + 1;
 state.upgradeBackupGeneration = generation;
 const version = state.accessVersion;
 state.upgradeBackupLoading = true;
 container.textContent = 'Validating backup…';
 try {
 const bytes = new Uint8Array(await file.arrayBuffer());
 let binary = '';
 for (let offset=0;offset<bytes.length;offset+=32768) binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
 const payload = {content_base64:btoa(binary)};
 const preview = await request('/admin/backups/preview',{method:'POST',body:JSON.stringify(payload)});
 if (version!==state.accessVersion || generation!==state.upgradeBackupGeneration) return;
 state.upgradeBackup = {payload,preview};
 showUpgradeBackupPreview();
 } finally {
  if (generation===state.upgradeBackupGeneration) state.upgradeBackupLoading=false;
 }
}

function showUpgradeBackupPreview() {
 const {preview} = state.upgradeBackup;
 const container = dom('upgradeBackupPreview');
 if (!container) return;
 container.innerHTML = `<p>${safe(preview.notice)}</p><p>${preview.current_routes.length} current routes will be retained. ${preview.route_count} routes from your own backup workspace are available.</p>${preview.routes.map(route=>`<label class="checkboxline"><input type="checkbox" data-upgrade-import-index="${route.index}"> ${safe(route.name)} · ${route.sources.length} sources → ${route.destinations.length} destinations</label><p class="field-help">${safe(route.comparison||'')}</p>`).join('')}<button class="button" data-upgrade-action="import-backup" ${preview.routes.length?'':'disabled'}>Import selected as disabled shadow routes</button><p class="field-help">Other users' archived workspaces cannot be imported here. Reconnecting Telegram and granting membership remain separate actions.</p>`;
}

document.addEventListener('change',async event=>{
 if (event.target.id!=='upgradeBackupFile' || state.access!=='approved' || !state.me?.is_admin) return;
 try { await previewUpgradeBackup(event.target.files[0]); }
 catch (error) { if (dom('upgradeBackupPreview')) dom('upgradeBackupPreview').textContent=error.message; }
});

document.addEventListener('click',async event=>{
 const button = event.target.closest('[data-upgrade-action]');
 if (!button || button.disabled || state.access!=='approved') return;
 button.disabled = true;
 try {
  const action = button.dataset.upgradeAction;
  if (action === 'compare-sources') await compareUpgradeSources();
  if (action === 'save-preset') {
   const route = collectRoute();
   const filters = Object.fromEntries(['allowed','blocked','pattern','match_mode','network','dedup_minutes','require_contract'].map(key=>[key,route[key]]));
   const name = dom('upgradePresetName').value.trim();
   if (name.length<2) throw new Error('Enter a preset name with at least two characters.');
   await request('/presets',{method:'POST',body:JSON.stringify({name,filters})});
   dom('routeForm').querySelector('.upgrade-presets').remove();
   await installPresetControls();
   toast('Filter preset saved in your workspace');
  }
  if (action === 'apply-preset' || action === 'delete-preset') {
   const preset = state.upgradePresets?.find(row=>row.id===Number(dom('upgradePreset').value));
   if (!preset) throw new Error('Choose a saved preset first.');
   if (action==='delete-preset') {
    if (!confirm('Delete the saved filter preset '+preset.name+'? Existing routes are retained.')) return;
    await request('/presets/'+preset.id,{method:'DELETE'});
    dom('routeForm').querySelector('.upgrade-presets').remove();
    await installPresetControls();
   } else {
    const filters = preset.filters;
    dom('routeAllow').value=filters.allowed;
    dom('routeBlock').value=filters.blocked;
    dom('routePattern').value=filters.pattern;
    dom('routeCooldown').value=filters.dedup_minutes;
    dom('routeMatch').value=filters.match_mode;
    dom('routeSolana').checked=filters.network!=='evm';
    dom('routeEvm').checked=filters.network!=='solana';
    dom('routeReqLink').checked=false;dom('routeReqNumber').checked=false;dom('routeReqMention').checked=false;
    document.querySelectorAll('.becs-mode-button').forEach(control=>{const active=control.dataset.filterMode===(filters.allowed?'both':'token');control.classList.toggle('active',active);control.setAttribute('aria-pressed',String(active));});
    toast('Preset loaded. Review and save the route to apply it.');
   }
  }
  if (action === 'import-backup') {
   const backup = state.upgradeBackup;
   if (!backup || !state.me?.is_admin) throw new Error('Preview a backup first.');
   const indices = [...document.querySelectorAll('[data-upgrade-import-index]:checked')].map(input=>Number(input.dataset.upgradeImportIndex));
   if (!indices.length) throw new Error('Select at least one route to import.');
   const result = await request('/admin/backups/import',{method:'POST',body:JSON.stringify({...backup.payload,route_indices:indices,expected_checksum:backup.preview.current_checksum})});
   state.upgradeBackup=null;
   toast(result.imported+' routes imported disabled and in Shadow Mode');
   await reload();
  }
 } catch (error) { toast(error.message,true); }
 finally { if (button.isConnected) button.disabled=false; }
});

render();
reload();
})();
