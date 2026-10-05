import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import Badge from '../ui/Badge';
import { getSyncStatus } from '../../api/sync.api';
import { formatDateTime, formatDay } from '../../utils/formatters';

// The Dashboard's "Tally sync" card: is the Connector online, does Tally
// answer, and where each company with sync on stands. Refreshes every minute,
// as often as the Connector reports. (The full Sync Health screen is M7.)
const REFRESH_MS = 60000;

const latest = (...times) => times.filter(Boolean).sort().pop() || null;

function companyStatus(c) {
  const { sync } = c;
  if (!sync.backfillDone) {
    return sync.backfillThrough
      ? { color: 'amber', label: `Backfilling — done through ${formatDay(sync.backfillThrough)}` }
      : { color: 'gray', label: 'Waiting for its first backfill' };
  }
  if (sync.needsResync) return { color: 'amber', label: 'Full re-sync due after office hours' };
  if (c.pending) return { color: 'blue', label: 'Changes waiting in Tally' };
  return { color: 'green', label: 'Up to date' };
}

function ConnectorLine({ connector }) {
  if (!connector) {
    return <p className="text-sm text-gray-500">No Connector has reported yet.</p>;
  }
  const { online, tally, activity } = connector;
  return (
    <div className="space-y-1 text-sm">
      <p className="flex items-center gap-2">
        <span className={`inline-block w-2 h-2 rounded-full ${online ? 'bg-green-500' : 'bg-danger'}`} />
        <span className="font-medium text-gray-800">{online ? 'Connector online' : 'Connector offline'}</span>
        <span className="text-gray-400">
          {connector.name}{connector.version ? ` · v${connector.version}` : ''} · last seen {formatDateTime(connector.last_seen_at)}
        </span>
      </p>
      {online && tally && (
        <p className={tally.reachable ? 'text-gray-500' : 'text-danger'}>
          {tally.reachable ? 'Tally is answering.' : `Tally is not answering${tally.message ? `: ${tally.message}` : '.'}`}
        </p>
      )}
      {online && tally?.educational && (
        <p className="flex items-center gap-1.5 text-amber-700">
          <AlertTriangle size={14} /> Tally is running in Educational mode (no active licence).
        </p>
      )}
      {online && activity?.state === 'syncing' && (
        <p className="flex items-center gap-1.5 text-brand">
          <RefreshCw size={14} className="animate-spin" /> Syncing {activity.company || ''} ({activity.kind})…
        </p>
      )}
    </div>
  );
}

export default function TallySyncCard({ isAdmin = false }) {
  const [result, setResult] = useState({ data: null, error: null, loaded: false });

  useEffect(() => {
    let cancelled = false;
    const load = () => getSyncStatus()
      .then((data) => { if (!cancelled) setResult({ data, error: null, loaded: true }); })
      .catch(() => { if (!cancelled) setResult((r) => ({ ...r, error: 'Could not load the sync status', loaded: true })); });
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const { data, error, loaded } = result;

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4 mt-6" aria-labelledby="tally-sync-heading">
      <div className="flex items-center justify-between mb-3">
        <h2 id="tally-sync-heading" className="font-semibold text-brand">Tally sync</h2>
        {isAdmin && <Link to="/admin/companies" className="text-sm text-brand hover:underline">Tally companies</Link>}
      </div>

      {!loaded && <div className="h-4 bg-gray-100 rounded animate-pulse" />}
      {error && <p className="text-sm text-danger">{error}</p>}

      {data && (
        <>
          <ConnectorLine connector={data.connector} />

          {data.companies.length === 0 ? (
            <p className="text-sm text-gray-500 mt-4">
              No company is being synced yet.{' '}
              {isAdmin
                ? <>Choose which Tally companies RAMS mirrors on <Link to="/admin/companies" className="text-brand underline">Tally companies</Link>.</>
                : 'An Admin or Owner chooses which Tally companies RAMS mirrors.'}
            </p>
          ) : (
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-500">
                    {['Company', 'Vouchers', 'Status', 'Last synced', 'End-of-day check'].map((h) => (
                      <th key={h} className="py-2 pr-4 text-left font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.companies.map((c) => {
                    const s = companyStatus(c);
                    const failed = c.last_run?.status === 'failed' ? c.last_run.errors[0] : null;
                    return (
                      <tr key={c.id} className="border-b border-gray-100 align-top">
                        <td className="py-2 pr-4">
                          <span className="font-semibold text-gray-900">{c.code || '—'}</span>{' '}
                          <span className="text-gray-500">{c.name}</span>
                          {!c.loaded_in_tally && <p className="text-xs text-amber-700">Not loaded in Tally</p>}
                        </td>
                        <td className="py-2 pr-4 tabular-nums">{c.vouchers.toLocaleString('en-IN')}</td>
                        <td className="py-2 pr-4">
                          <Badge color={s.color}>{s.label}</Badge>
                          {failed && <p className="text-xs text-danger mt-1">Last run failed: {failed}</p>}
                        </td>
                        <td className="py-2 pr-4 whitespace-nowrap text-gray-600">
                          {formatDateTime(latest(c.sync.lastLightAt, c.sync.lastHeavyAt, c.sync.lastCheckedAt))}
                        </td>
                        <td className="py-2 pr-4 whitespace-nowrap text-gray-600">{formatDateTime(c.sync.lastHeavyAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
