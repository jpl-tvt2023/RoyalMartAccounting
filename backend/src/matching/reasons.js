// Every code the engine (engine.js) puts in a result, in one place. The page
// words each one (frontend/src/utils/matchReasons.js); tests on both sides pin
// these lists, so a new code can't ship without its sentence.
const REASONS = {
  po: [
    'bill_differs', 'several_invoices', 'ambiguous', 'bill_only', 'rejected_all', 'confirmed_gone',
    'bill_not_in_tally', 'bill_waiting', 'not_invoiced', 'vendor_transfer', 'vendor_skip',
    'check_party', 'check_sku', 'check_split', 'check_reused', 'check_qty', 'check_date',
  ],
  rtv: [
    'confirmed_gone', 'cn_ambiguous', 'cn_differs', 'cn_not_in_tally', 'cn_waiting', 'several_cns', 'no_cn_yet',
    'po_not_linked', 'po_needs_review', 'po_deleted', 'rtv_disposed', 'rtv_off_page', 'vendor_transfer', 'vendor_skip',
  ],
};
const METHODS = ['order_no', 'order_no_label', 'order_no_split', 'bill_no', 'bill_serial', 'person', 'agst_ref', 'cn_number', 'cn_number_agst_ref'];
const HOW = ['order_no', 'order_no_label', 'order_no_split', 'bill_no', 'bill_serial', 'pick_unique', 'pick_same_date', 'pick_same_fy', 'others_claimed', 'cn_number', 'agst_ref'];
const CHECKS = ['party', 'sku', 'split', 'reused', 'qty', 'date'];

module.exports = { REASONS, METHODS, HOW, CHECKS };
