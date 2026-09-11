// Deterministic checks. The model's self-reported confidence is a starting point, never the final word:
// arithmetic that doesn't add up, or a value that doesn't appear in the source text, caps the field's confidence.
// Anything below REVIEW_THRESHOLD goes to the human review queue.
export const REVIEW_THRESHOLD = 0.75;

const close = (a, b, tol = 0.02) => Math.abs(a - b) <= tol + 1e-9;
const norm = (s) => String(s).toLowerCase().replace(/[\s,]/g, "");
const inSource = (v, src) => v != null && String(v).trim() !== "" && norm(src).includes(norm(v));
const numInSource = (n, src) => {
  const s = norm(src);
  const f = Number(n);
  return [f.toFixed(2), String(f), String(Math.round(f))].some((v) => s.includes(norm(v)));
};

export function runChecks(schema, data, modelConfidence, source) {
  const fields = Object.keys(data);
  const confidence = {};
  const reasons = {};
  const checks = [];
  for (const f of fields) {
    const c = Number(modelConfidence?.[f]);
    confidence[f] = Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0.6; // no self-report -> assume middling
  }
  const check = (name, pass, field, max, why) => {
    checks.push({ name, pass, field });
    if (!pass) {
      confidence[field] = Math.min(confidence[field], max);
      (reasons[field] ??= []).push(why);
    }
  };

  if (schema === "invoice") {
    data.line_items.forEach((li, i) =>
      check(`line ${i + 1}: quantity × unit price = amount`, close(li.quantity * li.unit_price, li.amount), "line_items", 0.5, `line ${i + 1} does not add up`)
    );
    const sum = data.line_items.reduce((a, li) => a + li.amount, 0);
    check("subtotal = sum of line amounts", close(sum, data.subtotal), "subtotal", 0.4, `line amounts add up to ${sum.toFixed(2)}, not ${data.subtotal}`);
    const expected = data.subtotal + (data.tax || 0);
    check("total = subtotal + tax", close(expected, data.total), "total", 0.4, `subtotal + tax = ${expected.toFixed(2)}, not ${data.total}`);
    check("invoice number appears in the document", inSource(data.invoice_number, source), "invoice_number", 0.3, "not found word for word in the document");
    if (data.vendor_email) check("vendor email appears in the document", inSource(data.vendor_email, source), "vendor_email", 0.3, "not found word for word in the document");
    check("total appears in the document", numInSource(data.total, source), "total", 0.6, "this amount does not appear in the document");
    if (data.due_date) check("due date is not before invoice date", data.due_date >= data.invoice_date, "due_date", 0.4, "due date is before the invoice date");
  }

  if (schema === "email") {
    check("sender email appears in the document", inSource(data.sender_email, source), "sender_email", 0.3, "not found word for word in the document");
    if (data.budget) check("budget amount appears in the document", numInSource(data.budget.amount, source), "budget", 0.4, "this amount does not appear in the email");
    if (data.deadline)
      check(
        "the email mentions a date",
        /\b\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}/i.test(source),
        "deadline",
        0.4,
        "no date appears in the email, so the deadline may be invented"
      );
  }

  for (const f of fields) confidence[f] = Math.round(confidence[f] * 100) / 100;
  const needs_review = fields
    .filter((f) => confidence[f] < REVIEW_THRESHOLD)
    .map((f) => ({ field: f, value: data[f], confidence: confidence[f], reasons: reasons[f] || ["the model reported low confidence"] }));
  return { confidence, checks, needs_review };
}
