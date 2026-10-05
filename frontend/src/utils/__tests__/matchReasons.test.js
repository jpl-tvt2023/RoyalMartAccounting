import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import {
  WORDED, reasonText, howText, fillText, CHECK_TEXT, OUTCOMES,
} from '../matchReasons';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The backend lists every code the engine can put in a result
// (backend/src/matching/reasons.js); each needs its words here. Skipped where
// the backend isn't checked out beside the frontend.
const backendFile = path.resolve(HERE, '../../../../backend/src/matching/reasons.js');
const haveBackend = fs.existsSync(backendFile);

describe('every matching code has its words', () => {
  test.runIf(haveBackend)("every reason, method, step and check the engine uses", () => {
    const { REASONS, METHODS, HOW, CHECKS } = createRequire(import.meta.url)(backendFile);
    for (const kind of ['po', 'rtv']) {
      for (const r of REASONS[kind]) {
        expect(WORDED.reasons[kind]).toContain(r);
        expect(WORDED.labels).toContain(r);
      }
    }
    for (const m of METHODS) expect(WORDED.methods).toContain(m);
    for (const h of HOW) expect(WORDED.how).toContain(h);
    for (const c of CHECKS) expect(WORDED.checks).toContain(c);
  });

  test('the sentences read as the office would say them', () => {
    expect(reasonText('po', 'bill_differs', { typed: '1819', number: '1219/RM/26-27', company: 'MH' }))
      .toBe("The Bill No typed in ROMS (“1819”) isn't a way of writing invoice 1219/RM/26-27 (MH), which the Buyer's Order No found.");
    expect(reasonText('po', 'check_party', { ledger: 'ZEPTO (CHENNAI)', kind: 'vendor', vendor: 'Zepto', po_vendor: 'Blinkit' }))
      .toBe("The invoice's party ledger “ZEPTO (CHENNAI)” belongs to Zepto, not Blinkit.");
    expect(reasonText('rtv', 'several_cns', { count: 2, rows: 1 })).toBe("2 credit notes settle this PO's invoice — pick the one for this row.");
    expect(howText({ code: 'bill_serial', params: { typed: '607', count: 1 } })).toBe('The Bill No “607” is the invoice\'s serial — the digits in its number.');
    expect(fillText({ field: 'bill_no', current: '607', value: '607/RM/26-27', kind: 'replace' })).toBe('Bill No: 607 → 607/RM/26-27');
    expect(fillText({ field: 'cn_number', current: null, value: '835', kind: 'fill' })).toBe('CN No: blank → 835');
    expect(CHECK_TEXT.split.failed({ count: 2, others: ['525/RM/26-27'] })).toBe('This PO number is also on another invoice: 525/RM/26-27.');
    expect(Object.keys(OUTCOMES)).toEqual(['linked', 'review', 'waiting', 'not_matched']);
  });

  test('an unknown code is blank, never a crash', () => {
    expect(reasonText('po', 'something_new', {})).toBe('');
    expect(howText({ code: 'something_new' })).toBe('');
  });
});
