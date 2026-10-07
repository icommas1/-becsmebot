const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { once } = require('node:events');
const { readConfig, preserveHistory, start } = require('../../src/basket');
const { fixtureMarket } = require('../fixtures/market');
test('signal runtime validates configuration', () => {
  assert.throws(() => readConfig({}), /JUPITER_API_KEY/);
  for (const port of ['abc', -1, 70000]) assert.throws(() => readConfig({ JUPITER_API_KEY: 'fixture', PORT: port }));
  assert.equal(readConfig({ JUPITER_API_KEY: 'fixture', PORT: 0 }).port, 0);
});
test('transition preserves the original chart file exactly once without touching other saved data', t => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'becs-preserve-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'market-history.json'), '{"kept":true}');
  fs.writeFileSync(path.join(dir, 'backup.encrypted'), 'unchanged');
  preserveHistory(dir);
  fs.writeFileSync(path.join(dir, 'market-history.json'), '{"new":true}');
  preserveHistory(dir);
  assert.equal(fs.readFileSync(path.join(dir, 'market-history.before-signal-feed.json'), 'utf8'), '{"kept":true}');
  assert.equal(fs.readFileSync(path.join(dir, 'backup.encrypted'), 'utf8'), 'unchanged');
});
test('production starts signal-only even when old account/archive/live flags are present', async t => {
  const market = await fixtureMarket(); let options;
  const runtime = start({ env: { JUPITER_API_KEY: 'fixture', PORT: '0', DATABASE_URL: 'do-not-connect', PAPER_ACCOUNTS_ENABLED: 'true', RESEARCH_ARCHIVE_ENABLED: 'true' }, logger: { log() {}, error() {} }, marketFactory: value => { options = value; return market; } });
  await once(runtime.server, 'listening'); t.after(() => runtime.shutdown());
  const base = 'http://127.0.0.1:' + runtime.server.address().port;
  const health = await (await fetch(base + '/health')).json();
  assert.equal(health.mode, 'signal-feed'); assert.equal(health.tradingEnabled, false); assert.equal(options.captureResearch, false);
  assert.equal((await fetch(base + '/api/paper/commands', { method: 'POST' })).status, 410);
  assert.equal((await fetch(base + '/assets/js/dashboard.mjs')).status, 410);
  assert.equal((await fetch(base + '/memory')).status, 410);
  assert.equal((await fetch(base + '/api/signals?source=recent')).status, 200);
  await runtime.shutdown(); await runtime.shutdown();
});
