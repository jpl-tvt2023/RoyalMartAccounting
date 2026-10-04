// Render the synthetic books as the XML Tally exports, quirks included:
// &#4; before reserved values, leading spaces in numbers, TYPE attributes on
// collection fields, the CMPINFO block whose <COMPANY> holds a count, ledger
// GSTINs in either the TallyPrime 3 (LEDGSTREGDETAILS.LIST) or the older
// (PARTYGSTIN) shape, invoice-view vs accounting-view ledger lists.
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const d8 = (iso) => String(iso || '').replace(/-/g, '');
const amt = (n) => (Math.round(n * 100) / 100).toFixed(2);
const yn = (b) => (b ? 'Yes' : 'No');
const tag = (name, value) => `<${name}>${esc(value)}</${name}>`;
const parentTag = (p) => (p === 'Primary' ? '<PARENT>&#4; Primary</PARENT>' : tag('PARENT', p));
const nameList = (names) => `<LANGUAGENAME.LIST><NAME.LIST TYPE="String">${names.map((n) => tag('NAME', n)).join('')}</NAME.LIST><LANGUAGEID> 1033</LANGUAGEID></LANGUAGENAME.LIST>`;

function envelope(data, desc = '') {
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER><BODY><DESC>${desc}</DESC><DATA>${data}</DATA></BODY></ENVELOPE>`;
}
const messages = (objects) => objects.map((o) => `<TALLYMESSAGE xmlns:UDF="TallyUDF">${o}</TALLYMESSAGE>`).join('');

function errorXml(message) {
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>0</STATUS></HEADER><BODY><DATA><LINEERROR>${esc(message)}</LINEERROR></DATA></BODY></ENVELOPE>`;
}

function companiesXml(companies) {
  const rows = companies.map((c) => `<COMPANY NAME="${esc(c.name)}" RESERVEDNAME="">`
    + `<NAME TYPE="String">${esc(c.name)}</NAME>`
    + `<GUID TYPE="String">${esc(c.guid)}</GUID>`
    + `<BOOKSFROM TYPE="Date">${d8(c.booksFrom)}</BOOKSFROM>`
    + `<STARTINGFROM TYPE="Date">${d8(c.booksFrom)}</STARTINGFROM>`
    + `<ALTMSTID TYPE="Number"> ${c.altMstId}</ALTMSTID>`
    + `<ALTVCHID TYPE="Number"> ${c.altVchId}</ALTVCHID>`
    + `<STATENAME TYPE="String">${esc(c.state)}</STATENAME>`
    + '</COMPANY>').join('');
  return envelope(`<COLLECTION>${rows}</COLLECTION>`, `<CMPINFO><COMPANY>0</COMPANY><GROUP>0</GROUP><LEDGER>0</LEDGER></CMPINFO>`);
}

function groupXml(g) {
  return `<GROUP NAME="${esc(g.name)}" RESERVEDNAME="${esc(g.reserved)}">${parentTag(g.parent)}<ISBILLWISEON>No</ISBILLWISEON>${nameList([g.name])}</GROUP>`;
}

function ledgerXml(l, style, i) {
  let gst = '';
  if (l.gstin && style === 'tp3') {
    gst = `<LEDGSTREGDETAILS.LIST><APPLICABLEFROM>20250401</APPLICABLEFROM><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>${tag('STATE', l.state)}${tag('PLACEOFSUPPLY', l.state)}${tag('GSTIN', l.gstin)}</LEDGSTREGDETAILS.LIST>`
      + `<LEDMAILINGDETAILS.LIST><APPLICABLEFROM>20250401</APPLICABLEFROM>${tag('MAILINGNAME', l.name)}${tag('STATE', l.state)}<COUNTRY>India</COUNTRY></LEDMAILINGDETAILS.LIST>`;
  } else if (l.gstin) {
    gst = `<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>${tag('PARTYGSTIN', l.gstin)}${tag('LEDSTATENAME', l.state)}`;
  }
  const billWise = /debtors|creditors|marketplaces|branch/i.test(l.parent);
  return `<LEDGER NAME="${esc(l.name)}" RESERVEDNAME="">`
    + `<GUID>ledger-${i}</GUID>${parentTag(l.parent)}<CURRENCYNAME>₹</CURRENCYNAME>`
    + `<ISBILLWISEON>${yn(billWise)}</ISBILLWISEON><ALTERID> ${i + 10}</ALTERID><MASTERID> ${i + 1}</MASTERID>`
    + `${gst}${nameList([l.name])}</LEDGER>`;
}

function stockItemXml(s, i) {
  const hsn = s.hsn
    ? `<HSNDETAILS.LIST><APPLICABLEFROM>20250401</APPLICABLEFROM><HSNCODE>${esc(s.hsn)}</HSNCODE><SRCOFHSNDETAILS>Specify Details Here</SRCOFHSNDETAILS></HSNDETAILS.LIST>`
    : '';
  return `<STOCKITEM NAME="${esc(s.name)}" RESERVEDNAME=""><GUID>item-${i}</GUID>${parentTag(s.parent || 'Primary')}`
    + `<BASEUNITS>Pcs</BASEUNITS><ALTERID> ${i + 50}</ALTERID>${hsn}${nameList([s.name, ...(s.aliases || [])])}</STOCKITEM>`;
}

function voucherTypeXml(t, i) {
  return `<VOUCHERTYPE NAME="${esc(t.name)}" RESERVEDNAME="${esc(t.reserved)}"><GUID>vchtype-${i}</GUID>${tag('PARENT', t.parent)}`
    + `<NUMBERINGMETHOD>Automatic (Manual Override)</NUMBERINGMETHOD><ISACTIVE>Yes</ISACTIVE>${nameList([t.name])}</VOUCHERTYPE>`;
}

function mastersXml(company, accountType) {
  const t = String(accountType).toLowerCase();
  if (t === 'groups') return envelope(messages(company.groups.map(groupXml)));
  if (t === 'ledgers') return envelope(messages(company.ledgers.map((l, i) => ledgerXml(l, company.ledgerStyle, i))));
  if (t === 'stock items') return envelope(messages(company.stockItems.map(stockItemXml)));
  if (t === 'voucher types') return envelope(messages(company.voucherTypes.map(voucherTypeXml)));
  return errorXml(`Unknown AccountType '${accountType}'`);
}

function billsXml(bills = []) {
  return bills.map((b) => `<BILLALLOCATIONS.LIST>${tag('NAME', b.name)}${tag('BILLTYPE', b.type)}<TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>${tag('AMOUNT', amt(b.amount))}</BILLALLOCATIONS.LIST>`).join('');
}

function ledgerLineXml(listTag, l) {
  return `<${listTag}><OLDAUDITENTRYIDS.LIST TYPE="Number"><OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS></OLDAUDITENTRYIDS.LIST>`
    + `${tag('LEDGERNAME', l.ledger)}<ISDEEMEDPOSITIVE>${yn(l.amount < 0)}</ISDEEMEDPOSITIVE>`
    + `<ISPARTYLEDGER>${yn(Boolean(l.party))}</ISPARTYLEDGER>${tag('AMOUNT', amt(l.amount))}${billsXml(l.bills)}</${listTag}>`;
}

function inventoryXml(i, orderNo) {
  const qty = ` ${i.qty} Pcs`;
  return '<ALLINVENTORYENTRIES.LIST>'
    + `${tag('STOCKITEMNAME', i.item)}<ISDEEMEDPOSITIVE>${yn(i.inward)}</ISDEEMEDPOSITIVE>`
    + `${tag('RATE', `${amt(i.rate)}/Pcs`)}${tag('AMOUNT', amt(i.amount))}${tag('ACTUALQTY', qty)}${tag('BILLEDQTY', qty)}`
    + `<BATCHALLOCATIONS.LIST><GODOWNNAME>Main Location</GODOWNNAME><BATCHNAME>Primary Batch</BATCHNAME>`
    + `${orderNo ? tag('ORDERNO', orderNo) : '<ORDERNO>&#4; Not Applicable</ORDERNO>'}`
    + `${tag('AMOUNT', amt(i.amount))}${tag('ACTUALQTY', qty)}${tag('BILLEDQTY', qty)}</BATCHALLOCATIONS.LIST>`
    + `<ACCOUNTINGALLOCATIONS.LIST>${tag('LEDGERNAME', i.ledger)}<ISDEEMEDPOSITIVE>${yn(i.amount < 0)}</ISDEEMEDPOSITIVE>${tag('AMOUNT', amt(i.amount))}</ACCOUNTINGALLOCATIONS.LIST>`
    + '</ALLINVENTORYENTRIES.LIST>';
}

function voucherXml(v, company) {
  const invoiceView = v.view === 'invoice';
  const party = company.ledgers.find((l) => l.name === v.party);
  return `<VOUCHER REMOTEID="${esc(v.guid)}" VCHKEY="${esc(v.guid)}:00000008" VCHTYPE="${esc(v.type)}" ACTION="Create" OBJVIEW="${invoiceView ? 'Invoice Voucher View' : 'Accounting Voucher View'}">`
    + '<OLDAUDITENTRYIDS.LIST TYPE="Number"><OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS></OLDAUDITENTRYIDS.LIST>'
    + `${tag('DATE', d8(v.date))}${tag('GUID', v.guid)}`
    + (party && party.gstin ? tag('PARTYGSTIN', party.gstin) + tag('STATENAME', party.state) : '')
    + `<GSTREGISTRATION TAXTYPE="GST" TAXREGISTRATION="${esc(company.gstin)}">${esc(company.state)} Registration</GSTREGISTRATION>`
    + `${tag('CMPGSTIN', company.gstin)}${tag('CMPGSTSTATE', company.state)}`
    + tag('VOUCHERTYPENAME', v.type)
    + (v.party ? tag('PARTYLEDGERNAME', v.party) + tag('PARTYNAME', v.party) : '')
    + tag('VOUCHERNUMBER', v.number)
    + (v.reference ? tag('REFERENCE', v.reference) + tag('REFERENCEDATE', d8(v.date)) : '')
    + '<CSTFORMISSUETYPE>&#4; Not Applicable</CSTFORMISSUETYPE>'
    + (v.narration ? tag('NARRATION', v.narration) : '')
    + `<PERSISTEDVIEW>${invoiceView ? 'Invoice Voucher View' : 'Accounting Voucher View'}</PERSISTEDVIEW>`
    + `<ISINVOICE>${yn(invoiceView)}</ISINVOICE><ISCANCELLED>${yn(v.cancelled)}</ISCANCELLED><ISOPTIONAL>No</ISOPTIONAL>`
    + `<ALTERID> ${v.alterId}</ALTERID><MASTERID> ${v.masterId}</MASTERID>`
    + v.orders.map((o) => `<INVOICEORDERLIST.LIST>${tag('BASICORDERDATE', d8(o.date))}${tag('BASICPURCHASEORDERNO', o.no)}</INVOICEORDERLIST.LIST>`).join('')
    + v.items.map((i) => inventoryXml(i, (v.orders[0] || {}).no)).join('')
    + v.ledgerLines.map((l) => ledgerLineXml(invoiceView ? 'LEDGERENTRIES.LIST' : 'ALLLEDGERENTRIES.LIST', l)).join('')
    + '</VOUCHER>';
}

function dayBookXml(company, from, to) {
  const inRange = company.vouchers.filter((v) => (!from || v.date >= from) && (!to || v.date <= to));
  return envelope(messages(inRange.map((v) => voucherXml(v, company))));
}

module.exports = { companiesXml, mastersXml, dayBookXml, errorXml, voucherXml };
