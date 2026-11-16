/* Clear-to-Build Decision Board — UI. All decisions come from rules.js. */
(function () {
  const R = window.CTB_RULES, CFG = window.CTB_CONFIG || {};
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = R.fmt, money = (n) => (n === 0 ? "$0" : "$" + n.toLocaleString());
  const statusCls = (s) => s.replace(" ", "");
  const nowTime = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  let state, decisions, updates, extracted, ui;
  const settings = { ...R.DEFAULT_SETTINGS };
  function resetAll() {
    state = clone(window.CTB_DATA); decisions = []; updates = []; extracted = null;
    ui = Object.assign(ui || {}, { selected: null, choice: {}, assigned: {}, indirectDone: {}, lastImpact: null, fold: { mat: false, sig: false } });
  }
  ui = { tab: "builds", onlyRisk: false, showIndirect: false, filter: null };
  resetAll();
  let model = null;

  const sup = () => Object.fromEntries(state.suppliers.map((s) => [s.id, s]));
  const partsIdx = () => Object.fromEntries(state.parts.map((p) => [p.id, p]));
  const poById = (id) => state.poLines.find((p) => p.id === id);
  const awaiting = (po) => po && po.chase && !po.chase.repliedAt;

  function recompute() { model = R.compute(state, settings); render(); }

  function log(entry) {
    decisions.unshift(Object.assign({ at: nowTime(), cost: 0, followedRec: null, note: "" }, entry));
  }

  // ---------- header + banner ----------
  function renderHeader() {
    const d = new Date(state.today + "T00:00:00Z");
    $("asof").textContent = "As of " + d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) + " · Material Planner";
    const c = model.coverage, k = model.counts, B = c.builds;
    const pct = Math.round((100 * B.fresh) / Math.max(1, B.total));
    const toChase = B.staleToChase.filter((x) => !x.chased);
    const fchip = (key, label, cls) => `<button class="fpill ${cls} ${ui.filter === key ? "on" : ""}" data-filter="${key}" title="Click to filter the board">${label}</button>`;
    $("banner").innerHTML = `
      <div title="A build counts as fresh only if every purchase order it relies on was updated in the last ${settings.freshHours} hours (stock on hand counts as fresh).">
        <b>Data freshness:</b> <span class="fscore ${pct >= 75 ? "good" : pct >= 50 ? "mid" : "low"}">${pct}%</span> <b>· ${B.fresh} of ${B.total} builds</b> rest on signals updated in the last ${settings.freshHours} hours
        ${B.aging.length ? ` · ${fchip("aging", `${B.aging.length} aging`, "agingC")} <span class="agingT">(&gt;3 to ${settings.staleDays} days): ${esc(B.aging.join(", "))}</span>` : ""}
        ${B.stale.length ? ` · ${fchip("stale", `${B.stale.length} stale`, "staleC")} <span class="staleT">(&gt;${settings.staleDays} days, Low confidence): ${esc(B.stale.join(", "))}</span>` : ""}
        <div class="sub" style="margin-top:3px">Measured at build level, not PO level.</div></div>
      <div class="counts">
        ${toChase.length ? `<button class="primary small" id="chaseStaleBtn">Chase ${toChase.length} stale supplier${toChase.length > 1 ? "s" : ""}</button>` : B.stale.length ? `<span class="chip">Stale suppliers chased · awaiting replies</span>` : ""}
        ${fchip("Blocked", `${k.Blocked} Blocked`, "pill Blocked")}${fchip("At Risk", `${k["At Risk"]} At Risk`, "pill AtRisk")}${fchip("Clear", `${k.Clear} Clear`, "pill Clear")}</div>`;
    document.querySelectorAll("#banner .fpill").forEach((p) => p.addEventListener("click", () => {
      ui.filter = ui.filter === p.dataset.filter ? null : p.dataset.filter;
      if (ui.tab !== "builds") setTab("builds"); else render();
    }));
    const cb = $("chaseStaleBtn");
    if (cb) cb.onclick = () => {
      toChase.forEach((x) => R.markChaseSent(state, x.po));
      log({ build: "Data freshness", wo: toChase.map((x) => x.po).join(", "), status: "—", action: `Chased ${toChase.length} stale supplier${toChase.length > 1 ? "s" : ""} (${toChase.map((x) => x.supplier).join(", ")})`, followedRec: true, note: "Sent (simulated); see Supplier updates" });
      toast(`Chases sent to ${toChase.length} supplier${toChase.length > 1 ? "s" : ""}. Awaiting replies.`);
      recompute();
    };
    $("tab-indirect").hidden = !ui.showIndirect;
    $("logCount").textContent = decisions.length || "";
    const waiting = state.poLines.filter(awaiting).length;
    $("waitCount").textContent = waiting || "";
    $("version").textContent = CFG.VERSION || "";
  }

  // ---------- builds board ----------
  function renderBuilds() {
    const f = ui.filter;
    const rows = model.builds.filter((b) => (!ui.onlyRisk || b.status !== "Clear") &&
      (!f || (f === "stale" || f === "aging" ? b.freshness === f : b.status === f)));
    const S = sup();
    const html = rows.map((b, idx) => {
      const L = b.limiting;
      const rec = b.recs.find((o) => o.recommended);
      const ki = b.keyInfo, kpo = b.keyPo ? poById(b.keyPo) : null;
      const etaLate = b.etaDisplay && R.diff(b.etaDisplay, b.needDate) > 0;
      const confName = R.CONF_NAME[b.confDisplay];
      return `<tr class="row ${ui.selected === b.id ? "selected" : ""}" data-id="${b.id}">
        <td class="mono sub">${idx + 1}</td>
        <td><b>${esc(b.name)}</b><div class="sub mono">${b.id}</div></td>
        <td class="mono">${fmt(b.needDate)}</td>
        <td><span class="pill ${statusCls(b.status)}">${b.status}</span></td>
        <td>${L ? `<span class="mono">${L.part}</span><div class="sub">${esc(L.partName)}</div>` : '<span class="sub">—</span>'}</td>
        <td class="mono ${L && L.short > 0 ? "bad" : ""}">${L ? `${L.alloc} / ${L.req}` : "Covered"}</td>
        <td class="mono ${etaLate ? "bad" : ""}">${L ? (b.etaDisplay ? fmt(b.etaDisplay) : "No inbound") : (b.clearLatest ? fmt(b.clearLatest) : "On hand")}</td>
        <td>${L ? `<span class="conf ${confName}">${confName}</span><div class="sub">${esc(ki ? ki.confReason : "inspection release")}</div>`
               : `<span class="conf ${R.CONF_NAME[b.clearConf]}">${R.CONF_NAME[b.clearConf]}</span><div class="sub">all parts covered, ${b.clearMinSlack >= 99 ? "on hand" : b.clearMinSlack + "+ days slack"}</div>`}</td>
        <td>${ki ? `<span class="${ki.flags.includes("stale") ? "bad" : ki.age * 24 > settings.freshHours ? "agingT" : ""}">${esc(ki.signalLabel)}</span><div class="sub">${esc(S[kpo.supplier].name)}</div>
                    ${awaiting(kpo) ? `<span class="chip">Chase sent ${kpo.chase.sentAt === state.today ? "today" : fmt(kpo.chase.sentAt)} · awaiting reply</span>` : ""}`
               : '<span class="sub">ERP inventory and feeds</span>'}</td>
        <td class="recCell">${rec ? `${esc(rec.title)}<div class="sub cost">${money(rec.cost)}${rec.contingent ? " · needs Quality OK" : ""}</div>` : '<span class="sub">No action</span>'}</td>
      </tr>`;
    }).join("");
    const fLabel = { Blocked: "Blocked builds", "At Risk": "At Risk builds", Clear: "Clear builds", stale: "Builds on stale signals", aging: "Builds on aging signals" }[f];
    $("view-builds").innerHTML = `${f ? `<div class="view-head">Filtered: <b>${fLabel}</b> (${rows.length}) · <a href="#" id="clearFilter">Show all</a></div>` : ""}<table>
      <thead><tr><th>#</th><th>Build</th><th>Need</th><th>Status</th><th>Limiting part</th><th>Avail / Req</th><th title="Predicted arrival at Quincy Yard from the strongest signal: carrier ETA › ship notice › supplier milestones (late steps push it out) › supplier-confirmed date + that supplier's typical slip › promise date + typical slip. For blocked builds, it is the next supply that arrives too late.">Pred. ETA ⓘ</th><th>Confidence</th><th>Latest signal</th><th>Recommended action</th></tr></thead>
      <tbody>${html || '<tr><td colspan="10" class="empty">Nothing at risk. All builds are clear.</td></tr>'}</tbody></table>`;
    document.querySelectorAll("#view-builds tr.row").forEach((tr) => tr.addEventListener("click", () => openDrawer(tr.dataset.id)));
    const cf = $("clearFilter"); if (cf) cf.onclick = (e) => { e.preventDefault(); ui.filter = null; render(); };
  }

  // ---------- detail drawer ----------
  function openDrawer(id) { ui.selected = id; if (ui.tab !== "builds") setTab("builds"); else { renderBuilds(); renderDrawer(); } }
  function closeDrawer() { ui.selected = null; $("drawer").hidden = true; renderBuilds(); }

  function optTag(o) {
    if (o.closes) return o.contingent ? '<span class="tag cont">Closes gap if approved</span>' : '<span class="tag yes">Closes gap</span>';
    if (o.resolves) return '<span class="tag yes">Resolves risk</span>';
    if (o.notNeeded) return '<span class="tag no">Not needed</span>';
    if (o.protects) return '<span class="tag protect">Protects line</span>';
    return '<span class="tag no">Doesn\'t close gap</span>';
  }

  function renderDrawer() {
    const b = model.builds.find((x) => x.id === ui.selected);
    if (!b) { $("drawer").hidden = true; return; }
    const S = sup(), L = b.limiting;
    let body = "";
    if (!L) {
      body = `<div class="sec"><h3>Status</h3><p>All parts are covered with at least ${settings.slackDays} days of slack and medium or high confidence. No action needed.</p></div>`;
    } else {
      body += `<div class="sec"><h3>Why it's flagged</h3><ul class="why">${L.why.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>`;
      const sel = ui.choice[b.id] ?? b.recs.findIndex((o) => o.recommended);
      const recOpt = b.recs.find((o) => o.recommended);
      body += `<div class="sec"><h3>Recommended action</h3>
        ${recOpt && recOpt.whyPick ? `<div class="whypick">${esc(recOpt.whyPick)}</div>` : ""}
        ${b.recs.map((o, i) => {
          const po = o.po ? poById(o.po) : null;
          const sent = o.type === "chase" && awaiting(po);
          return `<label class="opt ${o.recommended ? "rec" : ""}">
            <div class="ot"><span><input type="radio" name="opt" value="${i}" ${i === sel ? "checked" : ""}/> ${esc(o.title)}
              ${o.recommended ? '<span class="tag rec">Recommended</span>' : ""} ${optTag(o)}</span>
              <span class="meta">${money(o.cost)} · ${esc(o.time)}</span></div>
            <div class="oe">${esc(o.effect)}</div>
            ${o.draft ? (sent
              ? `<div class="chip" style="margin-top:6px">Chase sent ${po.chase.sentAt === state.today ? "today" : fmt(po.chase.sentAt)} · awaiting reply (see Supplier updates)</div>`
              : `<button class="ghost draftBtn" data-i="${i}" style="margin-top:6px">Draft chase message</button>
                 <div id="draftBox-${i}" hidden><textarea class="draftTa" id="draft-${i}" rows="11"></textarea>
                 <button class="primary sendBtn" data-i="${i}" style="margin-top:6px">Send (simulated)</button> <span class="sub">Logs the decision and marks the PO "awaiting reply"</span></div>`) : ""}
          </label>`;
        }).join("")}
        <textarea id="decNote" rows="2" placeholder="Decision note (optional)"></textarea>
        <div style="margin-top:8px"><button class="primary" id="logBtn">Log decision</button> <span class="sub">Transfers and expedites update the plan immediately</span></div></div>`;
      body += materialSection(b, L);
      if (b.keyPo) body += signalSection(b, S);
    }
    body += `<div class="sec"><h3>All parts for this build</h3><table><thead><tr><th>Part</th><th>Req</th><th>Avail by need</th><th>Status</th></tr></thead><tbody>
      ${b.lines.map((l) => `<tr><td><span class="mono">${l.part}</span><div class="sub">${esc(l.partName)}</div></td><td class="mono">${l.req}</td><td class="mono ${l.short ? "bad" : ""}">${l.alloc}</td><td><span class="pill ${statusCls(l.status)}">${l.status}</span></td></tr>`).join("")}
      </tbody></table></div>`;

    $("drawer").innerHTML = `<div class="dh"><div><h2>${esc(b.name)}</h2><div class="sub mono">${b.id} · need ${fmt(b.needDate)} · Quincy Yard</div></div>
      <div><span class="pill ${statusCls(b.status)}">${b.status}</span> <button class="close" id="closeBtn" aria-label="Close">×</button></div></div>${body}`;
    $("drawer").hidden = false;
    $("closeBtn").onclick = closeDrawer;
    document.querySelectorAll("#drawer details.fold").forEach((d) => d.addEventListener("toggle", () => (ui.fold[d.dataset.fold] = d.open)));
    document.querySelectorAll('#drawer input[name=opt]').forEach((r) => r.addEventListener("change", () => (ui.choice[b.id] = +r.value)));
    document.querySelectorAll("#drawer .draftBtn").forEach((btn) => btn.addEventListener("click", (e) => {
      e.preventDefault(); const i = +btn.dataset.i;
      $("draftBox-" + i).hidden = false; $("draft-" + i).value = chaseDraft(b, b.recs[i]); btn.hidden = true;
    }));
    document.querySelectorAll("#drawer .sendBtn").forEach((btn) => btn.addEventListener("click", (e) => {
      e.preventDefault(); const o = b.recs[+btn.dataset.i];
      R.markChaseSent(state, o.po);
      log({ build: b.name, wo: b.id, status: b.status, action: `Chase sent to ${sup()[poById(o.po).supplier].name} (${o.po})`, followedRec: !!o.recommended, note: "Message sent (simulated)" });
      toast(`Chase sent to ${sup()[poById(o.po).supplier].name}. Awaiting reply.`);
      recompute();
    }));
    const lb = $("logBtn");
    if (lb) lb.onclick = () => {
      const o = b.recs[ui.choice[b.id] ?? b.recs.findIndex((x) => x.recommended)];
      const before = b.status;
      const effect = R.applyDecision(state, o);
      log({ build: b.name, wo: b.id, status: before, action: o.title, cost: o.cost, followedRec: !!o.recommended, note: [($("decNote").value || "").trim(), effect].filter(Boolean).join(" · ") });
      model = R.compute(state, settings);
      const after = model.builds.find((x) => x.id === b.id).status;
      toast(effect && after !== before ? `Logged. Plan updated: ${b.name} ${before} → ${after}` : `Decision logged: ${o.title}`);
      render();
    };
  }

  function materialSection(b, L) {
    const site = state.productionSite;
    const row = state.inventory.find((r) => r.part === L.part && r.wh === site) || { onHand: 0, mrbHold: 0 };
    const insp = row.inspection;
    const avail = Math.max(0, row.onHand - (row.mrbHold || 0) - (insp ? insp.qty : 0));
    const adds = L.byNeed.filter((u) => u.kind !== "onhand");
    const totalByNeed = L.byNeed.reduce((s, u) => s + u.qty, 0);
    const earlierQty = L.earlier.reduce((s, e) => s + e.qty, 0);
    const others = state.inventory.filter((r) => r.part === L.part && r.wh !== site).map((r) => {
      const wh = state.warehouses.find((w) => w.id === r.wh).name;
      const a = Math.max(0, r.onHand - (r.mrbHold || 0)); const spare = Math.max(0, a - (r.safetyStock || 0));
      return `${wh}: ${a} available, ${spare} spare above safety stock`;
    });
    const signals = [];
    if (L.short) signals.push(`<span class="bad">Short ${L.short} ·${L.alloc} of ${L.req} by ${fmt(b.needDate)}</span>`);
    else signals.push(`<span class="${L.slack !== null && L.slack < settings.slackDays ? "warn" : "sub"}">${L.alloc} of ${L.req} by ${fmt(b.needDate)}${L.slack !== null ? ` · ${L.slack}d slack` : ""}</span>`);
    if (row.mrbHold) signals.push(`<span class="bad">${row.mrbHold} on MRB hold</span>`);
    if (earlierQty) signals.push(`<span class="sub">${earlierQty} allocated to earlier builds</span>`);
    return `<details class="sec fold" data-fold="mat" ${ui.fold.mat ? "open" : ""}><summary><span class="ft">Material picture · ${L.part} ${esc(L.partName)}</span><span class="fs">${signals.join(" · ")}</span></summary>
      <table class="ledger"><tbody>
        <tr><td>On hand at Quincy Yard</td><td class="n">${row.onHand}</td></tr>
        ${row.mrbHold ? `<tr><td>− On MRB hold (non-conforming, awaiting disposition)</td><td class="n bad">−${row.mrbHold}</td></tr>` : ""}
        ${insp ? `<tr><td>− In inspection (clears ${fmt(insp.clearsOn)})</td><td class="n">−${insp.qty}</td></tr>` : ""}
        <tr><td><b>= Available now</b></td><td class="n"><b>${avail}</b></td></tr>
        ${adds.map((u) => `<tr><td>+ ${esc(u.label)} · ${fmt(u.date)} · <span class="conf ${R.CONF_NAME[u.conf]}">${R.CONF_NAME[u.conf]}</span></td><td class="n">+${u.qty}</td></tr>`).join("")}
        ${adds.length ? `<tr><td>= Supply by ${fmt(b.needDate)}</td><td class="n">${totalByNeed}</td></tr>` : ""}
        ${earlierQty ? `<tr><td>− Allocated to earlier-need builds (${L.earlier.map((e) => esc(e.name) + ": " + e.qty).join(", ")})</td><td class="n">−${earlierQty}</td></tr>` : ""}
        <tr class="total"><td>Available for this build by ${fmt(b.needDate)}</td><td class="n ${L.short ? "bad" : ""}">${L.alloc} / ${L.req}</td></tr>
        ${L.short ? `<tr><td class="bad">Short</td><td class="n bad">−${L.short}</td></tr>` : ""}
        ${L.late.map((u) => `<tr><td class="sub">Arrives too late: ${esc(u.label)} · ${fmt(u.date)}</td><td class="n sub">${u.remaining}</td></tr>`).join("")}
      </tbody></table>
      ${others.length ? `<div class="sub" style="margin-top:6px">Other sites: ${esc(others.join(" · "))}</div>` : ""}</details>`;
  }

  function signalSection(b, S) {
    const po = poById(b.keyPo), info = model.poInfo[po.id], s = S[po.supplier];
    let ms = "";
    if (po.milestone) {
      const st = po.milestone.stages, next = st.find((x) => !x.done);
      ms = `<div class="milestones">${st.map((x, i) => {
        const late = !x.done && next === x && R.diff(state.today, x.planned) > 0;
        return `<div class="ms ${x.done ? "done" : ""} ${late ? "late" : ""}"><div class="dot">${x.done ? "✓" : i + 1}</div>${esc(x.label)}<div class="sub">${x.done ? "Done " + fmt(x.done) : "Plan " + fmt(x.planned)}</div></div>`;
      }).join("")}</div>`;
    }
    const flags = [];
    if (info.flags.includes("stale")) flags.push(`<span class="bad">no update in ${info.age} days</span>`);
    if (info.flags.includes("noReason")) flags.push('<span class="bad">date changed, no reason</span>');
    if (info.flags.includes("milestoneLate")) flags.push('<span class="bad">milestone late</span>');
    if (info.flags.includes("chronicSlipper")) flags.push(`<span class="warn">typically slips ~${s.medianSlipDays}d</span>`);
    if (awaiting(po)) flags.push('<span class="chip">chase sent, awaiting reply</span>');
    const fsum = `<span class="conf ${info.confName}">${info.confName}</span> ${flags.length ? "· " + flags.join(" · ") : `<span class="sub">· ${esc(info.confReason)}</span>`}`;
    return `<details class="sec fold" data-fold="sig" ${ui.fold.sig ? "open" : ""}><summary><span class="ft">Supplier signal · ${po.id} · ${esc(s.name)}</span><span class="fs">${fsum}</span></summary>
      <div class="kv">
        <div class="k">Supplier</div><div>${esc(s.name)} · Tier ${s.tier} · ${esc(s.channel)}</div>
        <div class="k">Track record</div><div>${s.medianSlipDays ? `Typically ships ~${s.medianSlipDays} days late` : "Typically on time"}</div>
        <div class="k">ETA basis</div><div>${esc(info.basis)}</div>
        <div class="k">Confidence</div><div><span class="conf ${info.confName}">${info.confName}</span> · ${esc(info.confReason)}</div>
        <div class="k">Latest signal</div><div>${esc(info.signalLabel)}${awaiting(po) ? ' · <span class="chip">chase sent, awaiting reply</span>' : ""}</div>
        ${po.lastChange ? `<div class="k">Last date change</div><div>${fmt(po.lastChange.from)} → ${fmt(po.lastChange.to)} · ${po.lastChange.reason ? esc(po.lastChange.reason) : '<span class="bad">No reason given</span>'}</div>` : ""}
        ${po.note ? `<div class="k">Note</div><div>${esc(po.note)}</div>` : ""}
      </div>${ms}</details>`;
  }

  // Supplier-facing chase draft: only facts the supplier already knows (no internal slip adjustments)
  function chaseDraft(b, o) {
    const po = poById(o.po), s = sup()[po.supplier], part = partsIdx()[po.part], info = model.poInfo[po.id];
    const facts = [];
    if (po.milestone) {
      const st = po.milestone.stages, cur = [...st].reverse().find((x) => x.done), next = st.find((x) => !x.done), ship = st.find((x) => x.key === "shipped");
      facts.push(`Our last update showed the order at "${cur ? cur.label : "not started"}"${next ? `, with "${next.label}" planned for ${fmt(next.planned)}` : ""} and shipment planned for ${fmt(ship.planned)}.`);
    } else if (po.confirmedDate) facts.push(`Your confirmed delivery date is ${fmt(po.confirmedDate)}.`);
    else facts.push(`Your original promise date is ${fmt(po.promiseDate)}, and we haven't received a confirmation.`);
    if (info.flags.includes("stale")) facts.push(`We haven't had an update since ${fmt(po.lastSignal.at)}.`);
    if (info.flags.includes("noReason")) facts.push(`The date recently moved from ${fmt(po.lastChange.from)} to ${fmt(po.lastChange.to)}; could you share what changed?`);
    const ask = o.pullIn
      ? "That leaves us very little buffer. Is there any way to pull in the ship date? Please reply with your firm ship date and where the order is today."
      : "Could you reply with (1) where the order is today (raw material, machining, QC, shipped), (2) your firm ship date, and (3) the reason for any change?";
    return `To: ${s.name}\nSubject: ${po.id} · ${part.name} · ${o.pullIn ? "pull-in request" : "status and date confirmation"}\n\nHi team,\n\nWe need ${po.qty} × ${part.name} (${po.part}) at Quincy Yard by ${fmt(b.needDate)} for work order ${b.id}. ${facts.join(" ")}\n\n${ask}\n\nThanks,\nMaterial Planning`;
  }

  // ---------- dock-to-stock ----------
  function renderDock() {
    const high = model.dock.filter((d) => d.priority === "High").length;
    const rows = model.dock.map((d, i) => {
      const done = ui.assigned[d.ref];
      return `<tr>
        <td class="mono">${i + 1}</td>
        <td><span class="pill ${d.priority === "High" ? "Blocked" : d.priority === "Medium" ? "AtRisk" : "Clear"}">${d.priority}</span></td>
        <td class="mono">${d.ref}<div class="sub">${esc(d.from)} · ${esc(d.source)}</div></td>
        <td><span class="mono">${d.part}</span><div class="sub">${esc(d.partName)}</div></td>
        <td class="mono">${d.qty}</td><td class="mono">${fmt(d.eta)}</td>
        <td>${d.feeds.length ? d.feeds.map((f) => `<div><a href="#" class="buildLink" data-id="${f.id}">${esc(f.build)}</a> <span class="sub">${f.qty} · need ${fmt(f.needDate)}</span> <span class="pill ${statusCls(f.status)}">${f.status}</span></div>`).join("") : '<span class="sub">No build waiting</span>'}</td>
        <td><b>${esc(d.action)}</b><div class="sub">${esc(d.why)}</div></td>
        <td>${done ? `<span class="chip ok">Assigned ${esc(done)}</span>` : `<button class="ghost assignBtn" data-ref="${d.ref}">Assign to receiving</button>`}</td></tr>`;
    }).join("");
    $("view-dock").innerHTML = `<div class="view-head"><b>${model.dock.length} receipts</b> arriving at Quincy Yard in the next 3 days · <b>${high} high priority</b>. Ranked by the builds each receipt unblocks; transfers you approve on the board appear here automatically.</div>
      <table><thead><tr><th>#</th><th>Priority</th><th>Receipt</th><th>Part</th><th>Qty</th><th>ETA</th><th>Feeds</th><th>Recommended handling</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="9" class="empty">Nothing arriving in the next 3 days.</td></tr>'}</tbody></table>`;
    document.querySelectorAll("#view-dock .assignBtn").forEach((btn) => btn.addEventListener("click", () => {
      const d = model.dock.find((x) => x.ref === btn.dataset.ref);
      ui.assigned[d.ref] = nowTime();
      log({ build: d.feeds[0] ? d.feeds[0].build : "Replenishment", wo: d.feeds[0] ? d.feeds[0].id : "", status: d.feeds[0] ? d.feeds[0].status : "—", action: `Dock plan: ${d.action} (${d.ref}, ${d.qty} × ${d.part})`, followedRec: true, note: "Assigned to receiving lead (simulated)" });
      toast(`Assigned to receiving: ${d.ref}`); render();
    }));
    document.querySelectorAll("#view-dock .buildLink").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); openDrawer(a.dataset.id); }));
  }

  // ---------- indirect ----------
  function renderIndirect() {
    const rows = model.indirect.map((x) => {
      const done = ui.indirectDone[x.po];
      return `<tr><td class="mono">${x.po}</td><td>${esc(x.partName)}<div class="sub mono">${x.part}</div></td><td>${esc(x.supplier)}</td><td class="mono">${x.qty}</td><td class="mono">${fmt(x.requested)}</td><td class="mono ${x.lateBy > 0 ? "bad" : ""}">${fmt(x.eta)}</td>
      <td><span class="conf ${x.conf}">${x.conf}</span><div class="sub">${esc(x.confReason)}</div></td><td>${x.lateBy > 0 ? `<span class="bad">${x.status}</span>` : x.status}</td>
      <td><b>${esc(x.rec.title)}</b><div class="sub">${esc(x.rec.why)}</div></td>
      <td>${x.rec.title === "No action" ? "" : done ? `<span class="chip ok">Done ${esc(done)}</span>` : `<button class="ghost indBtn" data-po="${x.po}">Do it (simulated)</button>`}</td></tr>`;
    }).join("");
    $("view-indirect").innerHTML = `<div class="view-head">Indirect (general-use) orders. Same data model and confidence rules, with lighter actions: they don't gate production, so the default is to inform rather than expedite.</div>
      <table><thead><tr><th>PO</th><th>Item</th><th>Supplier</th><th>Qty</th><th>Requested</th><th>ETA</th><th>Confidence</th><th>Status</th><th>Recommended</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    document.querySelectorAll("#view-indirect .indBtn").forEach((btn) => btn.addEventListener("click", () => {
      const x = model.indirect.find((i) => i.po === btn.dataset.po);
      ui.indirectDone[x.po] = nowTime();
      if (x.rec.title.startsWith("Chase")) R.markChaseSent(state, x.po);
      log({ build: "Indirect: " + x.partName, wo: x.po, status: x.status, action: x.rec.title, followedRec: true, note: "Simulated" });
      toast(`${x.rec.title} (${x.po})`); recompute();
    }));
  }

  // ---------- decision log ----------
  function renderLog() {
    $("view-log").innerHTML = decisions.length
      ? `<table><thead><tr><th>Time</th><th>For</th><th>Status then</th><th>Action</th><th>Cost</th><th>Followed rec?</th><th>Note / effect</th></tr></thead><tbody>
        ${decisions.map((d) => `<tr><td class="mono">${d.at}</td><td>${esc(d.build)}<div class="sub mono">${esc(d.wo)}</div></td><td>${d.status in { Blocked: 1, "At Risk": 1, Clear: 1 } ? `<span class="pill ${statusCls(d.status)}">${d.status}</span>` : esc(d.status)}</td><td>${esc(d.action)}</td><td class="mono">${money(d.cost)}</td><td>${d.followedRec === null ? "—" : d.followedRec ? "Yes" : "No (override)"}</td><td>${esc(d.note)}</td></tr>`).join("")}</tbody></table>`
      : `<div class="empty">No decisions logged yet. Open a build and log an action.</div>`;
  }

  // ---------- supplier update intake ----------
  function renderIntake() {
    const open = state.poLines.filter((p) => !p.indirect && model.poInfo[p.id]);
    const P = partsIdx(), S = sup();
    const live = !!CFG.WORKER_URL;
    const e = extracted || {};
    const waiting = state.poLines.filter(awaiting);
    const buildsFor = (po) => state.builds.filter((b) => b.bom.some(([p]) => p === po.part)).map((b) => b.name);
    const queue = waiting.length ? `<div class="view-head"><b>Awaiting supplier reply (${waiting.length})</b> · chases you sent from the board</div>
      <table><thead><tr><th>PO</th><th>Supplier</th><th>Part</th><th>Affects</th><th>Chased</th><th></th></tr></thead><tbody>
      ${waiting.map((po) => `<tr><td class="mono">${po.id}</td><td>${esc(S[po.supplier].name)}</td><td>${esc(P[po.part].name)}</td><td>${esc(buildsFor(po).join(", ") || "Indirect")}</td><td class="mono">${po.chase.sentAt === state.today ? "Today" : fmt(po.chase.sentAt)}</td>
        <td><button class="ghost loadReply" data-po="${po.id}">${state.sampleEmails.some((s) => s.cached.po === po.id) ? "Load supplier reply" : "Enter reply"}</button></td></tr>`).join("")}</tbody></table>`
      : `<div class="view-head">No chases awaiting reply. Send one from a build's detail panel, or process any supplier email below.</div>`;

    $("view-intake").innerHTML = `${queue}<div class="intake" style="border-top:1px solid var(--line)">
      <div>
        <div class="field"><label>Pick a sample supplier email or write your own</label>
          <select id="sampleSel"><option value="">— Write your own —</option>${state.sampleEmails.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join("")}</select></div>
        <div class="field"><textarea id="emailText" rows="8" placeholder="Paste or type a supplier email…"></textarea></div>
        <button class="primary" id="extractBtn">Extract with AI</button>
        <div class="note ${live ? "" : "warn"}" style="margin-top:8px">${live ? "Live AI extraction via Cloudflare Worker (Claude). A human confirms every field before anything changes." : "Live AI not configured: sample emails use their cached extraction. Free-text emails can be entered manually on the right."}</div>
        <div class="note" id="extractStatus" style="margin-top:6px"></div>
      </div>
      <div>
        <div class="field"><label>PO line</label><select id="fPo"><option value="">Select…</option>${open.map((p) => `<option value="${p.id}" ${e.po === p.id ? "selected" : ""}>${p.id} · ${esc(S[p.supplier].name)} · ${esc(P[p.part].name)}</option>`).join("")}</select></div>
        <div class="field"><label>Milestone reached (Tier 2/3)</label><select id="fMs">
          ${[["", "None / not stated"], ["raw", "Raw material received"], ["machining", "In machining"], ["oqc", "Outgoing QC passed"], ["shipped", "Shipped"]].map(([v, t]) => `<option value="${v}" ${(e.milestone || "") === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div class="field"><label>New ship date (supplier commitment)</label><input type="date" id="fDate" value="${e.newShipDate || ""}" /></div>
        <div class="field"><label>Quantity</label><input type="text" id="fQty" value="${e.qty ?? ""}" /></div>
        <div class="field"><label>Reason for change</label><input type="text" id="fReason" value="${esc(e.reason || "")}" /></div>
        <div class="note">${e.source ? `Extracted by: ${esc(e.source)}${e.extractionConfidence ? " · extraction confidence: " + esc(e.extractionConfidence) : ""}` : "Fields fill in after extraction. You can edit any field."}</div>
        <div style="margin-top:10px"><button class="primary" id="applyBtn">Confirm &amp; apply</button></div>
        <div id="impact">${ui.lastImpact || ""}</div>
      </div></div>`;

    $("sampleSel").onchange = () => { const s = state.sampleEmails.find((x) => x.id === $("sampleSel").value); $("emailText").value = s ? s.text : ""; };
    $("extractBtn").onclick = doExtract;
    $("applyBtn").onclick = doApply;
    document.querySelectorAll("#view-intake .loadReply").forEach((btn) => btn.addEventListener("click", () => {
      const s = state.sampleEmails.find((x) => x.cached.po === btn.dataset.po);
      ui.lastImpact = null; extracted = { po: btn.dataset.po };
      renderIntake();
      if (s) { $("sampleSel").value = s.id; $("emailText").value = s.text; $("extractStatus").textContent = "Supplier reply loaded. Click Extract with AI."; }
      else { $("extractStatus").textContent = "Paste the supplier's reply, or fill the fields on the right."; $("emailText").focus(); }
    }));
    bindImpactLinks();
  }

  async function doExtract() {
    const text = $("emailText").value.trim();
    const sample = state.sampleEmails.find((x) => x.id === $("sampleSel").value && x.text === text);
    if (!text) { $("extractStatus").textContent = "Paste or pick an email first."; return; }
    $("extractStatus").textContent = "Extracting…";
    ui.lastImpact = null;
    const restore = () => { $("emailText").value = text; if (sample) $("sampleSel").value = sample.id; };
    if (CFG.WORKER_URL) {
      try {
        const open = state.poLines.filter((p) => !p.indirect && model.poInfo[p.id]).map((p) => ({ id: p.id, supplier: sup()[p.supplier].name, part: partsIdx()[p.part].name, hasMilestones: !!p.milestone }));
        const resp = await fetch(CFG.WORKER_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: text, today: state.today, openPOs: open }) });
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const j = await resp.json();
        extracted = { po: j.po, milestone: j.milestone || "", newShipDate: j.newShipDate || "", qty: j.qty ?? "", reason: j.reason || "", extractionConfidence: j.extractionConfidence, source: "Claude (live)" };
        renderIntake(); restore();
        $("extractStatus").textContent = "Extracted live. Review each field, then confirm.";
        return;
      } catch (err) {
        if (!sample) { $("extractStatus").textContent = "AI extraction unavailable (" + err.message + "). Enter the fields manually."; return; }
      }
    }
    if (sample) {
      extracted = { ...sample.cached, source: CFG.WORKER_URL ? "Cached example (live AI unavailable)" : "Cached example (live AI not configured)" };
      renderIntake(); restore();
      $("extractStatus").textContent = "Loaded cached extraction. Review, then confirm.";
    } else {
      $("extractStatus").textContent = "Live AI not configured. Enter the fields manually.";
    }
  }

  function doApply() {
    const u = { po: $("fPo").value, milestone: $("fMs").value || null, newShipDate: $("fDate").value || null, qty: $("fQty").value ? +$("fQty").value : null, reason: $("fReason").value.trim() || null };
    if (!u.po) { $("impact").innerHTML = '<div class="impact">Select a PO line first.</div>'; return; }
    if (!u.milestone && !u.newShipDate) { $("impact").innerHTML = '<div class="impact">Nothing to apply: add a milestone or a new ship date.</div>'; return; }
    const before = Object.fromEntries(model.builds.map((b) => [b.id, b.status]));
    const po = poById(u.po);
    const wasChased = awaiting(po);
    R.applyUpdate(state, u);
    const src = extracted && extracted.source ? extracted.source : "manual entry";
    updates.push({ po: u.po, source: src });
    model = R.compute(state, settings);
    const info = model.poInfo[u.po];
    const affected = model.builds.filter((b) => b.lines.some((l) => l.part === po.part));
    log({ build: "Supplier update", wo: u.po, status: "—", action: `Applied supplier update${wasChased ? " (chase reply)" : ""}`, note: `${src}; new ETA ${fmt(info.eta)}` });
    ui.lastImpact = `<div class="impact"><b>Applied to ${u.po}.</b> New ETA ${fmt(info.eta)} · confidence <span class="conf ${info.confName}">${info.confName}</span>${wasChased ? " · chase closed" : ""}.
      <table style="margin-top:6px"><tbody>${affected.map((b) => {
        const rec = b.recs.find((o) => o.recommended);
        return `<tr><td><b>${esc(b.name)}</b><div class="sub">${before[b.id]} → <span class="pill ${statusCls(b.status)}">${b.status}</span></div></td>
          <td class="sub">${rec ? "Next: " + esc(rec.title) : "No action needed"}</td><td><button class="ghost openBuild" data-id="${b.id}">Open build</button></td></tr>`;
      }).join("")}</tbody></table></div>`;
    extracted = null;
    render();
  }
  function bindImpactLinks() {
    document.querySelectorAll("#view-intake .openBuild").forEach((btn) => btn.addEventListener("click", () => openDrawer(btn.dataset.id)));
  }

  // ---------- tabs, controls, misc ----------
  function setTab(t) {
    ui.tab = t;
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
    ["builds", "dock", "intake", "indirect", "log"].forEach((v) => ($("view-" + v).hidden = v !== t));
    $("controls").style.display = t === "builds" ? "flex" : "none";
    if (t !== "builds") $("drawer").hidden = true;
    render();
  }

  function render() {
    renderHeader();
    if (ui.tab === "builds") { renderBuilds(); if (ui.selected) renderDrawer(); }
    if (ui.tab === "dock") renderDock();
    if (ui.tab === "intake") renderIntake();
    if (ui.tab === "indirect") renderIndirect();
    if (ui.tab === "log") renderLog();
  }

  function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), 3000); }

  document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
  $("onlyRisk").onchange = (e) => { ui.onlyRisk = e.target.checked; render(); };
  $("slackDays").onchange = (e) => { settings.slackDays = Math.max(0, +e.target.value || 0); recompute(); };
  $("staleDays").onchange = (e) => { settings.staleDays = Math.max(1, +e.target.value || 1); recompute(); };
  $("showIndirect").onchange = (e) => { ui.showIndirect = e.target.checked; if (!ui.showIndirect && ui.tab === "indirect") setTab("builds"); else render(); };
  $("resetBtn").onclick = () => { resetAll(); $("drawer").hidden = true; recompute(); toast("Demo data reset"); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && ui.selected) closeDrawer(); });

  recompute();
})();
