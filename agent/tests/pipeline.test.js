// Probe → profile → analyze, end to end against the mock Tally (testing
// Stage A). The synthetic books in mock/dataset.js plant one case per
// matching path; these tests pin what Phase 0 must report for each.
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createMockTally, syntheticAnswer } = require('../mock/server');
const { buildDataset } = require('../mock/dataset');
const xml = require('../mock/xml');
const { createTallyClient } = require('../src/tally/client');
const { describeRequest, vouchersRequest, VOUCHER_COLLECTION } = require('../src/tally/requests');
const { runProbe } = require('../src/probe');
const { analyze, renderAnalysis } = require('../src/analyze');

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => server.close(resolve));
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `rams-${name}-`));
const FROM = '2026-03-01';
const TO = '2026-06-30';

async function probeOnce(server, opts) {
  const port = await listen(server);
  try {
    return await runProbe({ client: createTallyClient({ port }), from: FROM, to: TO, ...opts });
  } finally {
    await close(server);
  }
}

describe('probe + profile + analyze on the mock Tally', () => {
  const requests = [];
  const dataset = buildDataset();
  let dir, result, analysis;

  beforeAll(async () => {
    dir = tmp('probe');
    result = await probeOnce(createMockTally({ dataset, onRequest: (b) => requests.push(b) }), { outDir: dir, keepRaw: true });
    analysis = analyze({ probeDir: dir, refs: dataset.romsRefs });
  });

  test('only ever sends exports, and starts each company at its books-from date', () => {
    expect(requests.length).toBeGreaterThan(10);
    for (const r of requests) expect(r).toContain('<TALLYREQUEST>Export</TALLYREQUEST>');
    const wb = result.run.companies.find((c) => /WB$/.test(c.name));
    expect(wb.periods[0].from).toBe('2026-04-01'); // WB books start after --from
    expect(result.run.companies.map((c) => c.vouchers)).toEqual([15, 3, 1]);
    expect(result.run.errors).toEqual([]);
  });

  test('profile: identity, number formats, order numbers, notes, transfers', () => {
    const [mh, hr, wb] = result.profile.companies;
    expect([mh.code, hr.code, wb.code]).toEqual(['MH', 'HR', 'WB']);
    expect(mh).toMatchObject({ gstin: '27ABGFR0562B1ZI', expected: true, liveVouchers: 14, warnings: [] });
    const sales = mh.numberFormats.find((n) => n.baseType === 'Sales');
    expect(sales).toMatchObject({ live: 9, withSlash: 9, failsRomsRule: 9, repeated: 1 });
    expect(mh.buyerOrder).toMatchObject({ salesVouchers: 9, withOrderNo: 7 });
    expect(mh.buyerOrder.paths[0]).toMatchObject({ path: 'INVOICEORDERLIST.LIST/BASICPURCHASEORDERNO', vouchers: 7 });
    expect(mh.notes.find((n) => n.baseType === 'Credit Note')).toMatchObject({ count: 2, withAgstRef: 2, agstRefToKnownSale: 2, withInventory: 1 });
    expect(mh.internalLedgers.map((l) => l.name).sort()).toEqual(['Roymax Haryana Branch', 'Roymax Products LLP - WB']);
    expect(mh.transfers[0]).toMatchObject({ type: 'Branch Transfer', internal: true, vouchers: 1 });
    expect(hr.transfers[0]).toMatchObject({ baseType: 'Purchase', party: 'Roymax Products LLP - MH', internal: true });
    expect(result.profile.crossCompany).toMatchObject({ collisions: 2 });
    expect(fs.readFileSync(path.join(dir, 'profile.md'), 'utf8')).toContain('## MH — Roymax Products LLP - MH');
    expect(fs.existsSync(path.join(dir, 'samples', mh.slug, 'voucher-Sales.json'))).toBe(true);
  });

  test('Bill No: date settles repeats, one true ambiguity, typing habits', () => {
    expect(analysis.bill.outcome).toEqual({ matched: 5, 'matched (picked by date)': 2, ambiguous: 1, 'not found': 1 });
    expect(analysis.bill.typed).toEqual({ "'/' typed as '-'": 6, 'all separators left out': 1 });
    expect(analysis.bill.examples.ambiguous[0]).toMatch(/^Z008 .*MH Sales RM\/26-27\/010.*HR Sales RM\/26-27\/010/);
    expect(analysis.bill.internalByVendor).toEqual({ Flipkart: 1 });
    expect(analysis.format).toEqual({ salesNumbers: 12, failRule: 12, passAfterSlashToDash: 12 });
  });

  test("Buyer's Order No: primary match, agreement with Bill No, where else PO numbers hide", () => {
    expect(analysis.order).toMatchObject({ found: 7, bothMatched: 5, agree: 5, disagree: 0, narrationOnly: 1, notFound: 1 });
    expect(analysis.order.foundElsewhere).toEqual({ 'Sales · REFERENCE': 1 });
    expect(analysis.ledgerVotes.Zepto).toEqual({
      'MH · Kiranakart Technologies Pvt Ltd (Zepto)': 5, 'WB · Kiranakart Technologies Pvt Ltd (Zepto) WB': 1,
    });
    expect(analysis.ledgerVotes.Flipkart).toEqual({ 'MH · Roymax Haryana Branch (internal)': 1 });
  });

  test('CN / discrepancy / DN: Agst Ref route, whose number, auto-fill potential', () => {
    expect(analysis.cn).toMatchObject({
      onPage: 2, withCn: 1, invoiceLinked: 2, withCnAgainstInvoice: 2, typedEqualsAgstCn: 1, typedDiffers: 0, fillable: 1, fillableBlockedByFormat: 1,
    });
    expect(analysis.cn.cnWhere).toEqual({ 'Credit Note · VOUCHERNUMBER': 1 });
    expect(analysis.discrepancy.where).toEqual({ 'Debit Note · REFERENCE': 1 });
    expect(analysis.rtvDn.found).toEqual({ 'not found': 1 });
    expect(analysis.fill).toMatchObject({ blankBill: 1, linkedOne: 1, passesRule: 0, passesAfterSlashToDash: 1 });
  });

  test('stock items ↔ SKUs and line sanity', () => {
    for (const s of analysis.stock) expect(s).toMatchObject({ items: 6, byName: 4, byAlias: 1, unmatched: 1 });
    expect(analysis.skuCoverage).toMatchObject({ skusOnLivePos: 5, onPosButNoTallyItem: [], poLinesWithoutSku: 1 });
    expect(analysis.lineCheck).toMatchObject({ checked: 6, allSkusOnInvoice: 5, noSkus: 1, qtyOverPo: 1, invoiceBeforePo: 0 });
    expect(analysis.warnings).toEqual([]);
    expect(renderAnalysis(analysis)).toContain('## Decision gate');
  });

  test('a recording replays to the same data', async () => {
    const replayDir = tmp('replay');
    await probeOnce(createMockTally({ replayDir: dir }), { outDir: replayDir });
    for (const c of result.run.companies) {
      const file = (d) => fs.readFileSync(path.join(d, 'companies', c.slug, 'vouchers.jsonl'), 'utf8');
      expect(file(replayDir)).toBe(file(dir));
    }
  });
});

describe('probe resilience', () => {
  test('a failed month is recorded and the run carries on', async () => {
    const dataset = buildDataset();
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        if (req.method === 'GET') return res.end('<RESPONSE>TallyPrime Server is Running</RESPONSE>');
        const body = Buffer.concat(chunks).toString('utf16le');
        const d = describeRequest(body);
        const fail = d.id === VOUCHER_COLLECTION && /HR$/.test(d.company) && d.from === '2026-05-01';
        return res.end(fail ? xml.errorXml('Memory Access Violation') : syntheticAnswer(dataset, body));
      });
    });
    const dir = tmp('fail');
    const { run, profile } = await probeOnce(server, { outDir: dir });
    const hr = run.companies.find((c) => /HR$/.test(c.name));
    expect(hr.errors).toEqual([expect.stringContaining('Memory Access Violation')]);
    expect(hr.periods.find((p) => p.from === '2026-05-01').error).toMatch(/Memory Access Violation/);
    expect(run.companies.find((c) => /WB$/.test(c.name)).vouchers).toBe(1); // later companies still probed
    expect(profile.companies.find((p) => p.code === 'HR').warnings[0]).toMatch(/^Export error/);
  });

  test('a Tally that ignores the requested period is caught, not counted', async () => {
    // Educational-mode TallyPrime swaps a date it won't accept for another.
    const dataset = buildDataset();
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        if (req.method === 'GET') return res.end('<RESPONSE>TallyPrime Server is Running</RESPONSE>');
        const body = Buffer.concat(chunks).toString('utf16le');
        const d = describeRequest(body);
        const stuck = d.id === VOUCHER_COLLECTION ? vouchersRequest({ company: d.company, from: '2026-04-01', to: '2026-04-30' }) : body;
        return res.end(syntheticAnswer(dataset, stuck));
      });
    });
    const { run } = await probeOnce(server, { outDir: tmp('stuck') });
    const wb = run.companies.find((c) => /WB$/.test(c.name));
    expect(wb.vouchers).toBe(1); // WB's one voucher, 15 Apr, counted once
    expect(wb.errors).toHaveLength(2); // May and June each got April's book
    expect(wb.errors[0]).toMatch(/^Vouchers 2026-05-01…2026-05-31: Tally sent 1 dated outside .* it ignored the period/);
  });

  test('a widened period neither leaks outside --from/--to nor counts a voucher twice', async () => {
    const outDir = tmp('edges');
    // Asks Tally for 1 Apr…1 May and 1 May…2 May; MH has 4 Apr vouchers from the 5th on, 1 on 2 May.
    const { run } = await probeOnce(createMockTally({ dataset: buildDataset() }), { outDir, from: '2026-04-05', to: '2026-05-02' });
    const mh = run.companies.find((c) => /MH$/.test(c.name));
    expect(mh.errors).toEqual([]);
    expect(mh.periods.map((p) => p.vouchers)).toEqual([4, 1]);
    const lines = fs.readFileSync(path.join(outDir, 'companies', mh.slug, 'vouchers.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    expect(lines.map((v) => v.date).sort()).toEqual(['2026-04-05', '2026-04-10', '2026-04-12', '2026-04-15', '2026-05-02']);
  });

  test('--company that matches nothing is reported, not silently ignored', async () => {
    const { run } = await probeOnce(createMockTally(), { outDir: tmp('only'), only: ['Gujarat'] });
    expect(run.companies).toEqual([]);
    expect(run.errors[0]).toMatch(/No open company matches "gujarat"/);
  });

  test('analysis warns when the probe starts after the first ROMS PO', async () => {
    const dir = tmp('late');
    await probeOnce(createMockTally(), { outDir: dir, from: '2026-04-20' });
    const a = analyze({ probeDir: dir, refs: buildDataset().romsRefs });
    expect(a.warnings[0]).toMatch(/--from 2026-04-02/);
  });
});
