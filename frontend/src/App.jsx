import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/shared/ProtectedRoute';
import TitleManager from './components/layout/TitleManager';

import Login from './pages/Login';
import ForcePasswordReset from './pages/ForcePasswordReset';
import Dashboard from './pages/Dashboard';
import UserManagement from './pages/admin/UserManagement';
import AuditLog from './pages/admin/AuditLog';
import { ALL_ROLES, ADMIN_ONLY } from './utils/roles';

// The single route table. Adding a route means a TitleManager entry too, and a
// NAV entry in utils/roles.js if it belongs in the top bar.
export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <TitleManager />
        <Toaster
          position="top-center"
          containerStyle={{ top: 70 }}
          toastOptions={{
            duration: 3000,
            style: { fontSize: '14px', maxWidth: '420px' },
            success: { iconTheme: { primary: '#1b4332', secondary: '#fff' } },
            error: { iconTheme: { primary: '#c1121f', secondary: '#fff' } },
          }}
        />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/force-reset" element={<ProtectedRoute><ForcePasswordReset /></ProtectedRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute roles={ALL_ROLES}><Dashboard /></ProtectedRoute>} />
          <Route path="/admin/users" element={<ProtectedRoute roles={ADMIN_ONLY}><UserManagement /></ProtectedRoute>} />
          <Route path="/admin/audit-log" element={<ProtectedRoute roles={ADMIN_ONLY}><AuditLog /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
