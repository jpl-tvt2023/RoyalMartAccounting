// Mock TallyPrime for development and CI (testing Stage A).
//
//   node mock/server.js                  synthetic MH/HR/WB books (dataset.js)
//   node mock/server.js --replay DIR     replay a recorded probe folder
//                                        (rams-connector record … --out DIR)
//   --port 9000                          default 9000, like Tally
//
// Answers GET with Tally's "Server is Running" and POSTs by what the
// envelope asks for (requests.js describeRequest), in the same encoding the
// request came in.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { describeRequest } = require('../src/tally/requests');
const { decode } = require('../src/tally/client');
const { buildDataset } = require('./dataset');
const xml = require('./xml');

const UNKNOWN = '<RESPONSE>Unknown Request, cannot be processed</RESPONSE>';

function syntheticAnswer(dataset, body) {
  const d = describeRequest(body);
  if (/^collection$/i.test(d.type) && /compan/i.test(d.id)) return xml.companiesXml(dataset.companies);
  if (!/^(list of accounts|daybook|day book|rams vouchers)$/i.test(d.id)) return UNKNOWN;
  const company = dataset.companies.find((c) => c.name.toLowerCase() === d.company.toLowerCase());
  if (!company) return xml.errorXml(`Could not set 'SVCurrentCompany' to '${d.company}'`);
  // The voucher collection holds the same VOUCHER objects as a Day Book.
  return /list of accounts/i.test(d.id) ? xml.mastersXml(company, d.accountType) : xml.dayBookXml(company, d.from, d.to);
}

function replayAnswerer(dir) {
  const indexFile = path.join(dir, 'raw', 'index.json');
  if (!fs.existsSync(indexFile)) throw new Error(`${indexFile} not found — record with: rams-connector record --out ${dir}`);
  const byKey = new Map(JSON.parse(fs.readFileSync(indexFile, 'utf8')).map((e) => [e.key, path.join(dir, 'raw', e.file)]));
  return (body) => {
    const file = byKey.get(describeRequest(body).key);
    return file ? fs.readFileSync(file, 'utf8') : UNKNOWN;
  };
}

function createMockTally({ dataset = null, replayDir = null, onRequest = null } = {}) {
  const answer = replayDir ? replayAnswerer(replayDir) : ((ds) => (body) => syntheticAnswer(ds, body))(dataset || buildDataset());
  return http.createServer((req, res) => {
    const reply = (text, utf16) => {
      const buf = Buffer.from(text, utf16 ? 'utf16le' : 'utf8');
      res.writeHead(200, { 'Content-Type': `text/xml; charset=${utf16 ? 'utf-16' : 'utf-8'}`, 'Content-Length': buf.length });
      res.end(buf);
    };
    if (req.method === 'GET') return reply('<RESPONSE>TallyPrime Server is Running</RESPONSE>', false);
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const utf16 = /utf-16/i.test(req.headers['content-type'] || '');
      const body = decode(Buffer.concat(chunks));
      if (onRequest) onRequest(body);
      let text;
      try {
        text = answer(body);
      } catch (e) {
        text = `<RESPONSE>${e.message}</RESPONSE>`;
      }
      reply(text, utf16);
    });
    return undefined;
  });
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opt = (name) => { const i = argv.indexOf(`--${name}`); return i === -1 ? null : argv[i + 1]; };
  const port = Number(opt('port') || 9000);
  const replayDir = opt('replay');
  createMockTally({ replayDir }).listen(port, '127.0.0.1', () => {
    console.log(`Mock Tally on 127.0.0.1:${port} — ${replayDir ? `replaying ${replayDir}` : 'synthetic Roymax MH/HR/WB books'}`);
  });
}

module.exports = { createMockTally, syntheticAnswer };
