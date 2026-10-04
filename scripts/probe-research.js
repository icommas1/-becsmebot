// Explicit, read-only provider probe. Never run from the app's scan timer.
// Uses one fixed public query per reader; no keys, private data or orders.
const {callSearch}=require('../src/research/mcp-client');
const {normalizeReply}=require('../src/research/service');
(async()=>{
  let failed=false;
  for(const provider of ['exa','parallel']){
    try{
      const reply=await callSearch(provider,'Solana official transaction documentation');
      const documents=normalizeReply(reply,provider,new Date().toISOString());
      if(!documents.length)throw Error('No validated public documents');
      console.log(JSON.stringify({provider,ok:true,documents:documents.length,keyless:true,executionEnabled:false}));
    }catch(error){failed=true;console.log(JSON.stringify({provider,ok:false,code:error?.code||'no_validated_documents',keyless:true,executionEnabled:false}));}
  }
  if(failed)process.exitCode=1;
})();
