const test=require("node:test");
const assert=require("node:assert/strict");

test("paper performance counts only recorded sale returns, including partial exits",async()=>{
  const {recordedSales,saleSummary}=await import("../../src/web/assets/js/paper-performance.mjs");
  const activity=[
    {kind:"sell",source:"manual",basisUsd:2,netUsd:3,realizedUsd:1,entryCap:300000},
    {kind:"sell",source:"auto target",basisUsd:1,netUsd:.5,realizedUsd:-.5,entryCap:null},
    {kind:"sell",source:"manual",sizeUsd:2}, // An older sale has no basis.
    {kind:"buy",source:"manual",basisUsd:1,netUsd:10,realizedUsd:9},
    {kind:"sell",source:"manual",basisUsd:0,netUsd:1,realizedUsd:1}
  ];
  const all=recordedSales(activity);
  assert.equal(all.length,2);
  assert.deepEqual(saleSummary(all),{count:2,realized:.5,winRate:50,medianReturn:0});
  assert.equal(saleSummary(recordedSales(activity,"manual")).medianReturn,50);
  assert.equal(saleSummary(recordedSales(activity,"auto")).medianReturn,-50);
  assert.deepEqual(saleSummary([]),{count:0,realized:0,winRate:null,medianReturn:null});
});
