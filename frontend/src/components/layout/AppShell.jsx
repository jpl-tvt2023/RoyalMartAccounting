import Topbar from './Topbar';

// Every page wraps its own content in <AppShell> (the router does not), except
// the full-bleed sign-in pages. (Copied from ROMS.)
export default function AppShell({ children }) {
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-50">
      <Topbar />
      <main className="flex-1 overflow-y-auto p-4 lg:p-6">
        {children}
      </main>
    </div>
  );
}
