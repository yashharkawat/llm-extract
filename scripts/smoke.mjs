// Smoke test, run before every push: runs the real extract handler on the three samples. Needs OPENROUTER_API_KEY.
// Expects: the clean invoice validates with total 66670 and no review on total; the bad invoice flags subtotal
// and total for review; the email lead comes back with an 80000 INR budget. Exits 1 on failure.
import extract from "../api/extract.js";
import { SAMPLES } from "../public/samples.js";

const run = async (key) => {
  const { schema, text } = SAMPLES[key];
  let status = 0;
  let body;
  const res = { status(c) { status = c; return this; }, json(o) { body = o; return this; }, setHeader() {} };
  await extract({ method: "POST", body: { schema, text } }, res);
  const review = (body.needs_review || []).map((r) => r.field);
  console.log(`${key.padEnd(14)} ${status} attempts=${body.attempts?.length} ${body.latency_ms}ms review=[${review}] ${body.ok ? "" : body.error}`);
  return { status, body, review };
};

const clean = await run("invoice_clean");
const bad = await run("invoice_bad");
const email = await run("email_lead");
const ok =
  clean.status === 200 && clean.body.data.total === 66670 && !clean.review.includes("total") &&
  bad.status === 200 && bad.review.includes("subtotal") && bad.review.includes("total") &&
  email.status === 200 && email.body.data.budget?.amount === 80000 && email.body.data.budget?.currency === "INR";
console.log(ok ? "SMOKE PASS" : "SMOKE FAIL");
process.exitCode = ok ? 0 : 1; // not process.exit(): onnxruntime can crash on a forced exit
