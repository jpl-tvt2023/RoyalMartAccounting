// The probe's output folder, and reading it back.
//
//   probe.json                     run metadata: Tally, companies, periods, errors
//   companies/<slug>/masters.json  groups, ledgers, stock items, voucher types
//   companies/<slug>/vouchers.jsonl one normalised voucher per line
//   samples/<slug>/*.json          a couple of raw parsed objects per voucher
//                                  type and master kind — enough to see
//                                  Tally's real shape without the raw export
//   raw/                           every request/response (--keep-raw only);
//                                  the mock Tally can replay this folder
//   profile.json / profile.md      the Tally-only profile
//   analysis.json / analysis.md    the ROMS ↔ Tally analysis (analyze command)
const fs = require('fs');
const path = require('path');
const { readJson, writeJson } = require('../util');
const { baseTypeResolver } = require('../tally/normalize');

const companyDir = (outDir, slug) => path.join(outDir, 'companies', slug);

function writeMasters(outDir, slug, masters) {
  writeJson(path.join(companyDir(outDir, slug), 'masters.json'), masters);
}

function openVoucherWriter(outDir, slug) {
  const file = path.join(companyDir(outDir, slug), 'vouchers.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  return {
    write(vouchers) {
      if (vouchers.length) fs.appendFileSync(file, vouchers.map((v) => JSON.stringify(v)).join('\n') + '\n');
    },
  };
}

function readVouchers(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// Everything a probe folder holds. Base types are re-resolved from the saved
// voucher-type masters, so a fix to the resolver applies without re-pulling.
function readProbe(outDir) {
  const probeFile = path.join(outDir, 'probe.json');
  if (!fs.existsSync(probeFile)) throw new Error(`${outDir} is not a probe folder (no probe.json). Run the probe first.`);
  const run = readJson(probeFile);
  const companies = run.companies.map((info) => {
    const dir = companyDir(outDir, info.slug);
    const masters = fs.existsSync(path.join(dir, 'masters.json'))
      ? readJson(path.join(dir, 'masters.json'))
      : { groups: [], ledgers: [], stockItems: [], voucherTypes: [] };
    const baseTypeOf = baseTypeResolver(masters.voucherTypes || []);
    const vouchers = readVouchers(path.join(dir, 'vouchers.jsonl'));
    for (const v of vouchers) v.baseType = baseTypeOf(v.type);
    return { slug: info.slug, info, masters, vouchers };
  });
  return { run, companies };
}

function makeRawSaver(outDir) {
  const index = [];
  return {
    save(relFile, request, response, describe) {
      const file = path.join(outDir, 'raw', relFile);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, response);
      fs.writeFileSync(file.replace(/\.xml$/, '.request.xml'), request);
      index.push({ key: describe(request).key, file: relFile });
    },
    finish() {
      if (index.length) writeJson(path.join(outDir, 'raw', 'index.json'), index);
    },
  };
}

function writeSample(outDir, slug, name, objects) {
  if (!objects.length) return;
  const safe = String(name).replace(/[^A-Za-z0-9 _-]+/g, '_').trim() || 'unnamed';
  writeJson(path.join(outDir, 'samples', slug, `${safe}.json`), objects);
}

module.exports = { companyDir, writeMasters, openVoucherWriter, readVouchers, readProbe, makeRawSaver, writeSample };
