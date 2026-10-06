import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, AlertTriangle, Send, Check, RotateCcw, PenLine,
} from 'lucide-react';
import toast from 'react-hot-toast';
import AppShell from '../../components/layout/AppShell';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Pagination, { loadPersistedPageSize, persistPageSize } from '../../components/ui/Pagination';
import { HistoryButton } from '../../components/shared/HistoryDrawer';
import HelpLink from '../../components/shared/HelpLink';
import {
  getAutofillSummary, listAutofillItems, listAutofillEvents, updateAutofillSettings,
  approveAutofill, runAutofill, retryAutofill, overwriteAutofill,
} from '../../api/autofill.api';
import { useAuth } from '../../context/AuthContext';
import { useSessionState } from '../../hooks/useSessionState';
import { PERM } from '../../utils/roles';
import {
  FIELDS, MODES, itemStatus, changeText,
} from '../../utils/autofillText';
import { formatDateTime } from '../../utils/formatters';

// Matching -> Auto-fill: RAMS writes Tally's numbers into ROMS -- a linked
// PO's Bill No + Bill Date, a linked RTV row's CN No + CN Date. Each field has
// a mode (Off, Preview, Ask first, Automatic), set by whoever holds "Switch
// auto-fill on or off". The lists show what is waiting, what needs a person,
// what ROMS refused, and what RAMS wrote.
const selectCls = 'px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-gray-50 disabled:text-gray-600';
const TABS = [
  ['todo', 'To write'],
  ['differs', 'Needs a person'],
  ['refused', 'Refused by ROMS'],
  ['written', 'Written'],
];
const TAB_STATES = { todo: 'to_check,checked,to_write', differs: 'differs', refused: 'refused' };
const DEFAULT_VIEW = { kind: 'po', tab: 'todo', q: '' };
const MAX_ROUNDS = 100;

const n = (v) => Number(v || 0).toLocaleString('en-IN');

function Stat({ value, label, tone = 'text-gray-800' }) {
  return (
    <div>
      <p className={`text-lg font-bold tabular-nums ${tone}`}>{n(value)}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

function FieldCard({
  kind, summary, canSettings, onMode, onSetting,
}) {
  const f = summary.fields[kind];
  const field = FIELDS[kind];
  const { settings } = summary;
  const waiting = f.mode === 'approve' ? f.states.checked + f.states.to_check : 0;
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4" aria-label={field.label}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold text-gray-900">{field.label}</h2>
        <select
          aria-label={`${field.label} auto-fill mode`}
          value={f.mode}
          disabled={!canSettings}
          onChange={(e) => onMode(kind, e.target.value)}
          className={selectCls}
        >
          {Object.entries(MODES).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
      </div>
      <p className="text-sm text-gray-500 mt-1">{MODES[f.mode].help}</p>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mt-3">
        <Stat value={f.due.write} label="To write now" />
        <Stat value={waiting} label="Waiting for approval" tone={waiting ? 'text-purple-700' : 'text-gray-800'} />
        <Stat value={f.written} label={`Written (${n(f.written_today)} today)`} tone="text-green-700" />
        <Stat value={f.states.refused} label="Refused by ROMS" tone={f.states.refused ? 'text-danger' : 'text-gray-800'} />
        <Stat value={f.states.differs} label="Needs a person" tone={f.states.differs ? 'text-amber-700' : 'text-gray-800'} />
      </div>
      {kind === 'po' && (
        <label className="flex flex-wrap items-center gap-2 text-sm text-gray-700 mt-3">
          Bill Date:
          <select
            aria-label="Which Bill Date is written"
            value={settings.bill_date_rule}
            disabled={!canSettings}
            onChange={(e) => onSetting({ bill_date_rule: e.target.value })}
            className={selectCls}
          >
            <option value="tally">Use the invoice date in Tally</option>
            <option value="keep">Keep a Bill Date staff typed (fill only a blank one)</option>
          </select>
        </label>
      )}
    </section>
  );
}

export default function AutoFill() {
  const { can } = useAuth();
  const canSettings = can(PERM.AUTOFILL_SETTINGS);
  const canApprove = can(PERM.AUTOFILL_APPROVE);
  const canOverwrite = can(PERM.AUTOFILL_OVERWRITE);
  const [view, setView] = useSessionState('autofill.view', DEFAULT_VIEW);
  const [search, setSearch] = useState(view.q);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => loadPersistedPageSize('autofill', 25));
  const [summary, setSummary] = useState(null);
  const [writing, setWriting] = useState(null); // { done, total }
  const [confirm, setConfirm] = useState(null); // { title, message, label, run }
  const [busy, setBusy] = useState(false);
  // The list for the current view; loading while it holds another's.
  const request = JSON.stringify({ ...view, page, page_size: pageSize });
  const [result, setResult] = useState({ key: null, rows: [], total: 0 });
  const [tick, setTick] = useState(0);
  const loading = result.key !== request;
  const data = loading ? { rows: [], total: result.total } : result;

  const loadSummary = useCallback(() => getAutofillSummary().then(setSummary).catch(() => toast.error('Failed to load auto-fill')), []);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => {
    let cancelled = false;
    const v = JSON.parse(request);
    const params = { kind: v.kind, page: v.page, page_size: v.page_size, ...(v.q ? { q: v.q } : {}) };
    const load = v.tab === 'written'
      ? listAutofillEvents({ ...params, result: 'applied' })
      : listAutofillItems({ ...params, state: TAB_STATES[v.tab] });
    load
      .then((d) => { if (!cancelled) setResult({ key: request, ...d }); })
      .catch(() => {
        if (cancelled) return;
        toast.error('Failed to load the list');
        setResult({ key: request, rows: [], total: 0 });
      });
    return () => { cancelled = true; };
  }, [request, tick]);
  const reload = () => { setTick((t) => t + 1); loadSummary(); };
  const setFilter = (patch) => { setView((v) => ({ ...v, ...patch })); setPage(1); };

  const { kind, tab } = view;
  const field = FIELDS[kind];
  const f = summary?.fields[kind];
  const due = summary ? summary.fields.po.due.write + summary.fields.po.due.check + summary.fields.rtv.due.write + summary.fields.rtv.due.check : 0;
  const approvable = f && f.mode === 'approve' ? f.states.checked + f.states.to_check : 0;

  const saveSettings = async (body, message) => {
    try {
      await updateAutofillSettings(body);
      toast.success(message);
      reload();
    } catch (err) { toast.error(err.response?.data?.message || 'Save failed'); }
  };
  const changeMode = (k, mode) => {
    const text = `${FIELDS[k].short} auto-fill: ${MODES[mode].label}`;
    if (mode !== 'auto') return saveSettings({ [FIELDS[k].mode]: mode }, text);
    return setConfirm({
      title: 'Write into ROMS automatically',
      message: `From now on RAMS writes every linked ${FIELDS[k].row}'s ${FIELDS[k].label} into ROMS after each match, without asking. ROMS still refuses a field a person changed since RAMS read it. Switch it Off at any time to stop.`,
      label: 'Switch to Automatic',
      run: async () => { await saveSettings({ [FIELDS[k].mode]: mode }, text); setConfirm(null); },
    });
  };

  // Rounds until RAMS says nothing is left, with progress.
  const writeNow = async () => {
    const total = Math.max(due, 1);
    let done = 0;
    const counts = { written: 0, refused: 0, checked: 0 };
    setWriting({ done, total });
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const out = await runAutofill();
        for (const k of Object.keys(counts)) counts[k] += out.counts?.[k] || 0;
        done += Object.values(out.counts || {}).reduce((a, b) => a + b, 0);
        setWriting({ done, total: Math.max(total, done + (out.remaining || 0)) });
        if (out.summary) setSummary(out.summary);
        if (!out.more) break;
      }
      toast.success(`Written into ROMS: ${n(counts.written)}${counts.refused ? ` · refused: ${n(counts.refused)}` : ''}${counts.checked ? ` · checked: ${n(counts.checked)}` : ''}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Writing to ROMS failed');
    } finally {
      setWriting(null);
      reload();
    }
  };

  const approve = async (ids) => {
    try {
      const { approved } = await approveAutofill(kind, ids);
      toast.success(`${n(approved)} approved`);
      if (!ids) await writeNow();
      else reload();
    } catch (err) { toast.error(err.response?.data?.message || 'That did not work'); }
  };

  const act = async (fn, okText) => {
    setBusy(true);
    try {
      const out = await fn();
      if (out?.result && out.result !== 'written' && out.result !== 'already') toast.error(`ROMS refused: ${out.reason || 'no reason given'}`);
      else toast.success(okText);
      setConfirm(null);
      reload();
    } catch (err) { toast.error(err.response?.data?.message || 'That did not work'); } finally { setBusy(false); }
  };

  const rowLabel = (r) => (r.kind === 'po' ? r.po_id : r.rtv_no || r.id || r.target_id);

  return (
    <AppShell>
      <div className="mb-4 max-w-4xl">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-brand">Auto-fill into ROMS</h1>
          <div className="flex items-center gap-1">
            <HistoryButton entityType="autofill_settings" entityId={1} title="History — Auto-fill switches" />
            <HelpLink section="auto-fill" />
          </div>
        </div>
        <p className="text-gray-500 text-sm mt-1">
          RAMS writes Tally&apos;s number into the ROMS field it belongs in, exactly as Tally prints it: the Bill No and Bill Date of a
          linked PO, and the Credit Note No and CN Date of a linked RTV row. Nothing else in ROMS is touched. ROMS checks every write
          with its own rules, refuses one if a person changed the field meanwhile, and shows it in its history as &ldquo;Tally Sync&rdquo;.
        </p>
      </div>

      {summary && !summary.roms.connected && (
        <p className="flex items-center gap-1.5 text-amber-700 text-sm mb-3">
          <AlertTriangle size={14} /> ROMS isn&apos;t connected, so nothing can be written. An Admin sets ROMS_API_URL and ROMS_INTEGRATION_TOKEN.
        </p>
      )}

      {summary && (
        <>
          <div className="grid lg:grid-cols-2 gap-3 mb-3">
            {['po', 'rtv'].map((k) => (
              <FieldCard key={k} kind={k} summary={summary} canSettings={canSettings} onMode={changeMode} onSetting={(b) => saveSettings(b, 'Saved')} />
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={summary.settings.replace_typed}
                disabled={!canSettings}
                onChange={(e) => saveSettings({ replace_typed: e.target.checked }, 'Saved')}
              />
              Also rewrite a number staff typed in another form (607 or 0607 → 607/RM/26-27)
            </label>
            <div className="flex items-center gap-3">
              {summary.last_run && (
                <span className="text-xs text-gray-500">
                  Last sent {formatDateTime(summary.last_run.finished_at || summary.last_run.started_at)}
                  {summary.last_run.status === 'failed' && summary.last_run.error ? <span className="text-danger"> — {summary.last_run.error}</span> : null}
                </span>
              )}
              {canApprove && due > 0 && (
                <Button size="sm" onClick={writeNow} loading={Boolean(writing)} disabled={Boolean(writing)}>
                  {!writing && <Send size={14} />} Write now ({n(due)})
                </Button>
              )}
            </div>
          </div>
          {writing && (
            <div className="mb-4" role="status" aria-label="Writing to ROMS">
              <p className="text-sm text-gray-600 mb-1">Writing to ROMS… {n(writing.done)} of {n(writing.total)}</p>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-brand transition-all" style={{ width: `${Math.min(100, (writing.done / writing.total) * 100)}%` }} />
              </div>
            </div>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div role="tablist" aria-label="Field" className="flex gap-1">
          {Object.entries(FIELDS).map(([k, fl]) => (
            <button key={k} role="tab" aria-selected={kind === k} onClick={() => setFilter({ kind: k })}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${kind === k ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              {fl.short}
            </button>
          ))}
        </div>
        <div role="tablist" aria-label="List" className="flex gap-1">
          {TABS.map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setFilter({ tab: t })}
              className={`px-3 py-2 rounded-lg text-sm ${tab === t ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              {label}
            </button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); setFilter({ q: search.trim() }); }} className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)}
            onBlur={() => search.trim() !== view.q && setFilter({ q: search.trim() })}
            placeholder="PO, RTV No or number" className="pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm w-56" />
        </form>
        {canApprove && tab === 'todo' && approvable > 0 && (
          <Button size="sm" className="ml-auto" onClick={() => setConfirm({
            title: 'Approve and write',
            message: `Write ${n(approvable)} ${field.short} value${approvable === 1 ? '' : 's'} into ROMS now? Each one is Tally's number for a ${field.row} RAMS linked. ROMS refuses any a person changed meanwhile.`,
            label: 'Approve and write',
            run: async () => { setConfirm(null); await approve(null); },
          })}>
            <Check size={14} /> Approve all ({n(approvable)})
          </Button>
        )}
      </div>

      {f && f.mode === 'off' && tab === 'todo' && data.rows.length > 0 && (
        <p className="text-sm text-gray-500 mb-2">Auto-fill is Off for the {field.short}: this is what RAMS would write once it is switched on.</p>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {(tab === 'written'
                  ? ['When', field.row, 'Change in ROMS', 'By']
                  : [field.row, 'Vendor', 'Tally', tab === 'differs' ? 'ROMS has → Tally says' : 'Change in ROMS', tab === 'refused' ? 'ROMS said' : 'Status', '']
                ).map((h) => <th key={h} className="px-4 py-3 text-left font-semibold text-gray-600 whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(4)].map((_, i) => <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)
              ) : tab === 'written' ? data.rows.map((e) => (
                <tr key={e.id} className="border-b border-gray-100">
                  <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDateTime(e.at)}</td>
                  <td className="px-4 py-3 font-medium">{rowLabel(e)}{e.kind === 'rtv' && <p className="text-xs text-gray-400">PO {e.po_id}</p>}</td>
                  <td className="px-4 py-3">{changeText(e)}</td>
                  <td className="px-4 py-3">{e.by ? `Approved by ${e.by}` : 'Automatic'}</td>
                </tr>
              )) : data.rows.map((r) => (
                <tr key={`${r.kind}:${r.id}`} className="border-b border-gray-100 align-top">
                  <td className="px-4 py-3 font-medium whitespace-nowrap">{rowLabel(r)}{r.kind === 'rtv' && <p className="text-xs text-gray-400">PO {r.po_id}</p>}</td>
                  <td className="px-4 py-3">{r.vendor || '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{r.voucher_number || r.value}<p className="text-xs text-gray-400">{r.company || ''}</p></td>
                  <td className="px-4 py-3">{changeText(r)}</td>
                  <td className="px-4 py-3 min-w-[12rem]">
                    {tab === 'refused'
                      ? <span className="text-danger">{r.reason}{r.dry ? ' (asked in Preview — nothing was written)' : ''}</span>
                      : <Badge color={itemStatus(r.state, f?.mode).color}>{itemStatus(r.state, f?.mode).label}</Badge>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right">
                    {tab === 'todo' && canApprove && f?.mode === 'approve' && r.state !== 'to_write' && (
                      <Button size="sm" variant="outline" onClick={() => approve([r.id])}>Approve</Button>
                    )}
                    {tab === 'refused' && canApprove && (
                      <Button size="sm" variant="outline" onClick={() => act(() => retryAutofill(r.kind, r.id), 'It will be tried again on the next round')}>
                        <RotateCcw size={14} /> Try again
                      </Button>
                    )}
                    {tab === 'differs' && canOverwrite && (
                      <Button size="sm" variant="outline" onClick={() => setConfirm({
                        title: 'Write Tally’s number',
                        message: `ROMS has "${r.expected}" on ${field.row} ${rowLabel(r)}, which isn't a way of writing Tally's ${r.value}. A person linked it to ${r.value}. Write ${r.value} into ROMS over "${r.expected}"? ROMS's history will show it, with your name.`,
                        label: 'Write it',
                        run: () => act(() => overwriteAutofill(r.kind, r.id), `Written into ROMS: ${r.value}`),
                      })}>
                        <PenLine size={14} /> Write Tally’s number
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && data.rows.length === 0 && <EmptyState summary={summary} view={view} />}
        </div>
        <Pagination page={page} pageSize={pageSize} total={data.total} onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); persistPageSize('autofill', s); setPage(1); }} />
      </div>

      <ConfirmDialog
        isOpen={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm?.run()}
        title={confirm?.title || ''}
        message={confirm?.message || ''}
        confirmLabel={confirm?.label || 'OK'}
        variant="primary"
        loading={busy}
      />
    </AppShell>
  );
}

function EmptyState({ summary, view }) {
  if (view.q) return <p className="text-center text-gray-400 py-8">Nothing matches the search.</p>;
  if (summary && !summary.roms.connected && view.tab === 'todo') {
    return <p className="text-center text-gray-400 py-8">Nothing can be written until ROMS is connected.</p>;
  }
  const text = {
    todo: <>Nothing waiting. New links appear here after each match — see <Link to="/matching" className="text-brand hover:underline">Match review</Link>.</>,
    differs: 'No row needs a person.',
    refused: 'ROMS has refused nothing.',
    written: 'Nothing written yet.',
  }[view.tab];
  return <p className="text-center text-gray-400 py-8">{text}</p>;
}
