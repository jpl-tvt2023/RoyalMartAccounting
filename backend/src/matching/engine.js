// The matching engine: ROMS POs -> Tally sales invoices, ROMS RTV rows -> Tally
// credit notes. Pure -- plain data in, plain data out -- so the same function
// runs a real match, previews a rule change, and is tested on fixtures.
//
// Ported from the Phase 0 analyzer (agent/src/analyze/index.js: findOrder,
// findBill, pick), with each step behind a setting (migration 012). A person's
// decision always wins: a confirmed link stands, a rejected one is never
// proposed again.
//
// Every PO and RTV row gets one outcome:
//   linked       one Tally voucher, and nothing a check holds back
//   review       a person decides (reason says why)
//   waiting      nothing in Tally yet -- normal for a PO not invoiced yet
//   not_matched  out of scope (vendor setting, RTV row ROMS can't fill)
// and, when linked, what auto-fill (M6) would write.
const {
  DocIndex, exactKey, normKey, compactKey, splitRefs, serialOf, withoutLabel, howTyped,
} = require('./docno');

const STRENGTHS = ['exact', 'normalised', 'compact'];
const RETURNED_TO_VENDOR = 'Returned to Vendor';
const DN_DISPOSED = 'DN - Disposed';
// Checks in the order their reasons are reported.
const CHECKS = ['party', 'sku', 'split', 'reused', 'qty', 'date'];

const text = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const panOf = (gstin) => (/^\d{2}[A-Z0-9]{10}/i.test(gstin || '') ? String(gstin).slice(2, 12).toUpperCase() : null);
const keyOf = (companyId, guid) => `${companyId}|${guid}`;

function fyOf(isoDate) {
  const m = /^(\d{4})-(\d{2})/.exec(isoDate || '');
  if (!m) return null;
  return Number(m[2]) >= 4 ? Number(m[1]) : Number(m[1]) - 1;
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// How a typed value relates to a Tally number, by strength: howTyped's
// wording (docno.js) mapped to the loosest strength it needs.
const TYPED_STRENGTH = {
  'as in Tally': 'exact',
  'case differs': 'exact',
  "'/' typed as '-'": 'normalised',
  'separators or leading zeros differ': 'normalised',
  "'/' left out": 'compact',
  'all separators left out': 'compact',
  'serial only': 'serial',
  'serial only, leading zeros differ': 'serial',
};

function matchAll(input) {
  const {
    settings: s, pos = [], lines = [], rtv = [], products = [], vendorCodes = [], vouchers = [], stockItems = [],
    ledgers = [], partyMap = [], vendors = [], decisions = [], companies = [], today,
  } = input;
  const strength = s.number_strength;
  const within = (level) => level && STRENGTHS.indexOf(level) <= STRENGTHS.indexOf(strength);
  const findAt = (index, value) => {
    const hit = index.find(value);
    return within(hit.level) ? hit : { level: null, entries: [] };
  };
  const companyCode = new Map(companies.map((c) => [Number(c.id), c.code]));
  const vendorMode = new Map(vendors.map((v) => [v.vendor, v.mode]));

  // ------------------------------------------------------------ Tally side
  const excluded = new Set((s.excluded_voucher_types || []).map((t) => exactKey(t)));
  const live = vouchers.filter((v) => !v.is_cancelled && !v.is_optional && !excluded.has(exactKey(v.voucher_type)));
  const invoice = (v) => ({
    key: keyOf(v.company_id, v.guid),
    company_id: Number(v.company_id),
    company: companyCode.get(Number(v.company_id)) || String(v.company_id),
    guid: v.guid,
    number: v.number || '',
    date: v.date,
    party: v.party || '',
    voucher_type: v.voucher_type,
    total_paise: v.total_paise ?? null,
    items: v.items || [],
    orders: v.orders || [],
    agstRefs: v.agst_refs || [],
  });
  const sales = live.filter((v) => v.base_type === 'Sales').map(invoice);
  const notes = live.filter((v) => v.base_type === 'Credit Note').map(invoice);
  const byKey = new Map([...sales, ...notes].map((v) => [v.key, v]));

  const salesByNumber = new DocIndex();
  const salesBySerial = new DocIndex();
  const byOrder = new DocIndex();
  for (const v of sales) {
    if (v.number) {
      salesByNumber.add(v.number, v);
      if (serialOf(v.number)) salesBySerial.add(serialOf(v.number), v);
    }
    for (const o of v.orders) for (const one of splitRefs(o)) byOrder.add(one, v);
  }
  const notesByNumber = new DocIndex();
  const notesAgainst = new Map(); // `${company}|${bill}` -> credit notes settling that bill
  for (const n of notes) {
    if (n.number) notesByNumber.add(n.number, n);
    for (const bill of n.agstRefs) {
      const k = `${n.company_id}|${exactKey(bill)}`;
      if (!notesAgainst.has(k)) notesAgainst.set(k, []);
      notesAgainst.get(k).push(n);
    }
  }

  // Party ledgers: name -> ledger per company, and what each one is.
  const ledgerByName = new Map(ledgers.map((l) => [`${l.company_id}|${String(l.name).toLowerCase()}`, l]));
  const ourPans = new Set(companies.map((c) => panOf(c.gstin)).filter(Boolean));
  const personMap = new Map(partyMap.filter((m) => m.source === 'person').map((m) => [keyOf(m.company_id, m.ledger_guid), m]));
  const internalByGstin = new Set(ledgers
    .filter((l) => (l.gstins || []).some((g) => ourPans.has(panOf(g))))
    .map((l) => keyOf(l.company_id, l.guid)));
  const ledgerOf = (v) => ledgerByName.get(`${v.company_id}|${v.party.toLowerCase()}`) || null;
  const mappingOf = (v) => {
    const l = ledgerOf(v);
    if (!l) return null;
    const k = keyOf(l.company_id, l.guid);
    if (personMap.has(k)) return { ...personMap.get(k), ledger: l.name };
    if (internalByGstin.has(k)) return { kind: 'internal', source: 'gstin', ledger: l.name };
    return null;
  };

  // SKU per stock item: its name or an alias is a SKU, else it carries a
  // marketplace code ROMS maps to exactly one SKU ('... ITEM CODE-10192283').
  const skuExact = new Map(products.filter((p) => p.sku_code).map((p) => [exactKey(p.sku_code), p.sku_code]));
  const skuNorm = new Map(products.filter((p) => p.sku_code).map((p) => [normKey(p.sku_code), p.sku_code]));
  const skuByCode = new Map();
  for (const vc of vendorCodes) {
    const k = compactKey(vc.vendor_item_code);
    if (k.length < 4 || !vc.sku_code) continue;
    skuByCode.set(k, skuByCode.has(k) && skuByCode.get(k) !== vc.sku_code ? null : vc.sku_code);
  }
  const skuInName = (name) => {
    const found = new Set(exactKey(name).split(/[^A-Z0-9]+/).map((t) => skuByCode.get(t)).filter(Boolean));
    return found.size === 1 ? [...found][0] : null;
  };
  const itemSku = new Map();
  for (const it of stockItems) {
    const names = [it.name, ...(it.aliases || [])];
    const sku = names.map((n) => skuExact.get(exactKey(n))).find(Boolean)
      || names.map((n) => skuNorm.get(normKey(n))).find(Boolean)
      || names.map(skuInName).find(Boolean)
      || null;
    if (sku) itemSku.set(`${it.company_id}|${exactKey(it.name)}`, sku);
  }
  const skuOf = (companyId, item) => itemSku.get(`${companyId}|${exactKey(item)}`) || null;

  // ------------------------------------------------------------ ROMS side
  const posById = new Map(pos.map((p) => [p.po_id, p]));
  const linesByPo = new Map();
  for (const l of lines) {
    if (!linesByPo.has(l.po_id)) linesByPo.set(l.po_id, []);
    linesByPo.get(l.po_id).push(l);
  }
  const decided = new Map(); // `${kind}|${id}` -> { confirmed: [], rejected: Set }
  for (const d of decisions) {
    const k = `${d.target_kind}|${d.target_id}`;
    if (!decided.has(k)) decided.set(k, { confirmed: [], rejected: new Set() });
    if (d.status === 'confirmed') decided.get(k).confirmed.push(d);
    if (d.status === 'rejected') decided.get(k).rejected.add(keyOf(d.company_id, d.voucher_guid));
  }
  const decisionsFor = (kind, id) => decided.get(`${kind}|${id}`) || { confirmed: [], rejected: new Set() };

  const uniq = (entries) => [...new Map(entries.map((e) => [e.key, e])).values()];
  const candidate = (v, via) => ({
    company_id: v.company_id, company: v.company, guid: v.guid, number: v.number, date: v.date,
    party: v.party, voucher_type: v.voucher_type, total_paise: v.total_paise, via,
  });

  function findOrder(value) {
    const direct = findAt(byOrder, value);
    if (direct.level) return { method: 'order_no', level: direct.level, entries: direct.entries, used: value };
    if (s.order_no_drop_label) {
      const bare = withoutLabel(value);
      if (bare) {
        const hit = findAt(byOrder, bare);
        if (hit.level) return { method: 'order_no_label', level: hit.level, entries: hit.entries, used: bare };
      }
    }
    if (s.order_no_split) {
      const parts = String(value).split('/').map((p) => p.trim()).filter(Boolean);
      if (parts.length > 1) {
        const entries = parts.flatMap((p) => findAt(byOrder, (s.order_no_drop_label && withoutLabel(p)) || p).entries);
        if (entries.length) return { method: 'order_no_split', level: null, entries, used: parts.join(', ') };
      }
    }
    return null;
  }

  // A typed Bill No: the invoice's whole number, else (digits only) its serial.
  function findBill(typed) {
    const whole = findAt(salesByNumber, typed);
    if (whole.level) return { method: 'bill_no', level: whole.level, entries: whole.entries };
    if (s.bill_no_serial && /^\d+$/.test(typed)) {
      const serial = salesBySerial.find(typed);
      if (serial.level) return { method: 'bill_serial', level: 'serial', entries: serial.entries };
    }
    return null;
  }

  // Is the typed Bill No a way of writing this invoice's number?
  function fits(typed, number) {
    const level = TYPED_STRENGTH[howTyped(typed, number)];
    if (!level) return false;
    if (level === 'serial') return Boolean(s.bill_no_serial);
    return within(level);
  }

  function pick(cands, date) {
    if (cands.length === 1) return { chosen: cands[0], by: 'unique' };
    if (date && s.pick_same_date) {
      const sameDay = cands.filter((c) => c.date === date);
      if (sameDay.length === 1) return { chosen: sameDay[0], by: 'same_date' };
    }
    if (date && s.pick_same_fy) {
      const sameFy = cands.filter((c) => fyOf(c.date) === fyOf(date));
      if (sameFy.length === 1) return { chosen: sameFy[0], by: 'same_fy' };
    }
    return { chosen: null, by: 'ambiguous' };
  }

  const fillOf = (field, current, v) => {
    const cur = text(current);
    const kind = !cur ? 'fill' : cur === v.number ? 'same' : 'replace';
    return { field, current: cur, value: v.number, date: v.date, kind };
  };

  // The checks on a linked invoice. Each returns null (passes or can't tell)
  // or { code, params }.
  function runChecks(p, chosen, { otherInvoices = [] }) {
    const out = [];
    const add = (code, params) => out.push({ code, params });
    for (const v of chosen) {
      const m = mappingOf(v);
      if (m && (m.kind !== 'vendor' || m.vendor !== p.vendor)) {
        add('party', { ledger: m.ledger, kind: m.kind, vendor: m.vendor || null, po_vendor: p.vendor });
        break;
      }
    }
    const poLines = linesByPo.get(p.po_id) || [];
    const poSkus = new Set(poLines.map((l) => l.sku_code && exactKey(l.sku_code)).filter(Boolean));
    const invItems = chosen.flatMap((v) => v.items.map((i) => ({ ...i, company_id: v.company_id })));
    const invSkus = new Set(invItems.map((i) => skuOf(i.company_id, i.item)).filter(Boolean).map(exactKey));
    if (poSkus.size && invSkus.size && ![...poSkus].some((k) => invSkus.has(k))) {
      add('sku', { po_skus: [...poSkus].slice(0, 5), invoice_skus: [...invSkus].slice(0, 5) });
    }
    if (otherInvoices.length) add('split', { count: otherInvoices.length + chosen.length, others: otherInvoices.slice(0, 5) });
    const poQty = poLines.reduce((n, l) => n + Number(l.qty || 0), 0);
    const invQty = invItems.reduce((n, i) => n + Math.abs(Number(i.qty || 0)), 0);
    if (poQty > 0 && invQty > poQty * (1 + Number(s.qty_tolerance_pct || 0) / 100)) add('qty', { po_qty: poQty, invoice_qty: invQty });
    const earliest = chosen.map((v) => v.date).sort()[0];
    if (p.po_date && earliest && earliest < addDays(p.po_date, -Number(s.date_tolerance_days || 0))) {
      add('date', { po_date: p.po_date, invoice_date: earliest });
    }
    return out;
  }

  const results = [];
  const links = [];
  const poResult = new Map();

  function settle(p, chosen, method, extra = {}) {
    const result = {
      target_kind: 'po', target_id: p.po_id, po_id: p.po_id, vendor: p.vendor,
      outcome: 'linked', reason: null, method,
      company_id: chosen[0].company_id, voucher_guid: chosen[0].guid, voucher_number: chosen[0].number, voucher_date: chosen[0].date,
      detail: { how: extra.how || [], checks: [], notes: [], candidates: extra.candidates || chosen.map((v) => candidate(v, [method])), person: extra.person || null },
      fill: chosen.length === 1 ? fillOf('bill_no', p.bill_no, chosen[0]) : null,
      chosen,
      byPerson: Boolean(extra.person),
      orderCands: extra.orderCands || [],
    };
    return result;
  }

  function open(p, outcome, reason, params, extra = {}) {
    return {
      target_kind: 'po', target_id: p.po_id, po_id: p.po_id, vendor: p.vendor,
      outcome, reason, method: extra.method || null,
      company_id: extra.company_id ?? null, voucher_guid: null, voucher_number: null, voucher_date: null,
      detail: { how: extra.how || [], params: params || {}, checks: [], notes: [], candidates: extra.candidates || [], person: null },
      fill: null,
      chosen: [],
    };
  }

  // ------------------------------------------------------------ POs
  // First what each PO's numbers find, then who claims what: ROMS sometimes
  // has two rows for one marketplace PO (a re-dispatch, 'JCEPO183656 - DN'),
  // and each row's Bill No claims its own invoice. An invoice another PO
  // claims -- by a fitting Bill No or a person's decision -- is not counted
  // as a second invoice for the rest.
  const plans = [];
  const claimedBy = new Map(); // voucher key -> po_id
  for (const p of pos) {
    if (p.status === 'Deleted') continue;
    const mode = vendorMode.get(p.vendor) || 'match';
    if (mode !== 'match') {
      plans.push({ p, mode });
      continue;
    }
    const { confirmed, rejected } = decisionsFor('po', p.po_id);
    const typed = text(p.bill_no);
    const keep = (e) => !rejected.has(e.key);
    const orderHit = s.use_order_no && text(p.vendor_po_id) ? findOrder(text(p.vendor_po_id)) : null;
    const orderAll = orderHit ? uniq(orderHit.entries) : [];
    const orderCands = orderAll.filter(keep);
    const billHit = s.use_bill_no && typed ? findBill(typed) : null;
    const billAll = billHit ? uniq(billHit.entries) : [];
    const billCands = billAll.filter(keep);
    plans.push({ p, mode, confirmed, typed, orderHit, orderAll, orderCands, billHit, billAll, billCands });
    const claims = confirmed.length
      ? confirmed.map((d) => keyOf(d.company_id, d.voucher_guid))
      : typed ? orderCands.filter((v) => fits(typed, v.number)).map((v) => v.key) : [];
    if (claims.length === 1 || confirmed.length) for (const k of claims) if (!claimedBy.has(k)) claimedBy.set(k, p.po_id);
  }

  for (const plan of plans) {
    const { p, mode } = plan;
    if (mode !== 'match') {
      const r = open(p, 'not_matched', mode === 'transfer' ? 'vendor_transfer' : 'vendor_skip', { vendor: p.vendor });
      results.push(r);
      poResult.set(p.po_id, r);
      continue;
    }
    const {
      confirmed, typed, orderHit, orderAll, orderCands, billHit, billAll, billCands,
    } = plan;
    // The order's invoices this PO can have: not one another PO claims.
    const ownOrder = orderCands.filter((v) => !claimedBy.has(v.key) || claimedBy.get(v.key) === p.po_id);
    const how = [];
    if (orderHit) how.push({ code: orderHit.method, params: { value: p.vendor_po_id, used: orderHit.used, level: orderHit.level, count: orderAll.length } });
    if (billHit) how.push({ code: billHit.method, params: { typed, level: billHit.level, count: billAll.length } });
    const allCands = uniq([...orderCands, ...billCands]).map((v) => candidate(v, [
      ...(orderCands.includes(v) ? [orderHit.method] : []), ...(billCands.includes(v) ? [billHit.method] : []),
    ]));

    let r;
    if (confirmed.length) {
      const chosen = confirmed.map((d) => byKey.get(keyOf(d.company_id, d.voucher_guid))).filter(Boolean);
      if (chosen.length === confirmed.length) {
        r = settle(p, chosen, 'person', {
          how, candidates: allCands, orderCands,
          person: { status: 'confirmed', by: confirmed[0].decided_by_name || null, at: confirmed[0].decided_at || null },
        });
      } else {
        r = open(p, 'review', 'confirmed_gone', { count: confirmed.length - chosen.length }, { how, candidates: allCands });
      }
    } else if (orderCands.length === 1) {
      const [v] = orderCands;
      if (!typed || fits(typed, v.number)) {
        r = settle(p, [v], orderHit.method, { how, candidates: allCands, orderCands });
      } else {
        r = open(p, 'review', 'bill_differs', { typed, number: v.number, company: v.company }, { how, candidates: allCands, method: orderHit.method });
      }
    } else if (orderCands.length > 1) {
      const fitting = typed ? orderCands.filter((v) => fits(typed, v.number)) : [];
      if (orderCands.length > ownOrder.length) {
        how.push({ code: 'others_claimed', params: { count: orderCands.length - ownOrder.length, pos: [...new Set(orderCands.map((v) => claimedBy.get(v.key)).filter((id) => id && id !== p.po_id))] } });
      }
      if (fitting.length === 1) {
        r = settle(p, fitting, orderHit.method, { how, candidates: allCands, orderCands });
      } else if (!typed && ownOrder.length === 1) {
        r = settle(p, ownOrder, orderHit.method, { how, candidates: allCands, orderCands });
      } else {
        r = open(p, 'review', 'several_invoices', { count: ownOrder.length || orderCands.length, typed }, { how, candidates: allCands, method: orderHit.method });
      }
    } else if (billCands.length) {
      const choice = pick(billCands, text(p.bill_date) || text(p.dispatch_date) || text(p.po_date));
      if (choice.chosen) {
        how.push({ code: `pick_${choice.by}`, params: { count: billCands.length } });
        r = settle(p, [choice.chosen], billHit.method, { how, candidates: allCands });
        if (s.bill_only_links === 'review') {
          r = { ...open(p, 'review', 'bill_only', { typed, number: choice.chosen.number }, { how, candidates: allCands, method: billHit.method }) };
        }
      } else {
        r = open(p, 'review', 'ambiguous', { typed, count: billCands.length }, { how, candidates: allCands, method: billHit.method });
      }
    } else if (orderAll.length || billAll.length) {
      r = open(p, 'review', 'rejected_all', { count: uniq([...orderAll, ...billAll]).length }, { how, candidates: [] });
    } else if (typed) {
      const from = text(p.bill_date) || text(p.dispatch_date) || text(p.po_date) || today;
      const until = addDays(from, Number(s.grace_days || 0));
      r = today > until
        ? open(p, 'review', 'bill_not_in_tally', { typed, since: from, days: Number(s.grace_days || 0) }, { how })
        : open(p, 'waiting', 'bill_waiting', { typed, until }, { how });
    } else {
      r = open(p, 'waiting', 'not_invoiced', { vendor_po_id: text(p.vendor_po_id) }, { how });
    }
    results.push(r);
    poResult.set(p.po_id, r);
  }

  // The same invoice linked to several POs.
  const posByVoucher = new Map();
  for (const r of results) {
    if (r.outcome !== 'linked') continue;
    for (const v of r.chosen) {
      if (!posByVoucher.has(v.key)) posByVoucher.set(v.key, []);
      posByVoucher.get(v.key).push(r.po_id);
    }
  }

  // Checks: notes, or held for a person, by their setting. A person's own
  // link is never held back -- its checks show as notes. A PO is split when
  // its order number is also on an invoice no other PO ended up with.
  for (const r of results) {
    if (r.outcome !== 'linked') continue;
    const p = posById.get(r.po_id);
    const mine = new Set(r.chosen.map((v) => v.key));
    const otherInvoices = r.orderCands
      .filter((v) => !mine.has(v.key) && !(posByVoucher.get(v.key) || []).some((id) => id !== r.po_id))
      .map((v) => v.number);
    const failed = runChecks(p, r.chosen, { otherInvoices });
    const others = [...new Set(r.chosen.flatMap((v) => posByVoucher.get(v.key) || []))].filter((id) => id !== r.po_id);
    if (others.length) failed.push({ code: 'reused', params: { other_pos: others.slice(0, 5) } });
    failed.sort((a, b) => CHECKS.indexOf(a.code) - CHECKS.indexOf(b.code));
    const levelOf = (code) => s[`check_${code}`] || 'off';
    for (const c of CHECKS) {
      if (levelOf(c) === 'off') continue;
      const f = failed.find((x) => x.code === c);
      r.detail.checks.push({ code: c, ok: !f, level: levelOf(c), params: f ? f.params : {} });
    }
    const counted = failed.filter((f) => levelOf(f.code) !== 'off');
    r.detail.notes = counted.filter((f) => r.byPerson || levelOf(f.code) === 'note').map((f) => f.code);
    const held = r.byPerson ? null : counted.find((f) => levelOf(f.code) === 'review');
    if (held) {
      r.outcome = 'review';
      r.reason = `check_${held.code}`;
      r.detail.params = held.params;
      r.fill = null;
    }
  }

  for (const r of results) {
    // The links: what the run found (auto) or a person settled. One a check
    // held back is only a candidate until a person confirms it.
    if (r.outcome === 'linked') {
      for (const v of r.chosen) {
        links.push({ target_kind: 'po', target_id: r.po_id, role: 'invoice', company_id: v.company_id, voucher_guid: v.guid, method: r.method });
      }
    }
  }

  // ------------------------------------------------------------ RTV rows
  const rtvByPo = new Map();
  for (const row of rtv) {
    if (!rtvByPo.has(row.po_id)) rtvByPo.set(row.po_id, []);
    rtvByPo.get(row.po_id).push(row);
  }
  for (const [poId, rows] of rtvByPo) {
    const p = posById.get(poId);
    const base = (row) => ({
      target_kind: 'rtv', target_id: String(row.id), po_id: poId, vendor: p ? p.vendor : null,
      outcome: null, reason: null, method: null, company_id: null, voucher_guid: null, voucher_number: null,
      voucher_date: null, detail: { how: [], params: { rtv_no: row.rtv_no }, checks: [], notes: [], candidates: [], person: null }, fill: null,
    });
    const onPage = p && p.status !== 'Deleted'
      && (p.grn_status === RETURNED_TO_VENDOR || Number(p.discrepancy_qty || 0) > 0);
    const mode = p ? vendorMode.get(p.vendor) || 'match' : 'match';
    const poRes = poResult.get(poId);
    const invoices = poRes && poRes.outcome === 'linked' ? poRes.chosen : [];
    const against = s.cn_agst_ref
      ? uniq(invoices.flatMap((v) => notesAgainst.get(`${v.company_id}|${exactKey(v.number)}`) || []))
      : [];
    const used = new Set();
    const pending = [];
    for (const row of rows) {
      const r = base(row);
      const { confirmed, rejected } = decisionsFor('rtv', String(row.id));
      const free = against.filter((n) => !rejected.has(n.key));
      r.detail.candidates = free.map((n) => candidate(n, ['agst_ref']));
      const link = (n, method, extra = {}) => {
        Object.assign(r, {
          outcome: 'linked', method, company_id: n.company_id, voucher_guid: n.guid, voucher_number: n.number, voucher_date: n.date,
          fill: fillOf('cn_number', row.cn_number, n),
        });
        Object.assign(r.detail, extra);
        used.add(n.key);
        links.push({ target_kind: 'rtv', target_id: String(row.id), role: 'credit_note', company_id: n.company_id, voucher_guid: n.guid, method });
      };
      if (!p || p.status === 'Deleted' || mode !== 'match') {
        Object.assign(r, { outcome: 'not_matched', reason: mode === 'transfer' ? 'vendor_transfer' : mode === 'skip' ? 'vendor_skip' : 'po_deleted' });
      } else if (row.status === DN_DISPOSED) {
        Object.assign(r, { outcome: 'not_matched', reason: 'rtv_disposed' });
      } else if (!onPage) {
        Object.assign(r, { outcome: 'not_matched', reason: 'rtv_off_page' });
      } else if (confirmed.length) {
        const n = byKey.get(keyOf(confirmed[0].company_id, confirmed[0].voucher_guid));
        if (n) link(n, 'person', { person: { status: 'confirmed', by: confirmed[0].decided_by_name || null, at: confirmed[0].decided_at || null } });
        else Object.assign(r, { outcome: 'review', reason: 'confirmed_gone' });
      } else if (text(row.cn_number)) {
        const typed = text(row.cn_number);
        const hit = s.cn_number ? findAt(notesByNumber, typed) : { level: null, entries: [] };
        const found = uniq(hit.entries).filter((n) => !rejected.has(n.key));
        const sameCompany = invoices.length ? found.filter((n) => invoices.some((v) => v.company_id === n.company_id)) : found;
        const chosen = sameCompany.length === 1 ? sameCompany[0] : found.length === 1 ? found[0] : null;
        if (chosen) {
          link(chosen, free.some((n) => n.key === chosen.key) ? 'cn_number_agst_ref' : 'cn_number', { how: [{ code: 'cn_number', params: { typed } }] });
        } else if (found.length > 1) {
          Object.assign(r, { outcome: 'review', reason: 'cn_ambiguous', detail: { ...r.detail, params: { ...r.detail.params, typed, count: found.length }, candidates: found.map((n) => candidate(n, ['cn_number'])) } });
        } else if (free.length === 1) {
          Object.assign(r, { outcome: 'review', reason: 'cn_differs', detail: { ...r.detail, params: { ...r.detail.params, typed, number: free[0].number } } });
        } else {
          const from = text(row.cn_date) || today;
          const until = addDays(from, Number(s.grace_days || 0));
          Object.assign(r, today > until
            ? { outcome: 'review', reason: 'cn_not_in_tally', detail: { ...r.detail, params: { ...r.detail.params, typed, since: from } } }
            : { outcome: 'waiting', reason: 'cn_waiting', detail: { ...r.detail, params: { ...r.detail.params, typed, until } } });
        }
      } else {
        pending.push({ row, r, free });
      }
      results.push(r);
    }
    // Rows with no CN No typed share what is left of the credit notes against
    // the invoice: one row and one note pair up, anything else is a person's.
    for (const { r, free } of pending) {
      const left = free.filter((n) => !used.has(n.key));
      r.detail.candidates = left.map((n) => candidate(n, ['agst_ref']));
      if (!invoices.length) {
        Object.assign(r, { outcome: 'waiting', reason: poRes && poRes.outcome === 'review' ? 'po_needs_review' : 'po_not_linked' });
      } else if (!left.length) {
        Object.assign(r, { outcome: 'waiting', reason: 'no_cn_yet', detail: { ...r.detail, params: { ...r.detail.params, invoice: invoices[0].number } } });
      } else if (left.length === 1 && pending.length === 1) {
        Object.assign(r, { outcome: 'linked', method: 'agst_ref', company_id: left[0].company_id, voucher_guid: left[0].guid, voucher_number: left[0].number, voucher_date: left[0].date, fill: fillOf('cn_number', null, left[0]) });
        r.detail.how = [{ code: 'agst_ref', params: { invoice: invoices[0].number } }];
        links.push({ target_kind: 'rtv', target_id: r.target_id, role: 'credit_note', company_id: left[0].company_id, voucher_guid: left[0].guid, method: 'agst_ref' });
      } else {
        Object.assign(r, { outcome: 'review', reason: 'several_cns', detail: { ...r.detail, params: { ...r.detail.params, count: left.length, rows: pending.length } } });
      }
    }
  }

  // ------------------------------------------------------------ suggestions
  // Which marketplace each party ledger belongs to, by the POs linked through it.
  const votes = new Map();
  for (const r of results) {
    if (r.target_kind !== 'po' || r.outcome !== 'linked') continue;
    for (const v of r.chosen) {
      const l = ledgerOf(v);
      if (!l) continue;
      const k = keyOf(l.company_id, l.guid);
      if (!votes.has(k)) votes.set(k, { company_id: Number(l.company_id), ledger_guid: l.guid, counts: {} });
      const c = votes.get(k).counts;
      c[r.vendor] = (c[r.vendor] || 0) + 1;
    }
  }
  const suggestions = [...votes.values()].map((x) => {
    const [vendor, n] = Object.entries(x.counts).sort((a, b) => b[1] - a[1])[0];
    return { company_id: x.company_id, ledger_guid: x.ledger_guid, vendor, votes: Object.values(x.counts).reduce((a, b) => a + b, 0), top_votes: n };
  });
  const internal = [...internalByGstin].map((k) => {
    const [companyId, ...guid] = k.split('|');
    return { company_id: Number(companyId), ledger_guid: guid.join('|') };
  });

  return {
    results: results.map(({ chosen, byPerson, orderCands, ...r }) => r),
    links,
    suggestions,
    internal,
  };
}

// Counts per outcome, for summaries and previews.
function countOutcomes(results) {
  const out = {};
  for (const r of results) {
    const k = r.target_kind;
    out[k] = out[k] || { linked: 0, review: 0, waiting: 0, not_matched: 0 };
    out[k][r.outcome] += 1;
  }
  return out;
}

module.exports = { matchAll, countOutcomes, fyOf, addDays, panOf, CHECKS };
