import { HOME_LIMITS, HOME_READS } from './home-model.mjs';

export class HomeReadError extends Error {
  constructor(status = 0) { super('BecsBot read unavailable.'); this.status = status; }
}
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(new HomeReadError());
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new HomeReadError());
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}
// The URL cannot be built from a question, an account ID, a provider or a caller-supplied cursor.
export async function readHomeJson(path, signal, fetcher = globalThis.fetch, limits = HOME_LIMITS) {
  if (!Object.values(HOME_READS).includes(path) || signal?.aborted) throw new HomeReadError();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, limits.requestTimeoutMs);
  let reader;
  try {
    const response = await abortable(fetcher(path, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { Accept: 'application/json' }, signal: controller.signal,
    }), controller.signal);
    if (!response.ok) throw new HomeReadError(response.status);
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json') ||
        Number(response.headers.get('content-length')) > limits.responseBytes || !response.body) throw new HomeReadError();
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0, content = '';
    while (true) {
      const { done, value } = await abortable(reader.read(), controller.signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limits.responseBytes) throw new HomeReadError();
      content += decoder.decode(value, { stream: true });
    }
    content += decoder.decode();
    return JSON.parse(content);
  } catch (error) {
    throw error instanceof HomeReadError ? error : new HomeReadError();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
  }
}
