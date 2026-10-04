import { LayoutDashboard, Settings, Users, ScrollText } from 'lucide-react';

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
  [ROLES.ACCOUNTANT]: 'Works the accounts: exceptions and applying Tally values',
  [ROLES.VIEWER]: 'Reads only',
};

/**
 * The top-bar navigation. Each entry is a LEAF { label, path, icon, description?, roles }
 * or a GROUP { label, icon, children: [leaf, ...] }; a group with no child the
 * user may see disappears. The Phase 1 screens join here as each is built.
 */
export const NAV = [
  {
    label: 'Dashboard',
    path: '/dashboard',
    icon: LayoutDashboard,
    roles: ALL_ROLES,
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
        label: 'Audit Log',
        path: '/admin/audit-log',
        icon: ScrollText,
        description: 'Every change, who made it and when',
        roles: ADMIN_ONLY,
      },
    ],
  },
];
