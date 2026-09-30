// Stable Railway entry point; runtime never loads a wallet signer.
require("dotenv").config();
const {createMarket,SCAN_MS}=require("./market/market");
const {createApp}=require("./api/app");

if(require.main===module) {
  if(!process.env.JUPITER_API_KEY)throw Error("JUPITER_API_KEY is required");
  const market=createMarket({apiKey:process.env.JUPITER_API_KEY,dataDir:process.env.DATA_DIR});
  createApp(market).listen(process.env.PORT||3000,"0.0.0.0",()=>{
    console.log("BecsBot public Jupiter paper terminal running");
    market.scan();setInterval(()=>market.scan(),SCAN_MS);
  });
}
module.exports={createApp,createMarket};
