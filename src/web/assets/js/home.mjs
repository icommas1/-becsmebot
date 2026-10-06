import { HOME_LIMITS, HOME_READS, readCapability, readAuth, readHealth, readEvents, scanState, utc, intentFor, answerFor } from './home-model.mjs';
import { readHomeJson } from './home-api.mjs';

const byId = id => document.getElementById(id);
const state = { health: null, paper: null, report: null, connected: false, checkedAt: null, intent: 'status' };
let busy = false, generation = 0, controller = null, privateTimer = null;
let lastPublic = -Infinity, lastPrivate = -Infinity;
const setText = (id, text) => { byId(id).textContent = text; };
const availability = value => value === true ? 'Enabled' : value === false ? 'Disabled' : 'Unverified';

function answer(title, text, source = '') {
  setText('answer-title', title); setText('answer-text', text); setText('answer-source', source);
  setText('answer-label', `BECS / ${state.intent.toUpperCase()}`);
}
function renderAnswer() {
  if (state.intent === 'activity') return;
  const result = answerFor(state.intent, state);
  answer(result.title, result.text, state.checkedAt && ['status', 'attention'].includes(state.intent)
    ? `BecsBot service · last successful read ${utc(state.checkedAt)}. Source scan time is shown separately.`
    : 'Guided answer on this device. No question is sent to a provider.');
}
function renderGlance() {
  const current = state.connected && !!state.health;
  setText('connection', current ? 'Connected' : 'Unverified');
  byId('connection').dataset.state = current ? 'connected' : 'unavailable';
  setText('execution', current ? 'Reported disabled' : 'Unverified');
  setText('scan-time', state.health?.lastScanAt ? utc(state.health.lastScanAt) : 'Not recorded');
  setText('freshness', current ? scanState(state.health) : 'Unverified');
  setText('paper-state', availability(state.paper));
  setText('report-state', availability(state.report));
  setText('checked-at', state.checkedAt
    ? `${current ? 'Service read' : 'Last known service read'}: ${utc(state.checkedAt)}.`
    : 'No successful service read yet.');
  setText('version', state.health?.commit ? `Source ${state.health.commit}${current ? '' : ' (last known)'}` : 'Source version unverified.');
}
function clearPrivate(message = '') {
  clearTimeout(privateTimer); privateTimer = null;
  byId('activity-list').replaceChildren();
  byId('activity-panel').hidden = true;
  setText('activity-note', '');
  byId('sign-in').hidden = true; byId('auth-hint').hidden = true;
  if (message && state.intent === 'activity') answer('Private activity cleared.', message);
}
function invalidate() {
  generation++; controller?.abort(); controller = null;
  busy = false; byId('refresh').disabled = false;
  clearPrivate('Load recorded activity again to verify your current sign-in.');
  byId('question').value = '';
  state.connected = false; state.paper = null; state.report = null;
  renderGlance();
  setText('request-note', 'Status needs a new check. Use Refresh status; no automatic retry is running.');
  if (state.intent !== 'activity') renderAnswer();
}
function begin() {
  if (busy || document.hidden || navigator.onLine === false) {
    setText('request-note', busy ? 'A check is already running.' : 'Reconnect and use Refresh status.');
    return null;
  }
  busy = true; byId('refresh').disabled = true;
  controller = new AbortController();
  const version = ++generation;
  return { version, signal: controller.signal };
}
const current = job => job.version === generation && !job.signal.aborted && !document.hidden;
function finish(job) {
  if (job.version !== generation) return;
  busy = false; byId('refresh').disabled = false; controller = null;
}
function cooling(last) { return Date.now() - last < HOME_LIMITS.refreshCooldownMs; }
function cooldownNote() { setText('request-note', 'Checks are limited to one per 10 seconds on this page. No retry has been queued.'); }

async function refreshStatus() {
  if (cooling(lastPublic)) { cooldownNote(); renderAnswer(); return; }
  const job = begin(); if (!job) { renderAnswer(); return; }
  lastPublic = Date.now();
  clearPrivate('Status is being checked. Load recorded activity again when it finishes.');
  state.connected = false; state.paper = null; state.report = null;
  setText('connection', 'Checking');
  byId('connection').dataset.state = 'checking';
  setText('execution', 'Unverified');
  setText('request-note', 'Reading existing status; no market scan is started.');
  try {
    const values = await Promise.allSettled([
      readHomeJson(HOME_READS.health, job.signal).then(readHealth),
      readHomeJson(HOME_READS.paper, job.signal).then(readCapability),
      readHomeJson(HOME_READS.report, job.signal).then(readCapability),
    ]);
    if (!current(job)) return;
    if (values[0].status === 'fulfilled') {
      state.health = values[0].value; state.connected = true; state.checkedAt = Date.now();
    }
    state.paper = values[1].status === 'fulfilled' ? values[1].value : null;
    state.report = values[2].status === 'fulfilled' ? values[2].value : null;
    renderGlance(); renderAnswer();
    setText('request-note', values.every(value => value.status === 'fulfilled')
      ? 'Check complete. No background polling.'
      : 'One or more reads were unavailable. No automatic retry is running.');
  } finally { finish(job); }
}
function showSignIn() {
  clearPrivate();
  answer('Sign in to see your recorded activity.', 'Use the existing BecsBot owner account. AppDeploy sign-in and browser-local paper journals are separate and are not combined here.');
  byId('sign-in').hidden = false; byId('auth-hint').hidden = false;
}
async function loadActivity() {
  if (busy) { setText('request-note', 'Wait for the current check, then load recorded activity.'); return; }
  clearPrivate();
  if (!state.connected || state.paper !== true) {
    answer(state.paper === false ? 'The server paper account is disabled.' : 'Check BecsBot status first.',
      'Refresh status to check account availability. No browser-local wallet or separate app journal is read here.');
    return;
  }
  if (cooling(lastPrivate)) {
    cooldownNote(); answer('Wait briefly before checking again.', 'Recorded activity is limited to one check per 10 seconds on this page.'); return;
  }
  const job = begin(); if (!job) return;
  lastPrivate = Date.now();
  answer('Checking your owner session…', 'Private events are loaded only after BecsBot confirms your existing sign-in.');
  try {
    const authenticated = readAuth(await readHomeJson(HOME_READS.auth, job.signal));
    if (!current(job)) return;
    if (!authenticated) { showSignIn(); return; }
    const events = readEvents(await readHomeJson(HOME_READS.events, job.signal));
    if (!current(job)) return;
    for (const event of events) {
      const item = document.createElement('li');
      const label = document.createElement('strong'); label.textContent = event.label;
      const meta = document.createElement('p'); meta.className = 'micro';
      meta.textContent = `${utc(event.occurredAt)} · sequence ${event.sequence} · ${event.type}`;
      const reference = document.createElement('p'); reference.className = 'micro';
      reference.textContent = `Event ${event.eventId} · hash ${event.eventHash.slice(0, 12)}…`;
      item.append(label, meta, reference); byId('activity-list').append(item);
    }
    byId('activity-panel').hidden = false;
    answer(events.length ? 'Here is your recent recorded activity.' : 'No recorded events were returned.',
      events.length
        ? 'These are recorded server-paper events—not live trades, profit calculations or evidence of predictive learning.'
        : 'The current server-paper account returned an empty event page. That does not describe other accounts, browser-local journals or missing archive coverage.',
      `BecsBot owner session · read ${utc(Date.now())}.`);
    setText('activity-note', 'Original event times and source references are preserved. This page does not verify the hash chain. Private details clear after one minute or when the page is hidden; load again to revalidate.');
    privateTimer = setTimeout(() => clearPrivate('Load recorded activity again to revalidate your owner session.'), HOME_LIMITS.privateDisplayMs);
    setText('request-note', 'Activity read complete. No polling or background agent.');
  } catch (error) {
    if (!current(job)) return;
    clearPrivate();
    if ([401, 403].includes(error.status)) showSignIn();
    else answer(error.status === 429 ? 'Recorded activity is rate-limited.' : 'Recorded activity is unavailable.',
      'No events are being shown. This is not an empty-history result. Retry manually later; this page does not repeat the request automatically.');
  } finally { finish(job); }
}
async function ask(intent) {
  if (busy) { setText('request-note', 'A check is already running. Wait for it to finish.'); return; }
  state.intent = intent; clearPrivate();
  if (intent === 'activity') return loadActivity();
  renderAnswer();
  if (['status', 'attention'].includes(intent) && !cooling(lastPublic)) await refreshStatus();
}
byId('question-form').addEventListener('submit', event => {
  event.preventDefault();
  const question = byId('question').value;
  byId('question').value = '';
  void ask(intentFor(question));
});
byId('ask').disabled = false;
byId('question').maxLength = HOME_LIMITS.questionChars;
for (const button of document.querySelectorAll('[data-intent]')) button.addEventListener('click', () => { void ask(button.dataset.intent); });
byId('usage').addEventListener('click', () => { void ask('usage'); });
byId('refresh').addEventListener('click', () => {
  if (busy) return;
  state.intent = 'status'; void refreshStatus();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) invalidate(); else { renderGlance(); renderAnswer(); } });
window.addEventListener('pagehide', invalidate);
window.addEventListener('pageshow', event => { if (event.persisted) invalidate(); });
window.addEventListener('offline', invalidate);
window.addEventListener('online', () => setText('request-note', 'Connection returned. Refresh status to verify BecsBot.'));
// Local age labels only: this timer never fetches, scans, signs or persists anything.
setInterval(() => { if (!document.hidden) { renderGlance(); if (!busy) renderAnswer(); } }, HOME_LIMITS.ageTickMs);
void refreshStatus();
