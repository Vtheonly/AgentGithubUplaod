# T-433 — The Purge + WB2 Re-Import: Verification Record (112th session, 2026-09-28)

> **Mode:** the owner's direct mandate — "purge everything first and remove all existing data, then use the WB2 Excel file" — with the credentials supplied in-session (the sbp_ access token + the default sb_secret service key, both consumed from ENV, never persisted). Every probe below is re-runnable evidence. The purge phase's EXECUTE step is the ADR-27 "VERIFIED gate" the owner triggers — this session the owner's explicit mandate IS the trigger (recorded verbatim in the task-registry entry).

## Phase 0 — the session-opening probes (read-only)

| Check | Result |
|---|---|
| Live migration head | **0124** — 0125 ABSENT from the registry (ARCH-016) |
| 0125 artifacts | all live (4 debt settings · `debt_aging_thresholds()` · the 4-tier summary CASE) |
| Domain census (pre-purge) | parents 741 · students 1,137 (all alive) · installments 5,956 (all imp-) · payments 2,198 · ledger 3,342 |
| Accounts | user_profiles 1 · auth.users 1 (the owner admin) · backup_archives 0 |
| Audit trail | 35,374 entries; last foreign write 2026-09-27 17:11:59 UTC (the concurrent agent's re-import no-op — two `import.run_started` + `student.update` ×2 + `import.run_completed`, actor-less = the headless re-import script's shape) |
| Purge surface | `purge_student_parent_domain(text, boolean, uuid)` present (0120/0121) |
| Tenant | single: `00000000-0000-0000-0000-000000000001 : El-Imtiyaz Boumerdès` |
| Academic catalog (purge's preserved set) | 1 year (2026-2027) · 16 subjects · 5 classes — intact |

## Phase A — the 0125 chain-head reconciliation (ARCH-016)

`scripts/apply_chain_reconciliation_0125.sh` (committed this session; env-token convention):

| Step | Evidence |
|---|---|
| Pre-check | `v0125_rows=0`, head `0124 > 0123 > 0121`, `debt_rows=4`, `thresholds_fn=1` |
| Apply (atomic) | HTTP **201** — the idempotent 0125 body + the ON CONFLICT registration in ONE transaction |
| Post-check | `v0125_rows=1`, head **`0125 > 0124 > 0123`**, artifacts unchanged (4/1) |

## Phase B — migration 0126 applied LIVE + verify_t-432.sql ALL GREEN

`apply_0126_live.sh` (the 111th session's standing owner-gated top item — the token supplied this session): HTTP **201**; the post-probe head: **`0126 > 0125 > 0124 > 0123`**.

**verify_t-432.sql: 15/15 GREEN** (after this session repaired THREE never-run-layer defects in the script itself — see the discoveries below):

| Check | ok | Detail |
|---|---|---|
| C1-initplan-hoist | ✅ | unhoisted=0 (15/15 policies carry the normalized `( SELECT …` scalar-subquery shape) |
| C1-policies-present | ✅ | missing=0 |
| C1-tenant-gate-kept | ✅ | lost=0 |
| C2-materialized-ay | ✅ | the `WITH ay AS` CTE live · zero `public.attribute_academic_year(` invocations (len=11465) |
| C3-obligation-attribution-parity | ✅ | mismatches=0 (every obligation's academicYear == the ORIGINAL helper's answer) |
| C3-origin-year-parity | ✅ | mismatches=0 |
| C4-outstanding-parity | ✅ | rpc=194,230,700.00 = indep=194,230,700.00 (the T-425 acceptance value) |
| C5-indexes-present | ✅ | n=3 (students tenant+parent · attendance tenant+date · expense_tickets tenant+submitted) |
| C6-wave-1/2/3 | ✅ | the reconciliation pair per wave (wave-1: tuition=75 % pooled=77 %, rows=1606, families=741) |
| C7-timings | ✅ | aging-summary **~100 ms** (the timeout-killing class pre-0126) · parents-count 13.6 ms · payments-month 4.7 ms · students-count 5.1 ms |

### The three verify-script defects this session repaired (the §15.60a never-run-layer class, third occurrence)

The 111th session authored verify_t-432.sql while 0126 was owner-gated (NOT applied) — the script was therefore never executed against a hoisted live DB before this session. Three defects, all false-negative-or-fatal, all found by the first live run:

1. **`coalesce(tuition_pct, 'n/a')` (C6)** — `coalesce(numeric, text)` resolves to numeric and `'n/a'::numeric` fails at PLAN time: the DO block dies on EVERY run. Fixed: `coalesce(tuition_pct::text, 'n/a')`.
2. **The C7 impersonation block lacked the §15.27 temp-table GRANT** — `set local role authenticated` then INSERT into `t432_results` → `permission denied for table pg_temp_30.t432_results`. Fixed: `GRANT INSERT, SELECT ON t432_results TO authenticated` right after the CREATE.
3. **Normalization-fragile patterns (C1/C2)** — `pg_policies.qual` carries the PARSED expression: the file's `(select public.current_tenant_id()` normalizes to `( SELECT current_tenant_id()` (keyword uppercased, schema prefix stripped); `pg_get_functiondef` uppercases `with ay as` → `WITH ay AS` and the body's COMMENTS legitimately mention `attribute_academic_year`. The first-run C1/C2 checks reported false FAILs against a correct live state. Fixed: `( SELECT ` marker for C1; `~* 'with ay as'` + `position('public.attribute_academic_year(' …) = 0` for C2 (the comments never carry the schema prefix — real invocations always did).

**Lesson (extends §15.60a):** a verify script authored for an owner-gated migration is NEVER-RUN until the owner gate opens — its patterns are hypotheses, not checks. The first live run is itself an audit event: expect normalization surprises (parsed-expression vs file-text shapes) and repair the CHECK, not the state, when the catalog census contradicts the pattern.

## Phase C — the purge (the owner's mandate: remove ALL existing data)

Driven through the REAL UI path (ADR-027): the GoTrue admin password grant → the PostgREST RPC call (the exact path the Settings "Zone de danger" card takes; the has_role('super_admin') gate resolves the signed-in owner; the audit entry attributes the run to the admin's email). Script: `elimtiyaz-desktop/scripts/t-433-purge-execute.mjs` (committed; dry-run default, --execute gated; head+exact censuses).

| Step | Evidence |
|---|---|
| Dry-run | HTTP 200 `{ok:true, mode:dry_run, total:14114}` — parents 741 · students 1,137 · installments 5,956 · payments 2,198 · ledger 3,342 · activation_codes 740 · payments_allocations/adjustments/discounts/service_enrollments/grades/attendance 0 |
| EXECUTE | HTTP 200 `{ok:true, mode:executed, total:14114}` — audit_entry_id `93adcc9a-ffdc-4e2e-8b89-872fdeb7708b` |
| Post-purge census | parents 0 · students 0 · installments 0 · payments 0 · ledger 0 · activation_codes 0 — **every domain table ZERO** |
| The no-interference contract | tenants 1 · academic_years 1 · academic_levels 14 · subjects 16 · classes 5 · personnel 14 · backup_archives 0 (untouched) · user_profiles 1 (the owner admin — the staff-role guard) |
| The audit growth 35,374 → 37,253 (+1,879) | 1,878 per-row `parent.delete`/`student.delete` entries (741+1,137 — the append-only triggers) + 1 `system.purge_student_parent_domain` entry — the purge is fully attributed |
| The ADR-027 boundary residue | account_approval_requests 25 + notifications 20 survive BY DESIGN (the 0121 boundary: requests/accounts NOT claimed by any purged parent/student row stay outside the blast radius — genuinely pre-parent data; documented, not a defect) |

## Phase D — the fresh WB2 import (the corrected driver)

**The discovery (the first fresh-import run):** the payments flush failed deterministically — `22P02 invalid input syntax for type uuid: "t-425-remediation"`. The T-425 driver passes a free-text actor string; the payments table's `collected_by` column is uuid-typed. The T-425 session's re-import never exercised the payments flush with FRESH payments (its 2,198 payments already existed → the payments leg was preflight-skipped) — the never-run-layer class (§15.60a), this time in a committed driver script. Registered as IMPORT-120; the corrected driver is `scripts/t-433-live-reimport.ts` (the SAME ImportEngine + the SAME repositories + the SAME audit sink — only the actor identity seam changed: `ACTOR_PROFILE_ID` = the owner admin's user_profiles.id, fail-closed on a non-uuid value).

**The run (after the sanctioned 0124 clear of the interrupted attempt's installments):**
- `run_mukfqlcy_7750d1` — **91,134 ms** · 1,141 rows read · 1,139 updated (the existing corpus' upsert no-ops) · 2 skipped · 0 rejected · 73 warnings · `import.run_finished` written (the §15.61e failure signature absent)
- The full corpus landed: parents 741 · students 1,137 · installments 5,956 · payments 2,198 (ALL with `collected_by` = the admin profile — the corrected seam) · ledger 3,342 · **Encaissé 162,713,000 DZD (the T-423 acceptance value EXACTLY)**

## Phase E — the post-import verification (ALL GREEN)

**The Excel oracle (`scripts/t-425-live-verify.mjs`) — identical to the T-425 documented result:**
- 1,130 of 1,138 per-student rows match the workbook's OWN Q column exactly (±1 DZD)
- 7 divergences — ALL the documented school hand-overrides (METAH NADA, DAHMANI FARES, LAOUAR ANES, AITHAMOUDA ANAIS, HEROUA MOSADEK, TASLGHOUA NAILA, BERDAI MAROUAN) · 1 no-live-student row (the known workbook artifact)
- 0 overpaid rows · Encaissé 162,713,000 · Créances 194,230,700 (the installment basis, DATA-039)

**The no-4th-tranche probe (`scripts/t-425-no-4th-tranche-probe.mjs`) — the official model exact:** tuition T0/FI n=1,137 Σdue 28,959,000 · T1/V1 n=1,134 Σdue 111,758,300 · T2/2V n=1,137 Σdue 96,075,000 · T3/v3 n=1,132 Σdue 96,918,500 · transport T1/T2/T3 n=472 each · **T4 rows: 0** · students with tuition rows: 1,137.

**The boot-path health probe (the owner's 500-storm read family, with a REAL staff JWT):**
- read_installments_collection → **200 in 1,733 ms** (5,956 rows) · read_payments_collection → **200 in 1,271 ms** · read_ledger_entries_collection → **200 in 1,976 ms** · read_debt_summary_collection → **200 in 482 ms** (634 debtors — the same census as the pre-purge state) · students count → **200 in 571 ms** · payments month read → **200 in 762 ms**
- **The storm that opened the 111th session is gone end-to-end: 0126 live + the in-flight dedupe + the full corpus re-imported.**
