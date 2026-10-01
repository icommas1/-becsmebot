// Stable Railway entry point; runtime never loads a wallet signer.
const {createMarket,SCAN_MS}=require("./market/market");
const {createApp}=require("./api/app");
const {paperConfig}=require("./paper/config");
const {createStore}=require("./paper/store");
const {createWalletIntel,walletIntelConfig}=require("./intel/wallet-intel");

function readConfig(env=process.env) {
  const apiKey=typeof env.JUPITER_API_KEY==="string"?env.JUPITER_API_KEY.trim():"";
  if(!apiKey)throw Error("JUPITER_API_KEY is required");
  const port=env.PORT==null||env.PORT===""?3000:Number(env.PORT);
  if(!Number.isInteger(port)||port<0||port>65535)throw Error("PORT must be an integer from 0 to 65535");
  const dataDir=typeof env.DATA_DIR==="string"&&env.DATA_DIR.trim()?env.DATA_DIR.trim():undefined;
  return {apiKey,port,dataDir};
}

function start({env=process.env,logger=console,marketFactory=createMarket,walletIntelFactory=createWalletIntel}={}) {
  const config=readConfig(env),market=marketFactory({apiKey:config.apiKey,dataDir:config.dataDir});
  const accounts=paperConfig(env),store=accounts.enabled?createStore(accounts.databaseUrl):null;
  const walletIntel=walletIntelFactory({config:walletIntelConfig(env)});
  let interval=null,walletInterval=null,closing=null;
  const server=createApp(market,{config:accounts,store},walletIntel).listen(config.port,"0.0.0.0",()=>{
    logger.log("BecsBot public Jupiter paper terminal running on port "+server.address().port);
    market.scan();interval=setInterval(()=>market.scan(),SCAN_MS);
    if(walletIntel.snapshot().enabled){walletIntel.scan();walletInterval=setInterval(()=>walletIntel.scan(),walletIntel.scanMs);}
  });
  function shutdown() {
    if(closing)return closing;
    if(interval)clearInterval(interval);if(walletInterval)clearInterval(walletInterval);
    closing=new Promise((resolve,reject)=>{
      const force=setTimeout(()=>server.closeAllConnections?.(),10000);force.unref?.();
      server.close(error=>{clearTimeout(force);Promise.resolve(store?.close()).then(()=>error?reject(error):resolve(),reject);});
      server.closeIdleConnections?.();
    });
    return closing;
  }
  return {server,market,shutdown};
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
