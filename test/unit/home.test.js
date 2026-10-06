const test = require('node:test');
const assert = require('node:assert/strict');
const modules = Promise.all([
  import('../../src/web/assets/js/home-model.mjs'),
  import('../../src/web/assets/js/home-api.mjs'),
]);
const now = Date.parse('2026-10-05T22:00:00.000Z');
const rawHealth = () => ({ok:true,tradingEnabled:false,manualSell:{enabled:false},lastScanAt:new Date(now-30000).toISOString(),lastError:null,running:false,release:{commit:'e'.repeat(40)}});
const event = (sequence=1, more={}) => ({schemaVersion:1,eventId:`fixture-${sequence}`,sequence,occurredAt:new Date(now-1000).toISOString(),type:'paper.execution.completed',accountId:'fixture-account',eventHash:'a'.repeat(64),payload:{secret:'must not enter view model'},...more});
const page = events => ({events,nextBeforeSequence:null});
const json = (value, options={}) => new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'},...options});

test('guided intents are local and unknown/trading requests are not executed', async () => {
  const [m] = await modules;
  for(const [q,want] of [['How is the bot doing?','status'],['What needs attention?','attention'],['Show recorded activity','activity'],['What uses credits?','usage'],['Buy this token','help'],['','help'],['x'.repeat(201),'help'],[null,'help']]) assert.equal(m.intentFor(q),want);
});
test('health accepts only the disabled execution contract and preserves source time', async () => {
  const [m]=await modules;const raw=rawHealth(),health=m.readHealth(raw);
  assert.equal(health.lastScanAt,raw.lastScanAt);assert.equal(health.commit,'e'.repeat(40));
  for(const bad of [{...raw,tradingEnabled:true},{...raw,manualSell:{enabled:true}},{...raw,ok:'true'},{...raw,running:null},{...raw,lastScanAt:'nonsense'},{...raw,lastError:{secret:'no'}}]) assert.throws(()=>m.readHealth(bad));
});
test('missing, delayed and future scans never become current data', async () => {
  const [m]=await modules,health=m.readHealth(rawHealth());
  assert.equal(m.scanState(null,now),'unavailable');
  assert.equal(m.scanState({...health,lastScanAt:null},now),'not recorded');
  assert.equal(m.scanState(health,now),'recent');
  assert.equal(m.scanState(health,now+m.HOME_LIMITS.scanFreshnessMs),'delayed');
  assert.equal(m.scanState({...health,lastScanAt:new Date(now+1).toISOString()},now),'clock mismatch');
  assert.equal(m.scanState({...health,hasError:true},now),'delayed');
});
test('capability and identity flags must be booleans', async () => {
  const [m]=await modules;
  assert.equal(m.readCapability({enabled:false}),false);assert.equal(m.readAuth({authenticated:true}),true);
  for(const v of [null,{},[],{enabled:'true'}]) assert.throws(()=>m.readCapability(v));
  for(const v of [null,{},[],{authenticated:1}]) assert.throws(()=>m.readAuth(v));
});
test('unavailable status is not certified online and cached health is not treated as current', async () => {
  const [m]=await modules;
  assert.match(m.answerFor('status',{health:m.readHealth(rawHealth()),connected:false},now).title,/unavailable/);
  assert.match(m.answerFor('attention',{health:m.readHealth(rawHealth()),connected:true,paper:true,report:false},now).title,/not enabled/);
  assert.match(m.answerFor('usage').text,/not verified/);
});
test('event summaries preserve references, discard payloads and never infer fills or profit', async () => {
  const [m]=await modules;const result=m.readEvents(page([event(2),event(1)]));
  assert.equal(result[0].label,'Paper execution recorded');assert.equal(result[0].eventId,'fixture-2');
  assert.equal(result[0].eventHash,'a'.repeat(64));assert.equal(result[0].payload,undefined);assert.equal(result[0].accountId,undefined);
  assert.equal(result[0].occurredAt,new Date(now-1000).toISOString());
  assert.equal(m.readEvents(page([event(1,{type:'__proto__'})]))[0].label,'Recorded paper event');
  assert.deepEqual(m.readEvents(page([])),[]);
});
test('oversized, duplicate, misordered, cross-account and malformed event pages fail closed', async () => {
  const [m]=await modules;
  const invalid=[page(Array.from({length:6},(_,i)=>event(6-i))),page([event(1),event(1)]),page([event(1),event(2)]),page([event(2),event(1,{accountId:'another'})]),page([event(1,{eventHash:'bogus'})]),page([event(1,{schemaVersion:2})]),page([event(1,{occurredAt:'invalid'})]),page([event(1,{eventId:''})]),page([event(1,{sequence:1.5})]),{events:[]}];
  for(const value of invalid) assert.throws(()=>m.readEvents(value));
});
test('home transport permits only fixed same-origin GETs with no-store, no redirects and no caller payload', async () => {
  const [m,a]=await modules;let captured;
  const result=await a.readHomeJson(m.HOME_READS.health,undefined,async (...args)=>{captured=args;return json({ok:true});});
  assert.deepEqual(result,{ok:true});assert.equal(captured[0],'/health');
  assert.equal(captured[1].method,'GET');assert.equal(captured[1].cache,'no-store');assert.equal(captured[1].credentials,'same-origin');assert.equal(captured[1].redirect,'error');assert.equal(captured[1].body,undefined);
  let called=false;for(const path of ['/api/paper/commands','/api/search?q=token','https://provider.invalid','/api/paper/events?limit=100','/api/paper/events?limit=5&owner=other']) await assert.rejects(a.readHomeJson(path,undefined,()=>{called=true;}));
  assert.equal(called,false);
});
test('HTTP failures stay sanitized and preserve status without reading provider bodies', async () => {
  const [m,a]=await modules;
  for(const status of [401,403,429,503]) await assert.rejects(a.readHomeJson(m.HOME_READS.auth,undefined,async()=>json({error:'secret upstream body'},{status})),error=>error.status===status&&!error.message.includes('secret'));
});
test('invalid content type, malformed JSON and excessive content-length fail closed', async () => {
  const [m,a]=await modules;
  for(const response of [new Response('HTML',{headers:{'Content-Type':'text/html'}}),new Response('{bad',{headers:{'Content-Type':'application/json'}}),new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':String(m.HOME_LIMITS.responseBytes+1)}})]) await assert.rejects(a.readHomeJson(m.HOME_READS.health,undefined,async()=>response));
});
test('chunked response bytes are bounded even without content-length', async () => {
  const [m,a]=await modules;
  const response=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"x":"1234567890"}'));c.close();}}),{headers:{'Content-Type':'application/json'}});
  await assert.rejects(a.readHomeJson(m.HOME_READS.health,undefined,async()=>response,{...m.HOME_LIMITS,responseBytes:8}));
});
test('aborted requests never start network access', async () => {
  const [m,a]=await modules;const controller=new AbortController();controller.abort();let called=false;
  await assert.rejects(a.readHomeJson(m.HOME_READS.health,controller.signal,()=>{called=true;}));assert.equal(called,false);
});
test('timeout covers stalled response bodies, not just headers', async () => {
  const [m,a]=await modules;let cancelled=false;
  const response=new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'Content-Type':'application/json'}});
  await assert.rejects(a.readHomeJson(m.HOME_READS.health,undefined,async()=>response,{...m.HOME_LIMITS,requestTimeoutMs:20}));
  assert.equal(cancelled,true);
});
test('lifecycle cancellation releases a stalled fetch without retry', async () => {
  const [m,a]=await modules;const controller=new AbortController();let calls=0;
  const promise=a.readHomeJson(m.HOME_READS.auth,controller.signal,()=>{calls++;return new Promise(()=>{});});
  controller.abort();await assert.rejects(promise);assert.equal(calls,1);
});
