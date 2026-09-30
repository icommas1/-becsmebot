const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function element(tag) {
  return { tagName:tag, value:"", textContent:"", className:"", children:[], dataset:{},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children=children; },
    addEventListener() {}, setAttribute() {} };
}

test("paper buys use SOL cash, survive radar exit, and sell without a live request", async () => {
  const html = fs.readFileSync(require.resolve("../src/dashboard.html"), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/render\(\);refresh\(\);setInterval\(refresh,10000\);\s*$/, "");
  const elements = new Map(), storage = new Map();
  const context = vm.createContext({
    document: {
      getElementById(id) { if (!elements.has(id)) elements.set(id,element()); return elements.get(id); },
      createElement: element, createElementNS: (_namespace,tag) => element(tag), querySelectorAll: () => [],
      documentElement: {style:{setProperty() {}}}, body:{dataset:{}}, addEventListener() {}
    },
    localStorage: {getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    sessionStorage: {getItem:()=>null,setItem() {},removeItem() {}},
    fetch() { throw Error("paper operations must not send requests"); },
    console, Date, Math, Number, String, JSON, Intl, Set, Object, Array, Error,
    setTimeout:()=>0, clearTimeout() {},
    confirm:()=>true
  });
  vm.runInContext(script,context);
  const mint="So11111111111111111111111111111111111111112";
  vm.runInContext("paper.settings.minOrganicScore=70",context);
  assert.equal(vm.runInContext("passes({organicScore:65})",context),false);
  assert.equal(vm.runInContext("passes({organicScore:75})",context),true);
  vm.runInContext("paper.settings.minOrganicScore=0",context);
  vm.runInContext(`sampleRadar({lastScanAt:new Date(Date.now()-300000).toISOString(),radar:[{mint:"${mint}",priceUsd:.009}]});sampleRadar({lastScanAt:new Date().toISOString(),radar:[{mint:"${mint}",priceUsd:.01}]});`,context);
  assert.equal(vm.runInContext(`trail.points["${mint}"].length`,context),2);
  assert.equal(vm.runInContext(`sparkline("${mint}").children[0].children[0].tagName`,context),"polyline");
  vm.runInContext(`snapshot={solUsd:200,solPriceAt:Date.now(),radar:[{mint:"${mint}",symbol:"TEST",name:"Test",priceUsd:.01,observedAt:Date.now(),feeds:["trending:5m"],ranks:{"trending:5m":1}}]};buy(snapshot.radar[0]);`,context);
  assert.equal(elements.get("radar").children.length,1);
  assert.equal(vm.runInContext("paperReady({priceUsd:1,observedAt:Date.now()-180001})",context),false);
  vm.runInContext("paper.settings.maxCap=100",context);
  assert.equal(vm.runInContext("passes({marketCap:null})",context),false);
  vm.runInContext("paper.settings.maxCap=0",context);
  assert.equal(vm.runInContext('paperReady({priceUsd:.01,isSus:true})',context),false);
  assert.equal(vm.runInContext("paper.cashSol",context),.4-(1/200+.000005));
  assert.equal(vm.runInContext(`paper.holds["${mint}"].qty`,context),100);
  vm.runInContext("snapshot.radar=[];render();",context);
  assert.equal(elements.get("paper-holds").children.length,1);
  vm.runInContext(`buy({mint:"${mint}",symbol:"TEST",priceUsd:.01});`,context);
  assert.equal(vm.runInContext("Object.keys(paper.holds).length",context),1);
  vm.runInContext(`delete prices["${mint}"];delete priceTimes["${mint}"];sellPaper("${mint}",100);`,context);
  assert.equal(vm.runInContext("Object.keys(paper.holds).length",context),1);
  vm.runInContext(`prices["${mint}"]={priceUsd:.02,source:"jupiter-v3"};priceTimes["${mint}"]=Date.now();sellPaper("${mint}",100,1);`,context);
  assert.equal(vm.runInContext(`paper.holds["${mint}"].qty`,context),50);
  vm.runInContext(`sellPaper("${mint}",100);`,context);
  assert.equal(vm.runInContext("Object.keys(paper.holds).length",context),0);
  assert.equal(vm.runInContext(`Boolean(paper.bought["${mint}"])`,context),true);
  assert.ok(vm.runInContext("paper.realizedUsd",context)>0);
  assert.ok(storage.get("becsPaperV1").includes("TEST"));
  // Automatic orders share dollar accounting and buy-once behavior.
  vm.runInContext(`paper=fresh();paper.auto=true;runAutoBuys();`,context);
  vm.runInContext(`snapshot.radar=[{mint:"${mint}",symbol:"TEST",name:"Test",priceUsd:.01,observedAt:Date.now(),feeds:["trending:5m"]}];runAutoBuys();runAutoBuys();`,context);
  assert.equal(vm.runInContext("paper.activity.length",context),1);
  assert.equal(vm.runInContext(`paper.holds["${mint}"].qty`,context),100);
  vm.runInContext(`paper.settings.exitMultiple=2;prices["${mint}"]={priceUsd:.02,source:"jupiter-v3"};priceTimes["${mint}"]=Date.now();runAutoExits();runAutoExits();`,context);
  assert.equal(vm.runInContext(`paper.holds["${mint}"].qty`,context),50);
  assert.equal(vm.runInContext("paper.activity.length",context),2);
  // Every hold gets refreshed, including those beyond the first hundred.
  context.batches=[];
  context.fetch=async(_url,request)=>{const mints=JSON.parse(request.body).mints;context.batches.push(mints.length);return {ok:true,json:async()=>({prices:Object.fromEntries(mints.map(m=>[m,{priceUsd:.01,observedAt:Date.now()}]))})};};
  vm.runInContext('paper=fresh();for(let i=0;i<205;i++)paper.holds["mint"+i]={mint:"mint"+i,symbol:"T",qty:1,entryPrice:.01,investedUsd:.01,feesUsd:0};',context);
  await vm.runInContext('refreshPrices(true)',context);
  assert.deepEqual(context.batches,[100,100,5]);
  assert.equal(vm.runInContext('prices.mint204.source',context),'jupiter-v3');
});
