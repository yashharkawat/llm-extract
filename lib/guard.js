// Abuse guard for the public demo endpoints. The key behind them is personal, so every request passes here first:
// method, origin, body size, a per-visitor limit and a daily cap for the whole site.
// The counters live in memory, so they are per warm function instance: a speed bump against casual abuse.
// The hard backstop against cost is in openrouter.js, where only ":free" model ids can ever be sent.
const buckets = new Map();
const MAX_KEYS = 5000;

function hit(key, max, windowMs, now = Date.now()) {
  const recent = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    buckets.set(key, recent);
    return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - recent[0])) / 1000) };
  }
  recent.push(now);
  if (buckets.size >= MAX_KEYS && !buckets.has(key)) buckets.delete(buckets.keys().next().value);
  buckets.set(key, recent);
  return { ok: true, retryAfterSec: 0 };
}

function clientIp(req) {
  const fwd = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim(); // Vercel sets this itself
  return fwd || req.headers?.["x-real-ip"] || "unknown";
}

/** A browser on another website must not be able to spend this endpoint. Same-site and non-browser calls pass. */
function originAllowed(req) {
  const origin = req.headers?.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

const DAILY_BUDGET = Number(process.env.DEMO_DAILY_BUDGET || 60);

/**
 * guard(req, res, { perMinute, perDay }) -> true when the request may go on.
 * When it returns false the response has already been sent.
 */
export function guard(req, res, { perMinute = 5, perDay = 30, maxBodyBytes = 40_000 } = {}) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" }), false;
  if (!originAllowed(req)) return res.status(403).json({ error: "This endpoint only serves its own page." }), false;
  if (Number(req.headers?.["content-length"] || 0) > maxBodyBytes || JSON.stringify(req.body || {}).length > maxBodyBytes)
    return res.status(413).json({ error: "Request is too large." }), false;

  const ip = clientIp(req);
  const minute = hit(`m:${ip}`, perMinute, 60_000);
  const day = hit(`d:${ip}`, perDay, 86_400_000);
  if (!minute.ok || !day.ok) {
    res.setHeader("Retry-After", String(Math.max(minute.retryAfterSec, day.retryAfterSec)));
    return res.status(429).json({ error: "Too many requests. Please wait a minute and try again." }), false;
  }
  if (!hit("global", DAILY_BUDGET, 86_400_000).ok)
    return res.status(429).json({ error: "This demo has reached its limit for today. Please come back tomorrow." }), false;
  return true;
}

/** What a visitor sees when the model side fails. Details go to the server log only. */
export const BUSY = "The free models are busy right now. Please try again in a minute.";
