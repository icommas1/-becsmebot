"""One-time, hash-guarded source integration. CI tests the result before committing."""
from pathlib import Path
import hashlib

EXPECTED = {
    'app/main.py': 'd69230d0366c821616cbd710f2aaf9735e40b904',
    'static/app.js': 'd59aeb10e2113a04377ab24074ec81cb925d841c',
    'static/index.html': '94a37fc2cffcde0bf1f53dc9319706d6e849b2c0',
    'static/sw.js': 'fc0371d70bf0d27ece2f7bcb5b59d1d039cfb966',
}
files = {}
for name, expected in EXPECTED.items():
    raw = Path(name).read_bytes()
    actual = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    if actual != expected:
        raise SystemExit(f'Refusing to patch changed source: {name}')
    files[name] = raw.decode()


def replace(text, old, new):
    if text.count(old) != 1:
        raise SystemExit('Patch anchor is not unique: ' + old[:100])
    return text.replace(old, new)


main = files['app/main.py']
main = replace(main, 'from .models import RouteInput, Simulation, PhoneInput, CodeInput, PasswordInput, ReviewAction',
               'from . import dashboard_session\nfrom .models import RouteInput, Simulation, PhoneInput, CodeInput, PasswordInput, ReviewAction')
start = main.index('def is_authorized(request: Request)->bool:')
end = main.index('@asynccontextmanager', start)
main = main[:start] + '''def is_authorized(request: Request)->bool:
    # Login credentials are exchanged once; protected APIs require a timed session.
    return dashboard_session.authorize(request)


''' + main[end:]
main = replace(main, '    init_db()\n    stop=asyncio.Event()',
               '    init_db()\n    dashboard_session.init_sessions()\n    stop=asyncio.Event()')
main = replace(main, "app=FastAPI(title='Becs Crypto Forwarding',version='1.0.0',lifespan=lifespan,docs_url=None,redoc_url=None)",
               "app=FastAPI(title='Becs Crypto Forwarding',version='1.0.0',lifespan=lifespan,docs_url=None,redoc_url=None)\ndashboard_session.install(app, is_valid_init_data)")
main = replace(main,
    "if request.url.path.startswith('/api/') and request.url.path!='/api/health' and not is_authorized(request):\n        return JSONResponse(status_code=401,content={'detail':'Access denied. Open inside your authorized Telegram Mini App or enter your server access key.'})",
    "if request.url.path.startswith('/api/') and request.url.path not in dashboard_session.PUBLIC_PATHS and not is_authorized(request):\n        return dashboard_session.denial(request)")
main = replace(main, "def health():return {'ok':True,'service':'becs','version':'1.0.0'}",
               "def health():return {'ok':True,'service':'becs','version':'1.0.0','dashboard_session_seconds':300}")
files['app/main.py'] = main

js = files['static/app.js']
start = js.index('async function request(path,options={}) {')
end = js.index('function toast(', start)
js = js[:start] + '''async function request(path,options={}) {
 return window.BecsSession.request('/api'+path,options);
}
''' + js[end:]
start = js.index('function gatePage(){')
end = js.index('function render(){', start)
js = js[:start] + '''function gatePage(){
 return `<div class="page-head"><div><p class="eyebrow">SECURE ACCESS / FIVE MINUTES</p><h1>Unlock Becs</h1><p class="subheading">One unlock lasts five minutes, including reopening this Mini App. Activity never extends the timer.</p></div></div><section class="panel login-card"><div class="notice warn">${icon('lock')} ${safe(state.apiError||'Dashboard locked')}</div><div class="field" style="margin-top:20px"><label for="adminKey">Server access key</label><input id="adminKey" type="password" autocomplete="current-password" placeholder="Your BECS_ADMIN_TOKEN"></div><div class="session-unlock-actions"><button type="button" class="button button-primary" data-action="unlock">Unlock for 5 minutes</button>${tg?.initData?'<button type="button" class="button" data-action="unlock-telegram">Unlock with Telegram</button>':''}<button type="button" class="button button-subtle" data-action="retry-session">Retry session</button></div><p class="small-help">Your key is not saved in browser storage. A secure session cookie lasts at most five minutes. Logging out locks the dashboard only; Telegram forwarding continues.</p></section>`;
}
''' + js[end:]
old_unlock = " 'unlock':async()=>{sessionStorage.setItem('becs_key',dom('adminKey').value);await reload();if(state.apiError)toast('Invalid access key or server configuration',true);}"
js = replace(js, old_unlock,
    " 'unlock':el=>unlockDashboard(el,false),\n 'unlock-telegram':el=>unlockDashboard(el,true),\n 'retry-session':()=>window.BecsSession.restore()")
js = replace(js, 'reload();\n})();', '''async function unlockDashboard(button,viaTelegram){
 const input=dom('adminKey');
 const key=input?.value||'';
 if(input)input.value='';
 if(button)button.disabled=true;
 try{
  await window.BecsSession.login(viaTelegram?{init_data:tg?.initData||''}:{admin_token:key});
 }catch(error){toast(error.message,true);}
 finally{if(button)button.disabled=false;}
}
function lockDashboard(message){
 state.overview=null;state.routes=[];state.jobs=[];state.reviews=[];
 state.chats=[];state.inspections=[];state.simResult=null;
 state.labText='';state.labAllow='';state.labBlock='';state.labPattern='';
 state.apiError=message;state.page='home';state.editing=null;
 dom('modal').classList.add('hidden');dom('modalBody').replaceChildren();
 dom('toastRegion').replaceChildren();
 render();
}
window.BecsSession.start({onUnlock:()=>reload(),onLock:lockDashboard});
})();''')
files['static/app.js'] = js

html = files['static/index.html']
html = replace(html, '<link rel="stylesheet" href="/assets/styles.css">',
               '<link rel="stylesheet" href="/assets/styles.css">\n<link rel="stylesheet" href="/assets/dashboard-session.css?v=1">')
html = replace(html, '</header>', '''</header>
<div id="sessionBar" class="session-bar" hidden><span id="sessionCountdown" role="timer">Locks in 5:00</span><button type="button" id="dashboardLogout" class="button button-small">Log out</button></div>''')
html = replace(html, '<script src="/assets/app.js?v=smart-filters-v2" defer></script>',
               '<script src="/assets/dashboard-session.js?v=1" defer></script>\n<script src="/assets/app.js?v=five-minute-session-1" defer></script>')
files['static/index.html'] = html
sw = files['static/sw.js']
sw = replace(sw, 'becs-ui-v4-smart-filters', 'becs-ui-v5-dashboard-session')
sw = replace(sw, "'/assets/app.js',", "'/assets/app.js','/assets/dashboard-session.js','/assets/dashboard-session.css',")
files['static/sw.js'] = sw

for name, text in files.items():
    Path(name).write_text(text)
print('Applied dashboard-only changes; routes and forwarding engine are unchanged.')
Path(__file__).unlink()
