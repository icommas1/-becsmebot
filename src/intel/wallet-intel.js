const {isCanonicalMint}=require("../market/mint");

const MAX_EVENTS=100;
const PLATFORM_PATTERNS=Object.freeze([
  ["trojan",/\btrojan\b/i],["bullx",/\bbullx\b/i],["photon",/\bphoton\b/i],
  ["gmgn",/\bgmgn\b/i],["maestro",/\bmaestro\b/i],["bloom",/\bbloom(?:bot)?\b/i],
  ["blood",/\bblood solutions\b/i],["jupiter",/\bjupiter\b/i],["phantom",/\bphantom\b/i]
]);
const CATEGORY_PATTERNS=Object.freeze([
  ["fund",/\bfund\b/i],["smart_trader",/\bsmart trader\b/i],
  ["smart_30d",/\b30d smart trader\b/i],["smart_90d",/\b90d smart trader\b/i],
  ["smart_180d",/\b180d smart trader\b/i],["whale",/\bwhale\b/i],
  ["new_token_specialist",/\bnew token specialist\b/i],["early_memecoin_trader",/\bearly memecoin trader\b/i]
]);

function walletIntelConfig(env=process.env) {
  const apiKey=typeof env.NANSEN_API_KEY==="string"?env.NANSEN_API_KEY.trim():"";
  const raw=env.WALLET_INTEL_SCAN_MS==null||env.WALLET_INTEL_SCAN_MS===""?60000:Number(env.WALLET_INTEL_SCAN_MS);
  if(!Number.isInteger(raw)||raw<15000||raw>3600000)throw Error("WALLET_INTEL_SCAN_MS must be an integer from 15000 to 3600000");
  return {enabled:!!apiKey,nansenApiKey:apiKey||null,scanMs:raw};
}

function labels(value) {
  const text=typeof value==="string"?value:"";
  return {
    categories:CATEGORY_PATTERNS.filter(([,re])=>re.test(text)).map(([name])=>name),
    platforms:PLATFORM_PATTERNS.filter(([,re])=>re.test(text)).map(([name])=>name)
  };
}

function finite(value){const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;}
function token(address,symbol,amount,marketCap) {
  return {
    mint:isCanonicalMint(address)?address:null,
    symbol:typeof symbol==="string"&&symbol.length<=32?symbol:"",
    amount:finite(amount),
    marketCap:finite(marketCap)
  };
}

function normalizeNansen(row) {
  if(!row||row.chain!=="solana"||typeof row.trader_address!=="string"||!isCanonicalMint(row.trader_address)||
    typeof row.transaction_hash!=="string"||!row.transaction_hash||!Number.isFinite(Date.parse(row.block_timestamp)))return null;
  const bought=token(row.token_bought_address,row.token_bought_symbol,row.token_bought_amount,row.token_bought_market_cap);
  const sold=token(row.token_sold_address,row.token_sold_symbol,row.token_sold_amount,row.token_sold_market_cap);
  if(!bought.mint&&!sold.mint)return null;
  const classification=labels(row.trader_address_label);
  return {
    provider:"nansen",observedAt:new Date(row.block_timestamp).toISOString(),txHash:row.transaction_hash,
    wallet:row.trader_address,label:typeof row.trader_address_label==="string"?row.trader_address_label.slice(0,160):"",
    categories:classification.categories,platforms:classification.platforms,bought,sold,valueUsd:finite(row.trade_value_usd)
  };
}

async function jsonBounded(response,maxBytes=1024*1024) {
  if(!response.ok)throw Error("Nansen HTTP "+response.status);
  if(!response.body)return response.json();
  const reader=response.body.getReader(),chunks=[];let bytes=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>maxBytes)throw Error("Nansen response too large");chunks.push(value);}
  }finally{await reader.cancel().catch(()=>{});}
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function fetchNansen(apiKey,{fetchImpl=fetch}={}) {
  const response=await fetchImpl("https://api.nansen.ai/api/v1/smart-money/dex-trades",{
    method:"POST",redirect:"error",signal:AbortSignal.timeout(10000),
    headers:{"apiKey":apiKey,"Content-Type":"application/json","Accept":"application/json"},
    body:JSON.stringify({chains:["solana"],pagination:{page:1,per_page:MAX_EVENTS},
      order_by:[{field:"block_timestamp",direction:"DESC"}]})
  });
  const body=await jsonBounded(response);
  if(!body||!Array.isArray(body.data))throw Error("Invalid Nansen smart-money response");
  return body.data.map(normalizeNansen).filter(Boolean).slice(0,MAX_EVENTS);
}

function aggregate(events) {
  const byMint=new Map();
  const touch=(mint,symbol,side,event)=>{
    if(!mint)return;
    let item=byMint.get(mint);
    if(!item){item={mint,symbol:symbol||"",buys:0,sells:0,buyUsd:0,sellUsd:0,netUsd:0,wallets:new Set(),categories:new Set(),platforms:new Set(),lastTradeAt:event.observedAt};byMint.set(mint,item);}
    if(!item.symbol&&symbol)item.symbol=symbol;
    item[side==="buy"?"buys":"sells"]++;
    const usd=event.valueUsd||0;item[side==="buy"?"buyUsd":"sellUsd"]+=usd;
    item.wallets.add(event.wallet);for(const value of event.categories)item.categories.add(value);for(const value of event.platforms)item.platforms.add(value);
    if(Date.parse(event.observedAt)>Date.parse(item.lastTradeAt))item.lastTradeAt=event.observedAt;
  };
  for(const event of events){touch(event.bought.mint,event.bought.symbol,"buy",event);touch(event.sold.mint,event.sold.symbol,"sell",event);}
  return [...byMint.values()].map(item=>({
    mint:item.mint,symbol:item.symbol,buys:item.buys,sells:item.sells,
    buyUsd:Number(item.buyUsd.toFixed(2)),sellUsd:Number(item.sellUsd.toFixed(2)),
    netUsd:Number((item.buyUsd-item.sellUsd).toFixed(2)),uniqueWallets:item.wallets.size,
    categories:[...item.categories].sort(),platforms:[...item.platforms].sort(),lastTradeAt:item.lastTradeAt
  })).sort((a,b)=>Date.parse(b.lastTradeAt)-Date.parse(a.lastTradeAt)).slice(0,500);
}

function createWalletIntel({config=walletIntelConfig(),nansenFetch=fetchNansen,now=Date.now}={}) {
  let events=[],lastSuccessAt=null,lastError=null,running=false,revision=0;
  async function scan(){
    if(running||!config.enabled)return snapshot();
    running=true;
    try{
      const next=await nansenFetch(config.nansenApiKey);
      events=next;lastSuccessAt=new Date(now()).toISOString();lastError=null;revision++;
    }catch(error){lastError=String(error?.message||"Wallet intelligence provider unavailable").slice(0,300);revision++;}
    finally{running=false;}
    return snapshot();
  }
  function snapshot(){
    return {enabled:config.enabled,updatedAt:lastSuccessAt,lastError,running,
      providers:{nansen:{enabled:config.enabled,records:events.length,lastSuccessAt,lastError}},
      tokens:aggregate(events)};
  }
  return {scan,snapshot,revision:()=>revision,scanMs:config.scanMs};
}

module.exports={MAX_EVENTS,walletIntelConfig,labels,normalizeNansen,fetchNansen,aggregate,createWalletIntel};
