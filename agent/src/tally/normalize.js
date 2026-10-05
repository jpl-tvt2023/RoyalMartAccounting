// Tally objects (as parsed by parse.js) → flat records RAMS can reason about.
//
// Written against Tally's XML as documented and as other integrations see it,
// but never trusting one path: a field is read from every place it is known to
// live, and each voucher also carries `docFields`, an index of every
// reference-like value it holds by tag path. Phase 0 searches that index for
// ROMS's numbers to learn where the accountant actually types them.
const { toArray, txt, field, yes, findAll, leafPaths, tallyDate, num } = require('./parse');

// GSTIN: 2-digit state, 10-char PAN, entity, 'Z', check digit.
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const panOf = (gstin) => (GSTIN_RE.test(gstin || '') ? gstin.slice(2, 12) : '');

// Tally's reserved voucher types. A custom type ("Sales-Zepto") is one of
// these underneath; its base type decides what it means for RAMS.
const BASE_TYPES = [
  'Attendance', 'Contra', 'Credit Note', 'Debit Note', 'Delivery Note', 'Job Work In Order',
  'Job Work Out Order', 'Journal', 'Material In', 'Material Out', 'Memorandum', 'Payment',
  'Payroll', 'Physical Stock', 'Purchase', 'Purchase Order', 'Receipt', 'Receipt Note',
  'Rejections In', 'Rejections Out', 'Reversing Journal', 'Sales', 'Sales Order', 'Stock Journal',
];
const BASE_BY_LOWER = new Map(BASE_TYPES.map((t) => [t.toLowerCase(), t]));

// Values that mean "nothing here" (Tally prefixes some with &#4;, which
// parse.js strips).
const BLANKISH = /^(not applicable|n\/?a|nil|none|-+|0|yes|no|primary|end of list)$/i;
const present = (s) => s !== '' && !BLANKISH.test(s);

const names = (obj) => {
  const out = [];
  for (const list of findAll(obj, 'NAME.LIST')) for (const n of toArray(list.NAME)) {
    const s = txt(n);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
};

// ---------------------------------------------------------------- masters

function companiesFrom(tree) {
  return findAll(tree, 'COMPANY').map((c) => ({
    name: field(c, 'NAME') || names(c)[0] || '',
    guid: txt(c.GUID),
    booksFrom: tallyDate(c.BOOKSFROM),
    startingFrom: tallyDate(c.STARTINGFROM),
    lastVoucherDate: tallyDate(c.LASTVOUCHERDATE),
    state: txt(c.STATENAME),
    altMstId: num(c.ALTMSTID),
    altVchId: num(c.ALTVCHID),
  })).filter((c) => c.name);
}

function groupsFrom(tree) {
  return findAll(tree, 'GROUP').map((g) => ({
    name: field(g, 'NAME') || names(g)[0] || '',
    parent: txt(g.PARENT),
    reserved: field(g, 'RESERVEDNAME'),
    guid: txt(g.GUID),
    alterId: num(g.ALTERID),
  })).filter((g) => g.name);
}

function voucherTypesFrom(tree) {
  return findAll(tree, 'VOUCHERTYPE').map((t) => ({
    name: field(t, 'NAME') || names(t)[0] || '',
    parent: txt(t.PARENT),
    reserved: field(t, 'RESERVEDNAME'),
    numbering: txt(t.NUMBERINGMETHOD),
    active: !/^no$/i.test(txt(t.ISACTIVE)),
    guid: txt(t.GUID),
    alterId: num(t.ALTERID),
  })).filter((t) => t.name);
}

function ledgersFrom(tree) {
  return findAll(tree, 'LEDGER').map((l) => {
    // GSTIN moved from PARTYGSTIN to LEDGSTREGDETAILS.LIST in TallyPrime 3;
    // take any value anywhere in the ledger that is shaped like one.
    const gstins = [...new Set(Object.values(leafPaths(l, () => true)).flat().filter((v) => GSTIN_RE.test(v)))];
    const statePaths = leafPaths(l, (p) => /(^|\/)(LEDSTATENAME|STATENAME|STATE)$/.test(p));
    const name = field(l, 'NAME') || names(l)[0] || '';
    return {
      name,
      aliases: names(l).filter((n) => n !== name),
      parent: txt(l.PARENT),
      guid: txt(l.GUID),
      masterId: num(l.MASTERID),
      alterId: num(l.ALTERID),
      gstins,
      state: (Object.values(statePaths).flat().find(present)) || '',
      billWise: yes(l.ISBILLWISEON),
    };
  }).filter((l) => l.name);
}

function stockItemsFrom(tree) {
  return findAll(tree, 'STOCKITEM').map((s) => {
    const name = field(s, 'NAME') || names(s)[0] || '';
    const hsn = Object.values(leafPaths(s, (p) => /HSNCODE$|HSN$/.test(p))).flat().find(present) || '';
    return {
      name,
      aliases: names(s).filter((n) => n !== name),
      parent: txt(s.PARENT),
      baseUnits: txt(s.BASEUNITS),
      hsn,
      guid: txt(s.GUID),
      alterId: num(s.ALTERID),
    };
  }).filter((s) => s.name);
}

// name → reserved base type, walking custom types up through their parents.
function baseTypeResolver(voucherTypes) {
  const byName = new Map(voucherTypes.map((t) => [t.name.toLowerCase(), t]));
  const memo = new Map();
  const guess = (name) => {
    // Without masters, fall back to the name itself ("Sales-Zepto" → Sales).
    const n = name.toLowerCase();
    for (const base of BASE_TYPES) if (n === base.toLowerCase()) return base;
    for (const base of BASE_TYPES) if (n.startsWith(base.toLowerCase())) return base;
    return 'Unknown';
  };
  const resolve = (typeName) => {
    const key = String(typeName || '').toLowerCase();
    const seen = new Set();
    for (let cur = byName.get(key); cur && !seen.has(cur.name.toLowerCase());) {
      seen.add(cur.name.toLowerCase());
      // A reserved type names itself in RESERVEDNAME.
      const reserved = BASE_BY_LOWER.get(cur.reserved.toLowerCase());
      if (reserved) return reserved;
      const parentKey = cur.parent.toLowerCase();
      if (!parentKey || parentKey === cur.name.toLowerCase()) return BASE_BY_LOWER.get(cur.name.toLowerCase()) || guess(cur.name);
      if (!byName.has(parentKey)) return BASE_BY_LOWER.get(parentKey) || guess(cur.parent);
      cur = byName.get(parentKey);
    }
    return BASE_BY_LOWER.get(key) || guess(typeName);
  };
  return (typeName) => {
    const key = String(typeName || '').toLowerCase();
    if (!memo.has(key)) memo.set(key, resolve(typeName));
    return memo.get(key);
  };
}

// ledger name → { chain: [group, …, primary], debtor, creditor }
function groupResolver(groups) {
  const parentOf = new Map(groups.map((g) => [g.name.toLowerCase(), g.parent]));
  const reservedOf = new Map(groups.map((g) => [g.name.toLowerCase(), g.reserved]));
  return (groupName) => {
    const chain = [];
    for (let g = groupName; g && !/^primary$/i.test(g) && !chain.includes(g) && chain.length < 12; g = parentOf.get(g.toLowerCase())) {
      chain.push(reservedOf.get(g.toLowerCase()) || g);
    }
    return {
      chain,
      primary: chain[chain.length - 1] || '',
      debtor: chain.some((g) => /^sundry debtors$/i.test(g)),
      creditor: chain.some((g) => /^sundry creditors$/i.test(g)),
    };
  };
}

// --------------------------------------------------------------- vouchers

// Leaf paths whose values are document references: voucher number, the
// reference field, bill-wise names, anything order- or number-shaped, UDFs.
const DOC_LEAF = /^(VOUCHERNUMBER|REFERENCE)$|ORDER(?!.*DATE$)|(NO|NUMBER|REF|REFERENCE|DOCNO|DOCUMENTNO)$|^UDF:/i;
const docPath = (p) => {
  const last = p.slice(p.lastIndexOf('/') + 1);
  return (DOC_LEAF.test(last) && !/DATE$|^IS|ALTERID|MASTERID|VOUCHERNUMBERSERIES/i.test(last))
    || /BILLALLOCATIONS\.LIST\/NAME$/.test(p);
};

function docFieldsOf(v) {
  const out = {};
  for (const [p, values] of Object.entries(leafPaths(v, docPath))) {
    const kept = [...new Set(values.filter((s) => present(s) && s.length <= 80))];
    if (kept.length) out[p] = kept;
  }
  return out;
}

// Invoice view keeps the party in LEDGERENTRIES.LIST, accounting view in
// ALLLEDGERENTRIES.LIST; a voucher carries one or the other, rarely both.
const firstNonEmpty = (v, keys) => {
  for (const k of keys) {
    const rows = toArray(v[k]);
    if (rows.length) return rows;
  }
  return [];
};

function ledgerLine(l) {
  return {
    ledger: txt(l.LEDGERNAME),
    amount: num(l.AMOUNT),
    isParty: yes(l.ISPARTYLEDGER),
    debit: yes(l.ISDEEMEDPOSITIVE),
    bills: toArray(l['BILLALLOCATIONS.LIST'])
      .map((b) => ({ name: txt(b.NAME), type: txt(b.BILLTYPE), amount: num(b.AMOUNT) }))
      .filter((b) => b.name || b.type),
  };
}

function inventoryLine(i, direction) {
  const qtyText = txt(i.BILLEDQTY) || txt(i.ACTUALQTY);
  const batches = toArray(i['BATCHALLOCATIONS.LIST']);
  return {
    item: txt(i.STOCKITEMNAME),
    qty: num(qtyText),
    unit: (/[A-Za-z][\w.]*\s*$/.exec(qtyText) || [''])[0].trim(),
    rate: num(i.RATE),
    amount: num(i.AMOUNT),
    direction,
    godowns: [...new Set(batches.map((b) => txt(b.GODOWNNAME)).filter(present))],
    orderNos: [...new Set(batches.map((b) => txt(b.ORDERNO)).filter(present))],
  };
}

// docFields (the Phase 0 discovery index) is left out of what the sync sends.
function voucherFrom(v, { baseTypeOf = () => 'Unknown', docFields = true } = {}) {
  const type = txt(v.VOUCHERTYPENAME) || field(v, 'VCHTYPE');
  const ledgerLines = firstNonEmpty(v, ['ALLLEDGERENTRIES.LIST', 'LEDGERENTRIES.LIST']).map(ledgerLine);
  const inventoryLines = [
    ...firstNonEmpty(v, ['ALLINVENTORYENTRIES.LIST', 'INVENTORYENTRIES.LIST']).map((i) => inventoryLine(i, '')),
    ...toArray(v['INVENTORYENTRIESIN.LIST']).map((i) => inventoryLine(i, 'in')),
    ...toArray(v['INVENTORYENTRIESOUT.LIST']).map((i) => inventoryLine(i, 'out')),
  ];
  const orders = toArray(v['INVOICEORDERLIST.LIST'])
    .map((o) => ({ no: txt(o.BASICPURCHASEORDERNO), date: tallyDate(o.BASICORDERDATE) }))
    .filter((o) => present(o.no));
  const party = txt(v.PARTYLEDGERNAME) || txt(v.PARTYNAME)
    || (ledgerLines.find((l) => l.isParty) || {}).ledger || '';
  const partyLine = ledgerLines.find((l) => l.isParty) || ledgerLines.find((l) => l.ledger === party);
  const amounts = ledgerLines.map((l) => Math.abs(l.amount || 0));
  return {
    guid: txt(v.GUID) || field(v, 'REMOTEID'),
    masterId: num(v.MASTERID),
    alterId: num(v.ALTERID),
    date: tallyDate(v.DATE),
    type,
    baseType: baseTypeOf(type),
    number: txt(v.VOUCHERNUMBER),
    reference: txt(v.REFERENCE),
    referenceDate: tallyDate(v.REFERENCEDATE),
    party,
    partyGstin: txt(v.PARTYGSTIN),
    cmpGstin: txt(v.CMPGSTIN) || field(v.GSTREGISTRATION, 'TAXREGISTRATION'),
    narration: txt(v.NARRATION).slice(0, 300),
    cancelled: yes(v.ISCANCELLED),
    optional: yes(v.ISOPTIONAL),
    invoice: yes(v.ISINVOICE),
    total: partyLine && partyLine.amount != null ? Math.abs(partyLine.amount) : (amounts.length ? Math.max(...amounts) : null),
    orders,
    ledgerLines,
    inventoryLines,
    ...(docFields ? { docFields: docFieldsOf(v) } : {}),
  };
}

function vouchersFrom(tree, ctx) {
  return findAll(tree, 'VOUCHER').map((v) => voucherFrom(v, ctx));
}

// The end-of-day check's list: { guid, alterId, date } per voucher.
function voucherListFrom(tree) {
  return findAll(tree, 'VOUCHER').map((v) => ({
    guid: txt(v.GUID) || field(v, 'REMOTEID'),
    alterId: num(v.ALTERID),
    date: tallyDate(v.DATE),
  })).filter((v) => v.guid);
}

// The licence check (requests.js sysInfoRequest): { educational, licensed },
// each true / false / null when Tally left it blank. Educational mode also
// gives itself away by swapping the 15th it was asked to echo.
function sysInfoFrom(tree, { probeDay = 15 } = {}) {
  const row = findAll(tree, 'ROW')[0];
  if (!row) return { educational: null, licensed: null };
  const flag = (v) => (/^yes$/i.test(txt(v)) ? true : /^no$/i.test(txt(v)) ? false : null);
  let educational = flag(row.EDUCATIONAL);
  const echoed = /^(\d{1,2})-/.exec(txt(row.FROMDATE)) || /^\d{6}(\d{2})$/.exec(txt(row.FROMDATE));
  if (educational == null && echoed) educational = Number(echoed[1]) !== probeDay;
  return { educational, licensed: flag(row.LICENSED) };
}

module.exports = {
  GSTIN_RE, panOf, BASE_TYPES, BLANKISH, present,
  companiesFrom, groupsFrom, voucherTypesFrom, ledgersFrom, stockItemsFrom,
  baseTypeResolver, groupResolver, voucherFrom, vouchersFrom, docFieldsOf, voucherListFrom, sysInfoFrom,
};
