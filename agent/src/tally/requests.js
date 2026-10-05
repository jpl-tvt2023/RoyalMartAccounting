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
//   vouchers    Collection export of the vouchers in a period. Exports whole
//               voucher objects — ledger lines, inventory lines, bill
//               allocations, order details — which is what Phase 0 needs to
//               discover where the accountant actually keeps each number.
//               (The built-in DayBook report would be simpler, but TallyPrime
//               7.1 exports it for one day only, whatever range is asked.)
//   changed     The same, filtered to vouchers altered after an AlterID: the
//               light sync.
//   list        GUID, AlterID and date only: the end-of-day deletion check.
//   sysinfo     A tiny report of Tally's licence mode, for the heartbeat.
const { parseXml, findAll, txt } = require('./parse');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// '2026-04-01' → '20260401'. TallyPrime 7.1's DayBook ignored '1-Apr-2026'
// (the form Tally's older samples use) but took this one.
function tallyDateArg(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || '');
  if (!m) throw new Error(`Bad date ${isoDate} (use YYYY-MM-DD)`);
  return `${m[1]}${m[2]}${m[3]}`;
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

const VOUCHER_COLLECTION = 'RAMS Vouchers';
// NATIVEMETHOD * brings every plain field; sub-lists come only when fetched
// by name. Checked against DayBook on TallyPrime 7.1: every document field it
// exports is here too, and invoices also carry their accounting-view lines.
const VOUCHER_LISTS = [
  'AllLedgerEntries', 'LedgerEntries', 'AllInventoryEntries', 'InventoryEntries',
  'InventoryEntriesIn', 'InventoryEntriesOut', 'InvoiceOrderList', 'InvoiceDelNotes',
  'Address', 'BasicBuyerAddress', 'EwayBillDetails', 'GST', 'OrigInvoiceDetails',
];

function vouchersRequest({ company, from, to }) {
  return envelope({
    type: 'Collection',
    id: VOUCHER_COLLECTION,
    vars: { SVCURRENTCOMPANY: company, SVFROMDATE: from, SVTODATE: to },
    tdl: `<COLLECTION NAME="${VOUCHER_COLLECTION}" ISMODIFY="No"><TYPE>Voucher</TYPE>`
      + `<FETCH>${VOUCHER_LISTS.join(', ')}</FETCH><NATIVEMETHOD>*</NATIVEMETHOD></COLLECTION>`,
  });
}

// The light sync's request: the same voucher collection, but only vouchers
// altered after `afterAlterId` (Tally's AltVchId when RAMS last synced). Checked
// on TallyPrime 7.1: 27 changed vouchers came back in 1.5 s, none in 0.6 s.
const CHANGED_COLLECTION = 'RAMS Changed Vouchers';
function changedVouchersRequest({ company, from, to, afterAlterId }) {
  const after = Number(afterAlterId);
  if (!Number.isInteger(after) || after < 0) throw new Error(`Bad AlterID ${afterAlterId}`);
  return envelope({
    type: 'Collection',
    id: CHANGED_COLLECTION,
    vars: { SVCURRENTCOMPANY: company, SVFROMDATE: from, SVTODATE: to },
    tdl: `<COLLECTION NAME="${CHANGED_COLLECTION}" ISMODIFY="No"><TYPE>Voucher</TYPE>`
      + `<FETCH>${VOUCHER_LISTS.join(', ')}</FETCH><NATIVEMETHOD>*</NATIVEMETHOD>`
      + '<FILTER>RAMSAlteredAfter</FILTER></COLLECTION>'
      + `<SYSTEM TYPE="Formulae" NAME="RAMSAlteredAfter">$AlterID &gt; ${after}</SYSTEM>`,
  });
}

// The end-of-day check's request: just each voucher's GUID, AlterID and date
// in a period, to find what was deleted. A month of MH (1,179 vouchers) takes
// 0.3 s.
const LIST_COLLECTION = 'RAMS Voucher List';
function voucherListRequest({ company, from, to }) {
  return envelope({
    type: 'Collection',
    id: LIST_COLLECTION,
    vars: { SVCURRENTCOMPANY: company, SVFROMDATE: from, SVTODATE: to },
    tdl: `<COLLECTION NAME="${LIST_COLLECTION}" ISMODIFY="No"><TYPE>Voucher</TYPE>`
      + '<FETCH>GUID, AlterID, Date</FETCH></COLLECTION>',
  });
}

// The heartbeat's licence check: one row per loaded company carrying Tally's
// licence flags, and SVFROMDATE echoed back. Educational mode swaps the 15th
// for a date it accepts, which tells it apart even where the flags are blank.
// (A report prints nothing to XML without the REPEAT and the XMLTAGs.)
const SYSINFO_REPORT = 'RAMS SysInfo';
const SYSINFO_PROBE_DAY = 15;
function sysInfoRequest({ today }) {
  const echo = `${today.slice(0, 8)}${SYSINFO_PROBE_DAY}`;
  const field = (name, tag, formula) => `<FIELD NAME="${name}"><SET>${formula}</SET><XMLTAG>${tag}</XMLTAG></FIELD>`;
  return envelope({
    type: 'Data',
    id: SYSINFO_REPORT,
    vars: { SVFROMDATE: echo },
    tdl: `<REPORT NAME="${SYSINFO_REPORT}"><FORMS>${SYSINFO_REPORT}</FORMS></REPORT>`
      + `<FORM NAME="${SYSINFO_REPORT}"><PARTS>${SYSINFO_REPORT}</PARTS><XMLTAG>RAMSSYSINFO</XMLTAG></FORM>`
      + `<PART NAME="${SYSINFO_REPORT}"><LINES>${SYSINFO_REPORT}</LINES>`
      + `<REPEAT>${SYSINFO_REPORT} : RAMS SysInfo Companies</REPEAT><SCROLLED>Vertical</SCROLLED></PART>`
      + `<LINE NAME="${SYSINFO_REPORT}"><FIELDS>RAMS SI Name, RAMS SI Edu, RAMS SI Licensed, RAMS SI Echo</FIELDS><XMLTAG>ROW</XMLTAG></LINE>`
      + field('RAMS SI Name', 'NAME', '$Name')
      + field('RAMS SI Edu', 'EDUCATIONAL', '$$LicenseInfo:IsEducationalMode')
      + field('RAMS SI Licensed', 'LICENSED', '$$LicenseInfo:IsLicensedMode')
      + field('RAMS SI Echo', 'FROMDATE', '##SVFromDate')
      + '<COLLECTION NAME="RAMS SysInfo Companies"><TYPE>Company</TYPE><FETCH>Name</FETCH></COLLECTION>',
  });
}

// TallyPrime in Educational mode accepts only the 1st, 2nd and 31st as dates,
// export periods included; any other date is silently swapped for the last one
// it accepted. So a period is widened outward to such dates, and the probe
// drops what falls outside the period it wanted.
const EDU_DAYS = new Set([1, 2, 31]);
function eduSafeRange(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const firstOf = (y, m) => `${y}-${String(m).padStart(2, '0')}-01`;
  return {
    from: EDU_DAYS.has(fd) ? from : firstOf(fy, fm),
    to: EDU_DAYS.has(td) ? to : (tm === 12 ? firstOf(ty + 1, 1) : firstOf(ty, tm + 1)),
  };
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
  const after = findAll(tree, 'SYSTEM').map((s) => /\$AlterID\s*>\s*(\d+)/i.exec(txt(s))).find(Boolean);
  const d = {
    type: txt(header.TYPE),
    id: txt(header.ID),
    company: vars.SVCURRENTCOMPANY || '',
    accountType: vars.ACCOUNTTYPE || '',
    from: vars.SVFROMDATE ? isoFromTally(vars.SVFROMDATE) : '',
    to: vars.SVTODATE ? isoFromTally(vars.SVTODATE) : '',
    afterAlterId: after ? Number(after[1]) : null,
  };
  d.key = [d.type, d.id, d.company, d.accountType, d.from, d.to, ...(after ? [d.afterAlterId] : [])].join('|').toLowerCase();
  return d;
}

module.exports = {
  tallyDateArg, isoFromTally, envelope, companiesRequest, mastersRequest, vouchersRequest, eduSafeRange,
  changedVouchersRequest, voucherListRequest, sysInfoRequest, describeRequest,
  MASTER_TYPES, COMPANY_COLLECTION, VOUCHER_COLLECTION, CHANGED_COLLECTION, LIST_COLLECTION, SYSINFO_REPORT, SYSINFO_PROBE_DAY,
};
