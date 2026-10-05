import { useCallback, useEffect, useState } from 'react';
import { Pencil, Power, PowerOff } from 'lucide-react';
import toast from 'react-hot-toast';
import AppShell from '../../components/layout/AppShell';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Badge from '../../components/ui/Badge';
import { HistoryButton } from '../../components/shared/HistoryDrawer';
import SyncSchedulePanel from '../../components/settings/SyncSchedulePanel';
import HelpLink from '../../components/shared/HelpLink';
import { useAuth } from '../../context/AuthContext';
import { PERM } from '../../utils/roles';
import { listCompanies, updateCompany } from '../../api/companies.api';
import { formatDateTime } from '../../utils/formatters';

// Admin/Owner, and any role granted sync.companies or sync.schedule (Admin ->
// Roles & permissions); each part's buttons show only with its own permission.
// Companies are created in Tally by the accountants; the
// Connector lists every company it finds loaded there, and this page chooses
// which ones RAMS mirrors -- and, in the Sync schedule panel, when. Which
// companies sync, and when, is data, never code.
const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand';

export default function Companies() {
  const { can } = useAuth();
  const canSync = can(PERM.SYNC_COMPANIES);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState(null); // { company, on }
  const [editing, setEditing] = useState(null); // { company, code }
  const [saving, setSaving] = useState(false);

  const fetchCompanies = useCallback(() => listCompanies()
    .then(setCompanies)
    .catch(() => toast.error('Failed to load companies'))
    .finally(() => setLoading(false)), []);
  const load = () => { setLoading(true); fetchCompanies(); };
  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  const save = async (company, body, message) => {
    setSaving(true);
    try {
      await updateCompany(company.id, body);
      toast.success(message);
      setConfirm(null);
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally { setSaving(false); }
  };

  const syncing = companies.filter((c) => c.sync_enabled).length;

  return (
    <AppShell>
      <div className="mb-6 max-w-3xl">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-brand">Tally companies</h1>
          <HelpLink section="tally-companies" />
        </div>
        <p className="text-gray-500 text-sm mt-1">
          Companies are created in Tally by the accountants. The Connector lists every company it finds loaded in Tally;
          turn sync on for the ones RAMS should mirror. Turning it off stops the sync and keeps what RAMS already holds.
        </p>
        <p className="text-gray-500 text-sm mt-1">{syncing} syncing · {companies.length - syncing} not synced</p>
      </div>

      <SyncSchedulePanel />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Company', 'Code', 'State', 'GSTIN', 'In Tally', 'Vouchers', 'Sync', 'Last seen', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-semibold text-gray-600 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(3)].map((_, i) => (
                  <tr key={i}><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                ))
              ) : companies.map((c) => (
                <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{c.name}</p>
                    <p className="text-xs text-gray-400 font-mono">{c.guid}</p>
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-800">{c.code || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{c.state_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">{c.gstin || '—'}</td>
                  <td className="px-4 py-3">
                    {c.loaded_in_tally
                      ? <span className="text-green-600 text-xs">Loaded</span>
                      : <span className="text-gray-400 text-xs">Not loaded</span>}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-gray-600">{c.vouchers.toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3">{c.sync_enabled ? <Badge color="green">On</Badge> : <Badge>Off</Badge>}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDateTime(c.last_seen_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {canSync && (c.sync_enabled ? (
                        <button onClick={() => setConfirm({ company: c, on: false })} title="Turn sync off" aria-label={`Turn sync off for ${c.name}`} className="p-1.5 rounded hover:bg-red-50 text-danger transition-colors"><PowerOff size={14} /></button>
                      ) : (
                        <button onClick={() => setConfirm({ company: c, on: true })} title="Turn sync on" aria-label={`Turn sync on for ${c.name}`} className="p-1.5 rounded hover:bg-green-50 text-green-600 transition-colors"><Power size={14} /></button>
                      ))}
                      {canSync && <button onClick={() => setEditing({ company: c, code: c.code || '' })} title="Edit code" aria-label={`Edit code for ${c.name}`} className="p-1.5 rounded hover:bg-blue-50 text-blue-500 transition-colors"><Pencil size={14} /></button>}
                      <HistoryButton entityType="tally_company" entityId={c.id} title={`History — ${c.name}`} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && companies.length === 0 && (
            <p className="text-center text-gray-400 py-8">
              No company yet. Companies appear here once the Connector has seen them loaded in Tally.
            </p>
          )}
        </div>
      </div>

      <Modal isOpen={!!editing} onClose={() => setEditing(null)} title={`Code — ${editing?.company.name}`} size="sm">
        <form
          onSubmit={(e) => { e.preventDefault(); save(editing.company, { code: editing.code }, 'Code saved'); }}
          className="space-y-4"
        >
          <div>
            <label htmlFor="company-code" className="block text-sm font-medium text-gray-700 mb-1">Short code</label>
            <input id="company-code" required maxLength={10} value={editing?.code || ''} onChange={(e) => setEditing((s) => ({ ...s, code: e.target.value.toUpperCase() }))} className={inputCls} placeholder="e.g. MH" />
            <p className="text-xs text-gray-400 mt-1">How lists and filters show this company: 1-10 letters, digits or -.</p>
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" type="button" onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" loading={saving}>Save</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => save(confirm.company, { sync_enabled: confirm.on }, `Sync turned ${confirm.on ? 'on' : 'off'} for ${confirm.company.name}`)}
        title={confirm?.on ? 'Turn sync on' : 'Turn sync off'}
        message={confirm?.on
          ? `The Connector will start reading ${confirm?.company.name}'s books from Tally, beginning with a backfill outside office hours.`
          : `The Connector stops reading ${confirm?.company.name}. What RAMS already holds is kept, and turning sync back on continues from where it stopped.`}
        confirmLabel={confirm?.on ? 'Turn on' : 'Turn off'}
        variant={confirm?.on ? 'primary' : 'danger'}
        loading={saving}
      />
    </AppShell>
  );
}
