# BecsBot Jupiter terminal

Public full-page markets and paper trading dashboard. No login. Real transaction routes return 410; the runtime does not load a wallet signer or private key.

## Markets and signals

Jupiter Tokens V2 provides trending, top traded and organic categories for 5m, 1h, 6h and 24h, plus recent pools and token search. Server scans run every minute. This is REST polling, not a streaming feed. Feed errors and timestamps appear under Feeds.

Server chart observations persist for up to 24 hours in `DATA_DIR/market-history.json`. Signals ranks current multiples against the first retained observation and shows peak multiples and the starting time. It does not claim launch returns or trading profits. Each signal and hold has a token address, Copy CA and Dex Screener link.

## Paper trading

Default buys spend $1.00 before the configurable simulated network fee. Manual and auto buys use the same fill logic and filters. Sell $1 sells up to $1 of the position before the fee; Sell all closes it. Price impact and fees are simulation settings, not executable quotes. SOL input amounts depend on the observed USD price; real exactly-$1 execution is not guaranteed.

Auto source is adjustable. An optional multiple target above 1 triggers one $1 paper sale per hold, using the same sale logic; 0 disables it. Auto is off after reload and runs only while the page is open. Paper balances, holds and settings save in this browser. Server market scanning and charts continue when it closes.

Buys need recent Tokens V2 and SOL marks. Sells need a recent Jupiter Price V3 mark; omitted prices remain unavailable and cannot produce fills. Price refreshes cover all holds in batches. Last known marks can still appear in estimated portfolio values and are labeled stale.

## Run

Node 20+, `npm ci`, `npm test`, `npm start`. Set `JUPITER_API_KEY`; optionally set `PORT` and persistent `DATA_DIR`. API keys remain server-side. No paid plan is purchased by this project.

Jupiter calls are serialized, spaced 2.2 seconds apart, cached and bounded. One 429 retry uses the reset header. Public search and price endpoints validate inputs and rate limit requests.

Tests cover normalization, incoming feeds and failures, missing prices, history persistence, observed signal multiples, retry/queue behavior, public endpoint validation, blocked signing routes, and paper dollar accounting. Fixtures verify behavior; they do not predict returns or guarantee live liquidity.
