import {
  LayoutDashboard, Settings, Users, ScrollText, Building2, Link2, ListChecks, SlidersHorizontal, BookUser, ShieldCheck, LifeBuoy,
} from 'lucide-react';

// The RAMS role set. MIRRORED in backend/src/middleware/rbac.js and in
// migration 002's CHECK -- change all three together; utils/__tests__/roles.test.js
// and the backend's tests/roles.test.js pin the same values.
export const ROLES = {
  ADMIN: 'Admin',
  OWNER: 'Owner',
  ACCOUNTANT: 'Accountant',
  VIEWER: 'Viewer',
};

export const ALL_ROLES = [ROLES.ADMIN, ROLES.OWNER, ROLES.ACCOUNTANT, ROLES.VIEWER];
export const ADMIN_ONLY = [ROLES.ADMIN, ROLES.OWNER];

// What each role means, as the Users page explains it.
export const ROLE_INFO = {
  [ROLES.ADMIN]: 'Everything, including users and the audit log',
  [ROLES.OWNER]: 'Same as Admin',
  [ROLES.ACCOUNTANT]: 'Works the accounts — what exactly is set on Admin → Roles & permissions',
  [ROLES.VIEWER]: 'Reads — what exactly is set on Admin → Roles & permissions',
};

// The permission keys the UI asks about -- the catalog itself (labels, what
// each allows) comes from the API, backend/src/services/permissions.js.
export const PERM = {
  MATCHING_VIEW: 'matching.view',
  MATCHING_RUN: 'matching.run',
  MATCHING_REVIEW: 'matching.review',
  MATCHING_RULES: 'matching.rules',
  MATCHING_PARTIES: 'matching.parties',
  SYNC_COMPANIES: 'sync.companies',
  SYNC_SCHEDULE: 'sync.schedule',
};

/**
 * The top-bar navigation. Each entry is a LEAF { label, path, icon, description?,
 * roles | permission } or a GROUP { label, icon, children: [leaf, ...] }; a
 * group with no child the user may see disappears. `permission` (a key, or a
 * list where any one is enough) follows Admin -> Roles & permissions; `roles`
 * is fixed. The Phase 1 screens join here as each is built, each with a Help
 * section (src/help).
 */
export const NAV = [
  {
    label: 'Dashboard',
    path: '/dashboard',
    icon: LayoutDashboard,
    roles: ALL_ROLES,
  },
  {
    label: 'Matching',
    icon: Link2,
    children: [
      {
        label: 'Match review',
        path: '/matching',
        icon: ListChecks,
        description: 'Each PO and RTV row with its Tally invoice or credit note',
        permission: PERM.MATCHING_VIEW,
      },
      {
        label: 'Matching rules',
        path: '/matching/rules',
        icon: SlidersHorizontal,
        description: 'How POs are matched, and the checks on each link',
        permission: PERM.MATCHING_VIEW,
      },
      {
        label: 'Party ledgers',
        path: '/matching/parties',
        icon: BookUser,
        description: 'Which marketplace each Tally party ledger belongs to',
        permission: PERM.MATCHING_VIEW,
      },
    ],
  },
  {
    label: 'Admin',
    icon: Settings,
    children: [
      {
        label: 'Users',
        path: '/admin/users',
        icon: Users,
        description: 'Accounts, roles & access',
        roles: ADMIN_ONLY,
      },
      {
        label: 'Tally companies',
        path: '/admin/companies',
        icon: Building2,
        description: 'Which Tally companies RAMS syncs, and when',
        permission: [PERM.SYNC_COMPANIES, PERM.SYNC_SCHEDULE],
      },
      {
        label: 'Roles & permissions',
        path: '/admin/permissions',
        icon: ShieldCheck,
        description: 'What Accountants and Viewers may do',
        roles: ADMIN_ONLY,
      },
      {
        label: 'Audit Log',
        path: '/admin/audit-log',
        icon: ScrollText,
        description: 'Every change, who made it and when',
        roles: ADMIN_ONLY,
      },
    ],
  },
  {
    label: 'Help',
    path: '/help',
    icon: LifeBuoy,
    roles: ALL_ROLES,
  },
];
