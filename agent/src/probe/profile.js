// The Tally-only profile of a probe folder: what the accountant's books look
// like, per company, before anything is compared with ROMS. It answers the
// Phase 0 questions that need only Tally — number formats and '/', Buyer's
// Order No fill, how CN/DN are booked, how transfers are vouchered, which
// parties are internal — and writes profile.json + profile.md.
const fs = require('fs');
const path = require('path');
const { readProbe } = require('./store');
const { groupResolver, panOf, GSTIN_RE } = require('../tally/normalize');
const { OUR_PAN, EXPECTED_GSTINS, STATE_CODES, STATE_NAMES, ROMS_REF_RULE } = require('../config');
const { mask, exactKey } = require('../docno');
const { inc, top, addExample, fyOf, pct, mdTable, writeJson } = require('../util');

const STOCK_BASES = new Set(['Stock Journal', 'Delivery Note', 'Receipt Note', 'Material In', 'Material Out', 'Rejections In', 'Rejections Out']);
const TRANSFER_HINT = /transfer|branch|fba|consign/i;
const isLive = (v) => !v.cancelled && !v.optional;
const billsOf = (v) => v.ledgerLines.flatMap((l) => l.bills);
const isAgst = (b) => /agst/i.test(b.type);

function companyIdentity(info, vouchers) {
  const seen = {};
  for (const v of vouchers) if (GSTIN_RE.test(v.cmpGstin)) inc(seen, v.cmpGstin);
  const gstin = (top(seen, 1)[0] || [''])[0];
  const fromName = (/\b(MH|HR|WB)\b/i.exec(info.name) || [])[1];
  const code = (gstin && STATE_CODES[gstin.slice(0, 2)])
    || STATE_NAMES[String(info.state || '').toLowerCase()]
    || (fromName ? fromName.toUpperCase() : '')
    || info.slug;
  return { code, gstin, gstinsSeen: seen, expected: Object.values(EXPECTED_GSTINS).includes(gstin) };
}

// Count a voucher's reference-like fields by tag path, with a few examples.
function addPaths(paths, v, test = () => true) {
  for (const [p, values] of Object.entries(v.docFields || {})) {
    if (!test(p)) continue;
    const e = paths[p] || (paths[p] = { path: p, vouchers: 0, examples: [] });
    e.vouchers++;
    for (const x of values) addExample(e.examples, x, 3);
  }
}
const sortedPaths = (paths, n = 12) => Object.values(paths).sort((a, b) => b.vouchers - a.vouchers).slice(0, n);

// (company slug, ledger name) → is it one of our own registrations? Yes when
// the ledger's GSTIN carries our PAN, or it is named exactly like another
// open company.
function makeInternalCheck(companies, pan = OUR_PAN) {
  const names = companies.map((c) => c.info.name.toLowerCase());
  const own = new Map(companies.map((c) => [c.slug, c.info.name.toLowerCase()]));
  const ledgers = new Map(companies.map((c) => [c.slug, new Map((c.masters.ledgers || []).map((l) => [l.name.toLowerCase(), l]))]));
  return (slug, name) => {
    const key = String(name || '').toLowerCase();
    if (!key) return false;
    const l = (ledgers.get(slug) || new Map()).get(key);
    return Boolean(l && l.gstins.some((g) => panOf(g) === pan)) || (key !== own.get(slug) && names.includes(key));
  };
}

function profileCompany(c, { isInternal, run }) {
  const { info, masters, vouchers } = c;
  const groupOf = groupResolver(masters.groups || []);
  const ledgerByName = new Map((masters.ledgers || []).map((l) => [l.name.toLowerCase(), l]));
  const internal = (name) => isInternal(c.slug, name);
  const live = vouchers.filter(isLive);
  const identity = companyIdentity(info, vouchers);
  const warnings = [];

  // Voucher types.
  const types = {};
  for (const v of vouchers) {
    const t = types[v.type] || (types[v.type] = {
      type: v.type, baseType: v.baseType, total: 0, live: 0, cancelled: 0, optional: 0, byFy: {}, withLedgerLines: 0, withInventory: 0, withOrderNo: 0,
    });
    t.total++;
    if (v.cancelled) { t.cancelled++; continue; }
    if (v.optional) { t.optional++; continue; }
    t.live++;
    inc(t.byFy, fyOf(v.date));
    if (v.ledgerLines.length) t.withLedgerLines++;
    if (v.inventoryLines.length) t.withInventory++;
    if (v.orders.length) t.withOrderNo++;
  }

  // Number formats per base type, and numbers that repeat (often a series
  // restarting each financial year — matching must then look at the date).
  const numbering = {};
  const byNumber = {};
  for (const v of live) {
    const n = numbering[v.baseType] || (numbering[v.baseType] = {
      baseType: v.baseType, live: 0, blank: 0, withSlash: 0, failsRomsRule: 0, masks: {}, maskExample: {}, repeated: 0, repeatedExamples: [],
    });
    n.live++;
    if (!v.number) { n.blank++; continue; }
    if (v.number.includes('/')) n.withSlash++;
    if (!ROMS_REF_RULE.test(v.number)) n.failsRomsRule++;
    const m = mask(v.number);
    inc(n.masks, m);
    if (!n.maskExample[m]) n.maskExample[m] = v.number;
    const forBase = byNumber[v.baseType] || (byNumber[v.baseType] = {});
    (forBase[exactKey(v.number)] || (forBase[exactKey(v.number)] = [])).push(v);
  }
  for (const [base, nums] of Object.entries(byNumber)) {
    for (const list of Object.values(nums)) {
      if (list.length < 2) continue;
      numbering[base].repeated++;
      addExample(numbering[base].repeatedExamples, `${list[0].number} (${list.map((v) => v.date).join(', ')})`);
    }
  }
  const numberFormats = Object.values(numbering)
    .sort((a, b) => b.live - a.live)
    .map(({ masks, maskExample, ...n }) => ({
      ...n, formats: top(masks, 6).map(([m, count]) => ({ mask: m, count, example: maskExample[m] })),
    }));

  // Buyer's Order No on sales.
  const sales = live.filter((v) => v.baseType === 'Sales');
  const orderPaths = {};
  const orderByParty = {};
  for (const v of sales) {
    addPaths(orderPaths, v, (p) => /ORDER/i.test(p));
    const p = orderByParty[v.party || '(none)'] || (orderByParty[v.party || '(none)'] = { party: v.party || '(none)', vouchers: 0, withOrderNo: 0 });
    p.vouchers++;
    if (v.orders.length) p.withOrderNo++;
  }
  const buyerOrder = {
    salesVouchers: sales.length,
    withOrderNo: sales.filter((v) => v.orders.length).length,
    paths: sortedPaths(orderPaths),
    byParty: Object.values(orderByParty).sort((a, b) => b.vouchers - a.vouchers).slice(0, 12),
  };

  // Credit and debit notes.
  const salesNumbers = new Set(sales.map((v) => exactKey(v.number)).filter(Boolean));
  const notes = ['Credit Note', 'Debit Note'].map((base) => {
    const list = live.filter((v) => v.baseType === base);
    const billTypes = {}, typeNames = {}, parties = {}, refFormats = {}, paths = {};
    let withAgstRef = 0, agstRefToKnownSale = 0;
    for (const v of list) {
      inc(typeNames, v.type);
      if (v.party) inc(parties, v.party);
      const bills = billsOf(v);
      for (const b of bills) inc(billTypes, b.type || '(blank)');
      const agst = bills.filter(isAgst);
      if (agst.length) withAgstRef++;
      if (agst.some((b) => salesNumbers.has(exactKey(b.name)))) agstRefToKnownSale++;
      if (v.reference) inc(refFormats, mask(v.reference));
      addPaths(paths, v);
    }
    return {
      baseType: base,
      count: list.length,
      withReference: list.filter((v) => v.reference).length,
      withInventory: list.filter((v) => v.inventoryLines.length).length,
      withAgstRef,
      agstRefToKnownSale,
      billTypes,
      typeNames,
      parties: top(parties, 8),
      referenceFormats: top(refFormats, 5),
      paths: sortedPaths(paths),
    };
  });

  // Stock transfers and anything else touching our own registrations.
  const internalLedgers = (masters.ledgers || []).filter((l) => internal(l.name))
    .map((l) => ({ name: l.name, gstins: l.gstins, group: l.parent }));
  const transferGroups = {};
  for (const v of live) {
    const internalParty = internal(v.party);
    const internalLine = v.ledgerLines.some((l) => internal(l.ledger));
    const why = [
      internalParty && 'party is our own registration',
      !internalParty && internalLine && 'a ledger line is our own registration',
      STOCK_BASES.has(v.baseType) && `${v.baseType} voucher`,
      TRANSFER_HINT.test(v.type) && 'type name suggests a transfer',
    ].filter(Boolean);
    if (!why.length) continue;
    const key = [v.baseType, v.type, v.party].join('|');
    const g = transferGroups[key] || (transferGroups[key] = {
      baseType: v.baseType, type: v.type, party: v.party || '(none)', internal: internalParty || internalLine, vouchers: 0, examples: [], why,
    });
    g.vouchers++;
    addExample(g.examples, v.number, 3);
  }

  // Parties by use.
  const partyUse = {};
  for (const v of live) {
    if (!v.party) continue;
    const p = partyUse[v.party] || (partyUse[v.party] = { vouchers: 0, baseTypes: {} });
    p.vouchers++;
    inc(p.baseTypes, v.baseType);
  }
  const parties = Object.entries(partyUse).sort((a, b) => b[1].vouchers - a[1].vouchers).slice(0, 40).map(([name, use]) => {
    const l = ledgerByName.get(name.toLowerCase());
    const g = groupOf(l ? l.parent : '');
    return {
      ledger: name,
      vouchers: use.vouchers,
      baseTypes: use.baseTypes,
      group: l ? l.parent : '(not in ledger masters)',
      primaryGroup: g.primary,
      debtor: g.debtor,
      gstin: l ? (l.gstins[0] || '') : '',
      state: l ? l.state : '',
      internal: internal(name),
    };
  });

  // Stock items.
  const itemsUsed = new Set(live.flatMap((v) => v.inventoryLines.map((i) => i.item)).filter(Boolean));
  const itemNames = new Set((masters.stockItems || []).map((s) => s.name));
  const stockItems = {
    count: (masters.stockItems || []).length,
    withHsn: (masters.stockItems || []).filter((s) => s.hsn).length,
    withAliases: (masters.stockItems || []).filter((s) => s.aliases.length).length,
    usedOnVouchers: itemsUsed.size,
    usedButNotInMasters: [...itemsUsed].filter((i) => !itemNames.has(i)).slice(0, 10),
    examples: (masters.stockItems || []).slice(0, 12).map((s) => s.name),
  };

  const receipts = live.filter((v) => v.baseType === 'Receipt');
  const journals = live.filter((v) => v.baseType === 'Journal');
  const settlement = {
    receipts: receipts.length,
    receiptsWithAgstRef: receipts.filter((v) => billsOf(v).some(isAgst)).length,
    journals: journals.length,
    journalsWithBills: journals.filter((v) => billsOf(v).length).length,
    salesWithNewRef: sales.filter((v) => billsOf(v).some((b) => /new/i.test(b.type))).length,
  };

  // Things that would make the numbers above untrustworthy.
  const runEntry = (run.companies || []).find((x) => x.slug === c.slug) || {};
  for (const e of runEntry.errors || []) warnings.push(`Export error — ${e}`);
  if (!vouchers.length) warnings.push('No vouchers came back for the period. Check the dates, and that this company has entries.');
  const bare = live.filter((v) => !v.ledgerLines.length && !v.inventoryLines.length).length;
  if (bare) warnings.push(`${bare} vouchers came back with no ledger or inventory lines — check samples/${c.slug}/ for the raw shape.`);
  if (!(masters.voucherTypes || []).length) warnings.push('Voucher-type masters missing: base types were guessed from type names.');
  if (!(masters.ledgers || []).length) warnings.push('Ledger masters missing: internal parties found by name only.');
  const unknown = live.filter((v) => v.baseType === 'Unknown').length;
  if (unknown) warnings.push(`${unknown} vouchers have a type whose base type could not be resolved.`);
  if (identity.gstin && !identity.expected) warnings.push(`GSTIN on vouchers (${identity.gstin}) is not one of Roymax's three.`);
  if (sales.length && settlement.salesWithNewRef < sales.length * 0.5) {
    warnings.push(`Only ${pct(settlement.salesWithNewRef, sales.length)} of sales carry a bill-wise New Ref — outstanding per invoice may not be derivable.`);
  }

  return {
    slug: c.slug,
    name: info.name,
    ...identity,
    booksFrom: info.booksFrom,
    altVchId: info.altVchId,
    altMstId: info.altMstId,
    vouchers: vouchers.length,
    liveVouchers: live.length,
    voucherTypes: Object.values(types).sort((a, b) => b.total - a.total),
    numberFormats,
    buyerOrder,
    notes,
    internalLedgers,
    transfers: Object.values(transferGroups).sort((a, b) => b.vouchers - a.vouchers),
    parties,
    stockItems,
    settlement,
    warnings,
  };
}

// Sales/CN/DN numbers used in more than one company: matching on number
// alone would be ambiguous for these.
function crossCompany(companies, profiles) {
  const seen = {};
  for (const c of companies) {
    const code = profiles.find((p) => p.slug === c.slug).code;
    for (const v of c.vouchers) {
      if (!isLive(v) || !v.number || !['Sales', 'Credit Note', 'Debit Note'].includes(v.baseType)) continue;
      const key = `${v.baseType}|${exactKey(v.number)}`;
      const e = seen[key] || (seen[key] = { baseType: v.baseType, number: v.number, companies: new Set() });
      e.companies.add(code);
    }
  }
  const collisions = Object.values(seen).filter((e) => e.companies.size > 1);
  const byBase = {};
  for (const e of collisions) inc(byBase, e.baseType);
  return {
    collisions: collisions.length,
    byBaseType: byBase,
    examples: collisions.slice(0, 8).map((e) => `${e.baseType} ${e.number} (${[...e.companies].join(', ')})`),
  };
}

function buildProfile(outDir, { pan = OUR_PAN } = {}) {
  const { run, companies } = readProbe(outDir);
  const isInternal = makeInternalCheck(companies, pan);
  const profiles = companies.map((c) => profileCompany(c, { isInternal, run }));
  const profile = {
    generatedAt: new Date().toISOString(),
    probe: {
      tally: run.tally, version: run.version, from: run.from, to: run.to,
      startedAt: run.startedAt, finishedAt: run.finishedAt, errors: run.errors, skippedCompanies: run.skippedCompanies,
    },
    companies: profiles,
    crossCompany: crossCompany(companies, profiles),
  };
  writeJson(path.join(outDir, 'profile.json'), profile);
  fs.writeFileSync(path.join(outDir, 'profile.md'), renderProfile(profile));
  return profile;
}

// ---------------------------------------------------------------- report

const list = (obj) => top(obj).map(([k, n]) => `${k} ×${n}`).join(', ');

function renderCompany(p) {
  const out = [];
  out.push(`## ${p.code} — ${p.name}`);
  if (p.warnings.length) out.push(p.warnings.map((w) => `> ⚠ ${w}`).join('\n>\n'));

  const fys = [...new Set(p.voucherTypes.flatMap((t) => Object.keys(t.byFy)))].sort();
  out.push('### Voucher types');
  out.push(mdTable(
    ['Type', 'Base type', 'Live', ...fys.map((f) => `FY ${f}`), 'Cancelled', 'Optional', 'With items'],
    p.voucherTypes.map((t) => [t.type, t.baseType, t.live, ...fys.map((f) => t.byFy[f] || 0), t.cancelled, t.optional, t.withInventory]),
  ));

  out.push('### Voucher numbers');
  out.push(`ROMS accepts only letters, digits and '-' in Bill No and CN/DN numbers.`);
  out.push(mdTable(
    ['Base type', 'Live', "Has '/'", 'ROMS would reject', 'Blank', 'Repeated', 'Formats (shape ×count, e.g.)'],
    p.numberFormats.map((n) => [
      n.baseType, n.live, `${n.withSlash} (${pct(n.withSlash, n.live)})`, `${n.failsRomsRule} (${pct(n.failsRomsRule, n.live)})`,
      n.blank, n.repeated, n.formats.map((f) => `\`${f.mask}\` ×${f.count} (${f.example})`).join('<br>'),
    ]),
  ));
  const repeats = p.numberFormats.filter((n) => n.repeated);
  if (repeats.length) out.push(`Repeated numbers (same number on more than one voucher of a base type): ${repeats.map((n) => `${n.baseType}: ${n.repeatedExamples.join('; ')}`).join(' — ')}`);

  const bo = p.buyerOrder;
  out.push("### Buyer's Order No on sales");
  out.push(`${bo.withOrderNo} of ${bo.salesVouchers} live sales vouchers (${pct(bo.withOrderNo, bo.salesVouchers)}) carry an order number in the invoice's Order Details.`);
  if (bo.paths.length) {
    out.push(mdTable(['Where (tag path)', 'Sales vouchers', 'Examples'], bo.paths.map((x) => [x.path, x.vouchers, x.examples.join(', ')])));
  }
  if (bo.byParty.length) {
    out.push(mdTable(['Party', 'Sales', 'With order no'], bo.byParty.map((x) => [x.party, x.vouchers, `${x.withOrderNo} (${pct(x.withOrderNo, x.vouchers)})`])));
  }

  out.push('### Credit and debit notes');
  out.push(mdTable(
    ['Base type', 'Count', 'With Reference', 'Bill-wise Agst Ref', 'Agst Ref = a sales invoice no', 'With items', 'Types used', 'Bill types'],
    p.notes.map((n) => [n.baseType, n.count, n.withReference, n.withAgstRef, n.agstRefToKnownSale, n.withInventory, list(n.typeNames), list(n.billTypes)]),
  ));
  for (const n of p.notes.filter((x) => x.count)) {
    out.push(`**${n.baseType} — where numbers are kept** (parties: ${n.parties.map(([k, c]) => `${k} ×${c}`).join(', ') || '—'})`);
    out.push(mdTable(['Tag path', 'Vouchers', 'Examples'], n.paths.map((x) => [x.path, x.vouchers, x.examples.join(', ')])));
  }

  out.push('### Stock transfers and our own registrations');
  out.push(p.internalLedgers.length
    ? `Internal ledgers (GSTIN carries Roymax's PAN, or named like another open company): ${p.internalLedgers.map((l) => `${l.name} [${l.gstins.join(', ') || 'no GSTIN'}]`).join('; ')}`
    : 'No internal ledgers found — transfers between MH/HR/WB may be booked against ledgers without a GSTIN; check the parties below.');
  if (p.transfers.length) {
    out.push(mdTable(
      ['Base type', 'Type', 'Party', 'Internal', 'Vouchers', 'Examples', 'Why listed'],
      p.transfers.slice(0, 25).map((t) => [t.baseType, t.type, t.party, t.internal ? 'yes' : '', t.vouchers, t.examples.join(', '), t.why.join('; ')]),
    ));
  }

  out.push('### Parties');
  out.push(mdTable(
    ['Ledger', 'Group', 'Debtor', 'GSTIN', 'State', 'Internal', 'Vouchers', 'Base types'],
    p.parties.map((x) => [x.ledger, x.group, x.debtor ? 'yes' : '', x.gstin, x.state, x.internal ? 'yes' : '', x.vouchers, list(x.baseTypes)]),
  ));

  const s = p.stockItems;
  out.push('### Stock items and settlement');
  out.push([
    `- Stock items: ${s.count} (${s.withHsn} with HSN, ${s.withAliases} with an alias); ${s.usedOnVouchers} used on vouchers in the period.`,
    s.usedButNotInMasters.length ? `- Used on vouchers but missing from masters: ${s.usedButNotInMasters.join(', ')}` : '',
    `- Examples: ${s.examples.join(', ')}`,
    `- Sales with a bill-wise New Ref: ${p.settlement.salesWithNewRef} of ${p.buyerOrder.salesVouchers}.`,
    `- Receipts: ${p.settlement.receipts}, of which ${p.settlement.receiptsWithAgstRef} settle bills (Agst Ref).`,
    `- Journals: ${p.settlement.journals}, of which ${p.settlement.journalsWithBills} touch bills (TDS / adjustments).`,
  ].filter(Boolean).join('\n'));
  return out.join('\n\n');
}

function renderProfile(profile) {
  const pr = profile.probe;
  const out = [
    '# RAMS Phase 0 — Tally profile',
    `Read from Tally at ${pr.tally} for ${pr.from} … ${pr.to} by RAMS Connector ${pr.version}, ${pr.startedAt} → ${pr.finishedAt || 'unfinished'}. Read-only: nothing was written to Tally.`,
  ];
  if (pr.errors.length) out.push(pr.errors.map((e) => `> ⚠ ${e}`).join('\n>\n'));
  if (pr.skippedCompanies.length) out.push(`Open but not probed: ${pr.skippedCompanies.join(', ')}`);
  out.push('## Companies');
  out.push(mdTable(
    ['Code', 'Company', 'GSTIN on vouchers', 'Books from', 'Vouchers', 'Live', 'AltVchId', 'AltMstId', 'Warnings'],
    profile.companies.map((p) => [p.code, p.name, `${p.gstin || '—'}${p.gstin && !p.expected ? ' (unexpected)' : ''}`, p.booksFrom, p.vouchers, p.liveVouchers, p.altVchId ?? '—', p.altMstId ?? '—', p.warnings.length]),
  ));
  const cc = profile.crossCompany;
  out.push(cc.collisions
    ? `**${cc.collisions} sales/CN/DN numbers appear in more than one company** (${list(cc.byBaseType)}), e.g. ${cc.examples.join('; ')}. A ROMS number matching one of these is ambiguous without the Buyer's Order No or party.`
    : 'No sales/CN/DN number is used in more than one company.');
  for (const p of profile.companies) out.push(renderCompany(p));
  return out.join('\n\n') + '\n';
}

module.exports = { buildProfile, profileCompany, renderProfile, makeInternalCheck };
