// Stable Railway entry point; runtime never loads a wallet signer.
const {createMarket,SCAN_MS}=require("./market/market");
const {createApp}=require("./api/app");
const {paperConfig}=require("./paper/config");
const {createStore}=require("./paper/store");
const {createWalletIntel,walletIntelConfig}=require("./intel/wallet-intel");
const {archiveConfig}=require("./archive/config");
const {createResearchArchive}=require("./archive/store");

function readConfig(env=process.env) {
  const apiKey=typeof env.JUPITER_API_KEY==="string"?env.JUPITER_API_KEY.trim():"";
  if(!apiKey)throw Error("JUPITER_API_KEY is required");
  const port=env.PORT==null||env.PORT===""?3000:Number(env.PORT);
  if(!Number.isInteger(port)||port<0||port>65535)throw Error("PORT must be an integer from 0 to 65535");
  const dataDir=typeof env.DATA_DIR==="string"&&env.DATA_DIR.trim()?env.DATA_DIR.trim():undefined;
  return {apiKey,port,dataDir};
}

function start({env=process.env,logger=console,marketFactory=createMarket,walletIntelFactory=createWalletIntel,archiveFactory=createResearchArchive}={}) {
  const config=readConfig(env),market=marketFactory({apiKey:config.apiKey,dataDir:config.dataDir});
  const accounts=paperConfig(env),store=accounts.enabled?createStore(accounts.databaseUrl):null;
  const walletIntel=walletIntelFactory({config:walletIntelConfig(env)});
  const archiveSettings=archiveConfig(env);
  const archive=archiveSettings.enabled?archiveFactory(archiveSettings.databaseUrl,{streamId:archiveSettings.streamId}):null;
  let interval=null,walletInterval=null,closing=null,marketJob=false,walletJob=false;
  const archivedKinds=new Set();
  const archiveFailure=(kind,error)=>logger.error?.("Research archive "+kind+" failed: "+String(error?.message||error).slice(0,300));
  async function record(kind,source,payload,occurredAt,metadata={}) {
    if(!archive||!payload)return;
    try{
      const receipt=await archive.record({kind,source,payload,occurredAt,metadata});
      if(!archivedKinds.has(kind)){
        archivedKinds.add(kind);logger.log("Research archive "+kind+" committed sequence "+receipt.sequence);
      }
    }
    catch(error){archiveFailure(kind,error);}
  }
  async function scanMarket(){
    if(marketJob)return;marketJob=true;
    try{
      await market.scan();
      const snapshot=market.researchSnapshot?.();
      await record("market.scan","market",snapshot,snapshot?.scanAt||Date.now(),{scanIntervalMs:SCAN_MS});
    }finally{marketJob=false;}
  }
  async function scanWalletIntel(){
    if(walletJob)return;walletJob=true;
    try{
      await walletIntel.scan();
      const snapshot=walletIntel.researchSnapshot?.();
      await record("wallet-intel.scan","wallet-intel",snapshot,snapshot?.updatedAt||Date.now(),{scanIntervalMs:walletIntel.scanMs});
    }finally{walletJob=false;}
  }
  const server=createApp(market,{config:accounts,store},walletIntel).listen(config.port,"0.0.0.0",()=>{
    logger.log("BecsBot public Jupiter paper terminal running on port "+server.address().port);
    if(archive){
      logger.log("Permanent research archive enabled");
      record("runtime.started","runtime",{schemaVersion:1,tradingEnabled:false,marketScanMs:SCAN_MS,
        walletIntelEnabled:walletIntel.snapshot().enabled,walletIntelScanMs:walletIntel.scanMs},Date.now());
    }
    scanMarket();interval=setInterval(scanMarket,SCAN_MS);
    if(walletIntel.snapshot().enabled){scanWalletIntel();walletInterval=setInterval(scanWalletIntel,walletIntel.scanMs);}
  });
  function shutdown() {
    if(closing)return closing;
    if(interval)clearInterval(interval);if(walletInterval)clearInterval(walletInterval);
    closing=new Promise((resolve,reject)=>{
      const force=setTimeout(()=>server.closeAllConnections?.(),10000);force.unref?.();
      server.close(error=>{clearTimeout(force);Promise.all([store?.close(),archive?.close()]).then(()=>error?reject(error):resolve(),reject);});
      server.closeIdleConnections?.();
    });
    return closing;
  }
  return {server,market,archive,shutdown};
}

if(require.main===module) {
  require("dotenv").config();
  try {
    const runtime=start();
    for(const signal of ["SIGTERM","SIGINT"])process.once(signal,()=>{
      console.log(signal+" received; closing BecsBot");
      runtime.shutdown().catch(error=>{console.error("BecsBot shutdown failed: "+error.message);process.exitCode=1;});
    });
  } catch(error) {
    console.error("BecsBot failed to start: "+error.message);process.exitCode=1;
  }
}
module.exports={createApp,createMarket,readConfig,start};
