// `rams-connector run`: the Connector as a long-running service.
//
// Every minute it sends RAMS a heartbeat (is Tally answering, which companies
// are loaded, their counters, what the Connector is doing, its last error) and
// gets back the companies whose sync is on. Then, one company at a time, it
// runs whatever the scheduler says is due. Nothing here ever exits on an
// error: it is logged, reported in the next heartbeat, and tried again.
const { listCompanies, pullSysInfo } = require('./tally/pull');
const { syncCompany } = require('./sync');
const { decide } = require('./sync/scheduler');
const { todayIso } = require('./util');
const { version } = require('../package.json');

const SYSINFO_EVERY_MS = 60 * 60000;
const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function createService({ cfg, tally, api, log = () => {}, now = () => new Date() }) {
  const state = {
    tally: { reachable: null, message: '', educational: null, licensed: null, checkedAt: null },
    live: [],
    server: null,
    activity: { state: 'idle' },
    lastError: null,
    lastTallyCheck: 0,
    lastSysInfo: 0,
    lastHeartbeat: 0,
    lastLight: new Map(),
    typesCache: new Map(),
  };
  // lastError is "Tally: …", "RAMS: …" or "<company>: …", and is cleared once
  // that same thing works again.
  const fail = (message) => {
    state.lastError = message;
    (log.error || log)(message);
  };
  const recovered = (prefix) => {
    if (state.lastError && state.lastError.startsWith(`${prefix}:`)) state.lastError = null;
  };

  // Within `ms` of `since` on this PC's clock. A clock that went back (a
  // correction) counts as "long ago", so nothing waits forever.
  const within = (since, ms) => {
    const t = now().getTime();
    return t >= since && t - since < ms;
  };

  // Is Tally answering, and which companies are loaded with what counters.
  async function checkTally({ force = false } = {}) {
    const t = now().getTime();
    if (!force && within(state.lastTallyCheck, cfg.tallyCheckMinutes * 60000)) return state.tally;
    state.lastTallyCheck = t;
    try {
      const ping = await tally.ping();
      if (!ping.ok) throw Object.assign(new Error(`Something else answers on ${tally.where}: ${ping.message.slice(0, 120)}`), { code: 'NOT_TALLY' });
      state.live = await listCompanies(tally);
      if (!within(state.lastSysInfo, SYSINFO_EVERY_MS) || state.tally.educational == null) {
        try {
          Object.assign(state.tally, await pullSysInfo(tally, { today: todayIso(now()) }));
          state.lastSysInfo = t;
        } catch (e) {
          if (e.code === 'UNREACHABLE') throw e;
          log(`Licence check failed: ${e.message}`);
        }
      }
      state.tally = { ...state.tally, reachable: true, message: '', checkedAt: now().toISOString() };
      recovered('Tally');
    } catch (e) {
      state.live = [];
      state.tally = { ...state.tally, reachable: false, message: e.message, checkedAt: now().toISOString() };
      fail(`Tally: ${e.message}`);
    }
    return state.tally;
  }

  async function heartbeat() {
    state.lastHeartbeat = now().getTime();
    try {
      state.server = await api.heartbeat({
        version,
        tally: state.tally,
        companies: state.live.map(({ guid, name, state: st, booksFrom, altVchId, altMstId }) => ({
          guid, name, state: st, booksFrom, altVchId, altMstId,
        })),
        activity: state.activity,
        lastError: state.lastError,
      });
      recovered('RAMS');
    } catch (e) {
      fail(`RAMS: ${e.message}`);
    }
    return state.server;
  }

  // One pass: check Tally, report, then run what is due, one company at a time.
  async function cycle() {
    await checkTally();
    await heartbeat();
    if (!state.server) return [];
    const results = [];
    for (const company of state.server.companies) {
      let live = state.live.find((c) => c.guid === company.guid);
      const ask = () => decide({
        now: now(), cfg, sync: company.sync, live, lastLightCheck: state.lastLight.get(company.guid) || null,
      });
      let decision = ask();
      if (decision.kind || decision.checked) {
        // Counters fresh to the second before deciding there is nothing to
        // do, or before anything is pulled.
        await checkTally({ force: true });
        live = state.live.find((c) => c.guid === company.guid);
        decision = ask();
      }
      if (decision.checked) state.lastLight.set(company.guid, now());
      if (!decision.kind) continue;

      const label = company.code || company.name;
      log(`${label}: ${decision.kind} sync due (${decision.reason})`);
      state.activity = { state: 'syncing', company: label, kind: decision.kind, since: now().toISOString() };
      heartbeat().catch(() => {});
      try {
        const result = await syncCompany({
          tally, api, company, live, kind: decision.kind,
          syncFrom: state.server.settings.syncFrom, today: todayIso(now()),
          batchSize: cfg.batchSize, typesCache: state.typesCache, log,
        });
        if (result.ok) {
          state.lastLight.set(company.guid, now());
          recovered(label);
        } else {
          fail(`${label}: ${result.errors.join('; ')}`);
        }
        if (result.sync) company.sync = result.sync;
        results.push(result);
      } catch (e) {
        fail(`${label}: ${decision.kind} sync failed — ${e.message}`);
        results.push({ ok: false, kind: decision.kind, error: e.message });
      } finally {
        state.activity = { state: 'idle' };
      }
    }
    return results;
  }

  // Forever: a cycle, then wait. A heartbeat goes out every heartbeatSeconds
  // even while a long sync runs, so RAMS can show what is happening.
  async function runForever({ sleep = defaultSleep, stop = () => false } = {}) {
    log(`RAMS Connector ${version} — Tally ${tally.where}, RAMS ${api.where}, log ${log.dir || '(console)'}`);
    const beat = setInterval(() => {
      if (!within(state.lastHeartbeat, cfg.heartbeatSeconds * 1000)) heartbeat().catch(() => {});
    }, 5000);
    try {
      while (!stop()) {
        try {
          await cycle();
        } catch (e) {
          fail(`Unexpected: ${e.message}`);
        }
        await sleep(cfg.heartbeatSeconds * 1000);
      }
    } finally {
      clearInterval(beat);
    }
  }

  return { state, checkTally, heartbeat, cycle, runForever };
}

module.exports = { createService };
