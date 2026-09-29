const { PublicKey } = require("@solana/web3.js");

const MAX_LAUNCHES = 5000;
const LAUNCH_TTL_MS = 60 * 60 * 1000;
const MAX_RECONNECT_MS = 5 * 60 * 1000;
const MAX_TRADE_MINTS = 10;
const MAX_TRADE_EVENTS = 1000;
const TRADE_WINDOW_MS = 60 * 1000;

function createPumpFeed({ WebSocket = require("ws"), apiKey = "", now = Date.now,
  onEvent = () => {} } = {}) {
  const launches = new Map();
  const watched = new Set();
  const subscribed = new Set();
  const trades = new Map();
  let tradeEvents = 0;
  let socket = null;
  let reconnectTimer = null;
  let stopped = true;
  let retryMs = 5000;
  let status = "stopped";
  let lastError = null;
  let lastEventAt = null;

  function recordError(error) {
    const message = String(error?.message || error || "connection failed");
    lastError = (apiKey ? message.replaceAll(apiKey, "[redacted]")
      .replaceAll(encodeURIComponent(apiKey), "[redacted]") : message)
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
    if (event?.error) recordError(event.error);
    if (!validMint(event?.mint)) return;
    const type = String(event.txType || "").toLowerCase();
    if ((type === "buy" || type === "sell") && subscribed.has(event.mint)) {
      tradeEvents++;
      const recent = trades.get(event.mint) || [];
      recent.push({ at: now(), type });
      trades.set(event.mint, recent.filter((trade) =>
        trade.at > now() - TRADE_WINDOW_MS));
      lastEventAt = new Date(now()).toISOString();
      if (tradeEvents >= MAX_TRADE_EVENTS) {
        watched.clear();
        syncTradeSubscriptions();
      }
      return;
    }
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

  function sendSubscription(method, mints) {
    if (mints.length) {
      socket.send(JSON.stringify({ method, keys: mints }));
    }
  }

  function syncTradeSubscriptions() {
    if (socket?.readyState !== 1) return;
    const remove = [...subscribed].filter((mint) => !watched.has(mint));
    sendSubscription("unsubscribeTokenTrade", remove);
    for (const mint of remove) { subscribed.delete(mint); trades.delete(mint); }
    if (!apiKey || tradeEvents >= MAX_TRADE_EVENTS) return;
    const add = [...watched].filter((mint) => !subscribed.has(mint));
    sendSubscription("subscribeTokenTrade", add);
    for (const mint of add) subscribed.add(mint);
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
      syncTradeSubscriptions();
    });
    current.on("message", handleMessage);
    current.on("error", (error) => {
      recordError(error);
    });
    current.on("close", () => {
      if (socket === current) socket = null;
      subscribed.clear();
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
      subscribed.clear();
    },
    setTradeMints(mints) {
      watched.clear();
      if (apiKey && tradeEvents < MAX_TRADE_EVENTS) {
        for (const mint of mints) {
          if (watched.size >= MAX_TRADE_MINTS) break;
          if (validMint(mint)) watched.add(mint);
        }
      }
      syncTradeSubscriptions();
    },
    tradeActivity() {
      const cutoff = now() - TRADE_WINDOW_MS;
      return Object.fromEntries([...watched].map((mint) => {
        const recent = (trades.get(mint) || []).filter((trade) => trade.at > cutoff);
        trades.set(mint, recent);
        return [mint, {
          buys: recent.filter((trade) => trade.type === "buy").length,
          sells: recent.filter((trade) => trade.type === "sell").length
        }];
      }));
    },
    snapshot() {
      prune();
      return [...launches.values()].reverse();
    },
    status() {
      return { status, lastError, lastEventAt, recentLaunches: launches.size,
        paidTradeFeedConfigured: Boolean(apiKey), watchedMints: subscribed.size,
        tradeEvents, tradeEventLimit: MAX_TRADE_EVENTS,
        tradeFeedCapped: tradeEvents >= MAX_TRADE_EVENTS };
    },
    // Exposed for deterministic feed parsing tests; never sends a transaction.
    handleMessage
  };
}

module.exports = { createPumpFeed };
