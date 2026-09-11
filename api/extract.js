// POST /api/extract  { schema: "invoice" | "email", text }
// 1. Ask a free model for {"data": ..., "confidence": {field: 0-1}} in JSON mode.
// 2. Validate data with Zod. If JSON parsing or validation fails, send the exact errors back to the model and
//    retry (up to 3 attempts in total). Every attempt is logged with its model, latency, tokens and errors.
// 3. Run deterministic checks that can lower confidence; low-confidence fields are returned as needs_review.
import { chat, parseJsonObject } from "../lib/openrouter.js";
import { SCHEMAS } from "../lib/schemas.js";
import { runChecks } from "../lib/checks.js";

const MAX_ATTEMPTS = 3;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { schema, text } = req.body || {};
  const spec = SCHEMAS[schema];
  if (!spec) return res.status(400).json({ error: `schema must be one of: ${Object.keys(SCHEMAS).join(", ")}` });
  if (typeof text !== "string" || text.trim().length < 20 || text.length > 8000)
    return res.status(400).json({ error: "text must be 20-8000 characters" });

  const fields = Object.keys(spec.schema.shape);
  const messages = [
    {
      role: "system",
      content:
        `${spec.instructions}\nReturn ONLY a JSON object of the form {"data": {...}, "confidence": {...}} where "confidence" ` +
        `has a number from 0 to 1 for each of these fields: ${fields.join(", ")}. Use low confidence when a value is unclear, inferred or missing.`,
    },
    { role: "user", content: `Document:\n"""\n${text}\n"""` },
  ];

  const t0 = Date.now();
  const attempts = [];
  const tokens = { prompt: 0, completion: 0 };
  let result = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let r;
    try {
      r = await chat({ messages, json: true, maxTokens: 1000 });
    } catch (e) {
      attempts.push({ attempt, ok: false, errors: [e.message.slice(0, 300)] });
      break;
    }
    tokens.prompt += r.usage?.prompt_tokens || 0;
    tokens.completion += r.usage?.completion_tokens || 0;

    const { obj, error } = parseJsonObject(r.content);
    let issues = error ? [error] : [];
    if (obj) {
      const v = spec.schema.safeParse(obj.data ?? obj);
      if (v.success) result = { data: v.data, confidence: obj.confidence || {} };
      else issues = v.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    }
    attempts.push({ attempt, model: r.model, ok: !!result, ms: r.latency_ms, tokens: r.usage || null, errors: issues.slice(0, 8) });
    if (result) break;
    messages.push(
      { role: "assistant", content: r.content.slice(0, 4000) },
      { role: "user", content: `That JSON failed validation:\n- ${issues.slice(0, 10).join("\n- ")}\nReturn the corrected JSON object only, in the same shape.` }
    );
  }

  const latency_ms = Date.now() - t0;
  if (!result) return res.status(422).json({ ok: false, error: `no valid JSON after ${attempts.length} attempt(s)`, attempts, latency_ms, tokens, cost_usd: 0 });
  const { confidence, checks, needs_review } = runChecks(schema, result.data, result.confidence, text);
  return res.status(200).json({ ok: true, schema, data: result.data, confidence, checks, needs_review, attempts, latency_ms, tokens, cost_usd: 0 });
}
