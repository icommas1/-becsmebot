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
      documentElement: {style:{setProperty() {}}}, body:{dataset:{}}
    },
    localStorage: {getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    sessionStorage: {getItem:()=>null,setItem() {},removeItem() {}},
    fetch() { throw Error("paper operations must not send requests"); },
    console, Date, Math, Number, String, JSON, Intl, Set, Object, Array, Error,
    setTimeout:()=>0, clearTimeout() {},
    confirm:()=>true
  });
  vm.runInContext(script,context);
  await vm.runInContext("refresh()",context);
  assert.equal(elements.get("auth-gate").hidden,false);
  const mint="So11111111111111111111111111111111111111112";
  vm.runInContext(`sampleRadar({lastScanAt:new Date(Date.now()-300000).toISOString(),radar:[{mint:"${mint}",priceUsd:.009}]});sampleRadar({lastScanAt:new Date().toISOString(),radar:[{mint:"${mint}",priceUsd:.01}]});`,context);
  assert.equal(vm.runInContext(`trail.points["${mint}"].length`,context),2);
  assert.equal(vm.runInContext(`sparkline("${mint}").children[0].children[0].tagName`,context),"polyline");
  vm.runInContext(`snapshot={solUsd:200,candidates:[{mint:"${mint}"}],radar:[{mint:"${mint}",symbol:"TEST",priceUsd:.01,sources:["5m"]}]};buy(snapshot.radar[0]);`,context);
  assert.equal(vm.runInContext("paper.cashSol",context),.4-(1/200+.000005));
  assert.equal(vm.runInContext(`paper.holds["${mint}"].qty`,context),100);
  vm.runInContext("snapshot.radar=[];render();",context);
  assert.equal(elements.get("paper-holds").children.length,1);
  vm.runInContext(`buy({mint:"${mint}",symbol:"TEST",priceUsd:.01});`,context);
  assert.equal(vm.runInContext("Object.keys(paper.holds).length",context),1);
  vm.runInContext(`prices["${mint}"]={priceUsd:.02};sellPaper("${mint}",100);`,context);
  assert.equal(vm.runInContext("Object.keys(paper.holds).length",context),0);
  assert.equal(vm.runInContext(`paper.bought["${mint}"]`,context),true);
  assert.ok(vm.runInContext("paper.realizedUsd",context)>0);
  assert.ok(storage.get("becsPaperV1").includes("TEST"));
});
