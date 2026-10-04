const test=require('node:test');
const assert=require('node:assert/strict');
const reader=import('../../src/web/assets/js/source-status.mjs');
const catalog=import('../../src/web/assets/js/source-catalog.mjs');
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8'}});

test('successful health, wallet and archive responses preserve their payloads',async()=>{
  const {readStatusResponse}=await reader;
  for(const [key,value] of [
    ['health',{ok:true,tradingEnabled:false,feeds:{}}],
    ['wallet',{enabled:false,providers:{}}],
    ['archive',{enabled:false,healthy:true}],
    ['archive',{enabled:true,healthy:true}]
  ])assert.deepEqual(await readStatusResponse(key,json(value)),value);
});
test('declared archive degradation remains a needs-attention report on HTTP 503',async()=>{
  const {readStatusResponse}=await reader;
  const {archiveLabel}=await catalog;
  const value={enabled:true,healthy:false};
  const report=await readStatusResponse('archive',json(value,503));
  assert.deepEqual(report,value);
  assert.equal(archiveLabel(report,true),'Archive capture needs attention');
});
test('503 is not accepted for market or wallet endpoints',async()=>{
  const {readStatusResponse}=await reader;
  await assert.rejects(readStatusResponse('health',json({ok:true,tradingEnabled:false,feeds:{}},503)));
  await assert.rejects(readStatusResponse('wallet',json({enabled:true,providers:{}},503)));
});
test('other HTTP failures never become archive health reports',async()=>{
  const {readStatusResponse}=await reader;
  for(const status of [401,403,429,500,502,504]) {
    await assert.rejects(readStatusResponse('archive',json({enabled:true,healthy:false},status)));
  }
});
test('a 503 archive response must explicitly declare enabled and unhealthy',async()=>{
  const {readStatusResponse}=await reader;
  for(const value of [null,[],{},{error:'Unavailable'},{enabled:true},{enabled:true,healthy:true},{enabled:false,healthy:false},{enabled:false,healthy:true},{enabled:'true',healthy:false}]) {
    await assert.rejects(readStatusResponse('archive',json(value,503)));
  }
});
test('successful HTTP status cannot make malformed or unknown payloads valid',async()=>{
  const {readStatusResponse}=await reader;
  for(const key of ['health','wallet','archive','unknown']) {
    await assert.rejects(readStatusResponse(key,json({})));
  }
});
test('HTML error pages cannot masquerade as archive reports',async()=>{
  const {readStatusResponse}=await reader;
  const response=new Response('<html>Unavailable</html>',{status:503,headers:{'Content-Type':'text/html'}});
  await assert.rejects(readStatusResponse('archive',response));
});
test('invalid JSON and interrupted bodies remain failures',async()=>{
  const {readStatusResponse}=await reader;
  await assert.rejects(readStatusResponse('archive',new Response('{',{status:503,headers:{'Content-Type':'application/json'}})));
  const response={ok:false,status:503,headers:new Headers({'Content-Type':'application/json'}),json:async()=>{throw Error('body interrupted');}};
  await assert.rejects(readStatusResponse('archive',response));
});
