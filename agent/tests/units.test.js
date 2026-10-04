const { sanitize, parseXml, txt, field, num, tallyDate, findAll } = require('../src/tally/parse');
const {
  exactKey, normKey, compactKey, splitRefs, mask, howTyped, DocIndex,
} = require('../src/docno');
const {
  tallyDateArg, isoFromTally, companiesRequest, mastersRequest, vouchersRequest, eduSafeRange, describeRequest, VOUCHER_COLLECTION,
} = require('../src/tally/requests');
const {
  baseTypeResolver, groupResolver, ledgersFrom, voucherFrom, GSTIN_RE, panOf,
} = require('../src/tally/normalize');
const { periods, fyOf, previousFyStart, readEnvFile } = require('../src/util');
const { parseArgs } = require('../src/cli');
const xml = require('../mock/xml');
const { buildDataset } = require('../mock/dataset');

describe('parse', () => {
  test('strips the &#4; prefix and control bytes Tally emits, keeps legal entities', () => {
    expect(sanitize('<A>&#4; Not Applicable</A><B>a&#10;b &amp; c\x01</B>')).toBe('<A> Not Applicable</A><B>a&#10;b &amp; c</B>');
    const t = parseXml('<X><A>&#4; Primary</A><B TYPE="Number"> 0012</B></X>');
    expect(txt(t.X.A)).toBe('Primary');
    expect(txt(t.X.B)).toBe('0012'); // kept as text, not 12
  });

  test('reads fields from child tags or attributes, numbers with units and commas, Tally dates', () => {
    const t = parseXml('<L NAME="Zepto &amp; Co"><PARENT>Debtors</PARENT></L>');
    expect(field(t.L, 'NAME')).toBe('Zepto & Co');
    expect(field(t.L, 'PARENT')).toBe('Debtors');
    expect(num('-1,180.50')).toBe(-1180.5);
    expect(num(' 12 Pcs')).toBe(12);
    expect(num('50.00/Pcs')).toBe(50);
    expect(num('')).toBeNull();
    expect(tallyDate('20260401')).toBe('2026-04-01');
  });

  test('findAll skips scalar nodes that share a tag name (CMPINFO/COMPANY counts)', () => {
    const t = parseXml('<E><CMPINFO><COMPANY>0</COMPANY></CMPINFO><COLLECTION><COMPANY NAME="A"/><COMPANY NAME="B"/></COLLECTION></E>');
    expect(findAll(t, 'COMPANY').map((c) => field(c, 'NAME'))).toEqual(['A', 'B']);
  });
});

describe('docno', () => {
  test('three strengths', () => {
    expect(exactKey(' rm/26-27/001 ')).toBe('RM/26-27/001');
    expect(normKey('RM/26-27/001')).toBe(normKey('RM-26-27-1'));
    expect(normKey('RM / 26_27 . 001')).toBe('RM-26-27-1');
    expect(compactKey('RM/26-27/006')).toBe('RM2627006');
    expect(normKey('RM/26-27/006')).not.toBe(normKey('RM2627006'));
  });

  test('describes how ROMS typed a Tally number', () => {
    expect(howTyped('RM/26-27/1', 'RM/26-27/1')).toBe('as in Tally');
    expect(howTyped('rm-1', 'RM-1')).toBe('case differs');
    expect(howTyped('RM-26-27-001', 'RM/26-27/001')).toBe("'/' typed as '-'");
    expect(howTyped('RM26-27001', 'RM/26-27/001')).toBe("'/' left out");
    expect(howTyped('RM2627001', 'RM/26-27/001')).toBe('all separators left out');
    expect(howTyped('RM-26-27-1', 'RM/26-27/001')).toBe('separators or leading zeros differ');
    expect(howTyped('XYZ', 'RM/26-27/001')).toBe('other');
  });

  test('DocIndex answers at the strongest level with a hit, and ignores tiny compact keys', () => {
    const idx = new DocIndex();
    idx.add('RM/26-27/001', 'a');
    idx.add('RM-26-27-001', 'b');
    expect(idx.find('rm-26-27-001')).toEqual({ level: 'exact', entries: ['b'] });
    expect(idx.find('RM_26_27_1')).toEqual({ level: 'normalised', entries: ['a', 'b'] });
    expect(idx.find('RM2627001').level).toBe('compact');
    const tiny = new DocIndex();
    tiny.add('1/2', 'x');
    expect(tiny.find('12').level).toBeNull();
  });

  test('splits multi-PO fields, masks shapes', () => {
    expect(splitRefs('ZPO-1, ZPO-2 & ZPO-3;ZPO-4')).toEqual(['ZPO-1', 'ZPO-2', 'ZPO-3', 'ZPO-4']);
    expect(mask('RM/26-27/012')).toBe('AA/99-99/999');
  });
});

describe('requests', () => {
  test('date forms', () => {
    expect(tallyDateArg('2026-04-01')).toBe('20260401');
    expect(isoFromTally('1-Apr-2026')).toBe('2026-04-01');
    expect(isoFromTally('20260401')).toBe('2026-04-01');
    expect(() => tallyDateArg('01/04/2026')).toThrow();
  });

  test('every request is an export and reads back to what it asks for', () => {
    const company = 'Roymax & Sons <MH>';
    for (const r of [companiesRequest(), mastersRequest({ company, accountType: 'Ledgers' }), vouchersRequest({ company, from: '2026-04-01', to: '2026-04-30' })]) {
      expect(r).toContain('<TALLYREQUEST>Export</TALLYREQUEST>');
      expect(r).not.toMatch(/Import|Create|Alter|Delete/i);
    }
    expect(describeRequest(mastersRequest({ company, accountType: 'Ledgers' }))).toMatchObject({ id: 'List of Accounts', company, accountType: 'Ledgers' });
    expect(describeRequest(vouchersRequest({ company, from: '2026-04-01', to: '2026-04-30' }))).toMatchObject({ type: 'Collection', id: VOUCHER_COLLECTION, company, from: '2026-04-01', to: '2026-04-30' });
    expect(describeRequest(companiesRequest()).type).toBe('Collection');
  });

  test('periods are widened to dates Educational mode accepts (1st, 2nd, 31st)', () => {
    expect(eduSafeRange('2026-06-08', '2026-06-30')).toEqual({ from: '2026-06-01', to: '2026-07-01' });
    expect(eduSafeRange('2026-07-01', '2026-07-31')).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    expect(eduSafeRange('2026-07-02', '2026-07-02')).toEqual({ from: '2026-07-02', to: '2026-07-02' });
    expect(eduSafeRange('2026-12-05', '2026-12-30')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
  });
});

describe('normalize', () => {
  test('base types: custom → custom → reserved, and a guess without masters', () => {
    const base = baseTypeResolver([
      { name: 'Sales', parent: 'Sales', reserved: 'Sales' },
      { name: 'Sales-Zepto', parent: 'Sales', reserved: '' },
      { name: 'Sales-Zepto-B2B', parent: 'Sales-Zepto', reserved: '' },
      { name: 'CN Marketplace', parent: 'Credit Note', reserved: '' }, // parent not exported
      { name: 'Loop A', parent: 'Loop B', reserved: '' },
      { name: 'Loop B', parent: 'Loop A', reserved: '' },
    ]);
    expect(base('Sales-Zepto-B2B')).toBe('Sales');
    expect(base('CN Marketplace')).toBe('Credit Note');
    expect(base('Loop A')).toBe('Unknown');
    expect(baseTypeResolver([])('Debit Note')).toBe('Debit Note');
    expect(baseTypeResolver([])('Sales GST')).toBe('Sales');
  });

  test('groups resolve to Sundry Debtors through sub-groups', () => {
    const g = groupResolver([
      { name: 'Sundry Debtors', parent: 'Current Assets', reserved: 'Sundry Debtors' },
      { name: 'Current Assets', parent: 'Primary', reserved: 'Current Assets' },
      { name: 'Marketplaces', parent: 'Sundry Debtors', reserved: '' },
    ]);
    expect(g('Marketplaces')).toMatchObject({ debtor: true, primary: 'Current Assets', chain: ['Marketplaces', 'Sundry Debtors', 'Current Assets'] });
  });

  test('ledger GSTIN in either TallyPrime shape; PAN marks our own registrations', () => {
    const ds = buildDataset();
    const mh = ds.companies.find((c) => c.code === 'MH');
    const hr = ds.companies.find((c) => c.code === 'HR');
    const tp3 = ledgersFrom(parseXml(xml.mastersXml(mh, 'Ledgers'))).find((l) => l.name === 'Roymax Haryana Branch');
    const legacy = ledgersFrom(parseXml(xml.mastersXml(hr, 'Ledgers'))).find((l) => /MH$/.test(l.name));
    expect(tp3).toMatchObject({ gstins: ['06ABGFR0562B1ZM'], state: 'Haryana', parent: 'Branch / Divisions' });
    expect(legacy).toMatchObject({ gstins: ['27ABGFR0562B1ZI'], state: 'Maharashtra' });
    expect(GSTIN_RE.test('27ABGFR0562B1ZI')).toBe(true);
    expect(panOf('27ABGFR0562B1ZI')).toBe('ABGFR0562B');
  });

  test('vouchers in invoice view and accounting view', () => {
    const ds = buildDataset();
    const mh = ds.companies.find((c) => c.code === 'MH');
    const parse = (num) => voucherFrom(findAll(parseXml(xml.voucherXml(mh.vouchers.find((v) => v.number === num), mh)), 'VOUCHER')[0]);
    const sale = parse('RM/26-27/001');
    expect(sale).toMatchObject({ number: 'RM/26-27/001', date: '2026-04-05', invoice: true, cmpGstin: '27ABGFR0562B1ZI', total: 7875, orders: [{ no: 'ZPO-778812', date: '2026-04-02' }] });
    expect(sale.inventoryLines.map((i) => [i.item, i.qty, i.unit, i.rate])).toEqual([['RMB-RED-01', 100, 'Pcs', 50], ['RMB-BLU-01', 50, 'Pcs', 50]]);
    expect(sale.ledgerLines[0]).toMatchObject({ isParty: true, debit: true, bills: [{ name: 'RM/26-27/001', type: 'New Ref', amount: -7875 }] });
    expect(sale.docFields['INVOICEORDERLIST.LIST/BASICPURCHASEORDERNO']).toEqual(['ZPO-778812']);
    const cn = parse('CN/26-27/001');
    expect(cn).toMatchObject({ invoice: false, reference: 'ZCN-9981', party: 'Kiranakart Technologies Pvt Ltd (Zepto)' });
    expect(cn.ledgerLines.flatMap((l) => l.bills)).toEqual([{ name: 'RM/26-27/001', type: 'Agst Ref', amount: 262.5 }]);
    // "Not Applicable" order numbers are not kept as references.
    expect(parse('RM/26-27/006').docFields['ALLINVENTORYENTRIES.LIST/BATCHALLOCATIONS.LIST/ORDERNO']).toBeUndefined();
  });
});

describe('util and cli args', () => {
  test('periods by month and by days, financial years', () => {
    expect(periods('2026-03-15', '2026-05-02')).toEqual([
      { from: '2026-03-15', to: '2026-03-31' }, { from: '2026-04-01', to: '2026-04-30' }, { from: '2026-05-01', to: '2026-05-02' },
    ]);
    expect(periods('2026-02-27', '2026-03-03', 2)).toEqual([
      { from: '2026-02-27', to: '2026-02-28' }, { from: '2026-03-01', to: '2026-03-02' }, { from: '2026-03-03', to: '2026-03-03' },
    ]);
    expect(fyOf('2026-03-31')).toBe('2025-26');
    expect(fyOf('2026-04-01')).toBe('2026-27');
    expect(previousFyStart('2026-10-03')).toBe('2025-04-01');
  });

  test('parseArgs: repeatable flags, --k=v, booleans', () => {
    expect(parseArgs(['probe', '--company', 'MH', '--company=HR', '--keep-raw', '--from', '2026-04-01'])).toEqual({
      _: ['probe'], company: ['MH', 'HR'], 'keep-raw': true, from: '2026-04-01',
    });
  });

  test('readEnvFile handles quotes, comments and export', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rams-env-')), '.env');
    fs.writeFileSync(f, '# c\nexport A="x y"\nB=z # note\nC=\'q\'\n');
    expect(readEnvFile(f)).toEqual({ A: 'x y', B: 'z', C: 'q' });
  });
});
