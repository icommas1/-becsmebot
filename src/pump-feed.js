const { PublicKey } = require("@solana/web3.js");

const MAX_LAUNCHES = 5000;
const LAUNCH_TTL_MS = 60 * 60 * 1000;
const MAX_RECONNECT_MS = 5 * 60 * 1000;

function createPumpFeed({ WebSocket = require("ws"), apiKey = "", now = Date.now,
  onEvent = () => {} } = {}) {
  const launches = new Map();
  let socket = null;
  let reconnectTimer = null;
  let stopped = true;
  let retryMs = 5000;
  let status = "stopped";
  let lastError = null;
  let lastEventAt = null;

  function recordError(error) {
    const message = String(error?.message || error || "connection failed");
    lastError = (apiKey ? message.replaceAll(apiKey, "[redacted]") : message)
      .slice(0, 200);
  }

  function validMint(value) {
    if (typeof value !== "string") return false;
    try { return new PublicKey(value).toBase58() === value; }
    catch (_) { return false; }
  }

  function prune() {
    const cutoff = now() - LAUNCH_TTL_MS;
    for (const [mint, launch] of launches) {
      if (launch.seenAt < cutoff) launches.delete(mint);
    }
    while (launches.size > MAX_LAUNCHES) {
      launches.delete(launches.keys().next().value);
    }
  }

  function handleMessage(raw) {
    let event;
    try { event = JSON.parse(raw.toString()); }
    catch (_) { return; }
    if (!validMint(event?.mint)) return;
    const type = String(event.txType || "").toLowerCase();
    if (type === "migrate" || type === "migration") {
      launches.delete(event.mint);
      lastEventAt = new Date(now()).toISOString();
      onEvent({ type: "migration", mint: event.mint });
      return;
    }
    if (type !== "create") return;
    launches.delete(event.mint);
    launches.set(event.mint, {
      id: event.mint,
      name: typeof event.name === "string" ? event.name.slice(0, 120) : "",
      symbol: typeof event.symbol === "string" ? event.symbol.slice(0, 32) : "",
      seenAt: now(), source: "PumpPortal launch stream"
    });
    lastEventAt = new Date(now()).toISOString();
    prune();
    onEvent({ type: "launch", mint: event.mint });
  }

  function reconnect() {
    if (stopped || reconnectTimer) return;
    status = "reconnecting";
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, retryMs);
    retryMs = Math.min(retryMs * 2, MAX_RECONNECT_MS);
  }

  function connect() {
    if (stopped) return;
    const url = "wss://pumpportal.fun/api/data" +
      (apiKey ? "?api-key=" + encodeURIComponent(apiKey) : "");
    status = "connecting";
    try {
      socket = new WebSocket(url, { handshakeTimeout: 10000 });
    } catch (error) {
      recordError(error);
      reconnect();
      return;
    }
    const current = socket;
    current.on("open", () => {
      if (stopped || socket !== current) return;
      status = "connected";
      lastError = null;
      retryMs = 5000;
      console.log("Pump launch feed connected");
      current.send(JSON.stringify({ method: "subscribeNewToken" }));
      current.send(JSON.stringify({ method: "subscribeMigration" }));
    });
    current.on("message", handleMessage);
    current.on("error", (error) => {
      recordError(error);
    });
    current.on("close", () => {
      if (socket === current) socket = null;
      if (!stopped) console.warn("Pump launch feed disconnected; reconnecting");
      reconnect();
    });
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      status = "stopped";
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (socket) socket.close();
      socket = null;
    },
    snapshot() {
      prune();
      return [...launches.values()].reverse();
    },
    status() {
      return { status, lastError, lastEventAt, recentLaunches: launches.size };
    },
    // Exposed for deterministic feed parsing tests; never sends a transaction.
    handleMessage
  };
}

module.exports = { createPumpFeed };
