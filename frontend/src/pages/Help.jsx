import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, ChevronRight } from 'lucide-react';
import AppShell from '../components/layout/AppShell';
import { HELP_SECTIONS, sectionText } from '../help';

// Help & FAQ: the user guide for every screen, with step-by-step flows. The
// content lives in src/help; each page links to its own section.
export default function Help() {
  const { hash } = useLocation();
  const [query, setQuery] = useState('');
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = HELP_SECTIONS.filter((s) => words.every((w) => sectionText(s).includes(w)));

  // Opened from a page's Help link: go to its section.
  useEffect(() => {
    const id = hash.replace('#', '');
    if (!id) return;
    const el = document.getElementById(id);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
  }, [hash]);

  const areas = [...new Set(HELP_SECTIONS.map((s) => s.area))];

  return (
    <AppShell>
      <div className="max-w-5xl">
        <h1 className="text-2xl font-bold text-brand">Help &amp; FAQ</h1>
        <p className="text-gray-500 text-sm mt-1">
          How to do everything in RAMS, step by step, and answers to common questions. Each page&apos;s Help link opens its part of this guide.
        </p>

        <label className="relative block mt-4 max-w-md">
          <span className="sr-only">Search help</span>
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search help, e.g. Bill No, password, sync"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>

        <div className="grid gap-6 lg:grid-cols-[14rem_1fr] mt-6">
          <nav aria-label="Help contents" className="lg:sticky lg:top-20 self-start bg-white rounded-xl border border-gray-200 p-3 text-sm">
            {areas.map((area) => (
              <div key={area} className="mb-2 last:mb-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 px-2 py-1">{area}</p>
                {HELP_SECTIONS.filter((s) => s.area === area).map((s) => (
                  <a key={s.id} href={`#${s.id}`} className="flex items-center gap-1 px-2 py-1 rounded text-gray-700 hover:bg-gray-50 hover:text-brand">
                    <ChevronRight size={12} className="text-gray-300" /> {s.title}
                  </a>
                ))}
              </div>
            ))}
          </nav>

          <div className="space-y-6 min-w-0">
            {shown.length === 0 && (
              <p className="text-gray-400 text-sm">Nothing matches “{query}”. Try another word, or ask an Admin.</p>
            )}
            {shown.map((s) => (
              <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="bg-white rounded-xl border border-gray-200 p-5 scroll-mt-20">
                <h2 id={`${s.id}-title`} className="text-lg font-semibold text-brand">{s.title}</h2>
                <p className="text-sm text-gray-700 mt-1">{s.summary}</p>
                <p className="text-xs text-gray-500 mt-2"><span className="font-semibold">Who can do this:</span> {s.who}</p>

                {s.flows.map((f) => (
                  <div key={f.title} className="mt-4">
                    <h3 className="text-sm font-semibold text-gray-900">{f.title}</h3>
                    <ol className="list-decimal ml-5 mt-1 space-y-1 text-sm text-gray-700">
                      {f.steps.map((step) => <li key={step}>{step}</li>)}
                    </ol>
                  </div>
                ))}

                {s.faq.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-sm font-semibold text-gray-900">Questions</h3>
                    <div className="mt-1 divide-y divide-gray-100">
                      {s.faq.map((item) => (
                        <details key={item.q} className="py-2 group">
                          <summary className="cursor-pointer text-sm text-gray-800 font-medium list-none flex items-center gap-1">
                            <ChevronRight size={14} className="text-gray-400 transition-transform group-open:rotate-90" /> {item.q}
                          </summary>
                          <p className="text-sm text-gray-600 mt-1 ml-5">{item.a}</p>
                        </details>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
