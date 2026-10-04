import { useCallback, useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import AppShell from '../../components/layout/AppShell';
import Button from '../../components/ui/Button';
import Pagination, { loadPersistedPageSize, persistPageSize } from '../../components/ui/Pagination';
import ChangeList from '../../components/shared/ChangeList';
import { listAuditLogs, getAuditFacets } from '../../api/audit.api';
import { useSessionState } from '../../hooks/useSessionState';
import { formatDateTime } from '../../utils/formatters';

// The whole audit trail (Admin/Owner). The house "standard list page": filters
// are not live -- they apply on Search / Enter / Clear, a page or page-size
// change -- and persist per tab in sessionStorage; page size per browser.
const defaultFilters = () => ({ user_id: '', action_type: '', entity_type: '', date_from: '', date_to: '', q: '' });
const PAGE_SIZE_KEY = 'auditLog';

const humanize = (s) => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand';

export default function AuditLog() {
  const [filters, setFilters] = useSessionState('auditLog.filters', defaultFilters);
  const [page, setPage] = useSessionState('auditLog.page', 1);
  const [pageSize, setPageSize] = useState(() => loadPersistedPageSize(PAGE_SIZE_KEY));
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [facets, setFacets] = useState({ action_types: [], entity_types: [], users: [] });

  const buildParams = useCallback((overrides = {}) => {
    const f = overrides.filters ?? filters;
    const params = { page: overrides.page ?? page, page_size: overrides.pageSize ?? pageSize };
    for (const [k, v] of Object.entries(f)) if (v !== '' && v != null) params[k] = v;
    return params;
  }, [filters, page, pageSize]);

  // State is set only when the request settles, so the mount effect can call it.
  const fetchRows = useCallback((overrides = {}) => listAuditLogs(buildParams(overrides))
    .then((res) => { setRows(res.rows); setTotal(res.total); })
    .catch((err) => toast.error(err.response?.data?.message || 'Failed to load the audit log'))
    .finally(() => setLoading(false)), [buildParams]);
  const load = (overrides = {}) => { setLoading(true); fetchRows(overrides); };

  useEffect(() => {
    fetchRows();
    getAuditFacets().then(setFacets).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const search = () => { setPage(1); load({ page: 1 }); };
  const clear = () => {
    const f = defaultFilters();
    setFilters(f);
    setPage(1);
    load({ filters: f, page: 1 });
  };
  const onKeyDown = (e) => { if (e.key === 'Enter') search(); };

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-brand">Audit Log</h1>
        <p className="text-gray-500 text-sm">Every change in RAMS — who made it, when, and what changed.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <label htmlFor="f-user" className="block text-xs font-medium text-gray-600 mb-1">User</label>
            <select id="f-user" value={filters.user_id} onChange={set('user_id')} className={inputCls}>
              <option value="">Anyone</option>
              {facets.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="f-action" className="block text-xs font-medium text-gray-600 mb-1">Action</label>
            <select id="f-action" value={filters.action_type} onChange={set('action_type')} className={inputCls}>
              <option value="">Any</option>
              {facets.action_types.map((a) => <option key={a} value={a}>{humanize(a)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="f-entity" className="block text-xs font-medium text-gray-600 mb-1">Record type</label>
            <select id="f-entity" value={filters.entity_type} onChange={set('entity_type')} className={inputCls}>
              <option value="">Any</option>
              {facets.entity_types.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="f-from" className="block text-xs font-medium text-gray-600 mb-1">From</label>
            <input id="f-from" type="date" value={filters.date_from} onChange={set('date_from')} className={inputCls} />
          </div>
          <div>
            <label htmlFor="f-to" className="block text-xs font-medium text-gray-600 mb-1">To</label>
            <input id="f-to" type="date" value={filters.date_to} onChange={set('date_to')} className={inputCls} />
          </div>
          <div>
            <label htmlFor="f-q" className="block text-xs font-medium text-gray-600 mb-1">Description contains</label>
            <input id="f-q" value={filters.q} onChange={set('q')} onKeyDown={onKeyDown} className={inputCls} placeholder="e.g. signed in" />
          </div>
        </div>
        <div className="flex gap-2 justify-end mt-3">
          <Button variant="ghost" onClick={clear}><X size={14} />Clear</Button>
          <Button onClick={search}><Search size={14} />Search</Button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['When', 'Who', 'Action', 'What happened', 'Changes'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-semibold text-gray-600 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(4)].map((_, i) => (
                  <tr key={i}><td colSpan={5} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                ))
              ) : rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-100 align-top hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDateTime(r.timestamp)}</td>
                  <td className="px-4 py-3 text-gray-900 whitespace-nowrap">{r.user_name || <span className="text-gray-400">System</span>}</td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{humanize(r.action_type)}</td>
                  <td className="px-4 py-3 text-gray-600">{r.description || '—'}</td>
                  <td className="px-4 py-3"><ChangeList changes={r.changes} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && <p className="text-center text-gray-400 py-8">No entries match the current filters</p>}
        </div>
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={(p) => { setPage(p); load({ page: p }); }}
          onPageSizeChange={(s) => { setPageSize(s); persistPageSize(PAGE_SIZE_KEY, s); setPage(1); load({ pageSize: s, page: 1 }); }}
        />
      </div>
    </AppShell>
  );
}
