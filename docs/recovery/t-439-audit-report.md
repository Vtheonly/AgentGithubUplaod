# T-439 — The Comprehensive Audit of the 38 Commits Since 5bd8ad3 (T-434..T-438) — Investigation Report

> **Scope:** the owner's audit mandate — "conduct a comprehensive audit of all changes introduced by these approximately 40 commits… do not assume the existing implementation is correct simply because the tests pass… investigate, identify root causes, implement necessary fixes, and verify results."
> **Method:** the baseline re-established first (tsc 0 · FULL vitest 4,389/18 byte-identical to `scripts/test-baseline.json`), then four parallel deep audits (T-434/435 · T-436 · T-437 · T-438), then every critical finding **re-verified in-source** (file:line) before registration, then six fixes shipped — each with its regression suite **proven RED against the defective code first**.
> **Commit range:** `5bd8ad3..29fbf3f` = 38 commits; the five main tasks: **T-434** (UI-316/DATA-050 — the wave échéance visibility), **T-435** (UI-317 — the due-date range), **T-436** (Year-Tracking — migrations 0127, the year-history engine, ADR-030), **T-437** (Re-enrollment — migrations 0128/0129, ADR-031), **T-438** (ER-PMAE — migrations 0130/0131, ADR-032).

---

## 1. The verdict per task

| Task | Claimed | Audit verdict | Confirmed defects | Fixed in T-439 |
|---|---|---|---|---|
| **T-434** | the échéance visible + the swapped pair corrected | **Largely correct** — the canonical min/max logic, the wave exclusion, the pooling all verified; the échéance display itself carried a latent UTC-negative day shift + a clock/anchor inconsistency family | UI-321 (MEDIUM), UI-322 (LOW family) | UI-321 ✅ · UI-322 documented OPEN |
| **T-435** | the range visible + the config consolidated | **Largely correct** — byte-identical import dates re-verified; the surviving hardcoded hints are the documented latent-lie pattern (LOW); the TZ bug shared with T-434 | UI-321, F5/F7 (LOW) | UI-321 ✅ |
| **T-436** | the year attribution + the history engine | **Core engine sound** (attribution precedence, freeze, backfill, cross-year settlement semantics all verified) — but the allocation replay classified payment STATUSES wrongly (bounced = paid) and several documented semantics (INV-18d, gap-year chains, mixed coverage) are unimplemented | CALC-003 (HIGH), DATA-055 (HIGH, the client twin), DATA-056 (MEDIUM family) | CALC-003 ✅ · DATA-055 ✅ · DATA-056 documented OPEN |
| **T-437** | the re-enrollment end to end | **The extraction is genuinely behavior-preserving** (line-by-line verified vs the original) and the RPCs/RLS/migration are sound — but the modal's devis was priced at a hardcoded grade, the sibling FI silently drops, the mock persisted invisible wire rows, and the desktop import twins were never aligned with 0129 | UI-320 (HIGH), DATA-055 (HIGH), DATA-057 (MEDIUM), BUSINESS-110 (HIGH, owner-gated) | UI-320 ✅ · DATA-055 ✅ · DATA-057 ✅ · BUSINESS-110 documented OPEN (unknowns.md) |
| **T-438** | the ER-PMAE engine + the experimental gate | **The engine's core is sound** (vetoes, determinism, banding, backup round-trip verified) — but the four RPCs had NO tenant guard (CRITICAL), the import bindings leaked across files, the flag-off path kept a stale matcher, Arabic names are destroyed by normalization, and the Supabase-mode backup captures EMPTY ER sections | SEC-115 (CRITICAL), IDENT-103 (HIGH), IDENT-104 (MEDIUM family) | SEC-115 ✅ (migration 0132 — live application BLOCKED on credentials) · IDENT-103 ✅ · IDENT-104 documented OPEN |

**The five tasks' headline work is real and mostly correct.** The defects found are concentrated where the audit mandate predicted: statuses, identities, and zones the green fixtures never exercised.

---

## 2. The six CONFIRMED, REPRODUCIBLE defects (each fixed, each with a RED-proven regression suite)

### 2.1 CALC-003 — the year-history engine counted bounced/refunded/cancelled payments as PAID (HIGH)

- **Problem:** `paidUpToClock`'s allocation replay classified every payment not exactly `status === "pending"` as cleared funds. A bounced cheque (`unpaid` — what `mark_payment_bounced` sets, rolling back amounts but NEVER deleting the `payment_allocations` rows), a refunded and a cancelled payment all settled their tranches; `pending_clearance` counted as paid instead of pending. The cross-year settlement block had NO status filter — a bounced next-year payment fabricated « Dette réglée par des paiements d'années suivantes ».
- **Evidence:** `year-history.ts` `paidUpToClock` (~284-306), the cross-year block (~401-427), the `settledAt` times (~496-508); probe: 30k charge + 20k cash + 10k bounced → `yearEndOutstanding = 0` with `basis = "allocations"` while the canonical remaining is 10,000. The canonical classification (`financial-query-engine.ts:415-430`) was never reused.
- **Root cause:** a two-state mental model (pending vs everything-else) instead of the canonical three-state split; no fixture ever carried a bounced/refunded/cancelled payment.
- **Impact:** the « Historique par Année Scolaire » drawer understated carried-forward debt for every family with a bounced cheque; the error propagated into every later year's record.
- **Reproduction:** import/collect a cheque → mark it bounced → open the parent drawer's Finances tab → the old year shows the tranche settled.
- **Fix:** the `allocationFundClass` helper (paid → paid; pending|pending_clearance → pending; unpaid/refunded/cancelled → NEITHER) at the three sites. Commit `1b97056`.
- **Regression coverage:** `t-439-payment-status-replay.test.ts` 6/6 — 5 RED pre-fix (the bounced, refunded, cancelled, cross-year bounced, cross-year uncleared) then GREEN; the existing 33-test year-history suite unchanged (the 100k/80k/20k owner scenario byte-identical).

### 2.2 DATA-055 — the desktop import path was YEAR-BLIND against the 0129 identity (HIGH)

- **Problem:** migration 0129 made the installments identity YEAR-SCOPED server-side; the desktop twins were never aligned: (1) `importInstallment`'s find matched without the year — post-0129 `.maybeSingle()` throws PGRST116 the moment a continuing student carries the same tranche in two years (and pre-0129-style matched the WRONG row); (2) the UPDATE branch overwrote `academic_year_id` unconditionally (the INV-18b freeze broken client-side); (3) the preflight key carried no year — at the next academic-year transition, importing the new-year workbook would silently DROP every continuing student's new-year tranches as "already imported".
- **Evidence:** `supabase-shared-repositories.ts` (the find ~3904-3911, the overwrite ~3944-3947, the preflight key ~3846-3898) vs migration 0129 §2's Identity-2 (exact-year → NULL-year preference, the COALESCE update) — none of the three properties implemented client-side.
- **Root cause:** 0129's own header documents the client-side gap it was fixing, but only the server side was changed.
- **Impact:** the Excel import path (the school's canonical data-entry mechanism) at the next year transition; the interactive per-row path crashes on multi-year students.
- **Reproduction:** (preflight) import WB-2026-2027, then import a 2027-2026 workbook → the continuing students' tranches vanish from the new year with a success report; (interactive) call importInstallment twice with same-tranche different-year due dates → PGRST116.
- **Fix:** the year-aware find (exact-year → NULL-year claim → the 0129 year-blind fallback for unresolvable dates, list-fetch never maybeSingle), the COALESCE preservation, the year-scoped preflight key through the new `resolveImportAcademicYearId` repository method, the mock twin stamps + scopes identically, and the mock re-enrollment's wire→domain mapper (DATA-057a — the old blind cast pushed snake_case wire rows into the store where every consumer saw nothing; the t-437 A5 test masked it by hand-feeding camelCase rows). Commits `6ad71ae`.
- **Regression coverage:** `t-439-import-year-identity.test.ts` 9/9 (the next-year INSERT, the same-year UPDATE, the NULL-year claim, the COALESCE freeze, the year-scoped identities, the preflight keep/drop/NULL-group/legacy-fallback, the mock two-year rows); the t-437 A5 test re-fed with the REAL builder's output (the honest parity pin); the import families re-run 61/61 + 47/47.

### 2.3 UI-320 — the ReEnrollModal's devis was priced at a hardcoded « 1ère année primaire » (HIGH)

- **Problem:** `computeBilling` received `level: "primaire", gradeYear: 1` hardcoded — every re-enrollment into any grade other than 1AP quoted primaire first-year rates while the PERSISTED wires billed the confirmed grade (a lycée student shown primaire prices; the parent signs numbers the system will not persist).
- **Evidence:** `re-enroll-modal.tsx` ~105-106 (the hardcoded pair) vs ~149 (the persisted `gradeLevel: gradeLevelCode`); `compute-billing.ts:62` derives the grade exclusively from the pair; the naive derivation is LOSSY for `prescolaire_1` (primaire/0 round-trips to `prescolaire_2` — 135,000 vs 165,000 DZD).
- **Root cause:** the modal was built against the wizard's `Step2Student` shape while the re-enrollment flow's canonical fact is the confirmed `gradeLevelCode`; the adapter step was never written.
- **Impact:** every non-1AP re-enrollment's quote (the devis panel + the tranche preview).
- **Fix:** the additive optional `gradeLevel` override on the billing input (the lossless path), consumed ahead of the pair, wired from the modal + the useMemo dependency (the quote recomputes on grade change). Commit `80ccfe8`.
- **Regression coverage:** `t-439-re-enroll-devis-grade.test.ts` 5/5 — 4 RED pre-fix (the 3AM CEM price, the every-grade sweep, the prescolaire_1 lossless path, the devis-vs-wires PARITY pin) then GREEN.

### 2.4 SEC-115 — the four 0130 ER-PMAE RPCs had NO caller-tenant guard (CRITICAL)

- **Problem:** all four resolved `coalesce(p_tenant_id, public.current_tenant_id())` with no mismatch guard — any authenticated principal (including parent-portal accounts the er_* RLS explicitly excludes) could pass ANY `p_tenant_id` and merge/unmerge/decide against another tenant's identity data through the SECURITY DEFINER functions (RLS is bypassed by construction; the RPC was the only gate and it had none).
- **Evidence:** `0130_er_pmae_identity_resolution.sql:293/446/608/749` vs the 0128 convention (`fn_resolve_reenrollment_tenant` — `raise 42501 on caller tenant mismatch`, with the service_role/global-admin exemption) written one session EARLIER.
- **Root cause:** the experimental-gating focus (INV-40/INV-50 — the flag is OFF, the tables empty) led to the RPC hardening being treated as implied by RLS.
- **Impact:** the ER mutators (identity merges re-pointing students/payments/installments/ledger) reachable cross-tenant by any authenticated caller.
- **Fix:** migration `0132_er_rpc_tenant_guards.sql` — the shared `fn_er_resolve_tenant` helper (the 0128 pattern verbatim) + the four functions recreated VERBATIM (line-diff-verified: only the guard block changed; 0131's cast fix preserved) + the §15.34 grants + the T-091 registration. Commit `599fe0b` (merge).
- **Regression coverage:** `verify_t-439.sql` (C1 the mismatch 42501 · C1b the unresolvable caller · C2/C3 the elevated/session paths · C4/C6 the decide/merge/unmerge happy paths preserved · C5/C5b/C7b the cross-tenant refusals THROUGH the RPCs · C8 the registration · C9 the ACLs) — sqlglot-validated; **the LIVE application is BLOCKED** (see §5).
- **Interim mitigation:** the experimental flag remains OFF on every desktop (the only path to the RPCs is the gated review flow).

### 2.5 IDENT-103 — the ER import bindings leaked ACROSS FILES + the stale matcher on flag-off (HIGH)

- **Problem:** (a) the commit-time matcher was built from EVERY approved/executed proposal in the repository — not scoped to the current run — and the observation ids were unqualified `import:row:${rowIndex}` (contradicting the documented `xlsx:<file>:row-N` convention): an approval of row 42 in file A silently bound row 42 of file B (a different family) to file A's target with confidence 1 (an INV-50 violation — zero confirmation for file B; on Supabase the leak crossed operators/desktops); (b) `getEngine` only ever ADDED a matcher — once a commit ran with one, flag-OFF still routed the import through the stale matcher (INV-40 false within a modal's lifetime).
- **Evidence:** `excel-import-modal.tsx` ~153-155 (the additive-only condition) + ~326-340 (the unscoped filter); `er-matcher.ts:45` (the unqualified id); `types.ts:40` (the documented convention the code never followed).
- **Root cause:** the review flow assumed one modal = one file = one run; the persistent proposal store was wired into the binding builder without the run/file qualifier.
- **Fix:** the source-qualified ids (legacy shape preserved byte-identically), the pure `buildCurrentRunBindings` (run + row-id scoped, honest-empty on no-analysis), the matcher lifecycle on instance identity (add OR remove), the adapter seam qualified through `entityMatchSourceSystem`. Commit `76eb52c` (merge).
- **Regression coverage:** `t-439-er-binding-scope.test.ts` 11/11 (the happy path, THE cross-run leak, THE cross-file leak, rejected/proposed, the null-run degradation, non-canonical targets, the id collision matrix, the lifecycle source-pins); the t-438 families re-run 69/69 (two pins updated to the qualified convention — the old pins pinned the defect).

### 2.6 UI-321 — date-only facts rendered one day early on every UTC-negative machine (MEDIUM)

- **Problem:** `formatDate` parsed the UTC-midnight ISO every due date is stored as but formatted in the machine's LOCAL zone — the T-434/T-435 échéance lines displayed « 14 sept. 2026 » for a Sept 15 due date in the Americas, and the days-late suffix (pure UTC math) disagreed with the displayed date on the same card.
- **Evidence:** `core/format/date.ts` (the parse-UTC/format-local mismatch); proven by the audit (`TZ=America/New_York` failed 3 of the new t-434/t-435 assertions) and re-proven RED in this session.
- **Root cause:** date-only facts are stored as UTC-midnight instants; date-fns formats locally; the sessions ran TZ=UTC/+1 (Algeria unaffected) and could not see it.
- **Fix:** date-only strings render UTC; the échéance range formats through the new `formatDateUtc`; real datetimes keep their local wall time. Commit `2d6c0f3` (merge).
- **Regression coverage:** `t-439-utc-date-display.test.ts` 5/5 (TZ pinned in-suite); the RED reproduces the audit's exact 3 failures; with the fix BOTH zones green (27/27 each); the full ui/ family fails ONLY the 3 documented baseline files.

---

## 3. The documented-but-NOT-fixed findings (suspected/verified, deferred with evidence — each has its own registry entry with a fix order)

- **DATA-056** (MEDIUM, the year-history engine): the gap-year carried-forward chain (M1), the INV-18d allocation-year precedence that is documented but dead code (M2), the mixed paid+pending « Réglée » (M3), the SQL mirror's `reverses_entry_id` no-op (M4), and the unstamped writers (`bulkCollectWithProgress` + `register_family_batch`, M5 — the freeze guarantee is absent on both).
- **BUSINESS-110** (HIGH, owner-gated): the FI semantics divergence — the family-keyed FI source id drops every subsequent sibling's FI (`ON CONFLICT DO NOTHING`) while the devis SHOWS per-child FI; the re-enroll FI books into the student's `other` account instead of the family account (the 0128 RPC can't honor the wire's null `student_ref`); the wizard×re-enroll double-billing window (no existing-obligations guard); the batch path still year-blind (M4). **The business rule itself (per-family vs per-student FI) is a question only the owner can settle — registered in `unknowns.md`; M1/M3/M4 are implementable once the rule is settled.**
- **IDENT-104** (MEDIUM, the ER system): Arabic-script names DESTROYED by normalization (`normalizeName` strips every non-Latin letter — the school's Arabic-only rosters degrade to phone-only matching and are hard-vetoed); the merge re-points only 4 of ≥9 parent-FK tables (`invoices`, `receipts`, `account_adjustments`, `parent_student_links`, `activation_codes` left dangling); the decide+merge two-RPC non-transactionality; the dead `negativePairs` wiring; **the Supabase-mode backup captures EMPTY ER sections** (the backup service reads the mock arrays directly — production ER state is in NO backup — the first real exercise of the feature would run without a safety net); the dummy-phone gaps; the order-sensitive edge-pair guard; the absent DOB; the dead cluster-density protection.
- **UI-322** (LOW, the échéance surfaces): the two clocks per card, the days-late anchor over settled rows, the cross-surface fallback inconsistency, the surviving hardcoded hints, the same-named `daysBetweenFloor` twins, the unpinned import date claims.
- Also verified-and-OK to close: the T-434 DATA-050 surface-swap and T-435 consolidation claims re-verified correct; the T-437 extraction is behavior-preserving (line-by-line); the 0128/0129/0130 RLS + guards (other than 0130's tenant guard) are sound; the T-438 engine's vetoes/determinism/banding verified.

## 4. The Excel source-of-truth re-verification (Area 1 of the mandate)

- **WB2 vs WB1:** the import engine's workbook detection handles both layouts through the same `buildInstallmentRows` (verified in the T-434/435 audit); the T-435 consolidation of the tranche-date derivation onto `getOfficialTuitionDueDates` produces **byte-identical stored dates** for every realistic year (re-verified against the pre-T-435 diff). The **preflight year-scoping fix (DATA-055) is what makes the NEXT-year workbook importable** — the exact format-variation class the mandate flagged.
- **No legacy/new configuration conflict found:** the old "fictional price book" (CALC-001, fixed in the 55th session) has no surviving write path; the pricing precedence (PricingConfig override → the REAL matrix) is consistent across the devis, the wires, and the import.
- **The financial oracle stands:** the T-425/T-433 census (1,130/1,138 exact, the 7 divergences explained, Encaissé 162,713,000 DZD exact) is the recorded Excel-oracle verification; no commit since 5bd8ad3 touches the imported corpus or the waterfall. The T-439 fixes change only classifications/identities/displays — the amounts are untouched (the regression suites pin this: the owner's 100k/80k/20k scenario byte-identical; the devis-vs-wires parity pin).
- **The 6 override families** (+433,500 DZD of hand-adjusted créance) remain the documented difference between the workbook and the DB — still awaiting the owner's REMISE/DETTES recording decision (standing queue item).

## 5. Blocked / could not be run

1. **The LIVE application of migration 0132 (SEC-115):** the provided `SUPABASE_ACCESS_TOKEN` (`sbp_9e83…d78b`) returns **401 Unauthorized on every Management-API endpoint** (GET `/v1/projects` included); the `sb_secret` key is valid on the data gateway (verified: a 200 read) but the Management API rejects it (`JWT could not be decoded`); no runtime SQL-exec RPC exists (by design). **Next step: export a fresh valid token and run `elimtiyaz-desktop/scripts/apply_0132_live.sh` + `scripts/verify_t-439.sql`** (or paste the migration into the dashboard SQL editor). The migration is syntax-validated (sqlglot, 16 statements) and verbatim-diff-verified.
2. **The full end-to-end sync/backup/restore live battery** (Area 3.C–E of the mandate): the desktop's backup/restore/sync architecture was audited at the code level (the ER backup gap is IDENT-104 M5; the year-history restore paths verified in the T-436/T-438 suites), but the live backup/restore round-trip with the new migrations could not be exercised without Management-API access. The mock-tier round-trips are pinned by the existing suites (re-run green).
3. **The Excel import with REAL workbooks against the year-scoped preflight:** the unit suites pin the semantics (the next-year INSERT, the same-year no-op) with the fake/mock clients; the live WB2 corpus is single-year, so the multi-year preflight behavior has no live data to exercise yet (by design — the school transitions years at re-enrollment time).

## 6. The verification stack (what actually ran)

- **Baseline:** tsc exit 0 · FULL vitest **4,389 passed / 18 failed** — the failing SET byte-identical to `scripts/test-baseline.json`'s 9 documented environment-class files.
- **Per fix:** each regression suite **RED against the defective code** (stashed-fix runs) then GREEN; the neighboring families re-run (the ledger family 94/94 · the import families 61/61 + 47/47 · the CRM family 22/22 · the ER family 69/69 · the échéance suites 27/27 under BOTH TZ=UTC and TZ=America/New_York); eslint 0 errors on every changed file (the pre-existing warnings verified by stash).
- **The post-fix full run:** recorded in the change-log session entry (the count = the baseline + the 36 new T-439 tests, the failing SET unchanged).
- **check:migrations append-only:** OK (128 files, chain head 0132).

## 7. What should be tackled next (in order)

1. **The owner: a fresh SUPABASE_ACCESS_TOKEN** → apply 0132 + run verify_t-439 (the CRITICAL guard goes live).
2. **The owner: the FI ruling** (BUSINESS-110 / `unknowns.md`) → then the sibling-FI/account/double-bill fixes in one migration + builder pass.
3. **IDENT-104 M5** (the ER backup sections through the repository tier) — before the first real ER exercise.
4. **IDENT-104 M2** (the merge re-pointing of the 5 remaining tables) + **M1** (Arabic normalization) — migration 0133 + the Unicode pass.
5. **DATA-056 M5** (stamping `bulkCollectWithProgress` + `register_family_batch`) — one migration + two write paths.
6. The standing queue (SPREAD-100 · the 6 override families · the T-429 ports).
