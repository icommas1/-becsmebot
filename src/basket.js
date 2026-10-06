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
const {reportConfig}=require("./superagent/config");
const {liveConfig}=require("./live/config");
const {createJupiterLiveTransport}=require("./live/jupiter");
const {createReportReader}=require("./superagent/report");

function readConfig(env=process.env) {
  const apiKey=typeof env.JUPITER_API_KEY==="string"?env.JUPITER_API_KEY.trim():"";
  if(!apiKey)throw Error("JUPITER_API_KEY is required");
  const port=env.PORT==null||env.PORT===""?3000:Number(env.PORT);
  if(!Number.isInteger(port)||port<0||port>65535)throw Error("PORT must be an integer from 0 to 65535");
  const dataDir=typeof env.DATA_DIR==="string"&&env.DATA_DIR.trim()?env.DATA_DIR.trim():undefined;
  return {apiKey,port,dataDir};
}

function start({env=process.env,logger=console,marketFactory=createMarket,walletIntelFactory=createWalletIntel,archiveFactory=createResearchArchive}={}) {
  const config=readConfig(env),archiveSettings=archiveConfig(env);
  const market=marketFactory({apiKey:config.apiKey,dataDir:config.dataDir,captureResearch:archiveSettings.enabled});
  const accounts=paperConfig(env),store=accounts.enabled?createStore(accounts.databaseUrl):null;
  const liveSettings=liveConfig(env);
  const liveRouting=liveSettings.walletPublicKey?{config:liveSettings,transport:createJupiterLiveTransport({apiKey:config.apiKey})}:null;
  const agentSettings=require("./agent/config").agentConfig(env,accounts);
  const agentTools=agentSettings.enabled?require("./agent/store").createAgentRegistry(agentSettings):null;
  const reportSettings=reportConfig(env,accounts),reportReader=reportSettings.enabled?createReportReader(reportSettings):null;
  const walletSettings=walletIntelConfig(env),walletIntel=walletIntelFactory({config:walletSettings});
  const archive=archiveSettings.enabled||accounts.enabled&&archiveSettings.databaseUrl?
    archiveFactory(archiveSettings.databaseUrl,{streamId:archiveSettings.streamId}):null;
  const capture=archiveSettings.enabled?createArchiveCapture({archive,dataDir:config.dataDir||path.join(process.cwd(),"data"),logger}):null;
  let interval=null,walletInterval=null,archiveInterval=null,closing=null,stopping=false;
  let marketJob=null,walletJob=null,runtimeJob=null,retainedJob=null,provenance=null,retainedEvidence=null;
  const archiveStatus=()=>({...capture?.status()||{...disabledStatus(),retainedEvidence},runtimeEvidence:provenance?.reference||null});
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
      if(capture){
        const snapshot=market.researchSnapshot?.();
        await record("market.scan","market",snapshot,snapshot?.scanAt||Date.now(),{scanIntervalMs:SCAN_MS});
      }
    })().catch(()=>logger.error?.("Market capture unavailable")).finally(()=>{marketJob=null;});
    return marketJob;
  }
  function scanWalletIntel(){
    if(stopping||walletJob||capture&&!capture.canCapture())return walletJob;
    walletJob=(async()=>{
      await walletIntel.scan();
      if(capture){
        const snapshot=walletIntel.researchSnapshot?.();
        await record("wallet-intel.scan","wallet-intel",snapshot,Date.now(),{scanIntervalMs:walletIntel.scanMs});
      }
    })().catch(()=>logger.error?.("Wallet intelligence capture unavailable")).finally(()=>{walletJob=null;});
    return walletJob;
  }
  const release={commit:/^[0-9a-f]{40}$/i.test(env.RAILWAY_GIT_COMMIT_SHA||"")?env.RAILWAY_GIT_COMMIT_SHA.toLowerCase():null};
  const server=createApp(market,{config:accounts,store,archive,agentTools,reportReader,liveRouting},walletIntel,archiveStatus,release).listen(config.port,"0.0.0.0",()=>{
    logger.log("BecsBot public Jupiter paper terminal running on port "+server.address().port);
    runtimeJob=(async()=>{
      if(capture){
        logger.log("Permanent research archive enabled");
        provenance=await runtimeEvidence({env,marketScanMs:SCAN_MS,walletIntelEnabled:walletIntel.snapshot().enabled,
          walletIntelScanMs:walletIntel.scanMs,walletIntelMinCreditsReserve:walletSettings.minCreditsReserve,
          paperAccountsEnabled:accounts.enabled,streamId:archiveSettings.streamId,
          agentToolsEnabled:agentSettings.enabled,superagentReportEnabled:reportSettings.enabled});
        await record("runtime.started","runtime",provenance.payload,Date.now());
        logger.log("Research runtime provenance prepared for commit "+(provenance.reference.commit||"unavailable"));
        scheduleArchiveFlush();
      }else if(archive?.retainedEvidence){
        retainedJob=archive.retainedEvidence().then(value=>{retainedEvidence=value;})
          .catch(()=>logger.error?.("Retained research evidence unavailable"));
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
          return Promise.all([marketJob,walletJob,retainedJob]);
        }).then(()=>capture?.flush())
          .then(()=>Promise.all([store?.close(),archive?.close(),agentTools?.close(),reportReader?.close()])).then(()=>error?reject(error):resolve(),reject);
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
