// Production is a read-only signal service. No paper, wallet or execution service is loaded.
const fs = require('node:fs');
const path = require('node:path');
const { createMarket, SCAN_MS } = require('./market/market');
const { createSignalApp } = require('./signals/app');
function readConfig(env = process.env) {
  const apiKey = typeof env.JUPITER_API_KEY === 'string' ? env.JUPITER_API_KEY.trim() : '';
  if (!apiKey) throw Error('JUPITER_API_KEY is required');
  const port = env.PORT == null || env.PORT === '' ? 3000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('PORT must be an integer from 0 to 65535');
  const dataDir = typeof env.DATA_DIR === 'string' && env.DATA_DIR.trim() ? env.DATA_DIR.trim() : undefined;
  return { apiKey, port, dataDir };
}
function preserveHistory(dataDir) {
  if (!dataDir) return;
  const source = path.join(dataDir, 'market-history.json');
  const backup = path.join(dataDir, 'market-history.before-signal-feed.json');
  if (!fs.existsSync(source) || fs.existsSync(backup)) return;
  fs.copyFileSync(source, backup, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(backup, 0o600);
}
function start({ env = process.env, logger = console, marketFactory = createMarket } = {}) {
  const config = readConfig(env);
  // Fail startup if an existing chart snapshot cannot be preserved before rolling writes.
  preserveHistory(config.dataDir);
  const market = marketFactory({ apiKey: config.apiKey, dataDir: config.dataDir, captureResearch: false });
  const release = { commit: /^[0-9a-f]{40}$/i.test(env.RAILWAY_GIT_COMMIT_SHA || '') ? env.RAILWAY_GIT_COMMIT_SHA.toLowerCase() : null };
  let stopping = false, interval, job, closing;
  function scan() {
    if (stopping || job) return job;
    job = Promise.resolve().then(() => market.scan()).catch(() => logger.error('Signal scan unavailable')).finally(() => { job = null; });
    return job;
  }
  const server = createSignalApp(market, release).listen(config.port, '0.0.0.0', () => {
    logger.log('BecsBot signal feed running on port ' + server.address().port);
    scan();
    interval = setInterval(scan, SCAN_MS);
  });
  function shutdown() {
    if (closing) return closing;
    stopping = true;
    clearInterval(interval);
    closing = new Promise((resolve, reject) => {
      const timer = setTimeout(() => server.closeAllConnections?.(), 10000);
      timer.unref();
      server.close(error => { clearTimeout(timer); Promise.resolve(job).then(() => error ? reject(error) : resolve()); });
      server.closeIdleConnections?.();
    });
    return closing;
  }
  return { server, market, ready: () => job, shutdown };
}
if (require.main === module) {
  require('dotenv').config();
  try {
    const runtime = start();
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => runtime.shutdown().catch(() => { process.exitCode = 1; }));
  } catch (error) { console.error('BecsBot failed to start: ' + error.message); process.exitCode = 1; }
}
module.exports = { readConfig, preserveHistory, start, createMarket, createApp: createSignalApp };
