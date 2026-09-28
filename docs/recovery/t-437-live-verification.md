# T-437 — Live Verification Record (116th session, 2026-09-29)

**Task:** T-437 — Student Re-enrollment, Academic History, Payment Handling & Direct Student Creation (GitHub issue #18).
**Problems:** ACAD-512, BUSINESS-109, STUDENT-501, STUDENT-502, UI-319 (registered Phase 0) + DATA-054 (discovered + resolved mid-session).
**Migrations:** 0128 (re-enrollment + student origin) + 0129 (the installments year-scoped identity — DATA-054). Chain head: **0129 live**.

## 1. The session-opening ritual

- Live `schema_migrations` vs the local chain: **no drift** (live = local + `0118`, the documented gap — the §15.11 census via the Management API SQL endpoint).
- The pristine-tree baseline: tsc 0 · FULL vitest **4,295 passed / 18 failed** — the failing SET byte-identical to `scripts/test-baseline.json`'s 9 environment-class files (BASELINE-MATCHED).

## 2. The migrations — applied atomically, verified GREEN

### 2.1 Migration 0128 — `0128_re_enrollment_and_student_origin.sql`

- **Dry-run** (BEGIN…ROLLBACK): HTTP 201, zero residue after rollback (origin columns absent, no probe rows).
- **Atomic apply** (BEGIN…DDL+registration…COMMIT, the T-091/MIG-TOKENS pattern): **HTTP 201**.
- **`scripts/verify_t-437.sql` — 25/25 GREEN** (the first run's evidence), then **27/27 GREEN** after the C11 (DATA-054) checks were added:
  - C1 the five origin columns on `students` (5/5)
  - C2 `upsert_student_from_import` threads the origin on INSERT + the COALESCE-preserve on a blank partial re-push
  - C3 `register_family_batch` threads the origin through the jsonb wire (the §15.45a re-audit)
  - C4 the `re_enrollments` table + the (tenant, student, target year) unique key
  - C5 `fn_generate`: **1,139 candidates materialized from the LIVE active roster** (the tenant's real 2026-2027 corpus); the finalized-snapshot enrichment (a probe `repeated` history → `expected = 3ap`, avg 11.50); the idempotent regeneration (the probe student stays 1 row)
  - C6 the decision transitions (waiting → started → waiting)
  - C7 `fn_re_enroll_student`: the placement update on the EXISTING student (code preserved `ELV-2098-T437PROBE`), **2 installments stamped with the TARGET year id**, the prior-year rows untouched, the ledger written, the terminal `re_enrolled` state refused a decision change
  - C8 `fn_freeze`: refused at **1,138 waiting** with the honest count → succeeded at 1,139 decided (all rows frozen) → post-freeze generation AND decision refused
  - C9 the registrations (0128 + 0129 = 2 rows)
  - C10 the ACL: anon/public 0 grants, authenticated 5/5
  - C11 (DATA-054): the SAME tuition T1 in TWO academic years for one student (count = 2 — impossible pre-0129); C11b the import RPC's year-aware identity (the prior-year upsert updated the PRIOR-year row: amount 39,000, year = the source year id)
- **Post-verify residue census: ALL ZERO** (probe students/years/installments/re_enrollment rows 0; the registrations persist by design).
- **Two REAL bugs the verify loop caught and fixed before they shipped:** (1) a 26-argument grant signature (one extra `text`) — the RPC-arg-count trap; (2) a malformed `format('%')` specifier in `fn_freeze_re_enrollments` (the unrecognized-format-specifier class). Both fixed + re-applied + re-verified GREEN.

### 2.2 Migration 0129 — `0129_installments_year_scoped_identity.sql` (DATA-054)

- **The discovery:** the 0032 `installments_bulk_import_identity_idx` (tenant, parent, student, category, tranche_number) carries NO academic-year key, and neither does `upsert_installment_from_import`'s Identity-2 lookup — so a continuing student re-enrolled into a new year would have EVERY new-year tranche row silently dropped by the `ON CONFLICT DO NOTHING` arbiter (the exact failure issue #18 §7 forbids). Registered as **DATA-054** with the live evidence.
- **Dry-run:** HTTP 201, zero residue → **Atomic apply: HTTP 201**.
- **The fix verified live:** the C11 checks above (27/27 GREEN). The rebuild is safe by construction — rows differing only by year were previously IMPOSSIBLE (the old index prevented them), so no existing data can violate the new key.

## 3. The live DB state after the session

- Chain head **0129** (registrations 0128 + 0129 present; `check:migrations` append-only OK: 124 files).
- Zero re_enrollments rows (the verify script's candidates all rolled back — the school generates its real list through the new tab when ready).
- Zero students with origin captured (the corpus predates 0128; new admissions capture the origin at creation).
- The live corpus otherwise untouched (741 parents / 1,137 students / 5,956 installments — the verify's residue censuses prove it).

## 4. The desktop verification (local)

- **tsc exit 0** (after the session caught its own tooling trap: `npx tsc | head && echo OK` masks the exit code through the pipe — the §15.69 rule now pins checking `$?`).
- **eslint 0 errors on every changed file** (warnings = the pre-existing set).
- **The NEW suites:** `t-437-re-enrollment-repositories.test.ts` **15/15** (the mock workflow contract: roster eligibility, the repeated/promoted/non-finalized expected-level derivations, the idempotent regeneration, the state machine + guards, the composite updating the EXISTING student with the target-year stamping; the shared builder's batch vs year-scoped tokens + the SAME wire keys; the Supabase RPC mirrors; the existingParentCode seam — no duplicate parent + billing written; the origin threading end-to-end) + `t-437-re-enrollment-ui.test.tsx` **10/10** (the tab scaffolding + the create-next-year affordance + the worklist semantics; the pre-filled modal's read-only block + editable fields + the non-finalized warning + the old-debt note; the parent picker; the origin card's captured + honest states).
- **The re-pinned source-scan:** `supabase-pricing-repository.test.ts` 21/21 (the billing-config intent preserved across the builder extraction — the hardcode bans now scanned across BOTH files).
- **The behavior-preservation pins:** the T-397/T-398 batchRegister suites 12/12 (the extraction changed ZERO batch-path output).
- **FULL vitest at close: 4,320 passed / 18 failed** — the failing SET byte-identical to the 9-file baseline; the count = the session's 4,295 baseline + the 25 new T-437 tests.

## 5. What was NOT verified live (the honest boundaries)

- The **owner's packaged-app visual pass** over the new surfaces (the standing acceptance convention): the « Réinscription » tab, the pre-filled modal, the direct add-student flow, the origin card.
- A **real second-academic-year corpus** on the live DB (the standing T-436 note): the probe year 2098-2099 exercised the mechanics inside ROLLBACK; the school's real 2027-2028 transition (create the year → generate → decide → re-enroll → freeze) is the owner's operational pass.
- The **promotionCycles slot stays mock-wired even in Supabase mode** (a PRE-EXISTING gap discovered this session: `getSupabaseRepositories()` never overrode it — the promotion-cycle UI runs on the mock in Supabase mode while `SupabasePromotionRepository` [the batch path] IS wired). NOT touched by T-437 (scope control); flagged for the next agent — it matters because the re-enrollment candidates read the histories the promotion flows write, and the cycle UI is the human-in-the-loop path that writes them.
