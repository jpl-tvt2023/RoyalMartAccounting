import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import ReportFrame from '../../components/reports/ReportFrame';
import { getExceptions } from '../../api/reports.api';
import { useKeyedLoad } from '../../hooks/useKeyedLoad';
import { useSessionState } from '../../hooks/useSessionState';
import { reasonText } from '../../utils/matchReasons';
import { formatDay, formatRupees } from '../../utils/formatters';

// Reports -> Exceptions: everything that needs a person, by kind, each saying
// where it is fixed.
const KINDS = {
  bill_not_in_tally: { title: 'Bill No or CN No in ROMS, not found in Tally', fix: 'Check the number in ROMS, or enter the invoice in Tally.', link: ['/matching', 'Match review'] },
  invoice_no_po: { title: 'Tally invoice with no PO', fix: 'Usually the Buyer’s Order No is missing on the invoice in Tally, or the PO isn’t in ROMS.', link: ['/reports/invoices', 'Invoices'] },
  conflict: { title: 'ROMS and Tally disagree', fix: 'The number typed in ROMS isn’t the invoice or credit note RAMS found. Decide on Match review, or write Tally’s number on Auto-fill.', link: ['/matching', 'Match review'] },
  ambiguous: { title: 'More than one possible invoice or credit note', fix: 'Pick the right one on Match review.', link: ['/matching', 'Match review'] },
  rtv_no_cn: { title: 'RTV row with no credit note yet', fix: 'The return was recorded in ROMS but Tally has no credit note against the invoice.', link: ['/matching', 'Match review'] },
  autofill_refused: { title: 'Auto-fill refused by ROMS', fix: 'ROMS’s reason is shown; fix the cause or try again on Auto-fill.', link: ['/matching/autofill', 'Auto-fill'] },
};

function Row({ code, r }) {
  if (code === 'invoice_no_po') {
    return <li>{r.number} · {r.company} · {formatDay(r.date)} · {r.party}{r.vendor ? ` (${r.vendor})` : ''} · {formatRupees(r.total_paise, { decimals: 0 })} · {r.age_days} days old</li>;
  }
  if (code === 'autofill_refused') {
    return <li>{r.kind === 'po' ? `PO ${r.po_id}` : `RTV ${r.rtv_no || r.id}`} · {r.value} · <span className="text-danger">{r.reason}</span>{r.dry ? ' (Preview)' : ''}</li>;
  }
  const what = r.kind === 'po' ? `PO ${r.po_id}` : `RTV ${r.rtv_no || r.id} (PO ${r.po_id})`;
  const why = r.reason === 'autofill_differs'
    ? `ROMS has ${r.params.typed}, Tally says ${r.params.number}`
    : reasonText(r.kind, r.reason, { ...r.params, vendor: r.vendor });
  return <li>{what}{r.vendor ? ` · ${r.vendor}` : ''}{r.age_days != null ? ` · ${r.age_days} days` : ''} · <span className="text-gray-600">{why}</span></li>;
}

export default function Exceptions() {
  const [filters, setFilters] = useSessionState('reports.exceptions', { company_id: '' });
  const [open, setOpen] = useState(null);
  const { data, last, loading } = useKeyedLoad(getExceptions, filters);

  return (
    <ReportFrame
      title="Exceptions"
      help="exceptions"
      intro="Everything that needs a person, by kind. Each says where it is fixed. They clear by themselves once fixed: the next match takes them off."
      companies={last?.companies || []}
      companyId={filters.company_id}
      onCompany={(v) => setFilters({ company_id: v })}
    >
      {loading && <div className="h-40 bg-gray-100 rounded-xl animate-pulse" />}
      {data && (
        <div className="space-y-2">
          {data.categories.map((c) => {
            const k = KINDS[c.code];
            const isOpen = open === c.code;
            return (
              <section key={c.code} className="bg-white rounded-xl border border-gray-200">
                <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.code)} disabled={!c.count}
                  className="w-full flex items-center justify-between gap-3 p-4 text-left disabled:cursor-default">
                  <span className="flex items-center gap-2">
                    {c.count ? (isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : <span className="w-4" />}
                    <span className="font-medium text-gray-900">{k.title}</span>
                  </span>
                  <span className={`text-lg font-bold tabular-nums ${c.count ? 'text-amber-700' : 'text-gray-300'}`}>{c.count}</span>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 text-sm">
                    <p className="text-gray-500 mb-2">{k.fix} <Link to={k.link[0]} className="text-brand hover:underline">Open {k.link[1]}</Link></p>
                    <ul className="list-disc ml-5 space-y-0.5">{c.rows.map((r, i) => <Row key={`${r.id || r.number}-${i}`} code={c.code} r={r} />)}</ul>
                    {c.count > c.rows.length && <p className="text-xs text-gray-400 mt-2">Showing the first {c.rows.length} of {c.count}.</p>}
                  </div>
                )}
              </section>
            );
          })}
          <p className="text-xs text-gray-500">An invoice with no PO, or an RTV row with no credit note, counts after {data.exception_days} days (set under Credit terms on Receivables).</p>
        </div>
      )}
    </ReportFrame>
  );
}
