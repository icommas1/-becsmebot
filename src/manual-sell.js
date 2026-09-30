const crypto = require("node:crypto");
const { PublicKey, Keypair, VersionedTransaction, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const bs58 = require("bs58").default;

const SOL = "So11111111111111111111111111111111111111112";
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_PROGRAMS = [
  new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
];
const QUOTE_TTL_MS = 30000;

function parseSlippage(value) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(value))) {
    throw new Error("Slippage must be between 0.1% and 50%, in 0.01% steps");
  }
  const percent = Number(value);
  if (percent < 0.1 || percent > 50) {
    throw new Error("Slippage must be between 0.1% and 50%, in 0.01% steps");
  }
  return Math.round(percent * 100);
}

function parseSellRequest({ mint, percent, slippage }) {
  const address = new PublicKey(mint);
  if (address.toBase58() !== mint || mint === SOL ||
      ![25, 50, 100].includes(percent)) {
    throw new Error("Choose a token and 25%, 50%, or 100%");
  }
  return { mint, percent, slippageBps: parseSlippage(slippage) };
}

function associatedAccount(wallet, mint, tokenProgram) {
  return PublicKey.findProgramAddressSync([
    wallet.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()
  ], ATA_PROGRAM)[0];
}

function createManualSell({ connection, wallet, apiKey, secret, enabled = false,
  request = fetch, now = Date.now }) {
  const pending = new Map();
  let busy = false;
  let signer = null;
  let signerMatches = false;
  try {
    if (secret) {
      const bytes = secret.trim().startsWith("[") ?
        Uint8Array.from(JSON.parse(secret)) : bs58.decode(secret.trim());
      signer = Keypair.fromSecretKey(bytes);
      signerMatches = signer.publicKey.equals(wallet);
    }
  } catch (_) { /* Invalid key is reported as unavailable, never logged. */ }

  function status() {
    return { enabled: enabled && signerMatches, signerMatches };
  }

  async function holdings() {
    const responses = await Promise.all(TOKEN_PROGRAMS.map((programId) =>
      connection.getParsedTokenAccountsByOwner(wallet, { programId })));
    return responses.flatMap((response, index) => response.value.flatMap((account) => {
      const info = account.account.data?.parsed?.info;
      const mint = info?.mint;
      const amount = info?.tokenAmount?.amount;
      if (!mint || !/^\d+$/.test(amount || "") || BigInt(amount) === 0n) return [];
      const ata = associatedAccount(wallet, new PublicKey(mint), TOKEN_PROGRAMS[index]);
      if (!account.pubkey.equals(ata)) return [];
      return [{ mint, amount, decimals: info.tokenAmount.decimals,
        displayAmount: info.tokenAmount.uiAmountString,
        tokenProgram: TOKEN_PROGRAMS[index].toBase58(), account: ata.toBase58() }];
    }));
  }

  async function balanceFor(mint) {
    const entry = (await holdings()).find((item) => item.mint === mint);
    if (!entry) throw new Error("This wallet has no tokens in its receiving account");
    return entry;
  }

  async function order(mint, amount, slippageBps, taker = false) {
    const params = new URLSearchParams({
      inputMint: mint, outputMint: SOL, amount: String(amount),
      slippageBps: String(slippageBps)
    });
    if (taker) params.set("taker", wallet.toBase58());
    const response = await request("https://api.jup.ag/swap/v2/order?" + params, {
      headers: { "x-api-key": apiKey }
    });
    const data = await response.json();
    if (!response.ok || !/^\d+$/.test(String(data.outAmount || ""))) {
      throw new Error("Jupiter could not quote this sale: " +
        (data.errorMessage || data.error || response.status));
    }
    return data;
  }

  async function quote(body) {
    if (!status().enabled) throw new Error("Manual selling is not enabled for this wallet");
    const { mint, percent, slippageBps } = parseSellRequest(body);
    const held = await balanceFor(mint);
    const amount = BigInt(held.amount) * BigInt(percent) / 100n;
    if (amount === 0n) throw new Error("Token amount is too small to sell");
    const result = await order(mint, amount, slippageBps);
    const minimum = BigInt(result.outAmount) * BigInt(10000 - slippageBps) / 10000n;
    const id = crypto.randomUUID();
    for (const [key, value] of pending) if (value.expires <= now()) pending.delete(key);
    if (pending.size >= 100) throw new Error("Too many pending quotes; try again shortly");
    pending.set(id, { mint, percent, amount: String(amount), slippageBps,
      minimum: String(minimum), expires: now() + QUOTE_TTL_MS });
    return { quoteId: id, mint, percent, amount: String(amount),
      expectedSol: Number(result.outAmount) / LAMPORTS_PER_SOL,
      minimumSol: Number(minimum) / LAMPORTS_PER_SOL,
      slippage: slippageBps / 100, expiresAt: new Date(now() + QUOTE_TTL_MS).toISOString() };
  }

  async function ensureReceivingAccountStaysOpen(transaction, account) {
    const lookups = await Promise.all(transaction.message.addressTableLookups.map(async (lookup) => {
      const result = await connection.getAddressLookupTable(lookup.accountKey);
      if (!result.value) throw new Error("Missing address lookup table");
      return result.value;
    }));
    const keys = transaction.message.getAccountKeys({ addressLookupTableAccounts: lookups });
    for (const instruction of transaction.message.compiledInstructions) {
      const program = keys.get(instruction.programIdIndex);
      if (TOKEN_PROGRAMS.some((item) => item.equals(program)) &&
          instruction.data[0] === 9 &&
          keys.get(instruction.accountKeyIndexes[0]).toBase58() === account) {
        throw new Error("Sale would close the token account; order rejected");
      }
    }
  }

  async function sell(quoteId) {
    if (!status().enabled) throw new Error("Manual selling is not enabled for this wallet");
    if (busy) throw new Error("Another sale is in progress");
    const plan = pending.get(quoteId);
    pending.delete(quoteId); // A quote can only be confirmed once.
    if (!plan || plan.expires <= now()) throw new Error("Quote expired; get a fresh quote");
    busy = true;
    try {
      const held = await balanceFor(plan.mint);
      if (BigInt(held.amount) < BigInt(plan.amount)) {
        throw new Error("Token balance changed; get a fresh quote");
      }
      const fresh = await order(plan.mint, plan.amount, plan.slippageBps, true);
      const freshMinimum = BigInt(fresh.outAmount) *
        BigInt(10000 - plan.slippageBps) / 10000n;
      if (freshMinimum < BigInt(plan.minimum)) {
        throw new Error("Price moved below the confirmed minimum; get a fresh quote");
      }
      if (!fresh.transaction || !fresh.requestId) {
        throw new Error("Jupiter could not build this sale");
      }
      const transaction = VersionedTransaction.deserialize(Buffer.from(fresh.transaction, "base64"));
      if (!transaction.message.staticAccountKeys[0].equals(wallet)) {
        throw new Error("Unexpected transaction payer");
      }
      await ensureReceivingAccountStaysOpen(transaction, held.account);
      transaction.sign([signer]);
      const response = await request("https://api.jup.ag/swap/v2/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({ signedTransaction: Buffer.from(transaction.serialize()).toString("base64"),
          requestId: fresh.requestId })
      });
      const result = await response.json();
      if (!response.ok || result.status !== "Success") {
        throw new Error("Sale did not confirm" + (result.signature ?
          "; check transaction " + result.signature : "; check wallet history before retrying"));
      }
      return { status: "Success", signature: result.signature,
        inputAmount: result.totalInputAmount, outputLamports: result.totalOutputAmount };
    } finally { busy = false; }
  }

  return { status, holdings, quote, sell };
}

module.exports = { createManualSell, parseSlippage, parseSellRequest };
