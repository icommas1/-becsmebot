const test=require("node:test"),assert=require("node:assert/strict");
const {isValid,assertSchema}=require("../../src/api/validation");
const {rankSignals}=require("../../src/market/signals");
const {SOL}=require("../fixtures/market");
test("strict price request rejects unknown fields, invalid mints and oversized batches",()=>{
  assert.ok(isValid("priceRequest",{mints:[SOL]}));
  assert.ok(isValid("priceRequest",{mints:[]}));
  for(const body of [{mints:[SOL],walletKey:"never"},{mints:"SOL"},{mints:[123]},{mints:["invalid"]},{mints:Array(101).fill(SOL)},null])assert.equal(isValid("priceRequest",body),false);
  assert.equal(isValid("searchQuery","x"),false);
  assert.equal(isValid("searchQuery","x".repeat(81)),false);
});
test("price contracts preserve omitted marks and reject impossible numbers",()=>{
  assert.ok(isValid("upstreamPrices",{}));
  assert.ok(isValid("priceResponse",{prices:{[SOL]:null}}));
  for(const price of [NaN,Infinity,0,-1,"1"])
    assert.equal(isValid("priceResponse",{prices:{[SOL]:{priceUsd:price,observedAt:Date.now()}}}),false);
  assert.throws(()=>assertSchema("upstreamTokens",{tokens:[]}),/Invalid upstreamTokens/);
  assert.equal(isValid("upstreamTokens",[{id:SOL,usdPrice:true}]),false);
  assert.equal(isValid("upstreamTokens",[{id:SOL,usdPrice:"NaN"}]),false);
  assert.ok(isValid("upstreamTokens",[{id:SOL,usdPrice:"2.5",newProviderField:{x:1}}]));
});
test("signals ignore corrupt and future baselines and preserve the older mark timestamp",()=>{
  const now=Date.now(),rows=[{mint:SOL,priceUsd:6,observedAt:now-1000}];
  const trails={[SOL]:[[now+60000,.1],[now-1000,3],[now-2000,2],[now-3000,0],[now-4000,NaN],null]};
  const [s]=rankSignals(rows,trails);
  assert.equal(s.multiple,3);assert.equal(s.peakMultiple,1.5);assert.equal(s.firstSeenAt,now-2000);assert.equal(s.observedAt,now-1000);
  assert.deepEqual(rankSignals([{...rows[0],observedAt:now+60000}],trails),[]);
  assert.deepEqual(rankSignals(rows,{[SOL]:[[now,0]]}),[]);
});
