const { PublicKey } = require("@solana/web3.js");

const INTERVALS = ["5m", "1h", "6h", "24h"];
const FEEDS = [
  ...Object.entries({ trending: "toptrending", traded: "toptraded", organic: "toporganicscore" })
    .flatMap(([name, endpoint]) => INTERVALS.map((interval) =>
      [name + ":" + interval, "/tokens/v2/" + endpoint + "/" + interval + "?limit=50"])),
  ["recent", "/tokens/v2/recent"]
];

function positive(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function metric(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function marketRows(feeds) {
  const rows = new Map();
  for (const [feed, tokens] of Object.entries(feeds)) {
    if (!Array.isArray(tokens)) continue;
    for (const [index, token] of tokens.entries()) {
      if (!token?.id) continue;
      try { if (new PublicKey(token.id).toBase58() !== token.id) continue; }
      catch (_) { continue; }
      const row = rows.get(token.id) || {
        mint: token.id, symbol: "?", name: "", feeds: [], ranks: {},
        priceUsd: null, marketCap: null, liquidityUsd: null, holders: null,
        organicScore: null, createdAt: null, launchpad: null,
        isVerified: false, isSus: false,
        change5m: null, change1h: null, volume5m: null, volume1h: null
      };
      row.feeds.push(feed);
      row.ranks[feed] = index + 1;
      row.symbol = String(token.symbol || row.symbol).slice(0, 32);
      row.name = String(token.name || row.name).slice(0, 100);
      row.priceUsd = positive(token.usdPrice) ?? row.priceUsd;
      row.marketCap = positive(token.mcap) ?? row.marketCap;
      row.liquidityUsd = positive(token.liquidity) ?? row.liquidityUsd;
      row.holders = positive(token.holderCount) ?? row.holders;
      const score = metric(token.organicScore);
      if (score != null && score >= 0 && score <= 100) row.organicScore = score;
      row.createdAt = token.firstPool?.createdAt || token.createdAt || row.createdAt;
      row.launchpad = token.launchpad || row.launchpad;
      row.isVerified ||= token.isVerified === true;
      row.isSus ||= Object.hasOwn(token.audit || {}, "isSus");
      for (const interval of INTERVALS) {
        const stats = token["stats" + interval];
        if (!stats) continue;
        row["change" + interval] = metric(stats.priceChange) ?? row["change" + interval];
        const buy = metric(stats.buyVolume), sell = metric(stats.sellVolume);
        if (buy != null && sell != null) row["volume" + interval] = buy + sell;
      }
      rows.set(token.id, row);
    }
  }
  return [...rows.values()];
}

module.exports = { FEEDS, INTERVALS, marketRows, positive };
