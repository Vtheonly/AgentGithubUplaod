# T-614 — The cutover runbook: ONE ordered page for the owner's window (relocation onto `gvuvibcsfjhwcjikgxql` + the reconnect)

**Session 40, 2026-11-22 · the owner-directed relocation-reconnect lane · supersedes nothing — this page BINDS the existing authorities (EXECUTION-PLAN §12/§16 T-614 · RELOAD-GUIDE §A.0–§A.7 · the charter · OPS-021) into the one ordered sequence the operator runs at the window.**

**Standing state (2026-11-22):** every code-side precondition is GREEN — the charter Rule-3 from-scratch validation of the full chain (P1: `t-a2-chain-from-scratch-validation-2026-11-22.md`), the preflight of record re-pinned to the measured full-chain census (P2), the desktop reconnect tool (P3: `scripts/prepare-cutover-profile.mjs`), the website cutover-commit generator (P4: the website repo's `scripts/prepare-cutover-commit.mjs`). The live-side steps wait on the owner's window: **the Vercel access/PAT + the §A.0.5 credential set + D-21 (the Google OAuth client's callback)** — with those three, this page is the whole run.

---

## The credential checklist (§A.0.5 — collect BEFORE the window)

| # | Credential | Used by step | Where it comes from |
|---|---|---|---|
| C1 | `SUPABASE_ACCESS_TOKEN` (fresh management token) | 2, 3, 4 | supabase.com → Account → Access Tokens |
| C2 | The NEW project's **publishable** key (`sb_publishable_…`) | 6, 7, 8 | NEW project → Settings → API |
| C3 | The NEW project's **database password** (created at project creation) | 2 (CLI link) | the owner's record |
| C4 | The Vercel PAT | 8 | vercel.com → Account Settings → Tokens |
| C5 | The EF secrets set: `GROQ_API_KEY` `OPENROUTER_API_KEY` `FIREBASE_PROJECT_ID` `FIREBASE_SERVICE_ACCOUNT_JSON` `CRON_SECRET` `SUPABASE_AUTH_GOOGLE_CLIENT_ID` `SUPABASE_AUTH_GOOGLE_SECRET` | 4 | the owner's secret store (§A.2.3) |
| C6 | D-21: the Google OAuth client with `https://api.elimtiyaz.dz/auth/v1/callback` (+ the portal origin in the authorized redirect set) | 5 | Google Cloud Console (the owner's single manual step — OPS-019) |

## The sequence

### Step 0 — The freeze + the backup (§A.0.3/§A.0.4)
Announce the window; freeze writes on the old project; take the local canonical backup on the primary client (Settings → backup — the rollback artifact; in Path 2, a data source).

### Step 1 — The fresh validation (the charter gate; ~4 s)
```
node /home/z/my-project/pglite-validation/run-validation.mjs
```
ALL axes must be GREEN vs `docs/recovery/t-a2-chain-from-scratch-validation-2026-11-22.md`. **Any chain append after Session 40 re-runs this FIRST — the apply is charter-gated on a fresh pass.**

### Step 2 — The §A.2 apply (schema onto the new project)
```
cd elimtiyaz-desktop
npx supabase login                 # paste C1
npx supabase link --project-ref gvuvibcsfjhwcjikgxql
npx supabase db push               # --dry-run first if desired
```
Then the §A.2 verification-gate SQL (all in the RELOAD-GUIDE): 5 migration rows / 99 tables / 14 views / 5 matviews / **157 functions** (the P2-corrected number) / the 54001 helper shape / 264 policies / the 5 `mv_*` names / 11 buckets.

### Step 3 — The preflight of record (T-575)
```
node scripts/preflight-target.mjs --project-ref gvuvibcsfjhwcjikgxql   # C1 in env
```
Every census axis GREEN (the constants are P2-corrected and charter-measured).

### Step 4 — The Edge Functions + secrets (§A.2.3)
Deploy the 15 EFs (the exact list in §A.2 — NOT export-data/generate-receipt-pdf, the ARCH-046 stale entries), then `npx supabase secrets set` with C5.

### Step 5 — The auth config (§A.7.3, dashboard-side)
site_url → the portal's final URL; the redirect allow-list gains `https://elimtiyaz-website.vercel.app`; the Google provider with the D-21 client (C6).

### Step 6 — The data lane (Path 1 if the cap lifts; Path 2 otherwise)
Path 1 (§A.3): the one-time cap-lift window → export from old → FK-ordered reload → delta pass. Path 2 (§A.4): the emergency reload from local state. **The auth users ride T-574's tooling** (`scripts/relocate-auth.mjs` — the UUID-preserving export/import pair + the email-match remap + the password-reset flow; the S34 card is the manual). Then `scripts/verify_t-376.sql` 12/12 (the functional-parity proof — needs the reloaded admin) + the authenticated REST smoke (`GET /rest/v1/tenants?select=id&limit=1` → 200).

### Step 7 — The desktop reconnect (P3's tool; NO rebuild needed)
```
SUPABASE_TARGET_URL=https://gvuvibcsfjhwcjikgxql.supabase.co \
SUPABASE_TARGET_PUBLISHABLE_KEY=<C2> \
node scripts/prepare-cutover-profile.mjs            # dry-run first
… node scripts/prepare-cutover-profile.mjs --write --userData "<the client's userData dir>"
```
(the per-OS userData map prints with the dry-run; the previous profile is preserved as `.bak` — the rollback artifact). Relaunch the app → the profile GOVERNS in every build mode (T-573).

### Step 8 — The website cutover (P4's tool + §A.7)
In the **elimtiyaz-website** repo:
```
SUPABASE_TARGET_URL=https://gvuvibcsfjhwcjikgxql.supabase.co \
SUPABASE_TARGET_PUBLISHABLE_KEY=<C2> \
node scripts/prepare-cutover-commit.mjs             # the 7-edit dry-run
… node scripts/prepare-cutover-commit.mjs --apply
npm run test        # the re-pinned t-516/t-096/t-107 gates must be green
git commit + push   # per the repo standard
```
Then the **Vercel** half (C4): EITHER set the project env vars (`NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`, production + preview) OR rely on the re-pinned committed defaults — **exactly ONE mechanism, never both half-done** — then **REDEPLOY (mandatory: `NEXT_PUBLIC_*` freezes into the bundle at build time)**.

### Step 9 — The smokes
The §A.6 checklist (the desktop: login → the dashboard RPCs → the ledger) + the §A.7.6 portal smoke (login → bootstrap → finance → activation → timetable → documents → notifications/chat → realtime/FCM).

### Rollback (any step)
Desktop: restore the `.bak` profile (or delete it — the factory default governs). Website: revert the cutover commit + redeploy. Data: the Step-0 backup. The old project stays untouched until the owner retires it (OPS-020's no-touch rule).

---

**What this page deliberately is NOT:** a new authority — the runbook's §A.x steps remain the source; this page only binds them in execution order with the Session-40 tools named at their exact slots. OPS-015/G2 locks lift ONLY for this window's steps 2–9 (the owner's actions); every step before them was already G2-independent and is DONE.
