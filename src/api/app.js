const path=require("node:path");
const {randomUUID}=require("node:crypto");
const express=require("express");
const { assertSchema, isValid }=require("./validation");

function createApp(market, paperAccounts={config:{enabled:false}}, walletIntel={snapshot:()=>({
  enabled:false,updatedAt:null,lastError:null,running:false,
  providers:{nansen:{enabled:false,records:0,lastSuccessAt:null,lastError:null}},tokens:[]
}),revision:()=>0}) {
  const instanceId=randomUUID();
  const send = (res, name, value) => res.json(assertSchema(name, value));
  const app=express();app.set("trust proxy",1);app.disable("x-powered-by");
  app.use(express.json({limit:"20kb"}));
  app.use((_req,res,next)=>{res.set({
    "Cache-Control":"no-store",
    "Content-Security-Policy":"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
    "Cross-Origin-Resource-Policy":"same-origin",
    "Permissions-Policy":"camera=(), geolocation=(), microphone=(), payment=()",
    "Referrer-Policy":"no-referrer",
    "X-Content-Type-Options":"nosniff",
    "X-Frame-Options":"DENY"
  });next();});
  app.get(["/","/terminal"],(_req,res)=>res.sendFile(path.join(__dirname,"../web/dashboard.html")));
  app.use("/assets",express.static(path.join(__dirname,"../web/assets"),{
    dotfiles:"deny",fallthrough:false,index:false
  }));
  app.get("/health",(_req,res)=>{
    const s=market.terminalSnapshot?market.terminalSnapshot():market.snapshot();send(res,"health",{ok:true,tradingEnabled:false,manualSell:{enabled:false},
      lastScanAt:s.lastScanAt,lastError:s.lastError,running:s.running,feeds:s.feeds});
  });
  // No signing module is loaded. Even old clients cannot execute a real sale.
  app.use("/api/sell",(_req,res)=>res.status(410).json({error:"Real trading is disabled on the public terminal"}));
  app.use("/api/pause",(_req,res)=>res.status(410).json({error:"Market scans run automatically"}));
  const conditional = (req,res,tag) => {
    if (!tag) return false;
    res.set("ETag",tag);
    const validators=(req.get("If-None-Match")||"").split(",").map(value=>value.trim());
    if (validators.some(value=>value==="*"||value===tag||value.replace(/^W\//,"")===tag.replace(/^W\//,""))) {
      res.status(304).end(); return true;
    }
    return false;
  };
  app.get("/api/basket",(req,res)=>{
    if(conditional(req,res,market.snapshotRevision?`W/\"basket-${instanceId}-${market.snapshotRevision()}\"`:null))return;
    send(res,"snapshot",market.terminalSnapshot?market.terminalSnapshot():market.snapshot());
  });
  app.get("/api/history",(req,res)=>{
    if(conditional(req,res,market.historyRevision?`W/"history-${instanceId}-${market.historyRevision()}"`:null))return;
    const value=market.chartHistory?market.chartHistory():{scanAt:null,trails:{}};
    send(res,"historyResponse",value);
  });
  app.get("/api/wallet-intel",(req,res)=>{
    if(conditional(req,res,`W/"wallet-${instanceId}-${walletIntel.revision?.()??0}"`))return;
    send(res,"walletIntelResponse",walletIntel.snapshot());
  });
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
    if(!isValid("searchQuery",query))return res.status(400).json({error:"Enter 2–80 characters"});
    try{send(res,"searchResponse",{rows:await market.search(query)});}catch(_error){res.status(503).json({error:"Market data temporarily unavailable"});}
  });
  app.post("/api/paper/prices",limit,async(req,res)=>{
    const input=req.body?.mints;
    if(!isValid("priceRequest",req.body))return res.status(400).json({error:"Invalid token list"});
    try{send(res,"priceResponse",{prices:await market.paperPrices(input)});}catch(_error){res.status(503).json({error:"Market data temporarily unavailable"});}
  });
  require("../paper/routes").mountPaperRoutes(app,{...paperAccounts,market});
  app.use((error,_req,res,_next)=>res.status(error.status||500).json({error:error.status===400?"Invalid JSON request":"Request unavailable"}));
  return app;
}

module.exports={createApp};
