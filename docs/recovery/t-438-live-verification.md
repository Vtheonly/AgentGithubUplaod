# T-438 Live Verification — ER-PMAE (migrations 0130 + 0131)

> **Task:** T-438 — the Experimental User Aggregation & Identity Resolution Engine (GitHub issues #15 + #16).
> **Date:** 2026-09-29 (117th session).
> **Scope:** the live application of migrations 0130 (the ER-PMAE tables + RPCs) and 0131 (the unmerge jsonb-cast repair), and the live verification of the complete contract.

## 1. The live application

| Step | Command | Result |
|---|---|---|
| Chain head before | `select version … desc limit 1` | **0129** (0122 still reserved) |
| Apply 0130 | `SUPABASE_ACCESS_TOKEN=… bash scripts/apply_0130_live.sh` | **HTTP 201**, empty body (success) — the DDL + the registration landed atomically (the T-091/MIG-TOKENS pattern; the file carries its own `schema_migrations` insert) |
| Apply 0131 | `SUPABASE_ACCESS_TOKEN=… bash scripts/apply_0131_live.sh` | **HTTP 201** — the unmerge cast repair (re-created the function; the drop-first makes re-application idempotent) |
| Chain head after | `select version … desc limit 3` | **0131, 0130, 0129** — repo = live, no drift |
| The four tables | `information_schema.tables` | `er_source_observations`, `er_match_proposals`, `er_identity_edges`, `er_aggregation_events` — all present, all **EMPTY** (the feature is dormant: no desktop has enabled it; INV-40) |

## 2. The live verification — verify_t-438.sql **20/20 GREEN**

The script follows the §11.1 convention: `BEGIN; … ROLLBACK;` (re-runnable, zero live mutation), the service-role JWT claims for the RPC calls, probe parents/students/payments created INSIDE the transaction, results in the `t438_results` temp table.

| Check | What it proves | Result |
|---|---|---|
| C1_tables | the four `er_*` tables exist | GREEN |
| C1_constraints | the named uniques (`er_source_observation_identity` — the idempotency key; `er_identity_edge_pair` — one edge per pair) | GREEN |
| C2_rls | RLS enabled on all four tables | GREEN |
| C2_policies | staff_read + admin_manage on all four (8 policies) | GREEN |
| C2_no_parent_access | NO parent-role policy — identity data is staff-only | GREEN |
| C3_approve_edge | `fn_er_decide_proposal('approve')` creates the ACTIVE edge | GREEN |
| C3_approve_event | the PROPOSAL_APPROVED event lands | GREEN |
| C3_immutable | re-deciding a decided proposal is REFUSED | GREEN |
| C4_negative_edge | `reject` creates the NEGATIVE edge (never re-proposed) | GREEN |
| C5_repointed | `fn_er_merge_parents`: the student + payment re-pointed to the survivor | GREEN |
| C5_softdeleted | the merged-away parent soft-deleted (the T-384 convention) | GREEN |
| C5_mapping_recorded | the COMPLETE prior mapping in the event payload (INV-54) | GREEN |
| C6_restored | `fn_er_unmerge_parents`: every row back at its ORIGINAL parent; the parent un-deleted — the exact prior state | GREEN |
| C6_event | the MERGE_UNDONE event written | GREEN |
| C6_double_refused | a SECOND unmerge is refused (idempotent reversal) | GREEN |
| C7_state | `fn_er_has_aggregation_state` = true after the cycle (the honest census) | GREEN |
| C8_registration | the `schema_migrations` rows for 0130 | GREEN |
| C9_acl | NO public EXECUTE on the four RPCs; authenticated retains it | GREEN |
| C10_audit | the `er.merge_parents` / `er.unmerge_parents` / `er.decide_proposal` audit rows | GREEN (4 rows) |

**Zero residue after ROLLBACK** (the post-run census): `proposals=0 · edges=0 · events=0 · observations=0 · probe_parents=0 · probe_payments=0 · er_audit=0` — the live DB is byte-identical to pre-verify (the transaction's audit inserts rolled back with it — INSERT rollback is not the forbidden UPDATE/DELETE of the append-only trigger).

## 3. Defects the live verification caught (the never-run-layer class — §15.16)

1. **0131's root cause (the REAL defect, caught live):** `fn_er_unmerge_parents`' restore-mapping replay cast the `jsonb_each` values directly to uuid — PostgreSQL rejects a direct jsonb→uuid cast (`42846`), and the naive `value::text` fallback keeps the JSON quotes (`22P02`). The correct extraction is `value #>> '{}'` (unquoted). The merge RPC was unaffected (it BUILDS the jsonb); only the unmerge's replay was broken. Fixed by migration **0131** (a NEW migration — §15.9: 0130 was already applied + pushed).
2. **Verify-script check defects (2, the T-432 class):** C1 expected 3 unique constraints where the schema correctly carries 2 named uniques + PKs; C2 had an SQL OR-precedence bug counting non-ER policies. Both fixed in the script; the live schema itself was verified correct by direct probes BEFORE the fix (the §15.16 discipline: prove the server side before blaming it).

## 4. The local gates (the full evidence set)

- `tsc --noEmit` → **0 errors**
- `eslint` on every new/changed file → **0 errors** (4 house-style stub-arg warnings, the t-364 convention)
- `vitest run src/tests/domain/identity/er-engine.test.ts` → **40/40**
- `vitest run src/tests/infrastructure/t-438-er-repositories.test.ts` → **13/13**
- `vitest run src/tests/infrastructure/t-438-er-gate-and-seam.test.ts` → **16/16**
- FULL `vitest run` → **4,389 passed / 18 failed / 5 skipped** — the failing SET byte-identical to `scripts/test-baseline.json`'s 9 documented environment-class files (BASELINE-MATCHED; the count = the documented 4,320 baseline + the 69 T-438 tests)
- `scripts/check-migrations-append-only.sh` → OK (127 files: 125 + 0130 + 0131)

## 5. What is deliberately NOT exercised live

- The import-time review flow's UI legs (the Electron render path — the owner's packaged-app pass is the standing acceptance convention).
- A real workbook import with the flag enabled on production data — the feature is **experimental and disabled by default**; the first real exercise should be the owner's deliberate opt-in (Settings → Expérimental) on a controlled import.
- The Supabase repository's live REST legs (the wire shapes are pinned by the fake-client suite; the RPCs themselves are live-verified above).
