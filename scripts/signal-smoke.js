const assert = require('node:assert/strict');
async function smoke(base = process.env.SMOKE_URL || 'https://becsbot-production.up.railway.app') {
  const get = async route => { const res = await fetch(base + route, { redirect: 'error', signal: AbortSignal.timeout(15000) }); assert.equal(res.status, 200, route); return res.json(); };
  const health = await get('/health'); assert.equal(health.mode, 'signal-feed'); assert.equal(health.tradingEnabled, false);
  const expected = process.env.SMOKE_EXPECT_COMMIT || process.env.GITHUB_SHA;
  if (expected) assert.equal(health.release.commit, expected);
  const catalog = await get('/api/signals/sources'); assert.equal(catalog.sources.length, 19);
  const feed = await get('/api/signals?source=recent'); assert.equal(feed.schemaVersion, 1); assert.ok(Array.isArray(feed.rows));
  const retired = await fetch(base + '/memory'); assert.equal(retired.status, 410);
  console.log(JSON.stringify({ ok: true, commit: health.release.commit, sourceCount: catalog.sources.length, recentRows: feed.rows.length, recentFresh: feed.source.fresh }));
}
if (require.main === module) smoke().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { smoke };
