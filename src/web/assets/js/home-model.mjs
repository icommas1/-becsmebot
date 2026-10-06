// Presentation limits only; this module never changes BecsBot's trading configuration.
export const HOME_LIMITS = Object.freeze({
  requestTimeoutMs: 10_000,
  refreshCooldownMs: 10_000,
  privateDisplayMs: 60_000,
  ageTickMs: 30_000,
  responseBytes: 1024 * 1024,
  questionChars: 200,
  recentEvents: 5,
  // Matches the existing terminal's read-only feed-freshness display, not eligibility.
  scanFreshnessMs: 5 * 60_000,
});
export const HOME_READS = Object.freeze({
  health: '/health',
  paper: '/api/paper/capabilities',
  report: '/api/superagent/capabilities',
  auth: '/api/auth/status',
  events: `/api/paper/events?limit=${HOME_LIMITS.recentEvents}`,
});
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const timestamp = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const invalid = () => { throw new Error('Unrecognized BecsBot response.'); };

export function readCapability(value) {
  if (!object(value) || typeof value.enabled !== 'boolean') return invalid();
  return value.enabled;
}
export function readAuth(value) {
  if (!object(value) || typeof value.authenticated !== 'boolean') return invalid();
  return value.authenticated;
}
export function readHealth(value) {
  if (!object(value) || value.ok !== true || value.tradingEnabled !== false ||
      value.manualSell?.enabled !== false || typeof value.running !== 'boolean' ||
      !(value.lastScanAt === null || timestamp(value.lastScanAt)) ||
      !(value.lastError === null || typeof value.lastError === 'string')) return invalid();
  return Object.freeze({
    lastScanAt: value.lastScanAt,
    hasError: value.lastError !== null,
    running: value.running,
    commit: /^[a-f0-9]{40}$/.test(value.release?.commit || '') ? value.release.commit : null,
  });
}
export function scanState(health, now = Date.now()) {
  if (!health) return 'unavailable';
  if (!health.lastScanAt) return 'not recorded';
  const age = now - Date.parse(health.lastScanAt);
  if (age < 0) return 'clock mismatch';
  if (health.hasError || age > HOME_LIMITS.scanFreshnessMs) return 'delayed';
  return 'recent';
}
export function utc(value) {
  const at = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') : 'Unavailable';
}
export function intentFor(question) {
  if (typeof question !== 'string' || question.length > HOME_LIMITS.questionChars) return 'help';
  const q = question.trim().toLowerCase().replace(/[’']/g, '');
  if (/\b(credit|credits|cost|costs|budget|usage|spending)\b/.test(q)) return 'usage';
  if (/\b(activity|events|purchases|history|trades)\b/.test(q)) return 'activity';
  if (/\b(attention|next|problem|problems|wrong)\b/.test(q)) return 'attention';
  if (/\b(status|happening|health|online|doing)\b/.test(q)) return 'status';
  return 'help';
}
export function answerFor(intent, { health = null, paper = null, report = null, connected = false } = {}, now = Date.now()) {
  if (intent === 'usage') return {
    title: 'No AI requests from this page.',
    text: 'Questions are matched to guided answers on your device. This page reads existing BecsBot endpoints only; it does not call AI, Nansen, Jupiter or DEX Screener. Existing server scans and hosting are separate. Account balances and spending caps are not verified here.',
  };
  if (intent === 'help') return {
    title: 'Start with status, attention or recorded activity.',
    text: 'This first version is a guided assistant, not a general AI chatbot. Try “How is the bot doing?”, “What needs attention?”, “Show recorded activity” or “What uses credits?”. It cannot place trades, change settings or answer price predictions.',
  };
  if (!connected || !health) return {
    title: 'BecsBot status is unavailable here.',
    text: 'This page could not verify the service. That does not prove BecsBot is down. Check your connection, then use Refresh status. No automatic retry is running.',
  };
  const freshness = scanState(health, now);
  if (intent === 'attention') {
    if (freshness !== 'recent') return {
      title: freshness === 'clock mismatch' ? 'Check the timestamp before relying on the feed.' : 'Review the market feed.',
      text: freshness === 'not recorded'
        ? 'BecsBot is reachable, but no completed market scan is reported. Open the existing terminal for feed details.'
        : `The last scan is ${freshness}. Retained information is not a new observation. Open the terminal for the source-by-source status; this page does not request another market scan.`,
    };
    if (paper !== true) return {
      title: paper === false ? 'The server paper account is disabled.' : 'Paper-account availability is unverified.',
      text: 'Your browser-local wallet is a separate account and is not read or combined here. This page will not change account configuration.',
    };
    if (report !== true) return {
      title: report === false ? 'The outcome report is not enabled.' : 'Outcome-report availability is unverified.',
      text: 'Recent server-paper events can still be checked with “Show recorded activity”. The separate outcome report has its own prerequisites; this page does not activate storage or claim that learning is working.',
    };
    return {
      title: 'The basic checks are available.',
      text: 'Check your recorded paper activity next. This is a limited status check—not proof that every feed, test, backup or integration is healthy.',
    };
  }
  return {
    title: 'BecsBot is reachable.',
    text: `The service reports live trading disabled. ${health.running ? 'A market scan is running. ' : ''}${health.lastScanAt ? `Last scan: ${utc(health.lastScanAt)} (${freshness}).` : 'No completed market scan is reported.'} These are service observations, not wallet performance or trading advice.`,
  };
}
const eventLabels = Object.freeze({
  'decision.evaluated': 'Paper decision recorded',
  'order.intent.created': 'Paper intent recorded',
  'paper.execution.completed': 'Paper execution recorded',
  'paper.settings.updated': 'Paper settings updated',
  'paper.cash.adjusted': 'Paper cash adjusted',
  'paper.wallet.reset': 'Paper wallet reset recorded',
});
export function readEvents(value) {
  if (!object(value) || !Array.isArray(value.events) || value.events.length > HOME_LIMITS.recentEvents ||
      !(value.nextBeforeSequence === null || (Number.isSafeInteger(value.nextBeforeSequence) && value.nextBeforeSequence > 0))) return invalid();
  let previous = Infinity, account = null;
  const ids = new Set();
  // Keep only display fields. No payloads, wallet data or account IDs reach the view model.
  return value.events.map(event => {
    if (!object(event) || event.schemaVersion !== 1 || !text(event.eventId, 100) || ids.has(event.eventId) ||
        !Number.isSafeInteger(event.sequence) || event.sequence < 1 || event.sequence >= previous ||
        !text(event.type, 100) || !timestamp(event.occurredAt) || !/^[a-f0-9]{64}$/.test(event.eventHash || '') ||
        !text(event.accountId, 160) || (account !== null && account !== event.accountId)) return invalid();
    previous = event.sequence; account = event.accountId; ids.add(event.eventId);
    return Object.freeze({
      label: Object.hasOwn(eventLabels, event.type) ? eventLabels[event.type] : 'Recorded paper event',
      type: event.type, sequence: event.sequence, occurredAt: event.occurredAt,
      eventId: event.eventId, eventHash: event.eventHash,
    });
  });
}
