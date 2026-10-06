import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { ROLES, ALL_ROLES, ADMIN_ONLY, ROLE_INFO, NAV, PERM } from '../roles';
import { PASSWORD_RULES, meetsPasswordPolicy } from '../passwordPolicy';

// The permission catalog (backend/src/services/permissions.js), where the
// backend is checked out beside the frontend.
const catalogFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../backend/src/services/permissions.js');
const haveBackend = fs.existsSync(catalogFile);

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

  test('the Matching pages follow "See matching", and Auto-fill "See auto-fill"', () => {
    const matching = NAV.find((n) => n.label === 'Matching');
    expect(matching.children.map((c) => [c.path, c.permission])).toEqual([
      ['/matching', PERM.MATCHING_VIEW],
      ['/matching/rules', PERM.MATCHING_VIEW],
      ['/matching/parties', PERM.MATCHING_VIEW],
      ['/matching/autofill', PERM.AUTOFILL_VIEW],
    ]);
  });

  test.runIf(haveBackend)('every permission key matches the backend catalog, in its order', () => {
    const { CATALOG } = createRequire(import.meta.url)(catalogFile);
    expect(Object.values(PERM)).toEqual(CATALOG.map((p) => p.key));
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
