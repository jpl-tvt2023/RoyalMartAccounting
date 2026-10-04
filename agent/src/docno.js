// Document numbers (bill, CN, DN, PO) compared at three strengths, weakest
// last, so a report can say exactly how far a ROMS value is from Tally's:
//
//   exact      trimmed, case-insensitive               RM/26-27/001 = rm/26-27/001
//   normalised '/', '\', '_', '.', spaces → '-', runs   RM/26-27/001 = RM-26-27-1
//              of '-' collapse, leading zeros dropped
//   compact    letters and digits only                  RM/26-27/006 = RM2627006
//
// Phase 1 matching will reuse these, so they live outside the probe.
const exactKey = (s) => String(s ?? '').trim().toUpperCase();

const normKey = (s) => exactKey(s)
  .replace(/\s+/g, '')
  .replace(/[/\\_.]+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '')
  .replace(/\d+/g, (d) => d.replace(/^0+(?=\d)/, ''));

const compactKey = (s) => exactKey(s).replace(/[^A-Z0-9]/g, '');

const LEVELS = [
  ['exact', exactKey, 1],
  ['normalised', normKey, 2],
  // Very short compact keys ("12") would match half the ledger.
  ['compact', compactKey, 4],
];

// "ZPO-1, ZPO-2" or "ZPO-1 & ZPO-2" in one field → both numbers.
function splitRefs(value) {
  return String(value ?? '').split(/\s*[,;]\s*|\s+&\s+|\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
}

// The shape of a number: letters → A, digits → 9. RM/26-27/012 → AA/99-99/999.
const mask = (s) => String(s ?? '').trim().replace(/[A-Za-z]/g, 'A').replace(/[0-9]/g, '9');

// How a value typed in ROMS differs from the Tally number it matched.
function howTyped(romsValue, tallyValue) {
  const r = String(romsValue ?? '').trim();
  const t = String(tallyValue ?? '').trim();
  if (r === t) return 'as in Tally';
  if (exactKey(r) === exactKey(t)) return 'case differs';
  if (exactKey(r) === exactKey(t).replace(/[/\\_.\s]/g, '-')) return "'/' typed as '-'";
  if (exactKey(r) === exactKey(t).replace(/[^A-Z0-9-]/g, '')) return "'/' left out";
  if (normKey(r) === normKey(t)) return 'separators or leading zeros differ';
  if (compactKey(r) === compactKey(t)) return 'all separators left out';
  return 'other';
}

// value → entries, at every strength. `find` answers at the strongest one
// that has any hit.
class DocIndex {
  constructor() {
    this.maps = Object.fromEntries(LEVELS.map(([name]) => [name, new Map()]));
  }

  add(value, entry) {
    for (const [name, keyOf, min] of LEVELS) {
      const key = keyOf(value);
      if (key.length < min) continue;
      const list = this.maps[name].get(key);
      if (list) list.push(entry);
      else this.maps[name].set(key, [entry]);
    }
  }

  find(value) {
    for (const [name, keyOf, min] of LEVELS) {
      const key = keyOf(value);
      if (key.length < min) continue;
      const hits = this.maps[name].get(key);
      if (hits && hits.length) return { level: name, entries: hits };
    }
    return { level: null, entries: [] };
  }
}

module.exports = { exactKey, normKey, compactKey, splitRefs, mask, howTyped, DocIndex, LEVELS };
