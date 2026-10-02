# Radar behavior

## Sources and eligibility

Default topic: New launches (`recent`), newest first, 20 contacts/page. Other topics are Trending, Active and Organic with 5m/1h/6h/24h intervals. Each Jupiter category requests 50 tokens. Six additional topics are Dex profiles, updates, community takeovers, paid ads, latest paid boosts and top paid boosts. Dex topics have no interval; the interval control is disabled there and the last selected interval still controls displayed metrics. Each keeps at most 50 canonical Solana mints and enriches them with Jupiter metadata. Source rank preserves the returned discovery order. Top boosts are paid promotion, not DexScreener's proprietary trending ranking. Missing Jupiter metadata or price cannot bypass eligibility. Discovery is limited to the provider's returned set; it is not every Solana launch.

Defaults apply to radar contacts, Signals and automatic paper buys:

| Filter | Default |
| --- | --- |
| Age | 0–1,440 minutes (24 hours) |
| Market cap | Known and positive, at most $1,000,000 |
| Liquidity | At least $2,000 |
| Minimum holders, organic score, 5m volume | Disabled (0) |
| Token mark | Positive, nonsuspicious, observed within 180 seconds |

Age comes from token creation time, then first pool creation time. Missing/invalid age, future creation time, missing cap and `audit.isSus` field presence exclude a contact. An absent suspicion flag does not certify safety. Future mark timestamps are invalid. Unknown metric values fail an enabled minimum. Zero disables an optional threshold; known positive cap and valid age still remain required. Users can adjust thresholds and restore defaults without clearing paper balances. Search obeys filters but does not change the auto source.

The selected topic and interval control membership before ranking/pagination. Radar, Signals and auto use the same `launchRows`/`passes` predicate. Signal rail displays at most 100 eligible ranked entries. Auto processes matching discovery rows regardless of the visible page or search text. A missing SOL mark may still allow discovery but prevents buys.

## Visual mapping

Desktop: left signal rail, central literal radar and compact contacts, right paper/execution module, bottom activity tape and persistent execution dock. Mobile: bottom navigation, horizontal snap/swipe contacts, native detail sheet, sticky 44px execution controls. Refreshes preserve the visible card by mint and panel scroll; source/filter/search/sort/page changes reset the card deck. Details preserve their scroll during refresh, have a labeled 48px close button and dismiss from the backdrop. Closing restores dock focus without scrolling. Do not shrink a desktop table into the phone viewport.

The entry response is a lean launch shell; the Radar controls load as a same-origin fragment before browser state and polling initialize. Source buttons retain their paid labels. Safari Reader remains a browser-controlled feature.

Mint-derived deterministic bearings prevent dots from randomly moving at every render. Radius encodes age with small deterministic spacing jitter; dot size represents the heuristic activity strength. It is not location, an execution price or a wallet quality score. A sweep provides visual instrumentation; `SCANNING` is tied to the server's running flag, `DELAYED` to feed errors, and the normal label states `REST / 60s`. A browser connection failure shows `DISCONNECTED` and stops the scanning animation while preserving cached contacts. Feed ages continue advancing while requests wait, and returning to a visible tab or regaining connectivity revalidates immediately. Reduced motion disables animation.

Contacts show symbol, age, source, verification badge, cap, liquidity, selected-interval volume, organic score, observed microchart and state. Unverified remains a label, not an automatic rejection. Tap a contact/blip to select the dock token. Desktop updates the right panel; mobile opens details. Details expose the canonical CA, copy action and exact Dex Screener link.

## Paper execution

Contact actions are $1. The dock has $1/$5/$10/custom positive sizing; changing dock size does not change auto's configured bet. Buys consume gross USD/SOL plus a separate configured simulated fee, retain a SOL reserve and mark the mint bought once. Manual and automatic paths share eligibility and accounting. Available balances, impact, fee and reserve are configurable simulations.

Buys require SOL and token marks no older than 180 seconds. Sells require a positive Jupiter Price V3 mark no older than 120 seconds and a SOL mark no older than 180 seconds. Missing V3 entries stay unavailable. Sell $1 sells up to $1 gross token value, capped at the holding, then deducts the simulated fee. Auto target exits use that same $1 sale function once per holding. No order guarantee, executable quote or actual network-fee estimate is implied.

## Required regressions

Test boundary ages/caps/liquidity, missing and future marks, suspicious flags, topic/interval changes, search/auto separation, save/reload migration, buy-once behavior, stale-sale rejection, fee/reserve accounting and all holding price batches. Browser tests must cover native mobile layout, overflow, details/CA, dollar presets, $1 buy/sale, same-filter auto, reload and reduced motion.
