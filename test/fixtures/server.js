const { createApp }=require("../../src/api/app");
const { fixtureMarket }=require("./market");
fixtureMarket().then(market=>{
  const server=createApp(market).listen(4173,"127.0.0.1");
  for(const signal of ["SIGTERM","SIGINT"])process.on(signal,()=>server.close(()=>process.exit(0)));
}).catch(error=>{console.error(error);process.exit(1);});
