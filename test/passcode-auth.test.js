const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { createPasscodeAuth } = require("../src/passcode-auth");

async function fixture(t, dataDir, clock) {
  const app = express(); app.use(express.json());
  const auth = createPasscodeAuth({ dataDir, setupToken: "private-one-time-token",
    setupExpires: new Date(clock.at + 86400000).toISOString(), now: () => clock.at });
  auth.mount(app);
  app.get("/protected", auth.requireAuth, (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = "http://127.0.0.1:" + server.address().port;
  return async (url, body, cookie, headers = {}) => {
    const response = await fetch(base + url, { method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json(),
      cookie: response.headers.get("set-cookie"), retry: response.headers.get("retry-after") };
  };
}

test("private setup saves only a hash, issues an HttpOnly session, and survives restart", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "becs-auth-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const clock = { at: Date.now() }, request = await fixture(t, dir, clock);
  assert.equal((await request("/protected", null, null, { "x-dashboard-key": "old-key" })).status, 401);
  assert.equal((await request("/api/auth/setup", { token: "wrong", passcode: "017329", confirm: "017329" })).status, 401);
  const setup = await request("/api/auth/setup", { token: "private-one-time-token", passcode: "017329", confirm: "017329" });
  assert.equal(setup.status, 200);
  assert.match(setup.cookie, /HttpOnly/); assert.match(setup.cookie, /Secure/); assert.match(setup.cookie, /SameSite=Strict/);
  assert.equal(fs.readFileSync(path.join(dir, "passcode.json"), "utf8").includes("017329"), false);
  const session = setup.cookie.split(";")[0];
  assert.equal((await request("/protected", null, session)).status, 200);
  assert.equal((await request("/api/auth/setup", { token: "private-one-time-token", passcode: "654321", confirm: "654321" })).status, 409);
  assert.equal((await request("/api/auth/passcode", { current: "017329", passcode: "904572", confirm: "904572" }, session)).status, 200);
  assert.equal((await request("/protected", null, session)).status, 401);
  const restarted = await fixture(t, dir, clock);
  assert.equal((await restarted("/api/auth/login", { passcode: "017329" })).status, 401);
  const login = await restarted("/api/auth/login", { passcode: "904572" });
  assert.equal(login.status, 200);
  assert.equal((await restarted("/api/auth/logout", {}, login.cookie.split(";")[0])).status, 200);
  assert.equal((await restarted("/protected", null, login.cookie.split(";")[0])).status, 401);
});

test("five attempts trigger a cooldown and cross-origin login is rejected", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "becs-auth-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const clock = { at: Date.now() }, request = await fixture(t, dir, clock);
  await request("/api/auth/setup", { token: "private-one-time-token", passcode: "017329", confirm: "017329" });
  assert.equal((await request("/api/auth/login", { passcode: "017329" }, null, { origin: "https://elsewhere.example" })).status, 403);
  for (let i = 0; i < 5; i++) assert.equal((await request("/api/auth/login", { passcode: "000000" })).status, 401);
  const blocked = await request("/api/auth/login", { passcode: "017329" });
  assert.equal(blocked.status, 429); assert.equal(blocked.retry, "300");
  clock.at += 300001;
  assert.equal((await request("/api/auth/login", { passcode: "017329" })).status, 200);
});
