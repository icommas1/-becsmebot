const { FEEDS, marketRows, positive } = require("./tokens");
const { createJupiterClient } = require("./client");
const { createPriceHistory } = require("./history");
const { rankSignals } = require("./signals");
const { assertSchema } = require("../api/validation");
const SOL = "So11111111111111111111111111111111111111112";
const SCAN_MS = 60000;
const PRICE_CACHE_MS = 20000;

function createMarket({ apiKey, dataDir, request }) {
  const jupiter = request || createJupiterClient({ apiKey });
  const history = createPriceHistory({ dataDir });
  const state = { lastScanAt:null, lastError:null, running:false, solUsd:null,
    solPriceAt:null, radar:[], feeds:{}, scanIntervalMs:SCAN_MS };
  const feedTokens = {}, priceCache = new Map(), searchCache = new Map();
  const priceJobs = new Map(), searchJobs = new Map();

  async function paperPrices(mints) {
    const result = {}, missing = [...new Set(mints)].sort().filter((mint) => {
      const cached = priceCache.get(mint);
      if (cached && Date.now()-cached.at < PRICE_CACHE_MS) { result[mint]=cached.data; return false; }
      return true;
    });
    for (let i=0;i<missing.length;i+=50) {
      const chunk=missing.slice(i,i+50), key=chunk.join(",");
      if (!priceJobs.has(key)) {
        const job = jupiter("/price/v3?ids="+key).then((prices) => {
          assertSchema("upstreamPrices", prices);
          const at=Date.now(), values={};
          for (const mint of chunk) {
            const price=positive(prices[mint]?.usdPrice);
            const data=price?{priceUsd:price,blockId:prices[mint].blockId,observedAt:at}:null;
            values[mint]=data;priceCache.set(mint,{data,at});
          }
          while(priceCache.size>5000)priceCache.delete(priceCache.keys().next().value);
          return values;
        }).finally(()=>priceJobs.delete(key));
        priceJobs.set(key,job);
      }
      Object.assign(result,await priceJobs.get(key));
    }
    return result;
  }

  async function search(query) {
    const key=query.toLowerCase(),cached=searchCache.get(key);
    if(cached && Date.now()-cached.at<60000)return cached.rows;
    if(!searchJobs.has(key)) {
      const job=jupiter("/tokens/v2/search?query="+encodeURIComponent(query)).then((tokens)=>{
        assertSchema("upstreamTokens", tokens);
        const rows=marketRows({search:tokens}).map((row)=>({...row,observedAt:Date.now()}));
        searchCache.set(key,{rows,at:Date.now()});
        if(searchCache.size>100)searchCache.delete(searchCache.keys().next().value);
        return rows;
      }).finally(()=>searchJobs.delete(key));
      searchJobs.set(key,job);
    }
    return searchJobs.get(key);
  }

  async function scan() {
    if(state.running)return;
    state.running=true;
    const successful={},errors=[];
    try {
      try {
        const prices=await jupiter("/price/v3?ids="+SOL);
        assertSchema("upstreamPrices", prices);
        const price=positive(prices[SOL]?.usdPrice);
        if(!price)throw Error("SOL price unavailable");
        state.solUsd=price;state.solPriceAt=Date.now();
      }catch(error){errors.push("SOL: "+error.message);}
      for(const [name,url] of FEEDS) {
        try {
          const tokens=await jupiter(url);
          assertSchema("upstreamTokens", tokens);
          successful[name]=tokens;feedTokens[name]=tokens;
          state.feeds[name]={count:tokens.length,at:new Date().toISOString()};
        }catch(error){errors.push(name+": "+error.message);state.feeds[name]={...state.feeds[name],error:error.message};}
      }
      // Merge older feeds first so successful fresh metadata wins.
      const ordered=Object.fromEntries(Object.entries(feedTokens).sort(([a],[b])=>
        Date.parse(state.feeds[a]?.at||0)-Date.parse(state.feeds[b]?.at||0)));
      state.radar=marketRows(ordered).map((row)=>({...row,observedAt:row.priceFeed?Date.parse(state.feeds[row.priceFeed]?.at):null}));
      history.sample(marketRows(successful));
      state.lastError=errors.length?errors.join("; "):null;
    }catch(error){state.lastError=error.message;}
    finally{state.lastScanAt=new Date().toISOString();state.running=false;}
  }
  function snapshot() {
    const trails=history.snapshot(state.radar.map(row=>row.mint));
    return {...state,tradingEnabled:false,manualSell:{enabled:false},trails,signals:rankSignals(state.radar,trails)};
  }
  return {snapshot,scan,search,paperPrices};
}

module.exports={createMarket,SCAN_MS};
