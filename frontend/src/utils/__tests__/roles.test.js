import { describe, test, expect } from 'vitest';
import { ROLES, ALL_ROLES, ADMIN_ONLY, ROLE_INFO, NAV } from '../roles';
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

  test('the Admin menu is for Admin and Owner only', () => {
    const admin = NAV.find((n) => n.label === 'Admin');
    expect(admin.children.every((c) => c.roles === ADMIN_ONLY)).toBe(true);
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
