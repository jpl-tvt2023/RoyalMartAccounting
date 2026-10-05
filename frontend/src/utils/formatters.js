// Dates as Royal Mart reads them: Indian time, "04 Oct 2026". The API stores
// UTC 'YYYY-MM-DD HH:MM:SS' without a zone, so it is parsed as UTC first.
// (Copied from ROMS.)
const IST = 'Asia/Kolkata';

function parseAsUtc(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr);
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

export function formatDate(dateStr) {
  const d = parseAsUtc(dateStr);
  if (!d) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: IST });
}

// A calendar day ('2026-07-31', as Tally dates are stored) -- no time zone.
export function formatDay(isoDay) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay || '');
  if (!m) return '—';
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
    .toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function formatDateTime(dateStr) {
  const d = parseAsUtc(dateStr);
  if (!d) return '—';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: IST });
}
