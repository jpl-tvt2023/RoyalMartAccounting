import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, MinusCircle, Search, UserCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import ConfirmDialog from '../ui/ConfirmDialog';
import { HistoryButton } from '../shared/HistoryDrawer';
import { getResult, decide, searchVouchers } from '../../api/matching.api';
import { overwriteAutofill } from '../../api/autofill.api';
import { autofillStatus } from '../../utils/autofillText';
import {
  OUTCOMES, reasonText, howText, METHOD_TEXT, CHECK_TEXT, fillText,
} from '../../utils/matchReasons';
import { formatDay, formatDateTime } from '../../utils/formatters';

const rupees = (paise) => (paise == null ? '—' : `₹${(Number(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export function OutcomeBadge({ outcome }) {
  const o = OUTCOMES[outcome] || { label: outcome, color: 'gray' };
  return <Badge color={o.color}>{o.label}</Badge>;
}

// One PO or RTV row: how RAMS matched it, the checks, every candidate, and
// the decisions a person can take (with "matching.review"). With "See
// auto-fill", where auto-fill is with the row (fillMode is its field's mode);
// with "Replace a different value", writing Tally's number over one staff
// typed.
export default function MatchDetail({
  target, onClose, onChanged, canReview, fillMode, canOverwrite = false,
}) {
  const [detail, setDetail] = useState(null);
  const [confirm, setConfirm] = useState(null); // { action, voucher?, title, message, label, variant }
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null);

  // The parent mounts one of these per row (key = kind:id), so nothing here
  // needs resetting when the row changes.
  const { kind, id } = target || {};
  useEffect(() => {
    if (!kind) return undefined;
    let cancelled = false;
    getResult(kind, id)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch(() => toast.error('Failed to load this row'));
    return () => { cancelled = true; };
  }, [kind, id]);

  if (!target) return null;
  const isPo = target.kind === 'po';
  const noun = isPo ? 'invoice' : 'credit note';
  const title = isPo ? `PO ${target.id}` : `RTV ${detail?.rtv?.rtv_no || target.id} (PO ${detail?.po_id || ''})`;

  const act = async () => {
    setBusy(true);
    try {
      if (confirm.action === 'overwrite') {
        const out = await overwriteAutofill(target.kind, target.id);
        if (out.result === 'written' || out.result === 'already') toast.success(confirm.done);
        else toast.error(`ROMS refused: ${out.reason || 'no reason given'}`);
      } else {
        const body = confirm.voucher ? { company_id: confirm.voucher.company_id, voucher_guid: confirm.voucher.guid } : {};
        const fresh = await decide(target.kind, target.id, confirm.action, body);
        setDetail((d) => ({ ...d, ...fresh }));
        toast.success(confirm.done);
      }
      setConfirm(null);
      onChanged?.();
      getResult(target.kind, target.id).then(setDetail).catch(() => {});
    } catch (err) {
      toast.error(err.response?.data?.message || 'That did not work');
    } finally { setBusy(false); }
  };

  const search = async (e) => {
    e.preventDefault();
    try { setFound(await searchVouchers(target.kind, query)); } catch { toast.error('Search failed'); }
  };

  const pickDialog = (v) => ({
    action: 'pick', voucher: v, title: `Use this ${noun}`,
    message: `Link ${title} to ${noun} ${v.number} (${v.company}, ${formatDay(v.date)})? RAMS keeps this link, whatever the rules say later.`,
    label: `Use this ${noun}`, variant: 'primary', done: `Linked to ${v.number}`,
  });
  const decisions = detail?.decisions || [];
  const fillStatus = detail && fillMode !== undefined && detail.outcome === 'linked' ? autofillStatus(detail, fillMode) : null;
  const current = detail?.voucher_guid ? (detail.candidates || []).find((c) => c.guid === detail.voucher_guid && c.company_id === detail.company_id) : null;

  return (
    <Modal isOpen={!!target} onClose={onClose} title={title} size="xl">
      {!detail ? (
        <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
      ) : (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <OutcomeBadge outcome={detail.outcome} />
                {detail.method && <span className="text-gray-500">{METHOD_TEXT[detail.method] || detail.method}</span>}
              </div>
              {detail.reason && <p className="text-gray-800">{reasonText(detail.kind, detail.reason, { ...detail.params, vendor: detail.vendor })}</p>}
              {detail.person && (
                <p className="flex items-center gap-1.5 text-brand"><UserCheck size={14} /> Confirmed by {detail.person.by || 'a person'}{detail.person.at ? ` on ${formatDateTime(detail.person.at)}` : ''}</p>
              )}
            </div>
            <HistoryButton entityType={target.kind} entityId={target.id} title={`History — ${title}`} />
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-gray-50 rounded-lg p-3">
            <div><dt className="text-xs text-gray-500">Vendor</dt><dd className="font-medium">{detail.vendor || '—'}</dd></div>
            <div><dt className="text-xs text-gray-500">Vendor PO No</dt><dd className="font-medium break-all">{detail.po.vendor_po_id || '—'}</dd></div>
            <div><dt className="text-xs text-gray-500">PO date</dt><dd className="font-medium">{formatDay(detail.po.po_date)}</dd></div>
            {isPo
              ? <div><dt className="text-xs text-gray-500">Bill No in ROMS</dt><dd className="font-medium">{detail.po.bill_no || 'blank'}{detail.po.bill_date ? ` · ${formatDay(detail.po.bill_date)}` : ''}</dd></div>
              : <div><dt className="text-xs text-gray-500">CN No in ROMS</dt><dd className="font-medium">{detail.rtv?.cn_number || 'blank'}</dd></div>}
          </dl>

          {detail.voucher_number && (
            <div>
              <h3 className="font-semibold text-gray-900">Tally {noun}</h3>
              <p className="text-gray-700 mt-1">{detail.company} · <span className="font-medium">{detail.voucher_number}</span> · {formatDay(detail.voucher_date)}</p>
              {detail.fill && (
                <p className="text-gray-500 mt-1">
                  Auto-fill: <span className="font-medium text-gray-800">{fillText(detail.fill)}</span>
                  {fillStatus && <span className={`ml-2 ${fillStatus.tone}`}>{fillStatus.text}</span>}
                </p>
              )}
              {detail.autofill?.state === 'differs' && canOverwrite && (
                <Button size="sm" variant="outline" className="mt-2" onClick={() => setConfirm({
                  action: 'overwrite',
                  title: 'Write Tally’s number',
                  message: `ROMS has "${detail.fill.current}", which isn't a way of writing ${detail.fill.value}. Write ${detail.fill.value} into ROMS over it? ROMS's history will show it, with your name.`,
                  label: 'Write it',
                  variant: 'primary',
                  done: `Written into ROMS: ${detail.fill.value}`,
                })}>
                  Write Tally’s number into ROMS
                </Button>
              )}
            </div>
          )}

          {detail.how?.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-900">How RAMS matched it</h3>
              <ul className="list-disc ml-5 mt-1 space-y-0.5 text-gray-700">
                {detail.how.map((h, i) => <li key={`${h.code}-${i}`}>{howText(h)}</li>)}
              </ul>
            </div>
          )}

          {detail.checks?.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-900">Checks</h3>
              <ul className="mt-1 space-y-1">
                {detail.checks.map((c) => {
                  const t = CHECK_TEXT[c.code];
                  return (
                    <li key={c.code} className="flex items-start gap-2">
                      {c.ok ? <CheckCircle2 size={15} className="text-green-600 mt-0.5 shrink-0" />
                        : c.level === 'review' ? <AlertTriangle size={15} className="text-amber-600 mt-0.5 shrink-0" />
                          : <MinusCircle size={15} className="text-blue-500 mt-0.5 shrink-0" />}
                      <span><span className="font-medium">{t?.label || c.code}:</span> {c.ok ? t?.ok : t?.failed({ ...c.params, po_vendor: c.params?.po_vendor || detail.vendor })}
                        {!c.ok && <span className="text-gray-400"> ({c.level === 'review' ? 'holds the link for a person' : 'a note only'})</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {(detail.candidates?.length > 0 || canReview) && (
            <div>
              <h3 className="font-semibold text-gray-900">{detail.candidates?.length ? `Tally ${noun}s RAMS considered` : `No Tally ${noun} found`}</h3>
              {detail.candidates?.length > 0 && (
                <div className="overflow-x-auto mt-1 border border-gray-200 rounded-lg">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-gray-50 text-left text-gray-600">
                      {['Company', 'Number', 'Date', 'Party', 'Amount', 'Found by', ''].map((h) => <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {detail.candidates.map((c) => {
                        const isCurrent = current && c.guid === current.guid;
                        return (
                          <tr key={`${c.company_id}:${c.guid}`} className={`border-t border-gray-100 ${isCurrent ? 'bg-green-50/60' : ''}`}>
                            <td className="px-3 py-2">{c.company}</td>
                            <td className="px-3 py-2 font-medium whitespace-nowrap">{c.number}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{formatDay(c.date)}</td>
                            <td className="px-3 py-2">{c.party}</td>
                            <td className="px-3 py-2 tabular-nums whitespace-nowrap">{rupees(c.total_paise)}</td>
                            <td className="px-3 py-2 text-gray-500">{(c.via || []).map((m) => METHOD_TEXT[m] || m).join(', ')}</td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              {canReview && !isCurrent && (
                                <Button size="sm" variant="outline" onClick={() => setConfirm(pickDialog(c))}>Use this {noun}</Button>
                              )}
                              {isCurrent && <span className="text-xs text-green-700">Linked now</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {canReview && (
                <form onSubmit={search} className="flex items-center gap-2 mt-2">
                  <label className="relative flex-1 max-w-xs">
                    <span className="sr-only">Search Tally {noun}s</span>
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Find another ${noun} by number or party`} className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
                  </label>
                  <Button size="sm" variant="ghost" type="submit" disabled={query.trim().length < 2}>Search</Button>
                </form>
              )}
              {found && (
                <ul className="mt-2 divide-y divide-gray-100 border border-gray-200 rounded-lg">
                  {found.length === 0 && <li className="px-3 py-2 text-gray-400">Nothing found.</li>}
                  {found.map((v) => (
                    <li key={`${v.company_id}:${v.guid}`} className="px-3 py-2 flex items-center justify-between gap-2">
                      <span>{v.company} · <span className="font-medium">{v.number}</span> · {formatDay(v.date)} · {v.party} · {rupees(v.total_paise)}</span>
                      <Button size="sm" variant="outline" onClick={() => setConfirm(pickDialog(v))}>Use this {noun}</Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {isPo && detail.lines?.length > 0 && (
            <details>
              <summary className="cursor-pointer font-semibold text-gray-900">PO lines ({detail.lines.length})</summary>
              <ul className="mt-1 text-gray-700">
                {detail.lines.map((l) => <li key={l.line_no}>{l.item_code || '—'} · SKU {l.sku_code || 'not mapped in ROMS'} · qty {l.qty}</li>)}
              </ul>
            </details>
          )}
          {detail.rtv_rows?.length > 0 && (
            <details>
              <summary className="cursor-pointer font-semibold text-gray-900">RTV rows of this PO ({detail.rtv_rows.length})</summary>
              <ul className="mt-1 text-gray-700">
                {detail.rtv_rows.map((r) => <li key={r.id}>{r.rtv_no} · CN {r.cn_number || 'blank'} · {OUTCOMES[r.outcome]?.label || '—'}{r.voucher_number ? ` → ${r.voucher_number}` : ''}</li>)}
              </ul>
            </details>
          )}

          {canReview && (
            <div className="flex flex-wrap gap-2 justify-end pt-2 border-t border-gray-100">
              {decisions.length > 0 && (
                <Button variant="ghost" onClick={() => setConfirm({ action: 'undo', title: 'Undo decisions', message: `Take back the decisions on ${title}? RAMS will match it automatically again.`, label: 'Undo', variant: 'primary', done: 'Back to automatic matching' })}>Undo my decisions</Button>
              )}
              {detail.voucher_guid && (
                <Button variant="danger" onClick={() => setConfirm({ action: 'reject', title: `Reject this ${noun}`, message: `${detail.voucher_number} is not the ${noun} for ${title}? RAMS will never suggest it for this row again.`, label: 'Reject', variant: 'danger', done: `Rejected ${detail.voucher_number}` })}>Reject</Button>
              )}
              {detail.voucher_guid && detail.method !== 'person' && (
                <Button onClick={() => setConfirm({ action: 'confirm', title: `Confirm this ${noun}`, message: `${detail.voucher_number} is the ${noun} for ${title}? RAMS keeps this link, whatever the rules say later.`, label: 'Confirm', variant: 'primary', done: `Confirmed ${detail.voucher_number}` })}>Confirm</Button>
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={act}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel={confirm?.label}
        variant={confirm?.variant}
        loading={busy}
      />
    </Modal>
  );
}
