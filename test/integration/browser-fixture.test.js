const test=require("node:test"),assert=require("node:assert/strict");
const {browserFixtureApp}=require("../fixtures/browser-app");
const {fixtureMarket}=require("../fixtures/market");
test("browser contexts receive independent fixture scans without refreshing previously stale marks or ETags",async()=>{
  const markets=[];
  const app=await browserFixtureApp({maxContexts:2,marketFactory:async()=>{const market=await fixtureMarket();markets.push(market);return market;}});
  const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));
  const base="http://127.0.0.1:"+server.address().port;
  const start=async()=>{const response=await fetch(base+"/terminal");assert.equal(response.status,200);return response.headers.get("set-cookie").split(";")[0];};
  const basket=cookie=>fetch(base+"/api/basket",{headers:{Cookie:cookie}});
  try{
    const first=await start(),old=Date.now()-181000;
    markets[1].snapshot().radar.forEach(row=>{row.observedAt=old;});
    assert.equal((await (await basket(first)).json()).radar[0].observedAt,old);
    const second=await start();assert.notEqual(first,second);
    const response=await basket(second),fresh=await response.json();assert.ok(Date.now()-fresh.radar[0].observedAt<180000);
    const unchanged=await fetch(base+"/api/basket",{headers:{Cookie:second,"If-None-Match":response.headers.get("etag")}});
    assert.equal(unchanged.status,304,"another browser's launch cannot invalidate this context's snapshot");
    assert.equal((await (await basket(first)).json()).radar[0].observedAt,old,"the old observation stays old");
    assert.equal((await fetch(base+"/terminal")).status,503,"fixture contexts stay bounded without silently replacing history");
    assert.equal(markets.length,3);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
