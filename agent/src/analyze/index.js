// Phase 0 analysis: ROMS's hand-typed numbers against every Tally company.
//
// Answers the decision-gate questions from data instead of guesses:
//   - does ROMS Bill No equal a Tally sales invoice number, or only its
//     serial ('607' for 607/RM/26-27), and is any number ambiguous across
//     companies or years
//   - does the Buyer's Order No find the PO (the planned primary match), and
//     does it agree with Bill No
//   - whose number is the RTV CN number, and does the Agst Ref route work
//   - where GRN Discrepancy Numbers / RTV DNs live in Tally
//   - how Flipkart/Amazon rows are vouchered (transfers to our own GSTINs?)
//   - which Tally party ledger is which ROMS vendor
//   - stock item ↔ SKU (directly, or through the marketplace code ROMS's
//     vendor mapping holds), and SKU/quantity sanity on linked invoices
//   - what auto-fill would write — Tally's numbers as they are — and how many
//     ROMS's current format rule would block
// Read-only on both sides; writes analysis.json + analysis.md.
const fs = require('fs');
const path = require('path');
const { readProbe } = require('../probe/store');
const { makeInternalCheck } = require('../probe/profile');
const { summarizeRefs, renderRefsSummary } = require('../roms/summary');
const {
  DocIndex, exactKey, normKey, compactKey, splitRefs, serialOf, withoutLabel, howTyped,
} = require('../docno');
const { ROMS_REF_RULE, TRANSFER_VENDORS, OUR_PAN } = require('../config');
const { inc, top, addExample, pct, fyOf, mdTable, writeJson } = require('../util');

const RETURNED_TO_VENDOR = 'Returned to Vendor';
const DN_DISPOSED = 'DN - Disposed';
const blank = (v) => v == null || String(v).trim() === '';
const qualifiesForRtv = (p) => p.status !== 'Deleted'
  && (p.grn_status === RETURNED_TO_VENDOR || Number(p.discrepancy_qty || 0) > 0);

// Same voucher reached through several fields counts once.
function uniq(entries) {
  const seen = new Map();
  for (const e of entries) {
    const k = `${e.slug}|${e.v.guid || `${e.v.type}|${e.v.number}|${e.v.date}`}`;
    if (!seen.has(k)) seen.set(k, { ...e, paths: [] });
    if (e.path) seen.get(k).paths.push(e.path);
  }
  return [...seen.values()];
}

// One voucher out of several candidates: unique, else the one on the same
// date, else the only one in the same financial year (series that restart
// every April repeat their numbers).
function pick(entries, isoDate) {
  const vs = uniq(entries);
  if (vs.length === 1) return { chosen: vs[0], how: 'unique', vouchers: vs };
  if (isoDate) {
    const sameDay = vs.filter((e) => e.v.date === isoDate);
    if (sameDay.length === 1) return { chosen: sameDay[0], how: 'date', vouchers: vs };
    const sameFy = vs.filter((e) => fyOf(e.v.date) === fyOf(isoDate));
    if (sameFy.length === 1) return { chosen: sameFy[0], how: 'financial year', vouchers: vs };
  }
  return { chosen: null, how: 'ambiguous', vouchers: vs };
}

const describe = (e) => `${e.company} ${e.v.type} ${e.v.number || '(no number)'} ${e.v.date}`;
const whereKey = (e, p) => `${e.v.baseType} · ${p}`;

function buildIndexes(companies, codeOf) {
  // Bill No is a sales invoice number. Matched against every voucher, a
  // typed '607' also hits Payment 607 and Journal 607.
  const salesByNumber = new DocIndex();
  const salesBySerial = new DocIndex();
  const byDoc = new DocIndex(); // every reference-like field, number included
  const byOrder = new DocIndex(); // Buyer's Order No (invoice Order Details)
  const narrationTokens = new Set();
  const notesAgainst = new Map(); // `${slug}|${bill}` → CN/DN entries settling that bill
  const live = [];
  for (const c of companies) {
    const company = codeOf(c.slug);
    for (const v of c.vouchers) {
      if (v.cancelled || v.optional) continue;
      const ref = { v, company, slug: c.slug };
      live.push(ref);
      if (v.number && v.baseType === 'Sales') {
        salesByNumber.add(v.number, ref);
        if (serialOf(v.number)) salesBySerial.add(serialOf(v.number), ref);
      }
      for (const [p, values] of Object.entries(v.docFields || {})) {
        for (const value of values) for (const one of splitRefs(value)) byDoc.add(one, { ...ref, path: p });
      }
      for (const o of v.orders) for (const one of splitRefs(o.no)) byOrder.add(one, { ...ref, path: 'INVOICEORDERLIST.LIST/BASICPURCHASEORDERNO' });
      for (const t of exactKey(v.narration).split(/[^A-Z0-9/-]+/)) if (t.length >= 4) narrationTokens.add(normKey(t));
      if (v.baseType === 'Credit Note' || v.baseType === 'Debit Note') {
        for (const b of v.ledgerLines.flatMap((l) => l.bills)) {
          if (!/agst/i.test(b.type) || !b.name) continue;
          const k = `${c.slug}|${exactKey(b.name)}`;
          if (!notesAgainst.has(k)) notesAgainst.set(k, []);
          notesAgainst.get(k).push(ref);
        }
      }
    }
  }
  return { salesByNumber, salesBySerial, byDoc, byOrder, narrationTokens, notesAgainst, live };
}

// A typed Bill No: the whole sales invoice number, else — all digits — its
// serial ('607', '0607' for 607/RM/26-27).
function findBill(idx, billNo) {
  const whole = idx.salesByNumber.find(billNo);
  if (whole.level) return whole;
  if (!/^\d+$/.test(String(billNo).trim())) return whole;
  const serial = idx.salesBySerial.find(billNo);
  return serial.level ? { level: 'serial', entries: serial.entries } : serial;
}

// A ROMS PO number as typed, then looser readings: without a trailing label
// ('P4588464- Dry'), then each of several numbers in one field
// ('48287510036332/48287510052160').
function findOrder(idx, value) {
  const direct = idx.byOrder.find(value);
  if (direct.level) return direct;
  const bare = withoutLabel(value);
  if (bare) {
    const hit = idx.byOrder.find(bare);
    if (hit.level) return { level: 'label dropped', entries: hit.entries };
  }
  const parts = String(value).split('/').map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) {
    const entries = parts.flatMap((s) => idx.byOrder.find(withoutLabel(s) || s).entries);
    if (entries.length) return { level: 'one of several numbers', entries };
  }
  return { level: null, entries: [] };
}

function analyze({ probeDir, refs, pan = OUR_PAN }) {
  const { run, companies } = readProbe(probeDir);
  const profilePath = path.join(probeDir, 'profile.json');
  const profile = fs.existsSync(profilePath) ? JSON.parse(fs.readFileSync(profilePath, 'utf8')) : null;
  const codeOf = (slug) => (profile && (profile.companies.find((p) => p.slug === slug) || {}).code) || slug;
  const isInternal = makeInternalCheck(companies, pan);
  const idx = buildIndexes(companies, codeOf);

  const poById = new Map(refs.pos.map((p) => [p.po_id, p]));
  const pos = refs.pos.filter((p) => p.status !== 'Deleted');
  const warnings = [];

  // Coverage: ROMS POs older than the probe window cannot match.
  const poDates = pos.map((p) => p.po_date).filter(Boolean).sort();
  const coverage = { firstPoDate: poDates[0] || null, lastPoDate: poDates[poDates.length - 1] || null, probeFrom: run.from, probeTo: run.to };
  if (coverage.firstPoDate && run.from > coverage.firstPoDate) {
    warnings.push(`The probe starts ${run.from} but ROMS has POs from ${coverage.firstPoDate}. Bills invoiced before ${run.from} will show as "not found". Re-run the probe with --from ${coverage.firstPoDate}.`);
  }
  if (!companies.length) warnings.push('The probe folder holds no companies.');

  // ---- Bill No ↔ Tally voucher number
  const bill = {
    withBillNo: 0, outcome: {}, outcomeBySerial: 0, byLevel: {}, typed: {}, baseTypes: {}, byVendor: {}, internalByVendor: {},
    foundElsewhere: {}, dateCompared: 0, dateAgrees: 0, examples: { notFound: [], ambiguous: [], elsewhere: [] },
  };
  const billLinks = new Map();
  for (const p of pos) {
    if (blank(p.bill_no)) continue;
    bill.withBillNo++;
    const vb = bill.byVendor[p.vendor] || (bill.byVendor[p.vendor] = { withBillNo: 0, matched: 0, ambiguous: 0, notFound: 0, elsewhere: 0 });
    vb.withBillNo++;
    const hit = findBill(idx, p.bill_no);
    if (!hit.level) {
      const elsewhere = idx.byDoc.find(p.bill_no);
      if (elsewhere.level) {
        inc(bill.outcome, 'only in another field');
        vb.elsewhere++;
        for (const e of uniq(elsewhere.entries)) for (const w of new Set(e.paths)) inc(bill.foundElsewhere, whereKey(e, w));
        addExample(bill.examples.elsewhere, `${p.po_id} "${p.bill_no}" → ${uniq(elsewhere.entries).slice(0, 2).map(describe).join(' | ')}`, 6);
      } else {
        inc(bill.outcome, 'not found');
        vb.notFound++;
        addExample(bill.examples.notFound, `${p.po_id} ${p.vendor} "${p.bill_no}" (${p.bill_date || 'no date'})`, 8);
      }
      continue;
    }
    inc(bill.byLevel, hit.level);
    const choice = pick(hit.entries, p.bill_date || p.dispatch_date || p.po_date);
    if (!choice.chosen) {
      inc(bill.outcome, 'ambiguous');
      vb.ambiguous++;
      addExample(bill.examples.ambiguous, `${p.po_id} "${p.bill_no}" → ${choice.vouchers.map(describe).join(' | ')}`, 6);
      continue;
    }
    inc(bill.outcome, choice.how === 'unique' ? 'matched' : `matched (picked by ${choice.how})`);
    if (hit.level === 'serial') bill.outcomeBySerial++;
    vb.matched++;
    const e = choice.chosen;
    billLinks.set(p.po_id, e);
    inc(bill.typed, howTyped(p.bill_no, e.v.number));
    inc(bill.baseTypes, e.v.type === e.v.baseType ? e.v.baseType : `${e.v.baseType} (${e.v.type})`);
    if (p.bill_date) {
      bill.dateCompared++;
      if (p.bill_date === e.v.date) bill.dateAgrees++;
    }
    if (isInternal(e.slug, e.v.party)) inc(bill.internalByVendor, p.vendor);
  }

  // ---- Buyer's Order No ↔ ROMS Vendor PO (the planned primary match)
  const order = {
    pos: pos.length, found: 0, byLevel: {}, multiVoucher: 0, foundElsewhere: {}, narrationOnly: 0, notFound: 0,
    bothMatched: 0, agree: 0, disagree: 0, byVendor: {}, byMonth: {}, examples: { conflicts: [], notFound: [], multi: [] },
  };
  const orderLinks = new Map();
  for (const p of pos) {
    const vb = order.byVendor[p.vendor] || (order.byVendor[p.vendor] = { pos: 0, found: 0 });
    vb.pos++;
    // A month Tally has not been written up for yet shows as a gap here.
    const month = String(p.po_date || '').slice(0, 7) || '(no date)';
    const mb = order.byMonth[month] || (order.byMonth[month] = { pos: 0, found: 0 });
    mb.pos++;
    if (blank(p.vendor_po_id)) continue;
    const hit = findOrder(idx, p.vendor_po_id);
    if (!hit.level) {
      const elsewhere = idx.byDoc.find(p.vendor_po_id);
      if (elsewhere.level) {
        for (const e of uniq(elsewhere.entries)) for (const w of new Set(e.paths)) inc(order.foundElsewhere, whereKey(e, w));
      } else if (idx.narrationTokens.has(normKey(p.vendor_po_id))) {
        order.narrationOnly++;
      } else {
        order.notFound++;
        addExample(order.examples.notFound, `${p.po_id} ${p.vendor} "${p.vendor_po_id}" (${p.po_date || 'no date'})`, 8);
      }
      continue;
    }
    const vs = uniq(hit.entries).filter((e) => e.v.baseType === 'Sales');
    if (!vs.length) {
      for (const e of uniq(hit.entries)) inc(order.foundElsewhere, whereKey(e, 'Order Details'));
      continue;
    }
    order.found++;
    vb.found++;
    mb.found++;
    inc(order.byLevel, hit.level);
    orderLinks.set(p.po_id, vs);
    if (vs.length > 1) {
      order.multiVoucher++;
      addExample(order.examples.multi, `${p.po_id} "${p.vendor_po_id}" → ${vs.map(describe).join(' | ')}`, 5);
    }
    const viaBill = billLinks.get(p.po_id);
    if (viaBill) {
      order.bothMatched++;
      if (vs.some((e) => e.v === viaBill.v)) order.agree++;
      else {
        order.disagree++;
        addExample(order.examples.conflicts, `${p.po_id}: Buyer's Order → ${vs.map(describe).join(' | ')}; Bill No "${p.bill_no}" → ${describe(viaBill)}`, 8);
      }
    }
  }

  // One invoice per PO where the evidence is unambiguous.
  const invoiceOf = (poId) => billLinks.get(poId)
    || (orderLinks.has(poId) && orderLinks.get(poId).length === 1 ? orderLinks.get(poId)[0] : null);

  // ---- RTV credit notes
  const cn = {
    rtvRows: refs.rtv.length, onPage: 0, disposed: 0, withCn: 0, cnFound: {}, cnWhere: {},
    invoiceLinked: 0, withCnAgainstInvoice: 0, multipleCn: 0, typedEqualsAgstCn: 0, typedDiffers: 0,
    fillable: 0, fillableBlockedByFormat: 0, examples: { notFound: [], differs: [], fillable: [] },
  };
  for (const r of refs.rtv) {
    const p = poById.get(r.po_id);
    if (!p) continue;
    const onPage = qualifiesForRtv(p);
    if (onPage) cn.onPage++;
    if (r.status === DN_DISPOSED) cn.disposed++;
    if (!blank(r.cn_number)) {
      cn.withCn++;
      const hit = idx.byDoc.find(r.cn_number);
      if (hit.level) {
        inc(cn.cnFound, hit.level);
        for (const e of uniq(hit.entries)) for (const w of new Set(e.paths)) inc(cn.cnWhere, whereKey(e, w));
      } else {
        inc(cn.cnFound, 'not found');
        addExample(cn.examples.notFound, `${r.rtv_no} (${r.po_id}) "${r.cn_number}"`, 8);
      }
    }
    const inv = invoiceOf(p.po_id);
    if (!inv) continue;
    cn.invoiceLinked++;
    const notes = uniq(idx.notesAgainst.get(`${inv.slug}|${exactKey(inv.v.number)}`) || [])
      .filter((e) => e.v.baseType === 'Credit Note');
    if (!notes.length) continue;
    cn.withCnAgainstInvoice++;
    if (notes.length > 1) cn.multipleCn++;
    if (!blank(r.cn_number)) {
      const typed = normKey(r.cn_number);
      const same = notes.some((e) => [e.v.number, e.v.reference, ...Object.values(e.v.docFields || {}).flat()].some((x) => normKey(x) === typed));
      if (same) cn.typedEqualsAgstCn++;
      else {
        cn.typedDiffers++;
        addExample(cn.examples.differs, `${r.rtv_no} typed "${r.cn_number}", Tally CN against ${inv.v.number}: ${notes.map(describe).join(' | ')}`, 6);
      }
    } else if (onPage && r.status !== DN_DISPOSED && notes.length === 1) {
      cn.fillable++;
      if (!ROMS_REF_RULE.test(notes[0].v.number)) cn.fillableBlockedByFormat++;
      addExample(cn.examples.fillable, `${r.rtv_no} (${r.po_id}) ← ${describe(notes[0])}`, 6);
    }
  }

  // ---- GRN Discrepancy Numbers and RTV DNs
  const findWhere = (values) => {
    const out = { total: 0, found: {}, where: {}, notFound: [] };
    for (const [label, value] of values) {
      out.total++;
      const hit = idx.byDoc.find(value);
      if (!hit.level) { inc(out.found, 'not found'); addExample(out.notFound, `${label} "${value}"`, 8); continue; }
      inc(out.found, hit.level);
      for (const e of uniq(hit.entries)) for (const w of new Set(e.paths)) inc(out.where, whereKey(e, w));
    }
    return out;
  };
  const discrepancy = findWhere(pos.filter((p) => !blank(p.discrepancy_number)).map((p) => [p.po_id, p.discrepancy_number]));
  const rtvDn = findWhere(refs.rtv.filter((r) => !blank(r.dn_number)).map((r) => [r.rtv_no, r.dn_number]));

  // ---- Which Tally party is which ROMS vendor (one vote per linked PO)
  const ledgerVotes = {};
  for (const p of pos) {
    const inv = invoiceOf(p.po_id);
    if (!inv) continue;
    const v = ledgerVotes[p.vendor] || (ledgerVotes[p.vendor] = {});
    inc(v, `${inv.company} · ${inv.v.party || '(no party)'}${isInternal(inv.slug, inv.v.party) ? ' (internal)' : ''}`);
  }

  // ---- Flipkart / Amazon: transfers?
  const transfers = TRANSFER_VENDORS.map((vendor) => {
    const rows = pos.filter((p) => p.vendor === vendor);
    const linked = rows.map((p) => invoiceOf(p.po_id)).filter(Boolean);
    const types = {};
    for (const e of linked) inc(types, `${e.company} ${e.v.baseType}${e.v.type !== e.v.baseType ? ` (${e.v.type})` : ''}`);
    return {
      vendor,
      pos: rows.length,
      withBillNo: rows.filter((p) => !blank(p.bill_no)).length,
      linked: linked.length,
      internal: linked.filter((e) => isInternal(e.slug, e.v.party)).length,
      types,
    };
  });

  // ---- Stock items ↔ SKUs
  const skuExact = new Map(refs.products.map((p) => [exactKey(p.sku_code), p.sku_code]));
  const skuNorm = new Map(refs.products.map((p) => [normKey(p.sku_code), p.sku_code]));
  // Tally item names carry the marketplace's product code that ROMS's vendor
  // mapping holds: 'RMWB003001 ITEM CODE-10192283 PID-611318' → Blinkit
  // 10192283 → WB003. A code mapped to two SKUs is no evidence.
  const skuByVendorCode = new Map();
  for (const vc of refs.vendorCodes || []) {
    const k = compactKey(vc.vendor_item_code);
    if (k.length < 4 || !vc.sku_code) continue;
    skuByVendorCode.set(k, skuByVendorCode.has(k) && skuByVendorCode.get(k) !== vc.sku_code ? null : vc.sku_code);
  }
  const skuFromCodeIn = (name) => {
    const found = new Set(exactKey(name).split(/[^A-Z0-9]+/).map((t) => skuByVendorCode.get(t)).filter(Boolean));
    return found.size === 1 ? [...found][0] : null;
  };
  const itemToSku = new Map(); // `${slug}|${item}` → sku
  const stock = companies.map((c) => {
    const s = { company: codeOf(c.slug), items: 0, byName: 0, byAlias: 0, normalisedOnly: 0, byVendorCode: 0, unmatched: 0, unmatchedExamples: [] };
    for (const item of c.masters.stockItems || []) {
      s.items++;
      let sku = skuExact.get(exactKey(item.name));
      if (sku) s.byName++;
      else if ((sku = item.aliases.map((a) => skuExact.get(exactKey(a))).find(Boolean))) s.byAlias++;
      else if ((sku = skuNorm.get(normKey(item.name)) || item.aliases.map((a) => skuNorm.get(normKey(a))).find(Boolean))) s.normalisedOnly++;
      else if ((sku = skuFromCodeIn(item.name) || item.aliases.map(skuFromCodeIn).find(Boolean))) s.byVendorCode++;
      else { s.unmatched++; addExample(s.unmatchedExamples, item.name, 10); }
      if (sku) itemToSku.set(`${c.slug}|${item.name}`, sku);
    }
    return s;
  });
  const tallySkus = new Set([...itemToSku.values()].map(exactKey));
  const livePoIds = new Set(pos.map((p) => p.po_id));
  const liveLines = refs.lines.filter((l) => livePoIds.has(l.po_id));
  const skusOnPos = new Set(liveLines.map((l) => l.sku_code).filter(Boolean));
  const skuCoverage = {
    romsSkus: refs.products.length,
    skusOnLivePos: skusOnPos.size,
    onPosButNoTallyItem: [...skusOnPos].filter((s) => !tallySkus.has(exactKey(s))),
    poLinesWithoutSku: liveLines.filter((l) => !l.sku_code).length,
    poLines: liveLines.length,
  };

  // ---- Linked invoices: do SKUs and quantities line up?
  const linesByPo = new Map();
  for (const l of liveLines) {
    if (!linesByPo.has(l.po_id)) linesByPo.set(l.po_id, []);
    linesByPo.get(l.po_id).push(l);
  }
  const lineCheck = {
    checked: 0, allSkusOnInvoice: 0, someSkus: 0, noSkus: 0, qtyWithinPo: 0, qtyOverPo: 0, invoiceBeforePo: 0,
    invoiceLines: 0, linesWithSku: 0, linesSkuOnPo: 0, linesSameQty: 0, examples: { noSkus: [], over: [] },
  };
  for (const p of pos) {
    const inv = invoiceOf(p.po_id);
    const lines = linesByPo.get(p.po_id) || [];
    if (!inv || !lines.length || !inv.v.inventoryLines.length) continue;
    lineCheck.checked++;
    const poSkus = new Set(lines.map((l) => l.sku_code && exactKey(l.sku_code)).filter(Boolean));
    const invSkus = new Set(inv.v.inventoryLines.map((i) => itemToSku.get(`${inv.slug}|${i.item}`)).filter(Boolean).map(exactKey));
    for (const i of inv.v.inventoryLines) {
      lineCheck.invoiceLines++;
      const sku = itemToSku.get(`${inv.slug}|${i.item}`);
      if (!sku) continue;
      lineCheck.linesWithSku++;
      const onPo = lines.filter((l) => l.sku_code && exactKey(l.sku_code) === exactKey(sku));
      if (onPo.length) lineCheck.linesSkuOnPo++;
      if (onPo.some((l) => Number(l.qty) === Math.abs(i.qty || 0))) lineCheck.linesSameQty++;
    }
    const common = [...poSkus].filter((s) => invSkus.has(s)).length;
    if (poSkus.size && common === poSkus.size) lineCheck.allSkusOnInvoice++;
    else if (common) lineCheck.someSkus++;
    else { lineCheck.noSkus++; addExample(lineCheck.examples.noSkus, `${p.po_id} ↔ ${describe(inv)}`, 5); }
    const poQty = lines.reduce((n, l) => n + Number(l.qty || 0), 0);
    const invQty = inv.v.inventoryLines.reduce((n, i) => n + Math.abs(i.qty || 0), 0);
    if (invQty <= poQty) lineCheck.qtyWithinPo++;
    else { lineCheck.qtyOverPo++; addExample(lineCheck.examples.over, `${p.po_id}: PO ${poQty}, invoice ${invQty} (${describe(inv)})`, 5); }
    if (p.po_date && inv.v.date < p.po_date) lineCheck.invoiceBeforePo++;
  }

  // ---- What Bill No auto-fill would write: Tally's whole number, as it is,
  // over a typed serial ('607' → '607/RM/26-27') or into a blank.
  const fill = {
    typedBecomesWhole: 0, typedAlreadyWhole: 0, typedNeedsReview: 0,
    blankBill: 0, linkedOne: 0, linkedMany: 0, blockedByRule: 0, alreadyOnAnotherPo: 0,
    examples: { typed: [], review: [], blank: [] },
  };
  const voucherKey = (e) => `${e.slug}|${e.v.guid || `${e.v.type}|${e.v.number}|${e.v.date}`}`;
  const billedBy = new Map([...billLinks].map(([poId, e]) => [voucherKey(e), poId]));
  for (const p of pos) {
    const vs = orderLinks.get(p.po_id) || [];
    if (!blank(p.bill_no)) {
      // The Buyer's Order No says which invoice; the typed number has to be
      // a way of writing that invoice's number ('607', '0607', '607-RM-…').
      // If it fits none, or several, a person decides.
      let e = billLinks.get(p.po_id) || null;
      if (vs.length) {
        const fitting = vs.filter((x) => howTyped(p.bill_no, x.v.number) !== 'other');
        if (fitting.length !== 1) {
          fill.typedNeedsReview++;
          addExample(fill.examples.review, `${p.po_id} ${p.vendor} typed "${p.bill_no}", Buyer's Order No → ${vs.map(describe).join(' | ')}`, 6);
          continue;
        }
        [e] = fitting;
      }
      if (!e) continue;
      if (exactKey(p.bill_no) === exactKey(e.v.number)) fill.typedAlreadyWhole++;
      else {
        fill.typedBecomesWhole++;
        addExample(fill.examples.typed, `${p.po_id} "${p.bill_no}" → "${e.v.number}"`, 4);
      }
      continue;
    }
    fill.blankBill++;
    if (!vs.length) continue;
    if (vs.length > 1) { fill.linkedMany++; continue; }
    fill.linkedOne++;
    const e = vs[0];
    if (!ROMS_REF_RULE.test(e.v.number)) fill.blockedByRule++;
    const other = billedBy.get(voucherKey(e));
    if (other) fill.alreadyOnAnotherPo++;
    addExample(fill.examples.blank, `${p.po_id} ${p.vendor} "${p.vendor_po_id}" ← ${describe(e)}${other ? ` (already ${other}'s Bill No)` : ''}`, 6);
  }

  // Sales numbers ROMS's current rule would reject, across companies. RAMS
  // writes them unchanged, so the rule has to admit these characters.
  const salesLive = idx.live.filter((e) => e.v.baseType === 'Sales' && e.v.number);
  const rejected = salesLive.filter((e) => !ROMS_REF_RULE.test(e.v.number));
  const format = {
    salesNumbers: salesLive.length,
    failRule: rejected.length,
    characters: [...new Set(rejected.flatMap((e) => [...e.v.number].filter((ch) => !ROMS_REF_RULE.test(ch))))].sort(),
    example: rejected.length ? rejected[0].v.number : null,
  };

  const analysis = {
    generatedAt: new Date().toISOString(),
    probe: { dir: path.resolve(probeDir), tally: run.tally, from: run.from, to: run.to, companies: companies.map((c) => codeOf(c.slug)) },
    roms: { source: refs.source, generatedAt: refs.generatedAt, pos: refs.pos.length, livePos: pos.length, rtvRows: refs.rtv.length },
    coverage, warnings, format, bill, order, cn, discrepancy, rtvDn, ledgerVotes, transfers, stock, skuCoverage, lineCheck, fill,
    romsSide: summarizeRefs(refs),
  };
  return analysis;
}

// ---------------------------------------------------------------- report

const counts = (obj, n = 12) => (Object.keys(obj).length
  ? mdTable(['', 'Count'], top(obj, n))
  : '_none_');

function formatGate(f) {
  if (!f.failRule) return 'Every live Tally sales number already passes ROMS\'s Bill No / CN / DN rule.';
  const chars = f.characters.map((ch) => (ch === ' ' ? 'space' : `'${ch}'`)).join(', ');
  return `RAMS writes Tally's numbers as they are (e.g. ${f.example}). ${f.failRule} of ${f.salesNumbers} live Tally sales numbers (${pct(f.failRule, f.salesNumbers)}) contain ${chars}, which ROMS's Bill No / CN / DN rule rejects today — widen the rule before auto-fill is switched on.`;
}

function renderAnalysis(a) {
  const out = [];
  out.push('# RAMS Phase 0 — ROMS ↔ Tally analysis');
  out.push(`Tally probe: ${a.probe.dir} (${a.probe.companies.join(', ')}; ${a.probe.from} … ${a.probe.to}). ROMS: ${a.roms.source}, read ${a.roms.generatedAt}; ${a.roms.livePos} live POs (first ${a.coverage.firstPoDate || '—'}, last ${a.coverage.lastPoDate || '—'}), ${a.roms.rtvRows} RTV rows. Read-only on both sides.`);
  if (a.warnings.length) out.push(a.warnings.map((w) => `> ⚠ ${w}`).join('\n>\n'));

  const b = a.bill, o = a.order, c = a.cn, f = a.fill;
  const matched = Object.entries(b.outcome).filter(([k]) => k.startsWith('matched')).reduce((n, [, x]) => n + x, 0);
  out.push('## Decision gate');
  out.push([
    `1. **Tally's format in ROMS.** ${formatGate(a.format)}`,
    `2. **Buyer's Order No as the primary match.** Found ${o.found} of ${o.pos} live POs (${pct(o.found, o.pos)}) on a Tally sales invoice's Order Details. Where Bill No also matched, the two agree on ${o.agree} of ${o.bothMatched}${o.disagree ? ` — **${o.disagree} conflicts**` : ''}.${Object.keys(o.foundElsewhere).length ? ' Some PO numbers sit in other fields (below).' : ''} Months Tally has not been written up for yet show as gaps in the by-month table below.`,
    `3. **Bill No.** ${matched} of ${b.withBillNo} ROMS Bill Nos (${pct(matched, b.withBillNo)}) match one Tally sales invoice — ${matched - (b.outcomeBySerial || 0)} by the whole number, ${b.outcomeBySerial || 0} by its serial only (e.g. '607' for 607/RM/26-27); ${b.outcome.ambiguous || 0} ambiguous, ${b.outcome['only in another field'] || 0} only in another field, ${b.outcome['not found'] || 0} not found. Bill Date equals the invoice date on ${b.dateAgrees} of ${b.dateCompared}. On the next poll ${f.typedBecomesWhole} typed Bill Nos become Tally's whole number; ${f.typedNeedsReview} disagree with the Buyer's Order No and need a person.`,
    `4. **CN rule.** ${c.withCnAgainstInvoice} of ${c.invoiceLinked} invoice-linked RTV rows have a Tally credit note settling that invoice (Agst Ref)${c.multipleCn ? `, ${c.multipleCn} with more than one` : ''}. Of RTV rows with a typed CN number that also have one, the typed number is on that CN for ${c.typedEqualsAgstCn} and differs for ${c.typedDiffers}. Where typed CN numbers live in Tally is below — VOUCHERNUMBER means it is our CN number, REFERENCE means the marketplace's.`,
    `5. **Discrepancy / debit notes.** ${a.discrepancy.total} GRN Discrepancy Numbers: ${Object.entries(a.discrepancy.found).map(([k, n]) => `${k} ${n}`).join(', ') || '—'}. ${a.rtvDn.total} RTV DNs: ${Object.entries(a.rtvDn.found).map(([k, n]) => `${k} ${n}`).join(', ') || '—'}.`,
    `6. **Transfers.** ${a.transfers.map((t) => `${t.vendor}: ${t.linked} of ${t.withBillNo} bills linked, ${t.internal} to our own GSTINs`).join('; ')}.`,
  ].join('\n'));

  out.push('### Ledger map suggested by the links');
  out.push(mdTable(['ROMS vendor', 'Tally company · party ledger (POs linked)'], Object.entries(a.ledgerVotes).map(([v, votes]) => [v, top(votes, 4).map(([k, n]) => `${k} ×${n}`).join('<br>')])));

  out.push('## Auto-fill potential (nothing has been written)');
  out.push('Auto-fill writes Tally\'s numbers as they are.');
  out.push([
    `- **Builty Bill No, typed**: ${f.typedBecomesWhole} would be replaced by Tally's whole number, ${f.typedAlreadyWhole} already are it, ${f.typedNeedsReview} need a person (the typed number and the Buyer's Order No point at different invoices).`,
    f.examples.typed.length ? `  e.g. ${f.examples.typed.join('; ')}` : '',
    `- **Builty Bill No, blank**: ${f.blankBill} live POs have a blank Bill No; ${f.linkedOne} link to exactly one sales invoice by Buyer's Order No (${f.linkedMany} to several)${f.blockedByRule ? `; ${f.blockedByRule} of those numbers are blocked until ROMS's rule is widened` : ''}${f.alreadyOnAnotherPo ? `; ${f.alreadyOnAnotherPo} invoices are already another PO's Bill No` : ''}.`,
    f.examples.blank.length ? `  e.g. ${f.examples.blank.join('; ')}` : '',
    `- **RTV CN No**: ${c.fillable} RTV rows on the page with a blank CN have exactly one credit note against their invoice${c.fillableBlockedByFormat ? ` (${c.fillableBlockedByFormat} blocked by the format rule)` : ''}.`,
    c.examples.fillable.length ? `  e.g. ${c.examples.fillable.join('; ')}` : '',
  ].filter(Boolean).join('\n'));
  if (f.examples.review.length) out.push(`Bill Nos that need a person, e.g.:\n${f.examples.review.map((x) => `- ${x}`).join('\n')}`);

  out.push('## Bill No detail');
  out.push(mdTable(['Vendor', 'With Bill No', 'Matched', 'Ambiguous', 'Other field only', 'Not found', 'To our own GSTIN'],
    Object.entries(b.byVendor).map(([v, x]) => [v, x.withBillNo, x.matched, x.ambiguous, x.elsewhere, x.notFound, b.internalByVendor[v] || 0])));
  out.push('**Outcome** (a number on several vouchers is settled by the Bill Date, then by financial year)');
  out.push(counts(b.outcome));
  out.push('**How the matched numbers were typed in ROMS**');
  out.push(counts(b.typed));
  out.push('**Match strength** (exact / normalised: separators and leading zeros / compact: letters and digits only)');
  out.push(counts(b.byLevel));
  out.push('**Tally voucher types the bills matched**');
  out.push(counts(b.baseTypes));
  if (Object.keys(b.foundElsewhere).length) { out.push('**Bill Nos found only in another field**'); out.push(counts(b.foundElsewhere)); }
  for (const [label, list] of [['Ambiguous', b.examples.ambiguous], ['Other field only', b.examples.elsewhere], ['Not found', b.examples.notFound]]) {
    if (list.length) out.push(`${label}, e.g.:\n${list.map((x) => `- ${x}`).join('\n')}`);
  }

  out.push("## Buyer's Order No detail");
  out.push(mdTable(['Vendor', 'Live POs', 'Found on a sales invoice'], Object.entries(o.byVendor).map(([v, x]) => [v, x.pos, `${x.found} (${pct(x.found, x.pos)})`])));
  out.push('**By PO month** (a month Tally has not been written up for yet shows as a gap)');
  out.push(mdTable(['PO month', 'Live POs', 'Found on a sales invoice'], Object.entries(o.byMonth).sort(([x], [y]) => x.localeCompare(y)).map(([m, x]) => [m, x.pos, `${x.found} (${pct(x.found, x.pos)})`])));
  out.push('**How the PO number was found** (exact / normalised / compact as typed; label dropped: \'P4588464- Dry\' → P4588464; one of several numbers in one field)');
  out.push(counts(o.byLevel));
  out.push(`${o.multiVoucher} POs are on more than one sales invoice (split dispatch). ${o.narrationOnly} PO numbers appear only in a narration. ${o.notFound} are nowhere in Tally.`);
  if (Object.keys(o.foundElsewhere).length) { out.push('**PO numbers found outside the Order Details**'); out.push(counts(o.foundElsewhere)); }
  for (const [label, list] of [['Conflicts', o.examples.conflicts], ['Several invoices', o.examples.multi], ['Not found', o.examples.notFound]]) {
    if (list.length) out.push(`${label}, e.g.:\n${list.map((x) => `- ${x}`).join('\n')}`);
  }

  out.push('## Credit notes, discrepancy and debit notes');
  out.push(`RTV rows: ${c.rtvRows} (${c.onPage} on the page now, ${c.disposed} DN - Disposed), ${c.withCn} with a CN number.`);
  out.push('**Where typed RTV CN numbers are in Tally**');
  out.push(counts(c.cnWhere));
  out.push('**Where GRN Discrepancy Numbers are in Tally**');
  out.push(counts(a.discrepancy.where));
  out.push('**Where RTV DNs are in Tally**');
  out.push(counts(a.rtvDn.where));
  for (const [label, list] of [['CN not found', c.examples.notFound], ['Typed CN differs from the CN against the invoice', c.examples.differs], ['Discrepancy Number not found', a.discrepancy.notFound], ['RTV DN not found', a.rtvDn.notFound]]) {
    if (list.length) out.push(`${label}, e.g.:\n${list.map((x) => `- ${x}`).join('\n')}`);
  }

  out.push('## Transfers (Flipkart / Amazon)');
  out.push(mdTable(['Vendor', 'Live POs', 'With Bill No', 'Linked', 'To our own GSTIN', 'Vouchered as'],
    a.transfers.map((t) => [t.vendor, t.pos, t.withBillNo, t.linked, t.internal, top(t.types).map(([k, n]) => `${k} ×${n}`).join('<br>')])));

  out.push('## Stock items ↔ SKUs');
  out.push(mdTable(['Company', 'Stock items', 'Name = SKU', 'Alias = SKU', 'Only after normalising', 'Vendor code in name', 'No SKU', 'e.g. unmatched'],
    a.stock.map((s) => [s.company, s.items, s.byName, s.byAlias, s.normalisedOnly, s.byVendorCode, s.unmatched, s.unmatchedExamples.join(', ')])));
  out.push('"Vendor code in name": the item name carries a marketplace product code from ROMS\'s vendor mapping (e.g. RMWB003001 ITEM CODE-10192283 → Blinkit 10192283 → WB003).');
  const sc = a.skuCoverage;
  out.push(`ROMS has ${sc.romsSkus} SKUs, ${sc.skusOnLivePos} of them on live PO lines; ${sc.onPosButNoTallyItem.length} of those have no Tally stock item${sc.onPosButNoTallyItem.length ? ` (${sc.onPosButNoTallyItem.slice(0, 12).join(', ')})` : ''}. ${sc.poLinesWithoutSku} of ${sc.poLines} PO lines have no SKU mapping in ROMS.`);

  const l = a.lineCheck;
  out.push('## Linked invoices — sanity');
  out.push(`Checked ${l.checked} PO ↔ invoice pairs with lines on both sides: all PO SKUs on the invoice ${l.allSkusOnInvoice}, some ${l.someSkus}, none ${l.noSkus}. Invoice quantity within PO quantity ${l.qtyWithinPo}, over ${l.qtyOverPo}. Invoice dated before the PO: ${l.invoiceBeforePo}.`);
  out.push(`Line by line: ${l.invoiceLines} invoice lines, ${l.linesWithSku} with a SKU; that SKU is on the PO for ${l.linesSkuOnPo} (${pct(l.linesSkuOnPo, l.linesWithSku)}), with the same quantity for ${l.linesSameQty} (${pct(l.linesSameQty, l.linesWithSku)}).`);
  for (const [label, list] of [['No common SKU', l.examples.noSkus], ['Invoice quantity over PO', l.examples.over]]) {
    if (list.length) out.push(`${label}, e.g.:\n${list.map((x) => `- ${x}`).join('\n')}`);
  }

  out.push('## ROMS side (what staff typed)');
  out.push(renderRefsSummary(a.romsSide));
  return out.join('\n\n') + '\n';
}

function writeAnalysis(analysis, outDir) {
  writeJson(path.join(outDir, 'analysis.json'), analysis);
  fs.writeFileSync(path.join(outDir, 'analysis.md'), renderAnalysis(analysis));
}

module.exports = { analyze, renderAnalysis, writeAnalysis, pick, uniq };
