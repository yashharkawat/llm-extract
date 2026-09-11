// OpenRouter client, FREE MODELS ONLY: every model id must end in ":free".
// Tries the preferred models in order and moves on when one is rate-limited (429), gone (404),
// failing (5xx) or too slow. A model that failed is skipped for 10 minutes while the function stays warm.
const BASE = "https://openrouter.ai/api/v1";
const PREFERRED = (
  process.env.OPENROUTER_MODELS ||
  "google/gemma-4-31b-it:free,nex-agi/nex-n2.5-pro:free,nvidia/nemotron-3-super-120b-a12b:free,nex-agi/nex-n2.5-mini:free"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS || 12000);
const MAX_MODELS_PER_CALL = 4; // 4 x 12 s worst case, inside the 60 s function limit
const COOLDOWN_MS = 10 * 60_000;
const cooldown = new Map();

export function assertFree(id) {
  if (!id.endsWith(":free")) throw new Error(`refusing non-free OpenRouter model "${id}" (free models only)`);
  return id;
}

/**
 * chat({ messages, json, maxTokens, temperature })
 * -> { content, model, usage, latency_ms, tried: [{ model, ok, ms, error? }] }
 */
export async function chat({ messages, json = false, maxTokens = 600, temperature = 0 }) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set");
  const now = Date.now();
  const models = PREFERRED.map(assertFree);
  const ready = models.filter((m) => (cooldown.get(m) || 0) < now);
  const order = [...ready, ...models.filter((m) => !ready.includes(m))];
  const tried = [];

  for (const model of order.slice(0, MAX_MODELS_PER_CALL)) {
    const t0 = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        signal: ac.signal,
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.APP_URL || "https://yashharkawat.com",
          "X-Title": process.env.APP_NAME || "Yash Harkawat portfolio",
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature,
          ...(json ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      let body = await res.json().catch(() => ({}));
      let content = body.choices?.[0]?.message?.content;
      // Busy free models sometimes answer 200 with empty content in JSON mode. Give the same model one more
      // try without response_format (the prompt still asks for JSON only) before moving to the next model.
      if (json && res.ok && !body.error && !(typeof content === "string" && content.trim())) {
        const retry = await fetch(`${BASE}/chat/completions`, {
          method: "POST",
          signal: ac.signal,
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": process.env.APP_URL || "https://yashharkawat.com",
            "X-Title": process.env.APP_NAME || "Yash Harkawat portfolio",
          },
          body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
        }).catch(() => null);
        if (retry?.ok) {
          body = await retry.json().catch(() => ({}));
          content = body.choices?.[0]?.message?.content;
        }
      }
      if (res.ok && !body.error && typeof content === "string" && content.trim()) {
        tried.push({ model, ok: true, ms: Date.now() - t0 });
        return { content, model, usage: body.usage || null, latency_ms: Date.now() - t0, tried };
      }
      tried.push({ model, ok: false, ms: Date.now() - t0, error: `${res.status} ${body.error?.message || "empty reply"}`.slice(0, 160) });
    } catch (e) {
      tried.push({ model, ok: false, ms: Date.now() - t0, error: e.name === "AbortError" ? `timeout after ${TIMEOUT_MS} ms` : e.message });
    } finally {
      clearTimeout(timer);
    }
    cooldown.set(model, Date.now() + COOLDOWN_MS);
  }
  const err = new Error("all free models failed: " + tried.map((t) => `${t.model}: ${t.error}`).join(" | "));
  err.tried = tried;
  throw err;
}

/** Parse a JSON object out of a model reply, tolerating ```json fences and leading prose. */
export function parseJsonObject(text) {
  const t = String(text).replace(/```(?:json)?/gi, "").trim();
  try {
    return { obj: JSON.parse(t) };
  } catch {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return { obj: JSON.parse(t.slice(start, end + 1)) };
      } catch (e) {
        return { error: `invalid JSON: ${e.message}` };
      }
    }
    return { error: "reply contained no JSON object" };
  }
}
