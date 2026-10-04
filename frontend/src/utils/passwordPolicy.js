// Password rules MIRRORED from backend/src/services/passwordPolicy.js, which
// stays the source of truth (and also caps the length). This is only for live
// feedback while typing. (Copied from ROMS.)
export const PASSWORD_RULES = [
  { label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { label: 'A lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'An uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'A number', test: (p) => /[0-9]/.test(p) },
  { label: 'A symbol', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export function meetsPasswordPolicy(password) {
  return PASSWORD_RULES.every((r) => r.test(password || ''));
}
