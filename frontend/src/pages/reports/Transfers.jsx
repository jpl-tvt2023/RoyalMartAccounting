import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import Pagination, { loadPersistedPageSize, persistPageSize } from '../../components/ui/Pagination';
import ReportFrame, { ReportTable, td, num } from '../../components/reports/ReportFrame';
import { getTransfers } from '../../api/reports.api';
import { useKeyedLoad } from '../../hooks/useKeyedLoad';
import { useSessionState } from '../../hooks/useSessionState';
import { formatDay, formatRupees } from '../../utils/formatters';
import { downloadCsv, rupeesForCsv } from '../../utils/csv';

// Reports -> Stock transfers: sales from one Roymax registration to another
// (a party ledger that is "Our own registration" on Party ledgers). They are
// kept out of receivables.
const DEFAULTS = { company_id: '', q: '' };

export default function Transfers() {
  const [filters, setFilters] = useSessionState('reports.transfers', DEFAULTS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => loadPersistedPageSize('transfers', 50));
  const { data, last, loading } = useKeyedLoad(getTransfers, { ...filters, page, page_size: pageSize });
  const set = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const view = data || { rows: [], total: last?.total || 0 };

  const csv = async () => {
    try {
      const all = await getTransfers({ ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), page_size: 10000 });
      downloadCsv('rams-stock-transfers.csv', [
        ['From', (r) => r.company], ['Voucher', (r) => r.number], ['Date', (r) => r.date], ['To', (r) => r.party], ['Quantity', (r) => r.qty],
        ['Value', (r) => rupeesForCsv(r.total_paise)],
      ], all.rows);
    } catch { toast.error('The download failed'); }
  };

  return (
    <ReportFrame
      title="Stock transfers"
      help="stock-transfers"
      intro="Sales from one Roymax registration to another (for example MH to HR). They move our own stock, so they are kept out of receivables."
      companies={last?.companies || []}
      companyId={filters.company_id}
      onCompany={(v) => set({ company_id: v })}
      search={filters.q}
      onSearch={(v) => set({ q: v })}
      searchHint="Voucher or party"
      onCsv={csv}
    >
      <p className="text-sm text-gray-500 mb-2">
        A ledger counts as our own registration when its GSTIN carries Roymax&apos;s PAN, or when someone sets it so on{' '}
        <Link to="/matching/parties" className="text-brand hover:underline">Party ledgers</Link>. Linking these to ROMS&apos;s Flipkart and Amazon rows is still to be decided.
      </p>
      {data?.totals && <p className="text-sm text-gray-600 mb-2">{data.totals.transfers.toLocaleString('en-IN')} transfers · {formatRupees(data.totals.total_paise, { decimals: 0 })}</p>}
      <ReportTable
        loading={loading}
        head={['Voucher', 'From', 'To', { label: 'Quantity', right: true }, { label: 'Value', right: true }]}
        empty={!loading && view.rows.length === 0 && <p className="text-center text-gray-400 py-8">No stock transfer found.</p>}
      >
        {view.rows.map((r) => (
          <tr key={r.guid} className="border-b border-gray-100">
            <td className={`${td} whitespace-nowrap`}><span className="font-medium">{r.number}</span><p className="text-xs text-gray-400">{formatDay(r.date)}</p></td>
            <td className={td}>{r.company}</td>
            <td className={td}>{r.party}</td>
            <td className={num}>{Number(r.qty).toLocaleString('en-IN')}</td>
            <td className={num}>{formatRupees(r.total_paise)}</td>
          </tr>
        ))}
      </ReportTable>
      <Pagination page={page} pageSize={pageSize} total={view.total} onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); persistPageSize('transfers', s); setPage(1); }} />
    </ReportFrame>
  );
}
