require("dotenv").config();
const path = require("node:path");
const express = require("express");
const { PublicKey } = require("@solana/web3.js");
const { FEEDS, marketRows, positive } = require("./jupiter-market");
const { createJupiterClient } = require("./jupiter-client");
const { createPriceHistory } = require("./price-history");

const { rankSignals } = require("./signals");

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
        if(!Array.isArray(tokens))throw Error("Invalid Jupiter search response");
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
        const price=positive(prices[SOL]?.usdPrice);
        if(!price)throw Error("SOL price unavailable");
        state.solUsd=price;state.solPriceAt=Date.now();
      }catch(error){errors.push("SOL: "+error.message);}
      for(const [name,url] of FEEDS) {
        try {
          const tokens=await jupiter(url);
          if(!Array.isArray(tokens))throw Error("Invalid token list");
          successful[name]=tokens;feedTokens[name]=tokens;
          state.feeds[name]={count:tokens.length,at:new Date().toISOString()};
        }catch(error){errors.push(name+": "+error.message);state.feeds[name]={...state.feeds[name],error:error.message};}
      }
      // Merge older feeds first so successful fresh metadata wins.
      const ordered=Object.fromEntries(Object.entries(feedTokens).sort(([a],[b])=>
        Date.parse(state.feeds[a]?.at||0)-Date.parse(state.feeds[b]?.at||0)));
      state.radar=marketRows(ordered).map((row)=>({...row,observedAt:Math.max(...row.feeds.map((feed)=>Date.parse(state.feeds[feed]?.at||0)))}));
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

function createApp(market) {
  const app=express();app.set("trust proxy",1);app.disable("x-powered-by");
  app.use(express.json({limit:"20kb"}));
  app.use((_req,res,next)=>{res.set("Cache-Control","no-store");res.set("Referrer-Policy","no-referrer");next();});
  app.get("/",(_req,res)=>res.sendFile(path.join(__dirname,"dashboard.html")));
  app.get("/health",(_req,res)=>{
    const s=market.snapshot();res.json({ok:true,tradingEnabled:false,manualSell:{enabled:false},
      lastScanAt:s.lastScanAt,lastError:s.lastError,running:s.running,feeds:s.feeds});
  });
  // No signing module is loaded. Even old clients cannot execute a real sale.
  app.use("/api/sell",(_req,res)=>res.status(410).json({error:"Real trading is disabled on the public terminal"}));
  app.use("/api/pause",(_req,res)=>res.status(410).json({error:"Market scans run automatically"}));
  app.get("/api/basket",(_req,res)=>res.json(market.snapshot()));
  const requests=new Map();let globalRequests=[];
  function limit(req,res,next) {
    const now=Date.now(),ip=req.ip||"unknown",cutoff=now-60000;
    const hits=(requests.get(ip)||[]).filter((at)=>at>cutoff);
    globalRequests=globalRequests.filter((at)=>at>cutoff);
    if(hits.length>=30||globalRequests.length>=40){res.set("Retry-After","60");return res.status(429).json({error:"Market requests busy. Try again in a minute."});}
    hits.push(now);requests.set(ip,hits);globalRequests.push(now);
    if(requests.size>5000)requests.delete(requests.keys().next().value);
    next();
  }
  app.get("/api/search",limit,async(req,res)=>{
    const query=typeof req.query.q==="string"?req.query.q.trim():"";
    if(query.length<2||query.length>80)return res.status(400).json({error:"Enter 2–80 characters"});
    try{res.json({rows:await market.search(query)});}catch(error){res.status(503).json({error:error.message});}
  });
  app.post("/api/paper/prices",limit,async(req,res)=>{
    const input=req.body?.mints;
    if(!Array.isArray(input)||input.length>100||input.some((mint)=>{
      if(typeof mint!=="string")return true;
      try{return new PublicKey(mint).toBase58()!==mint;}catch(_){return true;}
    }))return res.status(400).json({error:"Invalid token list"});
    try{res.json({prices:await market.paperPrices(input)});}catch(error){res.status(503).json({error:error.message});}
  });
  app.use((error,_req,res,_next)=>res.status(error.status||500).json({error:error.status===400?"Invalid JSON request":"Request unavailable"}));
  return app;
}

if(require.main===module) {
  if(!process.env.JUPITER_API_KEY)throw Error("JUPITER_API_KEY is required");
  const market=createMarket({apiKey:process.env.JUPITER_API_KEY,dataDir:process.env.DATA_DIR});
  createApp(market).listen(process.env.PORT||3000,"0.0.0.0",()=>{
    console.log("BecsBot public Jupiter paper terminal running");
    market.scan();setInterval(()=>market.scan(),SCAN_MS);
  });
}
module.exports={createApp,createMarket};
