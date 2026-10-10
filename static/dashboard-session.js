/* Five-minute server sessions. Neither the admin key nor session ID enters web storage. */
(() => {
  'use strict';
  let active = null;
  let monoDeadline = 0;
  let wallDeadline = 0;
  let generation = 0;
  let clock = null;
  let restoring = null;
  let onUnlock = async () => {};
  let onLock = () => {};
  const node = id => document.getElementById(id);
  const expiredText = 'Your five-minute dashboard session ended. Unlock again; forwarding is still running.';

  for (const name of ['sessionStorage', 'localStorage']) {
    try { window[name].removeItem('becs_key'); } catch (_) { /* Storage can be unavailable. */ }
  }

  function remaining() {
    return active ? Math.max(0, Math.min(monoDeadline - performance.now(), wallDeadline - Date.now())) : 0;
  }
  function conceal(value) {
    document.documentElement.classList.toggle('becs-session-checking', value);
  }
  function drawClock() {
    const bar = node('sessionBar');
    if (bar) bar.hidden = !active;
    if (!active) return;
    const seconds = Math.ceil(remaining() / 1000);
    const label = node('sessionCountdown');
    if (label) label.textContent = `Locks in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function lock(message = expiredText) {
    active = null;
    generation += 1;
    clearTimeout(clock);
    drawClock();
    onLock(message);
    conceal(false);
  }
  function tick() {
    if (!active) return;
    if (remaining() <= 0) { lock(); return; }
    drawClock();
    clock = setTimeout(tick, Math.min(250, remaining()));
  }
  function accept(data, elapsed = 0) {
    const left = Math.min(300000, data.expires_at - data.server_time - elapsed);
    if (!data.authenticated || !Number.isFinite(left) || left <= 0 ||
        typeof data.csrf_token !== 'string' || data.lifetime_seconds !== 300) {
      throw new Error(expiredText);
    }
    // A status request only reports the ORIGINAL server expiry; it cannot renew it.
    if (!active || active.csrf_token !== data.csrf_token) generation += 1;
    active = data;
    monoDeadline = performance.now() + left;
    wallDeadline = Date.now() + left;
    clearTimeout(clock);
    tick();
  }
  async function exchange(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    headers.set('X-Becs-Client', 'mini-app');
    if (options.body) headers.set('Content-Type', 'application/json');
    if (active) headers.set('X-Becs-CSRF', active.csrf_token);
    // Never use legacy credential headers for normal API calls.
    headers.delete('X-Becs-Key');
    headers.delete('X-Telegram-Init-Data');
    const started = performance.now();
    const response = await fetch(path, {...options, headers, credentials: 'same-origin', cache: 'no-store'});
    const data = await response.json().catch(() => ({detail: 'Unexpected server response.'}));
    if (!response.ok) {
      const error = new Error(typeof data.detail === 'string' ? data.detail : 'Becs could not complete this request.');
      error.status = response.status;
      throw error;
    }
    return {data, elapsed: performance.now() - started};
  }
  async function restore() {
    if (restoring) return restoring;
    conceal(true);
    const originalGeneration = generation;
    restoring = (async () => {
      try {
        const {data, elapsed} = await exchange('/api/auth/session');
        if (originalGeneration !== generation) return;
        const wasLocked = !active;
        accept(data, elapsed);
        restoring = null;
        if (wasLocked) await onUnlock();
        conceal(false);
      } catch (error) {
        lock(error.status === 401 ? 'Unlock Becs for five minutes.' :
          'Could not verify your session. Check the connection and tap Retry session.');
      } finally {
        restoring = null;
      }
    })();
    return restoring;
  }
  async function login(credentials) {
    const {data, elapsed} = await exchange('/api/auth/login', {method: 'POST', body: JSON.stringify(credentials)});
    accept(data, elapsed);
    await onUnlock();
    conceal(false);
  }
  async function logout() {
    try {
      await exchange('/api/auth/logout', {method: 'POST'});
      lock('Logged out of the dashboard. Your forwarding bot is still running.');
    } catch (_) {
      lock('This screen is locked. Server logout could not be confirmed; the session still expires after five minutes.');
    }
  }
  async function request(path, options = {}) {
    if (restoring) await restoring;
    if (!active || remaining() <= 0) {
      lock();
      const error = new Error(expiredText); error.status = 401; throw error;
    }
    const startedIn = generation;
    try {
      const {data} = await exchange(path, options);
      // Discard responses that arrive after logout/expiry or from a previous session.
      if (startedIn !== generation || !active || remaining() <= 0) {
        const error = new Error(expiredText); error.status = 401; throw error;
      }
      return data;
    } catch (error) {
      if (error.status === 401 && startedIn === generation) lock();
      throw error;
    }
  }
  async function start(callbacks) {
    onUnlock = callbacks.onUnlock;
    onLock = callbacks.onLock;
    node('dashboardLogout')?.addEventListener('click', logout);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) conceal(true);
      else if (active && remaining() <= 0) lock();
      else void restore();
    });
    window.addEventListener('pagehide', () => conceal(true));
    window.addEventListener('pageshow', event => { if (event.persisted) void restore(); });
    window.addEventListener('focus', () => {
      if (active && remaining() <= 0) lock();
    });
    await restore();
  }
  window.BecsSession = {start, request, login, logout, restore};
})();
