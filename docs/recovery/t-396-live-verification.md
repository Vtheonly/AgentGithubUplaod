# T-396 — Live Verification — the backend CRUD integration test suite (OPS-320)

**Task:** T-396 — the owner's backend CRUD verification mandate (Settings → « Tests CRUD »).
**Session:** 81st (2026-09-21). **Project:** `vebfehrpzajhstyhinnw` (the production target).
**Status at this evidence:** IMPLEMENTED — TESTED (unit 12/12; live e2e 24 PASS / 3 FAIL — **the 3 FAILs are ONE real production defect discovered by the suite itself (IMPORT-110, fixed in the follow-up commit) + its 2 cascades**).

---

## 1. What was built

The owner's mandate (verbatim): *"in the settings, add a testing capability that allows me to test the entire CRUD flow and verify that every operation works correctly with the backend... inserting students and parents; updating existing records; deleting records; viewing and fetching records; relationships between related records; handling validation errors; handling server/database errors; testing bulk inserts/imports; verifying that the UI state stays consistent with the database after every operation... clearly see whether each operation succeeds or fails, including the actual error when something goes wrong."*

Delivered as an EXTENSION of the T-393 diagnostics module family (§6 — no parallel implementation):

| File | Role |
|---|---|
| `src/features/settings/supabase-diagnostics/crud-test-runner.ts` | The deterministic 27-check write-path suite — every leg uses the EXACT repository REST/RPC shapes (createParent's `upsert_parent_from_import` + refreshById fetch; createStudent's `upsert_student_from_import`; updateParent/updateStudent PATCH; the seed list shapes with `tenant_id` + `deleted_at IS NULL`; `bulkAppend`'s ignore-duplicates upsert; `bulkImportInstallments`'s identity upsert; `soft_delete_student`/`soft_delete_parent`; the validation-error pins). Run-unique probe codes (`PAR-PROBE-T396-<stamp>`); honest legs (a failure never aborts — only the prep gate short-circuits); the cleanup phase ALWAYS runs. |
| `src/features/settings/supabase-diagnostics/crud-test-tab.tsx` | The Settings view: the PASS/FAIL/NON TESTÉ matrix grouped by phase, per-check durations, the EXACT error text (HTTP + code), the transparency banner (this test WRITES probe rows then soft-deletes them), the safe clipboard export (reuses `formatDiagnosticsReportText`). |
| `src/features/settings/settings-page.tsx` | The new « Tests CRUD » tab (next to « Diagnostic Supabase »). |
| `src/tests/features/t-396-crud-integration.test.tsx` | The unit suite (12 tests: healthy run 27/27 + phase order; run-unique codes; the prep short-circuit; insert-failure honesty; the validation pins incl. the accepted-invalid-call negative; the FK leg; delete consistency; update consistency + failure; token-safety; the view legs). |
| `scripts/t-396-crud-live-e2e.ts` | The LIVE e2e driver (the same runner, the canonical client, the documented admin) — re-runnable any time. |
| `scripts/t-396-insert-latency-probe.py` | The PERF-501 evidence probe (delivered in the registration commit). |

## 2. Unit gates (2026-09-21)

- `npx vitest run src/tests/features/t-396-crud-integration.test.tsx` — **12/12 PASS**.
- `npx vitest run src/tests/features/t-393-supabase-diagnostics.test.tsx` — **12/12 PASS** (the read-only half untouched).
- `npm run typecheck` — 6 errors, ALL the pre-existing concurrent-agent `editing`-prop fixture drift (attributed at the 80th-session open per §15.14; zero in this task's files).
- `npx eslint` on all 5 touched files — **0 errors / 0 warnings**.

## 3. LIVE e2e (run 2026-09-21, `npx tsx scripts/t-396-crud-live-e2e.ts`)

**24 PASS / 3 FAIL / 0 NON TESTÉ** (27 checks). Full matrix:

| Phase | Checks | Result |
|---|---|---|
| Préparation (session, tenant) | 2 | PASS / PASS |
| Insertion (parent RPC, read-back, student RPC, read-back, idempotency) | 5 | PASS ×5 |
| Mise à jour (parent PATCH, list-consistency, student PATCH, read-back) | 4 | PASS ×4 |
| Lectures (parents list, students list — the annuaire seed shapes) | 2 | PASS ×2 |
| Import groupé (ledger bulk ×3-in-1, installments bulk ×3-in-1, read-back) | 3 | **PASS / FAIL / FAIL** |
| Relations (student→parent FK+tenant, billing linkage, parent aggregate) | 3 | PASS / PASS / **FAIL** |
| Erreurs de validation (blank-uuid, invalid category) | 2 | PASS ×2 |
| Erreurs serveur (FK violation code surfaced) | 1 | PASS |
| Suppression (student RPC + list-exclusion, parent RPC + list-exclusion) | 4 | PASS ×4 |
| Nettoyage (zero live residue) | 1 | PASS |

Zero live residue at the end (the cleanup leg PASSes — no probe rows remain visible; audit rows stay per §15.26).

## 4. The discovery: IMPORT-110 (the suite doing its job on its first live run)

The 3 FAILs are ONE production defect + its 2 cascades:

> **`SupabaseInstallmentRepository.bulkImportInstallments` is LIVE-BROKEN (42P10)** — it upserts with `onConflict: "tenant_id,parent_id,student_id,category,tranche_number"`, but the identity index (`installments_bulk_import_identity_idx`, migration 0032) is a **PARTIAL** unique index (`WHERE parent_id IS NOT NULL AND student_id IS NOT NULL AND …`), and PostgreSQL's `ON CONFLICT (columns)` inference **cannot match partial indexes** — PostgREST has no way to pass the index predicate. Every call returns HTTP 400 `42P10`, the chunk loop does `console.warn` + `continue`, and the method returns **`Ok([])` — success with zero rows written**. The Excel import adapter flushes ALL its installments through this method at commit time: a live import would silently lose every tranche while reporting success.

Live proof (probe `t-396c-failure-probe.py`, 2026-09-21):
- `POST /rest/v1/installments?on_conflict=tenant_id,parent_id,student_id,category,tranche_number` + `Prefer: resolution=merge-duplicates` → **HTTP 400 `42P10`** (fresh row, no conflict — the error is at plan time).
- The SAME payload with plain insert (no `Prefer`) → **HTTP 201** (the table itself is fine).
- `SELECT indexdef` → the partial index confirmed on the live catalog.

Why no earlier suite caught it: the repository tests **mock the supabase client**, and the mock's `.upsert()` cannot reproduce PostgREST's ON CONFLICT inference rules — only a live probe can. (The T-364/T-365 import suites ran the real repository against a mocked client — the mock happily "succeeded".) **This is the exact reason the owner's in-app live test suite exists.**

Registered as **IMPORT-110** + fixed in the follow-up commit (the fix: `ignoreDuplicates: true` — `ON CONFLICT DO NOTHING` without an arbiter DOES honor partial indexes — plus honest chunk errors). The CRUD suite's bulk leg goes green after that fix (see §5).

## 5. Secondary live findings (documented, no action needed)

1. **The blank-uuid class now rejects at TWO layers**: the live `upsert_student_from_import` carries its own parent-ref guard → HTTP 400 `P0001` with the hint *"Push the parent (upsert_parent_from_import) before its students"* (better UX than the gateway's `22P02`). The suite accepts both clean-rejection shapes (22P02 or P0001); a 200 (accepted) or 500 is the failure. The client-side `blankToNull` guard (SYNC-300/T-387) stays.
2. **RLS read-side corollary of RLS-500 confirmed**: a raw read of soft-deleted rows (no `deleted_at` filter) returns NOTHING for authenticated callers — the 0019 SELECT policies filter server-side. The cleanup check therefore proves zero LIVE residue through the LIST shape (the only shape that can see live rows).
3. **Per-round-trip latency from this sandbox**: ~250 ms median (Ireland route) — the owner's 10–20 s report maps to the same 21-call chain at Algeria-route RTTs (PERF-501, fixed by T-397).

## 6. How to re-run (the owner's self-service surface)

- **In the app:** Settings → **Tests CRUD** → « Lancer la suite CRUD complète ». The matrix renders live; « Copier le rapport » exports the safe text form.
- **From the repo:** `cd elimtiyaz-desktop && npx tsx scripts/t-396-crud-live-e2e.ts` (VERBOSE=1 for the full report text).

## 7. Residuals

- The installments bulk leg stays RED until the IMPORT-110 fix commit lands (same session, immediately after) — the final closeout records the green 27/27 re-run.
- The probe ledger/installment rows of past runs stay as the financial history of soft-deleted probe families (invisible in every UI shape — OPS-319's deleted-set gap; the audit trail is the honest record).
