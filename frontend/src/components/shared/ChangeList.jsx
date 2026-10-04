import { formatDate } from '../../utils/formatters';

// A field-level diff from an audit row: "Name: Old → New". Shared by the
// history drawer and the Audit Log page.
const humanizeField = (f) => String(f).replace(/_/g, ' ').replace(/\bid\b/i, 'ID').replace(/\b\w/g, (c) => c.toUpperCase());

// Fields stored as 0/1, with their on/off labels.
const BOOLEAN_FIELDS = { is_active: ['Active', 'Deactivated'] };

function displayValue(field, v) {
  if (v === null || v === undefined || v === '') return '—';
  const bool = BOOLEAN_FIELDS[field];
  if (bool) return (v === 1 || v === '1' || v === true || v === 'true') ? bool[0] : bool[1];
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return formatDate(v);
  return String(v);
}

export default function ChangeList({ changes }) {
  if (!Array.isArray(changes) || !changes.length) return null;
  return (
    <div className="space-y-0.5">
      {changes.map((c, i) => (
        <div key={i} className="text-xs flex flex-wrap items-center gap-1">
          <span className="font-medium text-gray-700">{humanizeField(c.field)}:</span>
          <span className="line-through text-red-500">{displayValue(c.field, c.old)}</span>
          <span className="text-gray-400">→</span>
          <span className="text-green-700">{displayValue(c.field, c.new)}</span>
        </div>
      ))}
    </div>
  );
}
