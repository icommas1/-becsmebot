// CI-only fixture, never a production seeding or restore command.
const {randomUUID}=require("node:crypto");
const {createStore}=require("../../src/paper/store");
const {createPaperService}=require("../../src/paper/service");
const {createResearchArchive}=require("../../src/archive/store");
const {fixtureMarket,MINTS}=require("./market");
async function seed(){
  if(process.env.CI!=="true"||!process.env.TEST_DATABASE_URL)throw Error("Disposable CI database required");
  const store=createStore(process.env.TEST_DATABASE_URL),archive=createResearchArchive(process.env.TEST_DATABASE_URL,{streamId:"restore-fixture"});
  const {generateKeyPairSync,sign}=require('node:crypto'),{digest,canonical}=require('../../src/events/becs-event');
  const {policy,verifierHash}=require('../../src/agent/config');
  const keys=generateKeyPairSync('ed25519');
  const registry=require('../../src/agent/store').createAgentRegistry({enabled:true,databaseUrl:process.env.TEST_DATABASE_URL,
    owner:'restore-fixture',policy,policyHash:digest(policy),verifierHash:verifierHash(),image:'node:24-alpine@sha256:'+'a'.repeat(64),publicKey:keys.publicKey});
  try{
    await store.ensureAccount("restore-fixture");
    const service=await createPaperService({store,market:await fixtureMarket()});
    const result=await service.command("restore-fixture",{type:"buy",mint:MINTS[0],amount:1,automatic:false,feed:"recent",requestId:randomUUID(),createdAt:new Date().toISOString()});
    if(!result.ok)throw Error("Fixture buy failed");
    await store.sealEvents("restore-fixture");
    await archive.record({kind:"market.scan",source:"restore-fixture",payload:{kept:true,marks:[1,2,3]}});
    const candidate=await registry.register('restore-fixture',{name:'restore-fixture',code:'// Fixture only'});
    const reserved=await registry.reserve('restore-fixture',candidate.bundleHash);
    // Synthetic signed receipt seeds consumed approval state for restore comparison;
    // this fixture does not assert real sandbox evidence or activate an executor.
    const report={version:1,evaluationId:reserved.evaluationId,bundleHash:reserved.bundleHash,nonce:reserved.nonce,
      policyHash:reserved.bundle.policyHash,verifierHash:reserved.bundle.verifierHash,image:reserved.bundle.image,
      completedAt:Date.now(),isolationVerified:true,total:policy.cases.length,passed:policy.cases.length};
    await registry.attest('restore-fixture',candidate.bundleHash,{report,signature:sign(null,Buffer.from(JSON.stringify(canonical(report))),keys.privateKey).toString('base64')});
    const approval=await registry.approve('restore-fixture',candidate.bundleHash,reserved.evaluationId);
    await registry.promote('restore-fixture',candidate.bundleHash,approval);
    const pending=await registry.register('restore-fixture',{name:'restore-pending',code:'// Pending fixture'});
    await registry.reserve('restore-fixture',pending.bundleHash);
  }finally{await Promise.all([store.close(),archive.close(),registry.close()]);}
}
if(require.main===module)seed().catch(()=>{console.error("Restore fixture failed");process.exitCode=1;});
module.exports={seed};
