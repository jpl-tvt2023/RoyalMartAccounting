const http = require('http');

// A stand-in for ROMS's /api/integration/refs (ROMS integration.controller.js):
// the same paging and the same bearer-token check, serving `data` -- which a
// test may change between calls. `calls` lists the paths asked for.
const ROMS_TOKEN = 'roms-test-token';

function emptyRefs() {
  return { vendors: [], products: [], 'vendor-codes': [], pos: [], lines: [], rtv: [] };
}

async function startFakeRoms(data = emptyRefs(), { token = ROMS_TOKEN } = {}) {
  const calls = [];
  const state = { data, status: null };
  const server = http.createServer((req, res) => {
    calls.push(req.url);
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (state.status) return send(state.status, { message: 'The integration is not configured' });
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { message: 'Invalid integration token' });
    const url = new URL(req.url, 'http://localhost');
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
