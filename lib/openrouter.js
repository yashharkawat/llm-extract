// OpenRouter client, FREE MODELS ONLY: every model id must end in ":free", checked right before each request.
// Tries the preferred models in order and moves on when one is rate-limited (429), gone (404),
// failing (5xx), silent or too slow. A model that failed is skipped for 10 minutes while the function stays warm.
// Free models come and go, so the list is topped up from OpenRouter's live catalogue (cached for an hour).
const BASE = "https://openrouter.ai/api/v1";
const PREFERRED = [
  "particle-ai/particle-1:free",
  "baidu/ernie-5.5-flash-preview:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
];
const TIMEOUT_MS = 10_000;
const MAX_MODELS_PER_CALL = 5; // 5 x 10 s worst case, inside the 60 s function limit
const COOLDOWN_MS = 10 * 60_000;
const cooldown = new Map();
let catalogue = { at: 0, models: PREFERRED };

/** A paid slug can never be sent, whatever the catalogue or a future edit says. */
export function assertFree(id) {
  if (!/^[\w.-]+\/[\w.:-]+:free$/.test(String(id))) throw new Error("refusing a non-free model id");
  return id;
}

async function refreshCatalogue() {
  try {
    const res = await fetch(`${BASE}/models`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return;
    const live = ((await res.json()).data || []).map((m) => m.id).filter((id) => typeof id === "string" && id.endsWith(":free"));
    if (live.length) catalogue = { at: Date.now(), models: [...PREFERRED.filter((m) => live.includes(m)), ...live.filter((m) => !PREFERRED.includes(m))] };
  } catch {
    /* keep the list we have */
  }
}

function modelList() {
  if (Date.now() - catalogue.at > 3_600_000) {
    catalogue = { at: Date.now(), models: catalogue.models };
    refreshCatalogue(); // on the side: nobody waits for it
  }
  return catalogue.models;
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.APP_URL || "https://yashharkawat.com",
    "X-Title": process.env.APP_NAME || "Yash Harkawat portfolio",
  };
}

/**
 * chat({ messages, json, maxTokens, temperature })
 * -> { content, model, usage, latency_ms, tried: [{ model, ok, ms, error? }] }
 * `error` is a short code ("429", "timeout", "empty"), never the provider's own text.
 * Throws an Error with a visitor-safe message when nothing answered.
 */
export async function chat({ messages, json = false, maxTokens = 600, temperature = 0 }) {
  if (!process.env.OPENROUTER_API_KEY) throw Object.assign(new Error("not configured"), { tried: [] });
  const now = Date.now();
  const models = modelList();
  const ready = models.filter((m) => (cooldown.get(m) || 0) < now);
  const order = [...ready, ...models.filter((m) => !ready.includes(m))];
  const tried = [];

  for (const model of order.slice(0, MAX_MODELS_PER_CALL)) {
    const t0 = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    const send = (withJsonMode) =>
      fetch(`${BASE}/chat/completions`, {
        method: "POST",
        signal: ac.signal,
        headers: headers(),
        body: JSON.stringify({
          model: assertFree(model),
          messages,
          max_tokens: maxTokens,
          temperature,
          reasoning: { effort: "low", exclude: true },
          ...(withJsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
      });
    try {
      let res = await send(json);
      let body = await res.json().catch(() => ({}));
      let content = body.choices?.[0]?.message?.content;
      // Some free models reject JSON mode or answer 200 with nothing. Give the same model one more try
      // without response_format (the prompt still asks for JSON only) before moving on.
      if (json && !(res.ok && !body.error && typeof content === "string" && content.trim())) {
        const retry = await send(false).catch(() => null);
        if (retry?.ok) {
          res = retry;
          body = await retry.json().catch(() => ({}));
          content = body.choices?.[0]?.message?.content;
        }
      }
      if (res.ok && !body.error && typeof content === "string" && content.trim()) {
        tried.push({ model, ok: true, ms: Date.now() - t0 });
        return { content, model, usage: body.usage || null, latency_ms: Date.now() - t0, tried };
      }
      console.log(JSON.stringify({ event: "llm_skip", model, status: res.status, detail: String(body.error?.message || "empty reply").slice(0, 200) }));
      tried.push({ model, ok: false, ms: Date.now() - t0, error: res.ok ? "empty" : String(res.status) });
    } catch (e) {
      console.log(JSON.stringify({ event: "llm_skip", model, detail: String(e?.name || e).slice(0, 80) }));
      tried.push({ model, ok: false, ms: Date.now() - t0, error: e?.name === "AbortError" ? "timeout" : "network" });
    } finally {
      clearTimeout(timer);
    }
    cooldown.set(model, Date.now() + COOLDOWN_MS);
  }
  throw Object.assign(new Error("all free models are busy"), { tried });
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
