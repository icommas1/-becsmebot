require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const {
  Connection, Keypair, PublicKey, VersionedTransaction, LAMPORTS_PER_SOL
} = require("@solana/web3.js");
const bs58 = require("bs58").default;

const SOL = "So11111111111111111111111111111111111111112";
const PROGRAMS = [
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
];
const WALLET = "DJ9dHrRXSPEdyLEkJ96Hj79S7Qkt7mgrryT3Q5J5bVws";
const BET_USD = 1;
const SCAN_MS = 5 * 60 * 1000;
const LIVE_TRADING_UNLOCKED = false;

const apiKey = process.env.JUPITER_API_KEY;
const dashboardKey = process.env.DASHBOARD_KEY;
const rpcUrl = process.env.HELIUS_RPC_URL;
const dataDir = process.env.DATA_DIR;
if (!apiKey || !dashboardKey || !rpcUrl) {
  throw new Error("HELIUS_RPC_URL, JUPITER_API_KEY and DASHBOARD_KEY are required");
}
if (LIVE_TRADING_UNLOCKED && !dataDir) {
  throw new Error("Live trading requires persistent DATA_DIR");
}

const wallet = new PublicKey(WALLET);
const connection = new Connection(rpcUrl, "confirmed");
const ledgerPath = dataDir ? path.join(dataDir, "basket.json") : null;
const state = {
  lastScanAt: null, lastError: null, running: false, paused: false,
  solUsd: null, walletSol: null, candidates: [], quotes: [], ledger: {}
};

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

function oneDollarInLamports(price) {
  if (!Number.isFinite(price) || price <= 0) throw new Error("SOL price unavailable");
  return Math.floor(BET_USD * LAMPORTS_PER_SOL / price);
}

function isPump(token) {
  return /pump/i.test(String(token.launchpad || ""));
}

function eligible(token, owned) {
  try {
    new PublicKey(token.id);
    return token.id !== SOL && !owned.has(token.id) &&
      !state.ledger[token.id] && !token.freezeAuthority &&
      !token.mintAuthority && Number(token.liquidity) >= 10000;
  } catch (_) {
    return false;
  }
}

const delay = () => new Promise((resolve) => setTimeout(resolve, 1100));

async function jupiter(url, options = {}) {
  const response = await fetch("https://api.jup.ag" + url, {
    ...options,
    headers: {
      "x-api-key": apiKey,
      ...(options.body ? { "Content-Type": "application/json" } : {})
    }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error("Jupiter " + response.status + ": " +
      (data.error || data.message || "request failed"));
  }
  return data;
}

async function ownedMints() {
  const results = await Promise.all(PROGRAMS.map((programId) =>
    connection.getParsedTokenAccountsByOwner(wallet, {
      programId: new PublicKey(programId)
    })
  ));
  const owned = new Set();
  for (const result of results) {
    for (const entry of result.value) {
      const info = entry.account.data.parsed.info;
      if (BigInt(info.tokenAmount.amount) > 0n) owned.add(info.mint);
    }
  }
  return owned;
}

function signer() {
  if (!process.env.SOLANA_PRIVATE_KEY) throw new Error("Signer missing");
  const account = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_PRIVATE_KEY));
  if (!account.publicKey.equals(wallet)) throw new Error("Signer wallet mismatch");
  return account;
}

async function quote(token, amount) {
  const params = new URLSearchParams({
    inputMint: SOL, outputMint: token.id,
    amount: String(amount), taker: WALLET
  });
  return jupiter("/swap/v2/order?" + params);
}

async function buyOnce(token, amount, order) {
  if (!LIVE_TRADING_UNLOCKED || state.paused) return;
  if (!order.transaction || !order.requestId) return;
  const account = signer();
  if (await connection.getBalance(wallet) <= amount) return;
  state.ledger[token.id] = { status: "pending", at: new Date().toISOString() };
  persist();
  try {
    const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction, "base64"));
    tx.sign([account]);
    const result = await jupiter("/swap/v2/execute", {
      method: "POST",
      body: JSON.stringify({
        signedTransaction: Buffer.from(tx.serialize()).toString("base64"),
        requestId: order.requestId
      })
    });
    state.ledger[token.id] = {
      status: result.status === "Success" ? "filled" : "unknown",
      signature: result.signature || null, at: new Date().toISOString()
    };
  } catch (error) {
    state.ledger[token.id] = {
      status: "unknown", error: error.message, at: new Date().toISOString()
    };
  }
  persist();
}

async function scan() {
  if (state.running || state.paused) return;
  state.running = true;
  try {
    const five = await jupiter("/tokens/v2/toptrending/5m?limit=50");
    await delay();
    const hour = await jupiter("/tokens/v2/toptrending/1h?limit=50");
    await delay();
    const prices = await jupiter("/price/v3?ids=" + SOL);
    const price = Number(prices[SOL]?.usdPrice);
    const amount = oneDollarInLamports(price);
    const [owned, balance] = await Promise.all([
      ownedMints(), connection.getBalance(wallet)
    ]);
    const unique = new Map();
    for (const token of [...five, ...hour]) {
      if (token?.id && !unique.has(token.id)) unique.set(token.id, token);
    }
    const tokens = [...unique.values()].filter((token) => eligible(token, owned));
    state.solUsd = price;
    state.walletSol = balance / LAMPORTS_PER_SOL;
    state.candidates = tokens.map((token) => ({
      mint: token.id, symbol: token.symbol,
      source: isPump(token) ? "Pump.fun token on Jupiter trending" : "Jupiter trending",
      liquidity: token.liquidity
    }));
    state.quotes = [];
    // Rotate through the entire list, including the end that a plain slice misses.
    // Preview only: live trading remains hard locked off.
    const offset = Math.floor(Date.now() / SCAN_MS) % Math.max(1, tokens.length);
    const sample = Array.from({ length: Math.min(5, tokens.length) },
      (_, index) => tokens[(offset + index) % tokens.length]);
    for (const token of sample) {
      await delay();
      try {
        const order = await quote(token, amount);
        const available = Boolean(order.transaction);
        state.quotes.push({
          mint: token.id, symbol: token.symbol,
          sol: amount / LAMPORTS_PER_SOL,
          routeAvailable: available, feeBps: order.feeBps ?? null,
          signatureFeePayer: order.signatureFeePayer ?? null,
          rentFeePayer: order.rentFeePayer ?? null
        });
        if (available) await buyOnce(token, amount, order);
      } catch (error) {
        state.quotes.push({ mint: token.id, symbol: token.symbol, error: error.message });
      }
    }
    state.lastError = null;
  } catch (error) {
    state.lastError = error.message;
    console.error("Basket scan:", error.message);
  } finally {
    state.lastScanAt = new Date().toISOString();
    state.running = false;
  }
}

const app = express();
app.use(express.json());
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "dashboard.html")));
app.get("/health", (_req, res) => res.json({
  ok: true, tradingEnabled: false,
  lastScanAt: state.lastScanAt, lastError: state.lastError,
  running: state.running, paused: state.paused
}));
function requireKey(req, res, next) {
  if (req.get("x-dashboard-key") !== dashboardKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
app.get("/api/basket", requireKey, (_req, res) => res.json({
  betUsd: BET_USD, wallet: WALLET,
  tradingEnabled: false, paused: state.paused,
  solUsd: state.solUsd, walletSol: state.walletSol,
  running: state.running, lastScanAt: state.lastScanAt,
  lastError: state.lastError, candidates: state.candidates,
  quotes: state.quotes, purchases: state.ledger
}));
app.post("/api/pause", requireKey, (_req, res) => {
  state.paused = !state.paused;
  if (ledgerPath) persist();
  if (!state.paused) scan();
  res.json({ paused: state.paused });
});
app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("BecsBot basket preview running for", WALLET);
  scan();
  setInterval(scan, SCAN_MS);
});
