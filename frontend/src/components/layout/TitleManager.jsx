import { useEffect } from 'react';
import { useLocation, matchPath } from 'react-router-dom';

const BRAND = 'RAMS · Royal Mart Accounts';

// Route -> tab title; null means just the brand. Ordered most-specific first.
// Adding a route means adding its title here too. (Copied from ROMS.)
const TITLES = [
  ['/login', 'Sign in'],
  ['/force-reset', 'Set your password'],
  ['/dashboard', null],
  ['/admin/users', 'Users'],
  ['/admin/audit-log', 'Audit Log'],
  ['/admin/companies', 'Tally companies'],
  ['/admin/permissions', 'Roles & permissions'],
  ['/matching', 'Match review'],
  ['/matching/rules', 'Matching rules'],
  ['/matching/parties', 'Party ledgers'],
  ['/help', 'Help & FAQ'],
];

function resolveTitle(pathname) {
  for (const [pattern, title] of TITLES) {
    const match = matchPath({ path: pattern, end: true }, pathname);
    if (match) return typeof title === 'function' ? title(match) : title;
  }
  return null;
}

export default function TitleManager() {
  const { pathname } = useLocation();
  useEffect(() => {
    const title = resolveTitle(pathname);
    document.title = title ? `${title} · ${BRAND}` : BRAND;
  }, [pathname]);
  return null;
}
