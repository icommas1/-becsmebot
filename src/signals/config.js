const { FEEDS } = require('../market/tokens');
const { DEX_FEEDS } = require('../market/dexscreener');
const dexNames = { profiles: 'Token profiles', updates: 'Profile updates', takeovers: 'Community takeovers', ads: 'Paid advertisements', boosts: 'Latest paid boosts', top: 'Top paid boosts' };
const sources = [
  ...FEEDS.map(([id]) => ({ id, name: id === 'recent' ? 'Recent launches' : id.replace(':', ' · '), provider: 'Jupiter', paidPromotion: false })),
  ...DEX_FEEDS.map(([id]) => ({ id, name: dexNames[id.split(':')[1]], provider: 'DexScreener', paidPromotion: ['dex:ads', 'dex:boosts', 'dex:top'].includes(id) }))
];
module.exports = { sources, limits: { freshMs: 180000, pollMs: 15000, rows: 1000 }, superAgentUrl: 'https://becssuperagent-lcforo.v2.appdeploy.ai/' };
