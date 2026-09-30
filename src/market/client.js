function createJupiterClient({ apiKey, fetchImpl = fetch, now = Date.now,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), gapMs = 2200, maxPending = 24 }) {
  let queue = Promise.resolve(), nextAt = 0, pending = 0;
  return function request(url) {
    if (pending >= maxPending) return Promise.reject(new Error("Market requests busy. Try again shortly."));
    pending++;
    const result = queue.catch(() => {}).then(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const delay = Math.max(0, nextAt - now());
        if (delay) await wait(delay);
        nextAt = now() + gapMs;
        const response = await fetchImpl("https://api.jup.ag" + url, {
          headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(10000)
        });
        const data = await response.json().catch(() => null);
        if (response.ok && data != null) return data;
        if (response.status === 429 && attempt === 0) {
          const reset = Number(response.headers.get("x-ratelimit-reset"));
          const backoff = Number.isFinite(reset) && reset > 0
            ? Math.max(gapMs, reset * 1000 - now() + 250) : 5000;
          nextAt = now() + Math.min(backoff, 60000);
          continue;
        }
        throw new Error("Jupiter " + response.status + " data unavailable");
      }
    }).finally(() => { pending--; });
    queue = result.catch(() => {});
    return result;
  };
}

module.exports = { createJupiterClient };
