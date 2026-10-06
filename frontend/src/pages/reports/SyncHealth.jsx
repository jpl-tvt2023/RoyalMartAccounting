import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Pagination from '../../components/ui/Pagination';
import ReportFrame, { ReportTable, td, num } from '../../components/reports/ReportFrame';
import { getSyncStatus, getSyncRuns, syncNow } from '../../api/sync.api';
import { useAuth } from '../../context/AuthContext';
import { PERM } from '../../utils/roles';
import { formatDateTime } from '../../utils/formatters';

// Reports -> Sync health: is the Connector on the office PC checking in, is
// Tally answering, where each company stands, and every sync run with its
// errors. "Sync now" asks the Connector for a light sync at its next check-in.
const STATUS = { ok: ['green', 'OK'], failed: ['red', 'Failed'], running: ['blue', 'Running'] };

export default function SyncHealth() {
  const { can } = useAuth();
  const canSync = can(PERM.SYNC_RUN);
  const [status, setStatus] = useState(null);
  const [runs, setRuns] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [asking, setAsking] = useState(null);

  const load = useCallback(() => {
    getSyncStatus().then(setStatus).catch(() => toast.error('Failed to load the sync status'));
    getSyncRuns({ page, page_size: pageSize }).then(setRuns).catch(() => toast.error('Failed to load the sync runs'));
  }, [page, pageSize]);
  useEffect(() => { load(); }, [load]);

  const ask = async (companyId) => {
    setAsking(companyId || 'all');
    try {
      const out = await syncNow(companyId);
      toast.success(out.message);
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'That did not work'); } finally { setAsking(null); }
  };
  const waiting = new Set((runs?.waiting || []).map((w) => w.company_id));
  const c = status?.connector;

  return (
    <ReportFrame title="Sync health" help="sync-health" intro="Whether the RAMS Connector on the office PC is checking in, whether Tally answers, where each company stands, and every sync run.">
      {status && (
        <section className="bg-white rounded-xl border border-gray-200 p-4 mb-4" aria-label="Connector">
          {c ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span><Badge color={c.online ? 'green' : 'red'}>{c.online ? 'Connector online' : 'Connector offline'}</Badge></span>
              <span>{c.name}{c.version ? ` · v${c.version}` : ''} · last seen {formatDateTime(c.last_seen_at)}</span>
              {c.tally && <span><Badge color={c.tally.reachable ? 'green' : 'red'}>{c.tally.reachable ? 'Tally answering' : 'Tally not answering'}</Badge></span>}
              {c.tally?.educational && <span className="text-amber-700">Tally is in Educational mode</span>}
              {c.activity?.state && c.activity.state !== 'idle' && <span className="text-gray-500">Now: {c.activity.state}{c.activity.company ? ` ${c.activity.company}` : ''}</span>}
              {c.last_error && <span className="text-danger w-full">Last error: {c.last_error}</span>}
            </div>
          ) : <p className="text-sm text-gray-500">No Connector has checked in yet.</p>}
        </section>
      )}

      {status && (
        <>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-gray-900">Companies</h2>
            {canSync && status.companies.length > 1 && (
              <Button size="sm" variant="outline" onClick={() => ask(null)} loading={asking === 'all'}>{asking !== 'all' && <RefreshCw size={14} />} Sync all now</Button>
            )}
          </div>
          <ReportTable head={['Company', 'Where it stands', 'Last sync', { label: 'Vouchers', right: true }, '']} loading={false}>
            {status.companies.map((co) => (
              <tr key={co.id} className="border-b border-gray-100 align-top">
                <td className={td}><span className="font-medium">{co.code || co.name}</span><p className="text-xs text-gray-400">{co.name}</p></td>
                <td className={td}>
                  {!co.loaded_in_tally ? <span className="text-amber-700">Not open in Tally</span>
                    : !co.sync.backfillDone ? 'First backfill running'
                      : co.pending ? 'Changes waiting in Tally' : <span className="text-green-700">Up to date</span>}
                </td>
                <td className={td}>
                  {co.last_run ? (
                    <>
                      {co.last_run.kind} · {formatDateTime(co.last_run.finished_at || co.last_run.started_at)}{' '}
                      <Badge color={STATUS[co.last_run.status]?.[0] || 'gray'}>{STATUS[co.last_run.status]?.[1] || co.last_run.status}</Badge>
                      {co.last_run.errors.length > 0 && <p className="text-xs text-danger">{co.last_run.errors.join('; ')}</p>}
                    </>
                  ) : '—'}
                </td>
                <td className={num}>{co.vouchers.toLocaleString('en-IN')}</td>
                <td className={`${td} text-right whitespace-nowrap`}>
                  {waiting.has(co.id) ? <span className="text-xs text-gray-500">Sync asked — at the next check-in</span>
                    : canSync && co.sync.backfillDone && (
                      <Button size="sm" variant="outline" onClick={() => ask(co.id)} loading={asking === co.id}>{asking !== co.id && <RefreshCw size={14} />} Sync now</Button>
                    )}
                </td>
              </tr>
            ))}
          </ReportTable>
        </>
      )}

      <h2 className="font-semibold text-gray-900 mt-6 mb-2">Sync runs</h2>
      <ReportTable
        loading={!runs}
        head={['When', 'Company', 'Kind', { label: 'Vouchers stored', right: true }, { label: 'Deleted', right: true }, 'Result']}
        empty={runs && runs.rows.length === 0 && <p className="text-center text-gray-400 py-8">No sync has run yet.</p>}
      >
        {(runs?.rows || []).map((r) => (
          <tr key={r.id} className="border-b border-gray-100 align-top">
            <td className={`${td} whitespace-nowrap`}>{formatDateTime(r.started_at)}</td>
            <td className={td}>{r.company}</td>
            <td className={td}>{r.kind}</td>
            <td className={num}>{r.vouchers_upserted.toLocaleString('en-IN')}</td>
            <td className={num}>{r.vouchers_deleted.toLocaleString('en-IN')}</td>
            <td className={td}>
              <Badge color={STATUS[r.status]?.[0] || 'gray'}>{STATUS[r.status]?.[1] || r.status}</Badge>
              {r.errors.length > 0 && <p className="text-xs text-danger">{r.errors.join('; ')}</p>}
            </td>
          </tr>
        ))}
      </ReportTable>
      {runs && <Pagination page={page} pageSize={pageSize} total={runs.total} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} />}
    </ReportFrame>
  );
}
