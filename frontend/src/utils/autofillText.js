// Auto-fill in words: the modes, where each row is, and what it writes.
// Used by the Auto-fill page, Match review and the Dashboard card.
import { formatDay, formatDateTime } from './formatters';

export const FIELDS = {
  po: { label: 'Bill No + Bill Date', short: 'Bill No', row: 'PO', mode: 'bill_mode' },
  rtv: { label: 'RTV Credit Note No + CN Date', short: 'CN No', row: 'RTV row', mode: 'cn_mode' },
};

export const MODES = {
  off: { label: 'Off', help: 'Nothing is sent to ROMS.' },
  preview: { label: 'Preview', help: 'RAMS asks ROMS what would happen and lists it. Nothing is written.' },
  approve: { label: 'Ask first', help: 'Like Preview, then a person approves and RAMS writes.' },
  auto: { label: 'Automatic', help: 'Written into ROMS after every match.' },
};

// An open item's state under its field's mode, as the lists say it.
export function itemStatus(state, mode) {
  if (state === 'refused') return { label: 'Refused by ROMS', color: 'red' };
  if (state === 'differs') return { label: 'Needs a person', color: 'amber' };
  if (state === 'to_write') return { label: mode === 'approve' || mode === 'auto' ? 'Approved — writing next' : 'Approved — waiting', color: 'purple' };
  if (mode === 'auto') return { label: 'Writing next', color: 'green' };
  if (mode === 'approve') return { label: state === 'checked' ? 'Waiting for approval — ROMS would accept' : 'Waiting for approval', color: 'purple' };
  if (mode === 'preview') return { label: state === 'checked' ? 'Preview: ROMS would accept' : 'Preview: to check with ROMS', color: 'blue' };
  return { label: 'Auto-fill is off', color: 'gray' };
}

// What a write does, in a line: "607 → 607/RM/26-27" and the date if it moves.
export function changeText(row) {
  const from = row.expected ?? row.old_value ?? null;
  const to = row.value ?? row.new_value;
  const fromDate = row.expected_date ?? row.old_date ?? null;
  const toDate = row.date ?? row.new_date;
  const kind = row.write_kind;
  const number = kind === 'date' ? `${to} (as now)` : `${from || 'blank'} → ${to}`;
  const date = fromDate === toDate ? '' : ` · date ${fromDate ? formatDay(fromDate) : 'blank'} → ${formatDay(toDate)}`;
  return `${number}${date}`;
}

// Match review's Auto-fill cell for a linked row: where auto-fill is with it.
export function autofillStatus(row, mode) {
  const a = row.autofill;
  if (a && a.state === 'refused') return { text: `Refused by ROMS${a.dry ? ' (preview)' : ''}: ${a.reason || ''}`, tone: 'text-danger' };
  if (a && a.state === 'differs') return { text: 'Needs a person: ROMS has another value', tone: 'text-amber-700' };
  if (a && a.state === 'to_write') return { text: 'Approved — writing next', tone: 'text-purple-700' };
  if (a && (a.state === 'to_check' || a.state === 'checked')) {
    if (mode === 'auto') return { text: 'Will write', tone: 'text-gray-700' };
    if (mode === 'approve') return { text: 'Waiting for approval', tone: 'text-gray-700' };
    if (mode === 'preview') return { text: a.state === 'checked' ? 'Preview: ROMS would accept' : 'Preview: to check', tone: 'text-gray-500' };
    return { text: 'Auto-fill is off', tone: 'text-gray-400' };
  }
  if (a && a.written_at && (!row.fill || row.fill.kind === 'same')) return { text: `Written ${formatDateTime(a.written_at)}`, tone: 'text-green-700' };
  return null;
}
