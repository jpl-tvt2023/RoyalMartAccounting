import { useState, useRef, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';

/**
 * One top-bar dropdown for a group of nav links. (Copied from ROMS.) Closes on
 * outside click, Escape and route change; the trigger highlights when the
 * current route belongs to one of its children.
 */
export default function NavDropdown({ label, icon: Icon, items }) {
  const ref = useRef(null);
  const location = useLocation();
  // Open only on the route it was opened on, so a navigation closes it with no
  // effect needed.
  const [openOn, setOpenOn] = useState(null);
  const open = openOn === location.pathname;
  const close = () => setOpenOn(null);

  const isActive = items.some(
    (it) => location.pathname === it.path || location.pathname.startsWith(it.path + '/'),
  );

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const triggerCls = `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
    isActive || open ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
  }`;

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpenOn(open ? null : location.pathname)} className={triggerCls} aria-haspopup="menu" aria-expanded={open}>
        {Icon && <Icon size={16} className="shrink-0" />}
        {label}
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div role="menu" className="absolute left-0 top-full mt-1.5 w-64 max-w-[calc(100vw-1rem)] rounded-xl bg-white shadow-lg ring-1 ring-black/5 p-1.5 z-30">
          {items.map((it) => (
            <NavLink
              key={it.path}
              to={it.path}
              role="menuitem"
              className={({ isActive: active }) => `flex items-start gap-2.5 px-3 py-2 rounded-lg transition-colors ${active ? 'bg-brand/10' : 'hover:bg-gray-50'}`}
            >
              {({ isActive: active }) => (
                <>
                  {it.icon && (
                    <span className={`mt-0.5 shrink-0 ${active ? 'text-brand-hover' : 'text-brand/70'}`}>
                      <it.icon size={16} />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className={`block text-sm font-medium leading-tight ${active ? 'text-brand' : 'text-gray-800'}`}>{it.label}</span>
                    {it.description && <span className="block text-xs text-gray-500 mt-0.5 leading-snug">{it.description}</span>}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}
