import { Link } from 'react-router-dom';
import {
  Activity, FileText, ReceiptText, ArrowLeftRight, AlertTriangle, Wallet, Users, ScrollText,
} from 'lucide-react';
import AppShell from '../components/layout/AppShell';
import TallySyncCard from '../components/dashboard/TallySyncCard';
import { useAuth } from '../context/AuthContext';
import { useRBAC } from '../hooks/useRBAC';

// The Phase 1 screens, in the order they are built (blueprint screens 1–6).
// Each becomes a real page, and a NAV entry, as it lands.
const COMING = [
  { icon: Activity, title: 'Sync Health', text: 'The card above in full: every run per company, its counts and errors, and “Sync now”.' },
  { icon: FileText, title: 'Invoices', text: 'Every Tally sales invoice since go-live, its marketplace PO, received and outstanding.' },
  { icon: ReceiptText, title: 'Credit & Debit Notes', text: 'Each note with its invoice, PO and RTV row, and what was filled into ROMS.' },
  { icon: ArrowLeftRight, title: 'Stock Transfers', text: 'MH → HR / WB transfers behind the Flipkart and Amazon rows, kept out of receivables.' },
  { icon: AlertTriangle, title: 'Exceptions', text: 'Where ROMS and Tally disagree, with a one-click “apply Tally value” for an Admin.' },
  { icon: Wallet, title: 'Receivables', text: 'Invoiced, received, credit notes, TDS and outstanding, by marketplace and company.' },
];

export default function Dashboard() {
  const { user } = useAuth();
  const { isAdmin } = useRBAC();

  return (
    <AppShell>
      <div className="max-w-5xl">
        <h1 className="text-2xl font-bold text-brand">Welcome, {user?.name}</h1>
        <p className="text-gray-500 text-sm mt-1">
          RAMS keeps the accounts for what ROMS runs: Tally’s invoices and credit notes, linked to the marketplace POs.
        </p>

        {isAdmin && (
          <div className="flex flex-wrap gap-3 mt-6">
            <Link to="/admin/users" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover">
              <Users size={16} /> Users
            </Link>
            <Link to="/admin/audit-log" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-brand text-brand text-sm font-medium hover:bg-brand hover:text-white">
              <ScrollText size={16} /> Audit Log
            </Link>
          </div>
        )}

        <TallySyncCard isAdmin={isAdmin} />

        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mt-8 mb-3">Coming in Phase 1</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {COMING.map((item) => (
            <div key={item.title} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-2 text-brand">
                <item.icon size={18} />
                <h3 className="font-semibold">{item.title}</h3>
              </div>
              <p className="text-sm text-gray-500 mt-2">{item.text}</p>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
