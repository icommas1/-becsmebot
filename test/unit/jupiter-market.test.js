const test = require("node:test");
const assert = require("node:assert/strict");
const { FEEDS, marketRows } = require("../../src/market/tokens");

test("merges Jupiter categories without Pump eligibility", () => {
  const mint = "So11111111111111111111111111111111111111112";
  const rows = marketRows({
    "trending:5m": [{ id: mint, symbol: "SOL", usdPrice: 200,
      organicScore: 82, stats5m: { priceChange: 1.25, buyVolume: 100, sellVolume: 50 } }],
    "traded:1h": [{ id: mint, symbol: "SOL", isVerified: true }],
    recent: [{ id: mint, firstPool: { createdAt: "2026-09-30T00:00:00Z" } }],
    "organic:5m": [{ id: "invalid", symbol: "BAD" }]
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].feeds, ["trending:5m", "traded:1h", "recent"]);
  assert.equal(rows[0].ranks["trending:5m"], 1);
  assert.equal(rows[0].priceFeed,"trending:5m");
  assert.equal(rows[0].volume5m, 150);
  assert.equal(rows[0].change5m, 1.25);
  assert.equal(rows[0].isVerified, true);
  assert.equal(rows[0].createdAt, "2026-09-30T00:00:00Z");
  assert.equal(FEEDS.length, 13);
});

test("missing token prices stay unavailable and suspicious flag uses field presence", () => {
  const mint = "So11111111111111111111111111111111111111112";
  const [row] = marketRows({ recent: [{ id: mint, usdPrice: null, audit: { isSus: false } }] });
  assert.equal(row.priceUsd, null);
  assert.equal(row.isSus, true);
});
