import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

// Redirects, never 403s: no session -> /login; a first or reset password still
// in force -> /force-reset (the API enforces this too); a role that may not see
// the page -> /dashboard. (Adapted from ROMS.)
export default function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.is_first_login && pathname !== '/force-reset') return <Navigate to="/force-reset" replace />;
  if (roles && !roles.some((r) => (user.roles || []).includes(r))) return <Navigate to="/dashboard" replace />;

  return children;
}
