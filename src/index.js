require("dotenv").config();

const express = require("express");
const {
  PublicKey,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL
} = require("@solana/web3.js");
const bs58 = require("bs58").default;

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const RPC_URL = process.env.HELIUS_RPC_URL;
const JUPITER_API_KEY = process.env.JUPITER_API_KEY;
const SOLANA_PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;
const DASHBOARD_KEY = process.env.DASHBOARD_KEY;

const BOT_WALLET =
  "DJ9dHrRXSPEdyLEkJ96Hj79S7Qkt7mgrryT3Q5J5bVws";

const TOKEN_PROGRAM_ID =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

// MASTER SAFETY LOCK.
// Dashboard settings cannot override this.
const LIVE_TRADING_UNLOCKED = false;

if (!RPC_URL) throw new Error("HELIUS_RPC_URL is missing");
if (!JUPITER_API_KEY) throw new Error("JUPITER_API_KEY is missing");
if (!DASHBOARD_KEY) throw new Error("DASHBOARD_KEY is missing");

const wallet = new PublicKey(BOT_WALLET);
const connection = new Connection(RPC_URL, "confirmed");

const config = {
  autoTrading: false,
  emergencyStop: false,
  tradeSizeUsd: 25,
  takeProfitPercent: 20,
  stopLossPercent: 10,
  slippagePercent: 1,
  maxOpenPositions: 3,
  sources: {
    pumpFun: true,
    pumpSwap: true,
    bitquery: false
  }
};

const state = {
  startedAt: new Date().toISOString(),
  lastConfigUpdate: null,
  lastEmergencyStop: null,
  openPositions: [],
  discoveredTokens: []
};

function getSigner() {
  if (!SOLANA_PRIVATE_KEY) {
    throw new Error("SOLANA_PRIVATE_KEY is missing");
  }

  const secretKey = bs58.decode(SOLANA_PRIVATE_KEY);
  return Keypair.fromSecretKey(secretKey);
}

function tradingEnabled() {
  return (
    LIVE_TRADING_UNLOCKED &&
    config.autoTrading &&
    !config.emergencyStop
  );
}

function safeNumber(value, current, min, max) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return current;
  }

  return Math.min(max, Math.max(min, number));
}

function getPublicConfig() {
  return {
    ...config,
    sources: { ...config.sources },
    liveTradingUnlocked: LIVE_TRADING_UNLOCKED,
    tradingEnabled: tradingEnabled()
  };
}

function requireDashboardKey(req, res, next) {
  const suppliedKey = req.get("x-dashboard-key");

  if (!suppliedKey || suppliedKey !== DASHBOARD_KEY) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
  }

  next();
}

// ============================================================
// DASHBOARD
// ============================================================

app.get("/", (req, res) => {
  res.type("html").send(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>
<title>BecsBot</title>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #090c13;
  color: #f5f7ff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

main {
  max-width: 850px;
  margin: auto;
  padding: 18px;
}

h1 {
  margin-bottom: 4px;
}

.subtitle {
  color: #9aa4b7;
  margin-bottom: 20px;
}

.card {
  background: #121823;
  border: 1px solid #273041;
  border-radius: 16px;
  padding: 18px;
  margin-bottom: 15px;
}

.warning {
  background: #33290f;
  border: 1px solid #6d5721;
  color: #ffd166;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid #242c3a;
}

.row:last-child {
  border-bottom: none;
}

.label {
  color: #9aa4b7;
}

.value {
  text-align: right;
  overflow-wrap: anywhere;
}

.green {
  color: #56e58b;
}

.red {
  color: #ff6969;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px;
}

.field {
  background: #0c1119;
  padding: 12px;
  border-radius: 11px;
}

.field label {
  display: block;
  color: #9aa4b7;
  font-size: 13px;
  margin-bottom: 6px;
}

input[type="number"] {
  width: 100%;
  padding: 10px;
  background: #080b11;
  color: white;
  border: 1px solid #354055;
  border-radius: 8px;
  font-size: 16px;
}

input[type="checkbox"] {
  width: 24px;
  height: 24px;
}

button {
  width: 100%;
  padding: 14px;
  border: none;
  border-radius: 11px;
  margin-top: 12px;
  font-size: 16px;
  font-weight: bold;
  cursor: pointer;
}

.save {
  background: #6574ff;
  color: white;
}

.stop {
  background: #d83b3b;
  color: white;
}

.clear {
  background: #30394a;
  color: white;
}

.note {
  color: #9aa4b7;
  font-size: 13px;
  margin-top: 10px;
}

#message,
#emergencyMessage {
  margin-top: 10px;
}
</style>
</head>

<body>
<main>

<h1>BecsBot</h1>
<div class="subtitle">Solana Trading Control Center</div>

<div class="card warning">
  LIVE TRADING IS HARD-LOCKED OFF.
  Settings can be configured safely while the trading engine is built.
</div>

<div class="card">
  <h2>Status</h2>

  <div class="row">
    <span class="label">Bot</span>
    <span id="botStatus" class="value">Loading...</span>
  </div>

  <div class="row">
    <span class="label">Wallet</span>
    <span id="wallet" class="value">Loading...</span>
  </div>

  <div class="row">
    <span class="label">SOL</span>
    <span id="balance" class="value">Loading...</span>
  </div>

  <div class="row">
    <span class="label">Signer</span>
    <span id="signer" class="value">Loading...</span>
  </div>

  <div class="row">
    <span class="label">Live Trading</span>
    <span id="trading" class="value red">DISABLED</span>
  </div>

  <div class="row">
    <span class="label">Open Positions</span>
    <span id="positions" class="value">0</span>
  </div>
</div>

<div class="card">
  <h2>Trading Settings</h2>

  <div class="grid">
    <div class="field">
      <label>Trade Size ($)</label>
      <input id="tradeSize" type="number" min="1">
    </div>

    <div class="field">
      <label>Take Profit (%)</label>
      <input
        id="takeProfit"
        type="number"
        min="0.1"
        step="0.1"
      >
    </div>

    <div class="field">
      <label>Stop Loss (%)</label>
      <input
        id="stopLoss"
        type="number"
        min="0.1"
        step="0.1"
      >
    </div>

    <div class="field">
      <label>Slippage (%)</label>
      <input
        id="slippage"
        type="number"
        min="0.1"
        step="0.1"
      >
    </div>

    <div class="field">
      <label>Max Open Positions</label>
      <input id="maxPositions" type="number" min="1">
    </div>
  </div>
</div>

<div class="card">
  <h2>Token Sources</h2>

  <div class="row">
    <span>Pump.fun</span>
    <input id="pumpFun" type="checkbox">
  </div>

  <div class="row">
    <span>PumpSwap</span>
    <input id="pumpSwap" type="checkbox">
  </div>

  <div class="row">
    <span>Bitquery / DEXrabbit</span>
    <input id="bitquery" type="checkbox">
  </div>

  <div class="note">
    Bitquery / DEXrabbit is reserved for later integration.
  </div>
</div>

<div class="card">
  <h2>Automation</h2>

  <div class="row">
    <span>Auto Trading</span>
    <input id="autoTrading" type="checkbox">
  </div>

  <button class="save" onclick="saveSettings()">
    Save Settings
  </button>

  <div id="message"></div>
</div>

<div class="card">
  <h2>Emergency Control</h2>

  <button class="stop" onclick="stopBot()">
    EMERGENCY STOP
  </button>

  <button class="clear" onclick="clearStop()">
    Clear Emergency Stop
  </button>

  <div id="emergencyMessage"></div>
</div>

<div class="card">
  <h2>Runtime</h2>

  <div class="row">
    <span class="label">Discovered Tokens</span>
    <span id="discovered">0</span>
  </div>

  <div class="row">
    <span class="label">Emergency Stop</span>
    <span id="emergencyState">OFF</span>
  </div>
</div>

<div class="note">
  Settings are currently stored in memory.
  A Railway restart or redeploy resets them to defaults.
</div>

</main>

<script>
let dashboardKey =
  sessionStorage.getItem("becsDashboardKey") || "";

function getDashboardKey() {
  if (!dashboardKey) {
    dashboardKey =
      prompt("Enter BecsBot dashboard key:") || "";

    if (dashboardKey) {
      sessionStorage.setItem(
        "becsDashboardKey",
        dashboardKey
      );
    }
  }

  return dashboardKey;
}

function clearDashboardKey() {
  dashboardKey = "";
  sessionStorage.removeItem("becsDashboardKey");
}

function protectedOptions(method, body) {
  const options = {
    method,
    headers: {
      "x-dashboard-key": getDashboardKey()
    }
  };

  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  return options;
}

async function getJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401) {
      clearDashboardKey();
    }

    throw new Error(data.error || "Request failed");
  }

  return data;
}

async function loadDashboard() {
  try {
    const results = await Promise.all([
      getJson("/api/status"),
      getJson("/wallet"),
      getJson("/signer-test"),
      getJson("/api/config")
    ]);

    const status = results[0];
    const walletData = results[1];
    const signerData = results[2];
    const cfg = results[3];

    const botStatus =
      document.getElementById("botStatus");

    botStatus.textContent = status.status;
    botStatus.className = "value green";

    document.getElementById("wallet").textContent =
      walletData.wallet;

    document.getElementById("balance").textContent =
      Number(walletData.sol).toFixed(6) + " SOL";

    const signer =
      document.getElementById("signer");

    signer.textContent =
      signerData.matches
        ? "VERIFIED"
        : "NOT VERIFIED";

    signer.className =
      signerData.matches
        ? "value green"
        : "value red";

    const trading =
      document.getElementById("trading");

    trading.textContent =
      status.tradingEnabled
        ? "ENABLED"
        : "DISABLED";

    trading.className =
      status.tradingEnabled
        ? "value green"
        : "value red";

    document.getElementById("positions").textContent =
      status.openPositions;

    document.getElementById("discovered").textContent =
      status.discoveredTokens;

    document.getElementById("emergencyState").textContent =
      status.emergencyStop ? "ON" : "OFF";

    document.getElementById("tradeSize").value =
      cfg.tradeSizeUsd;

    document.getElementById("takeProfit").value =
      cfg.takeProfitPercent;

    document.getElementById("stopLoss").value =
      cfg.stopLossPercent;

    document.getElementById("slippage").value =
      cfg.slippagePercent;

    document.getElementById("maxPositions").value =
      cfg.maxOpenPositions;

    document.getElementById("pumpFun").checked =
      cfg.sources.pumpFun;

    document.getElementById("pumpSwap").checked =
      cfg.sources.pumpSwap;

    document.getElementById("bitquery").checked =
      cfg.sources.bitquery;

    document.getElementById("autoTrading").checked =
      cfg.autoTrading;

  } catch (error) {
    const botStatus =
      document.getElementById("botStatus");

    botStatus.textContent =
      "ERROR: " + error.message;

    botStatus.className =
      "value red";
  }
}

async function saveSettings() {
  const message =
    document.getElementById("message");

  try {
    const body = {
      tradeSizeUsd:
        document.getElementById("tradeSize").value,

      takeProfitPercent:
        document.getElementById("takeProfit").value,

      stopLossPercent:
        document.getElementById("stopLoss").value,

      slippagePercent:
        document.getElementById("slippage").value,

      maxOpenPositions:
        document.getElementById("maxPositions").value,

      autoTrading:
        document.getElementById("autoTrading").checked,

      sources: {
        pumpFun:
          document.getElementById("pumpFun").checked,

        pumpSwap:
          document.getElementById("pumpSwap").checked,

        bitquery:
          document.getElementById("bitquery").checked
      }
    };

    const data = await getJson(
      "/api/config",
      protectedOptions("POST", body)
    );

    message.textContent =
      data.message +
      " — live trading remains locked.";

    await loadDashboard();

  } catch (error) {
    message.textContent =
      "ERROR: " + error.message;
  }
}

async function stopBot() {
  const message =
    document.getElementById("emergencyMessage");

  try {
    const data = await getJson(
      "/api/emergency-stop",
      protectedOptions("POST")
    );

    message.textContent = data.message;

    await loadDashboard();

  } catch (error) {
    message.textContent =
      "ERROR: " + error.message;
  }
}

async function clearStop() {
  const message =
    document.getElementById("emergencyMessage");

  try {
    const data = await getJson(
      "/api/emergency-clear",
      protectedOptions("POST")
    );

    message.textContent = data.message;

    await loadDashboard();

  } catch (error) {
    message.textContent =
      "ERROR: " + error.message;
  }
}

loadDashboard();
setInterval(loadDashboard, 10000);
</script>

</body>
</html>
  `);
});

// ============================================================
// STATUS
// ============================================================

app.get("/api/status", (req, res) => {
  res.json({
    name: "BecsBot",
    status: "online",
    mode: "SAFE",
    wallet: wallet.toBase58(),
    liveTradingUnlocked: LIVE_TRADING_UNLOCKED,
    autoTrading: config.autoTrading,
    emergencyStop: config.emergencyStop,
    tradingEnabled: tradingEnabled(),
    openPositions: state.openPositions.length,
    discoveredTokens: state.discoveredTokens.length,
    startedAt: state.startedAt,
    lastConfigUpdate: state.lastConfigUpdate,
    lastEmergencyStop: state.lastEmergencyStop
  });
});

// ============================================================
// CONFIG
// ============================================================

app.get("/api/config", (req, res) => {
  res.json(getPublicConfig());
});

app.post(
  "/api/config",
  requireDashboardKey,
  (req, res) => {
    const body = req.body || {};

    config.tradeSizeUsd =
      safeNumber(
        body.tradeSizeUsd,
        config.tradeSizeUsd,
        1,
        10000
      );

    config.takeProfitPercent =
      safeNumber(
        body.takeProfitPercent,
        config.takeProfitPercent,
        0.1,
        1000
      );

    config.stopLossPercent =
      safeNumber(
        body.stopLossPercent,
        config.stopLossPercent,
        0.1,
        100
      );

    config.slippagePercent =
      safeNumber(
        body.slippagePercent,
        config.slippagePercent,
        0.1,
        20
      );

    config.maxOpenPositions =
      Math.round(
        safeNumber(
          body.maxOpenPositions,
          config.maxOpenPositions,
          1,
          50
        )
      );

    if (typeof body.autoTrading === "boolean") {
      config.autoTrading = body.autoTrading;
    }

    if (
      body.sources &&
      typeof body.sources === "object"
    ) {
      if (
        typeof body.sources.pumpFun === "boolean"
      ) {
        config.sources.pumpFun =
          body.sources.pumpFun;
      }

      if (
        typeof body.sources.pumpSwap === "boolean"
      ) {
        config.sources.pumpSwap =
          body.sources.pumpSwap;
      }

      if (
        typeof body.sources.bitquery === "boolean"
      ) {
        config.sources.bitquery =
          body.sources.bitquery;
      }
    }

    state.lastConfigUpdate =
      new Date().toISOString();

    res.json({
      ok: true,
      message: "Settings saved",
      config: getPublicConfig()
    });
  }
);

// ============================================================
// EMERGENCY CONTROLS
// ============================================================

app.post(
  "/api/emergency-stop",
  requireDashboardKey,
  (req, res) => {
    config.emergencyStop = true;
    config.autoTrading = false;

    state.lastEmergencyStop =
      new Date().toISOString();

    res.json({
      ok: true,
      emergencyStop: true,
      tradingEnabled: false,
      message:
        "Emergency stop activated. Auto trading disabled."
    });
  }
);

app.post(
  "/api/emergency-clear",
  requireDashboardKey,
  (req, res) => {
    config.emergencyStop = false;

    res.json({
      ok: true,
      emergencyStop: false,
      tradingEnabled: tradingEnabled(),
      message:
        "Emergency stop cleared. Master trading lock remains OFF."
    });
  }
);

// ============================================================
// HEALTH
// ============================================================

app.get("/health", async (req, res) => {
  try {
    const slot = await connection.getSlot();

    res.json({
      ok: true,
      rpcConnected: true,
      slot,
      jupiterConfigured: !!JUPITER_API_KEY,
      signerConfigured: !!SOLANA_PRIVATE_KEY,
      dashboardSecurityConfigured: !!DASHBOARD_KEY,
      tradingEnabled: tradingEnabled()
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// ============================================================
// SIGNER VERIFICATION
// DOES NOT SIGN OR SEND A TRANSACTION.
// ============================================================

app.get("/signer-test", (req, res) => {
  try {
    const signer = getSigner();
    const signerWallet =
      signer.publicKey.toBase58();

    res.json({
      ok: true,
      signerConfigured: true,
      signerWallet,
      expectedWallet: BOT_WALLET,
      matches: signerWallet === BOT_WALLET,
      tradingEnabled: tradingEnabled()
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      signerConfigured: false,
      tradingEnabled: false,
      error: error.message
    });
  }
});

// ============================================================
// WALLET
// ============================================================

app.get("/wallet", async (req, res) => {
  try {
    const balance =
      await connection.getBalance(wallet);

    const tokenAccounts =
      await connection.getParsedTokenAccountsByOwner(
        wallet,
        {
          programId:
            new PublicKey(TOKEN_PROGRAM_ID)
        }
      );

    const tokens = tokenAccounts.value
      .map((account) => {
        const info =
          account.account.data.parsed.info;

        return {
          mint: info.mint,
          amount: info.tokenAmount.uiAmount
        };
      })
      .filter(
        (token) => token.amount > 0
      );

    res.json({
      wallet: wallet.toBase58(),
      sol: balance / LAMPORTS_PER_SOL,
      tokens,
      tokenCount: tokens.length,
      tradingEnabled: tradingEnabled(),
      updatedAt: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// ============================================================
// JUPITER CONNECTION TEST
// DOES NOT SIGN OR EXECUTE A TRADE.
// ============================================================

app.get("/jupiter-test", async (req, res) => {
  try {
    const params = new URLSearchParams({
      inputMint:
        "So11111111111111111111111111111111111111112",

      outputMint:
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",

      amount: "1000000"
    });

    const response = await fetch(
      "https://api.jup.ag/swap/v2/order?" +
        params.toString(),
      {
        headers: {
          "x-api-key": JUPITER_API_KEY
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error ||
        data.message ||
        "Jupiter HTTP " + response.status
      );
    }

    res.json({
      ok: true,
      jupiterConnected: true,
      tradingEnabled: tradingEnabled(),
      test: "SOL to USDC request only",
      quote: data
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      jupiterConnected: false,
      tradingEnabled: false,
      error: error.message
    });
  }
});

// ============================================================
// POSITIONS
// ============================================================

app.get("/api/positions", (req, res) => {
  res.json({
    count: state.openPositions.length,
    positions: state.openPositions,
    tradingEnabled: tradingEnabled()
  });
});

// ============================================================
// DISCOVERED TOKENS
// ============================================================

app.get("/api/discovered-tokens", (req, res) => {
  res.json({
    count: state.discoveredTokens.length,
    tokens: state.discoveredTokens
  });
});

// ============================================================
// SERVER
// ============================================================

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    "BecsBot online on port " + PORT
  );

  console.log(
    "Bot wallet: " + wallet.toBase58()
  );

  console.log(
    "Helius RPC: configured"
  );

  console.log(
    "Jupiter API: configured"
  );

  console.log(
    "Dashboard security: configured"
  );

  console.log(
    "Solana signer: " +
      (
        SOLANA_PRIVATE_KEY
          ? "configured"
          : "missing"
      )
  );

  console.log(
    "Live trading master lock: DISABLED"
  );
});