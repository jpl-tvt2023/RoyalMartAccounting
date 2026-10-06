// RAMS talking to ROMS's integration API with ROMS's INTEGRATION_TOKEN (ROMS
// middleware/serviceAuth.js):
//   GET  /api/integration/refs/:resource   what RAMS matches against
//   POST /api/integration/autofill         auto-fill's writes -- compare-and-set
//        on the value RAMS read, so repeating one that landed comes back
//        "Already set" and a retry is safe
//
// ROMS_API_URL and ROMS_INTEGRATION_TOKEN are optional: without them matching
// runs on the copy RAMS last read, and the pages say ROMS isn't connected.
// The token is never logged or returned.
const RESOURCES = ['vendors', 'products', 'vendor-codes', 'pos', 'lines', 'rtv'];
const PAGE_SIZE = 1000;
// ROMS's AUTOFILL_MAX_ITEMS (integration.controller.js) is 200.
const AUTOFILL_MAX = 200;

class RomsError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'RomsError';
    this.status = status;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function romsSettings(env = process.env) {
  const url = String(env.ROMS_API_URL || '').trim().replace(/\/+$/, '').replace(/\/api$/, '');
  const token = String(env.ROMS_INTEGRATION_TOKEN || '').trim();
  return { url, token, configured: Boolean(url && token) };
}

function createRomsClient({
  url, token, fetchImpl = globalThis.fetch, timeoutMs = 30000, retries = 2, sleep = defaultSleep,
} = romsSettings()) {
  const base = `${String(url || '').replace(/\/+$/, '')}/api/integration`;

  async function request(path, body) {
    for (let attempt = 1; ; attempt++) {
      let res;
      try {
        res = await fetchImpl(base + path, {
          method: body ? 'POST' : 'GET',
          headers: {
            Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'rams-backend',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        if (attempt <= retries) { await sleep(1000 * attempt); continue; }
        const why = (e.cause && (e.cause.code || e.cause.message)) || e.name || e.message;
        throw new RomsError(`ROMS did not answer (${why})`);
      }
      const text = await res.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 200) }; }
      if (res.ok) return data;
      if (res.status >= 500 && res.status !== 503 && attempt <= retries) { await sleep(1000 * attempt); continue; }
      if (res.status === 401) throw new RomsError('ROMS refused RAMS\'s integration token — check ROMS_INTEGRATION_TOKEN against ROMS\'s INTEGRATION_TOKEN', 401);
      if (res.status === 503) throw new RomsError(`ROMS's integration is switched off: ${data.message || 'not configured'}`, 503);
      throw new RomsError(data.message ? `ROMS: ${data.message}` : `ROMS answered HTTP ${res.status}`, res.status);
    }
  }

  // Every row of one resource, page by page.
  async function refs(resource) {
    if (!RESOURCES.includes(resource)) throw new Error(`Unknown ROMS reference ${resource}`);
    const rows = [];
    for (let page = 1; ; page++) {
      const data = await request(`/refs/${resource}?page=${page}&page_size=${PAGE_SIZE}`);
      if (!Array.isArray(data.rows)) throw new RomsError(`ROMS sent no rows for ${resource}`);
      rows.push(...data.rows);
      if (!data.rows.length || rows.length >= Number(data.total)) return rows;
    }
  }

  // items: [{ target: 'bill' | 'rtv_cn', po_id, value, date, expected, note }],
  // at most AUTOFILL_MAX per call. ROMS answers one result per item, in order.
  async function autofill(items, { dryRun = false } = {}) {
    if (!items.length) return { results: [] };
    if (items.length > AUTOFILL_MAX) throw new Error(`At most ${AUTOFILL_MAX} items per ROMS auto-fill call`);
    const data = await request('/autofill', { items, dry_run: Boolean(dryRun) });
    if (!Array.isArray(data.results) || data.results.length !== items.length) {
      throw new RomsError('ROMS did not answer for every auto-fill item');
    }
    return data;
  }

  return {
    refs,
    async all() {
      const out = {};
      for (const r of RESOURCES) out[r] = await refs(r);
      return out;
    },
    autofill,
  };
}

module.exports = {
  createRomsClient, romsSettings, RomsError, RESOURCES, AUTOFILL_MAX,
};
