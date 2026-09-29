# BecsBot

BecsBot is a **read-only preview** for a future strategy: spend approximately
$1 worth of SOL per selected Pump.fun launch **while its SOL bonding curve is
active**, buy once automatically, and hold. Direct Pump trading, account
creation, and automatic buying are not implemented. No service route sends a
transaction.

The dashboard currently samples up to five Pump-labeled tokens from Jupiter's
5-minute and 1-hour trending lists every five minutes. It verifies each sampled
mint's Pump bonding-curve PDA on chain: Pump program ownership, expected account
type, `complete == false`, and native SOL quote mint. This **is not a complete
Pump.fun launch feed**. A curve can complete after the scan; a future buy must
recheck its state immediately before submitting a direct Pump instruction.

For each verified sample, the preview derives this wallet's associated token
account using the mint's actual Token or Token-2022 program and checks whether
it exists. A later buy of the same mint can reuse the account, even after its
balance was sold. A different mint needs a different account. The preview also
checks the wallet's one-time Pump user volume accumulator. It does not create
any accounts or lock any SOL as rent.

Set `HELIUS_RPC_URL`, `JUPITER_API_KEY`, and `DASHBOARD_KEY` in Railway.
`SOLANA_PRIVATE_KEY` is not used by this read-only service. Never commit a key.
The public wallet address is configured in `src/basket.js`.

Before enabling direct buying, add a complete Pump launch feed, direct Pump
bonding-curve transaction construction and simulation, precise $1 SOL input
calculation, fee and rent budgeting, fresh on-chain curve checks, account
creation within the first buy or selective precreation, transaction recovery,
and a persistent volume for the buy-once ledger. Keep the receiving token
account open after a sell for later buys of the same mint.
