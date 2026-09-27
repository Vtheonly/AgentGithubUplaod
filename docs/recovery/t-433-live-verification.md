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

(recorded below after execution)

## Phase D — the fresh WB2 import

(recorded below after execution)

## Phase E — the post-import verification

(recorded below after execution)
