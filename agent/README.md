# RAMS Connector — Phase 0

Reads TallyPrime over its local XML port (`127.0.0.1:9000`) and **never writes to it**. Every request is an `Export`. Phase 0 answers the decision-gate questions from real data before RAMS writes anything into ROMS:

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
| `node src/cli.js probe --from 2026-04-01` | Tally PC | Pulls masters and the Day Book, month by month, from every open company. Writes a probe folder with `profile.md`. |
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

Educational mode only accepts voucher dates on the 1st, 2nd and 31st.

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
