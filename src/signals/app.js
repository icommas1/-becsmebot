const express = require('express');
const { assertSchema } = require('../api/validation');
const path = require('node:path');
const { sourceStates, signalFeed } = require('./feed');
const { superAgentUrl, limits } = require('./config');
function createSignalApp(market, release = { commit: null }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    next();
  });
  const snapshot = () => market.terminalSnapshot();
  app.get(['/', '/home', '/terminal'], (_req, res) => res.sendFile(path.join(__dirname, '../web/signals.html')));
  app.use('/signals-assets', express.static(path.join(__dirname, '../web/signals-assets'), { index: false, dotfiles: 'deny', fallthrough: false }));
  app.get('/api/signals/sources', (_req, res) => res.json({ schemaVersion: 1, sources: sourceStates(snapshot()), pollMs: limits.pollMs, superAgentUrl }));
  app.get('/api/signals', (req, res) => {
    if (typeof req.query.source !== 'string' || Object.keys(req.query).some(key => key !== 'source')) return res.status(400).json({ error: 'Choose one signal source.' });
    try { res.json(assertSchema('sourceSignalResponse', signalFeed(snapshot(), req.query.source))); }
    catch { res.status(400).json({ error: 'Unknown signal source.' }); }
  });
  app.get('/api/basket', (_req, res) => res.json(snapshot()));
  app.get('/api/history', (_req, res) => res.json(market.chartHistory()));
  app.get('/health', (_req, res) => {
    const s = snapshot();
    res.json({ ok: true, mode: 'signal-feed', tradingEnabled: false, manualSell: { enabled: false }, lastScanAt: s.lastScanAt, lastError: s.lastError, running: s.running, feeds: s.feeds, release });
  });
  // Compatibility metadata only. Retired services are never instantiated or mounted.
  app.get(['/api/paper/capabilities', '/api/superagent/capabilities'], (_req, res) => res.json({ enabled: false, retired: true }));
  app.get('/health/archive', (_req, res) => res.json({ enabled: false, healthy: false, state: 'retained-offline', writesEnabled: false }));
  app.get('/superagent', (_req, res) => res.redirect(302, superAgentUrl));
  app.use((_req, res) => res.status(410).json({ error: 'This feature has been retired. BecsBot now provides signal feeds.', superAgentUrl }));
  app.use((_error, _req, res, _next) => res.status(503).json({ error: 'Signal feed temporarily unavailable.' }));
  return app;
}
module.exports = { createSignalApp };
