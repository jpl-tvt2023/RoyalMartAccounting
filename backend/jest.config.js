// Suites must run one at a time: every suite shares one SQLite file, and two
// worker processes writing it fail with SQLITE_BUSY. npm test passes
// --runInBand (as ROMS does), and maxWorkers: 1 makes a bare `npx jest` safe too.
module.exports = {
  testEnvironment: 'node',
  maxWorkers: 1,
  setupFiles: ['<rootDir>/tests/helpers/setupEnv.js'],
  globalSetup: '<rootDir>/tests/helpers/globalSetup.js',
  globalTeardown: '<rootDir>/tests/helpers/globalTeardown.js',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  testTimeout: 30000,
  verbose: true,
  forceExit: true,
};
