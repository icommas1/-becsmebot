const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createApp}=require('../../src/api/app');
const {fixtureMarket}=require('../fixtures/market');

test('Slow memory reads are bounded without occupying paper command slots',async()=>{
  let sessions=0,commands=0,reads=0,release,allAuthenticated;
  const pending=new Promise(resolve=>{release=resolve;});
  const authenticated=new Promise(resolve=>{allAuthenticated=resolve;});
  const store={session:async()=>{if(++sessions===4)allAuthenticated();return 'github:123';},
    memoryReport:async()=>{reads++;await pending;throw Error('fixture unavailable');},
    command:async()=>{commands++;return {ok:true,message:'Fixture command accepted.'};}};
  const config={enabled:true,ownerId:'123',origin:'https://becs.example'};
  const server=createApp(await fixtureMarket(),{config,store}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port,headers={Cookie:'__Host-becs-session=fixture'};
  const requests=Array.from({length:4},()=>fetch(base+'/api/memory/coverage',{headers}));
  try{
    await authenticated;await new Promise(resolve=>setImmediate(resolve));
    const response=await fetch(base+'/api/paper/commands',{method:'POST',
      headers:{...headers,Origin:config.origin,'Content-Type':'application/json'},
      body:JSON.stringify({type:'settings',requestId:randomUUID(),createdAt:new Date().toISOString(),revision:0,settings:{betUsd:1}})});
    assert.equal(response.status,200);assert.equal((await response.json()).ok,true);assert.equal(commands,1);
    assert.equal(reads,1,'Only one owner memory read may run at a time');
  }finally{
    release();await Promise.all(requests);await new Promise(resolve=>server.close(resolve));
  }
});
