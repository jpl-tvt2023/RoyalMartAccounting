import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import Modal from '../ui/Modal';
import ChangeList from './ChangeList';
import { getEntityHistory } from '../../api/audit.api';
import { formatDateTime } from '../../utils/formatters';

/**
 * One record's change history: who, when, what, and the field-level diff.
 * (Copied from ROMS.)
 */
export default function HistoryDrawer({ open, onClose, entityType, entityId, title = 'Change History' }) {
  // Which record's history is held; it is loading while that is not the one
  // asked for.
  const key = open && entityId != null ? `${entityType}:${entityId}` : null;
  const [result, setResult] = useState({ key: null, entries: [], error: null });
  const loading = key != null && result.key !== key;
  const { entries, error } = loading ? { entries: [], error: null } : result;

  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    getEntityHistory(entityType, entityId)
      .then((rows) => { if (!cancelled) setResult({ key, entries: rows, error: null }); })
      .catch(() => { if (!cancelled) setResult({ key, entries: [], error: 'Failed to load history' }); });
    return () => { cancelled = true; };
  }, [key, entityType, entityId]);

  return (
    <Modal isOpen={open} onClose={onClose} title={title} size="lg">
      {loading && <p className="text-sm text-gray-400 py-6 text-center">Loading history…</p>}
      {error && <p className="text-sm text-danger py-6 text-center">{error}</p>}
      {!loading && !error && entries.length === 0 && (
        <p className="text-sm text-gray-400 py-6 text-center">No history recorded yet.</p>
      )}
      <ol className="relative border-l border-gray-200 ml-2">
        {entries.map((e) => (
          <li key={e.id} className="mb-5 ml-4">
            <span className="absolute -left-1.5 mt-1.5 w-3 h-3 rounded-full bg-brand" />
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-semibold text-gray-900">{e.user_name || 'System'}</span>
              <span className="text-xs text-gray-400">{formatDateTime(e.timestamp)}</span>
            </div>
            <p className="text-xs text-gray-500 mb-1">{e.description || e.action_type}</p>
            <ChangeList changes={e.changes} />
          </li>
        ))}
      </ol>
    </Modal>
  );
}

/** A small inline button that opens the history for one record. */
export function HistoryButton({ entityType, entityId, title, className = '' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="View change history"
        aria-label="View change history"
        className={`p-1.5 rounded hover:bg-gray-100 text-gray-500 transition-colors ${className}`}
      >
        <History size={14} />
      </button>
      <HistoryDrawer open={open} onClose={() => setOpen(false)} entityType={entityType} entityId={entityId} title={title} />
    </>
  );
}
