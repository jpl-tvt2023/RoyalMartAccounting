const { db } = require('./helpers/db');
const { startFakeRoms, emptyRefs, po, line, rtv } = require('./helpers/roms');
const { refreshRoms, refreshState } = require('../src/services/romsRefs');
const { createRomsClient } = require('../src/services/romsClient');

const quick = (roms) => createRomsClient({ ...roms.settings, retries: 0, sleep: async () => {} });
const count = async (table) => Number((await db.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n);

function refs() {
  const data = emptyRefs();
  data.vendors = [{ name: 'Blinkit', is_active: 1 }, { name: 'Zepto', is_active: 1 }];
  data.products = [{ id: 1, sku_code: 'WB003', description: 'Bottle', category: 'Home' }];
  data['vendor-codes'] = [{ id: 1, vendor: 'Blinkit', vendor_item_code: '10192283', product_id: 1, sku_code: 'WB003' }];
  data.pos = Array.from({ length: 1205 }, (_, i) => po(`B${i + 1}`, { vendor_po_id: `P${4588000 + i}` }));
  data.lines = data.pos.map((p) => line(p.po_id, 1, { item_code: '10192283', sku_code: 'WB003' }));
  data.rtv = [rtv('B1', { cn_number: '835' })];
  return data;
}

let roms;
afterEach(async () => { if (roms) await roms.close(); roms = null; });
// Suites share one database: start from an empty copy, and leave none behind.
const emptyCopy = async () => {
  for (const t of ['roms_vendors', 'roms_products', 'roms_vendor_codes', 'roms_pos', 'roms_po_lines', 'roms_rtv']) await db.execute(`DELETE FROM ${t}`);
};
beforeAll(emptyCopy);
afterAll(emptyCopy);

describe("RAMS's copy of ROMS", () => {
  test('reads every page of every reference, then writes only what changed', async () => {
    roms = await startFakeRoms(refs());
    const first = await refreshRoms(db, { roms: quick(roms) });
    expect(first.ok).toBe(true);
    expect(first.counts.pos).toEqual({ rows: 1205, written: 1205, deleted: 0 });
    expect(roms.calls.filter((c) => c.includes('/refs/pos'))).toHaveLength(2);
    expect(await count('roms_pos')).toBe(1205);
    expect(await count('roms_po_lines')).toBe(1205);

    // Staff type a Bill No on one PO and delete a line elsewhere.
    roms.state.data.pos[4].bill_no = '607';
    roms.state.data.lines.pop();
    const second = await refreshRoms(db, { roms: quick(roms) });
    expect(second.counts.pos).toEqual({ rows: 1205, written: 1, deleted: 0 });
    expect(second.counts.lines).toEqual({ rows: 1204, written: 0, deleted: 1 });
    expect(second.counts.vendors).toEqual({ rows: 2, written: 0, deleted: 0 });
    const { rows: [b5] } = await db.execute("SELECT bill_no FROM roms_pos WHERE po_id = 'B5'");
    expect(b5.bill_no).toBe('607');

    const state = await refreshState(db);
    expect(state.last_ok_at).toBeTruthy();
    expect(state.last_error).toBeNull();
  });

  test('a refused token or a switched-off integration is reported, and the copy is kept', async () => {
    roms = await startFakeRoms(refs(), { token: 'another-token' });
    const res = await refreshRoms(db, { roms: createRomsClient({ url: roms.url, token: 'wrong', retries: 0 }) });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/refused RAMS's integration token/);
    expect(res.error).not.toMatch(/wrong/);
    expect((await refreshState(db)).last_error).toMatch(/refused/);

    roms.state.status = 503;
    const off = await refreshRoms(db, { roms: createRomsClient({ url: roms.url, token: 'another-token', retries: 0 }) });
    expect(off.error).toMatch(/integration is switched off/);
    expect(await count('roms_pos')).toBe(1205);
  });

  test('ROMS answering with no POs at all keeps the copy instead of emptying it', async () => {
    const empty = refs();
    empty.pos = [];
    roms = await startFakeRoms(empty);
    const res = await refreshRoms(db, { roms: quick(roms) });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ROMS sent no pos although RAMS holds 1205/);
    expect(await count('roms_pos')).toBe(1205);
  });

  test('ROMS not configured: says so and reads nothing', async () => {
    const res = await refreshRoms(db, { settings: { configured: false } });
    expect(res).toMatchObject({ ok: false, connected: false });
    expect(res.error).toMatch(/ROMS_API_URL/);
  });

  test('an unreachable ROMS is retried, then reported', async () => {
    const sleeps = [];
    const client = createRomsClient({ url: 'http://127.0.0.1:9', token: 't', retries: 2, timeoutMs: 2000, sleep: async (ms) => { sleeps.push(ms); } });
    await expect(client.refs('pos')).rejects.toThrow(/ROMS did not answer/);
    expect(sleeps).toEqual([1000, 2000]);
  });
});
