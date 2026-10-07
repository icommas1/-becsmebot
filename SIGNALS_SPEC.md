# Signal-only production transition — 2026-10-07

Production now serves `/api/signals/sources`, `/api/signals?source=<id>`, `/api/basket`, `/api/history` and a minimal feed interface. Source membership, provider labels, timestamp freshness and existing signal arithmetic are preserved. Jupiter/DexScreener feeds are discovery, not search-popularity rankings. Old paper, research, memory and execution services are not started; old feature routes and old assets return 410. BecsSuperAgent is the market browser, analyst and wallet-swap interface.

No SQL migrations, volume removal, credential changes or browser-storage clearing occurs. On the first start the existing chart file is copied once to `DATA_DIR/market-history.before-signal-feed.json` before bounded operational history continues. Databases, pending archive spool, wallets and backups remain intact. Legacy source and offline storage/recovery tools below remain available in the repository; the legacy HTTP app is not used by production.

---

# Signals behavior

Signals measure price movement since BecsBot's first retained observation. They are not launch returns, wallet performance or predictions.

## Multiples and retention

For a valid canonical mint with a positive current price, use its earliest valid retained point as baseline. `multiple = currentPrice / baselinePrice`; `peakMultiple = maximumRetainedPrice / baselinePrice`. `firstSeenAt` is the baseline timestamp. `observedAt` is the older of the current mark and last chart observation. Invalid/empty trails and invalid/stale/future data cannot manufacture a baseline or a fresh timestamp.

Rows sort descending by current multiple, capped at 1,000 server-side. The browser applies the same launch/topic filters as radar and displays up to 100. Retention is 24 hours/1,440 points per mint, at most 1,000 mints. As older observations expire, the baseline and displayed multiple change. Microcharts contain sampled observations, not tick/candle or full launch history. Failed feeds retain their actual prior timestamps.

## Display states (priority order)

| State | Trigger |
| --- | --- |
| EXIT | Holding has completed its one-time paper target sale |
| COOLING | Finite 5m price change below 0% |
| HEATING | Finite 5m price change at least +5% |
| NEW | Valid token age under five minutes |
| TRENDING | Membership in any trending feed or positive 5m change |
| NEW fallback | No previous trigger applies |

Use labels and symbols (◇, ↗, ◆, ↘, ⊗), not color alone. These display states are independent from buy eligibility; a HEATING contact may still fail cap/liquidity/price filters.

Activity strength is a bounded 1–5 heuristic: round up `(organicScore + min(30, positive5mChange) + min(30, log10(volume5m+1)*6))/25`, then clamp to 1–5. Missing inputs contribute zero. It does not analyze wallet trading history. Do not label it a wallet score.

## Tape and execution

The tape combines new eligible contacts observed in this page session and this browser's paper executions. Paper entries include token, gross USD size, cap when available and manual/auto source. No external wallet buys, real fills or subscription trade events are inferred from REST scans.

Auto buys each matching mint once using the configured paper amount. It follows the selected source and same filters as radar. Optional multiple-target exits above 1 use a fresh V3 mark to sell up to $1 once per hold; 0 disables the target. UI state EXIT indicates that simulated sale, not a recommendation. Reload disables auto without removing holdings or the buy-once list.

## Required regressions

Verify baseline/peak arithmetic, sort order, invalid/zero baselines, corrupted/future history, retention/restart, provider partial failures and unchanged stale timestamps. Verify visual state priorities, filtered signals, microcharts and activity tape with deterministic fixtures. Live smoke checks require current source timestamps; empty radar under valid filters is not itself an outage.
