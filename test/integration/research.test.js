const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {mountResearchRoutes}=require('../../src/research/routes');
const {createResearchService}=require('../../src/research/service');
async function fixture(t,{enabled=true}={}){
  let calls=0;const app=express();app.use(express.json({limit:'20kb'}));
  const service=createResearchService({cooldownMs:0,search:async()=>{calls++;return {structuredContent:{results:[]}};}});
  const origin='https://becs.example.com';
  mountResearchRoutes(app,{config:{enabled,origin,ownerId:'owner'},store:{session:async token=>token==='valid'?'github:owner':'github:other'}},service);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(body={query:'public Solana documentation',providers:['exa','parallel']},headers={})=>fetch(base+'/api/research/query',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:'__Host-becs-session=valid',...headers},body:JSON.stringify(body)});
  return {base,post,calls:()=>calls};
}
test('research page and public capability status are available without provider calls',async t=>{
  const f=await fixture(t);const response=await fetch(f.base+'/research');assert.equal(response.status,200);assert.match(await response.text(),/Research only/);
  const status=await (await fetch(f.base+'/api/research/status')).json();assert.equal(status.catalog.length,8);assert.equal(status.executionEnabled,false);assert.equal(status.paidFallback,false);assert.equal(status.ownerSignInRequired,true);assert.equal(f.calls(),0);
});
test('private owner and same-origin checks happen before any external request',async t=>{
  const f=await fixture(t);
  assert.equal((await f.post(undefined,{Cookie:''})).status,401);
  assert.equal((await f.post(undefined,{Cookie:'__Host-becs-session=someone-else'})).status,401);
  assert.equal((await f.post(undefined,{Origin:'https://other.example.com'})).status,403);
  assert.equal((await f.post(undefined,{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal(f.calls(),0);
});
test('disabled private account cannot silently become public research proxy',async t=>{
  const f=await fixture(t,{enabled:false});assert.equal((await f.post()).status,503);assert.equal(f.calls(),0);
});
test('valid owner can query both readers but cannot request a URL, trade, or unknown reader',async t=>{
  const f=await fixture(t);
  assert.equal((await f.post({query:'public Solana docs',providers:['exa'],execute:true})).status,400);
  assert.equal((await f.post({query:'public Solana docs',providers:['github']})).status,400);
  const response=await f.post();assert.equal(response.status,200);const body=await response.json();
  assert.equal(body.providers.length,2);assert.equal(body.executionEnabled,false);assert.equal(body.documentCount,0);assert.equal(f.calls(),2);
});
