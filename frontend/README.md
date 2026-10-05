# RAMS frontend

The RAMS web app: React 19, Vite, Tailwind v4 (CSS-first) and react-router 7. It uses the ROMS layout and components with RAMS's own colours, so the two apps are never mistaken for each other.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:5174 — proxies /api to the backend on 5001
npm run build
npm test           # vitest
npm run lint       # must stay clean; CI runs it
```

Start the backend first (see `../backend/README.md`). RAMS has its own sign-in, separate from ROMS.

On Vercel this is the `frontend` service in the root `vercel.json`. That file also holds the page-refresh rule (unknown paths serve `index.html`) and the security headers (CSP and others). The API is on the same domain under `/api`, so the app calls it as `/api` and needs no `VITE_API_BASE_URL`.

## Conventions

- **Colours are `@theme` tokens** in `src/index.css`: `bg-brand`, `hover:bg-brand-hover`, `bg-brand-surface`, `text-danger`, `text-brand-accent`. Use the tokens rather than raw hex values.
- **`src/App.jsx` is the single route table.** A new route also needs a `TitleManager` entry, and a `NAV` entry in `src/utils/roles.js` if it belongs in the top bar. Each page wraps itself in `<AppShell>`.
- **Who sees what:**
  - A NAV entry or route takes fixed `roles`, or a `permission` (a key, or a list where any one is enough), which Admins and Owners set per role on *Admin → Roles & permissions*.
  - In a page, `useAuth().can(key)` hides a button the user can't use. The API refuses it anyway.
  - The keys are `PERM` in `utils/roles.js`; the catalog itself comes from the API.
- **Every screen ships with its Help:**
  - Its user-guide flows and FAQ go in `src/help/*.js`, as data shown on `/help`.
  - The page links to its section with `<HelpLink section="…" />`.
  - `utils/__tests__/help.test.js` fails if a NAV page has no section, or a Help link points nowhere.
  - Write for office staff: plain words, numbered steps, and who can do it.
- **Matching codes are worded in one place,** `utils/matchReasons.js`. `utils/__tests__/matchReasons.test.js` checks it against `backend/src/matching/reasons.js`.
- **`src/api/axios.js` is the only HTTP client.** It attaches the token, single-flights the 401 refresh, and sends a forced password change to `/force-reset`. API modules return the unwrapped payload.
- **List pages follow the ROMS "standard list page".** Filters apply on Search/Enter (not live), errors are toasts, and filters persist per tab via `useSessionState` (prefix `rams:`), with page size kept per browser. `pages/admin/AuditLog.jsx` is the example.
- **Mirrored with the backend:**
  - `utils/roles.js` ↔ `backend/src/middleware/rbac.js` (and `PERM` ↔ `backend/src/services/permissions.js`)
  - `utils/passwordPolicy.js` ↔ `backend/src/services/passwordPolicy.js`

  Tests on both sides pin the same values.
