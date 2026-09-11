import { SAMPLES } from "./samples.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const load = (k) => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const fmt = (v) => (v === null || v === undefined ? `<span class="na">null</span>` : typeof v === "object" ? `<pre>${esc(JSON.stringify(v, null, 2))}</pre>` : esc(v));

// ---------- tabs ----------
document.querySelectorAll(".tab").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".panel").forEach((p) => (p.hidden = p.id !== `tab-${b.dataset.tab}`));
    if (b.dataset.tab === "review") renderQueue();
    if (b.dataset.tab === "log") renderLog();
  })
);

// ---------- samples ----------
$("#sample-btns").innerHTML = Object.entries(SAMPLES).map(([k, s]) => `<button type="button" data-k="${k}">${esc(s.label)}</button>`).join("");
$("#sample-btns").querySelectorAll("button").forEach((b) =>
  b.addEventListener("click", () => { const s = SAMPLES[b.dataset.k]; $("#schema").value = s.schema; $("#text").value = s.text; })
);
$("#text").value = SAMPLES.invoice_bad.text;

// ---------- extract ----------
async function extract() {
  const schema = $("#schema").value;
  const text = $("#text").value;
  if (text.trim().length < 20) return alertBanner("bad", "Paste at least a few lines of text.");
  $("#go").disabled = true;
  $("#go").textContent = "Extracting… (free models can take 5–20 s)";
  try {
    const r = await fetch("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schema, text }) });
    const j = await r.json();
    render(j);
    record(j, schema);
  } catch (e) {
    alertBanner("bad", "Request failed: " + e.message);
  } finally {
    $("#go").disabled = false;
    $("#go").textContent = "Extract";
  }
}
$("#go").addEventListener("click", extract);

function alertBanner(kind, html) {
  $("#result").hidden = false;
  $("#banner").className = `banner ${kind}`;
  $("#banner").innerHTML = html;
}

function render(j) {
  $("#result").hidden = false;
  const n = j.attempts?.length || 0;
  if (!j.ok) {
    const why = (j.attempts || []).flatMap((a) => a.errors || []).slice(-1)[0] || "";
    alertBanner("bad", `<b>No valid output.</b> ${esc(j.error || "")}${why ? `<br><small>${esc(why)}</small>` : ""}<br><small>Free models are sometimes busy; trying again in a minute usually works.</small>`);
    $("#fields").innerHTML = "";
    $("#checks").innerHTML = "";
  } else {
    const flagged = j.needs_review.length;
    alertBanner(
      flagged ? "warn" : "good",
      `<b>Valid JSON</b> after ${n} attempt${n > 1 ? "s" : ""} · ${j.latency_ms} ms · ${j.tokens.prompt} / ${j.tokens.completion} tokens · cost $0 (free model) · ` +
        (flagged ? `<b>${flagged} field${flagged > 1 ? "s" : ""} sent to review</b>` : "nothing needs review")
    );
    const why = Object.fromEntries(j.needs_review.map((r) => [r.field, r.reasons.join("; ")]));
    $("#fields").innerHTML = Object.entries(j.data)
      .map(([f, v]) => {
        const c = j.confidence[f];
        return `<tr class="${c < 0.75 ? "low" : ""}"><td><b>${esc(f)}</b></td><td>${fmt(v)}</td><td><span class="bar"><i style="width:${Math.round(c * 100)}%"></i></span>${c.toFixed(2)}</td><td>${why[f] ? esc(why[f]) : ""}</td></tr>`;
      })
      .join("");
    $("#checks").innerHTML = j.checks.map((c) => `<li>${c.pass ? `<span class="ok">✓</span>` : `<span class="no">✗</span>`} ${esc(c.name)}</li>`).join("") || "<li class='na'>No checks for this document type.</li>";
  }
  $("#attempts").innerHTML = (j.attempts || [])
    .map((a) => `<li>${a.ok ? `<span class="ok">valid</span>` : `<span class="no">invalid</span>`} · ${esc(a.model || "no model")} · ${a.ms ?? "?"} ms${a.tokens ? ` · ${a.tokens.prompt_tokens}/${a.tokens.completion_tokens} tokens` : ""}${a.errors?.length ? `<div class="err">${a.errors.map(esc).join("<br>")}</div>` : ""}</li>`)
    .join("");
  $("#raw").textContent = JSON.stringify(j, null, 2);
}

// ---------- log + review queue (localStorage) ----------
function record(j, schema) {
  const log = load("extract.log");
  log.unshift({
    ts: Date.now(),
    schema,
    model: [...new Set((j.attempts || []).map((a) => a.model).filter(Boolean))].join(", ") || "none",
    attempts: j.attempts?.length || 0,
    ok: !!j.ok,
    latency_ms: j.latency_ms,
    tokens_in: j.tokens?.prompt || 0,
    tokens_out: j.tokens?.completion || 0,
    cost_usd: j.cost_usd ?? 0,
    flagged: (j.needs_review || []).map((r) => r.field),
  });
  save("extract.log", log.slice(0, 200));
  if (j.ok && j.needs_review.length) {
    const q = load("extract.queue");
    for (const r of j.needs_review) q.unshift({ id: `${Date.now()}-${r.field}`, ts: Date.now(), schema, ...r, status: "pending" });
    save("extract.queue", q.slice(0, 200));
  }
  updateCount();
}

function updateCount() {
  $("#review-count").textContent = load("extract.queue").filter((x) => x.status === "pending").length;
}

function renderQueue() {
  const q = load("extract.queue");
  $("#queue").innerHTML =
    q.map((it) => `<div class="qitem ${it.status !== "pending" ? "done" : ""}" data-id="${it.id}">
      <b>${esc(it.field)}</b> <small class="na">${esc(it.schema)} · ${new Date(it.ts).toLocaleString()} · confidence ${it.confidence}</small>
      <div>${fmt(it.value)}</div><div class="na">${esc(it.reasons.join("; "))}</div>
      ${it.status === "pending"
        ? `<div class="actions"><button data-act="approve">Approve as is</button><input placeholder="Corrected value" /><button data-act="correct" class="ghost">Save correction</button><button data-act="reject" class="ghost">Reject</button></div>`
        : `<div class="na">${esc(it.status)}${it.corrected !== undefined ? `: ${esc(it.corrected)}` : ""}</div>`}
    </div>`).join("") || `<p class="na">Nothing to review yet. Try the "Invoice (subtotal is wrong)" sample.</p>`;
  $("#queue").querySelectorAll("button[data-act]").forEach((b) =>
    b.addEventListener("click", () => {
      const el = b.closest(".qitem");
      const all = load("extract.queue");
      const it = all.find((x) => x.id === el.dataset.id);
      if (!it) return;
      if (b.dataset.act === "approve") it.status = "approved";
      if (b.dataset.act === "reject") it.status = "rejected";
      if (b.dataset.act === "correct") { const v = el.querySelector("input").value.trim(); if (!v) return; it.status = "corrected"; it.corrected = v; }
      save("extract.queue", all);
      renderQueue();
      updateCount();
    })
  );
}

function renderLog() {
  const log = load("extract.log");
  const lat = log.filter((x) => x.ok).map((x) => x.latency_ms).sort((a, b) => a - b);
  const p = (q) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(q * lat.length))] : 0);
  const sum = (k) => log.reduce((a, x) => a + (x[k] || 0), 0);
  $("#log-summary").innerHTML = [
    ["Runs", log.length],
    ["Valid output", log.length ? `${Math.round((100 * log.filter((x) => x.ok).length) / log.length)}%` : "n/a"],
    ["Median latency", lat.length ? `${p(0.5)} ms` : "n/a"],
    ["p95 latency", lat.length ? `${p(0.95)} ms` : "n/a"],
    ["Tokens in / out", `${sum("tokens_in")} / ${sum("tokens_out")}`],
    ["Total cost", `$${sum("cost_usd").toFixed(4)}`],
  ].map(([k, v]) => `<div><b>${v}</b>${k}</div>`).join("");
  $("#log-rows").innerHTML =
    log.map((x) => `<tr><td>${new Date(x.ts).toLocaleTimeString()}</td><td>${esc(x.schema)}</td><td><small>${esc(x.model)}</small></td><td>${x.attempts}</td><td>${x.ok ? `<span class="ok">yes</span>` : `<span class="no">no</span>`}</td><td>${x.latency_ms ?? "?"} ms</td><td>${x.tokens_in} / ${x.tokens_out}</td><td>$${(x.cost_usd || 0).toFixed(4)}</td><td>${esc(x.flagged.join(", "))}</td></tr>`).join("") ||
    `<tr><td colspan="9" class="na">No runs yet.</td></tr>`;
}
$("#clear-log").addEventListener("click", () => { save("extract.log", []); renderLog(); });

updateCount();
