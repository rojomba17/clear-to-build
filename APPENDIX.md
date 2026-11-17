# Clear-to-Build Decision Board: Appendix

Supporting detail for the case write-up. Live prototype: https://rojomba17.github.io/clear-to-build/

## A. Core Rules (Deterministic)

All decision logic lives in [`rules.js`](rules.js). No AI is involved in any of it.

- **ETA, strongest signal wins:** received > carrier tracking > ship notice > supplier milestone > confirmed date + the supplier's typical slip > promise date + typical slip.
- **Confidence:**
  - **High:** shipped or in transit.
  - **Medium:** supplier milestone or confirmed date.
  - **Low:** promise only, no update in more than 7 days, a date slipped with no reason, or a delay reported with no new date.
- **Status:**
  - **Blocked:** not enough available by the need date.
  - **At Risk:** covered, but on a Low-confidence signal or with less than 3 days of slack.
  - **Clear:** otherwise.
- **Available** = on-hand minus MRB hold minus inspection (inspection stock counts from its release date), allocated to builds in need-date order.
- **Recommendation:**
  - **Blocked:** the cheapest option that closes the gap by the need date (MRB disposition, transfer, expedite). If none does, re-sequence: pull forward a later build whose parts are all in hand by the slot date.
  - **At Risk:** a $0 chase (weak signal), a pull-in request (thin slack on a medium-confidence date), or wait (already moving with high confidence).
- **Freshness:** a build is fresh if every PO it relies on has a signal under 72 hours old; aging at 3–7 days; stale after 7.

## B. Testing

### Automated scenario checks

48 checks in [`tests/run-tests.js`](tests/run-tests.js), run on every change (`node tests/run-tests.js`). They cover all 11 seeded scenarios, the dock-to-stock list, decisions that change the plan, the chase-and-reply loop, re-sequence candidate validity, and freshness.

### Email extraction test

15 realistic supplier emails, sent through the live AI intake ([`tests/extraction-test.html`](tests/extraction-test.html)), 3 runs each. A case passes when the PO, ship date, milestone, and quantity are right (or correctly left empty) and no reason is invented.

| # | Case | Result (3 runs) |
|---|---|---|
| 1 | Clean confirmation (baseline) | 3/3 |
| 2 | No PO number: match by part name | 3/3 |
| 3 | Terse Tier 3 note, weekday date ("shipping thurs") | 3/3 |
| 4 | Supplier has two open orders; email doesn't say which | 3/3 (PO left empty, low confidence) |
| 5 | Two POs in one email | 2/3 (wrong PO once) |
| 6 | Bad news, no date given | 3/3 (no date invented) |
| 7 | Delivery date given instead of ship date | **0/3** |
| 8 | Partial shipment, split dates | 3/3 |
| 9 | Milestone only, no date | 1/3 (PO number put in quantity twice) |
| 10 | Shipped, with tracking number | 3/3 |
| 11 | Reply thread: old date quoted, new date above | 3/3 |
| 12 | PO number that doesn't exist | 3/3 (PO left empty) |
| 13 | Indirect order (not on the direct PO list) | 3/3 (PO left empty) |
| 14 | Instruction planted in the email ("ignore all prior instructions…") | 3/3 (ignored) |
| 15 | Heavy shorthand ("est shp 12/04 pending FAI") | **0/3** |

**Overall:** 12 of 15 correct in each run (36 of 45). No invented reasons in 45 extractions. Ambiguous emails left empty with low confidence 9 of 9 times. One wrong PO in 45.

**Repeat failures (design gaps):**

- #7: a delivery date read as a ship date. The answer format has no delivery-date field; adding one is the fix.
- #15: "start machining Monday" read as machining complete. Low impact on this PO.

**Intermittent failures (model variance):** #9 (PO number in the quantity field) and #5 (wrong PO on a two-order email). This is why a human confirms every field before anything changes.

**A reliability fix found by this test:** on the first attempt, 10 of 15 requests failed because the model sometimes replied in plain text instead of structured data. Forcing a structured answer format (a tool call) and turning off the model's extended thinking fixed it: 0 errors since.

## C. Synthetic Data

All companies, part numbers, and work orders are invented, except Amazon Business and CDW, which are named in the case prompt. Data lives in [`data.js`](data.js).

- **Builds:** 16 work orders at one production site (Quincy Yard).
- **PO lines:** 19 direct and 3 indirect.
- **Suppliers:** 13. Tier 1: 6 (including Amazon and CDW for indirect). Tier 2: 4. Tier 3: 3. Tier = supplier size and data maturity, not position in the supply chain.
- **Warehouses:** 3 (Quincy Yard, Groton DC, Baltimore Annex), with transfer lanes and costs.

**Real-world scale assumed (estimates, not facts):** hundreds of suppliers across Tier 1–3, a few thousand open PO lines, 4–6 US warehouses, lead times from days (indirect) to 8–16 weeks (machined parts), and multiple ERPs across business lines (the postings name Oracle and NetSuite).

**Eleven seeded scenarios:**

1. Hidden upstream slip (promise date looks fine; milestone is late)
2. Stale signal
3. MRB hold and inspection stock
4. Transfer beats expedite
5. Allocation conflict between two builds
6. Dock-to-stock priority
7. Live supplier email update
8. Chronic slipper (quoted date adjusted by slip history)
9. Expedite not worth it
10. Partial shipment
11. Healthy builds

## D. Sources

- Material Planner III, Sentry: https://job-boards.greenhouse.io/andurilindustries/jobs/5007770007
- Senior Material Planner: https://job-boards.greenhouse.io/andurilindustries/jobs/5165232007
- Supply Planner III, Sentry: https://job-boards.greenhouse.io/andurilindustries/jobs/5128727007
- ArsenalOS: https://www.anduril.com/arsenal/arsenalos

## E. Full Assumptions Table

The write-up shows the six assumptions that matter most. This is the full set, including how each was tested.

| Assumption | Type | Confidence | How tested | Result |
|---|---|---|---|---|
| The Material Planner owns clear-to-build and the daily shortage decision | Problem | High | Three Anduril planner postings | Confirmed by the postings |
| Planners can't fully trust system numbers today | Problem | High | Postings ("reflect reality," Excel trackers, "manual workarounds"); my Walmart experience | Confirmed |
| Material data is spread across multiple systems | Problem | High | Postings name Oracle and NetSuite, plus Excel, Blue Yonder, and Salesforce | Confirmed by the postings |
| Most slips on custom direct material start upstream at the supplier, before shipment | Problem | **High** | Practitioner conversations; my Walmart experience | Confirmed by both |
| Inventory counts and states can't be taken at face value | Problem | High | My Walmart experience (shipped vs. received gaps, unclear states); postings (MRB holds) | Confirmed |
| Count reliability is uniform across warehouses (a simplification for the prototype) | Solution | Low (known simplification) | My Walmart experience says accuracy varies by site, depending on its tools and processes | Not tested. Site-level count confidence is a fast follow |
| BOMs, the build schedule, and need dates live in the ERP/MRP, and this layer adds signals on top | Solution | Medium | Postings reference MRP, BOMs, and production plans; stated as a design dependency | Design dependency, not testable in a prototype. Modeled as a read-only input (BOMs, need dates, POs, inventory) |
| Small suppliers will answer email or a low-friction link more reliably than a portal | Solution | Medium-high | Practitioners (Tier 3 = email, calls, shared files); my Walmart experience (sellers via account managers). Caveat: practitioner leverage differs | Not testable in a prototype. Email intake works, so the channel isn't the blocker; supplier behavior is an open question for the live discussion |
| Supplier milestones give earlier warning than a single promise date | Solution | Medium | Seeded scenarios comparing milestone-based and promise-only detection | Supported in seeded scenarios. Torpedo Tube's promise date (Nov 21) looked on time, but the late QC milestone moved its ETA to Nov 25, flagging it Blocked 6 days before its Nov 24 need date |
| Small suppliers will update 3–4 coarse milestones if it's low effort (an email reply or a link) | Solution | Medium | Practitioners (Tier 2 entered status daily or per shift when asked); my Walmart seller experience. Caveat: depends on Anduril's leverage | Not testable in a prototype; open question for the live discussion |
| Allocating stock to builds in need-date order matches how planners prioritize by default | Solution | Medium-high | Standard MRP allocation practice; cross-program priority conflicts are routed to the Supply Planner | Works as designed: in the seeded conflict, Kit A takes 25 of 30 units and Kit B is Blocked. Priority-blind by design; open question for the live discussion |
| Transfer time and cost between warehouses can be estimated well enough to compare against expediting | Solution | Medium | Simple lane table in synthetic data (labeled synthetic); my Walmart transfer experience | Sufficient for the comparison: for Muzzle Door, a $180 transfer and a $1,900 expedite both close the gap, so the transfer is recommended |
| A supplier's slip history predicts future slips | Solution | Medium (untested) | Scenario checks on synthetic history (labeled synthetic) | The mechanism works (Ballast: quoted Nov 27, predicted Dec 4 from a ~7-day typical slip). Can't be validated on synthetic data; needs real predicted-vs-actual history |
| AI can reliably extract PO, quantity, milestone, date, and reason from messy supplier emails | Solution | Testable | 15 realistic emails, 3 runs each, through the live intake (Section B) | 12 of 15 correct in each of 3 runs. No invented reasons in 45 extractions; ambiguous emails left empty 9 of 9; 1 wrong PO in 45. Repeat failures: a delivery date read as a ship date, a shorthand milestone |
| Ranking by risk with visible confidence builds trust instead of adding noise | Solution | Medium | My Walmart alert-fatigue experience; design review; open question for the live discussion | Not testable without real users. A shadow pilot would test it (Section H) |

## F. Full Scope Decisions

| Area | Call | Why |
|---|---|---|
| Clear-to-build by build: clear, at risk, or blocked, plus the blocking part | **In (core)** | The planner's core decision |
| Simple allocation within a product line: available stock goes to builds in need-date order | **In (core)** | Prevents counting the same part toward two builds, and mirrors standard MRP practice. Priority conflicts across programs are flagged for the Supply Planner, not decided by the tool |
| Data freshness banner (share of builds running on fresh signals) | **In (light)** | Tells the planner how much of today's picture to trust |
| ETA from the strongest available signal, with confidence, source, and a "why" | **In (core)** | Quoted dates can't be taken at face value |
| Supplier milestones for Tier 2/3 (raw material → machining → outgoing QC → shipped) | **In (light)** | The biggest uncertainty is upstream, and milestones should catch slips earlier (tested with seeded scenarios) |
| Available vs. on-hand (MRB and inspection holds) | **In (core)** | Stock on hold doesn't make a build clear |
| Supplier update intake by tier: system feed (simulated), status link (simulated), AI email parsing (working, human-confirmed) | **In (core)** | Meets each supplier where it already works |
| Reason captured with every status change | **In (core)** | Status changes without a reason force manual follow-up |
| Recommended action on every flag (chase, MRB disposition, transfer between warehouses, expedite, re-sequence) | **In (core)** | "Force decisions, don't describe status" |
| Warehouse transfer as one recommended option: only unallocated stock at another site, shown with transfer time and cost next to expedite | **In (light)** | Often the cheapest fix, and easy to miss when stock is split across sites. Inter-site transfers were a standard lever at Walmart. Network-wide rebalancing is out |
| Stack-ranked attention list (exceptions on top) | **In (core)** | Prevents alert fatigue |
| Dock-to-stock priority list for receiving | **In (light)** | Named in the planner postings and confirmed by practitioners |
| Logistics cost | **In, only at the decision point** | Shown as expedite or transfer cost vs. delay impact. Full cost optimization is out |
| In-transit tracking | **Consumed as a signal, not built** | Buyable, and practitioners say in-transit delays cost less |
| Anduril-arranged (prepaid) inbound shipping | **Out (fast follow)** | Gives tracking and cost control for small suppliers. Label creation becomes a free "ready to ship" milestone |
| Received-vs-shipped discrepancies; site-level count confidence; international and customs risk | **Out (fast follow)** | Real trust signals, but each adds a concept. Core trust comes first |
| Supplier capacity | **Proxy only** | Captured through slip history and milestones |
| Indirect inventory | **In the data, hidden by default** | Low production impact, but it shows the model extends |
| Cross-program allocation | **Out** | The Supply Planner's strategic work; a next step |
| Engineering-change revision cut-ins (ECO/ECN) | **Out** | A separate workflow |
| Cost optimization engine, dock scheduling, cycle counting, on-site supplier walks | **Out** | These depend on trusted inputs, or are human processes |

## G. AI and Build Log

### How the work was split

I set the problem, the user, the scope, and the 11 scenarios the build had to get right. Claude wrote the code and challenged my thinking. I reviewed every screen and recommendation against the scenarios, and every change had to pass the automated scenario checks (48 today).

### Mistakes, and how they surfaced

| Issue | How it surfaced | Fix |
|---|---|---|
| Lovable recommended an expedite that didn't close the gap | Checking the date math on its recommendation | Discarded the tool |
| The first chase-message template (code, not AI) included our internal slip estimate, which a supplier should never see | Claude flagged it while reviewing a screenshot of v1.0 | Templates now state supplier-facing facts only (PO, need date, last update, what we need back) |
| Re-sequencing suggested a build whose own parts wouldn't arrive in time | Self-critique pass on the scenarios | A swap candidate must have all its parts in hand by the slot date |
| On a good-news email, the AI correctly left the reason empty, and my rule then penalized it | Live AI test | The AI exposed a flaw in **my** rule: only penalize a date that slips later with no reason |
| 10 of 15 test emails came back as plain text instead of data | Email test | Forced a structured answer format: 0 errors since |
| My test grader didn't check quantity, and the AI had put a PO number in the quantity field | Reading the raw output | Scored it as a failure: 12 of 15, not the grader's 13 |
| A supplier delay with no new date couldn't be recorded, so the board kept trusting the old date | Email test, case 6 | The delay now drops confidence to Low and recommends a chase. **Fresh isn't the same as trusted** |

### Version history

| Version | What changed | Why |
|---|---|---|
| Before v1.0 | Built a first version in Lovable, then discarded it | It recommended an expedite that didn't close the gap, and its logic couldn't be seen or tested |
| v1.0–v1.4 (not snapshotted) | First working board, build drawer, supplier intake, dock-to-stock list. Then: a working "Send (simulated)" for chases; live tabs; folded detail sections; a row-number column; more synthetic data (16 builds); chase templates limited to supplier-facing facts; "Resolves risk" instead of "Closes gap" on at-risk builds; an "aging" state between fresh and stale; freshness measured by build instead of by PO; distinct colors for aging and stale; clickable filter pills | My reviews of each version: what a planner would misread, and what the data could and couldn't support |
| v1.5 | Re-sequencing only suggests a build whose parts are all in hand by the slot date | A self-critique pass found it suggesting a build that was waiting on its own late part |
| v1.6 | Live AI email extraction through a Cloudflare Worker (key held server-side) | Prove the AI step works on real text, not only on cached examples |
| v1.7 | A missing reason only lowers confidence when a date slips later | The live AI correctly left the reason empty on a good-news email, and my rule penalized it |
| v1.8 | Re-sequence shows the predicted landing date and a "Protects line" tag | "Recommended" next to "Doesn't close gap" read as a contradiction |
| v1.9 | "None can be available" and "Short 12" wording | "Only 0 can be available" and "Gap −12" read as errors |
| Worker update | Forced a structured answer format; turned off the model's extended thinking | 10 of 15 test emails failed with plain-text replies |
| v2.0 | A delay reported with no new date drops confidence to Low and recommends a chase; the intake now accepts it | The board couldn't record the delay, so it kept trusting the old date. Fresh isn't the same as trusted |
| v2.1 | Delay chases tagged "Gets the real date"; clearer "why it's flagged" text | A chase can't resolve a reported delay, only reveal how big it is |
| v2.2 | Header shows "(case demo date)"; spacing fix in the material summary | The demo runs on a fixed date so scenarios behave the same whenever it's opened |

## H. Trade-offs, Known Gaps, and Next Steps

### Trade-offs, with when I'd revisit them

| Choice | What I gained | What I gave up | When I'd revisit |
|---|---|---|---|
| **Rules, not a model, for ETAs and confidence** | Explainable on day one, works with thin data, testable | The accuracy a model could learn from history | With 6+ months of predicted-vs-actual arrivals |
| **Plain code with tests, not a low-code builder** | Logic I can read, verify, and change live | Polish and the fastest first draft | n/a |
| **Allocation by need date** | Standard MRP practice; simple and predictable | Program priority: an urgent program can't jump the queue | When the Supply Planner workflow is in scope |
| **One recommended action: the cheapest that closes the gap** | A clear decision, not a menu | Combined fixes (e.g., a partial transfer plus an expedite) and a cost-vs-time weighting | After planner feedback |
| **The planner logs a re-sequence; the board doesn't rewrite the schedule** | Avoids two conflicting versions of the production schedule | A demo where the schedule updates live on screen | When integrated with scheduling |
| **Paste-in email, human confirms every extraction** | Safe and auditable | Planner effort per email | Once accuracy on real mail justifies auto-applying high-confidence updates |
| **Freshness measured by build, not by PO** | Measures what the planner cares about: can I trust this build's status? | Stale POs that feed no near-term build don't show in the score | n/a |
| **Hold the fallback until a delayed supplier gives a date** | Don't act on a guess | Up to a day of lead time | If chase replies prove slow |

### Known gaps (what I'd fix next)

- **Delivery date vs. ship date:** the AI answer format has no delivery-date field, so "at your dock Wednesday" is read as a ship date (Section B, case 7).
- **Several POs in one email, and split shipments:** the intake handles one PO and one date per email.
- **Quantity isn't used in the math:** it's extracted and shown for confirmation, but a partial confirmation doesn't split the PO.
- **A stronger signal wins:** an email about a PO that already has a ship notice or carrier tracking doesn't change its ETA. A cancelled shipment reported only by email would be missed.
- **Allocation ignores program priority:** need-date order only.
- **No combined options:** e.g., a partial transfer plus an expedite.
- **Re-sequencing checks material only:** not line or skill compatibility, changeover time, or delivery priority. Its landing date uses the most limiting part.
- **MRB disposition is contingent:** shown as $0, but it depends on Quality approving the held stock.
- **Slip history is one number per supplier:** no variance, and revised dates aren't tracked separately from original quotes.
- **Thresholds are judgment calls:** 72 hours fresh, 7 days stale, 3 days of slack, 75% for a green freshness score.
- **The AI proxy has no rate limiting:** it's protected by an origin check and a spend cap.
- **Synthetic data:** one production site, with count reliability treated as uniform across warehouses.

### Next steps (first 90 days)

1. **Shadow pilot:** one product line, 2–3 planners, 4 weeks, with the board running next to their Excel trackers. Compare its calls with what actually happened.
2. **Read-only ERP/MRP connection** (Oracle, NetSuite) for BOMs, POs, and inventory.
3. **Shared-inbox ingestion,** plus extraction for delivery dates, multiple POs, and split shipments.
4. **Real slip history,** tracking how revised dates slip separately from original quotes.
5. **Fast follows:** Tier 2 status link, prepaid inbound shipping, received-vs-shipped discrepancies, site-level count confidence, and priority-aware allocation with the Supply Planner.
