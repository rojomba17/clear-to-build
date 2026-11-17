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
