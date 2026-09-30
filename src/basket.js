require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const { Connection, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const { createPumpFeed } = require("./pump-feed");
const { createManualSell } = require("./manual-sell");

const SOL = "So11111111111111111111111111111111111111112";
const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_PROGRAMS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
]);
const CURVE_DISCRIMINATOR = crypto.createHash("sha256")
  .update("account:BondingCurve").digest().subarray(0, 8);
const WALLET = "DJ9dHrRXSPEdyLEkJ96Hj79S7Qkt7mgrryT3Q5J5bVws";
const BET_USD = 1;
const SCAN_MS = 5 * 60 * 1000;
const STREAM_SCAN_MIN_MS = 60 * 1000;
// Direct Pump bonding-curve execution is not implemented; no buy route exists here.
const TRADING_ENABLED = false;
const PRICE_CACHE_MS = 20000;

const apiKey = process.env.JUPITER_API_KEY;
const dashboardKey = process.env.DASHBOARD_KEY;
const rpcUrl = process.env.HELIUS_RPC_URL;
const dataDir = process.env.DATA_DIR;
if (!apiKey || !dashboardKey || !rpcUrl) {
  throw new Error("HELIUS_RPC_URL, JUPITER_API_KEY and DASHBOARD_KEY are required");
}

const wallet = new PublicKey(WALLET);
const connection = new Connection(rpcUrl, "confirmed");
const manualSell = createManualSell({ connection, wallet, apiKey,
  secret: process.env.SOLANA_PRIVATE_KEY,
  enabled: process.env.MANUAL_SELL_ENABLED === "true" });
const pumpFeed = createPumpFeed({
  apiKey: process.env.PUMP_PORTAL_API_KEY || "",
  onEvent: () => scheduleStreamScan()
});
let streamScanTimer = null;
let streamDirty = false;
const ledgerPath = dataDir ? path.join(dataDir, "basket.json") : null;
const [volumeAccount] = PublicKey.findProgramAddressSync(
  [Buffer.from("user_volume_accumulator"), wallet.toBuffer()], PUMP
);
const state = {
  lastScanAt: null, lastError: null, running: false, paused: false,
  solUsd: null, walletSol: null, candidates: [], radar: [], pumpVolumeReady: null, ledger: {}
};
const priceCache = new Map();

function persist() {
  if (!ledgerPath) throw new Error("Persistent DATA_DIR is required");
  fs.mkdirSync(dataDir, { recursive: true });
  const temp = ledgerPath + ".tmp";
  fs.writeFileSync(temp, JSON.stringify({
    paused: state.paused, ledger: state.ledger
  }), { mode: 0o600 });
  fs.renameSync(temp, ledgerPath);
}

if (ledgerPath) {
  fs.mkdirSync(dataDir, { recursive: true });
  if (fs.existsSync(ledgerPath)) {
    const saved = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    state.paused = saved.paused === true;
    state.ledger = saved.ledger || {};
  }
}

function isPump(token) {
  return /pump/i.test(String(token.launchpad || ""));
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function trendRows(five, hour) {
  const rows = new Map();
  for (const [source, tokens] of [["5m", five], ["1h", hour]]) {
    for (const token of tokens) {
      if (!token?.id) continue;
      try { new PublicKey(token.id); } catch (_) { continue; }
      const row = rows.get(token.id) || {
        mint: token.id, symbol: String(token.symbol || "?").slice(0, 32),
        name: String(token.name || "").slice(0, 100), sources: [],
        priceUsd: null, marketCap: null, liquidityUsd: null,
        holders: null, createdAt: null, launchpad: null
      };
      row.sources.push(source);
      row.priceUsd ||= finitePositive(token.usdPrice);
      row.marketCap ||= finitePositive(token.mcap);
      row.liquidityUsd ||= finitePositive(token.liquidity);
      row.holders ||= finitePositive(token.holderCount);
      row.createdAt ||= token.firstPool?.createdAt || token.createdAt || null;
      row.launchpad ||= token.launchpad || null;
      rows.set(token.id, row);
    }
  }
  return [...rows.values()];
}

async function paperPrices(mints) {
  const now = Date.now();
  const result = {};
  const missing = mints.filter((mint) => {
    const cached = priceCache.get(mint);
    if (cached && now - cached.at < PRICE_CACHE_MS) {
      result[mint] = cached.data;
      return false;
    }
    return true;
  });
  for (let i = 0; i < missing.length; i += 30) {
    const chunk = missing.slice(i, i + 30);
    let pairs = [];
    try {
      const response = await fetch("https://api.dexscreener.com/tokens/v1/solana/" + chunk.join(","),
        { signal: AbortSignal.timeout(8000) });
      if (response.ok) pairs = await response.json();
    } catch (_) { /* Jupiter price fallback below. */ }
    for (const mint of chunk) {
      const best = (Array.isArray(pairs) ? pairs : [])
        .filter((pair) => pair.chainId === "solana" && pair.baseToken?.address === mint &&
          finitePositive(pair.priceUsd))
        .sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0))[0];
      const data = best ? {
        priceUsd: finitePositive(best.priceUsd),
        marketCap: finitePositive(best.marketCap || best.fdv),
        liquidityUsd: finitePositive(best.liquidity?.usd)
      } : null;
      result[mint] = data;
      priceCache.set(mint, { data, at: now });
    }
  }
  const withoutPrice = missing.filter((mint) => !result[mint]?.priceUsd);
  for (let i = 0; i < withoutPrice.length; i += 50) {
    const chunk = withoutPrice.slice(i, i + 50);
    try {
      const jupPrices = await jupiter("/price/v3?ids=" + chunk.join(","));
      for (const mint of chunk) {
        const price = finitePositive(jupPrices[mint]?.usdPrice);
        if (price) {
          result[mint] = { priceUsd: price, marketCap: null, liquidityUsd: null };
          priceCache.set(mint, { data: result[mint], at: now });
        }
      }
    } catch (_) { /* A missing price remains explicitly unavailable. */ }
  }
  return result;
}

function isSolCurve(info) {
  if (!info || !info.owner.equals(PUMP) || info.data.length < 49 ||
      !info.data.subarray(0, 8).equals(CURVE_DISCRIMINATOR) ||
      info.data[48] !== 0) return false;
  // Older accounts had no quote_mint field. Newer accounts use the default
  // (all-zero) pubkey for SOL; reject partially appended data.
  if (info.data.length > 83 && info.data.length < 115) return false;
  return info.data.length < 115 ||
    info.data.subarray(83, 115).every((byte) => byte === 0);
}

async function jupiter(url) {
  const response = await fetch("https://api.jup.ag" + url, {
    headers: { "x-api-key": apiKey }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error("Jupiter " + response.status + ": " +
      (data.error || data.message || "request failed"));
  }
  return data;
}

async function getManyAccounts(keys) {
  const infos = [];
  for (let index = 0; index < keys.length; index += 100) {
    infos.push(...await connection.getMultipleAccountsInfo(keys.slice(index, index + 100)));
  }
  return infos;
}

async function inspectTokens(tokens) {
  const entries = tokens.map((token) => {
    const mint = new PublicKey(token.id);
    const [curve] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mint.toBuffer()], PUMP
    );
    return { token, mint, curve };
  });
  if (!entries.length) return [];
  const first = await getManyAccounts(
    entries.flatMap(({ mint, curve }) => [mint, curve])
  );
  const active = entries.flatMap((entry, index) => {
    const mintInfo = first[2 * index];
    const curveInfo = first[2 * index + 1];
    return mintInfo && TOKEN_PROGRAMS.has(mintInfo.owner.toBase58()) &&
      isSolCurve(curveInfo) ? [{ ...entry, tokenProgram: mintInfo.owner }] : [];
  });
  const withAta = active.map((entry) => {
    const [ata] = PublicKey.findProgramAddressSync(
      [wallet.toBuffer(), entry.tokenProgram.toBuffer(), entry.mint.toBuffer()],
      ATA_PROGRAM
    );
    return { ...entry, ata };
  });
  if (!withAta.length) return [];
  const accountInfos = await getManyAccounts(
    withAta.map(({ ata }) => ata)
  );
  return withAta.map(({ token, mint, curve, ata, tokenProgram }, index) => {
    const info = accountInfos[index];
    const ready = Boolean(info && info.owner.equals(tokenProgram) &&
      info.data.length >= 64 &&
      info.data.subarray(0, 32).equals(mint.toBuffer()) &&
      info.data.subarray(32, 64).equals(wallet.toBuffer()));
    return {
      mint: mint.toBase58(), symbol: token.symbol || "?",
      curve: curve.toBase58(), tokenProgram: tokenProgram.toBase58(),
      receivingAccount: ata.toBase58(), accountReady: ready,
      accountStatus: ready ? "reuse existing" :
        info ? "account needs review" : "create with first buy"
    };
  });
}

async function scan() {
  if (state.running || state.paused) return;
  state.running = true;
  try {
    const five = await jupiter("/tokens/v2/toptrending/5m?limit=50");
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const hour = await jupiter("/tokens/v2/toptrending/1h?limit=50");
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const [prices, balance, volumeInfo] = await Promise.all([
      jupiter("/price/v3?ids=" + SOL),
      connection.getBalance(wallet),
      connection.getAccountInfo(volumeAccount)
    ]);
    state.radar = trendRows(five, hour);
    const unique = new Map();
    const trending = new Map([...five, ...hour]
      .filter((token) => token?.id).map((token) => [token.id, token]));
    for (const launch of pumpFeed.snapshot()) {
      if (!trending.has(launch.id)) continue;
      const token = trending.get(launch.id);
      unique.set(launch.id, { ...token, symbol: token.symbol || launch.symbol });
    }
    for (const token of [...five, ...hour]) {
      if (!token?.id || !isPump(token) || unique.has(token.id)) continue;
      try { new PublicKey(token.id); unique.set(token.id, token); }
      catch (_) { /* Ignore invalid metadata. */ }
    }
    state.candidates = await inspectTokens([...unique.values()]);
    pumpFeed.setTradeMints(state.candidates.map((candidate) => candidate.mint));
    state.solUsd = Number(prices[SOL]?.usdPrice) || null;
    state.walletSol = balance / LAMPORTS_PER_SOL;
    state.pumpVolumeReady = Boolean(volumeInfo && volumeInfo.owner.equals(PUMP));
    state.lastError = null;
  } catch (error) {
    state.lastError = error.message;
    console.error("Pump preview scan:", error.message);
  } finally {
    state.lastScanAt = new Date().toISOString();
    state.running = false;
    if (streamDirty) scheduleStreamScan();
  }
}

function scheduleStreamScan() {
  streamDirty = true;
  if (streamScanTimer || state.paused) return;
  const sinceLast = Date.now() - Date.parse(state.lastScanAt || 0);
  const delay = Math.max(5000, STREAM_SCAN_MIN_MS - sinceLast);
  streamScanTimer = setTimeout(async () => {
    streamScanTimer = null;
    if (state.paused) return;
    if (state.running) return scheduleStreamScan();
    streamDirty = false;
    await scan();
  }, delay);
}

const app = express();
app.use(express.json({ limit: "20kb" }));
app.use("/api", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "dashboard.html")));
app.get("/health", (_req, res) => res.json({
  ok: true, tradingEnabled: TRADING_ENABLED,
  manualSell: manualSell.status(),
  lastScanAt: state.lastScanAt, lastError: state.lastError,
  running: state.running, paused: state.paused,
  pumpFeed: pumpFeed.status()
}));
function requireKey(req, res, next) {
  if (req.get("x-dashboard-key") !== dashboardKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
app.get("/api/basket", requireKey, (_req, res) => res.json({
  betUsd: BET_USD, wallet: WALLET,
  tradingEnabled: TRADING_ENABLED, paused: state.paused,
  manualSell: manualSell.status(),
  solUsd: state.solUsd, walletSol: state.walletSol,
  running: state.running, lastScanAt: state.lastScanAt,
  lastError: state.lastError, candidates: state.candidates, radar: state.radar,
  pumpVolumeReady: state.pumpVolumeReady,
  pumpVolumeAccount: volumeAccount.toBase58(),
  pumpFeed: pumpFeed.status(),
  tradeActivityLastMinute: pumpFeed.tradeActivity(),
  purchases: state.ledger
}));
app.post("/api/paper/prices", requireKey, async (req, res) => {
  const input = req.body?.mints;
  if (!Array.isArray(input) || input.length > 100 ||
      input.some((mint) => {
        if (typeof mint !== "string") return true;
        try { return new PublicKey(mint).toBase58() !== mint; }
        catch (_) { return true; }
      })) return res.status(400).json({ error: "Invalid token list" });
  try { res.json({ prices: await paperPrices([...new Set(input)]) }); }
  catch (_) { res.status(503).json({ error: "Market prices unavailable" }); }
});
app.get("/api/holdings", requireKey, async (_req, res) => {
  try { res.json({ holdings: await manualSell.holdings() }); }
  catch (_) { res.status(503).json({ error: "Wallet holdings unavailable" }); }
});
app.post("/api/sell/quote", requireKey, async (req, res) => {
  try { res.json(await manualSell.quote(req.body)); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
app.post("/api/sell", requireKey, async (req, res) => {
  try { res.json(await manualSell.sell(req.body?.quoteId)); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
app.post("/api/pause", requireKey, (_req, res) => {
  state.paused = !state.paused;
  if (ledgerPath) persist();
  if (!state.paused) {
    streamDirty = false;
    scan();
  } else if (streamScanTimer) {
    clearTimeout(streamScanTimer);
    streamScanTimer = null;
  }
  if (state.paused) pumpFeed.setTradeMints([]);
  res.json({ paused: state.paused });
});
app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("BecsBot Pump curve account preview running for", WALLET);
  pumpFeed.start();
  scan();
  setInterval(scan, SCAN_MS);
});
