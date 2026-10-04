// CI-only end-to-end check of the actual Docker evaluator and host receipt signer.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const assert=require('node:assert/strict');
const {generateKeyPairSync,createHash,randomUUID,verify}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {digest,canonical}=require('../../src/events/becs-event');
const {policy,verifierHash}=require('../../src/agent/config');
const {isValid}=require('../../src/api/validation');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'becs-signing-'));
try{
  const keys=generateKeyPairSync('ed25519'),keyPath=path.join(directory,'private.pem'),manifestPath=path.join(directory,'manifest.json');
  fs.writeFileSync(keyPath,keys.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
  const code="const x=JSON.parse(require('fs').readFileSync(0,'utf8')),e=new Set(x.events),m=new Set(x.memory);console.log(JSON.stringify({missing:[...e].filter(v=>!m.has(v)).sort(),orphan:[...m].filter(v=>!e.has(v)).sort(),duplicate:[...m].filter(v=>x.memory.filter(w=>w===v).length>1).sort()}));";
  const bundle={version:1,name:'signing-fixture',code,codeHash:createHash('sha256').update(code).digest('hex'),capability:policy.capability,
    permissions:policy.permissions,policyHash:digest(policy),verifierHash:verifierHash(),image:process.env.AGENT_TEST_IMAGE};
  const now=Date.now(),manifest={bundle,bundleHash:digest(bundle),policy,evaluationId:randomUUID(),nonce:'b'.repeat(64),reservedAt:now,expiresAt:now+900000};
  fs.writeFileSync(manifestPath,JSON.stringify(manifest),{mode:0o600});
  const signed=JSON.parse(execFileSync(process.execPath,[path.resolve('scripts/agent-evaluate.js'),manifestPath],
    {timeout:120000,maxBuffer:65536,encoding:'utf8',env:{PATH:process.env.PATH,AGENT_EVALUATOR_PRIVATE_KEY_FILE:keyPath}}));
  assert.ok(isValid('agentAttestationRequest',signed));assert.equal(signed.report.passed,policy.cases.length);
  assert.equal(signed.report.isolationVerified,true);assert.equal(signed.report.bundleHash,manifest.bundleHash);
  assert.ok(verify(null,Buffer.from(JSON.stringify(canonical(signed.report))),keys.publicKey,Buffer.from(signed.signature,'base64')));
  const tampered={...signed.report,passed:0};assert.equal(verify(null,Buffer.from(JSON.stringify(canonical(tampered))),keys.publicKey,Buffer.from(signed.signature,'base64')),false);
  console.log('Actual isolated evaluator receipt is schema-valid, bound to its manifest, signed and tamper-rejecting.');
}finally{fs.rmSync(directory,{recursive:true,force:true});}
