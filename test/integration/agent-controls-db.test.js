const test=require('node:test'),assert=require('node:assert/strict');
const {Client}=require('pg'),{randomUUID,generateKeyPairSync,sign}=require('node:crypto');
const {digest,canonical}=require('../../src/events/becs-event');
const {policy,verifierHash}=require('../../src/agent/config');
const {createAgentRegistry}=require('../../src/agent/store');
const {createStore}=require('../../src/paper/store');
const {createApp}=require('../../src/api/app');
const {fixtureMarket}=require('../fixtures/market');
const url=process.env.TEST_DATABASE_URL;
test('Registry uses owner sessions, signed results, persistent budgets and atomic one-use promotion',{skip:!url},async()=>{
  const admin=new Client({connectionString:url});await admin.connect();const schema='agent_'+randomUUID().replaceAll('-','');await admin.query('CREATE SCHEMA '+schema);
  const scoped=new URL(url);scoped.searchParams.set('options','-c search_path='+schema);
  const keys=generateKeyPairSync('ed25519'),config={enabled:true,databaseUrl:scoped.href,owner:'github:123',policy,policyHash:digest(policy),
    verifierHash:verifierHash(),image:'node:24-alpine@sha256:'+'a'.repeat(64),publicKey:keys.publicKey};
  let registry=createAgentRegistry(config),server;const paper=createStore(scoped.href),client=new Client({connectionString:scoped.href});
  const signed=(reservation,overrides={})=>{const report={version:1,evaluationId:reservation.evaluationId,bundleHash:reservation.bundleHash,nonce:reservation.nonce,
    policyHash:config.policyHash,verifierHash:config.verifierHash,image:config.image,completedAt:Date.now(),isolationVerified:true,total:policy.cases.length,passed:policy.cases.length,...overrides};
    return {report,signature:sign(null,Buffer.from(JSON.stringify(canonical(report))),keys.privateKey).toString('base64')};};
  try{
    await client.connect();await paper.ensureAccount(config.owner);await paper.ensureAccount('github:other');
    const token=await paper.createSession(config.owner),other=await paper.createSession('github:other');
    const app=createApp(await fixtureMarket(),{config:{enabled:true,ownerId:'123',origin:'https://becs.example'},store:paper,agentTools:registry});
    server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+'/api/agent/tools';
    const post=(path,body,cookie=token,origin='https://becs.example')=>fetch(base+path,{method:'POST',headers:{Cookie:'__Host-becs-session='+cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await post('',{name:'fixture',code:'//candidate'},other)).status,401);
    assert.equal((await post('',{name:'fixture',code:'//candidate'},token,'https://other.example')).status,403);
    assert.equal((await post('',{name:'fixture',code:'//candidate',permissions:['live']})).status,400);
    const creation=await post('',{name:'fixture',code:'//candidate'});assert.equal(creation.status,200);const {bundleHash}=await creation.json();
    await assert.rejects(registry.reserve('github:other',bundleHash),{status:403});
    const reservation=await registry.reserve(config.owner,bundleHash),valid=signed(reservation),tampered=structuredClone(valid);tampered.report.passed=0;
    await assert.rejects(registry.attest(config.owner,bundleHash,tampered),{status:403});
    assert.equal((await registry.attest(config.owner,bundleHash,valid)).status,'passed');
    await assert.rejects(registry.attest(config.owner,bundleHash,valid),{status:409});
    const approval=await registry.approve(config.owner,bundleHash,reservation.evaluationId);
    await assert.rejects(registry.approve(config.owner,bundleHash,reservation.evaluationId),{status:409});
    const racing=await Promise.allSettled([registry.promote(config.owner,bundleHash,approval),registry.promote(config.owner,bundleHash,approval)]);
    assert.equal(racing.filter(r=>r.status==='fulfilled').length,1);assert.equal(racing.find(r=>r.status==='fulfilled').value.executionEnabled,false);
    await registry.close();registry=createAgentRegistry(config);
    await assert.rejects(registry.promote(config.owner,bundleHash,approval),{status:409});
    const second=await registry.register(config.owner,{name:'budget',code:'//candidate2'});
    const reservations=await Promise.allSettled(Array.from({length:5},()=>registry.reserve(config.owner,second.bundleHash)));
    assert.equal(reservations.filter(r=>r.status==='fulfilled').length,policy.maxAttemptsPerCandidate);
    await registry.close();registry=createAgentRegistry(config);
    await assert.rejects(registry.reserve(config.owner,second.bundleHash),{status:409});
    const one=reservations.find(r=>r.status==='fulfilled').value;
    assert.equal((await registry.attest(config.owner,second.bundleHash,signed(one,{isolationVerified:false}))).status,'failed');
    await assert.rejects(registry.approve(config.owner,second.bundleHash,one.evaluationId),{status:409});
    const third=await registry.register(config.owner,{name:'expiry',code:'//candidate3'}),expired=await registry.reserve(config.owner,third.bundleHash);
    await client.query('UPDATE agent_evaluations SET expires_at=0 WHERE evaluation_id=$1',[expired.evaluationId]);
    await assert.rejects(registry.attest(config.owner,third.bundleHash,signed(expired)),{status:409});
    await client.query('UPDATE agent_daily_budgets SET used=$1',[policy.maxEvaluationsPerDay]);
    await assert.rejects(registry.reserve(config.owner,third.bundleHash),{status:409});
    assert.equal((await registry.inspect(config.owner,third.bundleHash)).attempts,1,'failed reservation rolls back candidate count');
    const updated=createAgentRegistry({...config,verifierHash:'b'.repeat(64)});
    try{
      assert.equal((await updated.inspect(config.owner,bundleHash)).status,'reviewed','old registry evidence remains auditable after policy update');
      await assert.rejects(updated.reserve(config.owner,third.bundleHash),{status:409});
    }finally{await updated.close();}
    await assert.rejects(client.query('DELETE FROM agent_audit'));
    await paper.logout(token);assert.equal((await post('',{name:'revoked',code:'//candidate'})).status,401);
  }finally{if(server)await new Promise(r=>server.close(r));await Promise.all([registry.close(),paper.close(),client.end()]);await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}
});
