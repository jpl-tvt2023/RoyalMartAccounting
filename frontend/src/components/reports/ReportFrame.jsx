import { useState } from 'react';
import { Search, Download } from 'lucide-react';
import AppShell from '../layout/AppShell';
import Button from '../ui/Button';
import HelpLink from '../shared/HelpLink';

export const selectCls = 'px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/30';

// The frame every Reports page shares: title, a line on what it shows, the
// company filter (All = consolidated), a search box, extra filters, and a CSV
// download.
export default function ReportFrame({
  title, help, intro, companies = [], companyId, onCompany, search, onSearch, searchHint, filters, onCsv, children,
}) {
  const [text, setText] = useState(search || '');
  return (
    <AppShell>
      <div className="mb-4 max-w-4xl">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-brand">{title}</h1>
          <HelpLink section={help} />
        </div>
        <p className="text-gray-500 text-sm mt-1">{intro}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {onCompany && (
          <select aria-label="Company" value={companyId} onChange={(e) => onCompany(e.target.value)} className={selectCls}>
            <option value="">All companies (consolidated)</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.code || c.name}</option>)}
          </select>
        )}
        {onSearch && (
          <form onSubmit={(e) => { e.preventDefault(); onSearch(text.trim()); }} className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input aria-label="Search" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() !== search && onSearch(text.trim())}
              placeholder={searchHint} className="pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm w-64 max-w-full" />
          </form>
        )}
        {filters}
        {onCsv && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={onCsv}><Download size={14} /> Download CSV</Button>
        )}
      </div>
      {children}
    </AppShell>
  );
}

// A table with a header row, loading rows and an empty line.
export function ReportTable({
  head, loading, empty, children, foot,
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {head.map((h) => (
                <th key={typeof h === 'string' ? h : h.label} className={`px-3 py-3 font-semibold text-gray-600 whitespace-nowrap ${h.right ? 'text-right' : 'text-left'}`}>
                  {typeof h === 'string' ? h : h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? [...Array(5)].map((_, i) => <tr key={i}><td colSpan={head.length} className="px-3 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)
              : children}
          </tbody>
          {foot}
        </table>
        {empty}
      </div>
    </div>
  );
}

export const td = 'px-3 py-2.5';
export const num = 'px-3 py-2.5 text-right tabular-nums whitespace-nowrap';
