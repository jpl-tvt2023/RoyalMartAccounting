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

export function formatDateTime(dateStr) {
  const d = parseAsUtc(dateStr);
  if (!d) return '—';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: IST });
}
