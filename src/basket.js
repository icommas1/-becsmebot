require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const { Connection, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const { createPumpFeed } = require("./pump-feed");

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

const apiKey = process.env.JUPITER_API_KEY;
const dashboardKey = process.env.DASHBOARD_KEY;
const rpcUrl = process.env.HELIUS_RPC_URL;
const dataDir = process.env.DATA_DIR;
if (!apiKey || !dashboardKey || !rpcUrl) {
  throw new Error("HELIUS_RPC_URL, JUPITER_API_KEY and DASHBOARD_KEY are required");
}

const wallet = new PublicKey(WALLET);
const connection = new Connection(rpcUrl, "confirmed");
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
  solUsd: null, walletSol: null, candidates: [], pumpVolumeReady: null, ledger: {}
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

function isPump(token) {
  return /pump/i.test(String(token.launchpad || ""));
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
app.use(express.json());
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "dashboard.html")));
app.get("/health", (_req, res) => res.json({
  ok: true, tradingEnabled: TRADING_ENABLED,
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
  solUsd: state.solUsd, walletSol: state.walletSol,
  running: state.running, lastScanAt: state.lastScanAt,
  lastError: state.lastError, candidates: state.candidates,
  pumpVolumeReady: state.pumpVolumeReady,
  pumpVolumeAccount: volumeAccount.toBase58(),
  pumpFeed: pumpFeed.status(),
  purchases: state.ledger
}));
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
  res.json({ paused: state.paused });
});
app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("BecsBot Pump curve account preview running for", WALLET);
  pumpFeed.start();
  scan();
  setInterval(scan, SCAN_MS);
});
