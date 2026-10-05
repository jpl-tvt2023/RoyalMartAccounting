# RAMS Connector

Reads TallyPrime over its local XML port (`127.0.0.1:9000`) and **never writes to it**. Every request is an `Export`. It does two jobs:
- **Sync (M3):** keeps RAMS's copy of the Tally books current. It runs a light sync hourly in office hours, an end-of-day check, and a backfill from ROMS go-live.
- **Starting matching (M5):** RAMS on Vercel has no clock of its own, so when a heartbeat reply asks for a match (`commands: [{ type: 'match' }]`), the Connector calls `POST /api/agent/match`. RAMS then reads ROMS and matches. The Connector itself never talks to ROMS.
- **Phase 0 probe:** one-off analysis, described further down.

## Sync (M3)

### Setup on the dev PC
1. **Get a token.** An Admin makes a Connector token against the RAMS database: `cd backend && npm run agent-token -- --name "Dev PC"`. It's shown once.
2. **Write the config.** Copy `connector.example.json` to `connector.json` and set `apiUrl` and `token`. The file is gitignored.
   - On the office PC it lives in `%ProgramData%\RAMS\connector.json`, with logs in `%ProgramData%\RAMS\logs` (M8).
   - `RAMS_API_URL` / `RAMS_API_TOKEN` override the file.
3. **Introduce the companies.** Run `node src/cli.js status`. RAMS lists every company loaded in Tally, each with **sync off**.
4. **Turn companies on.** An Admin or Owner turns on the ones to mirror in RAMS under **Admin → Tally companies**. Companies are created in Tally; RAMS only chooses which ones to sync.
5. **Start it.** Run `node src/cli.js run` for the service, or `node src/cli.js sync` for one sync now.

### Commands

| Command | What it does |
|---|---|
| `run` | The service. A heartbeat every minute, a light sync hourly in office hours, the end-of-day check after `heavyAfter`, and the backfill outside office hours. At the end of a cycle, a matching run when RAMS asks for one. Errors are logged and retried; it never exits on one. |
| `sync [--company MH] [--kind light\|heavy\|backfill\|resync]` | One sync now, then exit. Without `--kind` it does what is due. |
| `sync --dry-run [--from YYYY-MM-DD] [--out DIR]` | A backfill written to files instead of RAMS. Nothing is sent. |
| `status` | What RAMS knows (watermarks, backfill) next to Tally's counters now, and the last matching run. |

### How a sync works
- **Light:**
  - One cheap request reads each company's `AltVchId`/`AltMstId`. If they're unchanged, nothing else is asked of Tally.
  - Otherwise it pulls the masters (if `AltMstId` moved), then only the vouchers with `$AlterID >` the watermark, using a Voucher collection with a TDL `FILTER`.
- **End of day (heavy):**
  - a light sync and the full master lists
  - then each month's GUID + AlterID list, so RAMS marks vouchers deleted in Tally
  - a month where RAMS lacks a voucher or holds an older copy is pulled again
- **Backfill / resync:**
  - month by month from the sync start (RAMS's `RAMS_SYNC_FROM`, ROMS go-live by default) to 31 March of this financial year
  - each month is pushed, then reconciled; RAMS records it, so an interrupted backfill resumes after the last finished month
  - a resync is the same from scratch; it runs after a restored backup (counters went backward) or a ledger/item rename
- **Watermarks:** they live in RAMS and move only when a run finishes ok, to the counters Tally had when it started. Anything altered during a run is fetched next time.
- **Educational mode:** periods are widened to the 1st, 2nd or 31st and trimmed (`eduSafeRange`), and the heartbeat reports the licence mode.

Measured on TallyPrime 7.1 Educational (dev PC, MH/HR/WB copy, 2026-10-05):

| Run | Time | Detail |
|---|---|---|
| Backfill, all three | 4 min | MH 3,775 vouchers; it matches the Phase 0 probe voucher for voucher |
| Light sync, nothing changed | 1 s | |
| End-of-day check, all three | 9 s | |

### Settings
**The sync schedule is set in RAMS**, by an Admin or Owner under **Admin → Tally companies → Sync schedule** (audited). It covers:
- office days and hours, on the office PC's clock
- how often the light sync checks
- when the end-of-day check runs
- whether a backfill may run during office hours

The Connector picks up a change at its next heartbeat, within a minute, and `status` shows the schedule in force. The same keys in `connector.json` (`officeHours`, `lightEveryMinutes`, `heavyAfter`, `backfillInOfficeHours`) only stand in until RAMS has answered once.

`connector.json` itself holds:
- `apiUrl` and `token`
- `tally` (host, port, timeout, encoding)
- `batchSize` (100 vouchers per request, at most 250)
- `heartbeatSeconds`, `tallyCheckMinutes`
- `logDir`, `keepLogDays` (14)

The log is one file per day, and the token is never written to it.

### Tests
`npm test` runs everything against the mock Tally.
- `tests/sync.test.js` and `tests/run.test.js` drive the real RAMS API on a throwaway SQLite file (`tests/helpers/rams.js`), so `backend/` needs `npm install` too.
- `mock/books.js` edits the mock's books the way an accountant would: alter, add, delete, rename a ledger, or restore an older backup.

## Phase 0 — probe and analysis

Phase 0 answers the decision-gate questions from real data before RAMS writes anything into ROMS:

- Do Tally numbers contain `/`, which ROMS rejects? How do staff type them into ROMS today?
- Does the Buyer's Order No find the ROMS PO? Does it agree with the Bill No?
- Whose number is the RTV CN number? Does the Agst Ref route from credit note to invoice work?
- Where do GRN Discrepancy Numbers and RTV DNs live in Tally?
- How are the Flipkart/Amazon stock transfers vouchered? Which party ledger is which marketplace?
- Do stock item names equal ROMS SKUs?

Node 20+. `npm install`, then `npm test` runs the suites against a mock Tally.

## Commands

| Command | Where it runs | What it does |
|---|---|---|
| `node src/cli.js ping` | Tally PC | Checks that Tally answers, and lists the open companies. |
| `node src/cli.js companies` | Tally PC | Lists the open companies with their `AltVchId`/`AltMstId` counters. |
| `node src/cli.js probe --from 2026-04-01` | Tally PC | Pulls masters and vouchers, month by month, from every open company. Writes a probe folder with `profile.md`. |
| `node src/cli.js record …` | Tally PC | Same as `probe`, plus every raw request/response, which the mock can replay. |
| `node src/cli.js roms-refs --roms-env "<ROMS>/backend/.env"` | dev PC | Reads ROMS PO, RTV and SKU references with SELECTs only. Writes JSON and a summary that includes the go-live date to use as `--from`. |
| `node src/cli.js analyze --probe <dir> --refs <json>` | dev PC | Compares ROMS with Tally and writes `analysis.md`, the decision gate. |
| `node src/cli.js profile --probe <dir>` | anywhere | Rebuilds `profile.md` from a probe folder, with no Tally needed. |

Tally connection options: `--host`, `--port`, `--timeout <s>` (default 300), `--encoding utf16|utf8` (default utf16, as `tally-database-loader` uses).

## Testing stages

**A. Mock.** Run `npm test`, or `npm run mock` to serve synthetic MH/HR/WB books on port 9000. To replay a real recording, run `node mock/server.js --replay <probe dir>`.

**B. Sandbox Tally.**
1. Install TallyPrime 7.x in Educational mode on the dev PC.
2. Turn the server on: F1 → Settings → Connectivity → *acts as* Both, port 9000.
3. Create three small companies set up like the accountant's.

Educational mode only accepts dates on the 1st, 2nd and 31st, for export periods as well as voucher entry. The probe widens each month to such dates and drops what falls outside, so Educational mode still gives complete data.

**C. Copy of the real books.**
1. On the office PC, run Data → Backup for each of the three companies.
2. On the dev PC, run Data → Restore with the same 7.x release, and load all three.
3. Run `record --from <ROMS go-live>`, then `roms-refs`, then `analyze`.

Always work on the restored copy. A newer release may migrate the data and can't go back.

**D. Office PC.**
1. After hours, staff double-click `scripts\rams-probe.bat` with all three companies loaded.
2. The script writes `rams-probe-<date>.zip` with the report and the extracted data. Raw exports and credentials are not included.

## Reading the output

- `profile.md` is Tally only. For each company it covers voucher types per financial year, number formats (and how many ROMS would reject), Buyer's Order No fill, how CN/DN are booked, transfers and internal ledgers, parties and stock items.
- `analysis.md` puts the decision gate first, then the evidence: auto-fill potential, Bill No and Buyer's Order No detail, where CN/DN numbers live, transfers, SKUs and line sanity.
- `samples/<company>/` holds two raw parsed objects for each voucher type and each master kind. Look here first if a field seems to be missing.

Probe folders and ROMS refs hold real books, so `.gitignore` keeps them out of git.
