const test = require("node:test");
const assert = require("node:assert/strict");
const { Keypair, PublicKey, TransactionMessage, VersionedTransaction,
  ComputeBudgetProgram, TransactionInstruction } = require("@solana/web3.js");
const bs58 = require("bs58").default;
const { createManualSell, parseSlippage, parseSellRequest } = require("../src/manual-sell");

const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SOL = "So11111111111111111111111111111111111111112";

function setup({ closeAccount = false, worse = false } = {}) {
  const signer = Keypair.generate();
  const mint = Keypair.generate().publicKey;
  const account = PublicKey.findProgramAddressSync([
    signer.publicKey.toBuffer(), TOKEN.toBuffer(), mint.toBuffer()
  ], ATA)[0];
  const connection = {
    async getParsedTokenAccountsByOwner(_wallet, { programId }) {
      return { value: programId.equals(TOKEN) ? [{ pubkey: account,
        account: { data: { parsed: { info: { mint: mint.toBase58(),
          tokenAmount: { amount: "100000", decimals: 6, uiAmountString: "0.1" }
        } } } } }] : [] };
    }
  };
  const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 })];
  if (closeAccount) instructions.push(new TransactionInstruction({
    programId: TOKEN, keys: [{ pubkey: account, isSigner: false, isWritable: true }],
    data: Buffer.from([9])
  }));
  const tx = new VersionedTransaction(new TransactionMessage({
    payerKey: signer.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions
  }).compileToV0Message());
  let orderCount = 0;
  let executeCount = 0;
  const request = async (url, options) => {
    if (url.includes("/order?")) {
      orderCount++;
      const params = new URL(url).searchParams;
      assert.equal(params.get("inputMint"), mint.toBase58());
      assert.equal(params.get("outputMint"), SOL);
      assert.equal(params.get("amount"), "50000");
      assert.equal(params.get("slippageBps"), "500");
      return { ok: true, json: async () => ({ outAmount: worse && orderCount === 2 ?
        "10000000" : "100000000", transaction: params.has("taker") ?
        Buffer.from(tx.serialize()).toString("base64") : null, requestId: "test" }) };
    }
    executeCount++;
    assert.equal(options.method, "POST");
    assert.equal(JSON.parse(options.body).requestId, "test");
    return { ok: true, json: async () => ({ status: "Success", signature: "test-signature",
      totalInputAmount: "50000", totalOutputAmount: "100000000" }) };
  };
  const sell = createManualSell({ connection, wallet: signer.publicKey, apiKey: "test",
    secret: bs58.encode(signer.secretKey), enabled: true, request });
  return { sell, mint: mint.toBase58(), getExecuted: () => executeCount };
}

test("validates slippage and requested sale share", () => {
  assert.equal(parseSlippage("0.1"), 10);
  assert.equal(parseSlippage("5.25"), 525);
  for (const value of ["0", "50.01", "5.123", "abc"]) {
    assert.throws(() => parseSlippage(value));
  }
  assert.throws(() => parseSellRequest({ mint: SOL, percent: 100, slippage: "5" }));
});

test("quotes and confirms one sale with a fresh order", async () => {
  const { sell, mint, getExecuted } = setup();
  assert.equal(sell.status().enabled, true);
  const holdings = await sell.holdings();
  assert.equal(holdings[0].mint, mint);
  const quote = await sell.quote({ mint, percent: 50, slippage: "5" });
  assert.equal(quote.expectedSol, 0.1);
  assert.equal(quote.minimumSol, 0.095);
  assert.equal((await sell.sell(quote.quoteId)).status, "Success");
  assert.equal(getExecuted(), 1);
  await assert.rejects(sell.sell(quote.quoteId), /expired/);
});

test("rejects a worse price or closing the receiving token account", async () => {
  for (const options of [{ worse: true }, { closeAccount: true }]) {
    const { sell, mint, getExecuted } = setup(options);
    const quote = await sell.quote({ mint, percent: 50, slippage: "5" });
    await assert.rejects(sell.sell(quote.quoteId),
      options.worse ? /Price moved/ : /would close/);
    assert.equal(getExecuted(), 0);
  }
});

test("does not enable sales when the secret belongs to a different wallet", async () => {
  const { sell } = setup();
  const other = createManualSell({ wallet: Keypair.generate().publicKey, apiKey: "test",
    secret: bs58.encode(Keypair.generate().secretKey), enabled: true });
  assert.equal(other.status().enabled, false);
  await assert.rejects(other.quote({}), /not enabled/);
  assert.equal(sell.status().enabled, true);
});
