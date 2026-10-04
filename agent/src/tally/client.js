// The only door to Tally: POST an XML envelope to its HTTP port.
//
// Tally serves one request at a time and can stall the accountant's screen
// while it does, so every call goes through a single serial queue — two
// callers in this process can never hit Tally at once.
//
// Requests go out as UTF-16LE (what tally-database-loader sends, so names
// with non-ASCII characters survive). Responses are decoded by sniffing,
// because Tally answers in UTF-8 or UTF-16 depending on release and request.
const http = require('http');
const { parseXml, findAll, txt, responseErrors } = require('./parse');

class TallyError extends Error {
  constructor(message, { code, label, detail } = {}) {
    super(message);
    this.name = 'TallyError';
    this.code = code;
    this.label = label;
    this.detail = detail;
  }
}

function decode(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const le = Buffer.from(buf.subarray(2));
    le.swap16();
    return le.toString('utf16le');
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  // UTF-16LE without a BOM: ASCII text leaves most odd bytes zero.
  const n = Math.min(buf.length - (buf.length % 2), 1024);
  let zeros = 0;
  for (let i = 1; i < n; i += 2) if (buf[i] === 0) zeros++;
  return n >= 4 && zeros > n / 4 ? buf.subarray(0, buf.length - (buf.length % 2)).toString('utf16le') : buf.toString('utf8');
}

function createTallyClient({
  host = '127.0.0.1',
  port = 9000,
  timeoutMs = 300000,
  encoding = 'utf16',
  onExchange = null, // ({ label, request, response, ms }) — used to record fixtures
} = {}) {
  let chain = Promise.resolve();
  const serial = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };

  const where = `${host}:${port}`;
  const netError = (err, label) => {
    if (err instanceof TallyError) return err;
    if (err.code === 'ECONNREFUSED') {
      return new TallyError(
        `Nothing is listening on ${where}. Is TallyPrime open, with its HTTP server on `
        + '(F1 Help → Settings → Connectivity → "TallyPrime acts as" Server/Both, port 9000)?',
        { code: 'UNREACHABLE', label },
      );
    }
    if (err.code === 'ECONNRESET') {
      return new TallyError(`Tally dropped the connection on ${where} (it may have closed or crashed mid-request).`, { code: 'RESET', label });
    }
    return new TallyError(`${label || 'request'}: ${err.message}`, { code: err.code || 'NETWORK', label });
  };

  function send({ method, body, label, timeout }) {
    return new Promise((resolve, reject) => {
      const headers = {};
      let payload = null;
      if (body != null) {
        payload = encoding === 'utf8' ? Buffer.from(body, 'utf8') : Buffer.from(body, 'utf16le');
        headers['Content-Type'] = `text/xml;charset=${encoding === 'utf8' ? 'utf-8' : 'utf-16'}`;
        headers['Content-Length'] = payload.length;
      }
      const req = http.request({ host, port, method, path: '/', headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, text: decode(Buffer.concat(chunks)) }));
        res.on('error', (e) => reject(netError(e, label)));
      });
      req.setTimeout(timeout, () => req.destroy(new TallyError(
        `Tally did not answer "${label}" within ${Math.round(timeout / 1000)}s. `
        + 'Try a smaller --chunk-days, or a quieter time of day.',
        { code: 'TIMEOUT', label },
      )));
      req.on('error', (e) => reject(netError(e, label)));
      req.end(payload || undefined);
    });
  }

  // POST an envelope; resolve to { text, tree, ms } or throw a TallyError.
  function post(xml, { label = 'request', timeoutMs: timeout = timeoutMs } = {}) {
    return serial(async () => {
      const started = Date.now();
      const { status, text } = await send({ method: 'POST', body: xml, label, timeout });
      const ms = Date.now() - started;
      if (onExchange) onExchange({ label, request: xml, response: text, ms });
      if (status !== 200) throw new TallyError(`Tally answered HTTP ${status} to "${label}"`, { code: 'HTTP', label, detail: text.slice(0, 500) });

      // A bare <RESPONSE> is how Tally refuses a request it cannot parse
      // ("Unknown Request, cannot be processed").
      const bare = /^\s*(?:<\?xml[^>]*>\s*)?<RESPONSE>([\s\S]*?)<\/RESPONSE>\s*$/i.exec(text);
      if (bare) throw new TallyError(`Tally refused "${label}": ${bare[1].trim()}`, { code: 'REFUSED', label });

      let tree;
      try {
        tree = parseXml(text);
      } catch (e) {
        throw new TallyError(`Tally's answer to "${label}" is not readable XML: ${e.message}`, { code: 'BAD_XML', label, detail: text.slice(0, 500) });
      }
      const errors = responseErrors(tree);
      const header = findAll(tree, 'HEADER')[0];
      const failed = header && txt(header.STATUS) === '0';
      if (errors.length || failed) {
        throw new TallyError(`Tally reported an error for "${label}": ${errors.join('; ') || 'STATUS 0'}`, { code: 'LINEERROR', label, detail: errors });
      }
      return { text, tree, ms };
    });
  }

  // GET / — Tally answers "<RESPONSE>TallyPrime Server is Running</RESPONSE>".
  function ping({ timeoutMs: timeout = 10000 } = {}) {
    return serial(async () => {
      const started = Date.now();
      const { status, text } = await send({ method: 'GET', label: 'ping', timeout });
      const message = (/<RESPONSE>([\s\S]*?)<\/RESPONSE>/i.exec(text) || [null, text])[1].trim();
      return { ok: status === 200 && /running/i.test(message), status, message, ms: Date.now() - started };
    });
  }

  return { post, ping, where };
}

module.exports = { createTallyClient, TallyError, decode };
