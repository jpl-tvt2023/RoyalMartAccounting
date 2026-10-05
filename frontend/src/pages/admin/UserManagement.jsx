import { useCallback, useEffect, useState } from 'react';
import { UserPlus, Pencil, KeyRound, UserX, UserCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import AppShell from '../../components/layout/AppShell';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Badge from '../../components/ui/Badge';
import { HistoryButton } from '../../components/shared/HistoryDrawer';
import PasswordCriteria from '../../components/shared/PasswordCriteria';
import HelpLink from '../../components/shared/HelpLink';
import {
  listUsers, createUser, updateUser, deactivateUser, reactivateUser, resetUserPassword,
} from '../../api/users.api';
import { formatDate } from '../../utils/formatters';
import { useAuth } from '../../context/AuthContext';
import { ALL_ROLES, ROLES, ROLE_INFO } from '../../utils/roles';

// Admin/Owner only. Adapted from ROMS: one role per user (the four RAMS roles),
// and users are DEACTIVATED rather than deleted, so the audit trail keeps
// their name.
const ROLE_COLORS = { Admin: 'red', Owner: 'purple', Accountant: 'blue', Viewer: 'gray' };
const EMPTY_FORM = { name: '', username: '', role: ROLES.VIEWER, password: '' };
const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand';

export default function UserManagement() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // 'add' | { id }
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null); // { user, action: 'deactivate' | 'reactivate' }
  const [resetFor, setResetFor] = useState(null);
  const [resetPwd, setResetPwd] = useState('');

  // State is set only when the request settles, so the mount effect can call it.
  const fetchUsers = useCallback(() => listUsers()
    .then(setUsers)
    .catch(() => toast.error('Failed to load users'))
    .finally(() => setLoading(false)), []);
  const load = () => { setLoading(true); fetchUsers(); };
  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const openAdd = () => { setForm(EMPTY_FORM); setModal('add'); };
  const openEdit = (u) => {
    setForm({ name: u.name, username: u.username, role: u.roles[0] || ROLES.VIEWER, password: '' });
    setModal({ id: u.id });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (modal === 'add') {
        await createUser({ name: form.name, username: form.username, password: form.password, roles: [form.role] });
        toast.success('User created — they set their own password at first sign-in');
      } else {
        const before = users.find((u) => u.id === modal.id);
        const roleChanged = before && (before.roles.length !== 1 || before.roles[0] !== form.role);
        await updateUser(modal.id, { name: form.name, roles: [form.role] });
        toast.success(roleChanged ? 'User updated — they will need to sign in again' : 'User updated');
      }
      setModal(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally { setSaving(false); }
  };

  const handleConfirm = async () => {
    setSaving(true);
    try {
      if (confirm.action === 'deactivate') {
        await deactivateUser(confirm.user.id);
        toast.success(`${confirm.user.name} deactivated`);
      } else {
        await reactivateUser(confirm.user.id);
        toast.success(`${confirm.user.name} reactivated`);
      }
      setConfirm(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
      setConfirm(null);
    } finally { setSaving(false); }
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await resetUserPassword(resetFor.id, resetPwd);
      toast.success('Password reset — the user must change it at their next sign-in');
      setResetFor(null);
      setResetPwd('');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Reset failed');
    } finally { setSaving(false); }
  };

  const active = users.filter((u) => u.is_active).length;

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-brand">Users</h1>
          <p className="text-gray-500 text-sm">{active} active · {users.length - active} deactivated</p>
        </div>
        <div className="flex items-center gap-3">
          <HelpLink section="users" />
          <Button onClick={openAdd}><UserPlus size={16} />Add User</Button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Name', 'User ID', 'Role', 'Status', 'Added', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-semibold text-gray-600 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(4)].map((_, i) => (
                  <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                ))
              ) : users.map((u) => (
                <tr key={u.id} className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${u.is_active ? '' : 'opacity-60'}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">{u.name}</td>
                  <td className="px-4 py-3 text-gray-600">{u.username}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r) => <Badge key={r} color={ROLE_COLORS[r] || 'gray'}>{r}</Badge>)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {!u.is_active
                      ? <span className="text-gray-500 text-xs font-semibold">Deactivated</span>
                      : u.is_first_login
                        ? <span className="text-amber-600 text-xs font-semibold">Password not set yet</span>
                        : <span className="text-green-600 text-xs">Active</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(u.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(u)} title="Edit" aria-label={`Edit ${u.name}`} className="p-1.5 rounded hover:bg-blue-50 text-blue-500 transition-colors"><Pencil size={14} /></button>
                      <button onClick={() => setResetFor({ id: u.id, name: u.name })} title="Reset password" aria-label={`Reset password for ${u.name}`} className="p-1.5 rounded hover:bg-amber-50 text-amber-500 transition-colors"><KeyRound size={14} /></button>
                      <HistoryButton entityType="user" entityId={u.id} title={`History — ${u.name}`} />
                      {u.id !== me?.id && (u.is_active ? (
                        <button onClick={() => setConfirm({ user: u, action: 'deactivate' })} title="Deactivate" aria-label={`Deactivate ${u.name}`} className="p-1.5 rounded hover:bg-red-50 text-danger transition-colors"><UserX size={14} /></button>
                      ) : (
                        <button onClick={() => setConfirm({ user: u, action: 'reactivate' })} title="Reactivate" aria-label={`Reactivate ${u.name}`} className="p-1.5 rounded hover:bg-green-50 text-green-600 transition-colors"><UserCheck size={14} /></button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && users.length === 0 && <p className="text-center text-gray-400 py-8">No users found</p>}
        </div>
      </div>

      <Modal isOpen={!!modal} onClose={() => setModal(null)} title={modal === 'add' ? 'Add User' : 'Edit User'}>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label htmlFor="user-name" className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <input id="user-name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} />
          </div>
          {modal === 'add' && (
            <div>
              <label htmlFor="user-username" className="block text-sm font-medium text-gray-700 mb-1">User ID</label>
              <input id="user-username" type="text" required autoCapitalize="none" autoCorrect="off" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value.toLowerCase() }))} className={inputCls} placeholder="e.g. priya" />
              <p className="text-xs text-gray-400 mt-1">Lowercase letters, numbers, dot, underscore or hyphen (3-30 characters). This is what they sign in with.</p>
            </div>
          )}
          <fieldset>
            <legend className="block text-sm font-medium text-gray-700 mb-1">Role</legend>
            <div className="space-y-2 p-3 border border-gray-200 rounded-lg">
              {ALL_ROLES.map((r) => (
                <label key={r} className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="radio" name="role" checked={form.role === r} onChange={() => setForm((f) => ({ ...f, role: r }))} className="w-4 h-4 mt-0.5 accent-brand" />
                  <span><span className="font-medium">{r}</span> <span className="text-gray-400">— {ROLE_INFO[r]}</span></span>
                </label>
              ))}
            </div>
            {modal !== 'add' && <p className="text-xs text-gray-400 mt-1">Changing the role signs the user out of RAMS.</p>}
          </fieldset>
          {modal === 'add' && (
            <div>
              <label htmlFor="user-password" className="block text-sm font-medium text-gray-700 mb-1">Temporary Password</label>
              <input id="user-password" type="text" required value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} className={inputCls} placeholder="Min. 8 characters" />
              <PasswordCriteria password={form.password} />
              <p className="text-xs text-gray-400 mt-1">They must change it at their first sign-in.</p>
            </div>
          )}
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" type="button" onClick={() => setModal(null)}>Cancel</Button>
            <Button type="submit" loading={saving}>{modal === 'add' ? 'Create User' : 'Save Changes'}</Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!resetFor} onClose={() => { setResetFor(null); setResetPwd(''); }} title={`Reset Password — ${resetFor?.name}`} size="sm">
        <form onSubmit={handleReset} className="space-y-4">
          <div>
            <label htmlFor="reset-password" className="block text-sm font-medium text-gray-700 mb-1">New Temporary Password</label>
            <input id="reset-password" type="text" required value={resetPwd} onChange={(e) => setResetPwd(e.target.value)} className={inputCls} placeholder="Min. 8 characters" />
            <PasswordCriteria password={resetPwd} />
            <p className="text-xs text-gray-400 mt-1">They are signed out now and must change it at their next sign-in.</p>
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" type="button" onClick={() => { setResetFor(null); setResetPwd(''); }}>Cancel</Button>
            <Button type="submit" loading={saving}>Reset Password</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={handleConfirm}
        title={confirm?.action === 'deactivate' ? 'Deactivate User' : 'Reactivate User'}
        message={confirm?.action === 'deactivate'
          ? `${confirm?.user.name} will be signed out and can't sign in until reactivated. Their history is kept.`
          : `${confirm?.user.name} will be able to sign in again with their current password.`}
        confirmLabel={confirm?.action === 'deactivate' ? 'Deactivate' : 'Reactivate'}
        variant={confirm?.action === 'deactivate' ? 'danger' : 'primary'}
        loading={saving}
      />
    </AppShell>
  );
}
