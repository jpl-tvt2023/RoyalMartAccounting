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
import Companies from './pages/admin/Companies';
import Permissions from './pages/admin/Permissions';
import MatchReview from './pages/matching/MatchReview';
import MatchingRules from './pages/matching/MatchingRules';
import PartyLedgers from './pages/matching/PartyLedgers';
import AutoFill from './pages/matching/AutoFill';
import Invoices from './pages/reports/Invoices';
import Notes from './pages/reports/Notes';
import Transfers from './pages/reports/Transfers';
import Receivables from './pages/reports/Receivables';
import Exceptions from './pages/reports/Exceptions';
import SyncHealth from './pages/reports/SyncHealth';
import Help from './pages/Help';
import { ALL_ROLES, ADMIN_ONLY, PERM } from './utils/roles';

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
          <Route path="/admin/companies" element={<ProtectedRoute permission={[PERM.SYNC_COMPANIES, PERM.SYNC_SCHEDULE]}><Companies /></ProtectedRoute>} />
          <Route path="/admin/permissions" element={<ProtectedRoute roles={ADMIN_ONLY}><Permissions /></ProtectedRoute>} />
          <Route path="/matching" element={<ProtectedRoute permission={PERM.MATCHING_VIEW}><MatchReview /></ProtectedRoute>} />
          <Route path="/matching/rules" element={<ProtectedRoute permission={PERM.MATCHING_VIEW}><MatchingRules /></ProtectedRoute>} />
          <Route path="/matching/parties" element={<ProtectedRoute permission={PERM.MATCHING_VIEW}><PartyLedgers /></ProtectedRoute>} />
          <Route path="/matching/autofill" element={<ProtectedRoute permission={PERM.AUTOFILL_VIEW}><AutoFill /></ProtectedRoute>} />
          <Route path="/reports/invoices" element={<ProtectedRoute permission={PERM.REPORTS_VIEW}><Invoices /></ProtectedRoute>} />
          <Route path="/reports/notes" element={<ProtectedRoute permission={PERM.REPORTS_VIEW}><Notes /></ProtectedRoute>} />
          <Route path="/reports/transfers" element={<ProtectedRoute permission={PERM.REPORTS_VIEW}><Transfers /></ProtectedRoute>} />
          <Route path="/reports/receivables" element={<ProtectedRoute permission={PERM.REPORTS_VIEW}><Receivables /></ProtectedRoute>} />
          <Route path="/reports/exceptions" element={<ProtectedRoute permission={PERM.REPORTS_VIEW}><Exceptions /></ProtectedRoute>} />
          <Route path="/sync" element={<ProtectedRoute roles={ALL_ROLES}><SyncHealth /></ProtectedRoute>} />
          <Route path="/help" element={<ProtectedRoute roles={ALL_ROLES}><Help /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
