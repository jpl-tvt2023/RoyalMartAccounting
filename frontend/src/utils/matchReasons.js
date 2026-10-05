// How Match review words the engine's codes (backend/src/matching/reasons.js
// lists them all; utils/__tests__/matchReasons.test.js checks every one has a
// sentence here). Plain words for the office: no "AlterID", no "normalised".
import { formatDay } from './formatters';

export const OUTCOMES = {
  linked: { label: 'Linked', color: 'green', help: 'RAMS found the Tally voucher, and every check passed.' },
  review: { label: 'Needs review', color: 'amber', help: 'RAMS needs a person to decide.' },
  waiting: { label: 'Waiting for Tally', color: 'gray', help: 'Nothing in Tally yet — normal until the accountant enters it.' },
  not_matched: { label: 'Not matched', color: 'blue', help: 'Left out on purpose, by a vendor setting or because ROMS can\'t take a value.' },
};

const q = (v) => `“${v}”`;
const day = (d) => (d ? formatDay(d) : '—');
const list = (xs) => (xs || []).join(', ');

// The one-line reason a row shows. kind is 'po' or 'rtv'.
const REASON_TEXT = {
  po: {
    bill_differs: (p) => `The Bill No typed in ROMS (${q(p.typed)}) isn't a way of writing invoice ${p.number}${p.company ? ` (${p.company})` : ''}, which the Buyer's Order No found.`,
    several_invoices: (p) => `${p.count} Tally invoices carry this PO number${p.typed ? `, and the Bill No ${q(p.typed)} fits none or several of them` : ', and no Bill No says which one'}.`,
    ambiguous: (p) => `Bill No ${q(p.typed)} is on ${p.count} invoices, and the Bill Date doesn't settle which.`,
    bill_only: (p) => `Found by the Bill No alone (invoice ${p.number}). Your rules ask a person to confirm these.`,
    rejected_all: () => 'Every invoice RAMS found was rejected by a person. Pick the right one, or wait for Tally.',
    confirmed_gone: () => 'The invoice a person confirmed is no longer in Tally (deleted or cancelled).',
    bill_not_in_tally: (p) => `Bill No ${q(p.typed)} is still not in Tally ${p.days} days after ${day(p.since)}.`,
    bill_waiting: (p) => `Bill No ${q(p.typed)} isn't in Tally yet. RAMS waits until ${day(p.until)} before asking a person.`,
    not_invoiced: () => 'No Tally invoice carries this PO number yet.',
    vendor_transfer: (p) => `${p.vendor || 'This vendor'} is set as a stock transfer — not matched yet.`,
    vendor_skip: (p) => `${p.vendor || 'This vendor'} is set not to be matched.`,
    check_party: (p) => partyText(p),
    check_sku: () => 'No SKU on the invoice is on this PO.',
    check_split: (p) => `This PO number is also on ${p.count - 1 === 1 ? 'another invoice' : `${p.count - 1} other invoices`}: ${list(p.others)}.`,
    check_reused: (p) => `The same invoice is linked to ${p.other_pos?.length === 1 ? 'another PO' : 'other POs'}: ${list(p.other_pos)}.`,
    check_qty: (p) => `The invoice's quantity (${p.invoice_qty}) is more than the PO's (${p.po_qty}).`,
    check_date: (p) => `The invoice (${day(p.invoice_date)}) is dated before the PO (${day(p.po_date)}).`,
  },
  rtv: {
    confirmed_gone: () => 'The credit note a person confirmed is no longer in Tally.',
    cn_ambiguous: (p) => `CN No ${q(p.typed)} is on ${p.count} credit notes in Tally.`,
    cn_differs: (p) => `The CN No typed in ROMS (${q(p.typed)}) isn't the credit note against the invoice (${p.number}).`,
    cn_not_in_tally: (p) => `CN No ${q(p.typed)} is still not in Tally (since ${day(p.since)}).`,
    cn_waiting: (p) => `CN No ${q(p.typed)} isn't in Tally yet. RAMS waits until ${day(p.until)} before asking a person.`,
    several_cns: (p) => `${p.count} credit notes settle this PO's invoice${p.rows > 1 ? `, for ${p.rows} RTV rows` : ''} — pick the one for this row.`,
    no_cn_yet: (p) => `No credit note against invoice ${p.invoice || ''} in Tally yet.`,
    po_not_linked: () => 'The PO has no linked invoice yet, so its credit note can\'t be found.',
    po_needs_review: () => 'The PO\'s invoice needs review first.',
    po_deleted: () => 'The PO is deleted in ROMS.',
    rtv_disposed: () => 'DN - Disposed: no credit note follows.',
    rtv_off_page: () => 'Not on ROMS\'s RTV page, so ROMS takes no CN No for it.',
    vendor_transfer: (p) => `${p.vendor || 'This vendor'} is set as a stock transfer — not matched yet.`,
    vendor_skip: (p) => `${p.vendor || 'This vendor'} is set not to be matched.`,
  },
};

function partyText(p) {
  const was = p.kind === 'internal' ? 'is our own registration (another Roymax company)'
    : p.kind === 'other' ? 'is marked as not a marketplace'
      : `belongs to ${p.vendor}`;
  return `The invoice's party ledger ${p.ledger ? q(p.ledger) : ''} ${was}, not ${p.po_vendor}.`;
}

export function reasonText(kind, reason, params = {}) {
  const fn = REASON_TEXT[kind]?.[reason];
  return fn ? fn(params || {}) : '';
}

// A reason in a few words, for the filter list.
const REASON_LABELS = {
  bill_differs: 'Bill No differs',
  several_invoices: 'Several invoices',
  ambiguous: 'Number on several invoices',
  bill_only: 'Found by Bill No only',
  rejected_all: 'All suggestions rejected',
  confirmed_gone: 'Confirmed voucher gone',
  bill_not_in_tally: 'Bill No not in Tally',
  bill_waiting: 'Bill No not in Tally yet',
  not_invoiced: 'Not invoiced yet',
  vendor_transfer: 'Stock transfer',
  vendor_skip: 'Vendor not matched',
  check_party: 'Party ledger',
  check_sku: 'No SKU in common',
  check_split: 'PO on other invoices too',
  check_reused: 'Invoice on another PO',
  check_qty: 'Quantity over PO',
  check_date: 'Invoice before PO',
  cn_ambiguous: 'CN No on several notes',
  cn_differs: 'CN No differs',
  cn_not_in_tally: 'CN No not in Tally',
  cn_waiting: 'CN No not in Tally yet',
  several_cns: 'Several credit notes',
  no_cn_yet: 'No credit note yet',
  po_not_linked: 'PO not linked',
  po_needs_review: 'PO needs review',
  po_deleted: 'PO deleted',
  rtv_disposed: 'DN - Disposed',
  rtv_off_page: 'Not on the RTV page',
};

export const reasonLabel = (kind, reason) => REASON_LABELS[reason] || reason;

// How a link was found, in a few words.
export const METHOD_TEXT = {
  order_no: "Buyer's Order No",
  order_no_label: "Buyer's Order No (label ignored)",
  order_no_split: "Buyer's Order No (one of several)",
  bill_no: 'Bill No',
  bill_serial: 'Bill No (invoice serial)',
  person: 'Picked by a person',
  agst_ref: 'Credit note against the invoice',
  cn_number: 'CN No typed in ROMS',
  cn_number_agst_ref: 'CN No, against the invoice',
};

// Each step of the explanation, as a sentence.
const HOW_TEXT = {
  order_no: (p) => `The Tally invoice's Buyer's Order No matches this PO's number ${q(p.value)}${p.count > 1 ? ` (${p.count} invoices carry it)` : ''}.`,
  order_no_label: (p) => `The PO number ${q(p.value)} matched as ${q(p.used)}, ignoring the label after the dash.`,
  order_no_split: (p) => `The PO field holds several numbers; one of them (${p.used}) is on the invoice.`,
  bill_no: (p) => `The Bill No ${q(p.typed)} is the invoice's number${p.count > 1 ? ` (on ${p.count} invoices)` : ''}.`,
  bill_serial: (p) => `The Bill No ${q(p.typed)} is the invoice's serial — the digits in its number${p.count > 1 ? ` (${p.count} invoices have it)` : ''}.`,
  pick_unique: () => 'Only one invoice fits.',
  pick_same_date: (p) => `Of ${p.count} invoices, the one dated on the Bill Date was taken.`,
  pick_same_fy: (p) => `Of ${p.count} invoices, the only one in the same financial year was taken.`,
  others_claimed: (p) => `${p.count === 1 ? 'Another invoice with this PO number belongs' : `${p.count} other invoices with this PO number belong`} to ${list(p.pos)} by their Bill No.`,
  cn_number: (p) => `The CN No typed in ROMS (${q(p.typed)}) is this credit note's number.`,
  agst_ref: (p) => `This credit note settles the PO's invoice ${p.invoice || ''} (Agst Ref in Tally).`,
};

export function howText(step) {
  const fn = HOW_TEXT[step?.code];
  return fn ? fn(step.params || {}) : '';
}

// The checks on a link: what each one looks at, and what failing it means.
export const CHECK_TEXT = {
  party: { label: 'Party ledger', ok: 'The party ledger belongs to this marketplace, or isn\'t set yet.', failed: partyText },
  sku: { label: 'SKUs', ok: 'At least one SKU on the invoice is on the PO.', failed: REASON_TEXT.po.check_sku },
  split: { label: 'One invoice', ok: 'No other invoice carries this PO number.', failed: REASON_TEXT.po.check_split },
  reused: { label: 'Invoice used once', ok: 'No other PO is linked to this invoice.', failed: REASON_TEXT.po.check_reused },
  qty: { label: 'Quantity', ok: 'The invoice\'s quantity is within the PO\'s.', failed: REASON_TEXT.po.check_qty },
  date: { label: 'Date', ok: 'The invoice is dated on or after the PO.', failed: REASON_TEXT.po.check_date },
};

// What auto-fill (M6) would do to the ROMS field.
export function fillText(fill) {
  if (!fill) return '';
  const field = fill.field === 'bill_no' ? 'Bill No' : 'CN No';
  if (fill.kind === 'same') return `${field} already ${fill.value}`;
  if (fill.kind === 'fill') return `${field}: blank → ${fill.value}`;
  return `${field}: ${fill.current} → ${fill.value}`;
}

// The codes worded here, for the parity test.
export const WORDED = {
  reasons: { po: Object.keys(REASON_TEXT.po), rtv: Object.keys(REASON_TEXT.rtv) },
  labels: Object.keys(REASON_LABELS),
  methods: Object.keys(METHOD_TEXT),
  how: Object.keys(HOW_TEXT),
  checks: Object.keys(CHECK_TEXT),
};
