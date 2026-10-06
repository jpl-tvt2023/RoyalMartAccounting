# RAMS go-live runbook (M8)

This takes RAMS from the test setup to production, step by step. It also covers installing the Connector on the office PC and the trial weeks before auto-fill writes to ROMS on its own.

**Who does what:**
- **You** do every step that touches production, the office PC or a secret.
- **I** (or whoever maintains RAMS) do the steps marked *maintainer*. None of them changes production until you've done your part.

**What RAMS changes in production:**
- **Tally:** nothing. It is only read.
- **ROMS:** one new system user (migration 094), and, once a field's auto-fill is switched on, that field's values.

---

## 0. Open decisions to settle first

1. **S100: which Bill No should ROMS show?** It says `758` today.
   - Invoice 758 was fully returned by CN 841 (19 Aug 2026) and re-invoiced as `1193/RM/26-27` (12 Sep), against the re-issued PO.
   - A person decides. RAMS won't change it by itself, because 758 isn't a form of 1193.
   - The choice is made either in ROMS, or in RAMS: pick 1193 on Match review, then **Write Tally's number** on Auto-fill.
2. **S292: staff fix the Bill No "1819" in ROMS.** The client confirmed it is a typo for 1219.
   - In RAMS the link is already confirmed. The row is under *Needs a person* on Auto-fill, where an Admin can write `1219/RM/26-27` instead.
3. **Rotate the RAMS Turso token.** The test database's token was once pasted into a chat.
   - Make a new one in Turso.
   - Put it in Vercel (RAMS project → Environment Variables → `TURSO_AUTH_TOKEN`) and in `backend/.env`.
   - Redeploy.
4. **The Flipkart / Amazon stock-transfer linking key** is still open.
   - Until it's decided, those vendors stay *Stock transfer — not matched* (Matching rules → Vendors).
5. **Vercel region (done 2026-10-06):** both projects are set to Mumbai (bom1).
   - It takes effect on each project's next production deploy.
   - Redeploy RAMS production once (Vercel → royalmartaccounting → Deployments → top row → Redeploy) to get it now.

## 1. The production database for RAMS (you, then maintainer)

1. **You:** create the Turso database `royalmart-rams` in the `royalmart` org, region `aws-ap-south-1` (Mumbai), and make a token for it.
2. **Maintainer:**
   1. In `backend/.env`, set `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` to it. **Check the URL twice:** `npm run migrate` writes to whatever it points at.
   2. `npm run migrate`, which applies 001–014.
   3. `RAMS_ADMIN_USERNAME=… RAMS_ADMIN_PASSWORD='…' npm run bootstrap-admin`. It creates the first Admin, who changes the password at first sign-in.
   4. `npm run agent-token -- --name "Office PC"`. It prints the Connector token **once**; hand it to you privately.
3. **You:** in Vercel (RAMS project → Environment Variables, **Production**):
   - Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to the production database.
   - Set new `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`. This signs everyone out of the test setup.
   - Redeploy.

## 2. ROMS production: switch the integration on (you, maintainer helps)

1. **Maintainer**, with your OK: apply ROMS migration **094** to the ROMS production database. It only adds the `tally-sync` system user, and nobody can sign in as it. First check that `Royal Mart Portal/backend/.env` points at production.
2. **You:** generate a long random token. In Vercel (ROMS project `royalmartportal` → Environment Variables, **Production**), set `INTEGRATION_TOKEN` to it, then redeploy ROMS production.
3. **You:** in the RAMS project (Production), set:
   - `ROMS_API_URL` = `https://api.theroyalmart.co.in/api`
   - `ROMS_INTEGRATION_TOKEN` = the same token

   Then redeploy RAMS.
4. **Check:** RAMS → Matching → Match review → **Match now**. It should say "ROMS read", with counts similar to the test setup.

Until step 2 is done, ROMS production answers RAMS with "The integration is not configured", and nothing can be read or written.

## 3. The Connector on the office PC (you, at the PC)

1. Install **Node.js 20 LTS** from nodejs.org, if it isn't there.
2. **Maintainer:** `npm run package` in `agent/`, then copy the folder `agent/dist/rams-connector` to the office PC (USB stick or shared drive).
3. **You:** on the office PC, signed in as the Windows user who runs Tally:
   1. In TallyPrime: F1 → Settings → Connectivity. Set it to act as *Server* (or *Both*), port **9000**.
   2. Open the three companies (MH, HR, WB) in Tally.
   3. In the copied folder, right-click **install-service.ps1** → *Run with PowerShell*. Or run, in PowerShell:
      ```
      powershell -ExecutionPolicy Bypass -File .\install-service.ps1
      ```
      - The first time, it opens `C:\ProgramData\RAMS\connector.json`. Paste in the Connector token (from step 1), set `apiUrl` to the production RAMS address, save, and run the script again.
      - It copies itself to `C:\RAMS\Connector`, adds the task **RAMS Connector** (it starts when you sign in, and restarts if it stops) and starts it.
   4. Check it with `C:\RAMS\Connector\rams-connector.cmd status`. Every company should show, and RAMS → Reports → **Sync health** should say *Connector online*.
4. **In RAMS:** Admin → Tally companies. Turn sync **on** for MH, HR and WB. The first backfill runs after office hours (about 5 minutes for MH).
5. **Stop the dev PC's Connector**, so two Connectors don't sync the same books.

Logs are in `C:\ProgramData\RAMS\logs`. To remove the Connector, run `uninstall-service.ps1`.

## 4. The trial weeks (auto-fill)

Each step is a setting on **Matching → Auto-fill**, not a deploy. It can be put back to **Off** at any moment.

| Week | Bill No + Bill Date | CN No + CN Date | What to watch |
|---|---|---|---|
| 1 | **Preview** | **Preview** | *To write*: does each change look right? *Refused by ROMS*: anything unexpected? |
| 2 | **Ask first**: approve a few rows, check them in ROMS (Builty page, history says "Tally Sync"), then **Approve all** | Preview | ROMS's Builty and RTV pages show the new numbers; nothing else changed |
| 3 | **Automatic** | **Ask first**, then **Approve all** | Written to ROMS each hour; Exceptions stays short |
| 4 | Automatic | **Automatic** | — |

**Before week 1:** on Roles & permissions, decide who may approve (default: Accountants) and who may switch modes (default: Admin and Owner).

## 5. After go-live

- **Daily:** Reports → **Exceptions**, and Matching → Match review → *Needs review*.
- **Weekly:** Reports → **Receivables**. Map any head-office ledgers that show under *Not known* on Matching → Party ledgers.
- **If something looks old:** Reports → **Sync health**. Use **Sync now** for a company.
- **To stop all writing into ROMS at once:** set both auto-fill fields to Off. Or remove `INTEGRATION_TOKEN` from ROMS and redeploy.
