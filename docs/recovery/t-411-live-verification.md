# T-411 — Live Verification Record (95th session, 2026-09-23)

> **Scope:** Phases 0-5 of the Finance UI Unification (ADR-023 / BUSINESS-106 / BUSINESS-107 / DUP-006 / DATA-023..029 / DATA-032..037 / BUSINESS-108). This file records the ACTUAL verification evidence per §13 / `definition-of-done.md`. Nothing below is claimed without a command + result.

## 1. The live migration (0115)

- **Pre-flight (§15.11):** live `supabase_migrations.schema_migrations` head = `0114` (read-only probe) — matched the local chain; `0115` was the correct next free number.
- **Application:** the T-091/MIG-TOKENS pattern — the full file (DDL + function bodies + the registration INSERT, idempotent via ON CONFLICT) sent as ONE atomic payload via the Management API SQL endpoint. **HTTP 201** (the endpoint's documented success code, §15.26).
- **Re-application:** the file was re-applied once after the live round-trip caught a cursor-shape bug (§4 below) — all statements in it are idempotent (DROP NOT NULL on already-nullable columns succeeds; DROP+CREATE replaces; ON CONFLICT skips).

## 2. Structural verification (read-only, post-apply)

`verify_t-411.sql` is NOT only the functional probe — its C1 asserts the structure:

| Check | Result |
|---|---|
| `0115` registered in `schema_migrations` | ✅ 1 row |
| `payments.category` nullable (`attnotnull = false`) | ✅ |
| `ledger_entries.category` nullable | ✅ |
| `collect_and_allocate_payment` cleared branch subtracts `amount_pending` | ✅ (pg_get_functiondef match) |
| `mark_payment_cleared` overflow guard (`LEAST(v_remaining, v_ins.amount_pending, v_capacity)`) | ✅ |
| `mark_payment_cleared` returns `overflow_credit` | ✅ |
| `collect_and_allocate_payment` writes `payment_allocations` | ✅ |

## 3. Functional round-trip (`scripts/verify_t-411.sql`, BEGIN…ROLLBACK)

Run-unique probe parents (`PAR-T411-XCAT / -INV4 / -OVFL / -EXCT`), probe students, probe installments — **all inside the transaction**:

| # | Check | Result | Detail |
|---|---|---|---|
| C1 | registration + nullability | ✅ | (above) |
| C2 | **cross-category collection allocates across BOTH categories** (BUSINESS-106) | ✅ | 100 000 cash with `p_category = NULL` → tuition 80 000 + transport 20 000, `unallocated_credit = 0` (the pre-fix behavior booked 100 % parent_credit against a category with zero installments) |
| C2b | NULL payments row + single ledger entry on `parent:{id}:category:all` | ✅ | the revert RPC's single-entry reversal contract preserved |
| C3 | `payment_allocations` written with concrete categories (DATA-029) | ✅ | 2 rows, 2 distinct categories |
| C4 | **cleared-branch INV-4** (BUSINESS-107) | ✅ | tranche 100 k with 50 k pending + 100 k cash → paid 50 000 + pending 50 000 (sum = due), credit 50 000 — no over-allocation |
| C5 | **clearance overflow → parent_credit** (BUSINESS-107) | ✅ | legacy over-allocated shape (paid 80 k + pending 40 k on 100 k): clearance moves 20 k (capped), `overflow_credit = 20 000` booked as a `parent_credit` adjustment + the audit row carries it |
| C6 | exact-category restriction preserved (T-060) | ✅ | `p_category = 'tuition'` left transport untouched; 20 000 → credit |

**Zero residue:** post-ROLLBACK census — probe parents 0, probe payments 0, probe installments 0.

## 4. A live-caught bug (the reason the round-trip matters)

The first live execution of C2 failed with `record "v_ins" has no field "label"`: the waterfall cursor's SELECT list did not include `label`, but the new `payment_allocations` INSERT referenced `v_ins.label`. Static review and `tsc` cannot catch a PL/pgSQL cursor-shape mismatch; the migration file was corrected (both loops) and re-applied BEFORE any commit — the committed `0115` is the verified version. Lesson recorded: **a migration that adds a column reference to an existing loop MUST re-check the cursor's SELECT list — and only a live round-trip proves it.**

## 5. Desktop gates (run on the final tree, all phases)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors** |
| FULL `npx vitest run` | 3 859 tests: **21 failed / 3 833 passed / 5 skipped** — the failing set is **byte-identical to the pre-change baseline** (verified by a git-stash full-suite diff; the single divergent pin — T-330's label expression — was updated to the new canonical helper and passes) |
| `npx eslint` (changed files) | **0 errors** (pre-existing warnings unchanged) |
| `bash scripts/check-migrations-append-only.sh` | OK (+1 new file, 0 edits) |
| New T-411 suites | cross-category-waterfall 13/13 · diagnostic-engine-rebase 11/11 · anomaly-signals 5/5 · registration-remise 3/3 (plus the extended t-192 10/10 and executive-statistics 44/44) |

## 6. Website gates (Phase 5)

| Gate | Result |
|---|---|
| `npm run test` | **648/648** (51 files) |
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | clean |
| `npm run build` | **green** (strict; `ignoreBuildErrors` stays false) |

## 7. What is NOT claimed

- **VERIFIED status** for T-411 overall: the owner's packaged-app UI pass over the changed surfaces (the modal's Multi-services mode, the Créances labels, the diagnostic numbers, the portal statement) is the remaining gate — same convention as T-408/T-409/T-410.
- **DATA-028's split-structure unification** (the workbook V2-targeted remise split vs the official 40/30/30): the data LOSS is fixed (the persisted totals now match the devis); the split convention needs the owner's decision (registered in the problem entry).
- **The ledger_entries realtime publication membership** (DATA-032/B3's activation): the hub's REALTIME-105 migration set owns it; the portal subscription is inert-but-correct until then (documented in `use-realtime.ts`).
- **Android**: untouched this session (the §15 mirror of ADR-023's nullable category + the INV-4 cleared branch belong to the standing Android equivalence pass).
