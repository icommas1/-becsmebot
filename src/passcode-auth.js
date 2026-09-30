const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const scrypt = promisify(crypto.scrypt);
const SESSION_MS = 12 * 60 * 60 * 1000;
const COOLDOWN_MS = 5 * 60 * 1000;
const validPin = (pin) => typeof pin === "string" && /^\d{6}$/.test(pin);

function equal(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createPasscodeAuth({ dataDir, setupToken, setupExpires, now = Date.now, secureCookie = true }) {
  const file = dataDir ? path.join(dataDir, "passcode.json") : null;
  let verifier = file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  if (verifier && (!/^[a-f0-9]{32}$/.test(verifier.salt) || !/^[a-f0-9]{64}$/.test(verifier.hash))) {
    throw new Error("Invalid saved passcode verifier");
  }
  let setupBusy = false;
  const sessions = new Map(), attempts = new Map();
  let globalAttempts = [];

  function sessionToken(req) {
    const cookie = String(req.get("cookie") || "").split(";").map((item) => item.trim())
      .find((item) => item.startsWith("becs_session="));
    const token = cookie?.slice("becs_session=".length);
    return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
  }
  function authenticated(req) {
    const token = sessionToken(req), session = sessions.get(token);
    if (!session || session.expires <= now()) { if (token) sessions.delete(token); return false; }
    return true;
  }
  function cookie(res, token, maxAge) {
    res.set("Set-Cookie", "becs_session=" + token + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + maxAge +
      (secureCookie ? "; Secure" : ""));
  }
  function startSession(res) {
    for (const [token, session] of sessions) if (session.expires <= now()) sessions.delete(token);
    while (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { expires: now() + SESSION_MS });
    cookie(res, token, SESSION_MS / 1000);
  }
  function allowAttempt(req, res) {
    const ip = req.ip || "unknown";
    let attempt = attempts.get(ip);
    globalAttempts = globalAttempts.filter((at) => at > now() - COOLDOWN_MS);
    const until = attempt?.blockedUntil || 0;
    if (until > now() || globalAttempts.length >= 30) {
      const seconds = Math.max(1, Math.ceil(((until > now() ? until : globalAttempts[0] + COOLDOWN_MS) - now()) / 1000));
      res.set("Retry-After", String(seconds));
      res.status(429).json({ error: "Too many attempts. Try again in " + Math.ceil(seconds / 60) + " minute(s)." });
      return false;
    }
    if (!attempt || attempt.at < now() - COOLDOWN_MS) attempt = { hits: 0 };
    attempt.hits++; attempt.at = now();
    if (attempt.hits >= 5) attempt.blockedUntil = now() + COOLDOWN_MS;
    attempts.set(ip, attempt); globalAttempts.push(now());
    if (attempts.size > 10000) attempts.delete(attempts.keys().next().value);
    return true;
  }
  function fail(req, res, error = "Incorrect passcode") {
    res.status(401).json({ error });
  }
  async function matches(pin) {
    if (!validPin(pin) || !verifier) return false;
    const hash = (await scrypt(pin, verifier.salt, 32)).toString("hex");
    return equal(hash, verifier.hash);
  }
  async function savePin(pin) {
    if (!file) throw new Error("Passcode storage is not ready");
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = (await scrypt(pin, salt, 32)).toString("hex");
    const saved = { salt, hash };
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file + ".tmp", JSON.stringify(saved), { mode: 0o600 });
    fs.renameSync(file + ".tmp", file);
    verifier = saved;
  }
  function sameOrigin(req, res, next) {
    const origin = req.get("origin");
    if (origin) {
      try { if (new URL(origin).host !== req.get("host")) throw Error(); }
      catch (_) { return res.status(403).json({ error: "Request origin rejected" }); }
    }
    next();
  }
  function requireAuth(req, res, next) {
    if (!authenticated(req)) return res.status(401).json({ error: "Enter your passcode" });
    sameOrigin(req, res, next);
  }
  function mount(app) {
    app.get("/api/auth/status", (req, res) => res.json({ configured: Boolean(verifier), authenticated: authenticated(req) }));
    app.post("/api/auth/setup", sameOrigin, async (req, res) => {
      if (!allowAttempt(req, res)) return;
      if (verifier || setupBusy) return res.status(409).json({ error: "Passcode is already set" });
      if (!file) return res.status(503).json({ error: "Passcode storage is not ready" });
      if (!setupToken || Date.parse(setupExpires) <= now() || !Number.isFinite(Date.parse(setupExpires)) ||
          !equal(req.body?.token, setupToken)) return fail(req, res, "Setup link expired or invalid");
      if (!validPin(req.body?.passcode) || req.body.passcode !== req.body.confirm)
        return res.status(400).json({ error: "Enter and confirm six digits" });
      setupBusy = true;
      try { await savePin(req.body.passcode); attempts.delete(req.ip); startSession(res); res.json({ ok: true }); }
      catch (_) { res.status(503).json({ error: "Could not save passcode. Try again." }); }
      finally { setupBusy = false; }
    });
    app.post("/api/auth/login", sameOrigin, async (req, res) => {
      if (!allowAttempt(req, res)) return;
      if (!await matches(req.body?.passcode)) return fail(req, res);
      attempts.delete(req.ip); startSession(res); res.json({ ok: true });
    });
    app.post("/api/auth/logout", (req, res) => {
      sessions.delete(sessionToken(req)); cookie(res, "", 0); res.json({ ok: true });
    });
    app.post("/api/auth/passcode", requireAuth, async (req, res) => {
      if (!allowAttempt(req, res)) return;
      if (!await matches(req.body?.current)) return fail(req, res);
      if (!validPin(req.body?.passcode) || req.body.passcode !== req.body.confirm)
        return res.status(400).json({ error: "Enter and confirm six digits" });
      try { await savePin(req.body.passcode); sessions.clear(); startSession(res); res.json({ ok: true }); }
      catch (_) { res.status(503).json({ error: "Could not save passcode. Try again." }); }
    });
  }
  return { mount, requireAuth };
}

module.exports = { createPasscodeAuth };
