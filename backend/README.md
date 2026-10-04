# RAMS backend

The RAMS API: Node 20, Express 5 (CommonJS), `@libsql/client` with raw SQL, the same stack and conventions as the ROMS backend, copied rather than shared. It serves `/api/auth`, `/api/users`, `/api/audit-logs` and `/api/health` so far.

## Run it locally

```bash
npm install
cp .env.example .env          # then fill in the two JWT secrets (see the comments)
npm run migrate               # check which database .env points at first
RAMS_ADMIN_USERNAME=you RAMS_ADMIN_PASSWORD='Choose#One1' npm run bootstrap-admin
npm run dev                   # http://localhost:5001  (ROMS uses 5000)
```

- **`TURSO_DATABASE_URL`** is `file:./local.db` by default. The RAMS test database is `libsql://royalmart-rams-test-royalmart.aws-ap-south-1.turso.io`. `npm run migrate` applies to whatever this points at, so check it first.
- **`npm run bootstrap-admin`** creates the first Admin once, only when no active Admin exists. It never resets anyone's password. That Admin must change the password at first sign-in, then creates everyone else from the Users page.

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
