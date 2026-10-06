// npm run package -- the RAMS Connector as a folder to copy to the office PC:
//
//   dist/rams-connector/
//     rams-connector.cmd        starts it: rams-connector run | status | ping ...
//     install-service.ps1       sets it up to start at sign-in (run once, M8)
//     uninstall-service.ps1     removes that
//     connector.example.json    the settings template
//     src/, package.json, node_modules/ (production only)
//
// It needs Node 20+ on that PC (nodejs.org, LTS). The settings and logs live in
// %ProgramData%\RAMS\ (connectorConfig.js), not in this folder, so a new
// version is just a new folder.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { version } = require('../package.json');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist', 'rams-connector');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const item of ['src', 'package.json', 'package-lock.json', 'connector.example.json']) {
  fs.cpSync(path.join(root, item), path.join(out, item), { recursive: true });
}
for (const script of ['install-service.ps1', 'uninstall-service.ps1']) {
  fs.copyFileSync(path.join(__dirname, script), path.join(out, script));
}
fs.writeFileSync(path.join(out, 'rams-connector.cmd'), [
  '@echo off',
  'rem The RAMS Connector. Reads Tally, never writes to it. Settings: %ProgramData%\\RAMS\\connector.json',
  'cd /d "%~dp0"',
  'node src\\cli.js %*',
  '',
].join('\r\n'));
execSync('npm ci --omit=dev --no-audit --no-fund', { cwd: out, stdio: 'inherit' });
fs.writeFileSync(path.join(out, 'VERSION.txt'), `RAMS Connector ${version}\r\n`);
console.log(`\nRAMS Connector ${version} packaged in ${out}`);
