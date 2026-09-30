# BecsBot

BecsBot scans for a planned strategy: spend approximately
$1 worth of SOL per selected trending Solana token, buy once automatically,
and hold. Pump.fun launches should be bought on their active SOL bonding curve;
other eligible trends can use Jupiter. Direct Pump trading, account creation,
and automatic buying are not implemented. Automatic trading is off. The only
transaction route is an explicitly confirmed manual sale when the separate
`MANUAL_SELL_ENABLED=true` switch is set and `SOLANA_PRIVATE_KEY` derives the
configured bot wallet. Without that switch, sell buttons are locked.

The service listens for Pump.fun launch and migration events through one
PumpPortal WebSocket connection. Launch and migration subscriptions are free.
With `PUMP_PORTAL_API_KEY`, it also subscribes to metered trade events for at
most 100 verified trending Pump mints at once (the full 5-minute and 1-hour
Jupiter scan, after deduplication and on-chain checks). The feed counts buys and sells
over the last minute and unsubscribes after 1000 trade events per process.
Without the key, it never subscribes to paid events. The counter resets on
service restart; Railway has no persistent volume, so this is not an account
spending cap. Fund the key's linked wallet with only the intended data budget.
It remembers recent launches in
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

For each verified sample, the scanner derives this wallet's associated token
account using the mint's actual Token or Token-2022 program and checks whether
it exists. A later buy of the same mint can reuse the account, even after its
balance was sold. A different mint needs a different account. The preview also
checks the wallet's one-time Pump user volume accumulator. It does not create
any accounts or lock any SOL as rent.

Set `HELIUS_RPC_URL`, `JUPITER_API_KEY`, and `DASHBOARD_KEY` in Railway.
`PUMP_PORTAL_API_KEY` is optional; put it in Railway service variables, never
in source control or chat. A linked wallet must have at least 0.02 SOL to use
paid trade subscriptions. PumpPortal charges 0.01 SOL per 10,000 trade events.
The stream reports connection status and event counters at `/health`, and
one-minute trade counts at `/api/basket`. The API key is for data only; this
service does not use PumpPortal's Lightning trading API.
`SOLANA_PRIVATE_KEY` is used only for manually confirmed sales when enabled.
Never commit a key.
The public wallet address is configured in `src/basket.js`.

The dashboard also has a separate paper desk. Set any nonnegative simulated
SOL cash balance and edit the paper USD buy size, SOL cash reserve, estimated
network fee, price impact, market cap, liquidity, age, and holder filters.
Its radar shows Jupiter 5-minute and 1-hour trends, with manual paper buys
restricted to the on-chain verified active Pump SOL curves. The optional auto
paper button buys each passing curve once while the page is open; it switches
off when the page is reopened. Paper holds and the buy-once list persist in
that browser's local storage and remain after leaving the radar. A separate
Dex Screener token-pair price lookup (with Jupiter price fallback) marks
paper holds, including 25%, 50%, and 100% paper sells. Paper fills use a
price estimate and configurable fee and impact, not a transaction quote.
They do not send orders or change the real wallet. Clearing site data or
changing phones loses this local paper record; Railway does not run paper
auto buys when the dashboard is closed.

The dashboard lists nonzero balances in this wallet's canonical token accounts
for both Token and Token-2022. Its 25%, 50%, and 100% sell buttons request a
Jupiter Swap V2 token-to-SOL quote, then require a second confirmation. The
slippage percentage (0.1% to 50%) is saved in the browser on that phone, and
applies to manual sales. Quotes expire after 30 seconds and can be used once.
At confirmation the server rechecks the balance and price, signs only if the
key matches the configured public wallet, and rejects direct token-account
close instructions targeting the receiving account. Network or quote failures
may still leave an uncertain outcome: check wallet transaction history before
trying again. No automatic retries and no token-account close instruction is
added by this service. Other transactions are never sent by the dashboard.

Before enabling live buying, harden launch recovery and add direct Pump
bonding-curve transaction construction and simulation, precise $1 SOL input
calculation, fee and rent budgeting, fresh on-chain curve checks, account
creation within the first buy or selective precreation, transaction recovery,
and a persistent volume for the buy-once ledger. Restore the guarded Jupiter
execution route for non-Pump tokens after both routes are tested. Keep the
receiving token account open after a sell for later buys of the same mint.
