const { isCanonicalMint } = require('./mint');
const { assertSchema } = require('../api/validation');
const DEX_FEEDS = [
  ['dex:profiles', '/token-profiles/latest/v1'],
  ['dex:updates', '/token-profiles/recent-updates/v1'],
  ['dex:takeovers', '/community-takeovers/latest/v1'],
  ['dex:ads', '/ads/latest/v1'],
  ['dex:boosts', '/token-boosts/latest/v1'],
  ['dex:top', '/token-boosts/top/v1']
];
const MAX_FEED_TOKENS = 50;
function discoveryMints(data) {
  assertSchema('upstreamDexDiscovery', data);
  return [...new Set(data.filter(item => item.chainId === 'solana' && isCanonicalMint(item.tokenAddress))
    .map(item => item.tokenAddress))].slice(0, MAX_FEED_TOKENS);
}
function createDexClient({ fetchImpl = fetch } = {}) {
  let pending = 0;
  return async function request(path) {
    if (!DEX_FEEDS.some(([, endpoint]) => endpoint === path)) throw Error('Unsupported DexScreener feed');
    if (pending >= DEX_FEEDS.length) throw Error('DexScreener requests busy');
    pending++;
    try {
      const response = await fetchImpl('https://api.dexscreener.com' + path,
        { signal: AbortSignal.timeout(10000), redirect: 'error' });
      if (!response.ok) throw Error('DexScreener ' + response.status + ' data unavailable');
      // Bound the untrusted body before decoding JSON.
      const reader = response.body.getReader(), chunks = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1048576) throw Error('DexScreener response too large');
          chunks.push(Buffer.from(value));
        }
      } finally { await reader.cancel().catch(() => {}); }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw Error('DexScreener data unavailable'); }
    } finally { pending--; }
  };
}
module.exports = { DEX_FEEDS, discoveryMints, createDexClient };
