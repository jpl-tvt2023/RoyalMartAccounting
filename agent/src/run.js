// `rams-connector run`: the Connector as a long-running service.
//
// Every minute it sends RAMS a heartbeat (is Tally answering, which companies
// are loaded, their counters, what the Connector is doing, its last error) and
// gets back the companies whose sync is on. Then, one company at a time, it
// runs whatever the scheduler says is due, and last, if RAMS asked for them,
// a matching run and then auto-fill into ROMS (RAMS on Vercel has no clock of
// its own). Nothing here ever
// exits on an error: it is logged, reported in the next heartbeat, and tried
// again.
const { listCompanies, pullSysInfo } = require('./tally/pull');
const { syncCompany } = require('./sync');
const { decide } = require('./sync/scheduler');
const { applySchedule, describeSchedule } = require('./connectorConfig');
const { todayIso } = require('./util');
const { version } = require('../package.json');

const SYSINFO_EVERY_MS = 60 * 60000;
// Auto-fill rounds per cycle: each is time-boxed on RAMS's side (about 30 s),
// so this bounds one cycle while the first big catch-up runs.
const AUTOFILL_MAX_ROUNDS = 20;
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
    // The settings in force: connector.json with RAMS's sync schedule laid over.
    cfg,
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
      useSchedule(state.server.settings && state.server.settings.schedule);
    } catch (e) {
      fail(`RAMS: ${e.message}`);
    }
    return state.server;
  }

  // An Admin's change to the schedule in RAMS takes effect at the next heartbeat.
  function useSchedule(schedule) {
    let next;
    try {
      next = applySchedule(cfg, schedule);
    } catch (e) {
      fail(`RAMS: ${e.message}`);
      return;
    }
    if (describeSchedule(next) !== describeSchedule(state.cfg) || !state.scheduleLogged) {
      log(`Sync schedule${schedule ? ' from RAMS' : ''}: ${describeSchedule(next)}`);
      state.scheduleLogged = true;
    }
    state.cfg = next;
  }

  // One pass: check Tally, report, then run what is due, one company at a time.
  async function cycle() {
    await checkTally();
    await heartbeat();
    if (!state.server) return [];
    const results = [];
    // "Sync now" from RAMS: a light sync of these companies this cycle, even
    // outside office hours.
    const asked = new Set((state.server.commands || []).filter((c) => c.type === 'sync').map((c) => c.company_id));
    for (const company of state.server.companies) {
      let live = state.live.find((c) => c.guid === company.guid);
      const ask = () => decide({
        now: now(), cfg: state.cfg, sync: company.sync, live, lastLightCheck: state.lastLight.get(company.guid) || null,
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
      if (!decision.kind && asked.has(company.id) && live && company.sync.backfillDone && !company.sync.needsResync) {
        decision = { kind: 'light', reason: 'Sync now, asked in RAMS' };
      }
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
    const wants = (type) => (state.server.commands || []).some((c) => c.type === type);
    let fillDue = wants('autofill');
    if (wants('match')) {
      const out = await match();
      if (out && out.autofill_due) fillDue = true;
    }
    if (fillDue) await autofill();
    return results;
  }

  // RAMS reads ROMS again and matches; the Connector only starts it.
  async function match() {
    const why = (state.server.commands.find((c) => c.type === 'match') || {}).why;
    state.activity = { state: 'matching', since: now().toISOString() };
    try {
      const out = await api.match();
      if (out.skipped) {
        log(`Matching: ${out.message}`);
      } else {
        const po = (out.counts && out.counts.po) || {};
        log(`Matching${why ? ` (${why.toLowerCase()})` : ''}: ${po.linked || 0} POs linked, ${po.review || 0} need review, ${po.waiting || 0} waiting for Tally${out.roms && !out.roms.ok ? ` — ROMS not read: ${out.roms.error}` : ''}`);
      }
      recovered('RAMS');
      state.server.commands = state.server.commands.filter((c) => c.type !== 'match');
      return out;
    } catch (e) {
      fail(`RAMS: matching failed — ${e.message}`);
      return null;
    } finally {
      state.activity = { state: 'idle' };
    }
  }

  // RAMS writes Tally's numbers into ROMS a round at a time; the Connector
  // only starts each round, and asks again while RAMS says there is more.
  async function autofill({ maxRounds = AUTOFILL_MAX_ROUNDS } = {}) {
    const why = ((state.server.commands || []).find((c) => c.type === 'autofill') || {}).why;
    state.activity = { state: 'autofill', since: now().toISOString() };
    const total = {
      written: 0, already: 0, refused: 0, checked: 0,
    };
    let last = null;
    try {
      for (let round = 1; round <= maxRounds; round++) {
        last = await api.autofill();
        if (last.skipped) break;
        for (const k of Object.keys(total)) total[k] += (last.counts && last.counts[k]) || 0;
        if (!last.ok || !last.more) break;
      }
      if (last && last.skipped) {
        log(`Auto-fill: ${last.message}`);
      } else if (last && !last.ok) {
        fail(`RAMS: auto-fill stopped — ${last.error}`);
      } else {
        const left = last && last.remaining ? `, ${last.remaining} to go` : '';
        log(`Auto-fill${why ? ` (${why})` : ''}: ${total.written} written into ROMS, ${total.refused} refused, ${total.checked} checked${left}`);
        recovered('RAMS');
      }
      state.server.commands = (state.server.commands || []).filter((c) => c.type !== 'autofill');
      return { ...total, last };
    } catch (e) {
      fail(`RAMS: auto-fill failed — ${e.message}`);
      return null;
    } finally {
      state.activity = { state: 'idle' };
    }
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

  return {
    state, checkTally, heartbeat, cycle, match, autofill, runForever,
  };
}

module.exports = { createService };
