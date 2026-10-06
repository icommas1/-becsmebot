const { test } = require('@playwright/test');
const assert = require('node:assert/strict');

const health = () => ({ok:true,tradingEnabled:false,manualSell:{enabled:false},running:false,lastScanAt:new Date(Date.now()-30000).toISOString(),lastError:null,feeds:{},release:{commit:'e'.repeat(40)}});
const record = (sequence=1, more={}) => ({schemaVersion:1,eventId:`fixture-event-${sequence}`,sequence,occurredAt:new Date(Date.now()-60000).toISOString(),type:'paper.execution.completed',accountId:'fixture-only',eventHash:'a'.repeat(64),...more});
async function openHome(page, options={}) {
  const reads=[], violations=[];
  await page.route('**/*', async route => {
    const request=route.request(),url=new URL(request.url());
    if(!['127.0.0.1','localhost','becs-fixture.test'].includes(url.hostname)||request.method()!=='GET') {violations.push(request.method()+' '+url.pathname);await route.abort();return;}
    const data={
      '/health':options.health??health(),
      '/api/paper/capabilities':{enabled:options.paper??true},
      '/api/superagent/capabilities':{enabled:options.report??false},
      '/api/auth/status':{authenticated:options.auth??false},
      '/api/paper/events':{events:options.events??[record(2),record(1)],nextBeforeSequence:null},
    };
    if(url.pathname==='/health'||url.pathname.startsWith('/api/')) {
      reads.push(url.pathname+url.search);
      if(!Object.hasOwn(data,url.pathname)) {violations.push(url.pathname);await route.abort();return;}
      if(url.pathname==='/api/paper/events') assert.equal(url.search,'?limit=5');
      if(url.pathname==='/api/paper/events'&&options.eventDelay) await options.eventDelay;
      try {await route.fulfill({status:options.status?.[url.pathname]??200,contentType:'application/json',body:JSON.stringify(data[url.pathname])});} catch(error) {if(!options.eventDelay) throw error;}
      return;
    }
    await route.fallback();
  });
  await page.goto('/home');
  await page.waitForFunction(()=>['Connected','Unverified'].includes(document.getElementById('connection').textContent));
  return {reads,violations};
}
async function showActivity(page) {
  await page.getByRole('button',{name:'Show recorded activity',exact:true}).click();
}

test('home has native controls, a preserved terminal link, and no private or provider reads on launch', async ({page}) => {
  const {reads,violations}=await openHome(page);
  assert.equal(await page.title(),'BECS · Home');
  assert.match(await page.locator('#answer-title').textContent(),/reachable/);
  assert.equal(await page.getByRole('link',{name:'Open terminal'}).getAttribute('href'),'/terminal');
  assert.deepEqual([...reads].sort(),['/api/paper/capabilities','/api/superagent/capabilities','/health'].sort());
  assert.equal(await page.locator('#execution').textContent(),'Reported disabled');
  assert.equal(await page.locator('#report-state').textContent(),'Disabled');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  for(const id of ['ask','refresh']) assert.ok((await page.locator('#'+id).boundingBox()).height>=44);
  assert.deepEqual(violations,[]);
});
test('typed usage and unsupported questions stay local; refreshes are bounded', async ({page}) => {
  const {reads,violations}=await openHome(page);
  await page.locator('#question').fill('What uses credits?');await page.locator('#ask').click();
  await page.waitForFunction(()=>document.getElementById('answer-title').textContent.includes('No AI'));
  assert.match(await page.locator('#answer-text').textContent(),/not verified/);
  await page.locator('#question').fill('Buy this token now');await page.locator('#ask').click();
  assert.match(await page.locator('#answer-title').textContent(),/Start with status/);
  await page.locator('#refresh').click();await page.locator('#refresh').click();
  assert.equal(reads.length,3);assert.deepEqual(violations,[]);
  assert.equal(await page.evaluate(()=>localStorage.length),0);
  assert.equal(await page.evaluate(()=>sessionStorage.length),0);
});
test('signed-out activity requests check the existing session but never fetch private events', async ({page}) => {
  const {reads}=await openHome(page);await showActivity(page);
  await page.locator('#sign-in').waitFor({state:'visible'});
  assert.equal(await page.locator('#sign-in').getAttribute('href'),'/api/auth/github');
  assert.equal(reads.filter(value=>value.startsWith('/api/paper/events')).length,0);
  assert.equal(await page.locator('#activity-list li').count(),0);
});
test('disabled server paper account never falls back to another wallet or journal', async ({page}) => {
  const {reads}=await openHome(page,{paper:false});await showActivity(page);
  assert.match(await page.locator('#answer-title').textContent(),/disabled/);
  assert.equal(reads.length,3);assert.equal(await page.locator('#sign-in').isVisible(),false);
});
test('owner activity renders source references as text and clears on offline', async ({page}) => {
  const malicious='<img src=x onerror=alert(1)>';
  const {reads,violations}=await openHome(page,{auth:true,events:[record(1,{type:malicious,eventId:malicious})]});
  await showActivity(page);await page.locator('#activity-list li').waitFor();
  assert.match(await page.locator('#activity-list').textContent(),/sequence 1/);
  assert.match(await page.locator('#activity-list').textContent(),/<img/);
  assert.equal(await page.locator('#activity-list img').count(),0);
  assert.ok(reads.includes('/api/paper/events?limit=5'));
  await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
  assert.equal(await page.locator('#activity-list li').count(),0);
  assert.equal(await page.locator('#activity-panel').isVisible(),false);
  assert.match(await page.locator('#answer-title').textContent(),/cleared/);
  assert.deepEqual(violations,[]);
});
test('private activity expires without an automatic re-fetch', async ({page}) => {
  await page.addInitScript(()=>{const native=window.setTimeout;window.setTimeout=(fn,ms,...args)=>native(fn,ms===60000?200:ms,...args);});
  const {reads}=await openHome(page,{auth:true});await showActivity(page);
  await page.locator('#activity-panel').waitFor({state:'visible'});
  await page.locator('#activity-panel').waitFor({state:'hidden'});
  assert.equal(await page.locator('#activity-list li').count(),0);
  assert.equal(reads.filter(value=>value.startsWith('/api/paper/events')).length,1);
});
test('late private responses cannot repopulate a hidden page', async ({page}) => {
  let release;const delay=new Promise(resolve=>{release=resolve;});
  const {reads}=await openHome(page,{auth:true,eventDelay:delay});
  const requested=page.waitForRequest(request=>request.url().includes('/api/paper/events'));
  await showActivity(page);await requested;
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  release();await page.waitForTimeout(80);
  assert.equal(await page.locator('#activity-list li').count(),0);
  assert.equal(await page.locator('#activity-panel').isVisible(),false);
  assert.equal(reads.filter(value=>value.startsWith('/api/paper/events')).length,1);
});
test('revoked auth and unavailable event reads never look like empty history', async ({page}) => {
  await openHome(page,{auth:true,status:{'/api/paper/events':401}});await showActivity(page);
  await page.locator('#sign-in').waitFor({state:'visible'});
  assert.equal(await page.locator('#activity-list li').count(),0);
});
test('unavailable health does not certify the service or execution; partial capabilities stay unknown', async ({page}) => {
  const {reads}=await openHome(page,{status:{'/health':503,'/api/superagent/capabilities':503}});
  assert.match(await page.locator('#answer-title').textContent(),/unavailable/);
  assert.equal(await page.locator('#execution').textContent(),'Unverified');
  assert.equal(await page.locator('#report-state').textContent(),'Unverified');
  assert.equal(reads.length,3);
});
test('stale source times remain stale when the page is refreshed', async ({page}) => {
  const old=new Date(Date.now()-3600000).toISOString();
  await openHome(page,{health:{...health(),lastScanAt:old}});
  await page.getByRole('button',{name:'What needs attention?',exact:true}).click();
  assert.match(await page.locator('#answer-title').textContent(),/Review the market feed/);
  assert.equal(await page.locator('#freshness').textContent(),'delayed');
  assert.ok((await page.locator('#scan-time').textContent()).includes(old.slice(11,19)));
});
