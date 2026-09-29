const test = require("node:test");
const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const { createPumpFeed } = require("../src/pump-feed");

class FakeSocket extends EventEmitter {
  static instances = [];
  constructor(url) {
    super();
    this.url = url;
    this.sent = [];
    FakeSocket.instances.push(this);
  }
  send(message) { this.sent.push(JSON.parse(message)); }
  close() { this.emit("close"); }
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
