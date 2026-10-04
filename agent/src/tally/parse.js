// Turning Tally's XML into plain JS, defensively.
//
// Tally's export envelopes differ between request styles (legacy "Export Data"
// vs version-1 "Export"/"Collection") and between releases, so nothing here
// walks a fixed path. Callers ask for "every VOUCHER anywhere in the tree"
// (findAll) and read fields through txt(), which unwraps the
// { '#text', '@_TYPE' } shape fast-xml-parser gives a tag with attributes.
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,      // keep "0012" and "20260401" as strings
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
});

// Tally emits characters that are illegal in XML 1.0 — most famously &#4;,
// which prefixes reserved values like "Not Applicable" — plus stray control
// bytes. Strip both before parsing so one bad byte cannot sink a whole month.
function sanitize(xml) {
  return String(xml)
    .replace(/^﻿/, '')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (m, code) => {
      const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return n < 32 && n !== 9 && n !== 10 && n !== 13 ? '' : m;
    })
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function parseXml(xml) {
  return parser.parse(sanitize(xml));
}

// A tag that appears once parses to an object, several times to an array.
function toArray(v) {
  if (v == null || v === '') return [];
  return Array.isArray(v) ? v : [v];
}

// The text of a field, whether it parsed as a string, a number, or an object
// carrying attributes ({ '#text': 'x', '@_TYPE': 'String' }). Blank → ''.
function txt(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return txt(v[0]);
  if (typeof v === 'object') return v['#text'] == null ? '' : String(v['#text']).trim();
  return String(v).trim();
}

// A field read from either a child tag or an attribute: <X NAME="a"> or <NAME>a</NAME>.
function field(obj, name) {
  if (!obj || typeof obj !== 'object') return '';
  return txt(obj[name]) || txt(obj[`@_${name}`]);
}

function yes(v) {
  return /^yes$/i.test(txt(v));
}

// Every node stored under `key`, at any depth.
function findAll(tree, key) {
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    for (const [k, v] of Object.entries(node)) {
      if (k === key) out.push(...toArray(v).filter(x => x && typeof x === 'object'));
      else if (typeof v === 'object') walk(v);
    }
  };
  walk(tree);
  return out;
}

// Every leaf under `node` whose path matches `test`, as { path: [values] }.
// Used to discover where an unknown field lives (e.g. which tag holds the
// Buyer's Order No) without hard-coding Tally's tag names.
function leafPaths(node, test, prefix = '') {
  const out = {};
  const add = (path, value) => {
    if (value === '') return;
    (out[path] = out[path] || []).push(value);
  };
  const walk = (n, path) => {
    if (n == null) return;
    if (Array.isArray(n)) { n.forEach(x => walk(x, path)); return; }
    if (typeof n !== 'object') { if (test(path)) add(path, String(n).trim()); return; }
    if ('#text' in n && test(path)) add(path, String(n['#text']).trim());
    for (const [k, v] of Object.entries(n)) {
      if (k === '#text' || k.startsWith('@_')) continue;
      walk(v, path ? `${path}/${k}` : k);
    }
  };
  walk(node, prefix);
  return out;
}

// Tally dates: 20260401 → 2026-04-01. Anything else passes through.
function tallyDate(v) {
  const s = txt(v);
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s;
}

// Tally amounts are strings like "-21546.00" or "1,234.50"; quantities and
// rates carry units ("12 Pcs", "10.00/Pcs"). Pull out the leading number.
function num(v) {
  const s = txt(v).replace(/,/g, '');
  const m = /-?\d+(?:\.\d+)?/.exec(s);
  return m ? Number(m[0]) : null;
}

// Status/line errors from an import/export response, if any.
function responseErrors(tree) {
  const errs = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'LINEERROR') toArray(v).forEach(x => errs.push(txt(x)));
      else if (typeof v === 'object') walk(v);
    }
  };
  walk(tree);
  return [...new Set(errs.filter(Boolean))];
}

module.exports = { sanitize, parseXml, toArray, txt, field, yes, findAll, leafPaths, tallyDate, num, responseErrors };
