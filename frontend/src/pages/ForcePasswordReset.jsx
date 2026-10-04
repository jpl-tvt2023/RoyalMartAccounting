import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { changePassword } from '../api/auth.api';
import PasswordCriteria from '../components/shared/PasswordCriteria';
import { meetsPasswordPolicy } from '../utils/passwordPolicy';
import Wordmark from '../components/layout/Wordmark';

// A first sign-in, or a password an Admin reset: the user must choose their own
// before anything else (the API holds them to it too). (Adapted from ROMS.)
export default function ForcePasswordReset() {
  const { user, applySession } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ newPassword: '', confirm: '' });
  const [show, setShow] = useState({ new: false, confirm: false });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) return toast.error('Passwords do not match');
    if (!meetsPasswordPolicy(form.newPassword)) return toast.error('Password does not meet all the requirements');
    setLoading(true);
    try {
      // The change ends every other session; this one carries on with the new token.
      applySession(await changePassword({ newPassword: form.newPassword }));
      toast.success('Password set. Welcome to RAMS.');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update password');
    } finally {
      setLoading(false);
    }
  };

  const inputCls = 'w-full px-4 py-2.5 pr-10 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand text-sm';

  return (
    <div className="min-h-screen bg-brand-surface flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8 text-center">
          <Wordmark tone="dark" size="lg" />
          <h1 className="text-2xl font-bold text-brand mt-4">Set Your Password</h1>
          <p className="text-brand/60 mt-1 text-sm">Hello {user?.name} — please set a new password to continue</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8 border border-brand/10">
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800 mb-6">
            This is your first sign-in, or an Admin has reset your password. Choose your own before continuing.
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            {[
              { label: 'New Password', key: 'newPassword', showKey: 'new', id: 'new-password' },
              { label: 'Confirm Password', key: 'confirm', showKey: 'confirm', id: 'confirm-password' },
            ].map(({ label, key, showKey, id }) => (
              <div key={key}>
                <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                <div className="relative">
                  <input
                    id={id}
                    type={show[showKey] ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    value={form[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    className={inputCls}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    aria-label={show[showKey] ? `Hide ${label}` : `Show ${label}`}
                    onClick={() => setShow((s) => ({ ...s, [showKey]: !s[showKey] }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {show[showKey] ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            ))}
            <PasswordCriteria password={form.newPassword} />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand text-white py-2.5 rounded-lg font-semibold hover:bg-brand-hover transition-colors disabled:opacity-60 flex items-center justify-center gap-2 mt-2"
            >
              {loading && <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
              {loading ? 'Saving...' : 'Set Password & Continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
