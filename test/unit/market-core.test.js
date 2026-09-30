const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp,createMarket}=require('../../src/basket');
const {createPriceHistory}=require('../../src/market/history');
const {createJupiterClient}=require('../../src/market/client');
const {rankSignals}=require('../../src/market/signals');
const SOL='So11111111111111111111111111111111111111112';
test('serialized Jupiter queue respects reset, recovers errors and rejects overflow',async()=>{
 let time=100000,active=0,max=0,calls=0;const starts=[];
 const request=createJupiterClient({apiKey:'fixture',now:()=>time,wait:async ms=>{time+=ms;},maxPending:2,
 fetchImpl:async()=>{starts.push(time);active++;max=Math.max(active,max);await Promise.resolve();active--;calls++;return {ok:calls!==1,status:calls===1?429:200,headers:{get:()=>105},json:async()=>({ok:true})};}});
 const a=request('/one'),b=request('/two');await assert.rejects(request('/overflow'),/busy/);await Promise.all([a,b]);
 assert.equal(max,1);assert.ok(starts[1]>=105250);assert.ok(starts[2]-starts[1]>=2200);
 let n=0;const failing=createJupiterClient({apiKey:'fixture',gapMs:0,fetchImpl:async()=>({ok:++n>1,status:500,json:async()=>({}),headers:{get:()=>null}})});
 await assert.rejects(failing('/bad'),/500/);assert.deepEqual(await failing('/good'),{});
});
