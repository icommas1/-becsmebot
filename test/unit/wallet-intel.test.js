const test=require("node:test"),assert=require("node:assert/strict");
const {labels,normalizeNansen,aggregate,createWalletIntel,walletIntelConfig}=require("../../src/intel/wallet-intel");
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
  assert.deepEqual(walletIntelConfig({}),{enabled:false,nansenApiKey:null,scanMs:60000});
  assert.throws(()=>walletIntelConfig({WALLET_INTEL_SCAN_MS:"1000"}),/WALLET_INTEL_SCAN_MS/);
  let fail=false;
  const event=normalizeNansen({chain:"solana",block_timestamp:"2026-10-01T12:00:00Z",transaction_hash:"tx",trader_address:WALLET,
    trader_address_label:"Smart Trader",token_bought_address:MINTS[0],token_sold_address:MINTS[1],trade_value_usd:10});
  const intel=createWalletIntel({config:{enabled:true,nansenApiKey:"fixture",scanMs:60000},nansenFetch:async()=>{if(fail)throw Error("down");return [event];}});
  await intel.scan();assert.equal(intel.snapshot().tokens.length,2);fail=true;await intel.scan();
  assert.equal(intel.snapshot().tokens.length,2);assert.equal(intel.snapshot().lastError,"down");
});
