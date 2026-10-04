// The XML envelopes the Connector sends to Tally.
//
// Every request here is an EXPORT. Nothing in this file can create, alter or
// delete anything in Tally — RAMS reads Tally only.
//
//   companies   Collection export of the loaded companies, with the AltMstId /
//               AltVchId counters the light sync will watch. Same shape as the
//               one tally-database-loader uses in production.
//   masters     The built-in "List of Accounts" report, one AccountType at a
//               time (Groups, Ledgers, Stock Items, Voucher Types). Exports
//               whole master objects.
//   dayBook     The built-in "DayBook" report for a date range. Exports whole
//               voucher objects — ledger lines, inventory lines, bill
//               allocations, order details — which is what Phase 0 needs to
//               discover where the accountant actually keeps each number.
const { parseXml, findAll, txt } = require('./parse');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// '2026-04-01' → '1-Apr-2026', the form Tally's own samples use.
function tallyDateArg(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || '');
  if (!m) throw new Error(`Bad date ${isoDate} (use YYYY-MM-DD)`);
  return `${Number(m[3])}-${MONTHS[Number(m[2]) - 1]}-${m[1]}`;
}

// Either form Tally accepts, back to ISO: '1-Apr-2026' or '20260401'.
function isoFromTally(s) {
  const v = String(s || '').trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec(v);
  if (m) {
    const mon = MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase()) + 1;
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    if (mon) return `${year}-${String(mon).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return v;
}

function envelope({ type, id, vars = {}, tdl = '' }) {
  const statics = Object.entries({ SVEXPORTFORMAT: '$$SysName:XML', ...vars })
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => (/^SV(FROM|TO)DATE$/.test(k)
      ? `<${k} TYPE="Date">${esc(tallyDateArg(v))}</${k}>`
      : `<${k}>${esc(v)}</${k}>`))
    .join('');
  return '<ENVELOPE>'
    + `<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>${type}</TYPE><ID>${esc(id)}</ID></HEADER>`
    + `<BODY><DESC><STATICVARIABLES>${statics}</STATICVARIABLES>`
    + (tdl ? `<TDL><TDLMESSAGE>${tdl}</TDLMESSAGE></TDL>` : '')
    + '</DESC></BODY></ENVELOPE>';
}

const COMPANY_COLLECTION = 'RAMS Companies';
const COMPANY_FETCH = {
  // Name/GUID/state help tell MH, HR and WB apart; the counters drive the
  // light sync. If a release rejects one of these, `minimal` is the exact
  // FETCH tally-database-loader ships with.
  full: 'Name, GUID, BooksFrom, StartingFrom, AltMstId, AltVchId, LastVoucherDate, StateName',
  minimal: 'BooksFrom, AltMstId, AltVchId',
};

function companiesRequest({ minimal = false } = {}) {
  return envelope({
    type: 'Collection',
    id: COMPANY_COLLECTION,
    tdl: `<COLLECTION NAME="${COMPANY_COLLECTION}" ISMODIFY="No"><TYPE>Company</TYPE>`
      + `<FETCH>${minimal ? COMPANY_FETCH.minimal : COMPANY_FETCH.full}</FETCH></COLLECTION>`,
  });
}

const MASTER_TYPES = ['Groups', 'Ledgers', 'Stock Items', 'Voucher Types'];

function mastersRequest({ company, accountType }) {
  return envelope({
    type: 'Data',
    id: 'List of Accounts',
    vars: { SVCURRENTCOMPANY: company, ACCOUNTTYPE: accountType },
  });
}

function dayBookRequest({ company, from, to }) {
  return envelope({
    type: 'Data',
    id: 'DayBook',
    vars: { SVCURRENTCOMPANY: company, SVFROMDATE: from, SVTODATE: to },
  });
}

// What a request asks for, read back from its XML. The mock Tally routes on
// this, and recorded responses are filed under `key`, so a recording can be
// replayed for the same request later.
function describeRequest(xml) {
  const tree = parseXml(xml);
  const header = findAll(tree, 'HEADER')[0] || {};
  const sv = findAll(tree, 'STATICVARIABLES')[0] || {};
  const vars = {};
  for (const [k, v] of Object.entries(sv)) if (!k.startsWith('@_')) vars[k.toUpperCase()] = txt(v);
  const d = {
    type: txt(header.TYPE),
    id: txt(header.ID),
    company: vars.SVCURRENTCOMPANY || '',
    accountType: vars.ACCOUNTTYPE || '',
    from: vars.SVFROMDATE ? isoFromTally(vars.SVFROMDATE) : '',
    to: vars.SVTODATE ? isoFromTally(vars.SVTODATE) : '',
  };
  d.key = [d.type, d.id, d.company, d.accountType, d.from, d.to].join('|').toLowerCase();
  return d;
}

module.exports = {
  tallyDateArg, isoFromTally, envelope, companiesRequest, mastersRequest, dayBookRequest,
  describeRequest, MASTER_TYPES, COMPANY_COLLECTION,
};
