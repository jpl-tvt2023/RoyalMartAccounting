// The login identifier ("User ID"): lowercase, 3-30 characters of letters,
// digits, dot, underscore or hyphen. Shared by the Users API and the first-Admin
// bootstrap so both accept exactly the same names. (Rule copied from ROMS.)
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

const normalizeUsername = (input) => String(input || '').trim().toLowerCase();

function validateUsername(username) {
  if (!username) return 'User ID is required';
  if (!USERNAME_RE.test(username)) {
    return 'User ID must be 3-30 characters: lowercase letters, numbers, dot, underscore or hyphen';
  }
  return null;
}

module.exports = { USERNAME_RE, normalizeUsername, validateUsername };
