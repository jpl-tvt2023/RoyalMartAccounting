import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import Badge from '../../components/ui/Badge';
import Pagination, { loadPersistedPageSize, persistPageSize } from '../../components/ui/Pagination';
import ReportFrame, {
  ReportTable, selectCls, td, num,
} from '../../components/reports/ReportFrame';
import { getInvoices } from '../../api/reports.api';
import { useKeyedLoad } from '../../hooks/useKeyedLoad';
import { useSessionState } from '../../hooks/useSessionState';
import { formatDay, formatRupees } from '../../utils/formatters';
import { downloadCsv, rupeesForCsv } from '../../utils/csv';

// Reports -> Invoices: every Tally sales invoice since RAMS started, with its
// marketplace, PO, what settled it and what is still owed. Stock transfers are
// on their own page.
const INVOICE_STATUS = {
  open: { label: 'Open', color: 'blue' },
  overdue: { label: 'Overdue', color: 'red' },
  settled: { label: 'Settled', color: 'green' },
  not_billwise: { label: 'Not bill-wise', color: 'gray' },
};
const TABS = [['', 'All'], ['open', 'Open'], ['overdue', 'Overdue'], ['settled', 'Settled'], ['no_po', 'No PO']];
const VENDOR_FROM = { suggested: 'suggested from the party ledger', ledger: 'from the party ledger' };
const DEFAULTS = {
  company_id: '', vendor: '', status: '', q: '', sort: '',
};

export default function Invoices() {
  const [filters, setFilters] = useSessionState('reports.invoices', DEFAULTS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => loadPersistedPageSize('invoices', 50));
  const { data, last, loading } = useKeyedLoad(getInvoices, { ...filters, page, page_size: pageSize });
  const set = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const view = data || { rows: [], total: last?.total || 0 };

  const csv = async () => {
    try {
      const all = await getInvoices({ ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), page_size: 10000 });
      downloadCsv('rams-invoices.csv', [
        ['Company', (r) => r.company], ['Invoice', (r) => r.number], ['Date', (r) => r.date], ['Party', (r) => r.party],
        ['Marketplace', (r) => r.vendor || ''], ['PO', (r) => r.pos.join(' ')], ['Taxable', (r) => rupeesForCsv(r.taxable_paise)],
        ['GST', (r) => rupeesForCsv(r.gst_paise)], ['Total', (r) => rupeesForCsv(r.total_paise)], ['Received', (r) => rupeesForCsv(r.received_paise)],
        ['Credit notes', (r) => rupeesForCsv(r.credit_notes_paise)], ['TDS', (r) => rupeesForCsv(r.tds_paise)], ['Adjustments', (r) => rupeesForCsv(r.adjustments_paise)],
        ['Outstanding', (r) => rupeesForCsv(r.outstanding_paise)], ['Due', (r) => r.due_date], ['Overdue days', (r) => r.overdue_days], ['Status', (r) => r.status],
      ], all.rows);
    } catch { toast.error('The download failed'); }
  };

  return (
    <ReportFrame
      title="Invoices"
      help="invoices"
      intro="Every Tally sales invoice since RAMS started, with its marketplace and PO, what settled it (receipts, credit notes, TDS) and what is still owed. Figures are worked out from Tally each time you open the page."
      companies={last?.companies || []}
      companyId={filters.company_id}
      onCompany={(v) => set({ company_id: v })}
      search={filters.q}
      onSearch={(v) => set({ q: v })}
      searchHint="Invoice, party or PO"
      onCsv={csv}
      filters={(
        <>
          <select aria-label="Marketplace" value={filters.vendor} onChange={(e) => set({ vendor: e.target.value })} className={selectCls}>
            <option value="">Every marketplace</option>
            {(last?.vendors || []).map((v) => <option key={v} value={v}>{v}</option>)}
            <option value="-">Not known</option>
          </select>
          <select aria-label="Order" value={filters.sort} onChange={(e) => set({ sort: e.target.value })} className={selectCls}>
            <option value="">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="outstanding">Most outstanding</option>
            <option value="overdue">Most overdue</option>
          </select>
        </>
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div role="tablist" className="flex gap-1">
          {TABS.map(([k, label]) => (
            <button key={label} role="tab" aria-selected={filters.status === k} onClick={() => set({ status: k })}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filters.status === k ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              {label}
            </button>
          ))}
        </div>
        {data?.totals && (
          <p className="text-sm text-gray-600">
            {data.totals.invoices.toLocaleString('en-IN')} invoices · {formatRupees(data.totals.total_paise, { decimals: 0 })} invoiced ·{' '}
            <strong>{formatRupees(data.totals.outstanding_paise, { decimals: 0 })} outstanding</strong>
            {data.totals.overdue_paise ? <span className="text-danger"> · {formatRupees(data.totals.overdue_paise, { decimals: 0 })} overdue</span> : null}
          </p>
        )}
      </div>
      <ReportTable
        loading={loading}
        head={['Invoice', 'Party', 'Marketplace / PO', { label: 'Taxable', right: true }, { label: 'GST', right: true }, { label: 'Total', right: true },
          { label: 'Received', right: true }, { label: 'CN + TDS + adj.', right: true }, { label: 'Outstanding', right: true }, 'Status']}
        empty={!loading && view.rows.length === 0 && <p className="text-center text-gray-400 py-8">No invoice matches these filters.</p>}
      >
        {view.rows.map((r) => (
          <tr key={r.guid} className="border-b border-gray-100 align-top">
            <td className={`${td} whitespace-nowrap`}><span className="font-medium">{r.number}</span><p className="text-xs text-gray-400">{r.company} · {formatDay(r.date)}</p></td>
            <td className={`${td} max-w-[16rem]`}>{r.party}</td>
            <td className={td}>
              {r.vendor || <span className="text-gray-400">not known</span>}
              {r.vendor_from && VENDOR_FROM[r.vendor_from] && <p className="text-xs text-gray-400">{VENDOR_FROM[r.vendor_from]}</p>}
              {r.pos.length > 0 && <p className="text-xs"><Link to="/matching" className="text-brand hover:underline">{r.pos.join(', ')}</Link></p>}
            </td>
            <td className={num}>{formatRupees(r.taxable_paise)}</td>
            <td className={num}>{formatRupees(r.gst_paise)}</td>
            <td className={num}>{formatRupees(r.total_paise)}</td>
            <td className={num}>{formatRupees(r.received_paise)}</td>
            <td className={num}>{formatRupees(r.credit_notes_paise + r.tds_paise + r.adjustments_paise)}</td>
            <td className={`${num} font-medium`}>{r.outstanding_paise != null && r.outstanding_paise < 0 ? <span className="text-blue-700">{formatRupees(-r.outstanding_paise)} over</span> : formatRupees(r.outstanding_paise)}</td>
            <td className={`${td} whitespace-nowrap`}>
              <Badge color={INVOICE_STATUS[r.status].color}>{INVOICE_STATUS[r.status].label}</Badge>
              {r.overdue_days > 0 && <p className="text-xs text-danger mt-0.5">{r.overdue_days} days past {formatDay(r.due_date)}</p>}
              {r.status === 'open' && <p className="text-xs text-gray-400 mt-0.5">due {formatDay(r.due_date)}</p>}
            </td>
          </tr>
        ))}
      </ReportTable>
      <Pagination page={page} pageSize={pageSize} total={view.total} onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); persistPageSize('invoices', s); setPage(1); }} />
    </ReportFrame>
  );
}
