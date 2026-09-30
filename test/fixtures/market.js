const bs58 = require("bs58").default;
const { createMarket } = require("../../src/market/market");
const SOL = "So11111111111111111111111111111111111111112";
const MINTS = [2,3,4,5,6].map(byte => bs58.encode(new Uint8Array(32).fill(byte)));
async function fixtureMarket() {
  const tokens = MINTS.map((id, i) => ({ id, symbol:["FRESH","HEAT","LARGE","OLD","RISK"][i],
    name:"Fixture " + i, usdPrice:.01, mcap:i===2?5000000:50000,
    liquidity:10000, holderCount:100, organicScore:75,
    createdAt:new Date(Date.now()-(i===3?48*3600000:(i+1)*60000)).toISOString(),
    ...(i===4?{audit:{isSus:true}}:{}),
    stats5m:{priceChange:i===1?8:1,buyVolume:1000,sellVolume:500} }));
  const market=createMarket({request:async url => {
    if(url.startsWith("/price"))return Object.fromEntries(url.split("ids=")[1].split(",")
      .filter(mint=>mint===SOL||MINTS.includes(mint)).map(mint=>[mint,{usdPrice:mint===SOL?200:.02,blockId:42}]));
    return tokens;
  }});
  await market.scan();
  return market;
}
module.exports={fixtureMarket,SOL,MINTS};
