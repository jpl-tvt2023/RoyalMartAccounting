// What, if anything, is due for one company right now. Pure: the clock, the
// config and the state come in, a decision goes out, so every rule is
// testable without Tally or RAMS.
//
// In order:
//   not loaded in Tally            nothing (the heartbeat says so)
//   marked for a resync (rename)   resync, after office hours
//   backfill not finished          backfill, after office hours
//   Tally's counters went backward resync, after office hours (a restored backup)
//   end-of-day check due           heavy -- the first chance after heavyAfter,
//                                  or at the next start if the PC was off then
//   office hours, hourly           light, but only if a counter moved

const minutesOf = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

// Office hours on the PC's own clock (IST on the office PC).
function isOfficeHours(now, { days, start, end }) {
  if (!days.includes(now.getDay())) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  return t >= minutesOf(start) && t < minutesOf(end);
}

// The most recent heavyAfter moment at or before now: today's if it has
// passed, else yesterday's.
function lastHeavyMoment(now, heavyAfter) {
  const d = new Date(now);
  const minutes = minutesOf(heavyAfter);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  if (d > now) d.setDate(d.getDate() - 1);
  return d;
}

// RAMS's timestamps are UTC 'YYYY-MM-DD HH:MM:SS'.
function parseRamsTime(s) {
  if (!s) return null;
  const d = new Date(`${String(s).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * now            Date
 * cfg            { officeHours, lightEveryMinutes, heavyAfter, backfillInOfficeHours }
 * sync           the company's sync state from the heartbeat
 * live           the company's counters in Tally now, or null if not loaded
 * lastLightCheck Date of this Connector's last light check, or null
 * Returns { kind: 'light'|'heavy'|'backfill'|'resync'|null, reason, checked? }.
 * checked: true means "looked, nothing changed" -- remember it as a light check.
 */
function decide({ now, cfg, sync, live, lastLightCheck = null }) {
  if (!live) return { kind: null, reason: 'not loaded in Tally' };
  const office = isOfficeHours(now, cfg.officeHours);
  const heavyWork = (kind, reason) => (office && !cfg.backfillInOfficeHours
    ? { kind: null, reason: `${reason} — waits for the end of office hours` }
    : { kind, reason });

  if (sync.needsResync) return heavyWork('resync', 'a ledger, stock item or voucher type was renamed');
  if (!sync.backfillDone) return heavyWork('backfill', sync.backfillThrough ? `backfill resumes after ${sync.backfillThrough}` : 'first backfill');
  if (live.altVchId < sync.altVchId || live.altMstId < sync.altMstId) {
    return heavyWork('resync', "Tally's counters went backward (was a backup restored?)");
  }
  const lastHeavy = parseRamsTime(sync.lastHeavyAt);
  if (!lastHeavy || lastHeavy < lastHeavyMoment(now, cfg.heavyAfter)) return { kind: 'heavy', reason: 'end-of-day check' };
  if (!office) return { kind: null, reason: 'outside office hours' };
  // A clock that went back (a correction) makes the last check stale, not recent.
  if (lastLightCheck && now >= lastLightCheck && now - lastLightCheck < cfg.lightEveryMinutes * 60000) {
    return { kind: null, reason: 'checked recently' };
  }
  if (live.altVchId === sync.altVchId && live.altMstId === sync.altMstId) {
    return { kind: null, reason: 'no changes in Tally', checked: true };
  }
  return { kind: 'light', reason: 'changes in Tally' };
}

module.exports = { decide, isOfficeHours, lastHeavyMoment, parseRamsTime };
