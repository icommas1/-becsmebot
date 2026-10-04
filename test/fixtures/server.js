const { createApp }=require("../../src/api/app");
const { fixtureMarket }=require("./market");
const { SCAN_MS }=require("../../src/market/market");
fixtureMarket().then(market=>{
  const server=createApp(market).listen(4173,"127.0.0.1");
  // Long browser matrices need continuing synthetic observations, just as the
  // production process scans. Keep real freshness checks and ETag behavior.
  const scans=setInterval(()=>market.scan(),SCAN_MS);
  for(const signal of ["SIGTERM","SIGINT"])process.on(signal,()=>{
    clearInterval(scans);server.close(()=>process.exit(0));
  });
}).catch(error=>{console.error(error);process.exit(1);});
