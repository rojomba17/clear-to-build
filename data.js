/* Clear-to-Build Decision Board — synthetic data (fictional scenario).
   All companies, part numbers, and work orders are invented, except Amazon Business
   and CDW, which are named in the case prompt. "Today" is fixed so the demo is stable. */
(function (root) {
  const DATA = {
    today: "2026-11-18",
    productionSite: "QY",

    warehouses: [
      { id: "QY", name: "Quincy Yard", role: "Production site (line-side stock)" },
      { id: "GR", name: "Groton DC", role: "Distribution center" },
      { id: "BA", name: "Baltimore Annex", role: "Overflow warehouse" }
    ],

    // Transfer lanes into the production site
    lanes: [
      { from: "GR", to: "QY", days: 2, cost: 180 },
      { from: "BA", to: "QY", days: 3, cost: 260 }
    ],

    // Tier = supplier size / data maturity (not position in the supply chain)
    suppliers: [
      // Tier 1: structured feeds (EDI/API), reliable
      { id: "MER", name: "Meridian Seal & Gasket", tier: 1, channel: "EDI feed", medianSlipDays: 0, transitDays: 2 },
      { id: "CFS", name: "Coastal Fastener Supply", tier: 1, channel: "EDI feed", medianSlipDays: 0, transitDays: 2 },
      { id: "NLC", name: "Northline Connectors", tier: 1, channel: "EDI feed", medianSlipDays: 1, transitDays: 2 },
      { id: "VED", name: "Vector Electronics Distribution", tier: 1, channel: "EDI feed", medianSlipDays: 0, transitDays: 2 },
      { id: "AMZ", name: "Amazon Business", tier: 1, channel: "API feed", medianSlipDays: 0, transitDays: 2, indirect: true },
      { id: "CDW", name: "CDW", tier: 1, channel: "EDI feed", medianSlipDays: 1, transitDays: 3, indirect: true },
      // Tier 2: mid-size, status via a no-login link / portal
      { id: "HVW", name: "Harbor Valve Works", tier: 2, channel: "Status link", medianSlipDays: 0, transitDays: 2 },
      { id: "TWH", name: "Tidewater Hydraulics", tier: 2, channel: "Status link", medianSlipDays: 2, transitDays: 2 },
      { id: "BWC", name: "Bluewater Castings", tier: 2, channel: "Status link", medianSlipDays: 7, transitDays: 3 },
      { id: "KHC", name: "Keystone Harness Co.", tier: 2, channel: "Status link", medianSlipDays: 2, transitDays: 2 },
      // Tier 3: small machine shops, email/phone only
      { id: "KFC", name: "Kestrel Forge Co.", tier: 3, channel: "Email", medianSlipDays: 6, transitDays: 1 },
      { id: "PRM", name: "Pine Ridge Machining", tier: 3, channel: "Email", medianSlipDays: 4, transitDays: 2 },
      { id: "ICN", name: "Ironbound CNC", tier: 3, channel: "Email", medianSlipDays: 5, transitDays: 2 }
    ],

    parts: [
      { id: "TT-2210-04", name: "Breech door hinge forging", supplier: "KFC" },
      { id: "HP-0915-11", name: "Titanium gland nut, 3.5in", supplier: "PRM" },
      { id: "WH-3302-07", name: "Hydraulic actuator rod", supplier: "TWH" },
      { id: "BV-1180-02", name: "Valve body casting, Inconel", supplier: "BWC" },
      { id: "MD-7740-03", name: "Muzzle door seal kit", supplier: "MER" },
      { id: "HA-4410-08", name: "Actuator control valve", supplier: "HVW" },
      { id: "LC-5521-19", name: "Shielded connector harness", supplier: "KHC" },
      { id: "SL-3305-01", name: "Loading tray control PCB", supplier: "VED" },
      { id: "TE-1201-02", name: "Ejection pump impeller", supplier: "ICN" },
      { id: "TE-1205-06", name: "Ejection pump housing (machined)", supplier: "ICN" },
      { id: "FS-0110-00", name: "MIL-spec fastener kit", supplier: "CFS" },
      { id: "CN-2200-12", name: "MIL-spec circular connector", supplier: "NLC" },
      { id: "BD-0402-05", name: "Breech door O-ring kit", supplier: "MER" },
      { id: "HM-6610-03", name: "Hydraulic manifold block (machined)", supplier: "ICN" },
      { id: "BI-2207-01", name: "Breech interlock solenoid", supplier: "VED" },
      { id: "LV-3390-04", name: "Launch valve poppet", supplier: "HVW" },
      { id: "SM-4471-02", name: "Elastomer shock mount", supplier: "MER" },
      { id: "DP-5530-02", name: "Drain pump motor bracket (machined)", supplier: "PRM" },
      // Indirect (general use)
      { id: "IT-LAP-14", name: "Laptop, 14in engineering spec", supplier: "CDW", indirect: true },
      { id: "IT-MON-27", name: "Monitor, 27in", supplier: "CDW", indirect: true },
      { id: "FA-CHR-01", name: "Ergonomic office chair", supplier: "AMZ", indirect: true }
    ],

    // Inventory by part and warehouse. mrbHold = non-conforming, awaiting Material Review Board disposition.
    inventory: [
      { part: "TT-2210-04", wh: "QY", onHand: 2, mrbHold: 0 },
      { part: "TT-2210-04", wh: "BA", onHand: 1, mrbHold: 0, safetyStock: 1 },
      { part: "HP-0915-11", wh: "QY", onHand: 20, mrbHold: 12, inspection: { qty: 4, clearsOn: "2026-11-19" } },
      { part: "HP-0915-11", wh: "BA", onHand: 6, mrbHold: 0, safetyStock: 2 },
      { part: "WH-3302-07", wh: "QY", onHand: 0, mrbHold: 0 },
      { part: "BV-1180-02", wh: "QY", onHand: 0, mrbHold: 0 },
      { part: "MD-7740-03", wh: "QY", onHand: 2, mrbHold: 0 },
      { part: "MD-7740-03", wh: "GR", onHand: 14, mrbHold: 0, safetyStock: 4 },
      { part: "HA-4410-08", wh: "QY", onHand: 0, mrbHold: 0 },
      { part: "LC-5521-19", wh: "QY", onHand: 0, mrbHold: 0 },
      { part: "SL-3305-01", wh: "QY", onHand: 0, mrbHold: 0 },
      { part: "TE-1201-02", wh: "QY", onHand: 6, mrbHold: 0 },
      { part: "TE-1205-06", wh: "QY", onHand: 0, mrbHold: 0 },
      { part: "FS-0110-00", wh: "QY", onHand: 120, mrbHold: 0 },
      { part: "FS-0110-00", wh: "GR", onHand: 300, mrbHold: 0, safetyStock: 100 },
      { part: "CN-2200-12", wh: "QY", onHand: 30, mrbHold: 0 },
      { part: "BD-0402-05", wh: "QY", onHand: 30, mrbHold: 0 },
      { part: "HM-6610-03", wh: "QY", onHand: 0, mrbHold: 0 },
      { part: "BI-2207-01", wh: "QY", onHand: 0, mrbHold: 0 },
      { part: "LV-3390-04", wh: "QY", onHand: 2, mrbHold: 0 },
      { part: "SM-4471-02", wh: "QY", onHand: 40, mrbHold: 0 },
      { part: "DP-5530-02", wh: "QY", onHand: 0, mrbHold: 0 }
    ],

    // Upcoming builds (work orders) at the production site, with BOM requirements
    builds: [
      { id: "WO-44818", name: "Muzzle Door Actuator", needDate: "2026-11-23", bom: [["MD-7740-03", 10], ["CN-2200-12", 2]] },
      { id: "WO-44820", name: "Hydraulic Actuator Kit A", needDate: "2026-11-23", bom: [["HA-4410-08", 25], ["FS-0110-00", 10]] },
      { id: "WO-44812", name: "Torpedo Tube Assembly", needDate: "2026-11-24", bom: [["TT-2210-04", 6], ["FS-0110-00", 20], ["CN-2200-12", 4]] },
      { id: "WO-44826", name: "Hydraulic Actuator Kit B", needDate: "2026-11-26", bom: [["HA-4410-08", 20], ["FS-0110-00", 10]] },
      { id: "WO-44790", name: "Hull Penetrator Kit", needDate: "2026-11-27", bom: [["HP-0915-11", 16], ["BD-0402-05", 4]] },
      { id: "WO-44876", name: "Launcher Control Cabinet", needDate: "2026-12-01", bom: [["LC-5521-19", 3], ["CN-2200-12", 6]] },
      { id: "WO-44831", name: "Weapons-Handling Cradle", needDate: "2026-12-03", bom: [["WH-3302-07", 4], ["FS-0110-00", 20]] },
      { id: "WO-44855", name: "Ballast Valve Assembly", needDate: "2026-12-05", bom: [["BV-1180-02", 12], ["BD-0402-05", 6]] },
      { id: "WO-44882", name: "Torpedo Ejection Pump", needDate: "2026-12-10", bom: [["TE-1201-02", 2], ["TE-1205-06", 2]] },
      { id: "WO-44890", name: "Stores Loading Tray", needDate: "2026-12-12", bom: [["SL-3305-01", 4], ["FS-0110-00", 15]] },
      { id: "WO-44899", name: "Breech Door Seal Set", needDate: "2026-12-15", bom: [["BD-0402-05", 8]] },
      { id: "WO-44904", name: "Torpedo Room Hydraulic Manifold", needDate: "2026-12-02", bom: [["HM-6610-03", 2], ["FS-0110-00", 10]] },
      { id: "WO-44906", name: "Breech Door Interlock Assembly", needDate: "2026-12-04", bom: [["BI-2207-01", 6], ["CN-2200-12", 4]] },
      { id: "WO-44911", name: "Weapons Launch Valve Kit", needDate: "2026-12-08", bom: [["LV-3390-04", 8]] },
      { id: "WO-44915", name: "Shock Isolation Mount Kit", needDate: "2026-12-14", bom: [["SM-4471-02", 16], ["BD-0402-05", 6]] },
      { id: "WO-44918", name: "Torpedo Tube Drain Pump", needDate: "2026-12-18", bom: [["DP-5530-02", 4], ["FS-0110-00", 8]] }
    ],

    /* Open PO lines. Signal fields (strongest wins): received > carrier > asn > milestone > confirmedDate > promiseDate.
       confirmedDate / promiseDate = expected delivery at our dock.
       milestone stages: planned dates + done dates; ship stage drives the ETA (ship + transit).
       lastSignal = most recent update from any channel. lastChange = most recent date change (reason may be missing).
       expedite = what the supplier/carrier can offer: days earlier and cost. */
    poLines: [
      { id: "PO-77310-1", part: "TT-2210-04", supplier: "KFC", qty: 4, dest: "QY",
        promiseDate: "2026-11-21",
        milestone: { stages: [
          { key: "raw", label: "Raw material received", planned: "2026-11-06", done: "2026-11-06" },
          { key: "machining", label: "In machining", planned: "2026-11-10", done: "2026-11-10" },
          { key: "oqc", label: "Outgoing QC passed", planned: "2026-11-14", done: null },
          { key: "shipped", label: "Shipped", planned: "2026-11-20", done: null } ] },
        lastSignal: { source: "Supplier email", at: "2026-11-10" },
        expedite: { days: 2, cost: 1200, note: "Overtime machining + next-day freight" } },

      { id: "PO-77420-1", part: "HP-0915-11", supplier: "PRM", qty: 10, dest: "QY",
        promiseDate: "2026-11-24", confirmedDate: "2026-12-01",
        lastSignal: { source: "Supplier email", at: "2026-11-15" },
        lastChange: { from: "2026-11-24", to: "2026-12-01", at: "2026-11-15", reason: "Thread-gauge rework on first batch" },
        expedite: { days: 3, cost: 800, note: "Weekend shift" } },

      { id: "PO-66105-1", part: "WH-3302-07", supplier: "TWH", qty: 4, dest: "QY",
        promiseDate: "2026-11-28", confirmedDate: "2026-11-28",
        lastSignal: { source: "Status link", at: "2026-11-06" } },

      { id: "PO-66230-1", part: "BV-1180-02", supplier: "BWC", qty: 12, dest: "QY",
        promiseDate: "2026-11-27", confirmedDate: "2026-11-27",
        lastSignal: { source: "Status link", at: "2026-11-16" } },

      { id: "PO-55018-1", part: "MD-7740-03", supplier: "MER", qty: 20, dest: "QY",
        promiseDate: "2026-11-26",
        asn: { shipDate: "2026-11-24", eta: "2026-11-26" },
        lastSignal: { source: "EDI 856 ship notice", at: "2026-11-17" },
        expedite: { days: 4, cost: 1900, note: "Air freight upgrade" } },

      { id: "PO-66340-1", part: "HA-4410-08", supplier: "HVW", qty: 30, dest: "QY",
        promiseDate: "2026-11-19",
        carrier: { eta: "2026-11-19", status: "Out for delivery tomorrow" },
        lastSignal: { source: "Carrier tracking", at: "2026-11-18" },
        partialOf: 50, note: "Partial shipment: 30 of 50 shipped" },

      { id: "PO-66340-2", part: "HA-4410-08", supplier: "HVW", qty: 20, dest: "QY",
        promiseDate: "2026-11-19", confirmedDate: "2026-11-28",
        lastSignal: { source: "Status link", at: "2026-11-17" },
        lastChange: { from: "2026-11-19", to: "2026-11-28", at: "2026-11-17", reason: "Valve seat rework on remaining 20 units" },
        partialOf: 50, note: "Remainder of partial shipment",
        expedite: { days: 3, cost: 650, note: "Prioritize rework line" } },

      { id: "PO-66412-1", part: "LC-5521-19", supplier: "KHC", qty: 3, dest: "QY",
        promiseDate: "2026-11-24",
        asn: { shipDate: "2026-11-27", eta: "2026-11-29" },
        lastSignal: { source: "Ship notice", at: "2026-11-17" },
        lastChange: { from: "2026-11-24", to: "2026-11-29", at: "2026-11-17", reason: "Connector backshell backorder, now resolved" },
        expedite: { days: 2, cost: 1400, note: "Next-day air" } },

      { id: "PO-55120-1", part: "SL-3305-01", supplier: "VED", qty: 4, dest: "QY",
        promiseDate: "2026-11-20",
        asn: { shipDate: "2026-11-18", eta: "2026-11-20" },
        lastSignal: { source: "EDI 856 ship notice", at: "2026-11-17" } },

      { id: "PO-77505-1", part: "TE-1205-06", supplier: "ICN", qty: 2, dest: "QY",
        promiseDate: "2026-11-30",
        milestone: { stages: [
          { key: "raw", label: "Raw material received", planned: "2026-11-09", done: "2026-11-09" },
          { key: "machining", label: "In machining", planned: "2026-11-12", done: "2026-11-12" },
          { key: "oqc", label: "Outgoing QC passed", planned: "2026-11-24", done: null },
          { key: "shipped", label: "Shipped", planned: "2026-11-28", done: null } ] },
        lastSignal: { source: "Supplier email", at: "2026-11-17" } },

      { id: "PO-55201-1", part: "FS-0110-00", supplier: "CFS", qty: 200, dest: "QY",
        promiseDate: "2026-11-20",
        asn: { shipDate: "2026-11-18", eta: "2026-11-20" },
        lastSignal: { source: "EDI 856 ship notice", at: "2026-11-18" } },

      { id: "PO-55210-1", part: "CN-2200-12", supplier: "NLC", qty: 40, dest: "QY",
        promiseDate: "2026-12-02", confirmedDate: "2026-12-02",
        lastSignal: { source: "EDI 855 order ack", at: "2026-11-16" } },

      { id: "PO-55230-1", part: "BD-0402-05", supplier: "MER", qty: 50, dest: "QY",
        promiseDate: "2026-12-08", confirmedDate: "2026-12-08",
        lastSignal: { source: "EDI 855 order ack", at: "2026-11-17" } },

      { id: "PO-77612-1", part: "HM-6610-03", supplier: "ICN", qty: 2, dest: "QY",
        promiseDate: "2026-11-26",
        milestone: { stages: [
          { key: "raw", label: "Raw material received", planned: "2026-11-11", done: "2026-11-11" },
          { key: "machining", label: "In machining", planned: "2026-11-14", done: "2026-11-14" },
          { key: "oqc", label: "Outgoing QC passed", planned: "2026-11-21", done: null },
          { key: "shipped", label: "Shipped", planned: "2026-11-24", done: null } ] },
        lastSignal: { source: "Supplier email", at: "2026-11-17" } },

      { id: "PO-55305-1", part: "BI-2207-01", supplier: "VED", qty: 6, dest: "QY",
        promiseDate: "2026-11-20",
        asn: { shipDate: "2026-11-18", eta: "2026-11-20" },
        lastSignal: { source: "EDI 856 ship notice", at: "2026-11-18" } },

      { id: "PO-66455-1", part: "LV-3390-04", supplier: "HVW", qty: 6, dest: "QY",
        promiseDate: "2026-12-01", confirmedDate: "2026-12-01",
        lastSignal: { source: "Status link", at: "2026-11-16" } },

      { id: "PO-55318-1", part: "BD-0402-05", supplier: "MER", qty: 40, dest: "QY",
        promiseDate: "2026-11-21",
        carrier: { eta: "2026-11-21", status: "In transit" },
        lastSignal: { source: "Carrier tracking", at: "2026-11-18" } },

      { id: "PO-55322-1", part: "SM-4471-02", supplier: "MER", qty: 24, dest: "QY",
        promiseDate: "2026-11-19",
        asn: { shipDate: "2026-11-17", eta: "2026-11-19" },
        lastSignal: { source: "EDI 856 ship notice", at: "2026-11-17" } },

      { id: "PO-77640-1", part: "DP-5530-02", supplier: "PRM", qty: 4, dest: "QY",
        promiseDate: "2026-12-08",
        lastSignal: { source: "PO acknowledgment", at: "2026-11-13" } },

      // Indirect (general use) — hidden by default
      { id: "PO-90011-1", part: "IT-LAP-14", supplier: "CDW", qty: 12, dest: "QY", indirect: true, requestedDate: "2026-11-25",
        promiseDate: "2026-11-21", asn: { shipDate: "2026-11-18", eta: "2026-11-21" },
        lastSignal: { source: "EDI 856 ship notice", at: "2026-11-17" } },
      { id: "PO-90012-1", part: "FA-CHR-01", supplier: "AMZ", qty: 20, dest: "QY", indirect: true, requestedDate: "2026-11-20",
        promiseDate: "2026-11-20", carrier: { eta: "2026-11-24", status: "In transit, delayed at hub" },
        lastSignal: { source: "Carrier tracking", at: "2026-11-18" } },
      { id: "PO-90013-1", part: "IT-MON-27", supplier: "CDW", qty: 12, dest: "QY", indirect: true, requestedDate: "2026-12-01",
        promiseDate: "2026-11-26", confirmedDate: "2026-11-26",
        lastSignal: { source: "EDI 855 order ack", at: "2026-11-09" } }
    ],

    // Sample supplier emails for the intake demo (with cached extractions used if AI is unavailable)
    sampleEmails: [
      { id: "S1", label: "Kestrel Forge: QC passed, shipping tomorrow (good news)",
        text: "Hi team, quick update on PO 77310 (hinge forgings). The 4 pcs cleared final QC this morning, paperwork attached. Booking ground freight to ship out tomorrow 11/19, should be at Quincy the day after. Thanks, Dave, Kestrel Forge",
        cached: { po: "PO-77310-1", milestone: "oqc", newShipDate: "2026-11-19", qty: 4, reason: "Cleared final QC; shipping ground", extractionConfidence: "high" } },
      { id: "S2", label: "Kestrel Forge: heat-treat delay (bad news)",
        text: "Hey, bad news on 77310. Our heat treat vendor had a furnace go down, so the hinge forgings are stuck. Best guess QC on the 25th and we ship the 27th. Sorry about this, will keep you posted. Dave",
        cached: { po: "PO-77310-1", milestone: null, newShipDate: "2026-11-27", qty: 4, reason: "Heat-treat vendor furnace down", extractionConfidence: "high" } },
      { id: "S3", label: "Tidewater Hydraulics: date confirmed",
        text: "Re: PO 66105 actuator rods. Confirming all 4 rods finish plating Friday and ship Mon 11/24. Tracking to follow. — Maria, Tidewater Hydraulics",
        cached: { po: "PO-66105-1", milestone: null, newShipDate: "2026-11-24", qty: 4, reason: "Plating complete Friday; ship Monday", extractionConfidence: "high" } },
      { id: "S4", label: "Bluewater Castings: can pull in (reply to chase)",
        text: "Hi, got your note on PO 66230. We moved the Inconel valve bodies up in the pour schedule. All 12 will ship Friday 11/21. — Tom, Bluewater Castings",
        cached: { po: "PO-66230-1", milestone: null, newShipDate: "2026-11-21", qty: 12, reason: "Moved up in pour schedule", extractionConfidence: "high" } }
    ],

    // Internal transfers created by planner decisions (starts empty)
    transfers: []
  };

  root.CTB_DATA = DATA;
  if (typeof module !== "undefined") module.exports = DATA;
})(typeof window !== "undefined" ? window : globalThis);
