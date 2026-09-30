// Stable Railway entry point; runtime never loads a wallet signer.
const {createMarket,SCAN_MS}=require("./market/market");
const {createApp}=require("./api/app");

function readConfig(env=process.env) {
  const apiKey=typeof env.JUPITER_API_KEY==="string"?env.JUPITER_API_KEY.trim():"";
  if(!apiKey)throw Error("JUPITER_API_KEY is required");
  const port=env.PORT==null||env.PORT===""?3000:Number(env.PORT);
  if(!Number.isInteger(port)||port<0||port>65535)throw Error("PORT must be an integer from 0 to 65535");
  const dataDir=typeof env.DATA_DIR==="string"&&env.DATA_DIR.trim()?env.DATA_DIR.trim():undefined;
  return {apiKey,port,dataDir};
}

function start({env=process.env,logger=console,marketFactory=createMarket}={}) {
  const config=readConfig(env),market=marketFactory({apiKey:config.apiKey,dataDir:config.dataDir});
  let interval=null,closing=null;
  const server=createApp(market).listen(config.port,"0.0.0.0",()=>{
    logger.log("BecsBot public Jupiter paper terminal running on port "+server.address().port);
    market.scan();interval=setInterval(()=>market.scan(),SCAN_MS);
  });
  function shutdown() {
    if(closing)return closing;
    if(interval)clearInterval(interval);
    closing=new Promise((resolve,reject)=>{
      const force=setTimeout(()=>server.closeAllConnections?.(),10000);force.unref?.();
      server.close(error=>{clearTimeout(force);if(error)reject(error);else resolve();});
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
