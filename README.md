# BecsBot

The fresh basket dashboard previews buying **$1 worth of SOL** per trending
Solana token, once per mint, then holding it. It scans Jupiter's 5-minute and
1-hour trending lists. Tokens with Pump.fun launchpad metadata are labeled,
but this is **not** Pump.fun's own app ranking. It skips mints already held by
the bot wallet, tokens with mint or freeze authority, and tokens with less
than $10,000 reported liquidity.

Live trading is hard locked off in `src/basket.js`. The dashboard fetches
quotes and sends no orders. It shows the public wallet's SOL balance, scans a
rotating group of five eligible tokens, and reports the order's stated fee
payers when Jupiter supplies them. A swap fee quote alone does not account for
network fees or token-account rent. The earlier bot implementation is available
in Git history; `src/basket.js` is the sole service entry point.

Set `HELIUS_RPC_URL`, `JUPITER_API_KEY`, and `DASHBOARD_KEY` in Railway.
`SOLANA_PRIVATE_KEY` is not needed for the preview. Never commit a key.

Before enabling live buys in a later release, mount a persistent Railway
volume and set `DATA_DIR` to its path. Review the source feed, spend behavior,
fees, signer match, and transaction recovery first. A failed or ambiguous
execution is recorded as `unknown` and never retried automatically.
