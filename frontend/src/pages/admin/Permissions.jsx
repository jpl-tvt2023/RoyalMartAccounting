import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import toast from 'react-hot-toast';
import AppShell from '../../components/layout/AppShell';
import Button from '../../components/ui/Button';
import { HistoryButton } from '../../components/shared/HistoryDrawer';
import HelpLink from '../../components/shared/HelpLink';
import { getPermissions, updatePermissions } from '../../api/settings.api';
import { formatDateTime } from '../../utils/formatters';

// Admin/Owner only: what Accountants and Viewers may do. Admin and Owner hold
// every permission, shown ticked and locked. Users, the Audit Log and this page
// are not in the list -- they stay Admin/Owner only.
const sameMatrix = (a, b) => a && b && Object.keys(a).every((r) => [...a[r]].sort().join() === [...b[r]].sort().join());

export default function Permissions() {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPermissions()
      .then((d) => { if (!cancelled) { setData(d); setDraft(d.matrix); } })
      .catch(() => toast.error('Failed to load permissions'));
    return () => { cancelled = true; };
  }, []);

  const toggle = (role, key) => setDraft((m) => ({
    ...m, [role]: m[role].includes(key) ? m[role].filter((k) => k !== key) : [...m[role], key],
  }));

  const save = async () => {
    setSaving(true);
    try {
      const fresh = await updatePermissions(draft);
      setData(fresh);
      setDraft(fresh.matrix);
      toast.success('Permissions saved — they apply at once');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally { setSaving(false); }
  };

  const areas = data ? [...new Set(data.catalog.map((p) => p.area))] : [];
  const dirty = data && !sameMatrix(draft, data.matrix);

  return (
    <AppShell>
      <div className="mb-6 max-w-3xl">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-brand">Roles &amp; permissions</h1>
          <HelpLink section="roles-permissions" />
        </div>
        <p className="text-gray-500 text-sm mt-1">
          Admins and Owners can always do everything. Choose what Accountants and Viewers may do; a change applies at once,
          without anyone signing in again. Users, the Audit Log and this page always stay with Admins and Owners.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden max-w-4xl">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Permission</th>
                {['Admin', 'Owner', ...(data?.roles || ['Accountant', 'Viewer'])].map((r) => (
                  <th key={r} className="px-4 py-3 text-center font-semibold text-gray-600 w-28">{r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!data ? (
                [...Array(4)].map((_, i) => (
                  <tr key={i}><td colSpan={5} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                ))
              ) : areas.map((area) => [
                <tr key={area} className="bg-gray-50/60 border-b border-gray-100">
                  <td colSpan={5} className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">{area}</td>
                </tr>,
                ...data.catalog.filter((p) => p.area === area).map((p) => (
                  <tr key={p.key} className="border-b border-gray-100">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{p.label}</p>
                      <p className="text-xs text-gray-500">{p.description}</p>
                    </td>
                    {['Admin', 'Owner'].map((r) => (
                      <td key={r} className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1 text-gray-400" title="Admin and Owner always have every permission">
                          <input type="checkbox" checked readOnly disabled aria-label={`${r}: ${p.label} (always)`} className="w-4 h-4 accent-brand" />
                          <Lock size={12} />
                        </span>
                      </td>
                    ))}
                    {data.roles.map((r) => (
                      <td key={r} className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={draft[r].includes(p.key)}
                          onChange={() => toggle(r, p.key)}
                          aria-label={`${r}: ${p.label}`}
                          className="w-4 h-4 accent-brand cursor-pointer"
                        />
                      </td>
                    ))}
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-200">
          <p className="text-xs text-gray-400">
            {data?.updated_at ? `Last changed ${formatDateTime(data.updated_at)} by ${data.updated_by_name || '—'}.` : 'The defaults: Accountants do the matching work, Viewers only look.'}
          </p>
          <div className="flex items-center gap-2">
            <HistoryButton entityType="role_permissions" entityId={1} title="History — Roles & permissions" />
            <Button variant="ghost" disabled={!dirty || saving} onClick={() => setDraft(data.matrix)}>Discard</Button>
            <Button disabled={!dirty} loading={saving} onClick={save}>Save changes</Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
