# BecsBot

BecsBot is a **read-only service** for a planned strategy: spend approximately
$1 worth of SOL per selected trending Solana token, buy once automatically,
and hold. Pump.fun launches should be bought on their active SOL bonding curve;
other eligible trends can use Jupiter. Direct Pump trading, account creation,
and automatic buying are not implemented. No service route sends a transaction.

The service listens for Pump.fun launch and migration events through one
PumpPortal WebSocket connection. Launch and migration subscriptions are free;
it does not subscribe to metered trade events. It remembers recent launches in
memory, cross-matches them against Jupiter's 5-minute and 1-hour trending
lists, and still accepts tokens marked Pump by Jupiter if the stream missed a
launch. It checks trending candidates every five minutes and schedules a
bounded follow-up scan after launch or migration events, at most once per
minute during an active stream. The scan uses bounded RPC batches and verifies each
mint's Pump bonding-curve PDA on chain: Pump program ownership, expected account
type, `complete == false`, and native SOL quote mint. This **is not a complete
record of Pump.fun launches**, particularly during disconnects or
restarts. A curve can complete after the scan; a future buy must
recheck its state immediately before submitting a direct Pump instruction.

For each verified sample, the preview derives this wallet's associated token
account using the mint's actual Token or Token-2022 program and checks whether
it exists. A later buy of the same mint can reuse the account, even after its
balance was sold. A different mint needs a different account. The preview also
checks the wallet's one-time Pump user volume accumulator. It does not create
any accounts or lock any SOL as rent.

Set `HELIUS_RPC_URL`, `JUPITER_API_KEY`, and `DASHBOARD_KEY` in Railway.
`PUMP_PORTAL_API_KEY` is optional for the free launch/migration stream; no paid
trade subscriptions are used. The stream reports its connection status at
`/health` and `/api/basket`.
`SOLANA_PRIVATE_KEY` is not used by this read-only service. Never commit a key.
The public wallet address is configured in `src/basket.js`.

Before enabling live buying, harden launch recovery and add direct Pump
bonding-curve transaction construction and simulation, precise $1 SOL input
calculation, fee and rent budgeting, fresh on-chain curve checks, account
creation within the first buy or selective precreation, transaction recovery,
and a persistent volume for the buy-once ledger. Restore the guarded Jupiter
execution route for non-Pump tokens after both routes are tested. Keep the
receiving token account open after a sell for later buys of the same mint.
