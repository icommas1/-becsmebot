const { FEEDS, marketRows, positive } = require("./tokens");
const { DEX_FEEDS, discoveryMints, createDexClient } = require("./dexscreener");
const { createJupiterClient } = require("./client");
const { createPriceHistory } = require("./history");
const { rankSignals } = require("./signals");
const { assertSchema } = require("../api/validation");
const SOL = "So11111111111111111111111111111111111111112";
const SCAN_MS = 60000;
const PRICE_CACHE_MS = 20000;

function createMarket({ apiKey, dataDir, request, dexRequest }) {
  const jupiter = request || createJupiterClient({ apiKey });
  const dex = dexRequest || createDexClient();
  const history = createPriceHistory({ dataDir });
  const state = { lastScanAt:null, lastError:null, running:false, solUsd:null,
    solPriceAt:null, radar:[], feeds:{}, scanIntervalMs:SCAN_MS };
  const feedTokens = {}, priceCache = new Map(), searchCache = new Map();
  const priceJobs = new Map(), searchJobs = new Map();
  let apiRevision = 0, compactSignals = [], lastResearch = null;
  const touch = () => { apiRevision++; };

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
    state.running=true;touch();
    const successful={},errors=[],providerEvidence={jupiter:{},dex:{},enrichment:[]};
    // Independent discovery requests cannot block Jupiter category reads.
    const discovery = Promise.all(DEX_FEEDS.map(async ([name,url]) => {
      try { const raw=await dex(url);return {name,mints:discoveryMints(raw),raw}; }
      catch(error) { return {name,error:error.message}; }
    }));
    try {
      try {
        const prices=await jupiter("/price/v3?ids="+SOL);
        assertSchema("upstreamPrices", prices);providerEvidence.jupiter.solPrice=prices;
        const price=positive(prices[SOL]?.usdPrice);
        if(!price)throw Error("SOL price unavailable");
        state.solUsd=price;state.solPriceAt=Date.now();touch();
      }catch(error){errors.push("SOL: "+error.message);}
      for(const [name,url] of FEEDS) {
        try {
          const tokens=await jupiter(url);
          assertSchema("upstreamTokens", tokens);
          providerEvidence.jupiter[name]=tokens;
          successful[name]=tokens;feedTokens[name]=tokens;
          state.feeds[name]={count:tokens.length,at:new Date().toISOString()};touch();
        }catch(error){errors.push(name+": "+error.message);state.feeds[name]={...state.feeds[name],error:error.message};touch();}
      }
      const discovered=await discovery;
      for(const feed of discovered)if(feed.raw)providerEvidence.dex[feed.name]=feed.raw;
      const mints=[...new Set(discovered.flatMap(feed=>feed.mints||[]))];
      const metadata=new Map();
      let enrichmentError=null;
      try {
        for(let i=0;i<mints.length;i+=100) {
          const chunk=mints.slice(i,i+100);
          const tokens=await jupiter("/tokens/v2/search?query="+encodeURIComponent(chunk.join(",")));
          assertSchema("upstreamTokens",tokens);providerEvidence.enrichment.push(tokens);
          for(const token of tokens)if(chunk.includes(token.id))metadata.set(token.id,token);
        }
      }catch(error){enrichmentError="Jupiter enrichment: "+error.message;}
      for(const feed of discovered) {
        const error=feed.error||(feed.mints.length?enrichmentError:null);
        if(error){errors.push(feed.name+": "+error);state.feeds[feed.name]={...state.feeds[feed.name],error};}
        else {
          // Dex supplies membership/rank only. All market metrics remain Jupiter data.
          const tokens=feed.mints.map(id=>metadata.get(id)||{id});
          successful[feed.name]=tokens;feedTokens[feed.name]=tokens;
          state.feeds[feed.name]={count:tokens.length,at:new Date().toISOString()};
        }
        touch();
      }
      // Merge older feeds first so successful fresh metadata wins.
      const ordered=Object.fromEntries(Object.entries(feedTokens).sort(([a],[b])=>
        Date.parse(state.feeds[a]?.at||0)-Date.parse(state.feeds[b]?.at||0)));
      state.radar=marketRows(ordered).map((row)=>({...row,observedAt:row.priceFeed?Date.parse(state.feeds[row.priceFeed]?.at):null}));
      history.sample(marketRows(successful));
      state.lastError=errors.length?errors.join("; "):null;
    }catch(error){state.lastError=error.message;}
    finally{
      state.lastScanAt=new Date().toISOString();state.running=false;
      const trails=history.snapshot(state.radar.map(row=>row.mint));
      const rankedSignals=rankSignals(state.radar,trails);
      compactSignals=rankedSignals.map(({mint,firstSeenAt,observedAt,multiple,peakMultiple})=>
        ({mint,firstSeenAt,observedAt,multiple,peakMultiple}));
      lastResearch={
        schemaVersion:1,scanAt:state.lastScanAt,solUsd:state.solUsd,solPriceAt:state.solPriceAt,
        lastError:state.lastError,feeds:structuredClone(state.feeds),
        providerRows:structuredClone(successful),providerEvidence:structuredClone(providerEvidence),
        radar:structuredClone(state.radar),signals:structuredClone(rankedSignals)
      };
      touch();
    }
  }
  function snapshot() {
    const trails=history.snapshot(state.radar.map(row=>row.mint));
    return {...state,tradingEnabled:false,manualSell:{enabled:false},trails,signals:rankSignals(state.radar,trails)};
  }
  function terminalSnapshot() {
    return {...state,tradingEnabled:false,manualSell:{enabled:false},signals:compactSignals};
  }
  function chartHistory() {
    return {scanAt:state.lastScanAt,trails:history.chartSnapshot(state.radar.map(row=>row.mint))};
  }
  function researchSnapshot(){return lastResearch?structuredClone(lastResearch):null;}
  return {snapshot,terminalSnapshot,chartHistory,researchSnapshot,snapshotRevision:()=>apiRevision,
    historyRevision:()=>history.revision(),scan,search,paperPrices};
}

module.exports={createMarket,SCAN_MS};

