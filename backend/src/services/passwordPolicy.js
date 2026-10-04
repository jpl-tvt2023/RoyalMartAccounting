// Password rules. MIRRORED in frontend/src/utils/passwordPolicy.js, which shows
// them live; this file is the source of truth and also enforces MAX_LENGTH,
// which the client does not check. (Copied from ROMS.)
const MIN_LENGTH = 8;
const MAX_LENGTH = 128; // guard against absurd inputs (bcrypt only uses the first 72 bytes)

// Returns an error string, or null if the password is acceptable.
function validateComplexity(password) {
  if (typeof password !== 'string') return 'Password is required';
  if (password.length < MIN_LENGTH) return `Password must be at least ${MIN_LENGTH} characters`;
  if (password.length > MAX_LENGTH) return `Password must be at most ${MAX_LENGTH} characters`;
  if (!/[a-z]/.test(password)) return 'Password must include a lowercase letter';
  if (!/[A-Z]/.test(password)) return 'Password must include an uppercase letter';
  if (!/[0-9]/.test(password)) return 'Password must include a number';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must include a symbol';
  return null;
}

// Kept async so callers can await it, as in ROMS.
async function validatePassword(password) {
  return validateComplexity(password);
}

module.exports = { validateComplexity, validatePassword, MIN_LENGTH, MAX_LENGTH };
