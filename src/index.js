require("dotenv").config();

const express = require("express");
const {
  PublicKey,
  Connection,
  LAMPORTS_PER_SOL
} = require("@solana/web3.js");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const RPC_URL = process.env.HELIUS_RPC_URL;

const BOT_WALLET =
  "4BWgYmzT8xuNMm9VygSwKpVct6Sxdcc685QvwtiasuKA";

if (!RPC_URL) {
  throw new Error("HELIUS_RPC_URL is not configured");
}

const wallet = new PublicKey(BOT_WALLET);
const connection = new Connection(RPC_URL, "confirmed");

// Basic BecsBot status
app.get("/", (req, res) => {
  res.json({
    name: "BecsBot",
    status: "online",
    mode: "SAFE",
    tradingEnabled: false,
    wallet: wallet.toBase58()
  });
});

// Verify Solana/Helius connection
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
    console.error("Health error:", error);

    res.status(500).json({
      ok: false,
      rpcConnected: false,
      error: error.message,
      tradingEnabled: false
    });
  }
});

// Read BecsBot wallet
app.get("/wallet", async (req, res) => {
  try {
    // SOL balance
    const lamports = await connection.getBalance(wallet);
    const solBalance = lamports / LAMPORTS_PER_SOL;

    // SPL token accounts owned by BecsBot
    const tokenAccounts =
      await connection.getParsedTokenAccountsByOwner(wallet, {
        programId: new PublicKey(
          "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        )
      });

    const tokens = tokenAccounts.value
      .map(({ account }) => {
        const info = account.data.parsed.info;
        const amount = info.tokenAmount;

        return {
          mint: info.mint,
          amount: amount.uiAmount,
          decimals: amount.decimals
        };
      })
      .filter((token) => token.amount && token.amount > 0);

    res.json({
      wallet: wallet.toBase58(),
      sol: solBalance,
      tokens,
      tokenCount: tokens.length,
      tradingEnabled: false,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Wallet error:", error);

    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`BecsBot online on port ${PORT}`);
  console.log(`Bot wallet: ${wallet.toBase58()}`);
  console.log("Trading: DISABLED");
});