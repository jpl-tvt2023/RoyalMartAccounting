import { useCallback, useEffect, useState } from 'react';
import { Pencil, Eye, RotateCcw, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import AppShell from '../../components/layout/AppShell';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { HistoryButton } from '../../components/shared/HistoryDrawer';
import HelpLink from '../../components/shared/HelpLink';
import {
  getMatchSettings, updateMatchSettings, resetMatchSettings, previewMatchSettings,
  getMatchingSummary, listVendors, updateVendor, listVoucherTypes,
} from '../../api/matching.api';
import { useAuth } from '../../context/AuthContext';
import { PERM } from '../../utils/roles';
import { OUTCOMES, reasonLabel } from '../../utils/matchReasons';
import { formatDateTime } from '../../utils/formatters';

// Matching -> Matching rules. Every rule is a setting (backend migration 012),
// shown in plain words with an example and how many POs it decides now.
// Editing: change, preview the effect (nothing is saved), then save and
// re-match. Needs "Change matching rules"; everyone else sees it read-only.
const LEVELS = [['off', 'Off'], ['note', 'Show a note'], ['review', 'Needs review']];
const STRENGTHS = [
  ['exact', 'Exactly — only capitals may differ'],
  ['normalised', 'Ignoring separators and leading zeros (RM/26-27/001 = RM-26-27-1)'],
  ['compact', 'Letters and digits only (RM/26-27/006 = RM2627006)'],
];
const MODES = [['match', 'Match POs to invoices'], ['transfer', 'Stock transfer — not matched yet'], ['skip', 'Don’t match']];
const inputCls = 'px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-gray-50 disabled:text-gray-600';

// The rules as the page shows them. used(summary) = how many POs it decides now.
const SECTIONS = [
  {
    title: 'Finding the invoice for a PO',
    rules: [
      { key: 'use_order_no', type: 'bool', label: 'Match a PO by the Buyer’s Order No on the Tally invoice', example: 'PO number P4588464 is on invoice 607/RM/26-27 → linked.', used: (s) => s.methods.po.order_no },
      { key: 'order_no_drop_label', type: 'bool', indent: true, label: 'Ignore a label after a dash', example: 'Zepto’s “P4588464- Dry” is read as P4588464.', used: (s) => s.methods.po.order_no_label },
      { key: 'order_no_split', type: 'bool', indent: true, label: 'Try each number when the PO field holds several', example: '“PCHPO213987/PCHPO228901” matches an invoice carrying either.', used: (s) => s.methods.po.order_no_split },
      { key: 'use_bill_no', type: 'bool', label: 'Match by the Bill No typed in ROMS', example: 'Bill No 607/RM/26-27 finds that invoice.', used: (s) => s.methods.po.bill_no },
      { key: 'bill_no_serial', type: 'bool', indent: true, label: 'A Bill No of digits only matches the invoice’s serial', example: '607 or 0607 finds 607/RM/26-27. Also lets RAMS accept a typed serial as the same invoice.', used: (s) => s.methods.po.bill_serial },
      { key: 'number_strength', type: 'select', options: STRENGTHS, label: 'How closely numbers must agree', example: 'Applies to PO numbers, Bill Nos and CN Nos.' },
      { key: 'pick_same_date', type: 'bool', label: 'When a number is on several invoices, take the one dated on the Bill Date', example: 'Serial 607 is in MH and HR: the one on the Bill Date wins.' },
      { key: 'pick_same_fy', type: 'bool', label: '…else the only one in the same financial year', example: 'Last year’s 607/RM/25-26 is told apart from this year’s.' },
      { key: 'bill_only_links', type: 'select', options: [['linked', 'Linked'], ['review', 'Needs review']], label: 'A link found by the Bill No alone (no Buyer’s Order No) is', example: 'Choose Needs review to have a person confirm each one.', used: (s) => s.reasons.po.bill_only },
    ],
  },
  {
    title: 'Checks on each link',
    intro: 'Each check can be Off, Show a note (the PO stays Linked, with a warning), or Needs review (the PO waits for a person).',
    rules: [
      { key: 'check_party', type: 'level', label: 'The invoice’s party ledger belongs to another marketplace, or is our own registration', example: 'Uses the mappings on Party ledgers.', used: (s) => (s.reasons.po.check_party || 0) + (s.notes.party || 0) },
      { key: 'check_sku', type: 'level', label: 'No SKU on the invoice is on the PO', example: 'SKUs come from the marketplace code in the Tally item name.', used: (s) => (s.reasons.po.check_sku || 0) + (s.notes.sku || 0) },
      { key: 'check_qty', type: 'level', label: 'The invoice’s quantity is more than the PO’s', extra: { key: 'qty_tolerance_pct', label: 'allowing', unit: '% more', min: 0, max: 100 }, used: (s) => (s.reasons.po.check_qty || 0) + (s.notes.qty || 0) },
      { key: 'check_date', type: 'level', label: 'The invoice is dated before the PO', extra: { key: 'date_tolerance_days', label: 'allowing', unit: 'days earlier', min: 0, max: 60 }, used: (s) => (s.reasons.po.check_date || 0) + (s.notes.date || 0) },
      { key: 'check_split', type: 'level', label: 'The PO number is also on another invoice no other PO has', example: 'The Bill No picked one; the other invoice may be a split dispatch.', used: (s) => (s.reasons.po.check_split || 0) + (s.notes.split || 0) },
      { key: 'check_reused', type: 'level', label: 'The same invoice is linked to another PO', example: 'For example a PO re-issued after a return.', used: (s) => (s.reasons.po.check_reused || 0) + (s.notes.reused || 0) },
    ],
  },
  {
    title: 'Credit notes for RTV rows',
    rules: [
      { key: 'cn_agst_ref', type: 'bool', label: 'Link a credit note that settles the PO’s invoice (Agst Ref in Tally)', used: (s) => (s.methods.rtv.agst_ref || 0) + (s.methods.rtv.cn_number_agst_ref || 0) },
      { key: 'cn_number', type: 'bool', label: 'Link a credit note whose number is the CN No typed on the RTV row', used: (s) => (s.methods.rtv.cn_number || 0) + (s.methods.rtv.cn_number_agst_ref || 0) },
    ],
  },
  {
    title: 'Waiting and timing',
    rules: [
      { key: 'grace_days', type: 'number', min: 0, max: 90, unit: 'days', label: 'A Bill No or CN No not found in Tally waits this long before it needs review', example: 'Gives the accountant time to enter the invoice.' },
      { key: 'run_every_minutes', type: 'number', min: 15, max: 720, unit: 'minutes', label: 'Match again every … in office hours', example: 'Also straight after Tally changes. Office hours are on Admin → Tally companies.' },
    ],
  },
];

function Delta({ before = 0, after = 0 }) {
  const d = after - before;
  return <span className={d > 0 ? 'text-green-700' : d < 0 ? 'text-danger' : 'text-gray-400'}>{d > 0 ? `+${d}` : d}</span>;
}

export default function MatchingRules() {
  const { can } = useAuth();
  const canEdit = can(PERM.MATCHING_RULES);
  const [settings, setSettings] = useState(null);
  const [recommended, setRecommended] = useState(null);
  const [summary, setSummary] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [types, setTypes] = useState([]);
  const [draft, setDraft] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const load = useCallback(() => Promise.all([getMatchSettings(), getMatchingSummary(), listVendors(), listVoucherTypes()])
    .then(([st, sum, v, t]) => { setSettings(st.settings); setRecommended(st.recommended); setSummary(sum); setVendors(v); setTypes(t); })
    .catch(() => toast.error('Failed to load the matching rules')), []);
  useEffect(() => { load(); }, [load]);

  const shown = draft || settings;
  const set = (key, value) => { setDraft((d) => ({ ...d, [key]: value })); setPreview(null); };
  const changes = draft ? Object.keys(recommended || {}).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(settings[k])) : [];
  const body = () => Object.fromEntries(changes.map((k) => [k, draft[k]]));

  const runPreview = async () => {
    setBusy(true);
    try { setPreview(await previewMatchSettings(body())); } catch (err) {
      toast.error(err.response?.data?.message || 'Preview failed');
    } finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true);
    try {
      const out = await updateMatchSettings(body());
      setSettings(out.settings); setDraft(null); setPreview(null);
      toast.success('Rules saved and re-matched');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally { setBusy(false); }
  };

  const reset = async () => {
    setBusy(true);
    try {
      const out = await resetMatchSettings();
      setSettings(out.settings); setDraft(null); setPreview(null); setConfirmReset(false);
      toast.success('Back to the recommended rules');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Reset failed');
    } finally { setBusy(false); }
  };

  const changeVendor = async (vendor, mode) => {
    try {
      await updateVendor(vendor, mode);
      toast.success(`${vendor}: ${MODES.find(([m]) => m === mode)[1]}`);
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Save failed'); }
  };

  const excluded = new Set((shown?.excluded_voucher_types || []).map((t) => t.toUpperCase()));
  const toggleType = (name) => {
    const list = shown.excluded_voucher_types;
    set('excluded_voucher_types', excluded.has(name.toUpperCase()) ? list.filter((t) => t.toUpperCase() !== name.toUpperCase()) : [...list, name]);
  };

  const control = (rule) => {
    const disabled = !draft;
    const v = shown[rule.key];
    const id = `rule-${rule.key}`;
    if (rule.type === 'bool') {
      return <input id={id} type="checkbox" checked={v} disabled={disabled} onChange={(e) => set(rule.key, e.target.checked)} className="w-4 h-4 accent-brand" />;
    }
    if (rule.type === 'number') {
      return (
        <span className="flex items-center gap-1.5">
          <input id={id} type="number" min={rule.min} max={rule.max} value={v} disabled={disabled} onChange={(e) => set(rule.key, Number(e.target.value))} className={`${inputCls} w-24`} />
          <span className="text-gray-500 text-xs">{rule.unit}</span>
        </span>
      );
    }
    const options = rule.type === 'level' ? LEVELS : rule.options;
    return (
      <span className="flex flex-wrap items-center gap-2">
        <select id={id} value={v} disabled={disabled} onChange={(e) => set(rule.key, e.target.value)} className={inputCls}>
          {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {rule.extra && (
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            {rule.extra.label}
            <input type="number" min={rule.extra.min} max={rule.extra.max} value={shown[rule.extra.key]} disabled={disabled} onChange={(e) => set(rule.extra.key, Number(e.target.value))} className={`${inputCls} w-20`} aria-label={`${rule.label}: ${rule.extra.unit}`} />
            {rule.extra.unit}
          </label>
        )}
      </span>
    );
  };

  return (
    <AppShell>
      <div className="mb-4 max-w-4xl">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-brand">Matching rules</h1>
          <HelpLink section="matching-rules" />
        </div>
        <p className="text-gray-500 text-sm mt-1">
          How RAMS links ROMS POs to Tally invoices and RTV rows to credit notes. A person&apos;s decision on Match review always wins over these rules.
          {settings?.updated_at ? ` Last changed ${formatDateTime(settings.updated_at)} by ${settings.updated_by_name || '—'}.` : ''}
        </p>
      </div>

      {canEdit && settings && (
        <div className="sticky top-14 z-10 bg-gray-50/95 backdrop-blur py-2 mb-3 flex flex-wrap items-center gap-2">
          {!draft ? (
            <>
              <Button size="sm" onClick={() => setDraft({ ...settings })}><Pencil size={14} /> Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)}><RotateCcw size={14} /> Reset to recommended</Button>
            </>
          ) : (
            <>
              <span className="text-sm text-gray-600">{changes.length ? `${changes.length} change${changes.length === 1 ? '' : 's'}` : 'No changes yet'}</span>
              <Button size="sm" variant="outline" disabled={!changes.length} loading={busy && !preview} onClick={runPreview}><Eye size={14} /> Preview the effect</Button>
              <Button size="sm" disabled={!changes.length} loading={busy && !!preview} onClick={save}>Save and re-match</Button>
              <Button size="sm" variant="ghost" onClick={() => { setDraft(null); setPreview(null); }}>Cancel</Button>
            </>
          )}
          <span className="ml-auto"><HistoryButton entityType="match_settings" entityId={1} title="History — Matching rules" /></span>
        </div>
      )}

      {preview && (
        <section aria-label="Preview" className="bg-white rounded-xl border border-brand/30 p-4 mb-4 max-w-4xl">
          <h2 className="font-semibold text-brand">If you save: {preview.changed} row{preview.changed === 1 ? '' : 's'} would change status</h2>
          <p className="text-xs text-gray-500">Nothing has been saved yet.</p>
          <table className="text-sm mt-2">
            <thead><tr className="text-gray-500"><th className="pr-4 text-left font-medium" />{Object.values(OUTCOMES).map((o) => <th key={o.label} className="px-3 text-right font-medium">{o.label}</th>)}</tr></thead>
            <tbody>
              {['po', 'rtv'].map((k) => (
                <tr key={k}>
                  <td className="pr-4 py-1 font-medium">{k === 'po' ? 'POs' : 'RTV rows'}</td>
                  {Object.keys(OUTCOMES).map((o) => (
                    <td key={o} className="px-3 py-1 text-right tabular-nums">
                      {preview.after[k]?.[o] ?? 0} <span className="text-xs">(<Delta before={preview.before[k]?.[o]} after={preview.after[k]?.[o]} />)</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {preview.examples.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-gray-700">
              {preview.examples.map((e) => (
                <li key={`${e.target_kind}:${e.target_id}`} className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{e.target_kind === 'po' ? `PO ${e.po_id}` : `RTV row of PO ${e.po_id}`}</span>
                  <span className="text-gray-400">{e.vendor}</span>:
                  <span>{e.from ? `${OUTCOMES[e.from.outcome].label}${e.from.reason ? ` (${reasonLabel(e.target_kind, e.from.reason)})` : ''}` : 'new'}</span>
                  <ArrowRight size={12} />
                  <span>{OUTCOMES[e.to.outcome].label}{e.to.reason ? ` (${reasonLabel(e.target_kind, e.to.reason)})` : ''}{e.to.voucher_number ? ` → ${e.to.voucher_number}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!shown || !summary ? (
        <div className="space-y-3 max-w-4xl">{[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-white rounded-xl border border-gray-200 animate-pulse" />)}</div>
      ) : (
        <div className="space-y-4 max-w-4xl">
          {SECTIONS.map((section) => (
            <section key={section.title} className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="font-semibold text-brand">{section.title}</h2>
              {section.intro && <p className="text-xs text-gray-500 mt-0.5">{section.intro}</p>}
              <ul className="mt-2 divide-y divide-gray-100">
                {section.rules.map((rule) => {
                  const used = rule.used ? rule.used(summary) || 0 : null;
                  const differs = recommended && JSON.stringify(shown[rule.key]) !== JSON.stringify(recommended[rule.key]);
                  return (
                    <li key={rule.key} className={`py-2.5 flex flex-wrap items-start justify-between gap-3 ${rule.indent ? 'pl-6' : ''}`}>
                      <div className="min-w-0 flex-1">
                        <label htmlFor={`rule-${rule.key}`} className="text-sm text-gray-900 font-medium">{rule.label}</label>
                        {rule.example && <p className="text-xs text-gray-500">{rule.example}</p>}
                        <p className="text-xs text-gray-400">
                          {used != null && <>Used for {used.toLocaleString('en-IN')} now. </>}
                          {differs && <span className="text-amber-700">Changed from the recommended setting.</span>}
                        </p>
                      </div>
                      <div className="shrink-0">{control(rule)}</div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          <section className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="font-semibold text-brand">Which Tally vouchers count</h2>
            <p className="text-xs text-gray-500 mt-0.5">Untick a voucher type that should never count as an invoice or a credit note.{!draft && canEdit ? ' Click Edit to change.' : ''}</p>
            <ul className="mt-2 grid sm:grid-cols-2 gap-1">
              {types.map((t) => (
                <li key={`${t.base_type}:${t.voucher_type}`}>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" disabled={!draft} checked={!excluded.has(t.voucher_type.toUpperCase())} onChange={() => toggleType(t.voucher_type)} className="w-4 h-4 accent-brand" />
                    {t.voucher_type} <span className="text-xs text-gray-400">({t.base_type === 'Sales' ? 'invoices' : 'credit notes'}, {t.n.toLocaleString('en-IN')})</span>
                  </label>
                </li>
              ))}
              {types.length === 0 && <li className="text-sm text-gray-400">No sales or credit note vouchers synced yet.</li>}
            </ul>
          </section>

          <section className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="font-semibold text-brand">Vendors</h2>
            <p className="text-xs text-gray-500 mt-0.5">How each ROMS marketplace is matched. A change saves at once and re-matches.</p>
            <table className="w-full text-sm mt-2">
              <thead><tr className="text-left text-gray-500"><th className="py-1 font-medium">Vendor</th><th className="py-1 font-medium">POs</th><th className="py-1 font-medium">Linked</th><th className="py-1 font-medium">Matched as</th></tr></thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.vendor} className="border-t border-gray-100">
                    <td className="py-2 font-medium">{v.vendor}</td>
                    <td className="py-2 tabular-nums">{v.pos}</td>
                    <td className="py-2 tabular-nums">{v.linked}</td>
                    <td className="py-2">
                      <select aria-label={`How ${v.vendor} is matched`} value={v.mode} disabled={!canEdit} onChange={(e) => changeVendor(v.vendor, e.target.value)} className={inputCls}>
                        {MODES.map(([m, label]) => <option key={m} value={m}>{label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={reset}
        title="Reset to recommended"
        message="Put every matching rule back to the recommended setting and re-match? People's decisions on Match review are kept."
        confirmLabel="Reset"
        variant="primary"
        loading={busy}
      />
    </AppShell>
  );
}
