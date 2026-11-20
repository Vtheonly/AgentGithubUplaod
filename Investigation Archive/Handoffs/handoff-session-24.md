# Handoff — Session 24 → the execution phase

**Date:** 2026-11-20 · **HEAD at close:** the S24 session-records commit on `main` (clean, pushed) · **G0:** still ACTIVE (Issue #32: 0 comments — the 19th consecutive silent run).

## The state of record (what changed this session)

1. **The schema chain is now the consolidated baseline:** `elimtiyaz-desktop/supabase/migrations/0001_initial_consolidated_schema.sql` (single-pass, verified, zero failures, census-equal to the 152-migration replay) + `migrations_archive/` (the 152 originals, verbatim, immutable) + the updated append-only guard. **All future SQL work appends as `0002_*.sql` onward.** Equivalence evidence: Deep Sweep/14 Part C.3.
2. **`Refactoring Unified/` is v2.1** — verified (78 families, zero substance refutations), complete (190→195 IDs, zero orphans, programmatically proven), and extended (DUP-037/ARCH-049/BUG-069/OPS-017/OPS-018 homed; C-23/C-24/C-25 folded into T-594/T-569/T-588).
3. **The infrastructure changed materially:** the NEW Supabase project (`gvuvibcsfjhwcjikgxql`) is alive, NOT quota-blocked, schema-empty, with the first-ever-valid management token (OPS-017) — the relocation lane's target is READY. The OLD project remains 402 (OPS-011, 19-run-stable).

## The next session's bootstrap (in order)

1. `git fetch origin && git status` (clean; sync `main`).
2. Read: `Investigation Archive/README.md` (the S24 rows) → `SESSION_LOG.md` row 24 → this handoff → `Refactoring Unified/EXECUTION-PLAN.md` v2.1 **end to end** (§14 is the S24 delta).
3. Check Issue #32 for the owner's green-light (G0). **If lifted:** execute §3's immediate queue, starting with the **OPS-018 preamble** (the 31 src/tests migration-path updates — one mechanical commit, `migrations/` → `migrations_archive/` prefixes), then T-549 → T-559/T-560/T-594 → T-550/T-573 → T-552. **If not lifted:** the standing GET-only probe set + any documentation/verification work the owner mandates.
4. The one-time live window (G2, after T-559/T-560/T-594 green): the full verify_t-376 12/12, the live census, the T-598 reconciliation oracle, and — new this session — **the consolidated-baseline deployment to the NEW project** (the T-575 preflight's first target; Path 2 in the relocation guide).

## The corrections the executor must carry (from Deep Sweep/14)

- T-594 narrows (C-23): mock mode is already silent; fix the configured-mode probe resolution.
- T-569's DB-side deletion scope is EMPTY (C-24): app-side only; `class_subjects` is the DB truth.
- T-588's store inventory is 13+ (C-25); T-592's volley budget is 30 caches/18 files (ARCH-049); T-591 gains BUG-069 (tenant-scope + keyset the reconcile/collectDebtors reads); E2.4 gains DUP-037 (the mock batchRegister fifth billing site).
- BUG-046's fix surface is 7 synthetic entry sites (the root: `unified-payment-modal.tsx:283-285`'s lineItems-take-precedence branch).
- REAL_TUITION_BY_GRADE is not year-keyed at all — ARCH-037/T-587 is stronger than the v2.0 framing.

## Standing constraints (unchanged)

Read-only until G0 lifts; one T-task per commit with the five-question body; push immediately; never force-push; SQL/EF changes under the §11.1 ceremony; RLS never weakened; the archive never touched again; the web portal and Android keep consuming Supabase unchanged (D-17); OPS-015's cap-lift ordering is absolute.
