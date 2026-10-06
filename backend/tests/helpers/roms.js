const http = require('http');

// A stand-in for ROMS's /api/integration (ROMS integration.controller.js):
//   GET  /refs/:resource   the same paging and bearer-token check, serving
//                          `data` -- which a test may change between calls
//   POST /autofill         ROMS's rules for the two fields RAMS writes, on the
//                          same `data`: compare-and-set on `expected`, "Already
//                          set", a Bill No used on another PO, a deleted PO, a
//                          DN - Disposed RTV row, and dry_run. A test can make
//                          ROMS refuse a PO with state.refuse[po_id] = reason.
// `calls` lists the paths asked for, `autofills` each auto-fill body.
const ROMS_TOKEN = 'roms-test-token';

const blank = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const changed = (field, now, expected) => `${field} is now ${now == null ? 'blank' : `"${now}"`}, not ${expected == null ? 'blank' : `"${expected}"`} as RAMS read it — left for a person`;

function autofillOne(data, item, dryRun, refuse) {
  const value = blank(item.value);
  const expected = blank(item.expected);
  if (!value || !item.date) return { result: 'rejected', reason: 'value is required' };
  if (refuse[item.po_id]) return { result: 'rejected', reason: refuse[item.po_id] };
  if (item.target === 'bill') {
    const p = data.pos.find((x) => x.po_id === item.po_id);
    if (!p) return { result: 'rejected', reason: 'PO not found' };
    if (p.status === 'Deleted') return { result: 'rejected', reason: 'PO is deleted' };
    if (p.bill_no === value && p.bill_date === item.date) return { result: 'skipped', reason: 'Already set' };
    if (blank(p.bill_no) !== expected) return { result: 'rejected', reason: changed('Bill no', blank(p.bill_no), expected) };
    const dup = data.pos.find((x) => x.po_id !== p.po_id && x.bill_no === value);
    if (dup) return { result: 'rejected', reason: `Bill no "${value}" is already used on PO ${dup.po_id}` };
    const change = { old: blank(p.bill_no), new: value };
    if (dryRun) return { result: 'would_apply', ...change };
    Object.assign(p, { bill_no: value, bill_date: item.date, updated_at: '2026-10-06 10:00:00' });
    return { result: 'applied', ...change };
  }
  if (item.target === 'rtv_cn') {
    const r = data.rtv.find((x) => x.po_id === item.po_id);
    if (!r) return { result: 'rejected', reason: 'No RTV row for this PO' };
    if (r.status === 'DN - Disposed') return { result: 'rejected', reason: `RTV ${r.rtv_no} is DN - Disposed — no credit note follows` };
    if (r.cn_number === value && r.cn_date === item.date) return { result: 'skipped', reason: 'Already set' };
    if (blank(r.cn_number) !== expected) return { result: 'rejected', reason: changed('Credit Note Number', blank(r.cn_number), expected) };
    const change = { old: blank(r.cn_number), new: value };
    if (dryRun) return { result: 'would_apply', ...change };
    Object.assign(r, { cn_number: value, cn_date: item.date, updated_at: '2026-10-06 10:00:00' });
    return { result: 'applied', ...change };
  }
  return { result: 'rejected', reason: 'target must be one of bill, rtv_cn' };
}

function emptyRefs() {
  return { vendors: [], products: [], 'vendor-codes': [], pos: [], lines: [], rtv: [] };
}

async function startFakeRoms(data = emptyRefs(), { token = ROMS_TOKEN } = {}) {
  const calls = [];
  const autofills = [];
  const state = { data, status: null, refuse: {} };
  const server = http.createServer(async (req, res) => {
    calls.push(req.url);
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    let raw = '';
    for await (const chunk of req) raw += chunk;
    if (state.status) return send(state.status, { message: 'The integration is not configured' });
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { message: 'Invalid integration token' });
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/api/integration/autofill') {
      const body = JSON.parse(raw || '{}');
      autofills.push(body);
      const results = (body.items || []).map((item, index) => ({
        index, target: item.target, po_id: item.po_id, ...autofillOne(state.data, item, Boolean(body.dry_run), state.refuse),
      }));
      const count = (r) => results.filter((x) => x.result === r).length;
      return send(200, {
        dry_run: Boolean(body.dry_run), applied: count('applied'), would_apply: count('would_apply'), skipped: count('skipped'), rejected: count('rejected'), results,
      });
    }
    const m = /^\/api\/integration\/refs\/([a-z-]+)$/.exec(url.pathname);
    if (!m || !state.data[m[1]]) return send(404, { message: 'Unknown reference' });
    const all = state.data[m[1]];
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const size = Math.min(1000, Number(url.searchParams.get('page_size')) || 500);
    return send(200, { rows: all.slice((page - 1) * size, page * size), total: all.length, page, page_size: size });
  });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    token,
    calls,
    autofills,
    state,
    settings: { url, token, configured: true },
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

// ROMS rows with ROMS's columns, filled in where a test doesn't care.
let rtvId = 0;
const po = (po_id, overrides = {}) => ({
  po_id, vendor: 'Blinkit', vendor_po_id: null, po_date: '2026-06-28', status: 'Closed', party_name: null, city: null,
  dispatch_date: null, bill_no: null, bill_date: null, grn_status: null, grn_date: null, grn_qty: null, grn_number: null,
  discrepancy_qty: null, discrepancy_number: null, created_at: '2026-06-28 10:00:00', updated_at: '2026-06-28 10:00:00',
  ...overrides,
});
const line = (po_id, line_no, overrides = {}) => ({ po_id, line_no, item_code: null, qty: 10, sku_code: null, ...overrides });
const rtv = (po_id, overrides = {}) => {
  rtvId += 1;
  return {
    id: rtvId, po_id, rtv_no: `RTV-${rtvId}`, dn_number: null, status: null, delivered: 0, delivery_date: null,
    cn_number: null, cn_date: null, updated_at: '2026-07-10 10:00:00', ...overrides,
  };
};

module.exports = { startFakeRoms, emptyRefs, ROMS_TOKEN, po, line, rtv };
