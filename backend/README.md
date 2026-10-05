# RAMS backend

The RAMS API: Node 20, Express 5 (CommonJS), `@libsql/client` with raw SQL, the same stack and conventions as the ROMS backend, copied rather than shared.

It serves people at `/api/auth`, `/api/users`, `/api/audit-logs`, `/api/companies`, `/api/settings/sync`, `/api/settings/permissions`, `/api/sync/status`, `/api/matching/*` and `/api/health`. The Connector uses `/api/agent/*` (see below).

## Run it locally

```bash
npm install
cp .env.example .env          # then fill in the two JWT secrets (see the comments)
npm run migrate               # check which database .env points at first
RAMS_ADMIN_USERNAME=you RAMS_ADMIN_PASSWORD='Choose#One1' npm run bootstrap-admin
npm run dev                   # http://localhost:5001  (ROMS uses 5000)
```

In **PowerShell**, set the two variables with `$env:` instead, then clear them:

```powershell
$env:RAMS_ADMIN_USERNAME='you'; $env:RAMS_ADMIN_PASSWORD='Choose#One1'; npm run bootstrap-admin
Remove-Item Env:RAMS_ADMIN_USERNAME, Env:RAMS_ADMIN_PASSWORD
```

- **`TURSO_DATABASE_URL`** is `file:./local.db` by default. The RAMS test database is `libsql://royalmart-rams-test-royalmart.aws-ap-south-1.turso.io`. `npm run migrate` applies to whatever this points at, so check it first.
- **`npm run bootstrap-admin`** creates the first Admin once, only when no active Admin exists. It never resets anyone's password. That Admin must change the password at first sign-in, then creates everyone else from the Users page.

## Tally sync: the Connector API (M4)

The RAMS Connector (`../agent`) reads Tally on the office PC and pushes it here. Its routes take a **Connector token**, never a user's sign-in, and a Connector token works nowhere else.
- **Making a token:**
  - `npm run agent-token -- --name "Office PC"` prints a new token **once**; only its sha256 is stored
  - `--rotate` retires the other tokens first, and `--revoke-all` retires them all
  - like `migrate`, it writes to whatever database `.env` points at
- **Which companies sync is data, not code:**
  - the Connector reports every company loaded in Tally, and each new Tally company GUID becomes a row in `tally_companies` with sync **off**
  - an Admin or Owner turns sync on per company (`PATCH /api/companies/:id`, the *Tally companies* page), and that's audited
  - companies are created in Tally, never in RAMS
- **The API:** `POST /api/agent/heartbeat`, `/runs`, `/runs/:id/masters`, `/runs/:id/vouchers` (≤ 250), `/runs/:id/reconcile`, `/runs/:id/finish`.
  - Every write is idempotent on (company, Tally GUID).
  - A voucher older than the stored copy (lower AlterID) is skipped.
  - Watermarks move only when a run finishes ok (`controllers/agent.controller.js`).
- **The tables** (migrations 004–009; 010–012 are permissions and matching, below):
  - `tally_companies`, `agents`, `tally_sync_state`, `tally_sync_runs`
  - the masters (`tally_groups`, `tally_ledgers`, `tally_stock_items`, `tally_voucher_types`)
  - `tally_vouchers` with its ledger lines, bill allocations, inventory lines and Buyer's Order Nos
  - money is whole paise; deleted Tally records get `deleted_at`
- **The sync schedule is data too** (migration 009, `sync_settings`):
  - it covers office days and hours, the light-sync interval, the end-of-day check time, and whether a backfill may run in office hours
  - Admin/Owner change it with `PUT /api/settings/sync` (the *Sync schedule* panel, audited)
  - the Connector gets it in every heartbeat reply (`settings.schedule`)
- **`RAMS_SYNC_FROM`** (default `2026-06-08`, ROMS go-live) is the first day mirrored. Changing it later needs a resync of each company.

## Who can do what (M5)

- **Roles are fixed:** Admin, Owner, Accountant, Viewer.
- **What Accountants and Viewers may do is data**, set on *Admin → Roles & permissions*:
  - stored in `role_permissions` (migration 010), audited as `ROLE_PERMISSIONS_UPDATE`
  - **Admin and Owner always hold every permission**
- **The permission catalog** (keys, labels, what each allows) is `src/services/permissions.js`, because each key guards a route.
  - Routes use `requirePermission(key)` (`middleware/permission.js`), which looks the permission up on every request, so a change applies at once.
  - `/api/auth/me` and login return the user's effective `permissions`, and the UI hides what they can't use.
- **Users, the Audit Log and the permissions page stay `allowRoles(Admin, Owner)` and are never grantable**, so nobody can give themselves admin rights.
- **Defaults:**
  - Accountants: every `matching.*` permission
  - Viewers: `matching.view`
  - `sync.companies` and `sync.schedule`: Admin/Owner until granted

## Matching (M5)

RAMS links each ROMS PO to the Tally sales invoice that billed it, and each RTV row to the credit note that settled it. Nothing is written to ROMS yet (that is M6); each linked row only shows what auto-fill *would* write.

- **Reading ROMS:**
  - `services/romsClient.js` pages `GET {ROMS_API_URL}/api/integration/refs/:resource` with ROMS's `INTEGRATION_TOKEN` (ROMS `feature/RAMS`, M1). It's read-only.
  - `services/romsRefs.js` keeps a copy in `roms_*` (migration 011), writing only the rows that changed.
  - An answer with no POs where RAMS holds some is refused, keeping the copy.
  - With `ROMS_API_URL` / `ROMS_INTEGRATION_TOKEN` unset, matching uses the last copy.
- **The engine:**
  - `matching/engine.js` is pure, ported from the Phase 0 analyzer: Buyer's Order No first, then the Bill No (whole or serial), the tie-breaks, and the checks.
  - Every step is a setting in `match_settings` (migration 012, `services/matchSettings.js`), along with `match_vendors` and `party_ledgers`.
  - **A person's decision always wins:** `doc_links` rows that are `confirmed` or `rejected`.
  - `matching/reasons.js` lists every code the engine emits; the frontend words each one.
- **A run** (`matching/run.js`):
  1. one at a time; a run older than 10 minutes is closed as failed
  2. read ROMS
  3. load (`matching/load.js`)
  4. match
  5. write what changed (`matching/write.js`): `match_results`, auto `doc_links`, and the party-ledger suggestions
- **When it runs:**
  - The heartbeat reply asks the Connector for a match (`commands: [{ type: 'match' }]`) when none has run, when Tally changed since the last one, or every `run_every_minutes` in office hours. The Connector then calls `POST /api/agent/match`.
  - People press **Match now** (`POST /api/matching/run`).
  - A rule, vendor, party-ledger or decision change re-matches on the stored copy at once.
  - `npm run match` does one run from the command line, against whatever `.env` points at.
- **The API (`/api/matching`):**
  - `summary`, `results` (+ `/:kind/:id`), `vouchers` (search)
  - `run`
  - `results/:kind/:id/confirm|pick|reject|undo`
  - `settings` (GET/PUT), `settings/reset`, `preview` (the draft rules' effect, nothing written)
  - `vendors`, `voucher-types`
  - `party-ledgers` (+ `accept-suggestions`)
  - Each route takes the `matching.*` permission it needs (`routes/matching.routes.js`).

## On Vercel

RAMS is **one Vercel project** using [Services](https://vercel.com/docs/services) (Beta), configured in the root `vercel.json`. This API is the `backend` service, served on `/api/*`, and the web app is the `frontend` service on everything else, all on one domain. The API runs on Vercel's zero-config Express support, using `app.js`, which exports the app. `server.js` is for local runs only.

The project's environment variables are `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and `NODE_ENV=production`, plus `RAMS_SYNC_FROM` if the default sync start isn't wanted, and `ROMS_API_URL` / `ROMS_INTEGRATION_TOKEN` for matching. Changing a variable only takes effect after a redeploy. **Vercel doesn't run migrations:** run `npm run migrate` against the database first, after checking `.env`.

`FRONTEND_URL` is optional. The API always accepts requests from its own domain, which covers production, previews and per-deployment URLs. List other origins in `FRONTEND_URL` (comma-separated) only when they need to call it, for example `http://localhost:5174` in development. Any other origin gets a 403.

## Tests

```bash
npm test                      # jest; runs serially against tests/.tmp/test.db
```

`.env.test` points at a local SQLite file, so tests can never reach a real database. The suites must run one at a time, because they share that file; `jest.config.js` sets `maxWorkers: 1`.

## How it differs from ROMS

| | ROMS | RAMS |
|---|---|---|
| Roles | Admin, Owner, Employee + POC tags | **Admin, Owner, Accountant, Viewer** (`middleware/rbac.js` ↔ `frontend/src/utils/roles.js` ↔ migration 002) |
| Forced password change | the UI redirects | **the API enforces it**: only `/auth/me`, `/auth/change-password` and `/auth/logout` answer until it's done |
| Ending a session | refresh tokens can't be revoked | `users.token_version` in the refresh token: a password change, admin reset, role change or deactivation ends that user's sessions |
| Removing a user | delete | **deactivate**, so the audit trail keeps their name |
| First accounts | seed with fixed passwords, reset on every run | `bootstrap-admin` from environment variables, once |
| Audit retention | user history purged after 31 days | everything kept |
| MFA | optional TOTP | not yet (deferred 2026-10-04) |

House rules carried over from ROMS:
- Every response is `{ message }` on error.
- Lists use `{ rows, total, page, page_size }`.
- Every mutation writes its audit row inside the same transaction (`logAction({ client: tx, … })`).
- Migrations are append-only and are split on `;`, so a semicolon may never appear inside a comment.
