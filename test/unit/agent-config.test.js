const test=require('node:test'),assert=require('node:assert/strict');
const {generateKeyPairSync}=require('node:crypto');
const {agentConfig}=require('../../src/agent/config');
test('Agent tools default off and enabled mode requires owner auth, pinned image and a separate evaluator key',()=>{
  assert.deepEqual(agentConfig({},{}),{enabled:false});
  assert.throws(()=>agentConfig({AGENT_TOOLS_ENABLED:'true'},{enabled:false}));
  const accounts={enabled:true,databaseUrl:'fixture',ownerId:'123'};
  assert.throws(()=>agentConfig({AGENT_TOOLS_ENABLED:'true'},accounts));
  const {publicKey}=generateKeyPairSync('ed25519');
  const env={AGENT_TOOLS_ENABLED:'true',AGENT_EVALUATOR_IMAGE:'node:24-alpine@sha256:'+'a'.repeat(64),AGENT_EVALUATOR_PUBLIC_KEY:publicKey.export({type:'spki',format:'pem'})};
  const config=agentConfig(env,accounts);assert.equal(config.enabled,true);assert.equal(config.owner,'github:123');
  assert.throws(()=>agentConfig({...env,AGENT_EVALUATOR_IMAGE:'node:24-alpine'},accounts));
});
