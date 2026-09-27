require("dotenv").config();

const express = require("express");
const { PublicKey, Connection } = require("@solana/web3.js");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const RPC_URL = process.env.HELIUS_RPC_URL;

const BOT_WALLET =
  "4BWgYmzT8xuNMm9VygSwKpVct6Sxdcc685QvwtiasuKA";

const wallet = new PublicKey(BOT_WALLET);

if (!RPC_URL) {
  throw new Error("HELIUS_RPC_URL is not configured");
}

const connection = new Connection(RPC_URL, "confirmed");

app.get("/", (req, res) => {
  res.json({
    name: "BecsBot",
    status: "online",
    mode: "SAFE",
    tradingEnabled: false,
    wallet: wallet.toBase58()
  });
});

app.get("/health", async (req, res) => {
  try {
    const slot = await connection.getSlot();

    res.json({
      ok: true,
      rpcConnected: true,
      slot,
      tradingEnabled: false
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      rpcConnected: false,
      error: error.message,
      tradingEnabled: false
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`BecsBot online on port ${PORT}`);
  console.log(`Bot wallet: ${wallet.toBase58()}`);
  console.log("Trading: DISABLED");
});