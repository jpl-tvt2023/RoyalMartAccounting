import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import Wordmark from '../components/layout/Wordmark';

// (Adapted from ROMS.) Full-bleed, outside AppShell.
export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await login(form.username.trim().toLowerCase(), form.password);
      navigate(user?.is_first_login ? '/force-reset' : '/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  const inputCls = 'w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand text-sm';

  return (
    <div className="min-h-screen bg-brand-surface flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <Wordmark tone="dark" size="lg" />
          <p className="text-brand/60 mt-3 text-sm">Retail Accounts Management System</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8 border border-brand/10">
          <h2 className="text-xl font-semibold text-brand mb-6">Sign In</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-username" className="block text-sm font-medium text-gray-700 mb-1">User ID</label>
              <input
                id="login-username"
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                required
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value.toLowerCase() }))}
                className={inputCls}
                placeholder="your user ID"
              />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  className={`${inputCls} pr-10`}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPass((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand text-white py-2.5 rounded-lg font-semibold hover:bg-brand-hover transition-colors disabled:opacity-60 flex items-center justify-center gap-2 mt-2"
            >
              {loading && <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-brand/40 mt-6">RAMS — Internal Use Only. Separate sign-in from ROMS.</p>
      </div>
    </div>
  );
}
