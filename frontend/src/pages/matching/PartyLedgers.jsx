import { useEffect, useState } from 'react';
import { Search, Wand2 } from 'lucide-react';
import toast from 'react-hot-toast';
import AppShell from '../../components/layout/AppShell';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Pagination, { loadPersistedPageSize, persistPageSize } from '../../components/ui/Pagination';
import HelpLink from '../../components/shared/HelpLink';
import {
  listPartyLedgers, updatePartyLedger, acceptSuggestions, listVendors, getMatchingSummary,
} from '../../api/matching.api';
import { useAuth } from '../../context/AuthContext';
import { useSessionState } from '../../hooks/useSessionState';
import { PERM } from '../../utils/roles';

// Matching -> Party ledgers: which marketplace each Tally party ledger belongs
// to. RAMS suggests one from the POs linked through the ledger; a person
// accepts or sets it ("Map party ledgers"). Our own registrations are found
// from the GSTIN.
const selectCls = 'px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-gray-50';
const SOURCE = {
  person: <Badge color="green">Confirmed</Badge>,
  gstin: <Badge color="purple">From GSTIN</Badge>,
};

// The select's value for a row: 'vendor:Zepto', 'internal', 'other' or ''.
const valueOf = (r) => (r.kind === 'vendor' ? `vendor:${r.vendor}` : r.kind || '');

export default function PartyLedgers() {
  const { can } = useAuth();
  const canMap = can(PERM.MATCHING_PARTIES);
  const [filters, setFilters] = useSessionState('partyLedgers.filters', { status: 'not_set', company_id: '', q: '' });
  const [search, setSearch] = useState(filters.q);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => loadPersistedPageSize('partyLedgers', 25));
  const [vendors, setVendors] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);
  // The list for the current filters; loading while it holds another's.
  const request = JSON.stringify({ ...filters, page, page_size: pageSize });
  const [result, setResult] = useState({ key: null, rows: [], total: 0, suggestions_waiting: 0 });
  const [tick, setTick] = useState(0);
  const loading = result.key !== request;
  const data = loading ? { ...result, rows: [] } : result;

  useEffect(() => {
    let cancelled = false;
    const params = JSON.parse(request);
    Object.keys(params).forEach((k) => { if (params[k] === '') delete params[k]; });
    listPartyLedgers(params)
      .then((d) => { if (!cancelled) setResult({ key: request, ...d }); })
      .catch(() => {
        if (cancelled) return;
        toast.error('Failed to load party ledgers');
        setResult({ key: request, rows: [], total: 0, suggestions_waiting: 0 });
      });
    return () => { cancelled = true; };
  }, [request, tick]);
  const load = () => setTick((t) => t + 1);
  useEffect(() => {
    listVendors().then((v) => setVendors(v.map((x) => x.vendor))).catch(() => {});
    getMatchingSummary().then((s) => setCompanies(s.companies)).catch(() => {});
  }, []);

  const setFilter = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };

  const map = async (row, value) => {
    const body = value.startsWith('vendor:') ? { kind: 'vendor', vendor: value.slice(7) } : { kind: value || null };
    try {
      await updatePartyLedger(row.company_id, row.guid, body);
      toast.success(`${row.name} saved — matching updated`);
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Save failed'); }
  };

  const acceptAll = async () => {
    setBusy(true);
    try {
      const { accepted } = await acceptSuggestions(filters.company_id || null);
      toast.success(`${accepted} ledger${accepted === 1 ? '' : 's'} mapped — matching updated`);
      setConfirmAll(false);
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'That did not work'); } finally { setBusy(false); }
  };

  return (
    <AppShell>
      <div className="mb-4 max-w-4xl">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-brand">Party ledgers</h1>
          <HelpLink section="party-ledgers" />
        </div>
        <p className="text-gray-500 text-sm mt-1">
          Tally has a party ledger per marketplace warehouse. Tell RAMS which marketplace each belongs to, and an invoice billed to the
          wrong party won&apos;t be linked without a person. RAMS suggests one from the POs linked through each ledger.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div role="tablist" className="flex gap-1">
          {[['not_set', 'Not set'], ['suggested', 'With a suggestion'], ['set', 'Set'], ['', 'All']].map(([s, label]) => (
            <button key={label} role="tab" aria-selected={filters.status === s} onClick={() => setFilter({ status: s })}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filters.status === s ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              {label}
            </button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); setFilter({ q: search.trim() }); }} className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input aria-label="Search ledgers" value={search} onChange={(e) => setSearch(e.target.value)} onBlur={() => search.trim() !== filters.q && setFilter({ q: search.trim() })}
            placeholder="Ledger name" className="pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm w-60" />
        </form>
        <select aria-label="Company" value={filters.company_id} onChange={(e) => setFilter({ company_id: e.target.value })} className={selectCls}>
          <option value="">Every company</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.code || c.name}</option>)}
        </select>
        {canMap && data.suggestions_waiting > 0 && (
          <Button size="sm" className="ml-auto" onClick={() => setConfirmAll(true)}>
            <Wand2 size={14} /> Accept all suggestions ({data.suggestions_waiting})
          </Button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Company', 'Ledger', 'GSTIN', 'Vouchers', 'Suggested', 'Maps to', ''].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-semibold text-gray-600 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)
              ) : data.rows.map((r) => (
                <tr key={`${r.company_id}:${r.guid}`} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">{r.company}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{r.gstin || '—'}</td>
                  <td className="px-4 py-3 tabular-nums">{r.vouchers.toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3">
                    {r.suggested_vendor
                      ? <span>{r.suggested_vendor} <span className="text-xs text-gray-400">({r.suggested_votes} PO{r.suggested_votes === 1 ? '' : 's'})</span></span>
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <select aria-label={`What ${r.name} is`} value={valueOf(r)} disabled={!canMap} onChange={(e) => map(r, e.target.value)} className={selectCls}>
                      <option value="">Not set</option>
                      {vendors.map((v) => <option key={v} value={`vendor:${v}`}>{v}</option>)}
                      <option value="internal">Our own registration</option>
                      <option value="other">Not a marketplace</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">{SOURCE[r.source] || (r.suggested_vendor && !r.kind ? <Badge color="amber">Suggested</Badge> : null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && data.rows.length === 0 && (
            <p className="text-center text-gray-400 py-8">
              {filters.status === 'not_set' && !filters.q ? 'Every party ledger is set.' : 'No ledger matches these filters.'}
            </p>
          )}
        </div>
        <Pagination page={page} pageSize={pageSize} total={data.total} onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); persistPageSize('partyLedgers', s); setPage(1); }} />
      </div>

      <ConfirmDialog
        isOpen={confirmAll}
        onClose={() => setConfirmAll(false)}
        onConfirm={acceptAll}
        title="Accept all suggestions"
        message={`Map ${data.suggestions_waiting} ledger${data.suggestions_waiting === 1 ? '' : 's'} to the marketplace RAMS suggests for each${filters.company_id ? ' (this company only)' : ''}? Ledgers already set are not touched, and you can change any of them afterwards.`}
        confirmLabel="Accept all"
        variant="primary"
        loading={busy}
      />
    </AppShell>
  );
}
