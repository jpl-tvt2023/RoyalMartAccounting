// Synthetic books for the mock Tally — three companies shaped like Roymax's
// MH / HR / WB setup — plus matching ROMS references. NOTHING HERE IS REAL
// DATA; only Roymax's own GSTINs are real, because the internal-party rule
// keys on their PAN.
//
// Every row is planted to exercise one Phase 0 path:
//   RM/26-27/001  MH and HR both use it (cross-company collision); ROMS Z001
//                 typed it 'RM-26-27-001' and the Bill Date picks MH
//   RM/26-27/010  MH and HR, same day → genuinely ambiguous by number; the
//                 Buyer's Order No (ZPO-778840) still finds MH
//   Z/001         repeats across financial years; Bill Date picks FY 26-27
//   RM/26-27/006  ROMS typed 'RM2627006' (compact); its PO no is in REFERENCE
//   RM/26-27/004  ROMS Bill No blank, Buyer's Order No links it → fillable
//   BT/26-27/001  Branch Transfer to an internal ledger (Flipkart row)
//   CN/26-27/001  Agst Ref RM/26-27/001, RTV CN blank → fillable
//   CN/26-27/002  ROMS RTV typed 'CN-26-27-002'
//   DN/26-27/001  carries GRN Discrepancy Number ZDN-4410 in REFERENCE
//   612/RM/26-27  the real MH shape: ROMS Z009 typed just the serial ('0612'),
//                 holds the PO as 'ZPO-778860- Dry', and the item is named
//                 with Zepto's product code
const GSTIN = { MH: '27ABGFR0562B1ZI', HR: '06ABGFR0562B1ZM', WB: '19ABGFR0562B1ZF' };

const NAMES = {
  MH: 'Roymax Products LLP - MH',
  HR: 'Roymax Products LLP - HR',
  WB: 'Roymax Products LLP - WB',
};

const GROUPS = [
  ['Current Assets', 'Primary', 'Current Assets'],
  ['Current Liabilities', 'Primary', 'Current Liabilities'],
  ['Sales Accounts', 'Primary', 'Sales Accounts'],
  ['Purchase Accounts', 'Primary', 'Purchase Accounts'],
  ['Indirect Expenses', 'Primary', 'Indirect Expenses'],
  ['Branch / Divisions', 'Primary', 'Branch / Divisions'],
  ['Sundry Debtors', 'Current Assets', 'Sundry Debtors'],
  ['Sundry Creditors', 'Current Liabilities', 'Sundry Creditors'],
  ['Duties & Taxes', 'Current Liabilities', 'Duties & Taxes'],
  ['Bank Accounts', 'Current Assets', 'Bank Accounts'],
  ['Marketplaces', 'Sundry Debtors', ''],
].map(([name, parent, reserved]) => ({ name, parent, reserved }));

const RESERVED_TYPES = ['Sales', 'Purchase', 'Receipt', 'Payment', 'Journal', 'Contra', 'Credit Note', 'Debit Note', 'Delivery Note', 'Stock Journal']
  .map((name) => ({ name, parent: name, reserved: name }));

// Named the way the accountant really names items: SKU-ish prefix plus the
// marketplace's product code (here Zepto 50012345 → RMB-YEL-01 in ROMS).
const YELLOW = 'RMBYEL01001 ITEM CODE-50012345 PID-77';

const STOCK_ITEMS = [
  { name: 'RMB-RED-01', parent: 'Bandanas', hsn: '6214' },
  { name: 'RMB-BLU-01', parent: 'Bandanas', hsn: '6214' },
  { name: 'Bandana Green', aliases: ['RMB-GRN-01'], parent: 'Bandanas', hsn: '6214' },
  { name: 'RMS-BLK-L', parent: 'Full Socks', hsn: '6115' },
  { name: 'rmh-wht-6p', parent: 'Handkerchiefs', hsn: '6213' },
  { name: 'Bandana Mix Old', parent: 'Bandanas' },
  { name: YELLOW, parent: 'Bandanas', hsn: '6214' },
];

const COMMON_LEDGERS = [
  { name: 'Sales GST 5%', parent: 'Sales Accounts' },
  { name: 'Sales Returns', parent: 'Sales Accounts' },
  { name: 'Purchase GST', parent: 'Purchase Accounts' },
  { name: 'Output CGST', parent: 'Duties & Taxes' },
  { name: 'Output SGST', parent: 'Duties & Taxes' },
  { name: 'Output IGST', parent: 'Duties & Taxes' },
  { name: 'Input IGST', parent: 'Duties & Taxes' },
  { name: 'HDFC Bank', parent: 'Bank Accounts' },
  { name: 'TDS Receivable', parent: 'Current Assets' },
  { name: 'Shortage & Discrepancy', parent: 'Indirect Expenses' },
];

const round2 = (n) => Math.round(n * 100) / 100;

// A GST invoice (sales, sales return, or purchase): inventory lines plus the
// party and tax ledger lines, signed the way Tally exports them (negative =
// debit).
function invoice({
  kind = 'sale', type, date, number, party, items, tax = 'intra', orders = [], reference = '', narration = '',
  bills = null, cancelled = false,
}) {
  const sign = kind === 'sale' ? 1 : -1; // returns and purchases run the other way
  const taxable = round2(items.reduce((n, i) => n + i.qty * i.rate, 0));
  const gst = round2(taxable * 0.05);
  const total = round2(taxable + gst);
  const prefix = kind === 'purchase' ? 'Input' : 'Output';
  const taxLines = tax === 'intra'
    ? [{ ledger: `${prefix} CGST`, amount: sign * gst / 2 }, { ledger: `${prefix} SGST`, amount: sign * gst / 2 }]
    : [{ ledger: `${prefix} IGST`, amount: sign * gst }];
  const itemLedger = { sale: 'Sales GST 5%', return: 'Sales Returns', purchase: 'Purchase GST' }[kind];
  return {
    view: 'invoice', type, date, number, party, orders, reference, narration, cancelled,
    items: items.map((i) => ({ ...i, amount: round2(sign * i.qty * i.rate), ledger: itemLedger, inward: kind !== 'sale' })),
    ledgerLines: cancelled ? [] : [
      { ledger: party, amount: -sign * total, party: true, bills: bills || [{ name: number, type: 'New Ref', amount: -sign * total }] },
      ...taxLines,
    ],
  };
}

// An accounting-view voucher with explicit ledger lines.
const accounting = ({ type, date, number, party = '', reference = '', narration = '', lines }) => ({
  view: 'accounting', type, date, number, party, reference, narration, orders: [], items: [], ledgerLines: lines, cancelled: false,
});

function buildDataset() {
  const ZEPTO = 'Kiranakart Technologies Pvt Ltd (Zepto)';
  const INSTAMART = 'Scootsy Logistics Pvt Ltd';
  const NOW = 'Cocoblu Retail Ltd';
  const HR_BRANCH = 'Roymax Haryana Branch';
  const FLIPKART = 'Flipkart India Pvt Ltd';
  const ZEPTO_WB = 'Kiranakart Technologies Pvt Ltd (Zepto) WB';

  const mh = {
    code: 'MH', name: NAMES.MH, gstin: GSTIN.MH, state: 'Maharashtra', booksFrom: '2025-04-01', ledgerStyle: 'tp3',
    groups: GROUPS,
    voucherTypes: [...RESERVED_TYPES, { name: 'Sales-Zepto', parent: 'Sales', reserved: '' }, { name: 'Branch Transfer', parent: 'Sales', reserved: '' }],
    stockItems: STOCK_ITEMS,
    ledgers: [
      ...COMMON_LEDGERS,
      { name: ZEPTO, parent: 'Marketplaces', gstin: '27AAJCK8213B1Z5', state: 'Maharashtra' },
      { name: INSTAMART, parent: 'Marketplaces', gstin: '27AAICS4785M1ZW', state: 'Maharashtra' },
      { name: NOW, parent: 'Sundry Debtors', gstin: '27AAGCC9876D1ZQ', state: 'Maharashtra' },
      { name: HR_BRANCH, parent: 'Branch / Divisions', gstin: GSTIN.HR, state: 'Haryana' }, // internal by PAN
      { name: NAMES.WB, parent: 'Branch / Divisions' }, // internal by name only
    ],
    vouchers: [
      invoice({ type: 'Sales', date: '2026-04-05', number: 'RM/26-27/001', party: ZEPTO, orders: [{ no: 'ZPO-778812', date: '2026-04-02' }], items: [{ item: 'RMB-RED-01', qty: 100, rate: 50 }, { item: 'RMB-BLU-01', qty: 50, rate: 50 }] }),
      invoice({ type: 'Sales-Zepto', date: '2026-04-10', number: 'RM/26-27/002', party: ZEPTO, orders: [{ no: 'ZPO-778813', date: '2026-04-08' }], items: [{ item: 'Bandana Green', qty: 40, rate: 55 }] }),
      invoice({ type: 'Sales', date: '2026-04-12', number: 'RM/26-27/003', party: INSTAMART, orders: [{ no: '1301234567', date: '2026-04-10' }], items: [{ item: 'RMS-BLK-L', qty: 30, rate: 80 }] }),
      invoice({ type: 'Sales', date: '2026-05-02', number: 'RM/26-27/004', party: NOW, orders: [{ no: 'NOW-55501', date: '2026-04-28' }], items: [{ item: 'rmh-wht-6p', qty: 20, rate: 120 }] }),
      invoice({ type: 'Branch Transfer', date: '2026-05-05', number: 'BT/26-27/001', party: HR_BRANCH, tax: 'inter', narration: 'Stock transfer for Flipkart PO FK-PO-1', items: [{ item: 'RMB-RED-01', qty: 200, rate: 45 }] }),
      accounting({
        type: 'Credit Note', date: '2026-05-20', number: 'CN/26-27/001', party: ZEPTO, reference: 'ZCN-9981',
        lines: [
          { ledger: ZEPTO, amount: 262.5, party: true, bills: [{ name: 'RM/26-27/001', type: 'Agst Ref', amount: 262.5 }] },
          { ledger: 'Shortage & Discrepancy', amount: -250 },
          { ledger: 'Output CGST', amount: -6.25 },
          { ledger: 'Output SGST', amount: -6.25 },
        ],
      }),
      invoice({ kind: 'return', type: 'Credit Note', date: '2026-05-25', number: 'CN/26-27/002', party: INSTAMART, items: [{ item: 'RMS-BLK-L', qty: 30, rate: 80 }], bills: [{ name: 'RM/26-27/003', type: 'Agst Ref', amount: 2520 }] }),
      accounting({
        type: 'Debit Note', date: '2026-05-22', number: 'DN/26-27/001', party: ZEPTO, reference: 'ZDN-4410',
        lines: [
          { ledger: ZEPTO, amount: -100, party: true, bills: [{ name: 'DN/26-27/001', type: 'New Ref', amount: -100 }] },
          { ledger: 'Shortage & Discrepancy', amount: 100 },
        ],
      }),
      accounting({
        type: 'Receipt', date: '2026-06-01', number: '1', party: ZEPTO,
        lines: [
          { ledger: ZEPTO, amount: 7000, party: true, bills: [{ name: 'RM/26-27/001', type: 'Agst Ref', amount: 5000 }, { name: 'RM/26-27/002', type: 'Agst Ref', amount: 2000 }] },
          { ledger: 'HDFC Bank', amount: -7000 },
        ],
      }),
      accounting({
        type: 'Journal', date: '2026-06-01', number: '1', narration: 'TDS 194Q',
        lines: [
          { ledger: 'TDS Receivable', amount: -7.5 },
          { ledger: ZEPTO, amount: 7.5, party: true, bills: [{ name: 'RM/26-27/001', type: 'Agst Ref', amount: 7.5 }] },
        ],
      }),
      invoice({ type: 'Sales', date: '2026-06-02', number: 'RM/26-27/005', party: ZEPTO, items: [{ item: 'RMB-RED-01', qty: 1, rate: 50 }], cancelled: true }),
      invoice({ type: 'Sales', date: '2026-06-02', number: 'RM/26-27/006', party: ZEPTO, reference: 'ZPO-778820', items: [{ item: 'RMB-BLU-01', qty: 10, rate: 50 }] }),
      invoice({ type: 'Sales', date: '2026-03-15', number: 'Z/001', party: ZEPTO, orders: [{ no: 'ZPO-700001', date: '2026-03-12' }], items: [{ item: 'RMB-RED-01', qty: 10, rate: 50 }] }),
      invoice({ type: 'Sales', date: '2026-04-15', number: 'Z/001', party: ZEPTO, orders: [{ no: 'ZPO-778830', date: '2026-04-12' }], items: [{ item: 'RMB-RED-01', qty: 12, rate: 50 }] }),
      invoice({ type: 'Sales', date: '2026-05-12', number: 'RM/26-27/010', party: ZEPTO, orders: [{ no: 'ZPO-778840', date: '2026-05-09' }], items: [{ item: 'RMB-BLU-01', qty: 8, rate: 50 }] }),
      invoice({ type: 'Sales', date: '2026-06-03', number: '612/RM/26-27', party: ZEPTO, orders: [{ no: 'ZPO-778860', date: '2026-06-01' }], items: [{ item: YELLOW, qty: 25, rate: 50 }] }),
    ],
  };

  const hr = {
    code: 'HR', name: NAMES.HR, gstin: GSTIN.HR, state: 'Haryana', booksFrom: '2025-04-01', ledgerStyle: 'legacy',
    groups: GROUPS,
    voucherTypes: RESERVED_TYPES,
    stockItems: STOCK_ITEMS,
    ledgers: [
      ...COMMON_LEDGERS,
      { name: NAMES.MH, parent: 'Sundry Creditors', gstin: GSTIN.MH, state: 'Maharashtra' },
      { name: FLIPKART, parent: 'Sundry Debtors', gstin: '06AABCF8078M1Z8', state: 'Haryana' },
    ],
    vouchers: [
      invoice({ kind: 'purchase', type: 'Purchase', date: '2026-05-06', number: '1', party: NAMES.MH, tax: 'inter', reference: 'BT/26-27/001', items: [{ item: 'RMB-RED-01', qty: 200, rate: 45 }], bills: [{ name: 'BT/26-27/001', type: 'New Ref', amount: 9450 }] }),
      invoice({ type: 'Sales', date: '2026-05-10', number: 'RM/26-27/001', party: FLIPKART, items: [{ item: 'RMB-RED-01', qty: 5, rate: 99 }] }),
      invoice({ type: 'Sales', date: '2026-05-12', number: 'RM/26-27/010', party: FLIPKART, items: [{ item: 'RMB-RED-01', qty: 3, rate: 99 }] }),
    ],
  };

  const wb = {
    code: 'WB', name: NAMES.WB, gstin: GSTIN.WB, state: 'West Bengal', booksFrom: '2026-04-01', ledgerStyle: 'tp3',
    groups: GROUPS,
    voucherTypes: RESERVED_TYPES,
    stockItems: STOCK_ITEMS,
    ledgers: [
      ...COMMON_LEDGERS,
      { name: ZEPTO_WB, parent: 'Sundry Debtors', gstin: '19AAJCK8213B1Z1', state: 'West Bengal' },
      { name: NAMES.MH, parent: 'Branch / Divisions', gstin: GSTIN.MH, state: 'Maharashtra' },
    ],
    vouchers: [
      invoice({ type: 'Sales', date: '2026-04-15', number: 'WB/26-27/001', party: ZEPTO_WB, orders: [{ no: 'ZPO-900001', date: '2026-04-12' }], items: [{ item: 'RMB-BLU-01', qty: 60, rate: 50 }] }),
    ],
  };

  const companies = [mh, hr, wb];
  let seq = 0;
  for (const c of companies) {
    for (const v of c.vouchers) {
      seq++;
      v.guid = `${c.code.toLowerCase()}-0000-4000-8000-${String(seq).padStart(12, '0')}`;
      v.masterId = seq;
      v.alterId = seq + 100;
    }
    c.guid = `company-${c.code.toLowerCase()}`;
    c.altVchId = Math.max(...c.vouchers.map((v) => v.alterId));
    c.altMstId = 40 + c.ledgers.length;
  }

  return { companies, romsRefs: romsRefs() };
}

// ROMS rows as `roms-refs` would read them.
function romsRefs() {
  const po = (o) => ({
    status: 'Open', party_name: null, city: 'Mumbai', dispatch_date: null, bill_no: null, bill_date: null, grn_status: null,
    grn_date: null, grn_qty: null, grn_number: null, discrepancy_qty: null, discrepancy_number: null, created_at: '2026-04-01 10:00:00', ...o,
  });
  return {
    generatedAt: '2026-10-03T00:00:00.000Z',
    source: 'synthetic (mock/dataset.js)',
    vendors: ['Amazon', 'Blinkit', 'Flipkart', 'Minutes', 'Now', 'Scootsy', 'Zepto'].map((name) => ({ name, is_active: 1 })),
    products: ['RMB-RED-01', 'RMB-BLU-01', 'RMB-GRN-01', 'RMS-BLK-L', 'RMH-WHT-6P', 'RMB-YEL-01']
      .map((sku_code, i) => ({ id: i + 1, sku_code, description: null, category: null })),
    vendorCodes: [{ vendor: 'Zepto', vendor_item_code: '50012345', sku_code: 'RMB-YEL-01' }],
    pos: [
      po({ po_id: 'Z001', vendor: 'Zepto', vendor_po_id: 'ZPO-778812', po_date: '2026-04-02', status: 'Closed', bill_no: 'RM-26-27-001', bill_date: '2026-04-05', grn_status: 'Delivered - GRN Received', discrepancy_qty: 5, discrepancy_number: 'ZDN-4410' }),
      po({ po_id: 'Z002', vendor: 'Zepto', vendor_po_id: 'ZPO-778813', po_date: '2026-04-08', bill_no: 'RM-26-27-002', bill_date: '2026-04-10' }),
      po({ po_id: 'S001', vendor: 'Scootsy', vendor_po_id: '1301234567', po_date: '2026-04-10', bill_no: 'RM-26-27-003', bill_date: '2026-04-12', grn_status: 'Returned to Vendor' }),
      po({ po_id: 'N001', vendor: 'Now', vendor_po_id: 'NOW-55501', po_date: '2026-04-28' }),
      po({ po_id: 'F001', vendor: 'Flipkart', vendor_po_id: 'FK-PO-1', po_date: '2026-05-01', bill_no: 'BT-26-27-001', bill_date: '2026-05-05' }),
      po({ po_id: 'Z003', vendor: 'Zepto', vendor_po_id: 'ZPO-778820', po_date: '2026-05-30', bill_no: 'RM2627006', bill_date: '2026-06-02' }),
      po({ po_id: 'Z004', vendor: 'Zepto', vendor_po_id: 'ZPO-778899', po_date: '2026-06-10', bill_no: 'RM-26-27-999' }),
      po({ po_id: 'Z005', vendor: 'Zepto', vendor_po_id: 'ZPO-900001', po_date: '2026-04-12', city: 'Kolkata', bill_no: 'WB-26-27-001', bill_date: '2026-04-15' }),
      po({ po_id: 'Z006', vendor: 'Zepto', vendor_po_id: 'ZPO-778850', po_date: '2026-06-01', status: 'Deleted', bill_no: 'RM-26-27-005' }),
      po({ po_id: 'Z007', vendor: 'Zepto', vendor_po_id: 'ZPO-778830', po_date: '2026-04-12', bill_no: 'Z-001', bill_date: '2026-04-15' }),
      po({ po_id: 'Z008', vendor: 'Zepto', vendor_po_id: 'ZPO-778840', po_date: '2026-05-09', bill_no: 'RM-26-27-010', bill_date: '2026-05-12' }),
      po({ po_id: 'Z009', vendor: 'Zepto', vendor_po_id: 'ZPO-778860- Dry', po_date: '2026-06-01', bill_no: '0612', bill_date: '2026-06-03' }),
    ],
    lines: [
      { po_id: 'Z001', line_no: 1, item_code: 'Z-RED', qty: 100, sku_code: 'RMB-RED-01' },
      { po_id: 'Z001', line_no: 2, item_code: 'Z-BLU', qty: 50, sku_code: 'RMB-BLU-01' },
      { po_id: 'Z002', line_no: 1, item_code: 'Z-GRN', qty: 40, sku_code: 'RMB-GRN-01' },
      { po_id: 'S001', line_no: 1, item_code: 'S-SOCK', qty: 30, sku_code: 'RMS-BLK-L' },
      { po_id: 'N001', line_no: 1, item_code: 'N-HK', qty: 20, sku_code: 'RMH-WHT-6P' },
      { po_id: 'Z005', line_no: 1, item_code: 'Z-BLU', qty: 60, sku_code: 'RMB-BLU-01' },
      { po_id: 'Z003', line_no: 1, item_code: 'Z-BLU-NEW', qty: 5, sku_code: null },
      { po_id: 'Z009', line_no: 1, item_code: '50012345', qty: 25, sku_code: 'RMB-YEL-01' },
    ],
    rtv: [
      { po_id: 'Z001', rtv_no: 'ZR001', dn_number: null, status: null, delivered: null, delivery_date: null, cn_number: null, cn_date: null },
      { po_id: 'S001', rtv_no: 'SR001', dn_number: 'SDN-77', status: 'DN - Yes', delivered: 'Yes', delivery_date: '2026-05-20', cn_number: 'CN-26-27-002', cn_date: '2026-05-25' },
    ],
  };
}

module.exports = { buildDataset, GSTIN, NAMES };
