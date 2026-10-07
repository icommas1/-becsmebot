const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { fixtureMarket } = require('../fixtures/market');
const { createSignalApp } = require('../../src/signals/app');
const { signalFeed } = require('../../src/signals/feed');
test('source selection and stale timestamps remain truthful and immutable', async () => {
  const market = await fixtureMarket(); const snapshot = market.terminalSnapshot();
  const before = JSON.stringify(snapshot);
  const feed = signalFeed(snapshot, 'dex:profiles');
  assert.ok(feed.rows.every(row => row.feeds.includes('dex:profiles') && row.demo === false));
  assert.ok(feed.rows.length); assert.ok(feed.source.fresh);
  assert.equal(signalFeed(snapshot, 'recent', Date.now() + 181000).source.fresh, false);
  assert.ok(signalFeed(snapshot, 'recent', Date.now() + 181000).rows.every(row => !row.fresh));
  assert.equal(JSON.stringify(snapshot), before);
  assert.throws(() => signalFeed(snapshot, '__proto__'));
});
test('feed API rejects forged sources, labels promotions, and exposes no retired routes', async t => {
  const server = createSignalApp(await fixtureMarket()).listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const sources = await (await fetch(base + '/api/signals/sources')).json();
  assert.equal(sources.sources.length, 19); assert.ok(sources.sources.find(s => s.id === 'dex:top').paidPromotion);
  for (const query of ['', '?source=unknown', '?source=recent&wallet=secret', '?source=recent&source=dex:top']) assert.equal((await fetch(base + '/api/signals' + query)).status, 400);
  for (const route of ['/api/sell', '/api/paper/commands', '/api/research/analyze']) assert.equal((await fetch(base + route, { method: 'POST' })).status, 410);
  assert.match(await (await fetch(base + '/')).text(), /Open BecsSuperAgent/);
});
