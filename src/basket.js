require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { Connection, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const { createManualSell } = require("./manual-sell");
const { FEEDS, marketRows, positive } = require("./jupiter-market");

const SOL = "So11111111111111111111111111111111111111112";
const WALLET = "DJ9dHrRXSPEdyLEkJ96Hj79S7Qkt7mgrryT3Q5J5bVws";
const BET_USD = 1;
const SCAN_MS = 5 * 60 * 1000;
// Automatic live trading is deliberately disabled.
const TRADING_ENABLED = false;
const PRICE_CACHE_MS = 20000;
const JUPITER_GAP_MS = 1100;

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
const ledgerPath = dataDir ? path.join(dataDir, "basket.json") : null;
const state = {
  lastScanAt: null, lastError: null, running: false, paused: false,
  solUsd: null, walletSol: null, radar: [], feedStatus: {}, ledger: {}
};
const priceCache = new Map();
const searchCache = new Map();
let jupiterQueue = Promise.resolve();
let nextJupiterAt = 0;

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
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50);
    const prices = await jupiter("/price/v3?ids=" + chunk.join(","));
    for (const mint of chunk) {
      const price = positive(prices[mint]?.usdPrice);
      // Jupiter omits mints when it cannot supply a reliable price.
      const data = price ? { priceUsd: price, blockId: prices[mint].blockId } : null;
      result[mint] = data;
      priceCache.set(mint, { data, at: Date.now() });
    }
  }
  return result;
}

async function jupiter(url) {
  // A single queue covers scans, searches, and paper price updates on the Free tier.
  const request = jupiterQueue.catch(() => {}).then(async () => {
    const delay = Math.max(0, nextJupiterAt - Date.now());
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    nextJupiterAt = Date.now() + JUPITER_GAP_MS;
    const response = await fetch("https://api.jup.ag" + url, {
      headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(10000)
    });
    const data = await response.json();
    if (!response.ok) throw new Error("Jupiter " + response.status + ": " +
      (data.error || data.message || "request failed"));
    return data;
  });
  jupiterQueue = request.catch(() => {});
  return request;
}

async function scan() {
  if (state.running || state.paused) return;
  state.running = true;
  try {
    const feeds = {}, errors = [];
    for (const [name, url] of FEEDS) {
      try {
        const tokens = await jupiter(url);
        if (!Array.isArray(tokens)) throw new Error("invalid token list");
        feeds[name] = tokens;
        state.feedStatus[name] = { count: tokens.length, at: new Date().toISOString() };
      } catch (error) {
        errors.push(name + ": " + error.message);
        state.feedStatus[name] = { ...state.feedStatus[name], error: error.message };
      }
    }
    if (Object.keys(feeds).length) {
      const rows = marketRows(feeds);
      // A failed category does not erase its last known rows.
      const failed = FEEDS.map(([name]) => name).filter((name) => !(name in feeds));
      for (const old of state.radar) {
        const oldFeeds = old.feeds.filter((name) => failed.includes(name));
        if (!oldFeeds.length) continue;
        const current = rows.find((row) => row.mint === old.mint);
        if (current) {
          current.feeds.push(...oldFeeds.filter((name) => !current.feeds.includes(name)));
          for (const name of oldFeeds) current.ranks[name] = old.ranks[name];
        } else rows.push({ ...old, feeds: oldFeeds });
      }
      state.radar = rows;
    }
    try {
      const prices = await jupiter("/price/v3?ids=" + SOL);
      state.solUsd = positive(prices[SOL]?.usdPrice) ?? state.solUsd;
    } catch (error) { errors.push("SOL price: " + error.message); }
    try { state.walletSol = await connection.getBalance(wallet) / LAMPORTS_PER_SOL; }
    catch (error) { errors.push("wallet balance: " + error.message); }
    state.lastError = errors.length ? errors.join("; ") : null;
  } catch (error) {
    state.lastError = error.message;
    console.error("Jupiter market scan:", error.message);
  } finally {
    state.lastScanAt = new Date().toISOString();
    state.running = false;
  }
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
  feeds: state.feedStatus
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
  lastError: state.lastError, radar: state.radar, feeds: state.feedStatus,
  purchases: state.ledger
}));
app.get("/api/search", requireKey, async (req, res) => {
  const query = String(req.query.q || "").trim();
  if (query.length < 2 || query.length > 80) return res.status(400).json({ error: "Enter 2–80 characters" });
  try {
    const cached = searchCache.get(query.toLowerCase());
    if (cached && Date.now() - cached.at < 60000) return res.json({ rows: cached.rows });
    const tokens = await jupiter("/tokens/v2/search?query=" + encodeURIComponent(query));
    if (!Array.isArray(tokens)) throw new Error("Invalid search response");
    const rows = marketRows({ search: tokens });
    searchCache.set(query.toLowerCase(), { rows, at: Date.now() });
    if (searchCache.size > 100) searchCache.delete(searchCache.keys().next().value);
    res.json({ rows });
  } catch (error) { res.status(503).json({ error: error.message }); }
});
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
    scan();
  }
  res.json({ paused: state.paused });
});
app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("BecsBot Jupiter market terminal running for", WALLET);
  scan();
  setInterval(scan, SCAN_MS);
});
