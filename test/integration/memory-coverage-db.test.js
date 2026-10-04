const test=require('node:test'),assert=require('node:assert/strict');
const {Client}=require('pg'),{randomUUID}=require('node:crypto');
const {createStore,streamForUser}=require('../../src/paper/store');
const {createPaperService}=require('../../src/paper/service');
const {memoryCoverage}=require('../../src/memory/coverage');
const {fixtureMarket,MINTS}=require('../fixtures/market');
const {createApp}=require('../../src/api/app');
const url=process.env.TEST_DATABASE_URL;
test('Memory report reads retained owner evidence consistently, reports absent projections, and enforces sessions',{skip:!url},async()=>{
  const admin=new Client({connectionString:url});await admin.connect();const schema='memory_'+randomUUID().replaceAll('-','');
  await admin.query('CREATE SCHEMA '+schema);const scoped=new URL(url);scoped.searchParams.set('options','-c search_path='+schema);
  const store=createStore(scoped.href),client=new Client({connectionString:scoped.href});let server;
  try{
    await client.connect();const empty=await memoryCoverage(client,'github:123');assert.equal(empty.source.status,'unavailable');
    await store.ensureAccount('github:123');await store.ensureAccount('github:other');
    const market=await fixtureMarket(),service=createPaperService({store,market});
    for(const user of ['github:123','github:other'])await service.command(user,{type:'buy',mint:MINTS[0],amount:1,automatic:false,feed:'recent',requestId:randomUUID(),createdAt:new Date().toISOString()});
    const report=await store.memoryReport('github:123');assert.equal(report.source.retained,3);assert.equal(report.source.verified,3);
    assert.equal(report.source.status,'verified');assert.equal(report.memory.status,'not_implemented');assert.equal(report.memory.coveragePercent,null);
    const partial=await memoryCoverage(client,'github:123',{maxEvents:1});assert.equal(partial.source.status,'partial');assert.equal(partial.source.complete,false);
    const sql=client.query.bind(client),queries=[];client.query=(s,a)=>{queries.push(s);return sql(s,a);};
    await memoryCoverage(client,'github:123');assert.ok(queries.every(s=>/^(SELECT|BEGIN|SET LOCAL|COMMIT|ROLLBACK)/.test(s)));client.query=sql;
    const token=await store.createSession('github:123'),other=await store.createSession('github:other');
    const app=createApp(market,{config:{enabled:true,ownerId:'123',origin:'https://becs.example'},store});
    server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
    for(const cookie of ['', '__Host-becs-session='+other])assert.equal((await fetch(base+'/api/memory/coverage',{headers:{Cookie:cookie}})).status,401);
    const headers={Cookie:'__Host-becs-session='+token};
    const exported=await fetch(base+'/api/memory/coverage/export',{headers});assert.equal(exported.status,200);
    assert.match(exported.headers.get('content-disposition'),/attachment/);assert.equal((await exported.json()).source.retained,3);
    assert.equal((await fetch(base+'/api/memory/coverage?owner=other',{headers})).status,400);
    await store.logout(token);assert.equal((await fetch(base+'/api/memory/coverage',{headers})).status,401);
    await client.query('UPDATE becs_event_streams SET head_hash=$2 WHERE stream_id=$1',[streamForUser('github:123'),'0'.repeat(64)]);
    assert.equal((await store.memoryReport('github:123')).source.status,'invalid');
  }finally{if(server)await new Promise(r=>server.close(r));await Promise.all([store.close(),client.end()]);await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}
});
