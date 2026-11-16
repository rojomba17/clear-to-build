/* Cloudflare Worker: reads a supplier email and returns structured fields for human confirmation.
   Secrets / variables (set in Cloudflare dashboard → Worker → Settings → Variables and Secrets):
     ANTHROPIC_API_KEY  (Secret)  prototype-only key
     ALLOWED_ORIGINS    (Text)    comma-separated, e.g. "https://rojomba17.github.io,null"
                                  ("null" allows testing from a local file; remove after testing)
*/
const MODEL = "claude-haiku-5-5";   // small, fast, cheap model; change here if needed
const MAX_EMAIL_CHARS = 4000;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "null";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const ok = allowed.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": ok ? origin : "https://invalid.example",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };
    if (request.method === "OPTIONS") return new Response(null, { status: ok ? 204 : 403, headers: cors });
    if (!ok) return json({ error: "Origin not allowed" }, 403, cors);
    if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }
    const email = String(body.email || "").slice(0, MAX_EMAIL_CHARS);
    if (!email.trim()) return json({ error: "Empty email" }, 400, cors);
    const openPOs = Array.isArray(body.openPOs) ? body.openPOs.slice(0, 60) : [];
    const today = String(body.today || "");

    const system = `You extract structured purchase-order status updates from supplier emails for a manufacturing materials planner.
Always answer by calling the record_update tool, even when the email is ambiguous: use null for anything you can't determine and lower extractionConfidence.
Rules:
- "po" must be one of the open PO line IDs provided (match by PO number, supplier, or part). If unsure, null.
- "milestone" = the latest production step the supplier says is COMPLETE: raw (raw material received), machining (in machining), oqc (passed outgoing quality check), shipped. Null if not stated.
- "newShipDate" = the date the supplier now commits to SHIP, resolved against today's date (${today}). Null if not stated.
- "reason" = the supplier's stated reason for a change or status, in under 12 words. Null if none given. Never invent a reason.
- "extractionConfidence" = how clearly the email states these facts.
Do not guess. Prefer null over a guess.`;

    const user = `Today: ${today}\nOpen PO lines:\n${openPOs.map((p) => `- ${p.id} | ${p.supplier} | ${p.part}${p.hasMilestones ? " | tracks milestones" : ""}`).join("\n")}\n\nSupplier email:\n"""${email}"""`;

    // Force structured output: the model must answer by calling this tool, so it can't reply in prose
    const tool = {
      name: "record_update",
      description: "Record the structured PO status update extracted from the supplier email.",
      input_schema: {
        type: "object",
        properties: {
          po: { type: ["string", "null"], description: "One of the open PO line IDs, or null if unsure" },
          milestone: { type: ["string", "null"], description: "raw | machining | oqc | shipped, or null" },
          newShipDate: { type: ["string", "null"], description: "YYYY-MM-DD ship date, or null if not stated" },
          qty: { type: ["number", "null"] },
          reason: { type: ["string", "null"], description: "Supplier's stated reason, under 12 words, or null" },
          extractionConfidence: { type: "string", enum: ["high", "medium", "low"] }
        },
        required: ["po", "milestone", "newShipDate", "qty", "reason", "extractionConfidence"]
      }
    };

    let resp;
    try {
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 1024, thinking: { type: "disabled" }, system, tools: [tool], tool_choice: { type: "tool", name: "record_update" },
          messages: [{ role: "user", content: user }] })
      });
    } catch (e) { return json({ error: "Upstream unreachable" }, 502, cors); }
    if (!resp.ok) {
      let detail = ""; try { detail = ((await resp.json()).error || {}).message || ""; } catch {}
      return json({ error: "Upstream error " + resp.status, sample: detail.slice(0, 200) }, 502, cors);
    }

    const data = await resp.json();
    let out = ((data.content || []).find((c) => c.type === "tool_use") || {}).input;
    if (!out) {
      // Fallback: look for a JSON object in any text the model returned
      const text = (data.content || []).map((c) => c.text || "").join("");
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return json({ error: "No JSON in model output (v2 worker)", stop: data.stop_reason || null,
        blocks: (data.content || []).map((c) => c.type), sample: text.slice(0, 160) }, 502, cors);
      try { out = JSON.parse(match[0]); } catch { return json({ error: "Bad JSON from model", sample: text.slice(0, 160) }, 502, cors); }
    }

    // Validate before returning (the UI still requires a human to confirm)
    const ids = new Set(openPOs.map((p) => p.id));
    const clean = {
      po: ids.has(out.po) ? out.po : null,
      milestone: ["raw", "machining", "oqc", "shipped"].includes(out.milestone) ? out.milestone : null,
      newShipDate: /^\d{4}-\d{2}-\d{2}$/.test(out.newShipDate || "") ? out.newShipDate : null,
      qty: Number.isFinite(out.qty) ? out.qty : null,
      reason: typeof out.reason === "string" ? out.reason.slice(0, 120) : null,
      extractionConfidence: ["high", "medium", "low"].includes(out.extractionConfidence) ? out.extractionConfidence : "low"
    };
    return json(clean, 200, cors);
  }
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, "Content-Type": "application/json" } });
}
