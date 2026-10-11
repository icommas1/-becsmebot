// Deterministic, synthetic-only recovery page logic checks when Chromium is unavailable.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../static/recovery.html'), 'utf8');
const app = fs.readFileSync(require('node:path').join(__dirname, '../static/app.js'), 'utf8');
assert(app.includes("dom('recoveryConsentCopy').textContent="));
assert(app.includes('<h1>Rollback Recovery</h1>'));
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
assert(!/<script[^>]+src=/i.test(html));
assert(!/localStorage|sessionStorage|console\./.test(source));
const flush = async () => {for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(auth='SYNTHETIC_SIGNED_LAUNCH') {
 const elements = Object.fromEntries(['begin','passwordForm','password','passwordAgain','generate','download','cancel','status','reopen'].map(id=>[id,{hidden:!['status','password','passwordAgain','generate'].includes(id),disabled:false,value:'',textContent:'',events:{},addEventListener(k,fn){this.events[k]=fn;},focus(){}}]));
 const requests=[],revoked=[],timers=new Map(),windowEvents={};let timerId=0,downloads=0,hold=null,pendingResolve;
 const state={confirmed:false,reject:false,hold:false};
 const context={document:{getElementById:id=>elements[id],body:{append(){}},createElement(){return{click(){downloads++;},remove(){}}}},window:{addEventListener:(k,fn)=>windowEvents[k]=fn},location:{hash:auth?'#tgWebAppData='+auth:'',pathname:'/recovery'},history:{replaceState(){context.location.hash='';}},URLSearchParams,AbortController,Date,JSON,Error,Number,String,encodeURIComponent,URL:{createObjectURL(){return'blob:synthetic';},revokeObjectURL(url){revoked.push(url);}},setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);},fetch:async (path,options)=>{
  assert.equal(options.headers['X-Telegram-Init-Data'],auth);assert(path.startsWith('/api/admin/recovery/'));requests.push({path,options});
  if(state.reject)return{ok:false,status:401};
  if(path.endsWith('/export')){
   assert.deepEqual(JSON.parse(options.body),{challenge_id:'synthetic',password:'SYNTHETIC-ONLY-PASSWORD'});
   if(state.hold)await new Promise(resolve=>{pendingResolve=resolve;});
   return{ok:true,headers:{get:()=> 'application/zip'},blob:async()=>({size:42})};
  }
  return{ok:true,json:async()=>path.endsWith('/challenge')?{challenge_id:'synthetic',expires_at:Date.now()/1000+120}:{status:state.confirmed?'confirmed':'pending'}};
 }};
 vm.runInNewContext(source,context);
 return{elements,state,requests,revoked,timers,windowEvents,context,get downloads(){return downloads;},release(){pendingResolve?.();},async click(id){await elements[id].events.click?.();await flush();},async submit(){await elements.passwordForm.events.submit({preventDefault(){}});await flush();},async tick(){const entry=timers.entries().next().value;if(entry){timers.delete(entry[0]);await entry[1]();await flush();}}};
}
(async()=>{
 const consentSource=app.slice(app.indexOf('async function saveRecoveryConsent'),app.indexOf('function render(){'));
 const consent={required:true,scope_version:'1',administrator:{user_id:'1001'}};
 const consentState={recoveryConsent:consent,accessVersion:1};const choiceCalls=[];let rejectChoice=false,loaded=0,resolveChoice;
 const consentError={textContent:''};
 const consentContext={state:consentState,render(){},dom(){return consentError;},JSON,request:async(path,options)=>{choiceCalls.push({path,body:JSON.parse(options.body)});if(rejectChoice)throw new Error('Synthetic failure');if(resolveChoice===true)await new Promise(resolve=>resolveChoice=resolve);},reload:async()=>{loaded++;}};
 vm.runInNewContext(consentSource+';globalThis.saveChoice=saveRecoveryConsent;',consentContext);
 rejectChoice=true;await consentContext.saveChoice('no');assert.equal(consentState.recoveryConsent.required,true);assert.match(consentError.textContent,/not saved/);
 rejectChoice=false;await consentContext.saveChoice('no');assert.equal(consentState.recoveryConsent.choice,'no');assert.equal(loaded,1);assert.deepEqual(choiceCalls[1].body,{choice:'no',scope_version:'1',administrator_id:'1001'});
 await consentContext.saveChoice('yes');assert.equal(choiceCalls.length,2);
 consentState.recoveryConsent=consent;resolveChoice=true;const saving=consentContext.saveChoice('yes');await flush();await consentContext.saveChoice('yes');assert.equal(choiceCalls.length,3);consentState.accessVersion++;resolveChoice();await saving;assert.equal(loaded,1);
 let f=fixture('');assert(f.elements.begin.hidden);assert(!f.elements.reopen.hidden);assert.equal(f.requests.length,0);
 f=fixture();assert.equal(f.context.location.hash,'');await f.click('begin');assert(f.elements.passwordForm.hidden);assert.equal(f.requests.length,2);
 f.state.confirmed=true;await f.tick();assert(!f.elements.passwordForm.hidden);
 f.elements.password.value='SYNTHETIC-ONLY-PASSWORD';f.elements.passwordAgain.value='different';await f.submit();assert.match(f.elements.status.textContent,/same password twice/);
 f.elements.passwordAgain.value='SYNTHETIC-ONLY-PASSWORD';await f.submit();assert(!f.elements.download.hidden);assert.equal(f.downloads,0);assert.equal(f.elements.password.value,'');assert.equal(f.elements.passwordAgain.value,'');
 await f.click('download');assert.equal(f.downloads,1);await f.click('cancel');assert(f.elements.download.hidden);assert.equal(f.revoked.length,1);
 // A canceled in-flight request must never resurrect the object URL/download.
 f.state.hold=true;await f.click('begin');f.elements.password.value=f.elements.passwordAgain.value='SYNTHETIC-ONLY-PASSWORD';const pending=f.submit();await flush();await f.click('cancel');f.release();await pending;assert(f.elements.download.hidden);assert.equal(f.downloads,1);
 f.state.reject=true;await f.click('begin');assert(f.elements.begin.hidden);assert(!f.elements.reopen.hidden);
 f=fixture();await f.click('begin');f.windowEvents.pagehide();await flush();assert(f.elements.passwordForm.hidden);assert.equal(f.elements.password.value,'');
 console.log('PASS: synthetic recovery page logic, consent source safety, no storage, manual download, cancellation, stale response, reauthentication');
})().catch(error=>{console.error(error);process.exitCode=1;});
