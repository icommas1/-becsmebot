require("dotenv").config();
const express = require("express");
const { PublicKey } = require("@solana/web3.js");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const BOT_WALLET =
  "4BWgYmzT8xuNMm9VygSwKpVct6Sxdcc685QvwtiasuKA";

const wallet = new PublicKey(BOT_WALLET);

app.get("/", (req, res) => {
  res.json({
    name: "BecsBot",
    status: "online",
    mode: "SAFE",
    tradingEnabled: false,
    wallet: wallet.toBase58()
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    tradingEnabled: false
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`BecsBot online on port ${PORT}`);
  console.log(`Bot wallet: ${wallet.toBase58()}`);
  console.log("Trading: DISABLED");
});
