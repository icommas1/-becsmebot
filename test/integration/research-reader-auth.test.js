const test=require("node:test"),assert=require("node:assert/strict");
const {createApp}=require("../../src/api/app"),{fixtureMarket}=require("../fixtures/market");

test("research reads require the configured owner session and cannot select another stream/account",{timeout:10000},async()=>{
  const config={enabled:true,origin:"https://becs.example",ownerId:"123"};
  const tokens={owner:"a".repeat(43),other:"b".repeat(43)},sessions=new Map([[tokens.owner,"github:123"],[tokens.other,"github:456"]]);
  const store={session:async token=>sessions.get(token)||null};
  const record={recordId:"1".repeat(8)+"-"+"1".repeat(4)+"-"+"1".repeat(4)+"-"+"1".repeat(4)+"-"+"1".repeat(12),
    streamId:"configured-stream",sequence:1,kind:"wallet-intel.scan",source:"wallet-intel",occurredAt:1,capturedAt:2,
    payloadHash:"a".repeat(64),recordHash:"b".repeat(64),previousHash:null,metadata:{}};
  let reads=0,release=null,began;
  const blocked=new Promise(resolve=>{began=resolve;});
  const archive={listRecords:async args=>{reads++;assert.deepEqual(args,{limit:1,beforeSequence:2});return {records:[record],nextBeforeSequence:1};},
    readRecord:async sequence=>{reads++;if(sequence===2)return null;if(sequence===3)return new Promise(resolve=>{release=()=>resolve({record,payload:{wallet:"private-fixture"}});began();});return {record,payload:{wallet:"private-fixture"}};}};
  const server=createApp(await fixtureMarket(),{config,store,archive}).listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  const base="http://127.0.0.1:"+server.address().port,call=(path,token)=>fetch(base+path,{headers:token?{Cookie:"__Host-becs-session="+token}:{}});
  try{
    for(const route of ["/api/research/records","/api/research/records/1"]){
      assert.equal((await call(route)).status,401);assert.equal((await call(route,tokens.other)).status,401);
    }
    assert.equal(reads,0);
    let response=await call("/api/research/records?limit=1&before=2&stream=other&account=other",tokens.owner);
    assert.equal(response.status,200);assert.deepEqual((await response.json()).records,[record]);
    response=await call("/api/research/records/1",tokens.owner);assert.equal(response.status,200);
    assert.equal((await response.json()).payload.wallet,"private-fixture");
    assert.equal((await call("/api/research/records/2",tokens.owner)).status,404);
    for(const route of ["/api/research/records?limit=101","/api/research/records?before=-1","/api/research/records/0","/api/research/records/not-a-number"])
      assert.equal((await call(route,tokens.owner)).status,400);
    const pending=call("/api/research/records/3",tokens.owner);
    await blocked;
    assert.ok(release);assert.equal((await call("/api/research/records/1",tokens.owner)).status,503);
    release();assert.equal((await pending).status,200);
    sessions.delete(tokens.owner);assert.equal((await call("/api/research/records/1",tokens.owner)).status,401);
  }finally{release?.();await new Promise(resolve=>server.close(resolve));}
});
