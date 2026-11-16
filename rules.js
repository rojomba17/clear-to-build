/* Clear-to-Build Decision Board — deterministic rules.
   Every number here is explainable. No AI is used in this file. */
(function (root) {
  // ---------- dates ----------
  const DAY = 86400000;
  const toDay = (s) => Math.round(Date.parse(s + "T00:00:00Z") / DAY);
  const fromDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);
  const addDays = (s, n) => fromDay(toDay(s) + n);
  const diff = (a, b) => toDay(a) - toDay(b); // a - b in days
  const fmt = (s) => {
    if (!s) return "—";
    const d = new Date(s + "T00:00:00Z");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  };
  const lcFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  const CONF_NAME = { 3: "High", 2: "Medium", 1: "Low" };
  const STATUS_ORDER = { Blocked: 0, "At Risk": 1, Clear: 2 };
  const DEFAULT_SETTINGS = { slackDays: 3, staleDays: 7, freshHours: 72 };

  function index(list, key = "id") { const m = {}; list.forEach((x) => (m[x[key]] = x)); return m; }

  // ---------- ETA + confidence for a PO line ----------
  // Strongest signal wins: received > carrier > ship notice > supplier milestone > confirmed date > promise date.
  function etaFor(po, sup, today, s) {
    if (po.received) return null;
    let eta, conf, source, basis;
    const age = diff(today, po.lastSignal.at);
    const flags = [];

    if (po.carrier) {
      eta = po.carrier.eta; conf = 3; source = "Carrier tracking";
      basis = `Carrier ETA ${fmt(eta)}` + (po.carrier.status ? ` (${po.carrier.status})` : "");
    } else if (po.asn) {
      eta = po.asn.eta; conf = 3; source = "Ship notice";
      basis = `Shipped ${fmt(po.asn.shipDate)}, arriving ${fmt(eta)}`;
    } else if (po.milestone) {
      const st = po.milestone.stages;
      const ship = st.find((x) => x.key === "shipped");
      const next = st.find((x) => !x.done);
      const late = next && diff(today, next.planned) > 0 ? diff(today, next.planned) : 0;
      const projShip = addDays(ship.planned, late);
      eta = addDays(projShip, sup.transitDays); conf = 2; source = "Supplier milestone";
      const cur = [...st].reverse().find((x) => x.done);
      basis = late > 0
        ? `"${next.label}" was due ${fmt(next.planned)} and is ${plural(late, "day")} late, so ship moves to ~${fmt(projShip)}`
        : `On track at "${cur ? cur.label : "Not started"}"; ships ~${fmt(projShip)}`;
      if (late > 0) flags.push("milestoneLate");
    } else if (po.confirmedDate) {
      eta = addDays(po.confirmedDate, sup.medianSlipDays); conf = 2; source = "Supplier-confirmed date";
      basis = sup.medianSlipDays > 0
        ? `Supplier confirmed ${fmt(po.confirmedDate)}; this supplier typically slips ~${sup.medianSlipDays} days, so ETA ~${fmt(eta)}`
        : `Supplier confirmed ${fmt(po.confirmedDate)}`;
      if (sup.medianSlipDays >= 5) flags.push("chronicSlipper");
    } else {
      eta = addDays(po.promiseDate, sup.medianSlipDays); conf = 1; source = "Promise date only";
      basis = `Only the original promise date (${fmt(po.promiseDate)})` +
        (sup.medianSlipDays > 0 ? ` + typical slip of ~${sup.medianSlipDays} days` : "");
    }
    if (po.expedited) {
      eta = addDays(eta, -po.expedited.days);
      basis += `; expedited ${plural(po.expedited.days, "day")} earlier to ${fmt(eta)}`;
      flags.push("expedited");
    }

    const reasons = [];
    if (age > s.staleDays && !po.carrier) { conf = 1; flags.push("stale"); reasons.push(`no update in ${age} days`); }
    // A missing reason only matters when the date slips later; pull-ins and confirmations don't need one
    if (po.lastChange && !po.lastChange.reason && diff(po.lastChange.to, po.lastChange.from) > 0) { conf = 1; flags.push("noReason"); reasons.push("date slipped with no reason given"); }
    // Fresh is not the same as trusted: a reported delay with no new date makes the current date unreliable
    if (po.openDelay && !po.carrier && !po.asn) {
      conf = 1; flags.push("delayNoDate");
      reasons.push(`supplier reported a delay with no new date: ${po.openDelay.reason}`);
      basis += `; supplier reported a delay on ${fmt(po.openDelay.at)} with no new date, so this date is unreliable`;
    }
    if (!reasons.length) {
      if (conf === 3) reasons.push(source === "Carrier tracking" ? "in transit with carrier" : "shipped, ship notice received");
      else if (conf === 2) reasons.push(source === "Supplier milestone" ? `milestone update ${age}d ago` : `confirmed ${age}d ago`);
      else reasons.push("no confirmation from supplier");
    }
    return { eta, conf, confName: CONF_NAME[conf], source, basis, age, flags, confReason: reasons.join("; "),
             signalLabel: `${po.lastSignal.source}, ${age === 0 ? "today" : age === 1 ? "1 day ago" : age + " days ago"}` };
  }

  // ---------- inventory helpers ----------
  function invRow(state, part, wh) { return state.inventory.find((r) => r.part === part && r.wh === wh); }
  function availNow(row) {
    if (!row) return 0;
    return Math.max(0, row.onHand - (row.mrbHold || 0) - (row.inspection ? row.inspection.qty : 0));
  }
  const whName = (state, id) => (state.warehouses.find((w) => w.id === id) || {}).name || id;

  // ---------- core computation ----------
  function compute(state, settingsIn) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settingsIn || {});
    const today = state.today, site = state.productionSite;
    const sup = index(state.suppliers), parts = index(state.parts), builds = state.builds;
    const transfers = state.transfers || [];

    const poInfo = {};
    state.poLines.forEach((po) => { const e = etaFor(po, sup[po.supplier], today, s); if (e) poInfo[po.id] = e; });

    // Supply pools per part at the production site
    const pools = {};
    const partsNeeded = new Set(); builds.forEach((b) => b.bom.forEach(([p]) => partsNeeded.add(p)));
    partsNeeded.forEach((p) => {
      const row = invRow(state, p, site);
      const list = [];
      const now = availNow(row);
      if (now > 0) list.push({ kind: "onhand", ref: "onhand", label: "On hand (available)", qty: now, date: today, conf: 3 });
      if (row && row.inspection && row.inspection.qty > 0)
        list.push({ kind: "inspection", ref: "insp", label: `In inspection, clears ${fmt(row.inspection.clearsOn)}`, qty: row.inspection.qty, date: row.inspection.clearsOn, conf: 2 });
      state.poLines.filter((po) => po.part === p && po.dest === site && poInfo[po.id]).forEach((po) => {
        const e = poInfo[po.id];
        list.push({ kind: "po", ref: po.id, label: `${po.id} (${sup[po.supplier].name})`, qty: po.qty, date: e.eta, conf: e.conf, po: po.id });
      });
      transfers.filter((t) => t.part === p && t.to === site).forEach((t) =>
        list.push({ kind: "transfer", ref: t.id, label: `Transfer from ${whName(state, t.from)}`, qty: t.qty, date: t.arrive, conf: 3, transfer: t.id }));
      list.sort((a, b) => diff(a.date, b.date) || b.conf - a.conf);
      list.forEach((x) => (x.remaining = x.qty));
      pools[p] = list;
    });

    // Allocate in need-date order (earliest build gets supply first)
    const order = [...builds].sort((a, b) => diff(a.needDate, b.needDate) || a.id.localeCompare(b.id));
    const consumedBy = {};
    const allocations = {}; // ref -> [{build, qty}]
    const results = {};
    order.forEach((b) => {
      const lines = b.bom.map(([p, req]) => {
        const pool = pools[p];
        let need = req; const used = [];
        const earlier = (consumedBy[p] || []).slice();
        for (const src of pool) {
          if (need <= 0) break;
          if (src.remaining <= 0 || diff(src.date, b.needDate) > 0) continue;
          const take = Math.min(src.remaining, need);
          src.remaining -= take; need -= take;
          used.push({ ...src, qty: take });
          if (src.kind === "po" || src.kind === "transfer") (allocations[src.ref] = allocations[src.ref] || []).push({ build: b.id, qty: take });
        }
        const alloc = req - need;
        if (alloc > 0) (consumedBy[p] = consumedBy[p] || []).push({ build: b.id, name: b.name, qty: alloc });
        const late = pool.filter((x) => x.remaining > 0 && diff(x.date, b.needDate) > 0);
        const latestDate = used.length ? used.reduce((m, x) => (diff(x.date, m) > 0 ? x.date : m), used[0].date) : null;
        const minConf = used.length ? Math.min(...used.map((x) => x.conf)) : null;
        const slack = latestDate ? diff(b.needDate, latestDate) : null;
        let status = "Clear"; const why = [];
        const short = need;
        if (short > 0) {
          status = "Blocked";
          why.push(alloc > 0 ? `Short ${short} of ${req}: only ${alloc} can be available by ${fmt(b.needDate)}.`
                             : `Short ${short} of ${req}: none can be available by ${fmt(b.needDate)}.`);
          if (late.length) { const d = diff(late[0].date, b.needDate); why.push(`Next supply, ${late[0].label}, is expected ${fmt(late[0].date)}: ${plural(d, "day")} after the need date.`); }
          else why.push("No other inbound supply is on order.");
        } else if (minConf === 1) {
          status = "At Risk";
          const weak = used.find((x) => x.conf === 1);
          const wpo = weak.po ? state.poLines.find((p) => p.id === weak.po) : null;
          if (wpo && poInfo[wpo.id].flags.includes("delayNoDate")) why.push(
            `Covered by ${poInfo[wpo.id].source === "Supplier-confirmed date" ? "the confirmed " + fmt(wpo.confirmedDate) + " date" : "the current plan"}, but ${sup[wpo.supplier].name} reported a delay with no new date ("${wpo.openDelay.reason}"), so that date can't be trusted.`);
          else why.push(`Covered on paper, but it relies on a low-confidence signal from ${weak.label}: ${weak.po ? poInfo[weak.po].confReason : "unverified"}.`);
        } else if (slack !== null && slack < s.slackDays) {
          status = "At Risk";
          why.push(`Covered, but with only ${plural(slack, "day")} of slack before the need date (threshold: ${s.slackDays}).`);
        }
        const byNeed = pool.filter((x) => diff(x.date, b.needDate) <= 0).map((x) => ({ kind: x.kind, label: x.label, qty: x.qty, date: x.date, conf: x.conf }));
        return { part: p, partName: parts[p].name, req, alloc, short, used, late, earlier, byNeed, latestDate, minConf, slack, status, why };
      });
      results[b.id] = { build: b, lines };
    });

    const out = builds.map((b) => {
      const r = results[b.id];
      const worst = [...r.lines].sort((x, y) =>
        STATUS_ORDER[x.status] - STATUS_ORDER[y.status] || y.short - x.short || (x.minConf || 9) - (y.minConf || 9) || (x.slack ?? 99) - (y.slack ?? 99))[0];
      const status = worst.status;
      const limiting = status === "Clear" ? null : worst;
      const recs = limiting ? recommend(state, s, b, limiting, poInfo, sup, clearCandidates(results, b)) : [];
      const keySrc = limiting
        ? (limiting.short > 0 ? limiting.late[0] : limiting.used.find((x) => x.conf === limiting.minConf && x.po) || limiting.used[limiting.used.length - 1])
        : null;
      const keyPo = keySrc && keySrc.po ? keySrc.po : null;
      const allUsed = r.lines.flatMap((l) => l.used);
      const clearConf = allUsed.length ? Math.min(...allUsed.map((u) => u.conf)) : 3;
      const clearLatest = allUsed.length ? allUsed.reduce((m, u) => (diff(u.date, m) > 0 ? u.date : m), allUsed[0].date) : null;
      const clearMinSlack = Math.min(...r.lines.map((l) => (l.slack ?? 99)));
      // Build-level freshness: a build is only as fresh as the least-fresh PO it relies on (stock on hand counts as fresh)
      const relied = [...new Set([...allUsed.filter((u) => u.po).map((u) => u.po), ...(keyPo ? [keyPo] : [])])];
      const fresh = relied.some((id) => poInfo[id].flags.includes("stale")) ? "stale"
        : relied.some((id) => poInfo[id].age * 24 > s.freshHours) ? "aging" : "fresh";
      const stalePos = relied.filter((id) => poInfo[id].flags.includes("stale"));
      return {
        freshness: fresh, stalePos,
        id: b.id, name: b.name, needDate: b.needDate, status, lines: r.lines, limiting, recs,
        keyPo, keyInfo: keyPo ? poInfo[keyPo] : null,
        etaDisplay: limiting ? (limiting.short > 0 ? (limiting.late[0] ? limiting.late[0].date : null) : limiting.latestDate) : null,
        confDisplay: limiting ? (keyPo ? poInfo[keyPo].conf : (limiting.minConf || 3)) : 3,
        partsAffected: limiting ? builds.filter((x) => x.bom.some(([p]) => p === limiting.part)).length : 0,
        clearConf, clearLatest: clearLatest && diff(clearLatest, today) > 0 ? clearLatest : null, clearMinSlack
      };
    });
    out.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || diff(a.needDate, b.needDate) || a.confDisplay - b.confDisplay || b.partsAffected - a.partsAffected);
    const statusById = index(out);

    // Coverage banner
    const open = state.poLines.filter((po) => !po.indirect && poInfo[po.id]);
    const fresh = open.filter((po) => poInfo[po.id].age * 24 <= s.freshHours);
    const stale = open.filter((po) => poInfo[po.id].flags.includes("stale")).map((po) => ({
      po: po.id, supplier: sup[po.supplier].name, part: parts[po.part].name, age: poInfo[po.id].age,
      chased: !!(po.chase && !po.chase.repliedAt),
      atRiskBuilds: out.filter((b) => b.status !== "Clear" && b.keyPo === po.id).map((b) => b.name)
    }));
    const aging = open.filter((po) => poInfo[po.id].age * 24 > s.freshHours && !poInfo[po.id].flags.includes("stale")).map((po) => ({
      po: po.id, supplier: sup[po.supplier].name, age: poInfo[po.id].age,
      atRiskBuilds: out.filter((b) => b.status !== "Clear" && b.keyPo === po.id).map((b) => b.name)
    }));
    const bFresh = out.filter((b) => b.freshness === "fresh"), bAging = out.filter((b) => b.freshness === "aging"), bStale = out.filter((b) => b.freshness === "stale");
    const staleToChase = [...new Set(bStale.flatMap((b) => b.stalePos))].map((id) => {
      const po = state.poLines.find((p) => p.id === id);
      return { po: id, supplier: sup[po.supplier].name, age: poInfo[id].age, chased: !!(po.chase && !po.chase.repliedAt) };
    });
    const coverage = {
      fresh: fresh.length, total: open.length, pct: Math.round((100 * fresh.length) / Math.max(1, open.length)), stale, aging,
      builds: { total: out.length, fresh: bFresh.length, aging: bAging.map((b) => b.name), stale: bStale.map((b) => b.name), staleToChase }
    };

    // Dock-to-stock: receipts at the site in the next 3 days, with a handling recommendation
    const buildById = index(builds);
    const receipts = [];
    state.poLines.filter((po) => !po.indirect && po.dest === site && poInfo[po.id]).forEach((po) => {
      const e = poInfo[po.id]; if (diff(e.eta, today) < 0 || diff(e.eta, today) > 3) return;
      receipts.push({ ref: po.id, kind: "po", part: po.part, qty: po.qty, eta: e.eta, source: e.source, tier: sup[po.supplier].tier, from: sup[po.supplier].name });
    });
    transfers.filter((t) => t.to === site && diff(t.arrive, today) >= 0 && diff(t.arrive, today) <= 3).forEach((t) =>
      receipts.push({ ref: t.id, kind: "transfer", part: t.part, qty: t.qty, eta: t.arrive, source: "Internal transfer", tier: 0, from: whName(state, t.from) }));
    const dock = receipts.map((r) => {
      const feeds = (allocations[r.ref] || []).map((a) => ({ ...a, b: buildById[a.build], st: statusById[a.build] }))
        .sort((x, y) => diff(x.b.needDate, y.b.needDate));
      const urgent = feeds.filter((f) => f.st.status !== "Clear" || diff(f.b.needDate, r.eta) <= s.slackDays);
      let priority, action, why;
      if (urgent.length) {
        priority = "High"; action = r.tier === 3 ? "Fast-track receiving inspection, then kit" : "Receive same day and kit";
        const f = urgent[0];
        why = f.st.status !== "Clear"
          ? `Feeds ${f.b.name} (${f.st.status.toLowerCase()}, needed ${fmt(f.b.needDate)}).`
          : `Feeds ${f.b.name}, needed ${fmt(f.b.needDate)}: only ${plural(diff(f.b.needDate, r.eta), "day")} after arrival.`;
      } else if (feeds.length) {
        priority = "Medium"; action = "Receive and kit within 48 hours";
        why = `Feeds ${feeds[0].b.name}, needed ${fmt(feeds[0].b.needDate)}; enough buffer for standard flow.`;
      } else {
        priority = "Low"; action = "Standard put-away"; why = "Replenishment; no build is waiting on it.";
      }
      return { ...r, partName: parts[r.part].name, feeds: feeds.map((f) => ({ build: f.b.name, id: f.b.id, qty: f.qty, needDate: f.b.needDate, status: f.st.status })),
               priority, action, why, firstNeed: feeds[0] ? feeds[0].b.needDate : null };
    }).sort((a, b) => ({ High: 0, Medium: 1, Low: 2 }[a.priority] - { High: 0, Medium: 1, Low: 2 }[b.priority]) ||
      (a.firstNeed && b.firstNeed ? diff(a.firstNeed, b.firstNeed) : (a.firstNeed ? -1 : b.firstNeed ? 1 : 0)) || diff(a.eta, b.eta));

    // Indirect orders: on time vs. requested date, with a simple recommendation
    const indirect = state.poLines.filter((po) => po.indirect && poInfo[po.id]).map((po) => {
      const e = poInfo[po.id]; const lateBy = diff(e.eta, po.requestedDate);
      let rec;
      if (lateBy > 0) rec = { title: "Notify requester; accept delay", cost: 0, why: `Arrives ${plural(lateBy, "day")} after the requested date; general-use item, so no expedite.` };
      else if (e.conf === 1) rec = { title: `Chase ${sup[po.supplier].name}`, cost: 0, why: `On time on paper, but ${e.confReason}.` };
      else rec = { title: "No action", cost: 0, why: "On time with a reliable signal." };
      return { po: po.id, part: po.part, partName: parts[po.part].name, supplier: sup[po.supplier].name, qty: po.qty,
               requested: po.requestedDate, eta: e.eta, conf: e.confName, confReason: e.confReason, status: lateBy > 0 ? `Late ${lateBy}d` : "On time", lateBy, rec };
    });

    const counts = { Blocked: 0, "At Risk": 0, Clear: 0 }; out.forEach((x) => counts[x.status]++);
    return { settings: s, builds: out, poInfo, coverage, dock, indirect, counts };
  }

  // Later builds that could be pulled forward into this slot: clear today AND all their material is in hand by this build's need date
  function clearCandidates(results, b) {
    return Object.values(results).filter((r) => diff(r.build.needDate, b.needDate) > 0 &&
        r.lines.every((l) => l.status === "Clear" && (!l.latestDate || diff(l.latestDate, b.needDate) <= 0)))
      .map((r) => r.build).sort((x, y) => diff(x.needDate, y.needDate));
  }

  // ---------- recommendations ----------
  // Blocked: recommend the cheapest option that actually closes the gap by the need date; else re-sequence.
  // At risk: recommend the $0 action that fixes the reason (chase a weak signal, pull in a thin date, or wait).
  function recommend(state, s, b, L, poInfo, sup, clearLater) {
    const today = state.today, site = state.productionSite, opts = [];
    const need = b.needDate;
    const keyPoId = L.short > 0 ? (L.late[0] && L.late[0].po) : (L.used.find((x) => x.conf === L.minConf && x.po) || {}).po;
    const keyPo = keyPoId ? state.poLines.find((p) => p.id === keyPoId) : null;
    const ki = keyPo ? poInfo[keyPo.id] : null;

    if (L.short > 0) {
      const gap = L.short;
      const row = invRow(state, L.part, site);
      if (row && row.mrbHold >= gap)
        opts.push({ type: "mrb", title: "Request MRB disposition", cost: 0, closes: true, contingent: true,
          effect: `${row.mrbHold} units are on MRB hold; ${gap} needed. If Quality approves use-as-is or rework, the gap closes.`,
          time: "Depends on Quality review" });
      state.lanes.filter((ln) => ln.to === site).forEach((ln) => {
        const r = invRow(state, L.part, ln.from);
        const transferable = r ? Math.max(0, availNow(r) - (r.safetyStock || 0)) : 0;
        if (transferable <= 0) return;
        const arrive = addDays(today, ln.days);
        const closes = transferable >= gap && diff(arrive, need) <= 0;
        opts.push({ type: "transfer", title: `Transfer from ${whName(state, ln.from)}`, cost: ln.cost, closes,
          effect: closes ? `Move ${gap} units (of ${transferable} spare above safety stock); arrives ${fmt(arrive)}.`
                         : `Only ${transferable} spare above safety stock (need ${gap}); arrives ${fmt(arrive)}. Not enough on its own.`,
          time: `${plural(ln.days, "day")}`, arrive, from: ln.from, qty: Math.min(gap, transferable), part: L.part });
      });
      if (keyPo && keyPo.expedite && !keyPo.expedited && ki) {
        const newEta = addDays(ki.eta, -keyPo.expedite.days);
        const closes = diff(newEta, need) <= 0 && keyPo.qty >= gap;
        opts.push({ type: "expedite", title: `Expedite ${keyPo.id}`, cost: keyPo.expedite.cost, closes,
          effect: closes ? `${keyPo.expedite.note}: ETA ${fmt(ki.eta)} → ${fmt(newEta)}, before the ${fmt(need)} need date.`
                         : `${keyPo.expedite.note}: ETA ${fmt(ki.eta)} → ${fmt(newEta)}, still ${plural(diff(newEta, need), "day")} after the need date.`,
          time: `${plural(keyPo.expedite.days, "day")} earlier`, arrive: newEta, po: keyPo.id, days: keyPo.expedite.days });
      }
      if (keyPo && ki && ki.conf === 1)
        opts.push({ type: "chase", title: `Chase ${sup[keyPo.supplier].name}`, cost: 0, closes: false, po: keyPo.id,
          effect: `Confirm the real date and reason (${ki.confReason}). Improves confidence; no schedule gain on its own.`, time: "Today", draft: true });
      // Predicted landing date: first date when inbound supply after the need date covers the shortfall
      let acc = 0, lands = null;
      for (const x of L.late) { acc += x.remaining; if (acc >= gap) { lands = x.date; break; } }
      const slipTo = lands ? `Slip ${b.name} to ${fmt(lands)} (predicted arrival)` : `Hold ${b.name} until supply is secured (nothing inbound covers the gap)`;
      const swap = clearLater[0];
      opts.push({ type: "resequence", title: "Re-sequence the build", cost: 0, closes: false, protects: true, lands,
        effect: swap ? `${slipTo}; pull forward ${swap.name} (${swap.id}, clear, needed ${fmt(swap.needDate)}).`
                     : `${slipTo} and notify Production.`, time: "Schedule change" });

      const closing = opts.filter((o) => o.closes).sort((a, c) => a.cost - c.cost || (a.contingent ? 1 : 0) - (c.contingent ? 1 : 0));
      const pick = closing[0] || opts.find((o) => o.type === "resequence");
      pick.recommended = true;
      pick.whyPick = closing[0]
        ? `Cheapest option that closes the ${gap}-unit gap by ${fmt(need)}` + (closing.length > 1 ? ` (vs. ${closing.slice(1).map((o) => o.title + " $" + o.cost.toLocaleString()).join(", ")})` : "") + "."
        : `No option closes the gap by ${fmt(need)}, so protect the line by re-sequencing.`;
    } else {
      if (L.minConf === 1 && keyPo && ki.flags.includes("delayNoDate")) {
        // A reported delay: a chase can't resolve the risk, only reveal how big it is
        opts.push({ type: "chase", title: `Chase ${sup[keyPo.supplier].name}`, cost: 0, getsDate: true, recommended: true, draft: true, po: keyPo.id,
          effect: `Get the new date and where the order is today. The new date decides whether the build stays clear or needs a fallback.`, time: "Today",
          whyPick: "The old date can't be trusted. A $0 chase gets the real date." });
      } else if (L.minConf === 1 && keyPo) {
        opts.push({ type: "chase", title: `Chase ${sup[keyPo.supplier].name}`, cost: 0, resolves: true, recommended: true, draft: true, po: keyPo.id,
          effect: `Get a fresh, reasoned date (${ki.confReason}). If confirmed, the build turns clear.`, time: "Today",
          whyPick: "The quantity is covered; the risk is the signal. A $0 chase fixes the root cause." });
      } else if (keyPo && ki && ki.conf === 3) {
        opts.push({ type: "wait", title: "Wait and monitor", cost: 0, resolves: true, recommended: true,
          effect: `Already moving (${lcFirst(ki.basis)}). Arrives ${plural(L.slack, "day")} before need.`, time: "—",
          whyPick: "Material is already moving with high confidence; paying to expedite buys slack you don't need." });
      } else if (keyPo) {
        opts.push({ type: "chase", title: `Ask ${sup[keyPo.supplier].name} to pull in`, cost: 0, resolves: true, recommended: true, draft: true, po: keyPo.id, pullIn: true,
          effect: `Only ${plural(L.slack, "day")} of slack: ${lcFirst(ki.basis)}. Request a firm, earlier ship date.`, time: "Today",
          whyPick: "Slack is thin on a medium-confidence date; a pull-in request is free and adds buffer." });
      } else {
        opts.push({ type: "wait", title: "Wait for inspection release", cost: 0, resolves: true, recommended: true,
          effect: "Stock clears inspection before the need date.", time: "—", whyPick: "No action needed beyond monitoring." });
      }
      if (keyPo && keyPo.expedite && !keyPo.expedited)
        opts.push({ type: "expedite", title: `Expedite ${keyPo.id}`, cost: keyPo.expedite.cost, notNeeded: true, po: keyPo.id, days: keyPo.expedite.days,
          effect: `${keyPo.expedite.note}: ${plural(keyPo.expedite.days, "day")} earlier. Not needed; it already arrives before the need date.`, time: `${plural(keyPo.expedite.days, "day")} earlier` });
    }
    return opts;
  }

  // ---------- decisions that change the plan ----------
  // Transfers and expedites update the plan immediately; other decisions are logged only.
  function applyDecision(state, opt) {
    if (opt.type === "transfer") {
      state.transfers = state.transfers || [];
      const id = "TR-" + (1001 + state.transfers.length);
      state.transfers.push({ id, part: opt.part, qty: opt.qty, from: opt.from, to: state.productionSite, arrive: opt.arrive });
      const src = invRow(state, opt.part, opt.from); if (src) src.onHand -= opt.qty;
      return `${id}: ${opt.qty} units from ${whName(state, opt.from)} arriving ${fmt(opt.arrive)}`;
    }
    if (opt.type === "expedite") {
      const po = state.poLines.find((p) => p.id === opt.po);
      po.expedited = { days: opt.days, cost: opt.cost };
      return `${po.id} expedited ${plural(opt.days, "day")}`;
    }
    if (opt.type === "chase") { markChaseSent(state, opt.po); return `Chase sent for ${opt.po}`; }
    return null;
  }
  function markChaseSent(state, poId) {
    const po = state.poLines.find((p) => p.id === poId);
    if (po) po.chase = { sentAt: state.today, repliedAt: null };
  }

  // ---------- apply a confirmed supplier update (from the intake) ----------
  function applyUpdate(state, u) {
    const po = state.poLines.find((p) => p.id === u.po);
    if (!po) throw new Error("Unknown PO " + u.po);
    const today = state.today;
    const sup = state.suppliers.find((x) => x.id === po.supplier);
    if (po.milestone) {
      const st = po.milestone.stages;
      const ship = st.find((x) => x.key === "shipped");
      if (u.newShipDate) {
        const shift = diff(u.newShipDate, ship.planned);
        if (shift !== 0) {
          po.lastChange = { from: ship.planned, to: u.newShipDate, at: today, reason: u.reason || null };
          st.forEach((x) => { if (!x.done) x.planned = addDays(x.planned, shift); });
        }
      }
      if (u.milestone) {
        const idx = st.findIndex((x) => x.key === u.milestone);
        st.forEach((x, i) => { if (i <= idx && !x.done) x.done = today; });
        if (u.milestone === "shipped") po.asn = { shipDate: today, eta: addDays(today, sup.transitDays) };
      }
    } else if (u.newShipDate) {
      const newDelivery = addDays(u.newShipDate, sup.transitDays);
      po.lastChange = { from: po.confirmedDate || po.promiseDate, to: newDelivery, at: today, reason: u.reason || null };
      po.confirmedDate = newDelivery;
    }
    // A delay reported without a new date or milestone: keep the old date but stop trusting it until a date arrives
    if (u.newShipDate || u.milestone) delete po.openDelay;
    else if (u.reason && !/on track|on schedule|as planned|no change/i.test(u.reason)) po.openDelay = { at: today, reason: u.reason };
    po.lastSignal = { source: "Supplier email (AI-extracted, human-confirmed)", at: today };
    if (po.chase && !po.chase.repliedAt) po.chase.repliedAt = today;
    return po;
  }

  const API = { compute, applyUpdate, applyDecision, markChaseSent, etaFor, fmt, addDays, diff, DEFAULT_SETTINGS, CONF_NAME };
  root.CTB_RULES = API;
  if (typeof module !== "undefined") module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
