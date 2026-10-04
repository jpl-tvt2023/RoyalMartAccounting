// --runInBand is MANDATORY (npm test passes it): every suite shares one SQLite
// file, so parallel workers would corrupt each other. (Copied from ROMS.)
module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/helpers/setupEnv.js'],
  globalSetup: '<rootDir>/tests/helpers/globalSetup.js',
  globalTeardown: '<rootDir>/tests/helpers/globalTeardown.js',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  testTimeout: 30000,
  verbose: true,
  forceExit: true,
};
