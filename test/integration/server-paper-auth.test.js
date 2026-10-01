const test=require("node:test"),assert=require("node:assert/strict");
const {createApp}=require("../../src/api/app");
const {fixtureMarket}=require("../fixtures/market");
test("GitHub flow requires state+cookie, one-use PKCE and the configured owner; writes require session and origin",async()=>{
  const config={enabled:true,origin:"https://becs.example",clientId:"fixture",ownerId:"123"};
  let allowed=true,created=0,verifierSeen=null;
  const flows=new Map(),sessions=new Map();
  const token="a".repeat(43);
  const store={flow:async(s,v)=>flows.set(s,v),consumeFlow:async s=>{const v=flows.get(s);flows.delete(s);return v;},
    ensureAccount:async id=>{assert.equal(id,"github:123");created++;},createSession:async id=>{sessions.set(token,id);return token;},
    session:async t=>sessions.get(t)||null,logout:async t=>sessions.delete(t),read:async id=>({owner:id}),
    command:async()=>{throw Error("invalid or unauthorized commands must not execute");}};
  const app=createApp(await fixtureMarket(),{config,store,identity:async(_config,_code,verifier)=>{verifierSeen=verifier;return allowed?"123":"456";}});
  const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));
  const base="http://127.0.0.1:"+server.address().port;
  const call=(path,options={})=>fetch(base+path,{redirect:"manual",...options});
  const body={method:"POST",headers:{"Content-Type":"application/json",Origin:config.origin},body:"{}"};
  async function start(){const response=await call("/api/auth/github");assert.equal(response.status,302);const url=new URL(response.headers.get("location"));
    assert.equal(url.origin,"https://github.com");assert.equal(url.searchParams.get("code_challenge_method"),"S256");assert.equal(url.searchParams.has("scope"),false);
    assert.match(response.headers.get("set-cookie"),/HttpOnly; Secure; SameSite=Lax/);
    return {state:url.searchParams.get("state"),cookie:response.headers.get("set-cookie").split(";")[0]};}
  try{
    assert.equal((await call("/api/paper/account")).status,401);
    assert.equal((await call("/api/paper/commands",body)).status,401);
    let flow=await start();
    assert.equal((await call("/api/auth/github/callback?state="+flow.state+"&code=fixture")).status,400);
    let callback=await call("/api/auth/github/callback?state="+flow.state+"&code=fixture",{headers:{Cookie:flow.cookie}});
    assert.equal(callback.status,302);assert.equal(callback.headers.get("location"),"/terminal");assert.equal(verifierSeen.length,43);assert.equal(created,1);
    const cookie="__Host-becs-session="+token;
    assert.equal((await call("/api/auth/github/callback?state="+flow.state+"&code=fixture",{headers:{Cookie:flow.cookie}})).status,400);
    assert.deepEqual(await (await call("/api/auth/status",{headers:{Cookie:cookie}})).json(),{authenticated:true});
    assert.deepEqual(await (await call("/api/paper/account",{headers:{Cookie:cookie}})).json(),{owner:"github:123"});
    assert.equal((await call("/api/paper/commands",{...body,headers:{...body.headers,Cookie:cookie,Origin:"https://evil.example"}})).status,403);
    assert.equal((await call("/api/paper/commands",{...body,headers:{"Content-Type":"application/json",Cookie:cookie}})).status,403);
    assert.equal((await call("/api/paper/commands",{...body,headers:{...body.headers,Cookie:cookie},body:JSON.stringify({executionMode:"live"})})).status,400);
    assert.equal((await call("/api/sell/quote",body)).status,410);
    assert.equal((await call("/api/auth/logout",{method:"POST",headers:{Cookie:cookie,Origin:config.origin}})).status,200);
    assert.equal((await call("/api/paper/account",{headers:{Cookie:cookie}})).status,401);
    allowed=false;flow=await start();
    assert.equal((await call("/api/auth/github/callback?state="+flow.state+"&code=fixture",{headers:{Cookie:flow.cookie}})).status,403);
    assert.equal(created,1);
  }finally{await new Promise(r=>server.close(r));}
});
