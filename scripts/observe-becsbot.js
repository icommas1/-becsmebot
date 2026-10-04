const {observerConfig}=require("../src/superagent/config");
const {createObserver}=require("../src/superagent/observer");

async function main(){
  const config=observerConfig();
  if(!config.enabled){console.log(JSON.stringify({enabled:false,mode:"observation-only"}));return;}
  const action=process.argv[2]||"ingest";
  if(!["ingest","report"].includes(action)||process.argv.length>3)throw Object.assign(Error("invalid_observer_action"),{observerCode:"invalid_observer_action"});
  const observer=createObserver(config);
  try{console.log(JSON.stringify(action==="report"?await observer.report():await observer.run()));}
  finally{await observer.close();}
}
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({error:error.observerCode||"observer_database_or_source_unavailable"}));process.exitCode=1;});
module.exports={main};
