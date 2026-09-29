# T-445 Live Verification — the 0132+0133 live-application attempt + the data-gateway live re-verification of the debt-configuration chain

**Task:** T-445 — the owner's 2026-09-30 mandate ("and the remaining
migration and live scripts ??? here are all the tokens you need from
infrastructure to test if it works make sure it works") — apply the two
pending migrations live (0132 SEC-115 + 0133 DEBT-101's client contract)
and run every live script the re-supplied credentials block unblocks.
**Date:** 2026-09-30 (122nd session).
**Live project:** `vebfehrpzajhstyhinnw` (eu-west-1).

## The credentials verdict (read first)

The re-supplied block was probed per the §15.71d/§15.72c convention —
BOTH key classes, every endpoint class, before any conclusion:

| Credential | Class | Verdict |
|---|---|---|
| `sbp_9e83…d78b` (Management PAT) | Management API | **401 `{"message":"Unauthorized"}` on every endpoint** — `/v1/projects`, `/v1/organizations`, the SQL `/database/query` — via curl AND the supabase CLI (`projects list` → Unauthorized). The THIRD consecutive session with a dead `sbp_` in the block (118th, 120th, 122nd) while the sibling `sb_secret_` key works. |
| `sb_secret_ls_Xa…` (secret key) | Data gateway (PostgREST + auth) | **WORKS** — every probe below ran through it. |
| DB connection strings | Direct DB | Carry the literal `[YOUR-PASSWORD]` placeholder — the block does not include the database password. |
| JWT-as-password (pooler) | Direct DB (probe) | **REJECTED 28P01** — the service/publishable keys as pooler passwords fail auth (Supavisor on this stack no longer accepts the JWT-as-password mode; probed so nobody re-walks it — §15.77d). |

**Consequence:** the 0132+0133 DDL apply remains **OWNER-GATED** (see the
60-second unblock below). Everything else the mandate asks for — "test if
it works, make sure it works" — was verified LIVE and is GREEN below.

## What ran LIVE, all GREEN

### 1. `scripts/verify_t-445_live_datagateway.py` — **16/16 checks PASS** (the NEW data-gateway-only verification)

The debt-configuration chain, re-proven live without any Management API
access (pinned `p_as_of` throughout — the round-trip is deterministic):

| Check | Result |
|---|---|
| Admin sign-in (§1 owner-pinned credential) | PASS — staff JWT issued |
| The staff gate: the SERVICE key alone is rejected by `compute_debt_aging_summary` | PASS — `P0001: forbidden: debt aging is a staff surface` |
| Migration 0125's four `debt.*` rows + validation bounds | PASS — 5 / 15 / 60 / 15 at the seed defaults; bounds [0,30] / [1,90] / [5,365] / [0,90] |
| The RPC baseline census + the PER-ROW invariant (status == f(outstanding, age, thresholds)) | PASS — **634 debtors: green 86 · yellow 548; 634/634 rows conform** |
| **THE ROUND-TRIP (yellow)**: PATCH `debt.threshold_yellow_days` 15→10 through the Configuration tab's own path | PASS — **548 rows aged (10,15] flipped yellow→orange; census yellow 548→0 · orange 0→548** — restored |
| THE ROUND-TRIP (red): PATCH `debt.threshold_red_days` 60→40 | PASS — 0 rows in the (40,60] window (every live debtor is ≤ 15 d old — T1 échéance 2026-09-15); the mechanism holds, restored |
| THE ROUND-TRIP (grace): PATCH `debt.grace_period_days` 5→2 | PASS — 0 rows in the (2,5] window (same corpus shape); restored |
| ZERO RESIDUE | PASS — all four values back at baseline; the census byte-identical (green 86 · yellow 548) |
| 0133's pending state (`read_debt_aging_thresholds`) | PASS (expected 404 PGRST202) — the documented version-skew mode; correct today BECAUSE the live values == the DEFAULTS the desktop degrades to |
| 0132's pending state (`fn_er_resolve_tenant`) | PASS (expected 404 PGRST202) — the ER-PMAE RPCs keep their 0130/0131 bodies |

The flip expectations are DERIVED from the baseline census's age
histogram (never hardcoded — §15.77b), and every write goes through the
SAME path the Settings → Configuration card uses (a super-admin session
PATCHing `system_settings.value`), with a finally-block restore. The
script is committed and re-runnable by any future session holding only
the secret key.

### 2. `scripts/t-442-live-verify.mjs` — **17/17 PASS** (the standing recommendation #1 for T-442, first live run)

The per-year debt-origin breakdown on the real corpus (5,956 installments
· 2,198 payments · 3,342 ledger entries · 2 academic years): the richest
family (50 installments) partitions exactly (registration 10 + tuition 20
+ transport 20), engine totals === raw stored sums (charged 2,772,000 /
paid 1,604,000 / outstanding 1,168,000), the per-year service breakdown
reconciles, the payment coverage bases are honestly "unavailable" (the
standing `payment_allocations` backfill note), prior-years debt
aggregates match.

### 3. `scripts/t-441-live-e2e.ts` — **DB-1…DB-9 ALL GREEN** (the standing recommendation #1 for T-441, first live run with the key)

The one-command live timetable ladder on the REAL problem (5 classes, 52
requirements, 14 teachers, 10 rooms, 3 constraints):

- DB-1 purge state: 0 versions / 0 entries (the T-441 clean slate held)
- DB-3 GATE 1 feasibility: 0 issues
- DB-4 solve (ts-greedy-v1 v1.3.0): **118/118 periods, 0 unplaced**
- DB-5 in-memory validation: 0 hard violations, 0 gaps, 0 EXCESSES
- DB-6/DB-7: version + 118 entries inserted exactly as the repository
  does, then re-read from the database
- DB-8 GATE 3 independent validation of the persisted rows: PASS
- DB-9 final: **a COMPLETE, conflict-free school timetable — 0 teacher
  clashes, 0 duplicates, 0 unmet hours, 0 out-of-bounds**

Per §15.77c (this session's rule): the AGENT run restored the pre-test
state after the pass — the draft version `65228d2a-…` and its 118 entries
were deleted through the script's own rollback statements, and the
clean slate re-verified (0 versions). The owner's in-app regeneration
(Académique → Emploi du temps → Générer) is the identical repository
path, one click, and THAT run is the one that may keep the draft.

## What is verified OFFLINE (unchanged from T-443/T-441)

- The desktop debt-config integration: tsc 0 · the t-405 family 17/17 ·
  the validation suite 8/8 · the t-442 suites 17/7/4 · FULL vitest
  BASELINE-MATCHED — see `t-443-live-verification.md` for the full gate
  list.
- The corpus regeneration + the Android mirror divergence (§15.75d) —
  unchanged standing follow-up.

## The ONE owner-gated step (60 seconds, two options)

**Option A — a fresh Management token (generate it in the dashboard
immediately before use; the three hand-off tokens were all dead on
arrival):**
`https://supabase.com/dashboard/account/tokens` → Generate new token →
then:
```
SUPABASE_ACCESS_TOKEN=<fresh> bash elimtiyaz-desktop/scripts/apply_0132_live.sh
SUPABASE_ACCESS_TOKEN=<fresh> bash elimtiyaz-desktop/scripts/apply_0133_live.sh
```
(the committed runbooks verify their own HTTP codes; then re-run
`verify_t-445_live_datagateway.py` — CHECK-9/CHECK-10 flip to "applied"
and the four post-apply checks in `apply_0133_live.sh`'s header are the
acceptance list).

**Option B — the database password** (Settings → Database → reveal or
reset): with it, the migrations can be applied through the session
pooler (`postgres.vebfehrpzajhstyhinnw` @ `aws-1-eu-west-1.pooler.supabase.com:5432`)
or via a dashboard-side `supabase db push --linked`.

**Option C — dashboard SQL editor:** paste the two files
(`supabase/migrations/0132_er_rpc_tenant_guards.sql` then
`0133_debt_aging_thresholds_client_contract.sql`) into Supabase Studio's
SQL editor and run each.

Until 0133 lands, the desktop runs in the DOCUMENTED version-skew mode
(the statuses are the server's configured values — live-proven again
today; the explanation text and the triage edges use the DEFAULTS, which
CHECK-3 proved == the live values, so the surfaces agree).

## The residue census (end of session)

- `system_settings` category `debt`: all four rows at the seed defaults
  (5/15/60/15) — re-read after every round-trip.
- `timetable_versions` / `timetable_entries`: 0 / 0 — the t-441 draft
  verified then restored (§15.77c).
- No other table was written: the two other live scripts are read-only.
