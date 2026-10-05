const test=require("node:test"),assert=require("node:assert/strict");
const {labels,normalizeNansen,aggregate,createWalletIntel,walletIntelConfig,fetchNansen}=require("../../src/intel/wallet-intel");
const {MINTS}=require("../fixtures/market");
const WALLET="11111111111111111111111111111111";

test("wallet intelligence classifies explicit provider labels without inventing platform attribution",()=>{
  assert.deepEqual(labels("30D Smart Trader · Trojan Trading Bot User"),{categories:["smart_trader","smart_30d"],platforms:["trojan"]});
  assert.deepEqual(labels("Smart Trader"),{categories:["smart_trader"],platforms:[]});
  assert.deepEqual(labels("Phantom user"),{categories:[],platforms:["phantom"]});
});

test("Nansen smart-money trades normalize and aggregate by token without exposing raw wallets in snapshot",async()=>{
  const rows=[
    {chain:"solana",block_timestamp:"2026-10-01T12:00:00Z",transaction_hash:"tx1",trader_address:WALLET,
      trader_address_label:"Smart Trader · Trojan Trading Bot User",token_bought_address:MINTS[0],token_sold_address:MINTS[1],
      token_bought_symbol:"BUY",token_sold_symbol:"SELL",token_bought_amount:10,token_sold_amount:20,trade_value_usd:50},
    {chain:"solana",block_timestamp:"2026-10-01T12:01:00Z",transaction_hash:"tx2",trader_address:WALLET,
      trader_address_label:"Fund",token_bought_address:MINTS[0],token_sold_address:MINTS[1],
      token_bought_symbol:"BUY",token_sold_symbol:"SELL",trade_value_usd:25}
  ];
  const normalized=rows.map(normalizeNansen);assert.ok(normalized.every(Boolean));
  const tokens=aggregate(normalized),buy=tokens.find(row=>row.mint===MINTS[0]),sell=tokens.find(row=>row.mint===MINTS[1]);
  assert.equal(buy.buys,2);assert.equal(buy.uniqueWallets,1);assert.equal(buy.netUsd,75);
  assert.deepEqual(buy.categories,["fund","smart_trader"]);assert.deepEqual(buy.platforms,["trojan"]);
  assert.equal(sell.sells,2);assert.equal(sell.netUsd,-75);
  const intel=createWalletIntel({config:{enabled:true,nansenApiKey:"fixture",scanMs:60000},nansenFetch:async()=>normalized,now:()=>Date.parse("2026-10-01T12:02:00Z")});
  await intel.scan();const snapshot=intel.snapshot();
  assert.equal(snapshot.providers.nansen.records,2);assert.equal(JSON.stringify(snapshot).includes(WALLET),false);
});

test("wallet intelligence is opt-in and provider failures retain the previous aggregate",async()=>{
  assert.deepEqual(walletIntelConfig({}),{enabled:false,nansenApiKey:null,scanMs:86400000,minCreditsReserve:5});
  assert.throws(()=>walletIntelConfig({WALLET_INTEL_SCAN_MS:"1000"}),/WALLET_INTEL_SCAN_MS/);
  let fail=false;
  const event=normalizeNansen({chain:"solana",block_timestamp:"2026-10-01T12:00:00Z",transaction_hash:"tx",trader_address:WALLET,
    trader_address_label:"Smart Trader",token_bought_address:MINTS[0],token_sold_address:MINTS[1],trade_value_usd:10});
  const intel=createWalletIntel({config:{enabled:true,nansenApiKey:"fixture",scanMs:60000},nansenFetch:async()=>{if(fail)throw Error("down");return [event];}});
  await intel.scan();assert.equal(intel.snapshot().tokens.length,2);fail=true;await intel.scan();
  assert.equal(intel.snapshot().tokens.length,2);assert.equal(intel.snapshot().lastError,"down");
});

test("wallet intelligence accepts a daily interval and rejects invalid credit reserves",()=>{
  const config=walletIntelConfig({NANSEN_API_KEY:" fixture ",WALLET_INTEL_SCAN_MS:"86400000",NANSEN_MIN_CREDITS_RESERVE:"10"});
  assert.equal(config.scanMs,86400000);assert.equal(config.minCreditsReserve,10);assert.equal(config.nansenApiKey,"fixture");
  assert.throws(()=>walletIntelConfig({WALLET_INTEL_SCAN_MS:"86400001"}),/WALLET_INTEL_SCAN_MS/);
  for(const value of ["0","-1","1.5","NaN","1000001"])
    assert.throws(()=>walletIntelConfig({NANSEN_MIN_CREDITS_RESERVE:value}),/NANSEN_MIN_CREDITS_RESERVE/);
});

const trade={chain:"solana",block_timestamp:"2026-10-01T12:00:00Z",transaction_hash:"fixture-tx",trader_address:WALLET,
  trader_address_label:"Smart Trader",token_bought_address:MINTS[0],token_sold_address:MINTS[1],trade_value_usd:10};
const json=value=>new Response(JSON.stringify(value),{headers:{"Content-Type":"application/json"}});

test("Nansen checks the free account balance before making one request at the reserve boundary",async()=>{
  const calls=[];
  const rows=await fetchNansen("fixture",{fetchImpl:async(url,options)=>{
    calls.push({url,options});return json(calls.length===1?{credits_remaining:10}:{data:[trade]});
  }});
  assert.equal(rows.length,1);assert.equal(rows[0].txHash,"fixture-tx");
  assert.equal(calls.length,2);assert.equal(calls[0].url,"https://api.nansen.ai/api/v1/account");
  assert.equal(calls[0].options.method,"GET");assert.equal(calls[1].options.method,"POST");
  assert.deepEqual(JSON.parse(calls[1].options.body).chains,["solana"]);
  for(const {options}of calls){assert.equal(options.redirect,"error");assert.equal(options.headers.apikey,"fixture");}
});

test("low and unknown balances never reach a Nansen DEX request",async()=>{
  for(const value of [0,5,9,null,undefined,"100",-1,1.5,{}]){
    let calls=0;
    await assert.rejects(fetchNansen("fixture",{fetchImpl:async()=>{calls++;return json({credits_remaining:value});}}),
      /Nansen polling paused|Invalid Nansen credit balance/);
    assert.equal(calls,1);
  }
  let calls=0;
  await assert.rejects(fetchNansen("fixture",{minCreditsReserve:10,fetchImpl:async()=>{calls++;return json({credits_remaining:14});}}),
    /preserve 10 credits/);
  assert.equal(calls,1);
});

test("account errors and malformed bodies stop DEX requests without returning upstream text",async()=>{
  for(const response of [new Response("fixture-private-key",{status:401}),new Response("fixture-private-key",{status:402}),new Response('invalid "fixture-private-key"')]){
    let calls=0;
    await assert.rejects(fetchNansen("fixture",{fetchImpl:async()=>{calls++;return response;}}),error=>{
      assert.equal(error.message.includes("fixture-private-key"),false);return /Nansen HTTP 40[12]|Invalid Nansen response/.test(error.message);
    });
    assert.equal(calls,1);
  }
  await assert.rejects(fetchNansen("fixture",{fetchImpl:async()=>{throw Error("fixture-private-key");}}),
    {message:"Nansen request unavailable"});
});

test("concurrent scans charge once and a later credit pause preserves the prior snapshot and timestamp",async()=>{
  let credits=10,paid=0,account=0,at=Date.parse("2026-10-01T12:01:00Z");
  const transport=async(_url,options)=>{
    if(options.method==="GET"){account++;return json({credits_remaining:credits});}
    paid++;return json({data:[trade]});
  };
  const intel=createWalletIntel({config:walletIntelConfig({NANSEN_API_KEY:"fixture",NANSEN_MIN_CREDITS_RESERVE:"5"}),
    nansenFetch:(key,options)=>fetchNansen(key,{...options,fetchImpl:transport}),now:()=>at});
  await Promise.all([intel.scan(),intel.scan(),intel.scan()]);
  assert.equal(paid,1);assert.equal(account,1);
  const first=intel.snapshot();assert.equal(first.tokens.length,2);
  credits=9;at+=86400000;await intel.scan();
  const paused=intel.snapshot();assert.equal(paid,1);assert.equal(account,2);
  assert.equal(paused.updatedAt,first.updatedAt);assert.deepEqual(paused.tokens,first.tokens);
  assert.equal(paused.lastError,"Nansen polling paused to preserve 5 credits");
  credits=10;await intel.scan();assert.equal(paid,2);assert.equal(intel.snapshot().lastError,null);
});
