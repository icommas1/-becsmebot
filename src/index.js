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
if (!SOLANA_PRIVATE_KEY) {
  throw new Error("SOLANA_PRIVATE_KEY is missing");
}
const signer = Keypair.fromSecretKey(
  bs58.decode(SOLANA_PRIVATE_KEY)
);

if (signer.publicKey.toBase58() !== BOT_WALLET) {
  throw new Error("SOLANA_PRIVATE_KEY does not match BOT_WALLET");
}
const BOT_WALLET =
  "DJ9dHrRXSPEdyLEkJ96Hj79S7Qkt7mgrryT3Q5J5bVws";

if (!RPC_URL) {
  throw new Error("HELIUS_RPC_URL is missing");
}

if (!JUPITER_API_KEY) {
  throw new Error("JUPITER_API_KEY is missing");
}

const wallet = new PublicKey(BOT_WALLET);
const connection = new Connection(RPC_URL, "confirmed");

// BecsBot status
app.get("/", (req, res) => {
  res.json({
    name: "BecsBot",
    status: "online",
    mode: "SAFE",
    tradingEnabled: false,
    wallet: wallet.toBase58()
  });
});

// Helius connection test
app.get("/health", async (req, res) => {
  try {
    const slot = await connection.getSlot();

    res.json({
      ok: true,
      rpcConnected: true,
      slot,
      jupiterConfigured: !!JUPITER_API_KEY,
      tradingEnabled: false
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});
app.get("/signer-test", (req, res) => {
  res.json({
    ok: true,
    signerConfigured: true,
    signerWallet: signer.publicKey.toBase58(),
    expectedWallet: BOT_WALLET,
    matches: signer.publicKey.toBase58() === BOT_WALLET,
    tradingEnabled: false
  });
});
// Wallet tracking
app.get("/wallet", async (req, res) => {
  try {
    const balance = await connection.getBalance(wallet);

    const tokenAccounts =
      await connection.getParsedTokenAccountsByOwner(wallet, {
        programId: new PublicKey(
          "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        )
      });

    const tokens = tokenAccounts.value
      .map((account) => {
        const info =
          account.account.data.parsed.info;

        return {
          mint: info.mint,
          amount: info.tokenAmount.uiAmount
        };
      })
      .filter((token) => token.amount > 0);

    res.json({
      wallet: wallet.toBase58(),
      sol: balance / LAMPORTS_PER_SOL,
      tokens,
      tokenCount: tokens.length,
      tradingEnabled: false,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Jupiter API connection test
// Quote only - DOES NOT execute a trade
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
      `https://api.jup.ag/swap/v2/order?${params}`,
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
        `Jupiter HTTP ${response.status}`
      );
    }

    res.json({
      ok: true,
      jupiterConnected: true,
      tradingEnabled: false,
      test: "SOL to USDC quote only",
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`BecsBot online on port ${PORT}`);
  console.log(`Bot wallet: ${wallet.toBase58()}`);
  console.log("Helius RPC: configured");
  console.log("Jupiter API: configured");
  console.log("Trading: DISABLED");
});