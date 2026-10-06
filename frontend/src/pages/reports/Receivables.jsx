import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import ReportFrame, { ReportTable, td, num } from '../../components/reports/ReportFrame';
import { HistoryButton } from '../../components/shared/HistoryDrawer';
import {
  getReceivables, getReportSettings, updateReportSettings, updateTerms,
} from '../../api/reports.api';
import { useAuth } from '../../context/AuthContext';
import { useKeyedLoad } from '../../hooks/useKeyedLoad';
import { useSessionState } from '../../hooks/useSessionState';
import { PERM } from '../../utils/roles';
import { formatDay, formatRupees } from '../../utils/formatters';
import { downloadCsv, rupeesForCsv } from '../../utils/csv';

// Reports -> Receivables: per marketplace and company, what was invoiced, how
// it was settled, what is still owed, how old it is, and money received On
// Account (not yet set against an invoice in Tally). Stock transfers are left
// out. The credit terms that decide "overdue" are set here.
const r0 = (p) => formatRupees(p, { decimals: 0 });
const inputCls = 'w-20 px-2 py-1 border border-gray-200 rounded-lg text-sm text-right disabled:bg-gray-50';

function TermsPanel({ canEdit, onSaved }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  useEffect(() => {
    getReportSettings().then(setData).catch(() => toast.error('Failed to load credit terms'));
  }, []);
  if (!data) return null;

  const saveSetting = async (key, value) => {
    const v = Number(value);
    if (!Number.isInteger(v) || v === data.settings[key]) return;
    try {
      setData(await updateReportSettings({ [key]: v }));
      toast.success('Saved');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.message || 'Save failed'); }
  };
  const saveTerm = async (vendor, value) => {
    const days = value === '' ? null : Number(value);
    const current = data.terms.find((t) => t.vendor === vendor)?.credit_days ?? null;
    if (days === current || (days != null && !Number.isInteger(days))) return;
    try {
      setData(await updateTerms(vendor, days));
      toast.success(`${vendor}: ${days == null ? 'the default' : `${days} days`}`);
      onSaved();
    } catch (err) { toast.error(err.response?.data?.message || 'Save failed'); }
  };
  const field = (key) => (draft[key] ?? String(data.settings[key]));

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4 mt-4" aria-label="Credit terms">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-gray-900">Credit terms</h2>
        <HistoryButton entityType="report_settings" entityId={1} title="History — report settings" />
      </div>
      <p className="text-sm text-gray-500 mt-1">An invoice is overdue once its credit days have passed. Leave a marketplace empty to use the default.</p>
      <div className="flex flex-wrap gap-4 mt-3 text-sm">
        <label className="flex items-center gap-2">Default
          <input aria-label="Default credit days" className={inputCls} disabled={!canEdit} value={field('default_credit_days')}
            onChange={(e) => setDraft((d) => ({ ...d, default_credit_days: e.target.value }))} onBlur={(e) => saveSetting('default_credit_days', e.target.value)} /> days
        </label>
        {data.terms.map((t) => (
          <label key={t.vendor} className="flex items-center gap-2">{t.vendor}
            <input aria-label={`${t.vendor} credit days`} className={inputCls} disabled={!canEdit} placeholder="default"
              value={draft[t.vendor] ?? (t.credit_days == null ? '' : String(t.credit_days))}
              onChange={(e) => setDraft((d) => ({ ...d, [t.vendor]: e.target.value }))} onBlur={(e) => saveTerm(t.vendor, e.target.value.trim())} />
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm mt-3">An invoice with no PO, or an RTV row with no credit note, is an exception after
        <input aria-label="Exception days" className={inputCls} disabled={!canEdit} value={field('exception_days')}
          onChange={(e) => setDraft((d) => ({ ...d, exception_days: e.target.value }))} onBlur={(e) => saveSetting('exception_days', e.target.value)} /> days
      </label>
    </section>
  );
}

export default function Receivables() {
  const { can } = useAuth();
  const [filters, setFilters] = useSessionState('reports.receivables', { company_id: '' });
  const { data, last, loading, reload } = useKeyedLoad(getReceivables, filters);
  const view = data || { rows: [], totals: null, buckets: [] };
  const buckets = (data || last)?.buckets || [];

  const csv = () => downloadCsv('rams-receivables.csv', [
    ['Marketplace', (r) => r.vendor || 'Not known'], ['Company', (r) => r.company], ['Invoices', (r) => r.invoices],
    ['Invoiced', (r) => rupeesForCsv(r.invoiced_paise)], ['Received', (r) => rupeesForCsv(r.received_paise)], ['Credit notes', (r) => rupeesForCsv(r.credit_notes_paise)],
    ['TDS', (r) => rupeesForCsv(r.tds_paise)], ['Adjustments', (r) => rupeesForCsv(r.adjustments_paise)], ['Outstanding', (r) => rupeesForCsv(r.outstanding_paise)],
    ['Overdue', (r) => rupeesForCsv(r.overdue_paise)], ...buckets.map((b) => [b.label, (r) => rupeesForCsv(r[`${b.key}_paise`])]),
    ['Received on account', (r) => rupeesForCsv(r.unallocated_paise)], ['Net outstanding', (r) => rupeesForCsv(r.net_outstanding_paise)],
  ], view.rows);

  const row = (r, key, strong) => (
    <tr key={key} className={`border-b border-gray-100 ${strong ? 'bg-gray-50 font-semibold' : ''}`}>
      <td className={td}>{strong ? 'Total' : r.vendor || <span className="text-gray-500">Not known</span>}{!strong && <p className="text-xs text-gray-400 font-normal">{r.company} · {r.invoices} invoices, {r.open_invoices} open</p>}</td>
      <td className={num}>{r0(r.invoiced_paise)}</td>
      <td className={num}>{r0(r.received_paise)}</td>
      <td className={num}>{r0(r.credit_notes_paise)}</td>
      <td className={num}>{r0(r.tds_paise + r.adjustments_paise)}</td>
      <td className={`${num} font-semibold`}>{r0(r.outstanding_paise)}</td>
      <td className={`${num} text-danger`}>{r.overdue_paise ? r0(r.overdue_paise) : '—'}</td>
      {buckets.map((b) => <td key={b.key} className={num}>{r[`${b.key}_paise`] ? r0(r[`${b.key}_paise`]) : '—'}</td>)}
      <td className={num}>{r.unallocated_paise ? r0(r.unallocated_paise) : '—'}</td>
      <td className={`${num} font-semibold`}>{r0(r.net_outstanding_paise)}</td>
    </tr>
  );

  return (
    <ReportFrame
      title="Receivables"
      help="receivables"
      intro="What each marketplace owes, per company: invoiced, received, credit notes, TDS and adjustments, outstanding, overdue, and how old it is. Stock transfers are left out."
      companies={last?.companies || []}
      companyId={filters.company_id}
      onCompany={(v) => setFilters({ company_id: v })}
      onCsv={csv}
    >
      {data && <p className="text-sm text-gray-500 mb-2">As of {formatDay(data.as_of)}. Age is days since the invoice date.</p>}
      <ReportTable
        loading={loading}
        head={['Marketplace', { label: 'Invoiced', right: true }, { label: 'Received', right: true }, { label: 'Credit notes', right: true },
          { label: 'TDS + adj.', right: true }, { label: 'Outstanding', right: true }, { label: 'Overdue', right: true },
          ...buckets.map((b) => ({ label: b.label, right: true })), { label: 'Received on account', right: true }, { label: 'Net outstanding', right: true }]}
        empty={!loading && view.rows.length === 0 && <p className="text-center text-gray-400 py-8">No invoices yet.</p>}
        foot={view.totals && view.rows.length > 1 ? <tfoot>{row(view.totals, 'total', true)}</tfoot> : null}
      >
        {view.rows.map((r) => row(r, `${r.vendor}|${r.company_id}`))}
      </ReportTable>
      <p className="text-xs text-gray-500 mt-2">
        &ldquo;Received on account&rdquo; is money Tally holds on a marketplace&apos;s ledger without setting it against an invoice (marketplaces often pay into a
        head-office ledger). Net outstanding takes it off. A head-office ledger shows under &ldquo;Not known&rdquo; until it is mapped on{' '}
        <Link to="/matching/parties" className="text-brand hover:underline">Party ledgers</Link>.
      </p>
      <TermsPanel canEdit={can(PERM.REPORTS_SETTINGS)} onSaved={reload} />
    </ReportFrame>
  );
}
