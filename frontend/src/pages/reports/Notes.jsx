import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import Badge from '../../components/ui/Badge';
import Pagination, { loadPersistedPageSize, persistPageSize } from '../../components/ui/Pagination';
import ReportFrame, { ReportTable, td, num } from '../../components/reports/ReportFrame';
import { getNotes } from '../../api/reports.api';
import { useKeyedLoad } from '../../hooks/useKeyedLoad';
import { useSessionState } from '../../hooks/useSessionState';
import { formatDay, formatDateTime, formatRupees } from '../../utils/formatters';
import { downloadCsv, rupeesForCsv } from '../../utils/csv';

// Reports -> Credit & debit notes: each Tally CN and DN, the invoices it
// settles (Agst Ref), their PO, the RTV row it was linked to, and whether its
// number is in ROMS yet.
const TABS = [['', 'All'], ['cn', 'Credit notes'], ['dn', 'Debit notes']];
const DEFAULTS = { company_id: '', type: '', q: '' };

function FillState({ autofill }) {
  if (!autofill) return null;
  if (autofill.written_at) return <p className="text-xs text-green-700">In ROMS since {formatDateTime(autofill.written_at)}</p>;
  if (autofill.state === 'refused') return <p className="text-xs text-danger">ROMS refused: {autofill.reason}</p>;
  if (autofill.state === 'differs') return <p className="text-xs text-amber-700">ROMS has another CN No</p>;
  if (autofill.state) return <p className="text-xs text-gray-500">Not in ROMS yet</p>;
  return null;
}

export default function Notes() {
  const [filters, setFilters] = useSessionState('reports.notes', DEFAULTS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => loadPersistedPageSize('notes', 50));
  const { data, last, loading } = useKeyedLoad(getNotes, { ...filters, page, page_size: pageSize });
  const set = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const view = data || { rows: [], total: last?.total || 0 };

  const csv = async () => {
    try {
      const all = await getNotes({ ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), page_size: 10000 });
      downloadCsv('rams-credit-debit-notes.csv', [
        ['Company', (r) => r.company], ['Type', (r) => (r.type === 'cn' ? 'Credit note' : 'Debit note')], ['Number', (r) => r.number], ['Date', (r) => r.date],
        ['Party', (r) => r.party], ['Against', (r) => r.against.join(' ')], ['PO', (r) => r.pos.join(' ')], ['RTV', (r) => r.rtv?.rtv_no || ''],
        ['Amount', (r) => rupeesForCsv(r.amount_paise)],
      ], all.rows);
    } catch { toast.error('The download failed'); }
  };

  return (
    <ReportFrame
      title="Credit & debit notes"
      help="credit-debit-notes"
      intro="Each Tally credit note and debit note, the invoice it settles (its Agst Ref in Tally), that invoice's PO, and the RTV row RAMS linked it to."
      companies={last?.companies || []}
      companyId={filters.company_id}
      onCompany={(v) => set({ company_id: v })}
      search={filters.q}
      onSearch={(v) => set({ q: v })}
      searchHint="Number, party, invoice, PO or RTV"
      onCsv={csv}
      filters={(
        <div role="tablist" className="flex gap-1">
          {TABS.map(([k, label]) => (
            <button key={label} role="tab" aria-selected={filters.type === k} onClick={() => set({ type: k })}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filters.type === k ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              {label}
            </button>
          ))}
        </div>
      )}
    >
      {data?.totals && <p className="text-sm text-gray-600 mb-2">{data.totals.notes.toLocaleString('en-IN')} notes · {formatRupees(data.totals.amount_paise, { decimals: 0 })}</p>}
      <ReportTable
        loading={loading}
        head={['Note', 'Party', 'Against invoice', 'PO / RTV row', { label: 'Amount', right: true }]}
        empty={!loading && view.rows.length === 0 && <p className="text-center text-gray-400 py-8">No note matches these filters.</p>}
      >
        {view.rows.map((r) => (
          <tr key={r.guid} className="border-b border-gray-100 align-top">
            <td className={`${td} whitespace-nowrap`}>
              <Badge color={r.type === 'cn' ? 'blue' : 'purple'}>{r.type === 'cn' ? 'CN' : 'DN'}</Badge> <span className="font-medium">{r.number}</span>
              <p className="text-xs text-gray-400">{r.company} · {formatDay(r.date)}</p>
            </td>
            <td className={`${td} max-w-[16rem]`}>{r.party}{r.vendor && <p className="text-xs text-gray-400">{r.vendor}</p>}</td>
            <td className={td}>
              {r.invoices.length ? r.invoices.join(', ')
                : r.against.length ? <span className="text-gray-500">{r.against.join(', ')} (before RAMS)</span> : <span className="text-gray-400">—</span>}
            </td>
            <td className={td}>
              {r.pos.length ? r.pos.join(', ') : <span className="text-gray-400">—</span>}
              {r.rtv && <p className="text-xs"><Link to="/matching" className="text-brand hover:underline">RTV {r.rtv.rtv_no}</Link></p>}
              <FillState autofill={r.autofill} />
            </td>
            <td className={num}>{formatRupees(r.amount_paise)}</td>
          </tr>
        ))}
      </ReportTable>
      <Pagination page={page} pageSize={pageSize} total={view.total} onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); persistPageSize('notes', s); setPage(1); }} />
    </ReportFrame>
  );
}
