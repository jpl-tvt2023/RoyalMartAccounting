const http = require('http');
const { createTallyClient, decode } = require('../src/tally/client');

// A throwaway server whose handler the test controls.
function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(server));
  });
}
const portOf = (s) => s.address().port;
const close = (s) => new Promise((r) => s.close(r));

describe('Tally client', () => {
  test('decode sniffs UTF-16LE with and without a BOM, and UTF-8', () => {
    const s = '<A>Zepto ₹</A>';
    expect(decode(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]))).toBe(s);
    expect(decode(Buffer.from(s, 'utf16le'))).toBe(s);
    expect(decode(Buffer.from(s, 'utf8'))).toBe(s);
  });

  test('sends UTF-16 by default and parses the answer', async () => {
    let seen;
    const server = await serve((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        seen = { type: req.headers['content-type'], body: Buffer.concat(chunks).toString('utf16le') };
        res.end(Buffer.from('<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><DATA><X>ok</X></DATA></ENVELOPE>', 'utf16le'));
      });
    });
    const client = createTallyClient({ port: portOf(server) });
    const r = await client.post('<ENVELOPE/>');
    expect(seen).toEqual({ type: 'text/xml;charset=utf-16', body: '<ENVELOPE/>' });
    expect(r.tree.ENVELOPE.DATA.X).toBe('ok');
    await close(server);
  });

  test.each([
    ['<RESPONSE>Unknown Request, cannot be processed</RESPONSE>', 'REFUSED'],
    ["<ENVELOPE><HEADER><STATUS>0</STATUS></HEADER><DATA><LINEERROR>Could not set 'SVCurrentCompany'</LINEERROR></DATA></ENVELOPE>", 'LINEERROR'],
    ['<ENVELOPE><HEADER><STATUS>0</STATUS></HEADER></ENVELOPE>', 'LINEERROR'],
  ])('turns Tally refusals into TallyErrors: %s', async (body, code) => {
    const server = await serve((req, res) => { req.resume(); req.on('end', () => res.end(body)); });
    await expect(createTallyClient({ port: portOf(server) }).post('<E/>')).rejects.toMatchObject({ name: 'TallyError', code });
    await close(server);
  });

  test('a closed port is UNREACHABLE with Tally-specific advice', async () => {
    const server = await serve(() => {});
    const port = portOf(server);
    await close(server);
    await expect(createTallyClient({ port }).post('<E/>')).rejects.toMatchObject({ code: 'UNREACHABLE', message: expect.stringContaining('Connectivity') });
  });

  test('a silent Tally times out', async () => {
    const server = await serve(() => {}); // never answers
    await expect(createTallyClient({ port: portOf(server), timeoutMs: 150 }).post('<E/>')).rejects.toMatchObject({ code: 'TIMEOUT' });
    server.closeAllConnections();
    await close(server);
  });

  test('requests never overlap, even when fired together', async () => {
    let inFlight = 0, maxInFlight = 0;
    const server = await serve((req, res) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      req.resume();
      setTimeout(() => { inFlight--; res.end('<E><HEADER><STATUS>1</STATUS></HEADER></E>'); }, 20);
    });
    const client = createTallyClient({ port: portOf(server) });
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => client.post('<E/>')));
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(maxInFlight).toBe(1);
    await close(server);
  });

  test('ping reads the Running banner', async () => {
    const server = await serve((req, res) => res.end('<RESPONSE>TallyPrime Server is Running</RESPONSE>'));
    await expect(createTallyClient({ port: portOf(server) }).ping()).resolves.toMatchObject({ ok: true, message: 'TallyPrime Server is Running' });
    await close(server);
  });
});
