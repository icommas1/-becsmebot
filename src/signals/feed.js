const { sources, limits } = require('./config');
function fresh(at, now) { return Number.isFinite(at) && at > 0 && at <= now && now - at <= limits.freshMs; }
function sourceStates(snapshot, now = Date.now()) {
  return sources.map(source => {
    const state = snapshot.feeds[source.id];
    return { ...source, at: state?.at || null, count: state?.count ?? null,
      fresh: !!state && !state.error && fresh(Date.parse(state.at), now) };
  });
}
function signalFeed(snapshot, source, now = Date.now()) {
  if (!sources.some(item => item.id === source)) throw Error('Unknown signal source');
  const status = sourceStates(snapshot, now).find(item => item.id === source);
  const signals = new Map(snapshot.signals.map(row => [row.mint, row]));
  const rows = snapshot.radar.filter(row => row.feeds.includes(source)).sort((a, b) => a.ranks[source] - b.ranks[source]).slice(0, limits.rows).map(row => {
    const signal = signals.get(row.mint);
    return { ...row, source, demo: false, fresh: status.fresh && fresh(row.observedAt, now),
      signal: signal ? { multiple: signal.multiple, peakMultiple: signal.peakMultiple, firstSeenAt: signal.firstSeenAt, observedAt: signal.observedAt } : null };
  });
  return { schemaVersion: 1, source: status, lastScanAt: snapshot.lastScanAt, rows };
}
module.exports = { signalFeed, sourceStates };
