// Stable Railway entry point; runtime never loads a wallet signer.
const {createMarket,SCAN_MS}=require("./market/market");
const {createApp}=require("./api/app");
const {paperConfig}=require("./paper/config");
const {createStore}=require("./paper/store");
const {createWalletIntel,walletIntelConfig}=require("./intel/wallet-intel");
const {archiveConfig,archiveIntervals}=require("./archive/config");
const {createResearchArchive}=require("./archive/store");
const {createArchiveCapture,disabledStatus}=require("./archive/capture");
const path=require("node:path");
const {runtimeEvidence}=require("./archive/runtime-evidence");

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
  const capture=archive?createArchiveCapture({archive,dataDir:config.dataDir||path.join(process.cwd(),"data"),logger}):null;
  let interval=null,walletInterval=null,archiveInterval=null,closing=null,stopping=false;
  let marketJob=null,walletJob=null,runtimeJob=null,provenance=null;
  const archiveStatus=()=>({...capture?.status()||disabledStatus(),runtimeEvidence:provenance?.reference||null});
  function scheduleArchiveFlush(){
    if(stopping)return;
    const status=capture.status();
    const delay=!status.lastError&&!status.verificationComplete?archiveIntervals.catchupMs:archiveIntervals.retryMs;
    // Keep ten-record pages and one job at a time. Only healthy catch-up runs faster.
    archiveInterval=setTimeout(async()=>{await capture.flush();scheduleArchiveFlush();},delay);
  }
  async function record(kind,source,payload,occurredAt,metadata={}) {
    if(capture&&payload)await capture.capture({kind,source,payload,occurredAt,metadata:{...metadata,runtimeEvidence:provenance?.reference||null}});
  }
  function scanMarket(){
    if(stopping||marketJob||capture&&!capture.canCapture())return marketJob;
    marketJob=(async()=>{
      await market.scan();
      const snapshot=market.researchSnapshot?.();
      await record("market.scan","market",snapshot,snapshot?.scanAt||Date.now(),{scanIntervalMs:SCAN_MS});
    })().catch(()=>logger.error?.("Market capture unavailable")).finally(()=>{marketJob=null;});
    return marketJob;
  }
  function scanWalletIntel(){
    if(stopping||walletJob||capture&&!capture.canCapture())return walletJob;
    walletJob=(async()=>{
      await walletIntel.scan();
      const snapshot=walletIntel.researchSnapshot?.();
      await record("wallet-intel.scan","wallet-intel",snapshot,Date.now(),{scanIntervalMs:walletIntel.scanMs});
    })().catch(()=>logger.error?.("Wallet intelligence capture unavailable")).finally(()=>{walletJob=null;});
    return walletJob;
  }
  const server=createApp(market,{config:accounts,store},walletIntel,archiveStatus).listen(config.port,"0.0.0.0",()=>{
    logger.log("BecsBot public Jupiter paper terminal running on port "+server.address().port);
    runtimeJob=(async()=>{
      if(archive){
        logger.log("Permanent research archive enabled");
        provenance=await runtimeEvidence({env,marketScanMs:SCAN_MS,walletIntelEnabled:walletIntel.snapshot().enabled,
          walletIntelScanMs:walletIntel.scanMs,paperAccountsEnabled:accounts.enabled,streamId:archiveSettings.streamId});
        await record("runtime.started","runtime",provenance.payload,Date.now());
        logger.log("Research runtime provenance prepared for commit "+(provenance.reference.commit||"unavailable"));
        scheduleArchiveFlush();
      }
      if(stopping)return;
      scanMarket();interval=setInterval(scanMarket,SCAN_MS);
      if(walletIntel.snapshot().enabled){scanWalletIntel();walletInterval=setInterval(scanWalletIntel,walletIntel.scanMs);}
    })().catch(()=>logger.error?.("Runtime evidence initialization unavailable"));
  });
  function shutdown() {
    if(closing)return closing;
    stopping=true;
    if(interval)clearInterval(interval);if(walletInterval)clearInterval(walletInterval);if(archiveInterval)clearTimeout(archiveInterval);
    closing=new Promise((resolve,reject)=>{
      const force=setTimeout(()=>server.closeAllConnections?.(),10000);force.unref?.();
      server.close(error=>{clearTimeout(force);
        Promise.resolve(runtimeJob).then(()=>{
          if(archiveInterval)clearTimeout(archiveInterval);
          return Promise.all([marketJob,walletJob]);
        }).then(()=>capture?.flush())
          .then(()=>Promise.all([store?.close(),archive?.close()])).then(()=>error?reject(error):resolve(),reject);
      });
      server.closeIdleConnections?.();
    });
    return closing;
  }
  return {server,market,archive,archiveStatus,ready:()=>runtimeJob,shutdown};
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
