// The Connector's side of the RAMS API (/api/agent/*, backend
// controllers/agent.controller.js). Everything the Connector sends is
// idempotent, so a request that timed out or met a 5xx is simply sent again.
const { version } = require('../../package.json');

class ApiError extends Error {
  constructor(message, { status = 0, code = 'HTTP' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function createApiClient({
  apiUrl, token, timeoutMs = 120000, retries = 3, fetchImpl = globalThis.fetch, sleep = defaultSleep,
}) {
  if (!apiUrl) throw new Error('No RAMS address: set "apiUrl" in connector.json (or RAMS_API_URL)');
  if (!token) throw new Error('No Connector token: set "token" in connector.json (or RAMS_API_TOKEN). An Admin makes one with `npm run agent-token`.');
  const base = `${String(apiUrl).replace(/\/+$/, '')}/api/agent`;
  const backoff = (attempt) => sleep(1000 * 3 ** (attempt - 1));

  async function post(path, body) {
    for (let attempt = 1; ; attempt++) {
      let res;
      try {
        res = await fetchImpl(base + path, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'User-Agent': `rams-connector/${version}`,
          },
          body: JSON.stringify(body ?? {}),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        if (attempt <= retries) { await backoff(attempt); continue; }
        const why = (e.cause && (e.cause.code || e.cause.message)) || e.name || e.message;
        throw new ApiError(`RAMS did not answer at ${base} (${why})`, { code: 'UNREACHABLE' });
      }
      const text = await res.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 200) }; }
      if (res.ok) return data;
      if ((res.status >= 500 || res.status === 429) && attempt <= retries) { await backoff(attempt); continue; }
      if (res.status === 401) {
        throw new ApiError('RAMS rejected the Connector token. An Admin makes a new one with `npm run agent-token`; put it in connector.json.',
          { status: 401, code: 'TOKEN_REJECTED' });
      }
      throw new ApiError(data.message || `RAMS answered HTTP ${res.status}`, { status: res.status });
    }
  }

  return {
    where: base,
    heartbeat: (body) => post('/heartbeat', body),
    startRun: (body) => post('/runs', body),
    masters: (runId, body) => post(`/runs/${runId}/masters`, body),
    vouchers: (runId, vouchers) => post(`/runs/${runId}/vouchers`, { vouchers }),
    reconcile: (runId, body) => post(`/runs/${runId}/reconcile`, body),
    // The matching run a heartbeat asked for (RAMS reads ROMS and matches).
    // One already running there is fine: it is the same work.
    async match() {
      try {
        return await post('/match', {});
      } catch (e) {
        if (e.status === 409) return { skipped: true, message: e.message };
        throw e;
      }
    },
    async finish(runId, body) {
      try {
        return await post(`/runs/${runId}/finish`, body);
      } catch (e) {
        // Sent twice (the first answer was lost) and already recorded.
        if (e.status === 409 && /already (ok|failed)/.test(e.message)) return { sync: null };
        throw e;
      }
    },
  };
}

module.exports = { createApiClient, ApiError };
