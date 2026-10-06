const fs = require('fs');
const path = require('path');
const { matchAll, countOutcomes } = require('../src/matching/engine');
const { DEFAULTS } = require('../src/services/matchSettings');

// Fixtures modelled on the Phase 0 findings (real MH/HR/WB data): invoice
// numbers NNN/RM/26-27, Buyer's Order No carrying the PO number, staff typing
// the serial as Bill No, credit notes settling the invoice by Agst Ref.
const MH = { id: 1, code: 'MH', gstin: '27ABGFR0562B1ZI' };
const HR = { id: 2, code: 'HR', gstin: '06ABGFR0562B1ZM' };

let n = 0;
const sale = (number, overrides = {}) => {
  n += 1;
  return {
    company_id: 1, guid: `g-${n}`, date: '2026-07-01', voucher_type: 'Sales', base_type: 'Sales', number,
    party: 'BLINK COMMERCE PVT LTD', is_cancelled: 0, is_optional: 0, total_paise: 118000,
    orders: [], items: [{ item: 'RMWB003001 ITEM CODE-10192283 PID-611318', qty: 10 }], agst_refs: [],
    ...overrides,
  };
};
const creditNote = (number, against, overrides = {}) => sale(number, {
  voucher_type: 'Credit Note', base_type: 'Credit Note', orders: [], items: [], agst_refs: [against], date: '2026-07-20', ...overrides,
});
const po = (po_id, overrides = {}) => ({
  po_id, vendor: 'Blinkit', vendor_po_id: null, po_date: '2026-06-28', status: 'Closed', bill_no: null, bill_date: null,
  dispatch_date: null, grn_status: null, discrepancy_qty: null, ...overrides,
});
const line = (po_id, overrides = {}) => ({ po_id, line_no: 1, item_code: '10192283', qty: 10, sku_code: 'WB003', ...overrides });

// Every code the engine produced across these tests, checked against
// reasons.js at the end (the page has a sentence for each one there).
const seen = { reason: new Set(), method: new Set(), how: new Set(), check: new Set() };
function record(out) {
  for (const r of out.results) {
    if (r.reason) seen.reason.add(`${r.target_kind}:${r.reason}`);
    if (r.method) seen.method.add(r.method);
    for (const h of r.detail.how || []) seen.how.add(h.code);
    for (const c of r.detail.checks || []) seen.check.add(c.code);
  }
  return out;
}

function run({ pos = [], vouchers = [], rtv = [], lines, settings = {}, decisions = [], partyMap = [], ledgers, vendors = [], today = '2026-07-15' }) {
  return record(matchAll({
    settings: { ...DEFAULTS, ...settings },
    pos,
    lines: lines || pos.map((p) => line(p.po_id)),
    rtv,
    products: [{ sku_code: 'WB003' }, { sku_code: 'BT001' }],
    vendorCodes: [{ vendor_item_code: '10192283', sku_code: 'WB003' }, { vendor_item_code: '55501234', sku_code: 'BT001' }],
    vouchers,
    stockItems: [
      { company_id: 1, name: 'RMWB003001 ITEM CODE-10192283 PID-611318', aliases: [] },
      { company_id: 1, name: 'BOTTLE ITEM CODE-55501234', aliases: [] },
      { company_id: 2, name: 'RMWB003001 ITEM CODE-10192283 PID-611318', aliases: [] },
    ],
    ledgers: ledgers || [
      { company_id: 1, guid: 'L1', name: 'BLINK COMMERCE PVT LTD', gstins: ['06AAICB1234C1Z5'] },
      { company_id: 1, guid: 'L2', name: 'ZEPTO PRIVATE LIMITED', gstins: ['29AAKCK1234C1Z1'] },
      { company_id: 1, guid: 'L3', name: 'Roymax (Haryana)', gstins: ['06ABGFR0562B1ZM'] },
    ],
    partyMap,
    vendors,
    decisions,
    companies: [MH, HR],
    today,
  }));
}
const result = (out, id, kind = 'po') => out.results.find((r) => r.target_kind === kind && r.target_id === String(id));

describe('finding the invoice for a PO', () => {
  test("the Buyer's Order No links a PO, and a typed serial is a form of the same invoice", () => {
    const inv = sale('607/RM/26-27', { orders: ['P4588464'] });
    const out = run({ pos: [po('B002', { vendor_po_id: 'P4588464', bill_no: '607' })], vouchers: [inv] });
    const r = result(out, 'B002');
    expect(r).toMatchObject({ outcome: 'linked', method: 'order_no', voucher_number: '607/RM/26-27', company_id: 1 });
    expect(r.fill).toEqual({ field: 'bill_no', current: '607', current_date: null, value: '607/RM/26-27', date: '2026-07-01', kind: 'replace' });
    expect(out.links).toEqual([{ target_kind: 'po', target_id: 'B002', role: 'invoice', company_id: 1, voucher_guid: inv.guid, method: 'order_no' }]);
  });

  test('a blank Bill No is filled, and one already in Tally\'s form needs nothing', () => {
    const a = sale('601/RM/26-27', { orders: ['P1'] });
    const b = sale('602/RM/26-27', { orders: ['P2'] });
    const out = run({ pos: [po('B1', { vendor_po_id: 'P1' }), po('B2', { vendor_po_id: 'P2', bill_no: '602/RM/26-27' })], vouchers: [a, b] });
    expect(result(out, 'B1').fill.kind).toBe('fill');
    expect(result(out, 'B2').fill.kind).toBe('same');
  });

  test("Zepto's label after a dash is dropped, and a field with two numbers matches each", () => {
    const z = sale('610/RM/26-27', { orders: ['P4588464'], party: 'ZEPTO PRIVATE LIMITED' });
    const s = sale('611/RM/26-27', { orders: ['PCHPO213987'] });
    const out = run({
      pos: [po('Z1', { vendor: 'Zepto', vendor_po_id: 'P4588464- Dry' }), po('S1', { vendor: 'Scootsy', vendor_po_id: 'PCHPO213987/PCHPO228901' })],
      vouchers: [z, s],
    });
    expect(result(out, 'Z1')).toMatchObject({ outcome: 'linked', method: 'order_no_label' });
    expect(result(out, 'S1')).toMatchObject({ outcome: 'linked', method: 'order_no_split' });

    const off = run({
      pos: [po('Z1', { vendor: 'Zepto', vendor_po_id: 'P4588464- Dry' }), po('S1', { vendor: 'Scootsy', vendor_po_id: 'PCHPO213987/PCHPO228901' })],
      vouchers: [z, s],
      settings: { order_no_drop_label: false, order_no_split: false },
    });
    expect(result(off, 'Z1')).toMatchObject({ outcome: 'waiting', reason: 'not_invoiced' });
    expect(result(off, 'S1').outcome).toBe('waiting');
  });

  test('a typed Bill No that is not a form of the invoice the order found needs a person (the S292 kind)', () => {
    const out = run({
      pos: [po('S292', { vendor_po_id: 'P9', bill_no: '1819' })],
      vouchers: [sale('1219/RM/26-27', { orders: ['P9'] }), sale('1819/RM/26-27')],
    });
    const r = result(out, 'S292');
    expect(r).toMatchObject({ outcome: 'review', reason: 'bill_differs', fill: null });
    expect(r.detail.params).toMatchObject({ typed: '1819', number: '1219/RM/26-27' });
    expect(r.detail.candidates.map((c) => c.number).sort()).toEqual(['1219/RM/26-27', '1819/RM/26-27']);
    expect(out.links).toEqual([]);
  });

  test('without a Buyer\'s Order No hit, the Bill No finds the invoice by its serial', () => {
    const out = run({ pos: [po('B9', { bill_no: '0607', bill_date: '2026-07-01' })], vouchers: [sale('607/RM/26-27')] });
    expect(result(out, 'B9')).toMatchObject({ outcome: 'linked', method: 'bill_serial', voucher_number: '607/RM/26-27' });

    const strict = run({ pos: [po('B9', { bill_no: '0607' })], vouchers: [sale('607/RM/26-27')], settings: { bill_no_serial: false } });
    expect(result(strict, 'B9').outcome).not.toBe('linked');

    const reviewed = run({ pos: [po('B9', { bill_no: '607' })], vouchers: [sale('607/RM/26-27')], settings: { bill_only_links: 'review' } });
    expect(result(reviewed, 'B9')).toMatchObject({ outcome: 'review', reason: 'bill_only' });
  });

  test('the same serial in two companies is ambiguous unless the Bill Date or the financial year settles it', () => {
    const mh = sale('607/RM/26-27', { date: '2026-07-01' });
    const hr = sale('607/RM/26-27', { company_id: 2, date: '2026-07-03' });
    const typed = { bill_no: '607' };
    expect(result(run({ pos: [po('A', typed)], vouchers: [mh, hr] }), 'A')).toMatchObject({ outcome: 'review', reason: 'ambiguous' });
    expect(result(run({ pos: [po('A', { ...typed, bill_date: '2026-07-03' })], vouchers: [mh, hr] }), 'A'))
      .toMatchObject({ outcome: 'linked', company_id: 2 });
    expect(result(run({ pos: [po('A', { ...typed, bill_date: '2026-07-03' })], vouchers: [mh, hr], settings: { pick_same_date: false } }), 'A').outcome)
      .toBe('review');

    // Series restart every April: last year's 607 is told apart by the FY.
    const old = sale('607/RM/25-26', { date: '2026-03-02' });
    expect(result(run({ pos: [po('A', { ...typed, bill_date: '2026-07-09' })], vouchers: [mh, old] }), 'A'))
      .toMatchObject({ outcome: 'linked', voucher_number: '607/RM/26-27' });
  });

  test('a PO on several invoices: the typed Bill No picks one, and the other invoice shows as a note (or holds it, if set)', () => {
    const a = sale('700/RM/26-27', { orders: ['P77'] });
    const b = sale('701/RM/26-27', { orders: ['P77'] });
    const noted = run({ pos: [po('M1', { vendor_po_id: 'P77', bill_no: '701' })], vouchers: [a, b] });
    expect(result(noted, 'M1')).toMatchObject({ outcome: 'linked', voucher_number: '701/RM/26-27' });
    expect(result(noted, 'M1').detail.notes).toEqual(['split']);
    expect(result(noted, 'M1').detail.checks.find((c) => c.code === 'split')).toMatchObject({ ok: false, level: 'note', params: { count: 2, others: ['700/RM/26-27'] } });
    const held = run({ pos: [po('M1', { vendor_po_id: 'P77', bill_no: '701' })], vouchers: [a, b], settings: { check_split: 'review' } });
    expect(result(held, 'M1')).toMatchObject({ outcome: 'review', reason: 'check_split', voucher_number: '701/RM/26-27' });
    const blank = run({ pos: [po('M1', { vendor_po_id: 'P77' })], vouchers: [a, b] });
    expect(result(blank, 'M1')).toMatchObject({ outcome: 'review', reason: 'several_invoices' });
  });

  test('re-invoiced after a full credit note: a second ROMS row takes the new invoice, and the first is no split', () => {
    const first = sale('808/RM/26-27', { orders: ['P4957920'], date: '2026-07-16' });
    const again = sale('1036/RM/26-27', { orders: ['P4957920'], date: '2026-08-21' });
    const out = run({
      pos: [po('Z024', { vendor: 'Zepto', vendor_po_id: 'P4957920', bill_no: '808' }), po('Z057', { vendor: 'Zepto', vendor_po_id: 'P4957920 - Dry' })],
      vouchers: [first, again],
      today: '2026-09-01',
    });
    expect(result(out, 'Z024')).toMatchObject({ outcome: 'linked', voucher_number: '808/RM/26-27' });
    expect(result(out, 'Z024').detail.notes).toEqual([]);
    expect(result(out, 'Z057')).toMatchObject({ outcome: 'linked', voucher_number: '1036/RM/26-27' });
  });

  test('two ROMS rows for one marketplace PO (a re-dispatch): each Bill No claims its own invoice, so neither is a split', () => {
    const first = sale('759/RM/26-27', { orders: ['JCEPO183656'] });
    const again = sale('981/RM/26-27', { orders: ['JCEPO183656'] });
    const out = run({
      pos: [
        po('S101', { vendor: 'Scootsy', vendor_po_id: 'JCEPO183656', bill_no: '759' }),
        po('S234', { vendor: 'Scootsy', vendor_po_id: 'JCEPO183656 - DN', bill_no: '981' }),
        po('S235', { vendor: 'Scootsy', vendor_po_id: 'JCEPO183656 - DN' }),
      ],
      vouchers: [first, again],
    });
    expect(result(out, 'S101')).toMatchObject({ outcome: 'linked', voucher_number: '759/RM/26-27' });
    expect(result(out, 'S234')).toMatchObject({ outcome: 'linked', voucher_number: '981/RM/26-27' });
    expect(result(out, 'S234').detail.notes).toEqual([]);
    // A third row with no Bill No: both invoices are claimed, so a person decides.
    expect(result(out, 'S235')).toMatchObject({ outcome: 'review', reason: 'several_invoices' });

    // With one invoice left unclaimed, a row with no Bill No takes it.
    const third = sale('990/RM/26-27', { orders: ['JCEPO183656'] });
    const out2 = run({
      pos: [
        po('S101', { vendor: 'Scootsy', vendor_po_id: 'JCEPO183656', bill_no: '759' }),
        po('S234', { vendor: 'Scootsy', vendor_po_id: 'JCEPO183656 - DN', bill_no: '981' }),
        po('S235', { vendor: 'Scootsy', vendor_po_id: 'JCEPO183656 - DN' }),
      ],
      vouchers: [first, again, third],
    });
    expect(result(out2, 'S235')).toMatchObject({ outcome: 'linked', voucher_number: '990/RM/26-27' });
    expect(result(out2, 'S235').detail.how).toContainEqual({ code: 'others_claimed', params: { count: 2, pos: ['S101', 'S234'] } });
  });

  test('nothing in Tally yet: waiting, and a typed Bill No still missing after the grace days needs a person', () => {
    const out = run({ pos: [po('W1', { vendor_po_id: 'P5' }), po('W2', { bill_no: '999', bill_date: '2026-07-10' })], today: '2026-07-15' });
    expect(result(out, 'W1')).toMatchObject({ outcome: 'waiting', reason: 'not_invoiced' });
    expect(result(out, 'W2')).toMatchObject({ outcome: 'waiting', reason: 'bill_waiting' });
    expect(result(out, 'W2').detail.params.until).toBe('2026-07-17');
    const later = run({ pos: [po('W2', { bill_no: '999', bill_date: '2026-07-10' })], today: '2026-07-18' });
    expect(result(later, 'W2')).toMatchObject({ outcome: 'review', reason: 'bill_not_in_tally' });
  });

  test('cancelled, optional and left-out voucher types never count; deleted POs are not listed', () => {
    const out = run({
      pos: [po('C1', { vendor_po_id: 'P1' }), po('C2', { vendor_po_id: 'P2' }), po('C3', { vendor_po_id: 'P3' }), po('D1', { status: 'Deleted', vendor_po_id: 'P4' })],
      vouchers: [
        sale('1/RM/26-27', { orders: ['P1'], is_cancelled: 1 }),
        sale('2/RM/26-27', { orders: ['P2'], is_optional: 1 }),
        sale('3/RM/26-27', { orders: ['P3'], voucher_type: 'B2c Sales' }),
        sale('4/RM/26-27', { orders: ['P4'] }),
      ],
      settings: { excluded_voucher_types: ['B2C SALES'] },
    });
    for (const id of ['C1', 'C2', 'C3']) expect(result(out, id).outcome).toBe('waiting');
    expect(result(out, 'D1')).toBeUndefined();
  });

  test('vendors set to stock transfer or skip are not matched', () => {
    const out = run({
      pos: [po('F1', { vendor: 'Flipkart', vendor_po_id: 'P1' }), po('X1', { vendor: 'Other', vendor_po_id: 'P1' })],
      vouchers: [sale('1/RM/26-27', { orders: ['P1'] })],
      vendors: [{ vendor: 'Flipkart', mode: 'transfer' }, { vendor: 'Other', mode: 'skip' }],
    });
    expect(result(out, 'F1')).toMatchObject({ outcome: 'not_matched', reason: 'vendor_transfer' });
    expect(result(out, 'X1')).toMatchObject({ outcome: 'not_matched', reason: 'vendor_skip' });
  });

  test('how strictly numbers must agree', () => {
    const inv = sale('RM/26-27/012', { orders: ['ZPO-778812'] });
    const loose = run({ pos: [po('N1', { vendor_po_id: 'zpo778812' })], vouchers: [inv] });
    expect(result(loose, 'N1').outcome).toBe('linked');
    const normal = run({ pos: [po('N1', { vendor_po_id: 'zpo778812' })], vouchers: [inv], settings: { number_strength: 'normalised' } });
    expect(result(normal, 'N1').outcome).toBe('waiting');
    const exact = run({ pos: [po('N1', { vendor_po_id: 'zpo-778812' })], vouchers: [inv], settings: { number_strength: 'exact' } });
    expect(result(exact, 'N1').outcome).toBe('linked');
  });
});

describe('the checks on a link', () => {
  test('no SKU in common holds the link for a person; quantity and date only add notes by default', () => {
    const inv = sale('800/RM/26-27', { orders: ['P8'], date: '2026-06-20', items: [{ item: 'BOTTLE ITEM CODE-55501234', qty: 12 }] });
    const out = run({ pos: [po('K1', { vendor_po_id: 'P8' })], vouchers: [inv] });
    const r = result(out, 'K1');
    expect(r).toMatchObject({ outcome: 'review', reason: 'check_sku', voucher_number: '800/RM/26-27', fill: null });
    expect(r.detail.checks.filter((c) => !c.ok).map((c) => c.code)).toEqual(['sku', 'qty', 'date']);

    const notes = run({ pos: [po('K1', { vendor_po_id: 'P8' })], vouchers: [inv], settings: { check_sku: 'note' } });
    expect(result(notes, 'K1')).toMatchObject({ outcome: 'linked' });
    expect(result(notes, 'K1').detail.notes).toEqual(['sku', 'qty', 'date']);

    const tolerant = run({
      pos: [po('K1', { vendor_po_id: 'P8' })], vouchers: [inv],
      settings: { check_sku: 'off', qty_tolerance_pct: 20, date_tolerance_days: 10, check_qty: 'review', check_date: 'review' },
    });
    expect(result(tolerant, 'K1')).toMatchObject({ outcome: 'linked' });
    expect(result(tolerant, 'K1').detail.notes).toEqual([]);
  });

  test("a party ledger mapped to another marketplace, or to our own registration (by GSTIN), holds the link", () => {
    const inv = sale('900/RM/26-27', { orders: ['P90'], party: 'ZEPTO PRIVATE LIMITED' });
    const mapped = run({
      pos: [po('Q1', { vendor_po_id: 'P90' })], vouchers: [inv],
      partyMap: [{ company_id: 1, ledger_guid: 'L2', kind: 'vendor', vendor: 'Zepto', source: 'person' }],
    });
    expect(result(mapped, 'Q1')).toMatchObject({ outcome: 'review', reason: 'check_party' });
    expect(result(mapped, 'Q1').detail.params).toMatchObject({ ledger: 'ZEPTO PRIVATE LIMITED', vendor: 'Zepto', po_vendor: 'Blinkit' });

    // A suggestion alone is not a mapping.
    const suggested = run({
      pos: [po('Q1', { vendor_po_id: 'P90' })], vouchers: [inv],
      partyMap: [{ company_id: 1, ledger_guid: 'L2', kind: null, suggested_vendor: 'Zepto', source: null }],
    });
    expect(result(suggested, 'Q1').outcome).toBe('linked');

    const internal = run({ pos: [po('Q2', { vendor_po_id: 'P91' })], vouchers: [sale('901/RM/26-27', { orders: ['P91'], party: 'Roymax (Haryana)' })] });
    expect(result(internal, 'Q2')).toMatchObject({ outcome: 'review', reason: 'check_party' });
    expect(result(internal, 'Q2').detail.params.kind).toBe('internal');
    expect(internal.internal).toEqual([{ company_id: 1, ledger_guid: 'L3' }]);
  });

  test('the same invoice on two POs holds both (the re-issued PO kind)', () => {
    const inv = sale('758/RM/26-27', { orders: ['P100'] });
    const out = run({ pos: [po('S100', { vendor_po_id: 'P100', bill_no: '758' }), po('S101', { vendor_po_id: 'P100' })], vouchers: [inv] });
    expect(result(out, 'S100')).toMatchObject({ outcome: 'review', reason: 'check_reused' });
    expect(result(out, 'S100').detail.params.other_pos).toEqual(['S101']);
    expect(result(out, 'S101')).toMatchObject({ outcome: 'review', reason: 'check_reused' });
  });

  test('party-ledger suggestions come from the links', () => {
    const out = run({
      pos: [po('V1', { vendor_po_id: 'P1' }), po('V2', { vendor_po_id: 'P2' })],
      vouchers: [sale('1/RM/26-27', { orders: ['P1'] }), sale('2/RM/26-27', { orders: ['P2'] })],
    });
    expect(out.suggestions).toEqual([{ company_id: 1, ledger_guid: 'L1', vendor: 'Blinkit', votes: 2, top_votes: 2 }]);
  });
});

describe("a person's decision wins", () => {
  test('a confirmed invoice stays linked whatever the rules say, with its checks as notes', () => {
    const a = sale('1219/RM/26-27', { orders: ['P9'] });
    const b = sale('1819/RM/26-27', { items: [{ item: 'BOTTLE ITEM CODE-55501234', qty: 10 }] });
    const decisions = [{ target_kind: 'po', target_id: 'S292', company_id: 1, voucher_guid: b.guid, status: 'confirmed', decided_by_name: 'Keshav', decided_at: '2026-07-14 10:00:00' }];
    const out = run({ pos: [po('S292', { vendor_po_id: 'P9', bill_no: '1819' })], vouchers: [a, b], decisions, settings: { use_order_no: false } });
    const r = result(out, 'S292');
    expect(r).toMatchObject({ outcome: 'linked', method: 'person', voucher_number: '1819/RM/26-27' });
    expect(r.detail.person).toMatchObject({ status: 'confirmed', by: 'Keshav' });
    expect(r.detail.notes).toEqual(['sku']);
    expect(r.fill.kind).toBe('replace');
  });

  test('a rejected invoice is never proposed again', () => {
    const a = sale('607/RM/26-27', { orders: ['P1'] });
    const decisions = [{ target_kind: 'po', target_id: 'R1', company_id: 1, voucher_guid: a.guid, status: 'rejected' }];
    const out = run({ pos: [po('R1', { vendor_po_id: 'P1' })], vouchers: [a], decisions });
    expect(result(out, 'R1')).toMatchObject({ outcome: 'review', reason: 'rejected_all' });
    expect(out.links).toEqual([]);
  });

  test('a person may link a PO whose Bill No is not a form of the invoice: auto-fill calls that "differs", never "replace"', () => {
    // The S292 kind: staff typed 1819, the order is on 1219, a person confirmed 1219.
    const a = sale('1219/RM/26-27', { orders: ['P9'] });
    const decisions = [{ target_kind: 'po', target_id: 'S292', company_id: 1, voucher_guid: a.guid, status: 'confirmed' }];
    const out = run({ pos: [po('S292', { vendor_po_id: 'P9', bill_no: '1819', bill_date: '2026-09-02' })], vouchers: [a, sale('1819/RM/26-27')], decisions });
    expect(result(out, 'S292')).toMatchObject({ outcome: 'linked', method: 'person', voucher_number: '1219/RM/26-27' });
    expect(result(out, 'S292').fill).toEqual({
      field: 'bill_no', current: '1819', current_date: '2026-09-02', value: '1219/RM/26-27', date: '2026-07-01', kind: 'differs',
    });
  });

  test('a confirmed invoice deleted in Tally is flagged', () => {
    const decisions = [{ target_kind: 'po', target_id: 'G1', company_id: 1, voucher_guid: 'gone', status: 'confirmed' }];
    expect(result(run({ pos: [po('G1')], decisions }), 'G1')).toMatchObject({ outcome: 'review', reason: 'confirmed_gone' });
  });
});

describe('RTV rows and credit notes', () => {
  const onPage = { grn_status: 'Returned to Vendor' };

  test('the one credit note settling the invoice (Agst Ref) links the RTV row', () => {
    const inv = sale('607/RM/26-27', { orders: ['P1'] });
    const cn = creditNote('835', '607/RM/26-27');
    const out = run({ pos: [po('B1', { vendor_po_id: 'P1', ...onPage })], vouchers: [inv, cn], rtv: [{ id: 11, po_id: 'B1', rtv_no: 'RTV-11' }] });
    const r = result(out, 11, 'rtv');
    expect(r).toMatchObject({ outcome: 'linked', method: 'agst_ref', voucher_number: '835', po_id: 'B1' });
    expect(r.fill).toEqual({ field: 'cn_number', current: null, current_date: null, value: '835', date: '2026-07-20', kind: 'fill' });
    expect(out.links).toContainEqual({ target_kind: 'rtv', target_id: '11', role: 'credit_note', company_id: 1, voucher_guid: cn.guid, method: 'agst_ref' });

    const off = run({ pos: [po('B1', { vendor_po_id: 'P1', ...onPage })], vouchers: [inv, cn], rtv: [{ id: 11, po_id: 'B1' }], settings: { cn_agst_ref: false } });
    expect(result(off, 11, 'rtv')).toMatchObject({ outcome: 'waiting', reason: 'no_cn_yet' });
  });

  test('a typed CN No is found by number; one that differs from the note against the invoice needs a person', () => {
    const inv = sale('607/RM/26-27', { orders: ['P1'] });
    const cn = creditNote('835', '607/RM/26-27');
    const typed = run({ pos: [po('B1', { vendor_po_id: 'P1', ...onPage })], vouchers: [inv, cn], rtv: [{ id: 12, po_id: 'B1', cn_number: '835' }] });
    expect(result(typed, 12, 'rtv')).toMatchObject({ outcome: 'linked', method: 'cn_number_agst_ref' });
    expect(result(typed, 12, 'rtv').fill.kind).toBe('same');

    const differs = run({ pos: [po('B1', { vendor_po_id: 'P1', ...onPage })], vouchers: [inv, cn], rtv: [{ id: 13, po_id: 'B1', cn_number: '999' }] });
    expect(result(differs, 13, 'rtv')).toMatchObject({ outcome: 'review', reason: 'cn_differs' });
    expect(result(differs, 13, 'rtv').detail.params).toMatchObject({ typed: '999', number: '835' });
  });

  test('what auto-fill would write for a CN: a typed form is replaced, a different number only after a person', () => {
    const inv = sale('607/RM/26-27', { orders: ['P1'] });
    const cn = creditNote('835', '607/RM/26-27');
    const form = run({ pos: [po('B1', { vendor_po_id: 'P1', ...onPage })], vouchers: [inv, cn], rtv: [{ id: 14, po_id: 'B1', cn_number: '0835', cn_date: '2026-07-21' }] });
    expect(result(form, 14, 'rtv')).toMatchObject({ outcome: 'linked' });
    expect(result(form, 14, 'rtv').fill).toEqual({
      field: 'cn_number', current: '0835', current_date: '2026-07-21', value: '835', date: '2026-07-20', kind: 'replace',
    });

    const decisions = [{ target_kind: 'rtv', target_id: '15', company_id: 1, voucher_guid: cn.guid, status: 'confirmed' }];
    const person = run({ pos: [po('B1', { vendor_po_id: 'P1', ...onPage })], vouchers: [inv, cn], rtv: [{ id: 15, po_id: 'B1', cn_number: '999' }], decisions });
    expect(result(person, 15, 'rtv')).toMatchObject({ outcome: 'linked', method: 'person' });
    expect(result(person, 15, 'rtv').fill.kind).toBe('differs');
  });

  test('a Bill No already as in Tally is "same", and the fill still carries both dates', () => {
    const inv = sale('607/RM/26-27', { orders: ['P1'], date: '2026-07-11' });
    const out = run({ pos: [po('B1', { vendor_po_id: 'P1', bill_no: '607/RM/26-27', bill_date: '2026-07-13' })], vouchers: [inv] });
    expect(result(out, 'B1').fill).toEqual({
      field: 'bill_no', current: '607/RM/26-27', current_date: '2026-07-13', value: '607/RM/26-27', date: '2026-07-11', kind: 'same',
    });
  });

  test('several credit notes, a PO still unlinked, and rows ROMS cannot fill', () => {
    const inv = sale('607/RM/26-27', { orders: ['P1'] });
    const out = run({
      pos: [
        po('B1', { vendor_po_id: 'P1', ...onPage }),
        po('B2', { vendor_po_id: 'P2', ...onPage }),
        po('B3', { vendor_po_id: 'P1x' }),
      ],
      vouchers: [inv, creditNote('835', '607/RM/26-27'), creditNote('836', '607/RM/26-27')],
      rtv: [
        { id: 21, po_id: 'B1' },
        { id: 22, po_id: 'B2' },
        { id: 23, po_id: 'B3' },
        { id: 24, po_id: 'B1', status: 'DN - Disposed' },
      ],
    });
    expect(result(out, 21, 'rtv')).toMatchObject({ outcome: 'review', reason: 'several_cns' });
    expect(result(out, 22, 'rtv')).toMatchObject({ outcome: 'waiting', reason: 'po_not_linked' });
    expect(result(out, 23, 'rtv')).toMatchObject({ outcome: 'not_matched', reason: 'rtv_off_page' });
    expect(result(out, 24, 'rtv')).toMatchObject({ outcome: 'not_matched', reason: 'rtv_disposed' });
  });

  test('counts per outcome', () => {
    const out = run({ pos: [po('A1', { vendor_po_id: 'P1' }), po('A2')], vouchers: [sale('1/RM/26-27', { orders: ['P1'] })] });
    expect(countOutcomes(out.results)).toEqual({ po: { linked: 1, review: 0, waiting: 1, not_matched: 0 } });
  });
});

test("the backend's docno.js is the Connector's, unchanged", () => {
  const agentCopy = path.resolve(__dirname, '../../agent/src/docno.js');
  if (!fs.existsSync(agentCopy)) return;
  expect(fs.readFileSync(path.resolve(__dirname, '../src/matching/docno.js'), 'utf8')).toBe(fs.readFileSync(agentCopy, 'utf8'));
});

test('every code the engine used is in reasons.js, which the page words', () => {
  const { REASONS, METHODS, HOW, CHECKS } = require('../src/matching/reasons');
  for (const code of seen.reason) {
    const [kind, reason] = code.split(':');
    expect(REASONS[kind]).toContain(reason);
  }
  for (const m of seen.method) expect(METHODS).toContain(m);
  for (const h of seen.how) expect(HOW).toContain(h);
  for (const c of seen.check) expect(CHECKS).toContain(c);
  expect(seen.reason.size).toBeGreaterThan(15);
});
