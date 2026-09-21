# T-397 — Live Verification — the PERF-501 batchRegister bulk rewire + the DATA-019 honest billing warning + the idempotent-retry absorber

**Task:** T-397 — the owner's slow-insert/server-error report (PERF-501 + DATA-019).
**Session:** 81st (2026-09-21). **Project:** `vebfehrpzajhstyhinnw` (the production target).
**Status:** COMPLETE — VERIFIED (unit 5/5 + the 88-test regression sweep + the LIVE end-to-end measurement below).

---

## 1. The owner's report

> *"how long it takes to insert a student or parent. sometimes it takes around 10–20 seconds for a single insert, which is a serious problem if i need to import hundreds of records. also, sometimes when i try to insert a student or parent, i get a server error."*

## 2. The root cause (live-measured, PERF-501)

The registration wizard's write path (`SupabaseStudentRepository.batchRegister`) looped the per-row write methods: `ledgerRepo.append` (1 RPC per charge) + `importInstallment` (3-4 sequential round-trips per tranche). A 1-student registration with default billing = **21+ sequential HTTP round-trips** (33+ with transport), live-measured **6,984 ms** from the sandbox (median RTT 264 ms). At the owner's Algeria→eu-west-1 RTT band (476–952 ms), 21 calls = **exactly the reported 10–20 s**. Every round-trip is also another transient-failure window — the "sometimes a server error" class (one blip fails the whole chain mid-way). The bulk write paths (`bulkAppend` + `bulkImportInstallments` — the Excel importer's) existed but were never wired into the interactive path; the installments one was itself live-broken (IMPORT-110, fixed in the previous commit).

## 3. The fix

1. **The bulk rewire** (`supabase-shared-repositories.ts`): the billing leg now BUILDS all charges (`LedgerEntry[]`) + all tranches (`ImportInstallmentInput[]`) first, then writes them with **ONE `bulkAppend` + ONE `bulkImportInstallments`** call — the same live-proven paths the Excel importer uses. The identity legs (parent upsert + fetch, student upsert + fetch — they return the ids the billing rows need) stay as-is.
2. **DATA-019 — the honest billing warning**: a billing-leg failure (either bulk call returning `Err`, or an exception) is NO LONGER `console.warn`-swallowed — the family records stay (correct; charges regenerable — the established scope decision) but `BatchRegistrationResult.billingWarning` carries the honest reason, and the wizard surfaces it as a visible warning toast (« Inscription réussie MAIS échec de la facturation ») instead of a bare « Inscription réussie ».
3. **The idempotent-retry absorber** (`rpcWithIdempotentRetry`): the two identity upsert RPCs (`upsert_parent_from_import`, `upsert_student_from_import`) get EXACTLY ONE immediate retry on network-class errors (fetch failed / ERR_NETWORK / timeout / ECONNRESET) — safe because the deterministic parent/student codes make re-runs converge (UPDATE, never duplicate — the upsert's own contract, pinned by the CRUD suite's idempotency leg). Non-network errors (validation, RLS, constraints) are NOT retried — a retry cannot fix them.

## 4. The measured result (LIVE, `npx tsx scripts/t-397-batch-register-live-e2e.ts`)

The REAL `batchRegister` (the exact code the wizard calls) against the live backend, signed in as the documented admin:

| Metric | Before (the PERF-501 probe) | After (this fix) |
|---|---|---|
| Sequential round-trips (1 student, default billing) | **21+** | **~11** (4 identity + 5 pricing reads + 2 bulk writes) |
| Wall clock from this sandbox | **6,984 ms** | **3,189–3,263 ms** (2 runs) |
| Projected on the owner's route (476–952 ms/RTT) | 10–20 s | **~5–10 s** |
| Per ADDITIONAL student | +12 round-trips (identity + per-tranche loops) | **+2** (identity only — the bulk legs stay 1 call) |

**Billing content verified live**: 4 ledger entries (tuition T1 122,000 + T2 91,500 + T3 91,500 + FI 5,000) + 3 installments (122,000/91,500/91,500, unpaid) — all through the bulk paths, `billingWarning: none`. Cleanup via the canonical soft-delete RPCs — zero live residue (§15.26 audit rows stay).

## 5. Unit + regression gates (2026-09-21)

- `npx vitest run src/tests/infrastructure/t-397-batch-register-bulk.test.ts` — **5/5 PASS** (the call-count contract: no `upsert_ledger_entry_from_import` RPC ever, ONE bulk upsert per table, total ≤ 12 round-trips; the billing content; the DATA-019 warning with the reason; the retry-converges + no-retry-on-hard-error pins).
- The regression sweep on every batchRegister/bulk consumer: `real-excel-import` + `empty-state-excel-restore` + `vault-compliance` + `t-105-import-shape` + `t-364-import-flush-idempotency` + `workflow-event-bridge` + `t-381`/`t-384` — **88/88 PASS** (the mock repository's contract is unchanged; the optional `billingWarning` field is additive).
- `npm run typecheck` — 6 errors, ALL the pre-existing concurrent-agent fixture drift (zero in this task's files). `npx eslint` on all touched files — 0 errors / 0 new warnings.

## 6. Registered follow-up (deliberately out of scope per §15.8)

**The pricing-read leg** is now the largest remaining block (5 of the ~11 round-trips: `pricing_configs` + `academic_levels` + `grade_level_tuition` + `transport_destinations` + `complementary_services`). The wizard ALREADY loads the pricing config for its step-3 preview — passing that config through the `BatchRegistrationInput` contract would (a) cut 5 more round-trips and (b) be MORE correct (the persisted charges would always match the preview the parent agreed to — a mid-flow price edit currently re-reads different values). This needs the input-contract change + the mock parity + the wizard wiring — a clean follow-up task. Registered in the T-397 registry entry.
