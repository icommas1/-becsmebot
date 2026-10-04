const test=require("node:test"),assert=require("node:assert/strict");
const {runtimeEvidence}=require("../../src/archive/runtime-evidence");
const {digest}=require("../../src/events/becs-event");
const settings={marketScanMs:60000,walletIntelEnabled:false,walletIntelScanMs:60000,paperAccountsEnabled:true,streamId:"research-test"};

test("runtime evidence captures exact defaults and code without serializing secrets",async()=>{
  const env={RAILWAY_GIT_COMMIT_SHA:"a".repeat(40),DATABASE_URL:"private-database",JUPITER_API_KEY:"private-key",
    GITHUB_CLIENT_SECRET:"oauth-secret",PAPER_GITHUB_USER_ID:"private-owner",NANSEN_API_KEY:"provider-secret"};
  const result=await runtimeEvidence({...settings,env}),{paperDefaults}=await import("../../src/web/assets/js/paper-wallet.mjs");
  assert.deepEqual(result.payload.configuration.paperDefaults,paperDefaults);
  assert.deepEqual(result.payload.configuration.strategy,{id:"launch-v1",version:"1"});
  assert.equal(result.payload.build.commit,env.RAILWAY_GIT_COMMIT_SHA);
  assert.equal(result.payload.configuration.marketFeeds.jupiter.length,13);
  assert.equal(result.payload.configuration.marketFeeds.dexscreener.length,6);
  assert.equal(result.payload.configuration.agentTools.enabled,false);
  assert.ok(result.payload.build.sources['src/agent/store.js']);
  assert.ok(result.payload.build.sources['scripts/agent-runner.py']);
  assert.ok(result.payload.build.sources['src/superagent/report.js']);
  assert.equal(result.payload.configuration.superagentReport.enabled,false);
  assert.equal(result.payload.configuration.research.executionEnabled,false);
  assert.equal(result.reference.evidenceHash,digest(result.payload));
  assert.equal(result.reference.configurationHash,digest(result.payload.configuration));
  assert.equal(result.reference.codeHash,digest(result.payload.build.sources));
  for(const secret of Object.values(env).slice(1))assert.equal(JSON.stringify(result).includes(secret),false);
});

test("configuration hashes distinguish runtime settings while code and configuration hashes survive restart",async()=>{
  const first=await runtimeEvidence({...settings,env:{}}),second=await runtimeEvidence({...settings,env:{}});
  assert.equal(first.reference.configurationHash,second.reference.configurationHash);
  assert.equal(first.reference.codeHash,second.reference.codeHash);
  assert.notEqual(first.reference.runtimeId,second.reference.runtimeId);
  assert.notEqual(first.reference.evidenceHash,second.reference.evidenceHash);
  const changed=await runtimeEvidence({...settings,walletIntelEnabled:true,env:{RAILWAY_GIT_COMMIT_SHA:"not-a-commit-secret"}});
  assert.notEqual(changed.reference.configurationHash,first.reference.configurationHash);
  assert.equal(changed.payload.build.commit,null);
  assert.equal(JSON.stringify(changed).includes("not-a-commit-secret"),false);
});
