import { describe, test, expect } from 'vitest';
import { ROLES, ALL_ROLES, ADMIN_ONLY, ROLE_INFO, NAV, PERM } from '../roles';
import { PASSWORD_RULES, meetsPasswordPolicy } from '../passwordPolicy';

// Pinned to the same values the backend's tests/roles.test.js asserts for
// middleware/rbac.js and migration 002 -- change one side, change both.
describe('the RAMS role set', () => {
  test('is Admin, Owner, Accountant and Viewer, with Admin and Owner as the admins', () => {
    expect(ALL_ROLES).toEqual(['Admin', 'Owner', 'Accountant', 'Viewer']);
    expect(ADMIN_ONLY).toEqual(['Admin', 'Owner']);
    expect(Object.values(ROLES)).toEqual(ALL_ROLES);
    expect(Object.keys(ROLE_INFO)).toEqual(ALL_ROLES);
  });

  test('Users, the Audit Log and Roles & permissions stay Admin/Owner only; Tally companies follows its permissions', () => {
    const admin = NAV.find((n) => n.label === 'Admin');
    const by = (label) => admin.children.find((c) => c.label === label);
    for (const label of ['Users', 'Audit Log', 'Roles & permissions']) {
      expect(by(label).roles).toBe(ADMIN_ONLY);
      expect(by(label).permission).toBeUndefined();
    }
    expect(by('Tally companies').permission).toEqual([PERM.SYNC_COMPANIES, PERM.SYNC_SCHEDULE]);
  });

  test('the Matching pages follow "See matching", and every permission key matches the backend catalog', () => {
    const matching = NAV.find((n) => n.label === 'Matching');
    expect(matching.children.map((c) => c.permission)).toEqual([PERM.MATCHING_VIEW, PERM.MATCHING_VIEW, PERM.MATCHING_VIEW]);
    expect(Object.values(PERM)).toEqual([
      'matching.view', 'matching.run', 'matching.review', 'matching.rules', 'matching.parties', 'sync.companies', 'sync.schedule',
    ]);
  });
});

// Twin of backend/src/services/passwordPolicy.js.
describe('password policy', () => {
  test('needs 8+ characters with lower, upper, number and symbol', () => {
    expect(PASSWORD_RULES).toHaveLength(5);
    expect(meetsPasswordPolicy('First#Pass1')).toBe(true);
    for (const weak of ['short#A1', 'nouppercase#1', 'NOLOWER#1', 'NoNumber#', 'NoSymbol1']) {
      expect(meetsPasswordPolicy(weak)).toBe(weak === 'short#A1');
    }
  });
});
