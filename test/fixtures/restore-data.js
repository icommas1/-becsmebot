// CI-only fixture, never a production seeding or restore command.
const {randomUUID}=require("node:crypto");
const {createStore}=require("../../src/paper/store");
const {createPaperService}=require("../../src/paper/service");
const {createResearchArchive}=require("../../src/archive/store");
const {fixtureMarket,MINTS}=require("./market");
async function seed(){
  if(process.env.CI!=="true"||!process.env.TEST_DATABASE_URL)throw Error("Disposable CI database required");
  const store=createStore(process.env.TEST_DATABASE_URL),archive=createResearchArchive(process.env.TEST_DATABASE_URL,{streamId:"restore-fixture"});
  try{
    await store.ensureAccount("restore-fixture");
    const service=await createPaperService({store,market:await fixtureMarket()});
    const result=await service.command("restore-fixture",{type:"buy",mint:MINTS[0],amount:1,automatic:false,feed:"recent",requestId:randomUUID(),createdAt:new Date().toISOString()});
    if(!result.ok)throw Error("Fixture buy failed");
    await store.sealEvents("restore-fixture");
    await archive.record({kind:"market.scan",source:"restore-fixture",payload:{kept:true,marks:[1,2,3]}});
  }finally{await Promise.all([store.close(),archive.close()]);}
}
if(require.main===module)seed().catch(()=>{console.error("Restore fixture failed");process.exitCode=1;});
module.exports={seed};
