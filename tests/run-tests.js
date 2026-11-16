// Scenario checks: run with `node tests/run-tests.js` from the project folder.
const DATA = require("../data.js");
const R = require("../rules.js");
const clone = (x) => JSON.parse(JSON.stringify(x));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "  -> " + detail : "")); }
}
const byName = (res, n) => res.builds.find((b) => b.name === n);
const rec = (b) => (b.recs.find((o) => o.recommended) || {});

const res = R.compute(clone(DATA));
console.log("\nBoard (default settings):");
res.builds.forEach((b) => console.log(`  ${b.status.padEnd(8)} ${b.name.padEnd(26)} need ${b.needDate}  limiting=${b.limiting ? b.limiting.part : "-"}  rec=${rec(b).title || "-"}`));
console.log(`  Coverage: ${res.coverage.pct}% (${res.coverage.fresh}/${res.coverage.total})\n`);

// 1. Hidden upstream slip (milestone) — promise date looks fine, milestone says late
const tt = byName(res, "Torpedo Tube Assembly");
check("S1 Torpedo Tube blocked by late Kestrel milestone", tt.status === "Blocked" && tt.limiting.part === "TT-2210-04");
check("S1 ETA pushed past need date (promise said Nov 21)", tt.etaDisplay === "2026-11-25", tt.etaDisplay);
check("S1 recommendation = expedite that actually closes gap", rec(tt).type === "expedite" && rec(tt).closes === true);

// 2. Stale signal
const cr = byName(res, "Weapons-Handling Cradle");
check("S2 Cradle at risk due to stale low-confidence signal", cr.status === "At Risk" && cr.limiting.minConf === 1);
check("S2 recommendation = chase", rec(cr).type === "chase");

// 3. MRB hold (+ inspection)
const hp = byName(res, "Hull Penetrator Kit");
check("S3 Hull Penetrator blocked (on-hand 20 but MRB 12 + inspection 4)", hp.status === "Blocked" && hp.limiting.short === 8, hp.limiting.short);
check("S3 recommendation = MRB disposition", rec(hp).type === "mrb");
check("S3 inspection stock counted from clear date", hp.limiting.used.some((u) => u.kind === "inspection"));

// 4. Transfer beats expedite
const md = byName(res, "Muzzle Door Actuator");
const mdT = md.recs.find((o) => o.type === "transfer"), mdE = md.recs.find((o) => o.type === "expedite");
check("S4 Muzzle Door blocked", md.status === "Blocked");
check("S4 transfer and expedite both close the gap", mdT && mdT.closes && mdE && mdE.closes);
check("S4 recommended = transfer (cheaper)", rec(md).type === "transfer");

// 5 + 10. Partial shipment + allocation conflict
const ka = byName(res, "Hydraulic Actuator Kit A"), kb = byName(res, "Hydraulic Actuator Kit B");
check("S10 Kit A clear from partial (30 of 50)", ka.status === "Clear");
check("S5 Kit B blocked: 25 of 30 allocated to earlier Kit A", kb.status === "Blocked" && kb.limiting.alloc === 5 && kb.limiting.earlier.length === 1);
check("S10 Kit B recommendation = expedite remainder (closes gap)", rec(kb).type === "expedite" && rec(kb).closes);

// 6. Dock-to-stock
check("S6 dock list led by partial shipment (feeds Kit A and blocked Kit B), High priority", res.dock[0] && res.dock[0].ref === "PO-66340-1" && res.dock[0].priority === "High" && res.dock[0].feeds.length === 2, JSON.stringify(res.dock[0]));
check("S6 replenishment with no build waiting is Low priority", res.dock.some((d) => d.ref === "PO-55201-1" && d.priority === "Low"));

// 8. Chronic slipper
const bv = byName(res, "Ballast Valve Assembly");
check("S8 Ballast at risk: quoted Nov 27 adjusted by +7d history to Dec 4", bv.status === "At Risk" && bv.etaDisplay === "2026-12-04", bv.etaDisplay);
check("S8 recommendation = pull-in request", rec(bv).type === "chase");

// 9. Expedite not worth it
const lc = byName(res, "Launcher Control Cabinet");
check("S9 Launcher at risk on thin slack, high confidence", lc.status === "At Risk" && lc.confDisplay === 3);
check("S9 recommendation = wait (expedite shown but not recommended)", rec(lc).type === "wait" && lc.recs.some((o) => o.type === "expedite" && !o.recommended));

// 11. Healthy builds
["Torpedo Ejection Pump", "Stores Loading Tray", "Breech Door Seal Set"].forEach((n) => check(`S11 ${n} clear`, byName(res, n).status === "Clear"));

// Ranking
check("Ranking: blocked first, then at risk, then clear", res.builds.map((b) => b.status).join(",").match(/^(Blocked,)+(At Risk,)+(Clear,?)+$/) !== null);

// Indirect
check("Indirect: chairs late vs requested", res.indirect.find((x) => x.part === "FA-CHR-01").lateBy > 0);

// Settings hooks
const res2 = R.compute(clone(DATA), { slackDays: 1 });
check("Hook: slack threshold 1 day turns Launcher clear", byName(res2, "Launcher Control Cabinet").status === "Clear");

// 7. Live email updates
let st = clone(DATA);
R.applyUpdate(st, DATA.sampleEmails[0].cached);
let r7 = R.compute(st);
check("S7a Good-news email flips Torpedo Tube to Clear", byName(r7, "Torpedo Tube Assembly").status === "Clear", byName(r7, "Torpedo Tube Assembly").status);

st = clone(DATA);
R.applyUpdate(st, DATA.sampleEmails[1].cached);
r7 = R.compute(st);
const tt2 = byName(r7, "Torpedo Tube Assembly");
check("S7b Bad-news email: still blocked, expedite no longer closes, re-sequence recommended", tt2.status === "Blocked" && rec(tt2).type === "resequence", rec(tt2).type);

st = clone(DATA);
R.applyUpdate(st, DATA.sampleEmails[2].cached);
r7 = R.compute(st);
check("S7c Tidewater confirmation turns Cradle clear", byName(r7, "Weapons-Handling Cradle").status === "Clear", byName(r7, "Weapons-Handling Cradle").status);

// Re-sequence candidates must have their material in hand by the slot date
{
  const tt0 = byName(res, "Torpedo Tube Assembly");
  const rs = tt0.recs.find((o) => o.type === "resequence");
  check("Re-sequence suggests a build whose parts are in hand by Nov 24 (not the Dec 2 manifold waiting on a Nov 26 part)",
    rs && !rs.effect.includes("Torpedo Room Hydraulic Manifold"), rs && rs.effect);
}

// Build-level freshness
check("Freshness: 13 of 16 builds fresh, 1 aging (Drain Pump), 2 stale (Torpedo Tube, Cradle)",
  res.coverage.builds.fresh === 13 && res.coverage.builds.aging.join() === "Torpedo Tube Drain Pump" && res.coverage.builds.stale.length === 2, JSON.stringify(res.coverage.builds));

// At-risk options say "resolves risk", not "closes gap"
check("At-risk recommendations are marked resolves (not closes)", rec(lc).resolves === true && !rec(lc).closes);
check("Indirect: late chairs -> notify requester", res.indirect.find((x) => x.part === "FA-CHR-01").rec.title.startsWith("Notify"));
check("Indirect: stale monitors -> chase CDW", res.indirect.find((x) => x.part === "IT-MON-27").rec.title === "Chase CDW");

// Decisions that change the plan
st = clone(DATA);
let d = R.compute(st);
R.applyDecision(st, byName(d, "Muzzle Door Actuator").recs.find((o) => o.type === "transfer"));
d = R.compute(st);
check("Decision: transfer flips Muzzle Door to Clear", byName(d, "Muzzle Door Actuator").status === "Clear", byName(d, "Muzzle Door Actuator").status);
check("Decision: transfer appears on dock list, High priority", d.dock.some((x) => x.kind === "transfer" && x.priority === "High"));
check("Decision: Groton stock reduced by transfer", st.inventory.find((r) => r.part === "MD-7740-03" && r.wh === "GR").onHand === 6);

st = clone(DATA); d = R.compute(st);
R.applyDecision(st, byName(d, "Torpedo Tube Assembly").recs.find((o) => o.type === "expedite"));
d = R.compute(st);
check("Decision: expedite moves Torpedo Tube from Blocked to At Risk (thin slack, stale)", byName(d, "Torpedo Tube Assembly").status === "At Risk", byName(d, "Torpedo Tube Assembly").status);

// Chase -> reply loop
st = clone(DATA); d = R.compute(st);
R.applyDecision(st, rec(byName(d, "Ballast Valve Assembly")));
check("Chase marks PO as awaiting reply", st.poLines.find((p) => p.id === "PO-66230-1").chase.repliedAt === null);
R.applyUpdate(st, DATA.sampleEmails[3].cached);
d = R.compute(st);
check("Chase reply (pull-in) turns Ballast Clear and closes the chase", byName(d, "Ballast Valve Assembly").status === "Clear" && st.poLines.find((p) => p.id === "PO-66230-1").chase.repliedAt === DATA.today, byName(d, "Ballast Valve Assembly").status);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
