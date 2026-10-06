// What each role may do beyond signing in. The CATALOG is code -- each key
// guards a route -- but who holds a key is data (migration 010), set by an
// Admin or Owner on Admin -> Roles & permissions.
//
// Admin and Owner always hold every key. Users, the Audit Log and the
// permissions page itself are not in the catalog: they stay Admin/Owner only
// (allowRoles), so no role can be granted the power to promote itself.
const { ADMIN_ROLES } = require('../middleware/rbac');

// The roles an Admin or Owner sets permissions for (migration 010's CHECK).
const GRANTABLE_ROLES = ['Accountant', 'Viewer'];

const CATALOG = [
  {
    key: 'matching.view', area: 'Matching', label: 'See matching',
    description: 'Match review, Matching rules, Party ledgers and the matching card on the Dashboard',
  },
  {
    key: 'matching.run', area: 'Matching', label: 'Run matching',
    description: 'Press "Match now" to read ROMS again and re-match',
  },
  {
    key: 'matching.review', area: 'Matching', label: 'Review links',
    description: 'Confirm or reject a link, or pick the right invoice or credit note',
  },
  {
    key: 'matching.rules', area: 'Matching', label: 'Change matching rules',
    description: 'How POs are matched, the checks, which vouchers count, and each vendor\'s setting',
  },
  {
    key: 'matching.parties', area: 'Matching', label: 'Map party ledgers',
    description: 'Which marketplace each Tally party ledger belongs to',
  },
  {
    key: 'autofill.view', area: 'Auto-fill', label: 'See auto-fill',
    description: 'What RAMS will write into ROMS, what it wrote, and what ROMS refused',
  },
  {
    key: 'autofill.approve', area: 'Auto-fill', label: 'Approve auto-fill',
    description: 'Approve writes into ROMS, press "Write now", and try a refused one again',
  },
  {
    key: 'autofill.overwrite', area: 'Auto-fill', label: 'Replace a different value in ROMS',
    description: 'Write Tally\'s number over a Bill No or CN No staff typed that is not a form of it, one row at a time',
  },
  {
    key: 'autofill.settings', area: 'Auto-fill', label: 'Switch auto-fill on or off',
    description: 'Each field\'s mode (Off, Preview, Ask first, Automatic) and which Bill Date is kept',
  },
  {
    key: 'reports.view', area: 'Reports', label: 'See the reports',
    description: 'Invoices, Credit & debit notes, Stock transfers, Receivables and Exceptions',
  },
  {
    key: 'reports.settings', area: 'Reports', label: 'Change credit terms',
    description: 'Each marketplace\'s credit days, the default, and how long before something is an exception',
  },
  {
    key: 'sync.companies', area: 'Tally sync', label: 'Turn company sync on or off',
    description: 'Choose which Tally companies RAMS syncs, and edit their short codes',
  },
  {
    key: 'sync.schedule', area: 'Tally sync', label: 'Change the sync schedule',
    description: 'Office days and hours, the light sync interval and the end-of-day check',
  },
  {
    key: 'sync.run', area: 'Tally sync', label: 'Sync now',
    description: 'Ask the Connector for a light sync of a company straight away, on Sync health',
  },
];

const KEYS = new Set(CATALOG.map((p) => p.key));
const isAdmin = (roles) => (roles || []).some((r) => ADMIN_ROLES.includes(r));

// The keys a user holds, from their roles.
async function permissionsOf(client, roles) {
  if (isAdmin(roles)) return CATALOG.map((p) => p.key);
  const grantable = (roles || []).filter((r) => GRANTABLE_ROLES.includes(r));
  if (!grantable.length) return [];
  const { rows } = await client.execute({
    sql: `SELECT DISTINCT permission FROM role_permissions WHERE role IN (${grantable.map(() => '?').join(',')})`,
    args: grantable,
  });
  const held = new Set(rows.map((r) => r.permission));
  return CATALOG.map((p) => p.key).filter((k) => held.has(k));
}

async function hasPermission(client, roles, key) {
  if (!KEYS.has(key)) throw new Error(`Unknown permission ${key}`);
  if (isAdmin(roles)) return true;
  return (await permissionsOf(client, roles)).includes(key);
}

// role -> [keys], for the permissions page.
async function loadMatrix(client) {
  const { rows } = await client.execute('SELECT role, permission FROM role_permissions');
  const held = new Set(rows.map((r) => `${r.role}|${r.permission}`));
  // In catalog order, so the page and the audit diff read the same way.
  return Object.fromEntries(GRANTABLE_ROLES.map((role) => [role, CATALOG.map((p) => p.key).filter((k) => held.has(`${role}|${k}`))]));
}

// A PUT body { roles: { Accountant: [keys], Viewer: [keys] } } -> { matrix } or { error }.
// A role left out keeps what it has.
function validateMatrix(body, current) {
  const given = body && body.roles;
  if (!given || typeof given !== 'object' || Array.isArray(given)) return { error: 'Send roles: { Accountant: [...], Viewer: [...] }' };
  const matrix = { ...current };
  for (const [role, keys] of Object.entries(given)) {
    if (!GRANTABLE_ROLES.includes(role)) return { error: `${role} permissions can't be changed here — Admin and Owner always have every permission` };
    if (!Array.isArray(keys) || keys.some((k) => !KEYS.has(k))) return { error: `Unknown permission for ${role}` };
    matrix[role] = CATALOG.map((p) => p.key).filter((k) => keys.includes(k));
  }
  return { matrix };
}

module.exports = {
  CATALOG, KEYS, GRANTABLE_ROLES, permissionsOf, hasPermission, loadMatrix, validateMatrix, isAdmin,
};
