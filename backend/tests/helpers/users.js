// The users globalSetup seeds, one per role, all past their first sign-in.
const TEST_PASSWORD = 'Test#Pass1';

const TEST_USERS = [
  { username: 'admin', name: 'Test Admin', role: 'Admin' },
  { username: 'owner', name: 'Test Owner', role: 'Owner' },
  { username: 'accountant', name: 'Test Accountant', role: 'Accountant' },
  { username: 'viewer', name: 'Test Viewer', role: 'Viewer' },
];

module.exports = { TEST_PASSWORD, TEST_USERS };
