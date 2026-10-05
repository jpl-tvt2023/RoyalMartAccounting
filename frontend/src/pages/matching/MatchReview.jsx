import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Search, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import AppShell from '../../components/layout/AppShell';
import Button from '../../components/ui/Button';
import Pagination, { loadPersistedPageSize, persistPageSize } from '../../components/ui/Pagination';
import HelpLink from '../../components/shared/HelpLink';
import MatchDetail, { OutcomeBadge } from '../../components/matching/MatchDetail';
import { getMatchingSummary, listResults, runMatching } from '../../api/matching.api';
import { useAuth } from '../../context/AuthContext';
import { useSessionState } from '../../hooks/useSessionState';
import { PERM } from '../../utils/roles';
import {
  OUTCOMES, reasonText, reasonLabel, METHOD_TEXT, CHECK_TEXT, fillText,
} from '../../utils/matchReasons';
import { formatDay, formatDateTime } from '../../utils/formatters';

// Matching -> Match review: every ROMS PO with the Tally invoice RAMS linked it
// to, and every RTV row with its credit note. Opens on "Needs review", oldest
// first: the work queue. A row opens the explanation and the decisions.
const selectCls = 'px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/30';
const TILE_COLORS = {
  linked: 'border-green-200 bg-green-50 text-green-800',
  review: 'border-amber-200 bg-amber-50 text-amber-800',
  waiting: 'border-gray-200 bg-gray-50 text-gray-700',
  not_matched: 'border-blue-200 bg-blue-50 text-blue-800',
};
const DEFAULT_FILTERS = { kind: 'po', outcome: 'review', reason: '', vendor: '', company_id: '', q: '' };

function RomsLine({ summary }) {
  const { roms, last_run: last } = summary;
  if (!roms.connected) {
    return (
      <p className="flex items-center gap-1.5 text-amber-700 text-sm">
        <AlertTriangle size={14} /> ROMS isn&apos;t connected yet, so RAMS matches the last copy it read{roms.last_ok_at ? ` (${formatDateTime(roms.last_ok_at)})` : ''}. An Admin sets ROMS_API_URL and ROMS_INTEGRATION_TOKEN.
      </p>
    );
  }
  return (
    <p className="text-sm text-gray-500">
      {last ? `Last matched ${formatDateTime(last.finished_at || last.started_at)}${last.status === 'failed' ? ' — that run failed' : ''}` : 'Not matched yet'}
      {roms.last_ok_at ? ` · ROMS read ${formatDateTime(roms.last_ok_at)}` : ''}
      {roms.last_error ? <span className="text-amber-700"> · Last ROMS read failed: {roms.last_error}</span> : null}
    </p>
  );
}

export default function MatchReview() {
  const { can } = useAuth();
  const canRun = can(PERM.MATCHING_RUN);
  const canReview = can(PERM.MATCHING_REVIEW);
  const [filters, setFilters] = useSessionState('matchReview.filters', DEFAULT_FILTERS);
  const [search, setSearch] = useState(filters.q);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => loadPersistedPageSize('matchReview', 25));
  const [summary, setSummary] = useState(null);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(null); // { kind, id }
  // The list for the current filters; it is loading while what it holds is
  // for other filters. `tick` reloads the same filters after a change.
  const request = JSON.stringify({ ...filters, page, page_size: pageSize });
  const [result, setResult] = useState({ key: null, rows: [], total: 0 });
  const [tick, setTick] = useState(0);
  const loading = result.key !== request;
  const data = loading ? { rows: [], total: result.total } : result;

  const loadSummary = useCallback(() => getMatchingSummary().then(setSummary).catch(() => toast.error('Failed to load matching')), []);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => {
    let cancelled = false;
    const params = JSON.parse(request);
    Object.keys(params).forEach((k) => { if (params[k] === '') delete params[k]; });
    listResults(params)
      .then((d) => { if (!cancelled) setResult({ key: request, ...d }); })
      .catch(() => {
        if (cancelled) return;
        toast.error('Failed to load the list');
        setResult({ key: request, rows: [], total: 0 });
      });
    return () => { cancelled = true; };
  }, [request, tick]);
  const loadRows = () => setTick((t) => t + 1);

  const setFilter = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const kind = filters.kind;
  const counts = summary?.counts?.[kind];
  const reasons = Object.entries(summary?.reasons?.[kind] || {}).sort((a, b) => b[1] - a[1]);

  const matchNow = async () => {
    setRunning(true);
    try {
      const out = await runMatching();
      setSummary(out.summary);
      const po = out.counts.po || {};
      toast.success(`Matched: ${po.linked || 0} linked, ${po.review || 0} need review`);
      if (!out.roms.ok) toast.error(`ROMS not read: ${out.roms.error}`);
      loadRows();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Matching failed');
    } finally { setRunning(false); }
  };

  const changed = () => { loadSummary(); loadRows(); };

  return (
    <AppShell>
      <div className="mb-4 max-w-4xl">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-brand">Match review</h1>
          <HelpLink section="match-review" />
        </div>
        <p className="text-gray-500 text-sm mt-1">
          Each ROMS PO with the Tally invoice that billed it, and each RTV row with its credit note. Start with
          {' '}<strong>Needs review</strong>: open a row to see why, then confirm RAMS&apos;s answer or pick the right one.
          RAMS doesn&apos;t write to ROMS yet — &ldquo;Auto-fill would write&rdquo; shows what it will.
        </p>
      </div>

      {summary && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <RomsLine summary={summary} />
          {canRun && (
            <Button size="sm" variant="outline" onClick={matchNow} loading={running}>
              {!running && <RefreshCw size={14} />} Match now
            </Button>
          )}
        </div>
      )}

      <div role="tablist" className="flex gap-1 mb-3">
        {[['po', 'POs'], ['rtv', 'RTV credit notes']].map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            onClick={() => setFilter({ kind: k, reason: '' })}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${kind === k ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {Object.entries(OUTCOMES).map(([key, o]) => (
          <button
            key={key}
            type="button"
            aria-pressed={filters.outcome === key}
            onClick={() => setFilter({ outcome: filters.outcome === key ? '' : key, reason: '' })}
            className={`text-left rounded-xl border p-3 transition-shadow ${TILE_COLORS[key]} ${filters.outcome === key ? 'ring-2 ring-brand/40 shadow-sm' : 'hover:shadow-sm'}`}
          >
            <p className="text-2xl font-bold tabular-nums">{counts ? counts[key].toLocaleString('en-IN') : '—'}</p>
            <p className="text-sm font-medium">{o.label}</p>
            <p className="text-xs opacity-75 mt-0.5">{o.help}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <form onSubmit={(e) => { e.preventDefault(); setFilter({ q: search.trim() }); }} className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            aria-label="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => search.trim() !== filters.q && setFilter({ q: search.trim() })}
            placeholder={kind === 'po' ? 'PO, Vendor PO No, Bill No, invoice' : 'RTV No, CN No, PO, credit note'}
            className="pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm w-72 max-w-full"
          />
        </form>
        <select aria-label="Status" value={filters.outcome} onChange={(e) => setFilter({ outcome: e.target.value, reason: '' })} className={selectCls}>
          <option value="">Every status</option>
          {Object.entries(OUTCOMES).map(([k, o]) => <option key={k} value={k}>{o.label}</option>)}
        </select>
        <select aria-label="Reason" value={filters.reason} onChange={(e) => setFilter({ reason: e.target.value })} className={selectCls}>
          <option value="">Every reason</option>
          {reasons.map(([r, n]) => <option key={r} value={r}>{reasonLabel(kind, r)} ({n})</option>)}
        </select>
        <select aria-label="Vendor" value={filters.vendor} onChange={(e) => setFilter({ vendor: e.target.value })} className={selectCls}>
          <option value="">Every vendor</option>
          {(summary?.vendors || []).map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select aria-label="Company" value={filters.company_id} onChange={(e) => setFilter({ company_id: e.target.value })} className={selectCls}>
          <option value="">Every company</option>
          {(summary?.companies || []).map((c) => <option key={c.id} value={c.id}>{c.code || c.name}</option>)}
        </select>
        {(filters.q || filters.reason || filters.vendor || filters.company_id) && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setFilter({ q: '', reason: '', vendor: '', company_id: '' }); }}>Clear</Button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {(kind === 'po'
                  ? ['PO', 'Vendor', 'Vendor PO No', 'Bill No in ROMS', 'Tally invoice', 'Status', 'Auto-fill would write']
                  : ['RTV', 'Vendor', 'CN No in ROMS', 'Tally credit note', 'Status', 'Auto-fill would write']
                ).map((h) => <th key={h} className="px-4 py-3 text-left font-semibold text-gray-600 whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                ))
              ) : data.rows.map((r) => (
                <tr
                  key={`${r.kind}:${r.id}`}
                  onClick={() => setOpen({ kind: r.kind, id: r.id })}
                  className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer align-top"
                >
                  <td className="px-4 py-3 whitespace-nowrap">
                    <button type="button" className="font-medium text-brand hover:underline" onClick={(e) => { e.stopPropagation(); setOpen({ kind: r.kind, id: r.id }); }}>
                      {r.kind === 'po' ? r.po_id : r.rtv?.rtv_no || r.id}
                    </button>
                    <p className="text-xs text-gray-400">{r.kind === 'po' ? formatDay(r.po.po_date) : `PO ${r.po_id}`}</p>
                  </td>
                  <td className="px-4 py-3">{r.vendor || '—'}</td>
                  {r.kind === 'po' && <td className="px-4 py-3 break-all">{r.po.vendor_po_id || '—'}</td>}
                  <td className="px-4 py-3">{(r.kind === 'po' ? r.po.bill_no : r.rtv?.cn_number) || <span className="text-gray-400">blank</span>}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {r.voucher_number ? (
                      <>
                        <span className="font-medium">{r.voucher_number}</span>
                        <p className="text-xs text-gray-400">{r.company} · {formatDay(r.voucher_date)}</p>
                      </>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 min-w-[16rem]">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <OutcomeBadge outcome={r.outcome} />
                      {r.method && r.outcome === 'linked' && <span className="text-xs text-gray-500">{METHOD_TEXT[r.method]}</span>}
                    </div>
                    {r.reason && <p className="text-xs text-gray-600 mt-1">{reasonText(r.kind, r.reason, { ...r.params, vendor: r.vendor })}</p>}
                    {r.notes?.length > 0 && (
                      <p className="text-xs text-blue-700 mt-1">Note: {r.notes.map((n) => CHECK_TEXT[n]?.label || n).join(', ')}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-700">{r.outcome === 'linked' ? fillText(r.fill) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && data.rows.length === 0 && (
            <EmptyState summary={summary} filters={filters} />
          )}
        </div>
        <Pagination
          page={page}
          pageSize={pageSize}
          total={data.total}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); persistPageSize('matchReview', s); setPage(1); }}
        />
      </div>

      {open && <MatchDetail key={`${open.kind}:${open.id}`} target={open} onClose={() => setOpen(null)} onChanged={changed} canReview={canReview} />}
    </AppShell>
  );
}

function EmptyState({ summary, filters }) {
  if (summary && !summary.companies.length) {
    return <p className="text-center text-gray-400 py-8">No Tally company is syncing yet. <Link to="/admin/companies" className="text-brand hover:underline">Turn a company&apos;s sync on</Link> first.</p>;
  }
  if (summary && !summary.last_run) {
    return <p className="text-center text-gray-400 py-8">Matching hasn&apos;t run yet. It starts on its own within the hour, or press Match now.</p>;
  }
  if (filters.outcome === 'review' && !filters.q && !filters.reason) {
    return <p className="text-center text-gray-500 py-8">Nothing needs review right now.</p>;
  }
  return <p className="text-center text-gray-400 py-8">Nothing matches these filters.</p>;
}
