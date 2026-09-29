const test = require("node:test");
const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const { PublicKey } = require("@solana/web3.js");
const { createPumpFeed } = require("../src/pump-feed");

class FakeSocket extends EventEmitter {
  static instances = [];
  constructor(url) {
    super();
    this.url = url;
    this.sent = [];
    this.readyState = 0;
    FakeSocket.instances.push(this);
  }
  send(message) { this.sent.push(JSON.parse(message)); }
  close() { this.readyState = 3; this.emit("close"); }
}

test("subscribes once and handles launch, duplicate, migration, and invalid events", () => {
  FakeSocket.instances = [];
  let clock = 0;
  const events = [];
  const feed = createPumpFeed({ WebSocket: FakeSocket, now: () => clock,
    onEvent: (event) => events.push(event) });
  feed.start();
  feed.start();
  assert.equal(FakeSocket.instances.length, 1);
  const socket = FakeSocket.instances[0];
  socket.readyState = 1;
  socket.emit("open");
  assert.deepEqual(socket.sent, [
    { method: "subscribeNewToken" }, { method: "subscribeMigration" }
  ]);

  const mint = "So11111111111111111111111111111111111111112";
  socket.emit("message", Buffer.from(JSON.stringify({
    txType: "create", mint, symbol: "FIRST"
  })));
  assert.equal(feed.snapshot()[0].symbol, "FIRST");
  assert.equal(feed.status().recentLaunches, 1);

  clock += 1000;
  socket.emit("message", Buffer.from(JSON.stringify({
    txType: "create", mint, symbol: "UPDATED"
  })));
  socket.emit("message", Buffer.from(JSON.stringify({
    txType: "create", mint: "bad", symbol: "INVALID"
  })));
  assert.equal(feed.snapshot().length, 1);
  assert.equal(feed.snapshot()[0].symbol, "UPDATED");

  socket.emit("message", Buffer.from(JSON.stringify({ txType: "migration", mint })));
  assert.deepEqual(feed.snapshot(), []);
  assert.deepEqual(events, [
    { type: "launch", mint }, { type: "launch", mint },
    { type: "migration", mint }
  ]);
  feed.stop();
  assert.equal(feed.status().status, "stopped");
});

test("paid trades watch selected mints on one socket and stop at the event cap", () => {
  FakeSocket.instances = [];
  let clock = 100000;
  const feed = createPumpFeed({ WebSocket: FakeSocket, apiKey: "secret",
    now: () => clock });
  const mint = "So11111111111111111111111111111111111111112";
  feed.setTradeMints([mint, "invalid"]);
  feed.start();
  const socket = FakeSocket.instances[0];
  assert.equal(socket.sent.length, 0);
  assert.equal(socket.url.includes("secret"), true);
  socket.readyState = 1;
  socket.emit("open");
  assert.deepEqual(socket.sent[2], { method: "subscribeTokenTrade", keys: [mint] });
  socket.emit("message", JSON.stringify({ txType: "buy", mint }));
  clock += 1000;
  socket.emit("message", JSON.stringify({ txType: "sell", mint }));
  assert.deepEqual(feed.tradeActivity()[mint], { buys: 1, sells: 1 });
  for (let i = 0; i < 998; i++) {
    socket.emit("message", JSON.stringify({ txType: "buy", mint }));
  }
  assert.equal(feed.status().tradeFeedCapped, true);
  assert.equal(feed.status().watchedMints, 0);
  assert.deepEqual(socket.sent.at(-1), {
    method: "unsubscribeTokenTrade", keys: [mint]
  });
  feed.setTradeMints([mint]);
  assert.equal(feed.status().watchedMints, 0);
  feed.stop();
});

test("expires stale launch events", () => {
  let clock = 0;
  const feed = createPumpFeed({ now: () => clock });
  feed.handleMessage(JSON.stringify({
    txType: "create", mint: "So11111111111111111111111111111111111111112"
  }));
  assert.equal(feed.snapshot().length, 1);
  clock = 60 * 60 * 1000 + 1;
  assert.equal(feed.snapshot().length, 0);
});

test("paid stream covers the full verified trending scan", () => {
  FakeSocket.instances = [];
  const feed = createPumpFeed({ WebSocket: FakeSocket, apiKey: "test-key" });
  const mints = Array.from({ length: 105 }, (_, index) => {
    const bytes = Buffer.alloc(32);
    bytes.writeUInt32LE(index + 1);
    return new PublicKey(bytes).toBase58();
  });
  feed.setTradeMints(mints);
  feed.start();
  const socket = FakeSocket.instances[0];
  socket.readyState = 1;
  socket.emit("open");
  assert.equal(feed.status().watchedMints, 100);
  assert.deepEqual(socket.sent[2].keys, mints.slice(0, 100));
  feed.stop();
});
