// Reading a company's books from Tally, shared by the Phase 0 probe and the
// sync, so the two can never drift apart. Every request is an export.
//
// Educational mode accepts only the 1st, 2nd and 31st as dates, export periods
// included, and silently swaps any other date. So every period is widened to
// dates Tally accepts (eduSafeRange), and vouchers that fall outside the
// period wanted are dropped. A voucher outside even the widened period means
// Tally ignored the period altogether: it is reported as `stray`.
const { findAll } = require('./parse');
const {
  companiesRequest, mastersRequest, vouchersRequest, changedVouchersRequest, voucherListRequest,
  sysInfoRequest, eduSafeRange, describeRequest, MASTER_TYPES, SYSINFO_PROBE_DAY,
} = require('./requests');
const {
  companiesFrom, groupsFrom, ledgersFrom, stockItemsFrom, voucherTypesFrom, voucherFrom, voucherListFrom, sysInfoFrom,
} = require('./normalize');

const MASTER_PARSERS = {
  Groups: ['groups', groupsFrom, 'GROUP'],
  Ledgers: ['ledgers', ledgersFrom, 'LEDGER'],
  'Stock Items': ['stockItems', stockItemsFrom, 'STOCKITEM'],
  'Voucher Types': ['voucherTypes', voucherTypesFrom, 'VOUCHERTYPE'],
};

// The loaded companies with their AltVchId / AltMstId counters. `raw` (the
// probe's raw saver) records the exchange.
async function listCompanies(client, raw) {
  let request = companiesRequest();
  let res;
  try {
    res = await client.post(request, { label: 'companies' });
  } catch (e) {
    if (e.code === 'UNREACHABLE') throw e;
    // Retry with the FETCH list tally-database-loader ships with.
    request = companiesRequest({ minimal: true });
    res = await client.post(request, { label: 'companies (minimal)' });
  }
  if (raw) raw.save('companies.xml', request, res.text, describeRequest);
  return companiesFrom(res.tree);
}

// The four master lists: { masters: { groups, ledgers, stockItems, voucherTypes },
// errors }. A list Tally refused is left out of `masters` and named in
// `errors`; losing Tally altogether throws.
async function pullMasters(client, company, { only = MASTER_TYPES, onResponse = null } = {}) {
  const masters = {};
  const errors = [];
  for (const accountType of only) {
    const [key, parse, tag] = MASTER_PARSERS[accountType];
    const request = mastersRequest({ company: company.name, accountType });
    try {
      const res = await client.post(request, { label: `${company.name}: ${accountType}` });
      masters[key] = parse(res.tree);
      if (onResponse) onResponse({ accountType, key, tag, request, res, list: masters[key] });
    } catch (e) {
      if (e.code === 'UNREACHABLE') throw e;
      errors.push(`${accountType}: ${e.message}`);
    }
  }
  return { masters, errors };
}

// The vouchers dated p.from..p.to, whole -- or with `afterAlterId`, only those
// altered since. Returns { vouchers, objects (the raw parsed ones), stray, ms }.
async function pullPeriod(client, company, p, {
  baseTypeOf, docFields = true, afterAlterId = null, onResponse = null,
} = {}) {
  const ask = eduSafeRange(p.from, p.to);
  const changed = afterAlterId != null;
  const request = changed
    ? changedVouchersRequest({ company: company.name, ...ask, afterAlterId })
    : vouchersRequest({ company: company.name, ...ask });
  const label = `${company.name}: ${changed ? `vouchers altered after ${afterAlterId}` : 'vouchers'} ${p.from}…${p.to}`;
  const res = await client.post(request, { label });
  if (onResponse) onResponse({ request, res });
  const vouchers = [];
  const objects = [];
  const stray = [];
  for (const obj of findAll(res.tree, 'VOUCHER')) {
    const v = voucherFrom(obj, { baseTypeOf, docFields });
    if (v.date) {
      // Outside what was asked for: Tally ignored the period.
      if (v.date < ask.from || v.date > ask.to) { stray.push(v.date); continue; }
      // Inside only because the period was widened: another period's.
      if (v.date < p.from || v.date > p.to) continue;
    }
    vouchers.push(v);
    objects.push(obj);
  }
  return { vouchers, objects, stray, ms: res.ms, ask };
}

// Every voucher dated p.from..p.to as { guid, alterId, date }. Throws if Tally
// ignored the period, because an incomplete list would read as deletions.
async function pullVoucherList(client, company, p) {
  const ask = eduSafeRange(p.from, p.to);
  const res = await client.post(voucherListRequest({ company: company.name, ...ask }), {
    label: `${company.name}: voucher list ${p.from}…${p.to}`,
  });
  const all = voucherListFrom(res.tree);
  const stray = all.filter((v) => v.date && (v.date < ask.from || v.date > ask.to));
  if (stray.length) {
    throw new Error(`Tally ignored the period ${ask.from}…${ask.to} for ${company.name}'s voucher list (${stray.length} vouchers outside it)`);
  }
  return all.filter((v) => v.date && v.date >= p.from && v.date <= p.to);
}

// Tally's licence mode: { educational, licensed } (true / false / null).
async function pullSysInfo(client, { today }) {
  const res = await client.post(sysInfoRequest({ today }), { label: 'licence check' });
  return sysInfoFrom(res.tree, { probeDay: SYSINFO_PROBE_DAY });
}

module.exports = {
  listCompanies, pullMasters, pullPeriod, pullVoucherList, pullSysInfo, MASTER_PARSERS,
};
