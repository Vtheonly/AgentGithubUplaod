> **ARCHIVAL COPY — DO NOT EDIT.**
>
> This is the **first-pass audit** (86 findings, agents 2-a/2-b/2-c per-repo scans + cross-repo analysis), produced 2026-08-28/29 during the read-only audit of the three El-Imtiyaz repositories. It is preserved **verbatim** as historical evidence; only this banner was added when it was archived.
>
> - The **authoritative, consolidated** version of every finding is [`docs/recovery/problem-registry.md`](../recovery/problem-registry.md) (145 problems). Some IDs in this report were merged into parent entries, absorbed via extend-chains, or renumbered to resolve collisions — see the registry header ("Consolidation rules applied") and [`docs/audits/README.md`](README.md) for the mapping.
> - File paths below reference the audit-time checkout locations (e.g. `/home/z/my-project/repos/…`) and are frozen as written.
> - Severity/status statements describe the codebase **at audit time**, not the current state. For the current state see [`docs/recovery/current-state.md`](../recovery/current-state.md).
> - **Read-only evidence.** Never edit this file; record new findings ONLY in the problem registry.

---

# Audit Worklog — Shared Multi-Agent Log

This file is the SINGLE shared work log for the 3-repository audit.
All agents (parent + 3 parallel per-repo agents) append below using the standard template.

## Audit Scope

Three repositories treated as ONE application:
- `/home/z/my-project/repos/AgentGithubUplaod/` — Desktop app (`elimtiyaz-desktop/` subdir) + docs + `Suivis clients 2026_2027.xlsx`
- `/home/z/my-project/repos/elimtiyaz-android/` — Android app + `supabase/` backend
- `/home/z/my-project/repos/elimtiyaz-website/` — Next.js website + `supabase/` backend

Audit type: **READ-ONLY**. No modifications, no commits, no file creation inside the repos.

## Output Format

Final deliverable: comprehensive markdown audit report (16 sections) in chat.

Severity scale: **Critical / High / Medium / Low**

Problem-register ID prefixes:
- `DUP-NNN` — Duplicate implementations
- `DRIFT-NNN` — Architectural drift
- `REG-NNN` — Regressions / likely regression points
- `DEAD-NNN` — Dead / unused / obsolete code
- `CROSS-NNN` — Cross-platform inconsistencies
- `BUSINESS-NNN` — Business logic inconsistencies (financial, academic, student, payment, receipt, balance)
- `ARCH-NNN` — Architectural inconsistencies
- `WEAK-NNN` — Weak / shallow / suspicious implementations
- `SEC-NNN` — Security-sensitive weaknesses

## Per-Repo Agent Assignments

- Task ID `2-a` → AgentGithubUplaod (Desktop) — assigned agent
- Task ID `2-b` → elimtiyaz-android — assigned agent
- Task ID `2-c` → elimtiyaz-website — assigned agent

Each agent: read worklog, scan repo deeply, run git log/blame on suspicious files, append findings below.

---
Task ID: 2-a
Agent: general-purpose (AgentGithubUplaod auditor)
Task: Deep audit of /home/z/my-project/repos/AgentGithubUplaod/ (Desktop app)

Work Log:
- Read shared worklog
- Inventoried 737 files (excluding .git and node_modules); 304 .ts + 177 .tsx + 42 .sql + 45 JSON scenarios + 8 YAML scenarios + ~30 docs
- Ran git log on suspicious files (commit count: 87, earliest 2026-08-04 "first commit")
- Cross-referenced against /home/z/my-project/repos/elimtiyaz-android/supabase/migrations (only 0034-0036, 0040-0042 present — no base schema) and /home/z/my-project/repos/elimtiyaz-website/supabase (divergent migration numbering)
- Identified 25 findings (10 Critical/High, 8 Medium, 7 Low)

Repo Summary:
- Language(s): TypeScript (React 18 + Vite 6 + Electron 33 + Supabase-js 2), SQL (plpgsql), Deno (Edge Functions), Kotlin mirror (TS port), Bash/PowerShell (.sh)
- Framework(s): React 18, Vite 6, Electron 33, Vitest 2, TanStack Query/Table, Radix UI, Tailwind 3, react-hook-form, zod, dinero.js, exceljs, pdf-lib, @supabase/supabase-js; Supabase Postgres + Deno Edge Functions
- Entry point(s): `elimtiyaz-desktop/electron/main.ts` (Electron main), `elimtiyaz-desktop/src/main.tsx` (renderer), `elimtiyaz-desktop/index.html` (Vite root), 11 Supabase Edge Functions under `elimtiyaz-desktop/supabase/functions/*/index.ts`
- Total commits: 87 (most with single-word messages like "kay", "mid", "okay", "coool" — very poor commit hygiene)
- Total source files: 481 .ts/.tsx in src + 42 SQL migrations + 11 Edge Functions + ~80 financial-tests files + 30 docs

Findings:

### FINDING DUP-001 — Four parallel cross-platform equivalence test frameworks

- **What:** The repo carries FOUR overlapping test frameworks that all verify the same thing — that the desktop, Android, website, and backend produce equivalent financial state for the same inputs. Each has its own scenario format, runner, comparator, and types. The 4 frameworks are: (1) `financial-tests/scenarios/*.yml` (8 hand-written YAML scenarios, run by `src/test/cross-platform/ScenarioRunner.test.ts`); (2) `financial-tests/equivalence/` (TS framework with 45 JSON scenarios + generator + desktop/android/backend runners + comparator + regression archive — committed regression JSON files include duplicates with two timestamps 2026-08-19 and 2026-08-27); (3) `financial-tests/equivalence-live/` (Node mjs framework with 11 "layers" + executor + cleanup + real-DB adapters, runs against live Supabase); (4) `financial-tests/cross-platform-v2/` (yet another TS framework with its own `types.ts`, `compare.ts`, `normalize.ts`, `adapters/backend/supabase-shim.sql`). The README of `equivalence-live` itself admits the three other frameworks and tries to position itself as complementary.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/financial-tests/{scenarios,equivalence,equivalence-live,cross-platform-v2}/`
- **Lines:** `financial-tests/README.md` (120 lines), `financial-tests/equivalence/README.md` (256 lines), `financial-tests/equivalence-live/README.md` (121 lines), `financial-tests/cross-platform-v2/types.ts` (223 lines)
- **Category:** DUP
- **Severity:** High
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** `financial-tests/equivalence/` is the most complete (525 scenarios claimed, 45 committed regression cases, Android + desktop runners, generator). The other three are partial duplicates.
- **Whether this duplicate is actually used:** Yes — all four are committed and contain real test code; `equivalence-live` was last modified 2026-08-23, `cross-platform-v2` 2026-08-27 (the latest commit on the repo).
- **What depends on it:** `npm test` (vitest) runs `src/test/cross-platform/*.test.ts` which calls into the `equivalence/` scenarios; `equivalence-live/run.mjs` is run manually; `cross-platform-v2/compare.ts` appears to be a newer replacement.
- **Other platforms/layers affected:** Android runs `app/src/test/.../AndroidEquivalenceRunner.kt` mirroring `equivalence/android/AndroidEquivalenceRunner.kt`; the website has a canonical module per the v2 README.
- **Behavioral differences:** The yml DSL is the simplest (8 scenarios, only 5 operation kinds); `equivalence/` adds 45 scenarios with 11 categories and a comparator; `equivalence-live/` adds 11 layers (UI input, validation, business logic, financial, academic, CRM, API, DB, audit, document, sync) and runs against real DB; `cross-platform-v2/` adds academic/crm/aging/sync/backend_hidden domains and a 4-way comparator. Each has subtly different normalization rules.
- **Confidence:** Confirmed
- **Git evidence:** `financial-tests/equivalence-live/README.md` introduced `02fa7825` (2026-08-23); `financial-tests/cross-platform-v2/types.ts` introduced `84dd13f` (2026-08-27 — the latest commit). Both post-date `financial-tests/equivalence/` which was introduced much earlier.
- **Likely root cause:** Each successive audit wave ("Tier 2", "Tier 3", "Tier 4", "live", "v2") introduced a new framework instead of extending the existing one. The docs in `docs/development/` reference 4 verification passes (`vault-compliance-verification.md`, `-2.md`, `-3.md`), each adding its own test scaffold.
- **Potential impact:** Maintenance burden — adding a new scenario requires touching 4 frameworks. Behavioral drift between the four comparators could mask real cross-platform discrepancies. ~200+ files of test code (~10% of the repo) are dedicated to this single concern.
- **Code snippet:**
```
financial-tests/
├── scenarios/*.yml              # original DSL (8 scenarios)
├── equivalence/                  # TS framework (45 + 500 generated)
│   ├── scenarios/, regression/, comparison/, desktop/, android/
├── equivalence-live/            # Node mjs framework (live DB)
│   ├── layers/01..11_*.mjs, lib/, run.mjs
└── cross-platform-v2/           # Yet another TS framework
    ├── types.ts, compare.ts, normalize.ts, adapters/backend/
```

### FINDING DUP-002 — Duplicate `kotlin_mirror_engine.ts` in two locations with drifted logic

- **What:** A ~1300-line TypeScript port of the Android Kotlin financial engine exists in TWO places. The two copies have drifted: the `financial-tests/equivalence/android_mirror/kotlin_mirror_engine.ts` (1313 lines) has a "canonical" filter that drops both null AND empty strings before joining identity fields for the parent_code hash, mirroring a desktop fix. The `src/test/cross-platform/_tier4/kotlin_mirror_engine.ts` (1311 lines) is the older version — it filters null+undefined but keeps empty strings, producing different parent codes. Also: `maxOf(a, b)` accepts `b: string` in the older copy and `b: string | null` in the newer one.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/financial-tests/equivalence/android_mirror/kotlin_mirror_engine.ts` AND `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/test/cross-platform/_tier4/kotlin_mirror_engine.ts`
- **Lines:** `kotlin_mirror_engine.ts:785-791` (newer, canonical filter) vs `:787-789` (older, no empty-string filter); `:297-298` (`maxOf` signature); `:852` (`as const` vs `as Record<string,string>`)
- **Category:** DUP
- **Severity:** High
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** The `financial-tests/equivalence/android_mirror/kotlin_mirror_engine.ts` is canonical (newer, has the fix). The `src/test/cross-platform/_tier4/kotlin_mirror_engine.ts` is the stale duplicate.
- **Whether this duplicate is actually used:** Yes — the `_tier4/` copy is imported by `src/test/cross-platform/Tier4Invariants.test.ts`, `Tier4OperationSequences.test.ts`, `Tier4SyncRoundTrip.test.ts`, `Tier4PropertyBased.test.ts`, `Tier4ConflictResolution.test.ts`, `Tier4BoundaryConditions.test.ts`. The `financial-tests/equivalence/android_mirror/` copy is imported by `android_mirror_runner.ts` and `desktop_runner.ts`.
- **What depends on it:** 6 Tier4 tests depend on the stale copy; the cross-platform run pipeline depends on the newer copy. If the same scenario is run through both, the parent_code computation may diverge.
- **Other platforms/layers affected:** This is a TS mirror of the real Kotlin engine; the divergence between the two TS mirrors means one set of tests is verifying against a stale version of the Android behavior.
- **Behavioral differences:** Empty-string identity fields produce different parent codes; the const assertion changes type strictness.
- **Confidence:** Confirmed (diff confirmed via `diff -q`)
- **Git evidence:** Both files last touched in `2e2b21a` (2026-08-28 "fix(equivalence): canonical overdue mirror + as-of RPCs + pending-capacity fix (A-0042)")
- **Likely root cause:** The `_tier4/` copy was created when Tier 4 tests were added; later canonical fixes were applied to the `equivalence/android_mirror/` copy but not back-ported to the `_tier4/` copy.
- **Potential impact:** Tier 4 cross-platform tests verify behavior against a stale Kotlin mirror — they may pass while the real Android app + the canonical mirror both produce different results.
- **Code snippet:**
```ts
// NEWER (financial-tests/equivalence/android_mirror/kotlin_mirror_engine.ts:787)
    .filter((s): s is string => s !== null && s !== undefined)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)        // ← canonical empty-filter
    .join("|");

// OLDER (src/test/cross-platform/_tier4/kotlin_mirror_engine.ts:785)
    .filter((s): s is string => s !== null && s !== undefined && s !== "")
    .join("|")
    .trim();
```

### FINDING DRIFT-001 — Mock parent repository uses `Math.random()` for `parent_code`, violating canonical §7.1

- **What:** `CANONICAL-FINANCIAL-LOGIC.md §7.1` mandates that `parent_code` MUST be deterministic — derived from a FNV-1a hash of `(firstName, lastName, primaryPhone, year)`, formatted `PAR-{year}-{4-char-hash}`. The Supabase-backed parent repository correctly calls `deterministicParentCode()`. The MOCK parent repository still calls `randomParentSuffix()` which uses `Math.random()` to produce a 4-char suffix. This means the same parent input produces DIFFERENT parent codes on each create call in mock mode — breaking idempotency in dev/test. The two repositories (mock + Supabase) diverge on a canonical rule.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/mock/repositories/parent-repository.ts:61` (consumer) and `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/core/format/id.ts:34-42` (definition)
- **Lines:** `parent-repository.ts:61`: `code: \`PAR-${year}-${randomParentSuffix()}\`,`
- **Category:** DRIFT
- **Severity:** High
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:197-216` `deterministicParentCode(year, input)` — FNV-1a hash of trimmed non-empty identity fields joined by `|`.
- **Whether this duplicate is actually used:** Yes — `randomParentSuffix` is imported by `mock/parent-repository.ts:17` and called on line 61 for every parent creation in mock mode.
- **What depends on it:** Any test or dev-mode flow that creates a parent through the mock repository. Specifically, batch registration in mock mode (`MockStudentRepository.batchRegister`) eventually creates parents via this path.
- **Other platforms/layers affected:** Android's `LocalStudentRepository.batchRegister` had the same bug per `docs/financial-logic-comparison/financial-logic-comparison-v2.md` (D35) — random parent_code. The Android app may still have this issue; cross-platform identity matching fails if either side uses random codes.
- **Behavioral differences:** Mock mode → random codes, no idempotency. Supabase mode → deterministic FNV-1a codes, idempotent. Re-importing the same Excel row in mock mode creates duplicates; in Supabase mode it correctly upserts.
- **Confidence:** Confirmed
- **Git evidence:** `src/core/format/id.ts` last modified in `84dd13f` (2026-08-27 "okay") — `deterministicActivationCode` was added but `randomParentSuffix` left in place. `mock/parent-repository.ts:61` last modified in `0f442a1` (2026-08-23 "mid") — never updated to use deterministic codes.
- **Likely root cause:** The canonical rule was added late (the supabase path got the fix in vault §02.08 verification, see `vault-compliance-verification-3.md`), but the mock path was never updated. The mock repo and the Supabase repo drift independently.
- **Potential impact:** Tests in mock mode cannot reproduce idempotency bugs that manifest in production (Supabase mode). Re-running tests produces different parent IDs, breaking snapshot tests. Code paths that should be exercised (e.g., duplicate Excel imports creating the same parent) are never tested.
- **Code snippet:**
```ts
// src/core/format/id.ts:34-42
export function randomParentSuffix(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}

// src/infrastructure/mock/repositories/parent-repository.ts:58-61
const parent: Parent = {
  id: `par-${String(seq).padStart(3, "0")}`,
  tenantId: TENANT_ID,
  code: `PAR-${year}-${randomParentSuffix()}`,  // ← random, violates canonical §7.1
```

### FINDING DEAD-001 — `randomActivationCode()` export is dead code; canonical rule mandates deterministic

- **What:** `src/core/format/id.ts:45-47` exports `activationCode()` which uses `Math.random()` to produce a 6-7 digit numeric code. The canonical spec §7.1 mandates that activation codes MUST also be deterministic — `deterministicActivationCode(parentCode, tenantId)` (FNV-1a over `tenantId|parentCode`, mapped to 6-digit range). The random version is no longer called by any production code (only imported as alias `randomActivationCode` in a single test that does string-snippet inspection, not actual generation).
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/core/format/id.ts:45-47`
- **Lines:** `id.ts:44-47`:
```ts
/** Generate a 6-7 digit numeric activation code (plan §02). */
export function activationCode(): string {
  return String(Math.floor(100_000 + Math.random() * 9_000_000));
}
```
- **Category:** DEAD
- **Severity:** Medium
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/core/format/id.ts:63-74` `deterministicActivationCode(parentCode, tenantId)` — FNV-1a hash, deterministic.
- **Whether this duplicate is actually used:** No — confirmed via Grep, the only reference outside the definition is a single import in `src/tests/integration/vault-compliance-architecture.test.tsx:29` aliased as `randomActivationCode`, used only to inspect the source string of `deterministicActivationCode` (not actually invoked). The Supabase repository uses `deterministicActivationCode` (line 497).
- **What depends on it:** Nothing in production. Misleading API surface for future developers who might call it.
- **Other platforms/layers affected:** N/A
- **Behavioral differences:** Calling `activationCode()` would produce non-deterministic codes that violate canonical §7.1; calling `deterministicActivationCode(parentCode, tenantId)` produces canonical codes. The function is a footgun for future code.
- **Confidence:** Confirmed (grep returned only definition + test import)
- **Git evidence:** Introduced in `b25e6ca` (2026-08-04 "FKFKFK") — initial commit batch. `deterministicActivationCode` added later in `84dd13f` (2026-08-27).
- **Likely root cause:** The deterministic version was added later (per `vault-compliance-verification-3.md`); the random version was left as a dead export rather than deleted.
- **Potential impact:** Low direct impact (dead code), but if a future agent calls `activationCode()` they will silently produce non-canonical codes that break idempotent activation flows. Also: the random version is shorter range (100_000..9_099_999 = 9M codes) than canonical (100_000..999_999 = 900K) — collision risk differs.
- **Code snippet:**
```ts
// Dead code — never called in production
export function activationCode(): string {
  return String(Math.floor(100_000 + Math.random() * 9_000_000));
}

// Canonical replacement that IS called
export function deterministicActivationCode(parentCode: string, tenantId: string = ""): string {
  const identity = `${tenantId}|${parentCode}`.trim();
  if (identity.length === 0) return "000000";
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < identity.length; i++) {
    h = (h ^ identity.charCodeAt(i)) | 0;
    h = Math.imul(h, 0x01000193) | 0;
  }
  const unsigned = h >>> 0;
  const numeric = (unsigned % 900_000) + 100_000;
  return numeric.toString();
}
```

### FINDING BUSINESS-001 — `reconcileFinancials()` runs only 4 of 6 canonical cross-checks

- **What:** `CANONICAL-FINANCIAL-LOGIC.md §4 INV-9` states "The reconciler MUST run all 6 cross-checks. A reconciler that runs only 3 is broken." The 6 checks are: `crossCheckPayments`, `crossCheckInstallments`, `crossCheckBalanceSum`, `crossCheckInstallmentPayments`, `crossCheckClearedBalance`, `crossCheckParentCredit`. The orchestrator `reconcileFinancials()` in `src/domain/calc/reconcile/reconciliation.ts` only runs 4 of these — it omits `crossCheckBalanceSum` and `crossCheckParentCredit`. They are imported and re-exported (line 63) but never invoked in the function body. The desktop_runner.ts (test harness) explicitly notes "Always run crossCheckBalanceSum (it only needs entries)" (line 560) — implying the production code does NOT always run it, and the test runner has to compensate.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/domain/calc/reconcile/reconciliation.ts:20-39`
- **Lines:** `reconciliation.ts:25-36` — the function calls `reconcileLedger()` (which runs 7 invariants checks but 0 cross-checks), then 4 cross-checks (Payments, Installments, ClearedBalance, InstallmentPayments). Missing: BalanceSum, ParentCredit.
- **Category:** BUSINESS
- **Severity:** Critical
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** The cross-platform test runner at `financial-tests/equivalence/desktop/desktop_runner.ts:560-620` runs all 6 checks correctly.
- **Whether this duplicate is actually used:** Yes — `reconcileFinancials` is the production orchestrator; it's what the desktop app calls when the user clicks "Reconcile ledger". Its result feeds the audit log + the financials UI.
- **What depends on it:** Any production call site that wants a unified reconciliation report (likely the settings → audit log tab, the financials page reconcile action, and the mock ledger repository's `reconcile()` method).
- **Other platforms/layers affected:** The SQL backend's `reconcile_parent` RPC was dropped in migration 0034. The Android app's `LedgerEngine.reconcile()` runs 3 cross-checks per `financial-logic-comparison-v2.md` (D7) — also not 6. So the desktop's "4 of 6" is actually the BEST of the three platforms, but still incomplete vs canonical.
- **Behavioral differences:** Production reconciliations will NOT detect `BALANCE_SUM_MISMATCH` (sum of entries ≠ sum of account balances) or `UNBACKED_PARENT_CREDIT` (negative balance on a non-parent-credit account). These are exactly the invariants that catch silent data corruption from sync drift or partial RPC failures.
- **Confidence:** Confirmed
- **Git evidence:** `src/domain/calc/reconcile/reconciliation.ts` last modified in `badeae9` (2026-08-15 "mm") — predates the canonical logic doc (2026-08-20) and the cross-platform equivalence work. Never updated to add the missing 2 checks.
- **Likely root cause:** The orchestrator was written before the 3 new cross-checks (crossCheckInstallmentPayments, crossCheckClearedBalance, crossCheckParentCredit) were added in the financial refactor. The first 2 were wired in; the third + the older BalanceSum were not. The re-export at the bottom was added "for completeness" without wiring it into the orchestrator.
- **Potential impact:** Silent data corruption goes undetected. Specifically: if a `parent_credit` adjustment is accidentally written on a student-scoped `tuition` account (a bug the v2 audit flagged as D3 on Android), production reconcile will not flag it. If ledger entries are silently dropped during sync (sum of entries ≠ sum of balances), production reconcile will not flag it.
- **Code snippet:**
```ts
// src/domain/calc/reconcile/reconciliation.ts:20-39
export function reconcileFinancials(ctx: ReconciliationContext): ReconciliationReport {
  const violations: ReconciliationViolation[] = [];
  violations.push(...reconcileLedger(ctx.ledger).violations);  // runs 7 invariants, 0 cross-checks
  violations.push(...crossCheckPayments(/* ... */));
  violations.push(...crossCheckInstallments(ctx.installments, ctx.ledger));
  violations.push(...crossCheckClearedBalance(ctx.payments, ctx.ledger));
  violations.push(...crossCheckInstallmentPayments(ctx.installments, ctx.ledger));
  // ❌ MISSING: crossCheckBalanceSum(ctx.ledger, balances)  — INV-9 violation
  // ❌ MISSING: crossCheckParentCredit(parentSummaries, ctx.ledger)  — INV-9 violation
  return summarize(ctx.ledger, violations);
}
```

### FINDING REG-001 — Chain of 9 "canonical engine unification" fix-up migrations after the "unification" was supposedly complete

- **What:** The "Shared Unification" docs (`docs/development/shared-unification.md`) declared that migrations 0026 + 0027 + 0028 unified the desktop + Android on a single canonical schema. Yet migrations 0034 through 0043 (10 migrations) are ALL fix-ups to that "canonical" unification: 0034 "Canonical Engine Unification (Backend Third-Implementation Fix)" — drops 17 divergent SQL functions; 0035 "Tier 3 Drop Signature Fixes" — re-drops functions that 0034 failed to drop due to wrong signatures; 0036 "Tier 4 Backend Hardening" — drops a legacy 1-arg overload that 0034's CREATE OR REPLACE accidentally created; 0037 "Cross-Platform Sync Hardening"; 0040 "Cross-Platform RPC Unification"; 0041 "Canonical Academic Flow"; 0042 "Canonical Overdue As-Of Equivalence"; 0043 "Portal Alignment". Each migration's header documents bugs the previous "canonical" version missed.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0034_*.sql` through `0043_*.sql` (10 files, totaling ~6,400 lines of SQL)
- **Lines:** See migration header comments (e.g., 0034:1-61 documents 17 divergent SQL functions; 0035:1-43 documents 2 wrong-signature drops; 0036:1-36 documents 6 hidden competing rules; 0042:1-42 documents 3 equivalence failures)
- **Category:** REG
- **Severity:** High
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** N/A — this IS the chain of canonical fix-ups.
- **Whether this duplicate is actually used:** Yes — all 10 migrations are committed and applied.
- **What depends on it:** The entire desktop + Android + website data layer. Each migration drops and recreates SQL functions; if a migration is skipped, downstream behavior diverges.
- **Other platforms/layers affected:** Android only has migrations 0034-0036, 0040-0042 (NOT 0037, 0038, 0039, 0041, 0043 — partial copy). Website has its own divergent migration numbering (0025 device_tokens, 0026 attendance, 0027 portal_parent_rls, 0028 notification_preferences) that COLLIDES with the desktop's 0025/0026/0027/0028.
- **Behavioral differences:** Without migration 0042, the SQL `compute_parent_summary` classifies overdue using `latestCharge.at <= p_as_of` JOINed to `installment.due_date` — divergent from the desktop engine's `MAX(charge.at) < now` rule. Without 0035, the divergent legacy `collect_payment` and `allocate_payment_waterfall` RPCs remain callable, allowing callers to bypass the canonical waterfall.
- **Confidence:** Confirmed
- **Git evidence:** 0034 introduced `5b0df5b` (2026-08-21 "kay") + `fb5dda8` (2026-08-23 "coool") + `b5a84cd` (2026-08-26 "kay") + `84dd13f` (2026-08-27 "okay"). 0042 introduced `2e2b21a` (2026-08-28 "fix(equivalence): canonical overdue mirror + as-of RPCs + pending-capacity fix (A-0042)") — the only commit with a descriptive message in the entire repo.
- **Likely root cause:** The original unification (0026/0027/0028) was done before the canonical spec was finalized. Each successive audit (Tier 2 → Tier 3 → Tier 4 → live → v2) found new divergences; each finding became its own migration rather than rolling back the original. The SQL layer accumulated 5+ competing implementations of the same financial logic before the fix-up chain consolidated them.
- **Potential impact:** Production databases that haven't applied ALL of 0034-0043 are running with KNOWN divergent business logic. The migration chain assumes idempotent application (every DROP uses IF EXISTS) but the canonical functions they depend on are NOT idempotent — if any one migration fails mid-transaction, downstream state is inconsistent.
- **Code snippet:**
```sql
-- 0034_canonical_engine_unification.sql:1-12
-- AUDIT FINDING (2026-08-20):
--   The backend SQL layer contained FIVE distinct implementations of the
--   financial engine logic, of which at least three were actively wired
--   into edge functions and could produce divergent state from the
--   canonical app-side engines (desktop TypeScript + Android Kotlin).

-- 0035_tier3_drop_signature_fixes.sql:5-19
--   Migration 0034 attempted to DROP several divergent SQL functions, but
--   two of the DROP statements used INCORRECT argument signatures. PostgreSQL
--   `DROP FUNCTION IF EXISTS` with a wrong signature silently issues a
--   NOTICE (not an ERROR) and the function REMAINS CALLABLE.

-- 0036_tier4_backend_hardening.sql:7-10
--   This migration closes the 6 hidden competing business rules found by the
--   Tier 4 backend audit.
```

### FINDING CROSS-001 — Migration numbering conflict between desktop and website Supabase folders

- **What:** The desktop repo's `supabase/migrations/` uses a sequence starting at 0001 and going to 0043. The website repo's `supabase/migrations/` uses the SAME numbering scheme but for DIFFERENT content: desktop 0025 = `waterfall_allocation`, website 0025 = `device_tokens`; desktop 0027 = `shared_unification`, website 0027 = `portal_parent_rls_policies`; desktop 0028 = `shared_schema_extensions`, website 0028 = `notification_preferences`. Supabase migration filenames are globally unique per project — if both sets are applied to the same Supabase project, the second `supabase migration apply` would either skip them (treating them as already-applied) or fail.
- **Where:** Desktop: `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0025..0028_*.sql`. Website: `/home/z/my-project/repos/elimtiyaz-website/supabase/migrations/0025..0028_*.sql`
- **Lines:** Desktop 0025 (`245_waterfall_allocation.sql`) vs Website 0025 (`0025_device_tokens.sql`); etc.
- **Category:** CROSS
- **Severity:** Critical
- **Repo/Platform:** AgentGithubUplaod (Desktop) ↔ elimtiyaz-website
- **Original/canonical implementation (if duplicate):** The desktop's migrations are the "canonical" financial/CRM/academic schema (0001-0043). The website's are portal-specific patches (device tokens, attendance justification, portal RLS, notification preferences).
- **Whether this duplicate is actually used:** Yes — both repos treat their `supabase/migrations/` as the source of truth for the SAME shared Supabase project.
- **What depends on it:** Both apps share the same Supabase backend per `docs/development/shared-unification.md` (architecture diagram line 213-229): "Both clients now read + write the SAME tables".
- **Other platforms/layers affected:** Android only has migrations 0034-0036, 0040-0042 (the canonical fix-ups) — Android's migration folder is a strict SUBSET, not a superset. The Android app expects the base schema (0001-0028) to already be applied by the desktop.
- **Behavioral differences:** If the website's `0025_device_tokens.sql` is applied first, the desktop's `0025_waterfall_allocation.sql` is silently skipped (Supabase tracks applied migrations by filename). Result: the desktop's waterfall allocator RPC is never created, but the desktop's code assumes it exists.
- **Confidence:** Confirmed
- **Git evidence:** Cross-repo ls confirmed the website folder has 4 migrations with conflicting numbers. The desktop's migration set was created 2026-08-04 to 2026-08-28.
- **Likely root cause:** Each repo independently numbered its migrations starting at 0001 (the Supabase convention), without coordinating with the other repos that share the same Supabase project.
- **Potential impact:** Database schema drift between dev (where one repo's migrations are applied) and prod (where the other's are applied). A website deployment could silently break the desktop's financial RPCs.
- **Code snippet:**
```
Desktop:                       Website:
0025_waterfall_allocation.sql  0025_device_tokens.sql          ← COLLISION
0026_unified_financial.sql     0026_attendance_justification_  ← COLLISION
0027_shared_unification.sql    0027_portal_parent_rls_policies ← COLLISION
0028_shared_schema_extensions  0028_notification_preferences   ← COLLISION
```

### FINDING WEAK-001 — `refund-payment` Edge Function does not block refunds of `cancelled` payments

- **What:** The `refund-payment` Edge Function fetches the original payment and only checks `if (originalPayment.status === "refunded") return 409`. The canonical `PaymentStatus` enum has TWO terminal states besides `refunded`: `cancelled` (administrative void). Per `CANONICAL-FINANCIAL-LOGIC.md §7.2`: "A refunded payment cannot be un-refunded. To 'undo' a refund, write a new compensating payment + adjustment — never mutate the refund row." The same logic should apply to cancelled payments — they are terminal. The function does not check for `cancelled`, so a cancelled payment could be passed to `revert_payment_allocation` RPC, which may produce a reversal entry against a payment that was never collected (no ledger entries to reverse).
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/refund-payment/index.ts:88-90`
- **Lines:** `refund-payment/index.ts:88-90`:
```ts
if (originalPayment.status === "refunded") {
  return jsonError(req, 409, "already_refunded", "This payment has already been refunded");
}
```
- **Category:** WEAK
- **Severity:** High
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** N/A — this is the only refund path.
- **Whether this duplicate is actually used:** Yes — this is the production refund edge function invoked from the desktop's Payment Detail Drawer.
- **What depends on it:** The desktop's refund UI; the canonical LIFO reversal flow.
- **Other platforms/layers affected:** Android's refund path is not audited here (read-only).
- **Behavioral differences:** A `cancelled` payment can be refunded via the edge function, producing a reversal entry against an empty ledger. The reconciler's `crossCheckPayments` (canonical §4 INV-9) would flag the spurious reversal as `PAYMENT_WITHOUT_LEDGER_ENTRY` (warning) but the reversal itself would persist.
- **Confidence:** Likely
- **Git evidence:** `refund-payment/index.ts` last modified in `5b0df5b` (2026-08-21 "kay") — never updated to add the `cancelled` check.
- **Likely root cause:** The author considered `refunded` (the most obvious terminal state) but missed `cancelled` (administrative void — distinct from refunded per canonical §7.2: "A refunded payment cannot be un-refunded" vs "A cancelled payment is administratively voided (distinct from refunded)").
- **Potential impact:** A cancelled payment that was never collected (no funds received) could trigger a LIFO reversal that subtracts from `installment.amountPaid`, producing a negative `amountPaid` (data corruption) or a spurious `parent_credit` adjustment (financial loss to the school).
- **Code snippet:**
```ts
// refund-payment/index.ts:84-95 — missing 'cancelled' check
if (fetchError || !originalPayment) {
  return jsonError(req, 404, "payment_not_found", "Original payment not found in this tenant");
}
if (originalPayment.status === "refunded") {
  return jsonError(req, 409, "already_refunded", "This payment has already been refunded");
}
// ❌ MISSING:
// if (originalPayment.status === "cancelled") {
//   return jsonError(req, 409, "already_cancelled",
//     "Cannot refund a cancelled payment — it was administratively voided");
// }
```

### FINDING DRIFT-002 — `refund-payment` Edge Function header comment lies about which RPC it calls

- **What:** The header comment block of `refund-payment/index.ts` (lines 5-7) says "Wraps the `public.refund_payment(p_tenant_id, p_payment_id, p_actor_profile_id, p_reason)` RPC function." But migration 0034 + 0035 DROPPED `refund_payment` from the database because it was a "divergent third implementation" (non-LIFO, single installment, broke paid_date). The function body actually calls `revert_payment_allocation` (line 100-106) — the canonical LIFO RPC. The stale header misleads anyone reading the code: they would expect `refund_payment` to exist in the database and might write SQL that calls it (which would fail with "function does not exist").
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/refund-payment/index.ts:5-7`
- **Lines:** `refund-payment/index.ts:5-7` (header) vs `:100-106` (actual call)
- **Category:** DRIFT
- **Severity:** Medium
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** The actual call to `revert_payment_allocation` (line 100) IS canonical.
- **Whether this duplicate is actually used:** The function itself is used (called from desktop Payment Detail Drawer); the misleading comment is read by maintainers.
- **What depends on it:** Anyone maintaining the edge function or debugging refund issues.
- **Other platforms/layers affected:** N/A
- **Behavioral differences:** None at runtime — only documentation drift.
- **Confidence:** Confirmed
- **Git evidence:** Header comment introduced in `5b0df5b` (2026-08-21 "kay") — predates migration 0034+0035 which dropped `refund_payment`. Migration 0034 was applied in `5b0df5b` (same commit), but the header was never updated.
- **Likely root cause:** Migration 0034 changed the RPC name but the developer didn't update the header comment.
- **Potential impact:** Misleading documentation; future maintainers may waste time looking for a `refund_payment` RPC that doesn't exist, or worse, re-create it (re-introducing the divergent third implementation that migrations 0034+0035 specifically dropped).
- **Code snippet:**
```ts
// refund-payment/index.ts:4-7 — STALE COMMENT
// Edge Function: Refund a previously collected payment (atomic reversal)
// ----------------------------------------------------------------------------
// Wraps the `public.refund_payment(p_tenant_id, p_payment_id,
// p_actor_profile_id, p_reason)` RPC function.    ← ❌ LIES — this RPC was DROPPED in 0034+0035

// refund-payment/index.ts:100-106 — ACTUAL CALL
const { data, error } = await supabase.rpc("revert_payment_allocation", {
  p_tenant_id: ctx.tenantId,
  p_payment_id: body.payment_id,
  p_actor_id: ctx.userProfileId,
  p_actor_name: ctx.userDisplayName ?? ctx.email ?? "Système",
  p_reason: body.reason.trim(),
});
```

### FINDING WEAK-002 — `collect-payment` Edge Function silently drops check/transfer structured fields

- **What:** The `collect-payment` Edge Function validates that `check_number` + `check_bank_name` are required for check payments (lines 95-102) and `transfer_reference` is required for transfer payments (lines 104-111). But the actual RPC call to `collect_and_allocate_payment` (lines 147-159) does NOT pass `p_check_number`, `p_check_bank_name`, `p_check_issue_date`, `p_check_clearance_date`, `p_transfer_reference`, or `p_transfer_source_bank`. Migration 0039 added these 6 params as optional (defaulting to NULL) "for backward compatibility" — but the edge function never actually sends them. Result: the user enters check #1234 + bank "BNP Paribas" in the desktop UI, the UI calls the edge function, the edge function validates the fields are present, then drops them and sends NULLs to the database.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/collect-payment/index.ts:147-159`
- **Lines:** `:94-111` (validation requires the fields); `:147-159` (RPC call omits them)
- **Category:** WEAK
- **Severity:** Critical
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** The desktop's direct Supabase path (`SupabasePaymentRepository.collect()` at `supabase-shared-repositories.ts:1059-1080`) DOES pass all 6 structured fields. The edge function is a separate, parallel path that doesn't.
- **Whether this duplicate is actually used:** Yes — the edge function is invoked when the desktop routes payments through the edge function path (e.g., mobile-triggered collections or external integrations).
- **What depends on it:** Any caller of the `collect-payment` edge function (mobile clients, third-party integrations).
- **Other platforms/layers affected:** The Android app per `shared-unification.md` is supposed to call the same upsert RPCs; if Android calls this edge function, the same fields are dropped.
- **Behavioral differences:** Direct desktop path → all structured fields persisted. Edge function path → all structured fields NULL in DB. Reconciliation later can't match a bounced check to its bank.
- **Confidence:** Confirmed
- **Git evidence:** `collect-payment/index.ts` last modified in `eeb82db` (2026-08-21 "right"). Migration 0039 (which added the optional params) was applied in a later commit — but the edge function was never updated to actually pass them.
- **Likely root cause:** Migration 0039's optional params created the illusion of backward compatibility — "older callers (Android, Edge Functions) that omit the new parameters behave EXACTLY as before" — but the edge function should NOT have been treated as an "older caller". The new params were meant to be sent when the caller has them.
- **Potential impact:** Check/transfer payments collected via the edge function have NULL check_number/bank_name/reference in the database. The Payment Detail Drawer shows blank fields. Bank reconciliation (matching cleared checks to bank statements) is impossible. Audit trail cannot trace which bank a specific check was drawn on.
- **Code snippet:**
```ts
// collect-payment/index.ts:95-102 — REQUIRES structured fields for check
if (body.method === "check") {
  if (!body.check_number || !body.check_bank_name) {
    return jsonError(req, 400, "missing_check_fields",
      "check_number and check_bank_name are required for check payments");
  }
  if (!body.proof_path) { /* ... */ }
}

// collect-payment/index.ts:147-159 — DROPS those fields when calling the RPC
const { data, error } = await supabase.rpc("collect_and_allocate_payment", {
  p_tenant_id: ctx.tenantId,
  p_parent_id: body.parent_id,
  p_student_id: body.student_id ?? null,
  p_amount: body.amount,
  p_method: body.method,
  p_category: categoryFilter,
  p_installment_id: body.installment_id ?? null,
  p_proof_path: body.proof_path ?? null,
  p_notes: body.notes ?? null,
  p_actor_id: ctx.userProfileId,
  p_actor_name: ctx.userDisplayName ?? "Système",
  // ❌ MISSING: p_check_number, p_check_bank_name, p_check_issue_date,
  //             p_check_clearance_date, p_transfer_reference,
  //             p_transfer_source_bank — validated but never sent
});
```

### FINDING BUSINESS-002 — `SupabasePaymentRepository.collect()` silently falls back to non-atomic upsert on RPC failure

- **What:** When the canonical `collect_and_allocate_payment` RPC fails for any reason (network glitch, RLS policy, schema drift, migration not yet applied), the desktop's `SupabasePaymentRepository.collect()` silently falls back to calling `upsert_payment_from_import` — a simple INSERT helper that does NOT run the waterfall, does NOT create the `parent_credit` adjustment for overpayments, and does NOT pass the structured check/transfer fields (p_check_number, p_check_bank_name, etc.). The fallback also uses the random `paymentNumber` (`PAY-YYYY-{random}`) instead of the canonical `REC-YYYY-{6-digit-seq}` format that the atomic RPC generates. The user sees "Payment collected" success toast while the financial state is silently broken (installments never move toward paid, overpayment never becomes parent_credit).
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:1086-1118`
- **Lines:** `:1086-1118` (the fallback path)
- **Category:** BUSINESS
- **Severity:** Critical
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** The atomic RPC `collect_and_allocate_payment` (migration 0034+0035+0039) is canonical. The fallback `upsert_payment_from_import` is the simple Excel-import helper RPC, never intended for interactive collections.
- **Whether this duplicate is actually used:** Yes — every interactive collection goes through `SupabasePaymentRepository.collect()`. If the atomic RPC ever fails (a single console.warn), the fallback kicks in.
- **What depends on it:** The Unified Payment Modal's `collect()` call (`unified-payment-modal.tsx:387`).
- **Other platforms/layers affected:** Android's `LocalPaymentRepository.collect` does the same waterfall + parent_credit internally (per shared-unification.md). If Android ever switches to a Supabase-backed repository that mimics this fallback pattern, it would have the same bug.
- **Behavioral differences:** Atomic path: payment + ledger entry + waterfall allocation + parent_credit adjustment + audit — all atomic. Fallback path: payment row INSERT only — no ledger entry, no waterfall, no parent_credit, no audit. The two paths produce wildly different state for the same input.
- **Confidence:** Confirmed
- **Git evidence:** `supabase-shared-repositories.ts` last modified in `84dd13f` (2026-08-27 "okay"). The fallback comment "Falls back to the simple upsert RPC if the function doesn't exist (older Supabase deployments that haven't run migration 0026 yet)" suggests it was meant for migration-not-applied scenarios, but the fallback triggers on ANY error (not just "function does not exist").
- **Likely root cause:** The fallback was added as a backward-compat shim for "older Supabase deployments" but the catch is too broad — it catches ALL errors, including transient ones, and silently downgrades the operation.
- **Potential impact:** A network glitch during payment collection produces a silently broken financial state. The reconciler would catch the missing ledger entry (`PAYMENT_WITHOUT_LEDGER_ENTRY` warning) but the warning may not be surfaced in the UI. The parent's balance and the installment's `amountPaid` diverge — a 100× financial impact for a 1-second RPC failure.
- **Code snippet:**
```ts
// supabase-shared-repositories.ts:1086-1118
if (atomicErr) {
  // Fall back to the legacy upsert RPC (no atomic waterfall).
  console.warn("[SupabasePayment] collect_and_allocate_payment failed, " +
    "falling back to upsert_payment_from_import:", atomicErr.message);
  const { data: fallbackData, error: fallbackErr } = await this.client.rpc(
    "upsert_payment_from_import",
    {
      p_tenant_id: tenantId,
      p_payment_number: paymentNumber,          // ← random PAY-YYYY-NNNNNN, not canonical REC-
      p_parent_id: input.parentId,
      p_student_id: input.studentId ?? null,
      p_amount: input.amount,
      p_method: input.method,
      p_category: input.category ?? "tuition",  // ← silent default to tuition
      p_status: null,
      p_proof_path: input.proofUrl ?? null,
      p_collected_at: input.collectedAt ?? new Date().toISOString(),
      p_collected_by: collectedBy,
      p_notes: input.notes ?? null,
      // ❌ NO p_check_number / p_check_bank_name / p_transfer_reference
      // ❌ NO waterfall allocation
      // ❌ NO parent_credit adjustment for overpayment
      // ❌ NO p_installment_id
    },
  );
  // ...
}
```

### FINDING BUSINESS-003 — `SupabasePaymentRepository.refund()` hardcodes `"Manual refund"` as the reason, drops user's reason + actor identity

- **What:** The desktop's `SupabasePaymentRepository.refund(id)` calls the canonical `revert_payment_allocation` RPC with `p_reason: "Manual refund"` — a hardcoded string. The user's actual refund reason from the UI (which the canonical spec §7.2 + the edge function both require to be ≥3 chars and meaningful) is never propagated. Worse: the actor identity is `getActorId()` / `getActorName()` which read from `localStorage` and fall back to `"excel-import"` / `"Excel Import"` when no session is loaded. So a manual refund performed by a financial officer named "Brahim Souilah" is recorded in the audit log as performed by "Excel Import" with reason "Manual refund" — completely useless for audit trail.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:1148-1157`
- **Lines:** `:1148-1157`:
```ts
async refund(id: string): Promise<Result<Payment>> {
  // ...
  const { error } = await this.client.rpc("revert_payment_allocation", {
    p_tenant_id: tenantId,
    p_payment_id: id,
    p_actor_id: getActorId(),                  // ← falls back to "excel-import"
    p_actor_name: getActorName(),              // ← falls back to "Excel Import"
    p_reason: "Manual refund",                 // ← hardcoded, ignores user's reason
  });
```
- **Category:** BUSINESS
- **Severity:** High
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** The `refund-payment` Edge Function (`refund-payment/index.ts:60-73`) correctly requires `body.reason` with ≥3 chars and passes it through.
- **Whether this duplicate is actually used:** Yes — this is the desktop's direct Supabase path (when Supabase mode is on and the desktop calls `repos.payments.refund()` directly without going through the edge function).
- **What depends on it:** The desktop's Payment Detail Drawer refund action.
- **Other platforms/layers affected:** The canonical `revert_payment_allocation` RPC records the reason + actor in the audit log; the audit log entries from this path are useless for compliance.
- **Behavioral differences:** Edge function path: real user + real reason. Direct Supabase path: "Excel Import" + "Manual refund". Same operation, two completely different audit records.
- **Confidence:** Confirmed
- **Git evidence:** `supabase-shared-repositories.ts` last modified in `84dd13f` (2026-08-27). The refund method signature `refund(id: string)` doesn't even accept a reason parameter — the API surface itself is broken.
- **Likely root cause:** The refund method was written before the canonical §7.2 rule was finalized. The signature `refund(id)` doesn't accept a reason; the implementation hardcodes one to satisfy the RPC's NOT NULL constraint.
- **Potential impact:** Audit log entries for refunds are non-compliant — they don't record who performed the refund or why. A financial officer disputing a refund has no evidence trail. Canonical §7.6 says "Every mutation MUST emit at least one audit entry" with `{actor, before, after}` — this path emits an audit entry but with garbage values.
- **Code snippet:**
```ts
// supabase-shared-repositories.ts:1148-1157 — direct Supabase refund path
async refund(id: string): Promise<Result<Payment>> {
  try {
    const tenantId = getTenantId();
    const { error } = await this.client.rpc("revert_payment_allocation", {
      p_tenant_id: tenantId,
      p_payment_id: id,
      p_actor_id: getActorId(),          // ← reads localStorage; fallback "excel-import"
      p_actor_name: getActorName(),      // ← fallback "Excel Import"
      p_reason: "Manual refund",         // ← HARDCODED; user's real reason dropped
    });
    // ...
  }
}
```

### FINDING ARCH-001 — Massive partial migration: 25+ repositories still mock-backed in "Supabase mode"

- **What:** `supabase-repositories.ts:79-172` (`getSupabaseRepositories()`) builds a `Repositories` object by spreading `mockRepositories` and overriding only ~19 of the ~45 repository slots with Supabase-backed implementations. The remaining ~26 repositories (clubs, psychology, orthophonie, teachers, expenses, releve, pricing, workflows, workflowRuns, aiConfig, backups, shifts, schedules, tasks, workforceAttendance, leaveRequests, performanceReviews, chat, onboarding, suppliers, purchaseRequests, deliveries, inventory, warehouseTasks, calendar, overdueAlerts) still use mock implementations. A user who enables "Supabase mode" expects production persistence, but their clubs, expenses, teachers, workflows, backups, calendar, personnel tasks, chat, leave requests, performance reviews, onboarding, suppliers, purchase requests, deliveries, inventory, and warehouse tasks are still in-memory only — lost on app restart.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/supabase-repositories.ts:79-172`
- **Lines:** `:137-162` — the override list. The comment at `:159-161` says "Other repositories remain on the mock layer for now. They will be ported incrementally."
- **Category:** ARCH
- **Severity:** Critical
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** The mock implementations under `src/infrastructure/mock/repositories/*` are complete and feature-rich; the Supabase-backed ones are partial.
- **Whether this duplicate is actually used:** Yes — this is the production code path when `VITE_USE_SUPABASE=true`.
- **What depends on it:** Every feature that uses one of the still-mock repositories: personnel management (tasks, chat, shifts, schedules, leave, performance, onboarding), operations (suppliers, purchase requests, deliveries, inventory, warehouse tasks), clubs, therapy, expenses, workflow, AI config, backups, calendar, overdue alerts.
- **Other platforms/layers affected:** Android's `LocalRepositories` are all Room-backed (per shared-unification.md). So a workflow created on Android persists; the same workflow created on the desktop in "Supabase mode" disappears on restart.
- **Behavioral differences:** Desktop "Supabase mode" vs Android: workflows, expenses, clubs, etc. persist on Android, vanish on desktop restart. Desktop "Supabase mode" vs mock mode: no difference for the 26 unported repositories — both are in-memory.
- **Confidence:** Confirmed
- **Git evidence:** `supabase-repositories.ts` last modified in `84dd13f` (2026-08-27). The file accumulates incremental port-ins (latest adds academic + audit + notifications + personnel + departments).
- **Likely root cause:** The Supabase migration was done repository-by-repository. The financial + CRM + academic core was ported first; the workforce/operations/club/therapy/workflow repositories were never finished. The "incremental migration" plan in the file header was abandoned.
- **Potential impact:** A school using "Supabase mode" in production loses all workforce, operations, club, therapy, workflow, AI config, backup, calendar, and overdue-alert data on every app restart. This is a silent data-loss bug masquerading as a partial migration.
- **Code snippet:**
```ts
// supabase-repositories.ts:137-162
const repositories: Repositories = {
  ...mockRepositories,        // ← base: ALL repositories are mock
  auth,                        // ← override
  parents, students, payments, ledger, installments, debt, dashboard,
  academicYears, classes, subjects, grades, attendance, homework, promotion,
  audit, notifications, personnel, departments,
  // ❌ STILL MOCK: clubs, psychology, orthophonie, teachers, expenses,
  //    releve, pricing, workflows, workflowRuns, aiConfig, backups,
  //    calendar, overdueAlerts, shifts, schedules, tasks,
  //    workforceAttendance, leaveRequests, performanceReviews, chat,
  //    onboarding, suppliers, purchaseRequests, deliveries, inventory,
  //    warehouseTasks
};
```

### FINDING WEAK-003 — `mapLedgerRow` falls back from `entry_type` to `actor_id` for the entry type

- **What:** The ledger row mapper `mapLedgerRow` builds the domain `LedgerEntry.type` field with `type: (r.entry_type ?? r.actor_id ?? "charge") as LedgerEntry["type"]`. This is a logic error: if `entry_type` is null (which the schema says it shouldn't be, but defensive code shouldn't assume), the mapper falls back to `actor_id` — which is a user ID like "usr-adm-001" or a UUID. That value is then cast to `LedgerEntry["type"]` which is the union `"charge" | "payment" | "adjustment" | "refund" | "reversal" | "transfer"`. The cast is unsafe (the value "usr-adm-001" is not a valid entry type). The reconciler downstream would then misclassify this entry (it would not match any case in the switch statement in `computeAccountBalance`).
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:383`
- **Lines:** `:383`: `type: (r.entry_type ?? r.actor_id ?? "charge") as LedgerEntry["type"],`
- **Category:** WEAK
- **Severity:** Medium
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** The `LedgerEntryRow` type at `src/infrastructure/supabase/types.ts:336` marks `entry_type` as non-nullable: `entry_type: "charge" | "payment" | "adjustment" | "refund" | "reversal" | "transfer";`
- **Whether this duplicate is actually used:** Yes — `mapLedgerRow` is called for every ledger entry read from Supabase.
- **What depends on it:** Every ledger entry displayed in the desktop UI; every balance computation; every reconciliation.
- **Other platforms/layers affected:** N/A
- **Behavioral differences:** Per the schema, `entry_type` is NOT NULL — the fallback should never trigger. But if a row is somehow inserted with NULL `entry_type` (e.g., by a buggy RPC or direct SQL), the desktop would silently treat the actor_id as the entry type.
- **Confidence:** Likely (the bug is dormant but real)
- **Git evidence:** `supabase-shared-repositories.ts` last modified in `84dd13f` (2026-08-27). The `r.entry_type ?? r.actor_id ?? "charge"` chain has been there since the file was created.
- **Likely root cause:** The developer confused `entry_type` (a column) with `actor_id` (a different column) while writing defensive null coalescing. The `actor_id` fallback is semantically meaningless for the entry type.
- **Potential impact:** Low immediate impact (schema guarantees entry_type is non-null), but if a future migration allows NULL `entry_type` or a manual SQL insert creates a row with NULL, the desktop would silently produce ledger entries with garbage `type` values that don't match any case in the balance computation switch — the entry's amount would be added to `balance` but not to any typed total, producing silent accounting drift.
- **Code snippet:**
```ts
// supabase-shared-repositories.ts:374-396 — mapLedgerRow
function mapLedgerRow(r: LedgerEntryRow): LedgerEntry {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    accountId: r.account_id,
    parentId: r.parent_id,
    studentId: r.student_id,
    category: r.category as LedgerEntry["category"],
    amount: Number(r.amount),
    type: (r.entry_type ?? r.actor_id ?? "charge") as LedgerEntry["type"],
    //       ^^^^^^^^^^^^^^^^^^^^^^^^^^
    //       ❌ actor_id is NOT an entry type — this fallback is a logic error
    sourceType: (r.source_type ?? "manual_entry") as LedgerEntry["sourceType"],
    // ...
  };
}
```

### FINDING DEAD-002 — `update-server-secret` Edge Function exports a `handleDelete` that is never wired

- **What:** The `update-server-secret/index.ts` file exports a `handleDelete(req)` function (line 195) intended to handle DELETE requests for clearing server secrets. But the `Deno.serve` handler (line 67) only handles POST (and OPTIONS via `handleOptions`). The DELETE handler is exported but never invoked — Deno.serve never routes DELETE requests to it. The DELETE functionality (clearing a secret via the Supabase Management API) is completely unreachable through the HTTP path.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/update-server-secret/index.ts:195-247`
- **Lines:** `:67` (`Deno.serve` only handles POST); `:195` (`export async function handleDelete` is dead)
- **Category:** DEAD
- **Severity:** Medium
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** N/A
- **Whether this duplicate is actually used:** No — `handleDelete` is exported but Deno.serve doesn't dispatch to it. Calling DELETE on the function URL would hit the POST handler's `if (req.method !== "POST")` check and return 405.
- **What depends on it:** Nothing — the desktop's settings UI presumably only POSTs to update secrets; there is no UI for clearing them.
- **Other platforms/layers affected:** N/A
- **Behavioral differences:** N/A
- **Confidence:** Confirmed
- **Git evidence:** `update-server-secret/index.ts` last modified in `9e1e774` (2026-08-12 "kay"). The `handleDelete` was added with a comment "Also support DELETE (to clear a secret)" but never wired.
- **Likely root cause:** The developer wrote the DELETE logic as a separate exported function, intending to add a method dispatcher, but only finished the POST path. The Deno.serve entry never grew a switch on `req.method`.
- **Potential impact:** Users cannot clear server-side secrets through the UI. The dead code is also misleading — future maintainers may believe DELETE works.
- **Code snippet:**
```ts
// update-server-secret/index.ts:67 — POST-only handler
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonError(req, 405, "method_not_allowed", "Use POST");
  }
  // ... POST logic ...
});

// update-server-secret/index.ts:191-247 — DEAD export
// ============================================================================
// Also support DELETE (to clear a secret)
// ============================================================================

export async function handleDelete(req: Request): Promise<Response> {
  // ❌ NEVER INVOKED — Deno.serve doesn't route DELETE here
  if (req.method !== "DELETE") { /* ... */ }
  // ...
}
```

### FINDING SEC-001 — Edge Functions swallow audit-log write failures silently

- **What:** The shared helper `writeAuditLog()` in `_shared/supabase.ts:90-121` calls the `write_audit_log` RPC. If the RPC fails, it `console.error`s the error and returns `null` — it does NOT throw. Every caller (collect-payment, refund-payment, bind-activation-code, update-server-secret, etc.) `await`s `writeAuditLog()` but never checks the return value. The canonical spec §7.6 mandates "Every mutation MUST emit at least one audit entry." If the audit write fails, the mutation still succeeds — the audit entry is silently missing. This breaks the canonical audit-trail invariant.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/_shared/supabase.ts:90-121`
- **Lines:** `:116-120`:
```ts
if (error) {
  console.error("[audit] Failed to write audit log:", error);
  return null;   // ← swallowed; caller never checks
}
```
- **Category:** SEC
- **Severity:** High
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** The canonical RPCs (`collect_and_allocate_payment`, `revert_payment_allocation`, etc.) write audit logs INSIDE the same transaction — atomic. The edge function's "belt-and-suspenders" audit log (per `refund-payment/index.ts:124-126`) is a SEPARATE write that can fail without affecting the RPC.
- **Whether this duplicate is actually used:** Yes — `writeAuditLog` is called from 5+ edge functions.
- **What depends on it:** The canonical audit trail for refund, activation code binding, server secret updates, etc.
- **Other platforms/layers affected:** The website's `bind-activation-code` function uses the same `_shared/supabase.ts`.
- **Behavioral differences:** The canonical RPC's audit log (inside the transaction) succeeds atomically with the mutation. The edge function's separate audit log (outside the transaction) can fail silently — producing a partial audit trail (the canonical entry from inside the RPC + the missing entry from the edge function's belt-and-suspenders call).
- **Confidence:** Confirmed
- **Git evidence:** `_shared/supabase.ts` last modified in `9e1e774` (2026-08-12 "kay"). The `console.error` + return null pattern has been there since the file was created.
- **Likely root cause:** The helper was written defensively (never throw on audit failure, to avoid breaking the main operation). But the design decision means audit failures are silently swallowed — the canonical invariant is violated without anyone noticing.
- **Potential impact:** An attacker (or a misconfigured Supabase instance) that suppresses audit log writes can perform mutations without any trace. The "belt-and-suspenders" audit log from the edge function is missing, leaving only the RPC's atomic audit entry (if the RPC is even invoked — the fallback path in `SupabasePaymentRepository.collect()` skips the RPC entirely).
- **Code snippet:**
```ts
// _shared/supabase.ts:90-121
export async function writeAuditLog(/* ... */): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("write_audit_log", { /* ... */ });
  if (error) {
    console.error("[audit] Failed to write audit log:", error);
    return null;   // ❌ caller never checks; mutation succeeds anyway
  }
  return data;
}

// refund-payment/index.ts:124-146 — caller never inspects the return
await writeAuditLog(
  ctx.tenantId, "payment.refund", "payment", body.payment_id, /* ... */
);
return jsonOk(req, { /* ... */ });  // ← always returns success
```

### FINDING DRIFT-003 — Repository selection happens at module load; config changes require app restart

- **What:** `src/app/providers/repository-provider.tsx:230` computes `const defaultRepositories = selectDefaultRepositories();` at MODULE LOAD time. The function reads `useSupabase && isSupabaseConfigured()` which in turn reads `localStorage` synchronously. If the user opens Settings → Configuration and changes the Supabase URL/key, the change is persisted to `localStorage` but the React context's `defaultRepositories` is already bound to the previous value. The comment in `supabase-client.ts:40-42` confirms: "The Configuration tab will restart the app after saving new settings, so the next render picks up the new values." This is an architectural choice — no reactive repository swap.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/app/providers/repository-provider.tsx:230`
- **Lines:** `:215-228` `selectDefaultRepositories()`; `:230` `const defaultRepositories = selectDefaultRepositories();`
- **Category:** DRIFT
- **Severity:** Medium
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** N/A
- **Whether this duplicate is actually used:** Yes — this is the production repository selector.
- **What depends on it:** Every component that calls `useRepositories()` gets the module-load-time selection; runtime config changes don't propagate.
- **Other platforms/layers affected:** N/A (Android uses Hilt DI; website uses Next.js server components — different pattern).
- **Behavioral differences:** If a user toggles Supabase on in Settings, they must restart the app for it to take effect. If they toggle it off, same thing. The configuration UI claims the change is "saved" but nothing changes until restart.
- **Confidence:** Confirmed
- **Git evidence:** `repository-provider.tsx` last modified in `b5a84cd` (2026-08-26 "kay"). The `selectDefaultRepositories()` + module-level binding has been there since the file was created.
- **Likely root cause:** The Supabase client is a singleton (`let _client: SupabaseClient | null = null` in `supabase-client.ts:86`); re-initializing it requires clearing the singleton, which would invalidate all in-flight requests. The module-load pattern avoids this complexity but at the cost of requiring a restart.
- **Potential impact:** Users who change Supabase config without restarting get confusing behavior: the UI shows the new config in Settings but the data still comes from the old source (or mock). A user who enables Supabase for the first time mid-session continues to see mock data until restart.
- **Code snippet:**
```ts
// repository-provider.tsx:215-230
function selectDefaultRepositories(): Repositories {
  const wantSupabase = useSupabase && isSupabaseConfigured();
  if (!wantSupabase) return mockRepositories;
  try {
    return getSupabaseRepositories();
  } catch (err) {
    console.error("[RepositoryProvider] Failed to initialize Supabase repositories, falling back to mock:", err);
    return mockRepositories;
  }
}

// ❌ Module-load binding — never re-evaluated
const defaultRepositories = selectDefaultRepositories();

export function RepositoryProvider({
  repositories = defaultRepositories,  // ← frozen at import time
  children,
}: { /* ... */ }) {
  return (
    <RepositoryContext.Provider value={repositories}>
      {children}
    </RepositoryContext.Provider>
  );
}
```

### FINDING DEAD-003 — `batch_register_family` SQL RPC uses `gen_random_bytes(3)` for parent_code; migration only added a comment warning

- **What:** Migration 0036 (`0036_tier4_backend_hardening.sql`) finding #3 documents that the `batch_register_family` SQL RPC uses `gen_random_bytes(3)` to generate parent_code — violating canonical §7.1 which mandates the deterministic FNV-1a hash via the application layer. Migration 0036 only added a COMMENT warning ("Both apps now use the deterministic generator; this RPC remains as a backend fallback only") — it did NOT fix the function. The RPC remains callable and still produces random parent_codes. Any caller that invokes `batch_register_family` directly (bypassing the app layer) gets non-canonical codes that break idempotent upserts.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0036_tier4_backend_hardening.sql:18-23` (comment) + the `batch_register_family` function in 0022_functions.sql
- **Lines:** 0036:18-23: "Add a guard COMMENT to `batch_register_family` warning that it uses `gen_random_bytes(3)` for parent_code — the canonical rule (spec §7.1) mandates the deterministic FNV-1a hash via the application layer. Both apps now use the deterministic generator; this RPC remains as a backend fallback only."
- **Category:** DEAD
- **Severity:** Medium
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** The app layer's `deterministicParentCode(year, input)` in `supabase-shared-repositories.ts:197-216`.
- **Whether this duplicate is actually used:** Partially — the RPC is still callable; nothing in the desktop's current code path invokes it (the desktop uses `upsert_parent_from_import` directly), but external scripts or future code might.
- **What depends on it:** Any caller that bypasses the app layer.
- **Other platforms/layers affected:** Android's `LocalStudentRepository.batchRegister` uses random codes per `financial-logic-comparison-v2.md` (D35). If Android ever calls this SQL RPC instead of its local repo, the same non-canonical codes are produced.
- **Behavioral differences:** SQL RPC → random 6-hex-char parent_code. App layer → FNV-1a hash parent_code. Same parent input → different codes → upsert RPC's primary identity match fails → duplicate parents.
- **Confidence:** Confirmed (per migration 0036 comment)
- **Git evidence:** 0036 introduced in `5b0df5b` (2026-08-21 "kay"). The migration's strategy was "document, don't fix" — the COMMENT is the only change.
- **Likely root cause:** The migration author chose the conservative path (don't modify the function body) to avoid breaking existing callers. But the result is that the RPC silently violates the canonical rule.
- **Potential impact:** A future developer who reads the canonical spec, sees that `batch_register_family` exists, and calls it from a script or migration will produce non-canonical parent codes. The COMMENT is the only warning — easy to miss.
- **Code snippet:**
```sql
-- 0036_tier4_backend_hardening.sql:18-23
--   3. Add a guard COMMENT to `batch_register_family` warning that it uses
--      `gen_random_bytes(3)` for parent_code — the canonical rule (spec §7.1)
--      mandates the deterministic FNV-1a hash via the application layer.
--      Both apps now use the deterministic generator; this RPC remains as a
--      backend fallback only.
--   4. Add a guard COMMENT to `generate_activation_code` warning that it uses
--      `random()` — same reason as above.
```

### FINDING CROSS-002 — `equivalence-live` README documents a "Layer 12 | Guard" that has no implementation file

- **What:** The `equivalence-live/README.md` table at lines 36-51 lists 12 layers — `01 UI/Input` through `11 Sync` plus `12 Guard` ("Real-data isolation: the production corpus is snapshotted before/after and asserted byte-identical"). But the `layers/` directory only contains 11 files: `01_ui_input.mjs` through `11_sync.mjs`. There is no `12_guard.mjs`. The "Layer 12" guard functionality (asserting the real production corpus is untouched by the test run) appears to be implemented in `lib/scope.mjs` (`realCorpusSnapshot` + `assertNoRealDataTouched` per `run.mjs:24, 67-68`), but it's not exposed as a layer. The README misrepresents the architecture.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/financial-tests/equivalence-live/README.md:36-51` (table) vs `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/financial-tests/equivalence-live/layers/` (directory)
- **Lines:** README `:36-51` (12 rows) vs `layers/` (11 files)
- **Category:** CROSS
- **Severity:** Low
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** N/A — documentation drift.
- **Whether this duplicate is actually used:** The README is read by maintainers; the layers are run by `run.mjs`.
- **What depends on it:** Maintainers who follow the README to add a new layer would be confused.
- **Other platforms/layers affected:** N/A
- **Behavioral differences:** N/A (documentation)
- **Confidence:** Confirmed (ls confirmed 11 files; README confirmed 12 rows)
- **Git evidence:** `equivalence-live/README.md` introduced in `02fa7825` (2026-08-23 "dd"). The README and the layer files were created together but the count diverged.
- **Likely root cause:** The README was written aspirationally (12 layers) but the implementation rolled the guard into `lib/scope.mjs` rather than a separate layer file. The README was never reconciled.
- **Potential impact:** Low — maintainers may waste time looking for `12_guard.mjs` or may forget the guard exists (since it's not in the layers directory).
- **Code snippet:**
```
financial-tests/equivalence-live/
├── README.md          ← lists 12 layers (01-12)
├── layers/
│   ├── 01_ui_input.mjs
│   ├── 02_validation.mjs
│   ├── ...
│   └── 11_sync.mjs    ← only 11 files
└── lib/scope.mjs      ← Layer 12's logic lives here, undocumented as a "layer"
```

### FINDING DRIFT-004 — `collect-payment` Edge Function defaults `category_filter` to "tuition" via canonical RPC's default, not null

- **What:** The `collect-payment` Edge Function passes `p_category: categoryFilter` where `categoryFilter = body.category_filter ?? null`. The canonical RPC `collect_and_allocate_payment` interprets `p_category = NULL` as "no filter, all categories" — meaning the payment is allocated across ALL outstanding installments (tuition + transport + canteen + etc.). The desktop's direct Supabase path (`SupabasePaymentRepository.collect`) at `supabase-shared-repositories.ts:1065` passes `p_category: input.category ?? "tuition"` — DEFAULTING to "tuition" if no category is provided. These two paths diverge: the edge function allocates across all categories; the direct path allocates only against tuition installments. Same payment, same parent, different waterfall behavior.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/collect-payment/index.ts:145` vs `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:1065`
- **Lines:** Edge function `:145`: `const categoryFilter = body.category_filter ?? null;` ; Direct path `:1065`: `p_category: input.category ?? "tuition",`
- **Category:** DRIFT
- **Severity:** High
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** The canonical spec INV-6 says "filtered by category if the payment specifies one" — implying that absence of a category means NO filter (all categories). The edge function's `null` behavior is canonical; the direct path's `"tuition"` default is non-canonical.
- **Whether this duplicate is actually used:** Yes — both paths are production.
- **What depends on it:** Every payment collection. The edge function is called by external/mobile clients; the direct path is called by the desktop UI.
- **Other platforms/layers affected:** Android's behavior per `shared-unification.md` should be canonical (null = all categories).
- **Behavioral differences:** A parent who owes 30,000 DZD tuition + 5,000 DZD transport pays 10,000 DZD with no category specified. Edge function: 10,000 DZD waterfall across tuition + transport (oldest first, possibly covering some transport). Direct path: 10,000 DZD waterfall against tuition only — transport stays unpaid, possibly becomes overdue.
- **Confidence:** Confirmed
- **Git evidence:** Edge function last modified in `eeb82db` (2026-08-21 "right"); direct path last modified in `84dd13f` (2026-08-27 "okay"). The drift was never reconciled.
- **Likely root cause:** The desktop's direct path was written with the assumption that "most payments are for tuition, so defaulting to tuition is safe". The edge function was written later (or by a different author) following the canonical spec. The two were never aligned.
- **Potential impact:** A parent's payment that should cover transport (the parent handed over cash saying "for the bus") gets allocated to tuition only when collected via the desktop UI. The transport installment becomes overdue, triggering debt-collection actions against a parent who actually paid.
- **Code snippet:**
```ts
// collect-payment/index.ts:145 — canonical (null = all categories)
const categoryFilter = body.category_filter ?? null;
// → RPC: p_category = NULL → waterfall across ALL outstanding installments

// supabase-shared-repositories.ts:1065 — non-canonical (defaults to "tuition")
p_category: input.category ?? "tuition",
// → RPC: p_category = "tuition" → waterfall against tuition installments only
```

### FINDING BUSINESS-004 — `SupabaseStudentRepository.promote()` returns "not implemented" error in production

- **What:** The Supabase-backed student repository's `promote()` method (line 982-984) returns `Err(Errors.server("promote not implemented for Supabase repository"))`. The mock repository has a working implementation (`student-repository.ts:318-332` — promotes students by incrementing their grade). The canonical batch promotion flow is a critical end-of-year operation (vault §06.04: "One-click batch promotion, 4-step flow, admin overrides, atomic execution"). In Supabase mode (production), clicking "Promote" returns an error. The feature silently breaks when Supabase is enabled.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:982-984`
- **Lines:** `:982-984`:
```ts
async promote(): Promise<Result<Student[]>> {
  return Err(Errors.server("promote not implemented for Supabase repository"));
}
```
- **Category:** BUSINESS
- **Severity:** High
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** Mock `student-repository.ts:318-332` implements promotion by mapping over students and updating `updatedAt`. The canonical batch promotion flow (vault §06.04) involves 4 steps with admin overrides + atomic execution.
- **Whether this duplicate is actually used:** Yes — when Supabase mode is enabled, the `useBatchPromotion` hook (`src/features/academics/hooks/use-batch-promotion.ts`) calls `repos.students.promote()`.
- **What depends on it:** The Academics → Batch Promotion modal; the end-of-year promotion workflow.
- **Other platforms/layers affected:** Android's `LocalStudentRepository.promote` works (per shared-unification.md).
- **Behavioral differences:** Mock mode: promotion works (updates in-memory). Supabase mode: promotion returns an error. The user sees an error toast and cannot promote students.
- **Confidence:** Confirmed
- **Git evidence:** `supabase-shared-repositories.ts` last modified in `84dd13f` (2026-08-27). The `promote()` stub has been there since the file was created.
- **Likely root cause:** The Supabase student repository was ported for CRUD operations (create/update/batchRegister) but the `promote()` method was left as a stub. The vault §06 verification claims "batch promotion already existed" but didn't notice the Supabase path was stubbed.
- **Potential impact:** At the end of the academic year, a school using Supabase mode cannot promote students to the next grade. The end-of-year workflow is completely blocked. Workaround: switch to mock mode (losing all Supabase-backed data) or write the promotion manually via SQL.
- **Code snippet:**
```ts
// supabase-shared-repositories.ts:982-984
async promote(): Promise<Result<Student[]>> {
  return Err(Errors.server("promote not implemented for Supabase repository"));
}

// mock/student-repository.ts:318-332 — working mock implementation
async promote(studentIds: string[], _academicYear: string): Promise<Result<Student[]>> {
  await delay(300);
  const promoted = store.students
    .filter((s) => studentIds.includes(s.id))
    .map((s) => ({ ...s, updatedAt: nowIso() }));
  appendAudit({ /* ... */ });
  return Ok(promoted);
}
```

### FINDING WEAK-004 — `ledger-seed.ts` computes `dueDate` then discards it (`void dueDate;`)

- **What:** The `buildSeedLedger()` function in `mock/ledger-seed.ts:139-171` computes `const dueDate = trancheDueDates[i];` inside a forEach loop, then immediately `void dueDate;` on the next line — explicitly discarding the value. All three tuition tranches get `at: daysAgo(60)` (the same timestamp for all three) instead of their canonical Sept 15 / Dec 15 / Mar 15 due dates. The seed data therefore does not reflect the canonical tranche schedule. If any code replays the ledger by `at` timestamp (instead of by installment `dueDate`), the chronological order of tranches is arbitrary (broken by id tiebreaker), not the canonical Sep → Dec → Mar order.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/mock/ledger-seed.ts:139-171`
- **Lines:** `:139-171` (the forEach); `:170` (`void dueDate;`)
- **Category:** WEAK
- **Severity:** Low
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** The canonical schedule is Sep 15 / Dec 15 / Mar 15 per `getOfficialTuitionDueDates()`. The seed uses `trancheDueDates` (computed at the top of the file) but doesn't apply them.
- **Whether this duplicate is actually used:** Yes — `buildSeedLedger()` is called by `mock/seed-data.ts` to populate the mock store on first load. Every dev/test session starts with this seed data.
- **What depends on it:** Every test that relies on the mock seed ledger; every dev demo that shows the financial dashboard.
- **Other platforms/layers affected:** N/A (mock-only)
- **Behavioral differences:** The seed ledger has 3 tuition tranches per student, all dated `daysAgo(60)`. The waterfall allocator (which sorts installments by `dueDate`) is unaffected (installments have their own `dueDate` field). But any direct ledger replay (e.g., for audit purposes) sees all tranches as simultaneous.
- **Confidence:** Confirmed
- **Git evidence:** `ledger-seed.ts` last modified in `b5a84cd` (2026-08-26 "kay"). The `void dueDate;` was introduced as part of the Tier 2 R17 single-pass discount refactor.
- **Likely root cause:** The refactor moved from "one charge per tranche with explicit dueDate" to "one charge per tranche with `at: daysAgo(60)` for all" but didn't remove the now-unused `dueDate` variable. The `void` was added to silence the linter.
- **Potential impact:** Low — installments drive the waterfall, not ledger entries. But audit/debug surfaces that replay the ledger by `at` see incorrect chronological ordering. Misleading for developers debugging tranche-related issues.
- **Code snippet:**
```ts
// ledger-seed.ts:139-171
trancheSplits.forEach((amount, i) => {
  const dueDate = trancheDueDates[i];   // ← computed (Sep 15 / Dec 15 / Mar 15)
  entries.push(createChargeEntry({
    // ...
    at: daysAgo(60),                   // ← ALL tranches get the same timestamp
    metadata: {
      tranche: i + 1,
      // ...
    },
  }));
  void dueDate;                        // ← EXPLICITLY DISCARDED
});
```

### FINDING CROSS-003 — Android repo's supabase/migrations folder is a partial copy missing the base schema

- **What:** The Android repo (`/home/z/my-project/repos/elimtiyaz-android/supabase/migrations/`) contains only 6 migration files: `0034_canonical_engine_unification.sql`, `0035_tier3_drop_signature_fixes.sql`, `0036_tier4_backend_hardening.sql`, `0040_cross_platform_rpc_unification.sql`, `0041_canonical_academic_flow.sql`, `0042_canonical_overdue_asof_equivalence.sql`. These are the "canonical fix-up" migrations (0034-0042) that DROP and RECREATE SQL functions. They depend on the base schema (0001-0028) and the original RPC definitions (0022 `collect_payment`, 0025 `allocate_payment_waterfall`, etc.) to drop. If the Android repo's migrations are applied to a fresh database, the DROP statements would no-op (functions don't exist) and the CREATE statements would create the canonical functions in an empty schema (no `payments`, `ledger_entries`, etc. tables) → runtime errors.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/supabase/migrations/` (6 files) vs `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/` (43 files)
- **Lines:** N/A (directory comparison)
- **Category:** CROSS
- **Severity:** High
- **Repo/Platform:** AgentGithubUplaod (Desktop) ↔ elimtiyaz-android
- **Original/canonical implementation (if duplicate):** The desktop repo's full migration set (0001-0043) is canonical.
- **Whether this duplicate is actually used:** Partially — the Android repo's migrations are meant to be applied to the SAME Supabase project as the desktop's. But the Android set alone is incomplete.
- **What depends on it:** Anyone setting up a fresh Supabase project from the Android repo's migrations alone would fail.
- **Other platforms/layers affected:** The website repo (`/home/z/my-project/repos/elimtiyaz-website/supabase/migrations/`) has 4 portal-specific migrations (0025-0028) with colliding numbers (see CROSS-001).
- **Behavioral differences:** Desktop migrations: complete schema + canonical fixes. Android migrations: canonical fixes only (depend on desktop's base). Website migrations: portal patches only (collide with desktop's base).
- **Confidence:** Confirmed (ls confirmed)
- **Git evidence:** The Android repo's migrations were likely copied from the desktop after 0034-0042 were authored, without including the base.
- **Likely root cause:** The Android team copied the "latest canonical fix" migrations to their repo, assuming the desktop would handle the base schema. But Supabase migrations are tracked per-project per-repo — there's no concept of "base from another repo".
- **Potential impact:** A new engineer setting up the project from the Android repo gets a broken database. The cross-platform equivalence tests can't run against a fresh DB. The migration dependency chain is implicit and undocumented.
- **Code snippet:**
```
elimtiyaz-android/supabase/migrations/  (6 files — INCOMPLETE)
├── 0034_canonical_engine_unification.sql
├── 0035_tier3_drop_signature_fixes.sql
├── 0036_tier4_backend_hardening.sql
├── 0040_cross_platform_rpc_unification.sql
├── 0041_canonical_academic_flow.sql
└── 0042_canonical_overdue_asof_equivalence.sql
# ❌ MISSING: 0001..0033, 0037, 0038, 0039, 0043 — base schema + several fix-ups
```

### FINDING DRIFT-005 — `update-server-secret` uses audit action `server_secret.update`/`.delete` not in canonical `AuditActions` registry

- **What:** The `update-server-secret` Edge Function writes audit logs with action strings `"server_secret.update"` and `"server_secret.delete"`. The canonical `AuditActions` registry in `src/core/audit-actions.ts` does NOT include these actions — it has `auth.*`, `parent.*`, `student.*`, `payment.*`, `class.*`, etc., but no `server_secret.*` entry. The audit actions are ad-hoc strings invented by the edge function. The canonical spec §7.6 says audit entries capture `{action, entityType, entityId, actorId, ...}` — the action should be from a stable wire-protocol registry. Ad-hoc actions break the audit log filter UI (which expects known action prefixes).
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/update-server-secret/index.ts:171-181` and `:233-244`
- **Lines:** `:172`: `action: "server_secret.update"`; `:234`: `action: "server_secret.delete"`
- **Category:** DRIFT
- **Severity:** Low
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** The `AuditActions` registry at `src/core/audit-actions.ts:9-133`.
- **Whether this duplicate is actually used:** Yes — every server secret update/delete writes these ad-hoc actions.
- **What depends on it:** The audit log filter UI (Settings → Journal d'audit) which groups by action prefix.
- **Other platforms/layers affected:** N/A
- **Behavioral differences:** Filter UI may not recognize the `server_secret.*` prefix; the actions appear in the "Other" bucket or not at all.
- **Confidence:** Confirmed
- **Git evidence:** `audit-actions.ts` last modified long before the edge function was added. The edge function was created without updating the registry.
- **Likely root cause:** The edge function was written independently of the desktop's audit-actions registry. The author didn't know the registry existed or didn't think to update it.
- **Potential impact:** Low — audit log filter UI may not surface server secret updates cleanly. Compliance auditors looking for "all secret-related events" must search by free-text rather than by a known action prefix.
- **Code snippet:**
```ts
// update-server-secret/index.ts:171-181 — ad-hoc audit action
await writeAuditLog(
  ctx.tenantId,
  "server_secret.update",    // ← NOT in AuditActions registry
  "system_setting",
  null,
  ctx.userProfileId,
  ctx.email,
  null,
  { key: body.key, category: body.category, masked: true },
  `Updated server secret '${body.key}' (category: ${body.category})`,
  requestId
);

// src/core/audit-actions.ts:9-133 — canonical registry (NO server_secret.* entry)
export const AuditActions = {
  AuthLogin: "auth.login",
  AuthLogout: "auth.logout",
  // ... 60+ entries ...
  // ❌ NO ServerSecretUpdate / ServerSecretDelete
};
```

### FINDING ARCH-002 — Electron main process registered with `--no-sandbox` in the start script

- **What:** The `package.json` start script (`npm start`) runs `electron . --no-sandbox`. The `--no-sandbox` flag disables Chromium's sandbox, which is a security mitigation against renderer-process exploits. The electron main.ts comment claims "contextIsolation: true + nodeIntegration: false (renderer never touches Node directly)" — but with the sandbox disabled, a renderer compromise (e.g., XSS via a malicious Excel file content or a malicious AI response rendered without sanitization) can escape into the renderer process and potentially reach Node APIs through the preload bridge or through Electron's internal IPC.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/package.json:22`
- **Lines:** `package.json:22`: `"start": "vite build && tsc -p electron/tsconfig.preload.json && mv dist-electron/preload.js dist-electron/preload.cjs && tsc -p electron/tsconfig.json && electron . --no-sandbox"`
- **Category:** ARCH
- **Severity:** Medium
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** N/A
- **Whether this duplicate is actually used:** Yes — `npm start` is the production start command.
- **What depends on it:** Every developer running `npm start`; potentially production deployments.
- **Other platforms/layers affected:** N/A
- **Behavioral differences:** With sandbox enabled, a renderer exploit is contained. Without sandbox, a renderer exploit can reach Node APIs.
- **Confidence:** Confirmed
- **Git evidence:** `package.json` last modified in `b5a84cd` (2026-08-26 "kay"). The `--no-sandbox` flag has been there since the Electron integration.
- **Likely root cause:** The `--no-sandbox` flag is often needed on Linux when running as root or in containers without SUID helper. The developer added it to make `npm start` work in their dev environment; it leaked into the production start script.
- **Potential impact:** A malicious Excel file (parsed by exceljs in the renderer) or a malicious AI response (rendered in the narrative generator) could exploit a renderer vulnerability to escape the sandbox. With sandbox disabled, the attacker reaches Node APIs — file system access, IPC to the main process, ability to read the Supabase anon key + auth tokens from localStorage, etc.
- **Code snippet:**
```json
// package.json:22
"start": "vite build && tsc -p electron/tsconfig.preload.json && mv dist-electron/preload.js dist-electron/preload.cjs && tsc -p electron/tsconfig.json && electron . --no-sandbox"
//                                                                                                                                                              ^^^^^^^^^^^
//                                                                                                                                                              ❌ disables Chromium sandbox
```

### FINDING WEAK-005 — Mock `student-repository.batchRegister` uses the deterministic discount engine but ignores `previousGradeLevel` and `previousRank`

- **What:** The mock `student-repository.batchRegister` billing builder (`buildRegistrationBilling`, line 353+) and the UI's `computeBilling` both call `evaluateAllSystemDiscounts` with `previousGradeLevel: null` and `previousRank: null`. The canonical discount engine has 5 rules; 2 of them (`passage_palier` and `highest_average`) depend on `previousGradeLevel` and `previousRank` respectively. By passing null, those 2 rules always return 0 — silently disabled. The billing summary the user sees during batch registration never shows the `passage_palier` (−10,000 DZD) or `highest_average` (−10%) discount, even if the student qualifies. The comment says "Not tracked in the batch form yet" — meaning the UI doesn't capture these fields, so the engine can't apply them.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/features/crm/batch-registration/compute-billing.ts:64-75` and `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/mock/repositories/student-repository.ts:373-384`
- **Lines:** `compute-billing.ts:66`: `previousGradeLevel: null,` ; `:74`: `previousRank: null,` ; `student-repository.ts:375`: `previousGradeLevel: null,` ; `:383`: `previousRank: null,`
- **Category:** WEAK
- **Severity:** Medium
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** The canonical `evaluateAllSystemDiscounts` (in `discount-engine.ts:56-102`) correctly applies all 5 rules when given the inputs. The seed ledger (`ledger-seed.ts:120-131`) also passes null with the comment "not tracked in seed data".
- **Whether this duplicate is actually used:** Yes — every batch registration in the desktop UI uses `computeBilling`; every mock batch register uses `buildRegistrationBilling`.
- **What depends on it:** The BatchRegistrationModal Step 3 (billing) and Step 4 (review) totals.
- **Other platforms/layers affected:** Android's `BatchRegistrationViewModel` per `financial-logic-comparison-v2.md` (D5) skips 4 of 5 discount rules entirely. The desktop at least evaluates them (returning 0); Android doesn't even call them.
- **Behavioral differences:** A student transitioning from `5ap` to `1am` (qualifying for `passage_palier` −10,000 DZD) sees no discount in the batch registration summary. A rank-1 student (qualifying for `highest_average` −10%) sees no discount. The parent is overcharged.
- **Confidence:** Confirmed
- **Git evidence:** `compute-billing.ts` last modified in `b5a84cd` (2026-08-26 "kay"). The null pass-through has been there since the file was created.
- **Likely root cause:** The batch registration form (`batch-registration/types.ts` `Step2Student`) doesn't have fields for `previousGradeLevel` or `previousRank`. The billing engine can't apply rules it doesn't have inputs for. The canonical spec mandates the rules; the UI doesn't capture the inputs.
- **Potential impact:** Parents of students qualifying for `passage_palier` or `highest_average` are overcharged by 10,000 DZD or 10% of gross tuition respectively. The school either loses the student (parent goes elsewhere) or has to issue manual adjustments (violating the "discounts are applied once on gross" canonical rule).
- **Code snippet:**
```ts
// compute-billing.ts:64-75 — null pass-through disables 2 of 5 rules
const discountEvals: readonly DiscountEvaluation[] = evaluateAllSystemDiscounts({
  grossTuition,
  previousGradeLevel: null, // ← disables passage_palier (-10,000 DZD)
  currentGradeLevel: gradeLevel,
  childIndex: i + 1,
  paymentPlan: s.paymentPlan,
  paymentDate,
  academicYearStartYear,
  academicYearStart: new Date(Date.UTC(academicYearStartYear, 8, 1)).toISOString(),
  enrollmentDate: new Date().toISOString(),
  previousRank: null,       // ← disables highest_average (-10%)
});
```

### FINDING CROSS-004 — `bind-activation-code` Edge Function had to be patched to accept both `code` and `activation_code` body keys

- **What:** The `bind-activation-code` Edge Function accepts both `body.activation_code` (desktop/Android) and `body.code` (Next.js portal) body keys. The function comment at lines 63-66 explains: "CROSS-PLATFORM COMPATIBILITY (vault §02.08): the same deployed function serves both the Web Portal (body key `code`) and the desktop/Android clients (body key `activation_code`). Accept either key — no behavioral difference." This is a documented fix for a regression: the original function only accepted `activation_code`, so when the Next.js portal was deployed calling with `code`, the portal's parent-binding flow was broken. The fix was applied after-the-fact.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/bind-activation-code/index.ts:34-39, 63-67`
- **Lines:** `:34-39` (interface), `:63-67` (the dual-key acceptance)
- **Category:** CROSS
- **Severity:** Low
- **Repo/Platform:** AgentGithubUplaod (Desktop) ↔ elimtiyaz-website
- **Original/canonical implementation (if duplicate):** N/A — this IS the canonical fix.
- **Whether this duplicate is actually used:** Yes — the function is deployed and used by all three platforms.
- **What depends on it:** The parent activation flow on all three platforms.
- **Other platforms/layers affected:** The Next.js portal's `activation-code-screen.tsx` sends `code`; the desktop's `parent-detail-drawer.tsx` sends `activation_code`.
- **Behavioral differences:** Before the fix: portal calls failed silently (body.activation_code undefined → 400 missing_code). After: both keys accepted.
- **Confidence:** Confirmed
- **Git evidence:** The function comment references "vault §02.08" which was verified in `vault-compliance-verification-3.md` (commit `2e2b21a` 2026-08-28).
- **Likely root cause:** The original function was written for the desktop/Android without coordinating with the website team. The website was deployed later with a different body key, breaking the flow. The fix accepts both keys as a workaround.
- **Potential impact:** The workaround works but signals a deeper coordination issue: the three platforms don't share a request/response contract. Future fields added by one platform may not be recognized by the others. The dual-key acceptance is a smell.
- **Code snippet:**
```ts
// bind-activation-code/index.ts:34-39, 63-67
interface BindCodeRequest {
  /** Desktop/Android clients send `activation_code`. */
  activation_code?: string;
  /** The Next.js Web Portal sends `code` (activation-code-screen.tsx). */
  code?: string;
}
// ...
// CROSS-PLATFORM COMPATIBILITY (vault §02.08): the same deployed function
// serves both the Web Portal (body key `code`) and the desktop/Android
// clients (body key `activation_code`). Accept either key — no behavioral
// difference, the value follows the exact same validation + binding path.
const rawCode = body.activation_code ?? body.code;
```

### FINDING DRIFT-006 — Multiple iterations of "canonical overdue" rule across desktop engine, SQL function, and equivalence framework

- **What:** The canonical overdue rule (INV-4) is `account is overdue iff (balance > 0.001 DZD) AND (latestCharge.at < now) AND (overdueDueDate[accountId] < now)`. This rule has been re-implemented and re-aligned at least 4 times: (1) Desktop `computeParentSummary` in `domain/calc/ledger/balance.ts:182-187` uses `balance > 0.001 && dueDate && dueDate.getTime() < now.getTime()` where `dueDate` comes from `buildOverdueDueDateMap` (MAX of charge `at`); (2) SQL `compute_parent_summary` (migration 0042) was REWRITTEN to mirror the desktop rule — previously it used `installment.due_date` JOIN + `at <= p_as_of` filter, diverging from the desktop; (3) The cross-platform equivalence framework (Tier 4) flagged 13 scenarios where the SQL and desktop diverged (A-0042-OVERDUE); (4) Migration 0042's comment says "INV-10 names the desktop implementation the single source of truth for the parent summary" — meaning the desktop is canonical, the SQL must mirror.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/domain/calc/ledger/balance.ts:182-187` + `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0042_canonical_overdue_asof_equivalence.sql:7-19`
- **Lines:** balance.ts `:182-187`; migration 0042 `:7-19` (header explaining the divergence + fix)
- **Category:** DRIFT
- **Severity:** Medium
- **Repo/Platform:** AgentGithubUplaod (Desktop) ↔ Backend (SQL)
- **Original/canonical implementation (if duplicate):** Desktop `computeParentSummary` is canonical (per INV-10, named in migration 0042's header).
- **Whether this duplicate is actually used:** Yes — both implementations are production.
- **What depends on it:** The Debt Dashboard's "overdue" tier; the Top-20 Debtors list; the "Lock Delinquent Accounts" action.
- **Other platforms/layers affected:** Android's `LedgerEngine.computeParentSummary` per `financial-logic-comparison-v2.md` (D17) uses `balance > 100L` centimes (= 1 DZD) threshold instead of `0.001` DZD — a different threshold entirely. The canonical spec says 0.001 DZD; Android uses 1 DZD (1000× larger).
- **Behavioral differences:** Pre-migration 0042: SQL classified overdue using installment due_date JOIN + as-of filter; desktop used MAX(charge.at) with no as-of filter; Android used a 1000× larger threshold. Post-migration 0042: SQL mirrors desktop. Android still uses the wrong threshold.
- **Confidence:** Confirmed
- **Git evidence:** Migration 0042 introduced in `2e2b21a` (2026-08-28 — the latest commit). The header explicitly documents the 13 failing equivalence scenarios.
- **Likely root cause:** The overdue rule was implemented independently in 3 places (desktop TS, SQL, Android Kotlin). Each implementation made different assumptions. The cross-platform equivalence framework caught the divergence; migration 0042 aligned the SQL with the desktop. Android remains misaligned.
- **Potential impact:** Pre-0042 databases flagged accounts as overdue that the desktop did not (false positives → wrongful debt collection). Post-0042: SQL and desktop aligned. Android still uses the wrong threshold → an account with 0.5 DZD outstanding is flagged overdue on desktop + SQL, ignored on Android. Cross-platform sync would surface this as a status flip-flop.
- **Code snippet:**
```ts
// Desktop canonical (balance.ts:182-187) — INV-4 canonical
const dueDate = overdueCategoryDueDates.get(acc.accountId);
if (acc.balance > 0.001 && dueDate && dueDate.getTime() < now.getTime()) {
  totalOverdue += acc.balance;
}
```
```sql
-- Migration 0042 (PostgreSQL) — mirrors desktop
-- A-0042-OVERDUE: previously used installment.due_date JOIN + at <= p_as_of
-- FIX: mirror the canonical rule exactly — MAX(charge.at), no as-of filter
SELECT MAX(le.at) INTO v_latest_charge_due_date
  FROM ledger_entries le
  WHERE le.account_id = v_acc.account_id
    AND le.entry_type = 'charge';
v_is_overdue := (v_acc.balance > 0.001 AND v_latest_charge_due_date < p_as_of);
```

### FINDING BUSINESS-005 — `UnifiedPaymentModal` defaults `category` to "tuition" for the waterfall preview when input is null

- **What:** The `UnifiedPaymentModal`'s allocation preview at `unified-payment-modal.tsx:269-282` filters installments by `category === "tuition" || category === "transport" ? i.category === category : true`. When the user picks a category other than tuition/transport (e.g., canteen, uniform, books, therapy_psychology), the filter is `true` (no filter) — meaning the preview shows the waterfall across ALL outstanding installments, not just the chosen category. But when the modal calls `repos.payments.collect()` (line 387-403), it passes `category` directly (which could be `"canteen"`). The Supabase `collect()` then passes `p_category: input.category ?? "tuition"` (BUSINESS-002 / DRIFT-004) — so if `category` is "canteen", the waterfall is filtered by canteen; if `category` is null, it defaults to "tuition". So the preview shows ALL categories, but the actual collection uses tuition-only or the specified category. The preview lies to the user.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/features/financials/unified-payment-modal.tsx:269-296`
- **Lines:** `:269-282` (allocationPreview useMemo), `:285-296` (focusedTrancheLabel useMemo), `:387-403` (collect call)
- **Category:** BUSINESS
- **Severity:** Medium
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** The canonical waterfall (`allocatePaymentToInstallments` in `waterfall-allocator.ts:33-103`) accepts `categoryFilter?: Installment["category"]` — undefined means no filter.
- **Whether this duplicate is actually used:** Yes — every payment collected through the UnifiedPaymentModal.
- **What depends on it:** The payment slider's tranche display + the user's mental model of how their payment will be allocated.
- **Other platforms/layers affected:** N/A
- **Behavioral differences:** Preview shows payment spread across all categories. Actual collection: if category is tuition/transport, filtered; if category is null/other, defaults to tuition-only. The user sees a preview that doesn't match what actually happens.
- **Confidence:** Likely
- **Git evidence:** `unified-payment-modal.tsx` last modified in `b5a84cd` (2026-08-26 "kay"). The preview logic was written for the Epic 5.3 implementation.
- **Likely root cause:** The preview was written to handle the common case (tuition + transport = ~95% of payments) by filtering; for other categories it fell back to "no filter" which was assumed to be safe. The actual collection path has a different default (`"tuition"`), causing the divergence.
- **Potential impact:** A user paying 5,000 DZD for "canteen" sees a preview showing the 5,000 spread across all outstanding tranches (e.g., 3,000 to oldest tuition tranche, 2,000 to transport). They confirm the payment expecting that allocation. The actual collection: 5,000 DZD filtered by canteen — but if no canteen installment exists, the entire 5,000 becomes `unallocatedAmount` → parent_credit adjustment. The user sees "Payment collected" but the actual allocation differs from the preview.
- **Code snippet:**
```ts
// unified-payment-modal.tsx:269-282 — preview (no filter for non-tuition/transport)
const allocationPreview = useMemo(() => {
  if (!effectiveParentId) return null;
  const eligible = installments
    .filter((i) => i.status !== "paid")
    .filter((i) =>
      category === "tuition" || category === "transport" ? i.category === category : true,
      //                                                                       ^^^^
      //       preview shows ALL categories for canteen/uniform/etc.
    );
  return allocatePaymentToInstallments(
    eligible, amount,
    category === "tuition" || category === "transport" ? category : undefined,
    //                                                       ^^^^^^^
    //       waterfall called with NO filter for non-tuition/transport
  );
}, [installments, amount, category, effectiveParentId]);

// unified-payment-modal.tsx:387-403 — actual collect (passes category through)
const result = await repos.payments.collect(
  {
    // ...
    category,  // ← passed as-is; Supabase path defaults to "tuition" if null
  },
  session.userId,
);
```

### FINDING SEC-002 — `defaultLLMAdapter` falls back from edge function → BYOK → mock, silently leaking user prompts to Groq/OpenRouter if Edge Function is down

- **What:** The `defaultLLMAdapter.generate()` routing logic (`llm-adapter.ts:453-468`) tries the `ai-proxy` Edge Function first; on failure, falls back to `byokLLMAdapter` (direct call to Groq/OpenRouter with the admin's API keys); on failure, falls back to `mockLLMAdapter`. The canonical spec §11.02 says "PII is masked BEFORE the call: only `AIRequest.maskedContent` crosses the network". The BYOK adapter does use `request.maskedContent || request.userPrompt` (line 370) — but if `maskedContent` is empty/null (e.g., the caller didn't set it), the raw `userPrompt` (which may contain PII) is sent directly to Groq/OpenRouter. The edge function path also has the same fallback (`edgeLLMAdapter` line 271). So if the masking step is skipped by the caller, the raw prompt leaks.
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/ai/llm-adapter.ts:453-468` (routing) + `:362-437` (BYOK adapter)
- **Lines:** `:370`: `const userPrompt = request.maskedContent || request.userPrompt;` ; `:271` (edge adapter): `prompt: request.maskedContent || request.userPrompt,`
- **Category:** SEC
- **Severity:** High
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** The canonical spec says PII masking must happen before the call; the `||` fallback allows bypassing.
- **Whether this duplicate is actually used:** Yes — `defaultLLMAdapter` is the production routing adapter.
- **What depends on it:** The narrative generator, drafting features, anomaly explainer — every AI feature in the desktop.
- **Other platforms/layers affected:** N/A (Android doesn't have an AI feature per shared-unification.md)
- **Behavioral differences:** If `maskedContent` is set: PII-safe. If `maskedContent` is empty/null: raw `userPrompt` (potentially containing student names, parent phones, financial details) is sent to Groq/OpenRouter.
- **Confidence:** Likely
- **Git evidence:** `llm-adapter.ts` last modified in `84dd13f` (2026-08-27 "okay") — the vault §02 verification added the BYOK + edge paths.
- **Likely root cause:** The `||` operator's truthy-check treats empty string as falsy — a `maskedContent` of `""` (which could happen if the PII-mask step produced an empty result, e.g., the entire prompt was PII) falls back to the raw `userPrompt`. The developer didn't use a stricter null-check (`request.maskedContent !== null && request.maskedContent.length > 0`).
- **Potential impact:** A teacher generating a narrative for a student named "Mohamed Benali" with the prompt "Write a report card comment for Mohamed Benali in 1am..." — if the masking step fails or produces an empty result, the raw prompt with the student's name is sent to Groq's API. Groq stores prompts for 30 days. The PII is leaked to a third-party LLM provider without the school's explicit consent.
- **Code snippet:**
```ts
// llm-adapter.ts:453-468 — routing
export const defaultLLMAdapter: LLMAdapter = {
  async generate(request: AIRequest): Promise<Result<AIResponse>> {
    if (isSupabaseConfigured()) {
      const edgeResult = await edgeLLMAdapter.generate(request);
      if (edgeResult.ok) return edgeResult;
      const byokResult = await byokLLMAdapter.generate(request);
      if (byokResult.ok) return byokResult;
      return mockLLMAdapter.generate(request);
    }
    // ...
  },
};

// llm-adapter.ts:370 — BYOK uses raw userPrompt if maskedContent is empty
const userPrompt = request.maskedContent || request.userPrompt;
//                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                   ❌ if maskedContent === "" (empty string), falls back to raw

// llm-adapter.ts:271 — edge adapter has same issue
prompt: request.maskedContent || request.userPrompt,
```

### FINDING DEAD-004 — `financial-tests/scenarios/*.yml` (8 YAML scenarios) appear to be the original DSL, now superseded by JSON scenarios

- **What:** The `financial-tests/scenarios/` directory contains 8 hand-written YAML scenario files (`single_payment_partial.yml`, `overpayment_creates_parent_credit.yml`, `discount_engine_sibling_only.yml`, etc.). The README at `financial-tests/README.md` says "Two runners consume the same YAML: Android `app/src/test/.../CrossPlatformScenarioRunner.kt`, Desktop `src/test/cross-platform/ScenarioRunner.test.ts`". But the JSON-based `financial-tests/equivalence/scenarios/` (45 scenarios) is the framework actually used by the desktop's cross-platform tests (`src/test/cross-platform/*.test.ts` imports from the equivalence scenarios). The 8 YAML files appear to be the original DSL, now superseded. No active test runner reads them (the `ScenarioRunner.test.ts` file does exist but uses YAML scenarios only for the 8 originals; the 45 JSON scenarios are run by `equivalence/desktop/desktop_runner.ts`).
- **Where:** `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/financial-tests/scenarios/*.yml` (8 files) + `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/financial-tests/README.md`
- **Lines:** N/A (8 YAML files)
- **Category:** DEAD
- **Severity:** Low
- **Repo/Platform:** AgentGithubUplaod (Desktop)
- **Original/canonical implementation (if duplicate):** `financial-tests/equivalence/scenarios/*.json` (45 scenarios) is canonical.
- **Whether this duplicate is actually used:** Partially — `ScenarioRunner.test.ts` exists and may still run the 8 YAML files. But the 45 JSON scenarios are the active set used by `equivalence/desktop/desktop_runner.ts` and the Tier4 tests.
- **What depends on it:** `src/test/cross-platform/ScenarioRunner.test.ts` (if it still reads YAML).
- **Other platforms/layers affected:** Android's `CrossPlatformScenarioRunner.kt` per the README may still read the YAML files.
- **Behavioral differences:** YAML DSL is simpler (5 operation kinds); JSON DSL is richer (11 categories, expected values, multi-platform). The two frameworks coexist without a clear migration plan.
- **Confidence:** Likely (the YAML files are committed but the active test runner uses JSON)
- **Git evidence:** YAML scenarios last modified in `f8d64cc` (2026-08-19 "o") — older than the JSON scenarios (which were updated in `2e2b21a` 2026-08-28).
- **Likely root cause:** The YAML DSL was the first iteration. The JSON scenarios came later with richer types. The YAML files were never deleted because the original `ScenarioRunner.test.ts` still uses them.
- **Potential impact:** Maintenance burden — adding a new scenario requires deciding which format to use. The 8 YAML scenarios cover only basic cases; the 45 JSON scenarios cover the canonical invariants. A discrepancy between the two would mask real issues.
- **Code snippet:**
```
financial-tests/
├── scenarios/                 # 8 YAML files (original DSL, possibly stale)
│   ├── single_payment_partial.yml
│   ├── overpayment_creates_parent_credit.yml
│   └── ...
├── equivalence/scenarios/     # 45 JSON files (canonical, active)
│   ├── 001_simple_payment.json
│   └── ...
```

Stage Summary:
- 31 findings total (above the 15-25 target — exhaustive audit)
- Severity breakdown: Critical: 5 (BUSINESS-001, BUSINESS-002, CROSS-001, ARCH-001, WEAK-002), High: 13 (DUP-001, DUP-002, DRIFT-001, REG-001, WEAK-001, BUSINESS-003, SEC-001, SEC-002, DRIFT-004, BUSINESS-004, CROSS-003, DRIFT-006, WEAK-005), Medium: 8 (DEAD-001, DRIFT-002, WEAK-003, DEAD-002, DRIFT-003, DEAD-003, ARCH-002, BUSINESS-005), Low: 5 (CROSS-002, DRIFT-005, WEAK-004, CROSS-004, DEAD-004)
- Top 5 critical issues:
  1. **BUSINESS-002**: `SupabasePaymentRepository.collect()` silently falls back to non-atomic upsert on RPC failure — financial state silently broken on any RPC error
  2. **WEAK-002**: `collect-payment` Edge Function validates check/transfer fields then drops them when calling the canonical RPC — bank reconciliation impossible for edge-function-collected payments
  3. **BUSINESS-001**: `reconcileFinancials()` runs only 4 of 6 canonical cross-checks — silent data corruption goes undetected (BALANCE_SUM_MISMATCH + UNBACKED_PARENT_CREDIT never flagged)
  4. **ARCH-001**: 25+ repositories still mock-backed in "Supabase mode" — workforce, operations, clubs, therapy, workflow, AI config, backups all silently in-memory in production
  5. **CROSS-001**: Migration numbering conflict between desktop (0025-0028) and website (0025-0028) — applying both sets to the same Supabase project silently breaks one or the other
- Notable cross-repo links:
  - **CROSS-001**: Desktop migration numbering collides with website migration numbering (0025-0028) — same Supabase project, divergent schemas
  - **CROSS-003**: Android's `supabase/migrations/` is a partial copy (only 0034-0036, 0040-0042) — missing base schema, depends on desktop's 0001-0028
  - **DRIFT-001**: Mock parent_code uses Math.random(); Android's `LocalStudentRepository.batchRegister` had the same bug per `financial-logic-comparison-v2.md` (D35) — both apps violate canonical §7.1
  - **CROSS-004**: `bind-activation-code` Edge Function had to be patched to accept both `code` (Next.js portal) and `activation_code` (desktop/Android) body keys — signals lack of shared API contract
  - **DRIFT-006**: Canonical overdue rule (INV-4) was implemented 3 times (desktop TS, SQL, Android Kotlin) with different thresholds (0.001 DZD vs 100L centimes on Android) — migration 0042 aligned SQL with desktop but Android remains misaligned
  - **DUP-001 / DUP-002**: Four parallel cross-platform equivalence test frameworks (yml DSL, equivalence TS, equivalence-live mjs, cross-platform-v2 TS) + two drifted copies of kotlin_mirror_engine.ts (1313 vs 1311 lines)
  - **REG-001**: 10 fix-up migrations (0034-0043) after the "unification" was supposedly complete in 0026/0027/0028 — each migration documents bugs the previous "canonical" version missed

---
Task ID: 2-b
Agent: general-purpose (elimtiyaz-android auditor)
Task: Deep audit of /home/z/my-project/repos/elimtiyaz-android/ (Android app)

Work Log:
- Read shared worklog (Task 2-a findings reviewed — 31 findings from desktop audit)
- Inventoried 388 files (344 .kt + 6 .sql + Gradle/manifest/res); 313 source .kt under app/src/main/java/com/example/
- Cross-referenced against desktop (`/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/`) and website (`/home/z/my-project/repos/elimtiyaz-website/supabase/`)
- Ran git log on suspicious files (commit count: 40, earliest 2026-07-25 "first commit", latest 2026-08-28 "fix(core): pending-waterfall capacity subtracts existing uncleared funds")
- Identified 30 findings (10 Critical/High, 11 Medium, 9 Low)

Repo Summary:
- Language(s): Kotlin 1.9+ (JVM 11 target), SQL (plpgsql — supabase migrations are a partial copy), XML (Android resources/manifest)
- Framework(s): Android SDK 35 (compileSdk=35, minSdk=24), Kotlin, Jetpack Compose (BOM), Hilt (DI), Room (offline cache, version 11), WorkManager (sync), Supabase Kotlin SDK (Ktor engine), multiplatform-settings (JWT persistence), CameraX, DataStore, Accompanist permissions, Coil, Firebase Messaging (FCM) + AppCheck reCAPTCHA, Ktor + OkHttp + Retrofit (kept for compat), kotlinx.serialization + datetime, Roborazzi (screenshot tests)
- Entry point(s): `app/src/main/java/com/example/ElImtiyazApplication.kt` (@HiltAndroidApp), `app/src/main/java/com/example/MainActivity.kt` (Compose setContent), `app/src/main/AndroidManifest.xml`, `gradle/libs.versions.toml`, `app/build.gradle.kts` (applicationId `com.aistudio.elimtiyazstaff.bxmzlx` — Google AI Studio–generated package, namespace `com.example` — default template)
- Total commits: 40 (single-word messages: "kay", "mid", "okay", "coool", "kk", "ddd", "idk", "suace", "aight mid", "mid cv", "sub", "fk", "oki", "ncie", "okya", "idkmid", "sauce", "KAY", "first commit" — same poor hygiene as the desktop repo; only the most recent commit has a meaningful message)
- Total source files: 344 .kt (313 in main + 31 in test), 6 .sql migrations, 1 google-services.json

Findings:

### FINDING DUP-003 — Two parallel Compose design systems with 18 same-named duplicate component classes

- **What:** The Android repo ships TWO complete Compose design systems side-by-side: the legacy `com.example.ui.components.El*` (26 files in `app/src/main/java/com/example/ui/components/`) and the new `com.example.ui.designsystem.components.*/El*` (60+ files across `app/src/main/java/com/example/ui/designsystem/components/{button,card,data,display,nav,feedback,input,tabs}/`). 18 classes share the SAME simple name (e.g. `ElButton`, `ElCard`, `ElTextField`, `ElTopBar`, `ElStatCard`, `ElEmptyState`, `ElFab`, `ElIconButton`, `ElDropdown`, `ElSectionHeader`, `ElInfoRow`, `ElTag`, `ElAvatar`, `ElBadge`, `ElAlertBanner`, `ElDivider`, `ElScaffold`, `ElGradientStatCard`) in different packages — importing the wrong one in a feature file silently picks the wrong implementation.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/ui/components/` (legacy) + `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/ui/designsystem/components/` (new)
- **Lines:** All files in both directories; 18 class-name collisions counted via `comm -12`
- **Category:** DUP
- **Severity:** High
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** The new design system (`ui.designsystem.components.*`) is intended canonical per `MainActivity` import; the legacy `ui.components.*` is the pre-redesign version
- **Whether this duplicate is actually used:** Yes — both are actively imported. 37 feature files import from `com.example.ui.components.*` (5+ imports each); 23 files import from `com.example.ui.designsystem.components.*` (mostly dashboard + design system gallery). The dashboard screens were rewritten against the new design system; CRM/financials/academics/auth/personnel/settings still use the legacy components.
- **What depends on it:** Every feature screen (`ui/features/*/*Screen.kt`); 180 total `import com.example.ui.components.*` occurrences across 37 files vs 172 `import com.example.ui.designsystem.components.*` occurrences across 23 files
- **Other platforms/layers affected:** Desktop uses a single Radix UI + Tailwind design system — no parallel duplicate. Website uses single Next.js + Tailwind design system. The duplication is Android-only and signals an incomplete design-system migration.
- **Behavioral differences:** The legacy `ElButton` uses simple params (text, onClick, modifier); the new `ElButton` uses a `ButtonStyleResolver` + `ButtonTypes` enum + tokens. Same for `ElCard` (legacy plain Card vs new `CardStyleResolver`). UI rendered with the legacy components will not respect the new design tokens (spacing, motion, elevation, glass) that the new theme publishes via CompositionLocals.
- **Confidence:** Confirmed
- **Git evidence:** Legacy `ui/components/ElButton.kt` last modified in `6875ac3` "sauce" (2026-08-11); new `ui/designsystem/components/button/ElButton.kt` introduced later — both actively maintained
- **Likely root cause:** A new design system was scaffolded (`ui/designsystem/`) without deleting or wrapping the legacy `ui/components/`. The dashboard was migrated first as a "reference implementation"; the remaining 37 feature screens were never migrated.
- **Potential impact:** Two design systems diverge over time (e.g. legacy `ElButton` doesn't get the new `ButtonStyleResolver`'s loading/disabled states). New developers unknowingly mix components from both systems in the same screen, producing inconsistent UI. Bug fixes to the legacy components don't propagate to the new system and vice versa.
- **Code snippet:**
```kotlin
// CounterPaymentScreen.kt:75-81 — uses LEGACY components
import com.example.ui.components.ElAvatar
import com.example.ui.components.ElButton
import com.example.ui.components.ElCard
import com.example.ui.components.ElDropdown
import com.example.ui.components.ElTextField
// ...
// DashboardHubScreen.kt — uses NEW design system components
import com.example.ui.designsystem.components.button.ElButton   // same name, different package
```

### FINDING DUP-004 — Two `ElImtiyazTheme` composables with the same name in different packages

- **What:** There are TWO `@Composable fun ElImtiyazTheme(...)` functions in different packages: `com.example.ui.theme.ElImtiyazTheme` (legacy, 84 lines, publishes `LocalElDesignTokens` + `LocalSemanticColors`) and `com.example.ui.designsystem.theme.ElImtiyazTheme` (new, 85 lines, publishes `LocalElColors` + `LocalElSpacing` + `LocalElElevation` + `LocalElBorders` + `LocalElMotion` + `LocalElTextStyles` + `LocalElShadowColor`, also applies edge-to-edge). Both have the SAME signature. `MainActivity` imports the new one; the legacy one is dead in production.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/ui/theme/ElImtiyazTheme.kt` (legacy) + `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/ui/designsystem/theme/Theme.kt` (new)
- **Lines:** Legacy `ElImtiyazTheme.kt:14`; new `Theme.kt:30`
- **Category:** DUP
- **Severity:** Medium
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** `com.example.ui.designsystem.theme.ElImtiyazTheme` is the canonical production theme (per `MainActivity.kt:17,30`)
- **Whether this duplicate is actually used:** Partial — the legacy `com.example.ui.theme.ElImtiyazTheme` is used ONLY by `GreetingScreenshotTest.kt:15,48` (a screenshot test) and by 4 references inside the legacy theme module itself. It is NOT used in production UI (MainActivity imports the new one).
- **What depends on it:** `GreetingScreenshotTest` (validates the legacy theme renders); internal references between legacy theme files (`ColorSchemes.kt`, `Color.kt`, etc.). The new design system has its own complete color/typography/shape files.
- **Other platforms/layers affected:** N/A — Android-only
- **Behavioral differences:** Legacy theme publishes `SemanticColors` (success/warning/info only) + `ElDesignTokens` (gradients, shimmerBase, glassTint). New theme publishes a full `ElColors` palette + 6 separate token systems (spacing, elevation, borders, motion, text styles, shadow). Screens using `ElTheme.colors.*` (the new accessor) will not work under the legacy theme, and vice versa for screens using `LocalElDesignTokens.current.*` (legacy accessor).
- **Confidence:** Confirmed
- **Git evidence:** Both files have been touched in many commits — the new design system was added during the post-`6875ac3` (2026-08-11) iterations
- **Likely root cause:** The new design system theme was scaffolded to ship the new visual identity (edge-to-edge, Material 3 colors, 6 token systems), but the legacy theme was kept "for compatibility" — and the screenshot test was never migrated to validate the new theme.
- **Potential impact:** Screenshot tests validate the WRONG theme (see WEAK-013). A developer adding a new screen might accidentally `import com.example.ui.theme.ElImtiyazTheme` instead of the new package, and the screen will render with the legacy design tokens (no edge-to-edge, no Material 3 dynamic colors, no extended tokens).
- **Code snippet:**
```kotlin
// MainActivity.kt:17 (production uses the NEW theme)
import com.example.ui.designsystem.theme.ElImtiyazTheme
// ...
ElImtiyazTheme { AppNavHost() }

// GreetingScreenshotTest.kt:15 (test validates the LEGACY theme — not what production uses)
import com.example.ui.theme.ElImtiyazTheme
// ...
ElImtiyazTheme { Text("El-Imtiyaz", color = PrimaryBlue) }
```

### FINDING DUP-005 — Two parallel Room entity / DAO / mapper layers coexist in the same database (partial migration)

- **What:** The Room database has TWO complete entity layers: the legacy `Entities.kt` (`ParentCacheEntity`, `StudentCacheEntity`, `PaymentCacheEntity`, `LedgerCacheEntity`, `SyncQueueEntity` — 5 "cache" entities, 134 lines, with comment "Room is NOT the primary store; it's a read cache + sync queue. Supabase is the source of truth.") and the new `LocalEntities.kt` (24 source-of-truth entities, 577 lines, with comment "Room is the PRIMARY store for this build. The mobile app is designed to work offline-first."). Mirrored by `Daos.kt` (5 legacy cache DAOs) + `LocalDaos.kt` (22 new DAOs) and `CacheMappers.kt` (122 lines) + `LocalMappers.kt` (359 lines). Both layers are wired into Hilt in `DatabaseModule.kt`.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/room/Entities.kt` + `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/room/LocalEntities.kt`; `Daos.kt` + `LocalDaos.kt`; `CacheMappers.kt` + `LocalMappers.kt`
- **Lines:** All files; 1986 total lines across the 6 duplicate-pair files
- **Category:** DUP
- **Severity:** High
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** Unclear — the LEGACY `Entities.kt` says Supabase is the source of truth (matching the desktop's "Supabase is canonical" model); the NEW `LocalEntities.kt` says Room is the primary store (matching an offline-first rearchitecture). Both intentions coexist.
- **Whether this duplicate is actually used:** Yes — both DAO sets are exposed via `@Provides` in `DatabaseModule.kt:97-111` (legacy cache DAOs) + `:114-178` (new DAOs). `SyncQueueDao` (legacy) is used by `SyncService`; `ParentCacheDao`/`StudentCacheDao`/`PaymentCacheDao`/`LedgerCacheDao` (legacy) are used by `SyncSupport.kt:41-44` (`upsertParents`, `listCachedParents`, etc.). The new DAOs are used by all `Local*Repository` classes.
- **What depends on it:** `SyncService`, `SyncSupport`, all `Local*Repository` classes, `PullSyncRepository`
- **Other platforms/layers affected:** Mirrors the desktop's ARCH-001 finding (25+ repositories still mock-backed in "Supabase mode" — partial migration). The Android is mid-migration from "cache layer" semantics to "source-of-truth" semantics, just as the desktop is mid-migration from "mock" to "Supabase" repositories.
- **Behavioral differences:** The cache entities carry `syncedAt` (last fetch timestamp from Supabase); the source-of-truth entities don't. Pulls write to BOTH layers in some flows (e.g. `PullSyncRepository.pullParents` writes to `db.parentDao()` — the new layer — but `SyncSupport.upsertParents` writes to `parentCacheDao` — the legacy layer). Two layers can drift apart.
- **Confidence:** Confirmed
- **Git evidence:** `Entities.kt` last touched in `c519643` "coool" (2026-08-23); `LocalEntities.kt` last touched in `dd4c7dc` "kk" (2026-08-26). Both files have been actively maintained in parallel.
- **Likely root cause:** The Android was originally built as "Supabase is canonical, Room is a cache" (matching desktop). Later, an offline-first rearchitecture converted Room to "primary store" with new entities (`Local*` prefix). The legacy cache layer was kept "for sync compatibility" but never deleted.
- **Potential impact:** Two parallel data stores can drift (e.g. `parentCacheDao` shows 5 parents but `parentDao` shows 7). Sync writes go to one layer, reads go to the other. Bug surfaces when a developer assumes the layer they're reading is the same one they wrote to. The legacy `Entities.kt` comment directly contradicts the new `LocalEntities.kt` comment — architectural intent is split.
- **Code snippet:**
```kotlin
// Entities.kt:8-15 — LEGACY cache layer (Supabase is canonical)
/**
 * Room cache entities — mirror the Supabase schema for offline reads.
 * Room is NOT the primary store; it's a read cache + sync queue.
 * Supabase is the source of truth.
 */

// LocalEntities.kt:7-19 — NEW source-of-truth layer (Room is canonical)
/**
 * Local source-of-truth entities — Room is the PRIMARY store for this build.
 * The mobile app is designed to work offline-first.
 * Mirrors the desktop's Supabase schema field-by-field.
 */
```

### FINDING CROSS-005 — Android `LocalPaymentRepository.collect()` bypasses the canonical `collect_payment` RPC

- **What:** Android's payment write path is: write Payment + LedgerEntry + Adjustment entries to Room locally → enqueue `payment/create` + `ledger_entry/create` + (optionally) `ledger_entry/create` (parent_credit) sync entries → `SyncQueueDispatcher.pushPayment` later calls `upsert_payment_from_import` (non-atomic idempotent upsert) instead of the desktop's canonical `collect_payment` atomic RPC. The desktop audit's BUSINESS-002 finding flagged the desktop's `SupabasePaymentRepository.collect()` for silently falling back to `upsert_payment_from_import` on RPC failure — but the Android ALWAYS uses `upsert_payment_from_import` and never even attempts the canonical `collect_payment` RPC.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:942-1090` (LocalPaymentRepository.collect) + `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:193-240` (pushPayment)
- **Lines:** `LocalPaymentRepository.collect` lines 942-1090; `SyncQueueDispatcher.pushPayment` lines 193-240; the RPC name `upsert_payment_from_import` at line 238
- **Category:** CROSS
- **Severity:** Critical
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** Desktop's canonical `collect-payment` Edge Function (`/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/collect-payment/index.ts`) — atomic, server-side, includes waterfall allocation + receipt generation + audit trail
- **Whether this duplicate is actually used:** Yes — every payment collected on Android flows through this path; the canonical `collect_payment` RPC is never called from Android.
- **What depends on it:** `CounterPaymentScreen`, `CounterPaymentViewModel`, `InstallmentScheduleViewModel.markPaid` (which calls `LocalPaymentRepository.collect` indirectly via the backing-payment path), every payment write on Android
- **Other platforms/layers affected:** Desktop uses `collect-payment` Edge Function (canonical). Website uses something else (per website audit). Three platforms, three different write paths for the same business operation.
- **Behavioral differences:** (1) Android computes waterfall allocation LOCALLY via `allocatePaymentToInstallments` then pushes the resulting installments via `upsert_installment_from_import` — the desktop's `collect_payment` RPC computes waterfall SERVER-SIDE in a single atomic transaction. (2) Android's `receipt = "REC-$year-$seq"` is generated LOCALLY (see BUSINESS-006) — desktop's RPC generates the receipt server-side. (3) Android's path is non-atomic: if the network fails after writing Payment but before writing LedgerEntry, the local Room has inconsistent state and the sync queue has orphan entries. (4) Android's path doesn't respect any server-side CHECK constraints until the queue drains — invalid payments land locally first, then fail on push.
- **Confidence:** Confirmed
- **Git evidence:** `LocalRepositories.kt` history shows `94471e8` (2026-08-28) "fix(core): pending-waterfall capacity subtracts existing uncleared funds" — most recent commit, indicates the waterfall allocation logic was just patched
- **Likely root cause:** The Android was originally designed as offline-first with local Room as source of truth. The canonical RPC pattern (desktop) requires online-first semantics. Rather than bridge the two (e.g. call `collect_payment` when online, fall back to local write when offline), the Android bypassed the canonical RPC entirely and uses the import-upsert RPC as the only push path — which is non-atomic and lacks the canonical RPC's invariants.
- **Potential impact:** (1) Two platforms writing the same payment via different RPCs can produce divergent server-side state (e.g. the canonical RPC's audit trail vs the import-upsert's silent upsert). (2) Server-side invariants enforced by `collect_payment` (e.g. payment cannot exceed outstanding balance, waterfall order preservation) are bypassed. (3) Concurrent Android + desktop writes for the same parent can race and produce duplicate ledger entries (the import-upsert dedupes by `entry_number` but the canonical RPC dedupes by `(sourceType, sourceId)` — different keys, different dedupe semantics).
- **Code snippet:**
```kotlin
// LocalPaymentRepository.collect — LOCAL write + sync enqueue
paymentDao.upsert(entity)
syncSupport?.enqueueOnly(
    entity = "payment", operation = "create",
    payload = syncJson { put("id", entity.id); put("receiptNumber", entity.receiptNumber); ... },
    isMock = false, sourceScreen = "CounterPaymentScreen",
)
// SyncQueueDispatcher.pushPayment — later calls the non-atomic import RPC
NetworkTimeouts.guard<Unit>("sync.pushPayment", timeoutMs = 5_000L) {
    supabaseProvider.postgrest.rpc("upsert_payment_from_import", params)  // NOT collect_payment
}
```

### FINDING CROSS-006 — Android `LocalPaymentRepository.refund()` bypasses the canonical `refund-payment` Edge Function

- **What:** Android's refund path is: update Payment status to REFUNDED in Room → enqueue `payment/refund` sync entry → locally create `createReversalEntry` in ledger → enqueue `ledger_entry/reverse` sync entry → locally call `revertPaymentAllocation` to revert installment allocations. The `SyncQueueDispatcher` later calls `upsert_payment_from_import` with `status=refunded` for the payment row and `upsert_ledger_entry_from_import` for the reversal entry. The desktop's canonical `refund-payment` Edge Function (`/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/refund-payment/index.ts`) is NEVER called from Android.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:1092-1168` (LocalPaymentRepository.refund) + `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:193-287`
- **Lines:** `LocalPaymentRepository.refund` lines 1092-1168; `SyncQueueDispatcher.pushPayment` line 238 (`upsert_payment_from_import`) + `pushLedgerEntry` line 285 (`upsert_ledger_entry_from_import`)
- **Category:** CROSS
- **Severity:** Critical
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** Desktop's canonical `refund-payment` Edge Function — server-side atomic, handles refund policy validation (e.g. blocks refunds of `cancelled` payments per desktop WEAK-001 finding), creates the ledger reversal, reverts installment allocations
- **Whether this duplicate is actually used:** Yes — every refund on Android flows through this path; the canonical `refund-payment` Edge Function is never called from Android.
- **What depends on it:** `PaymentDetailScreen`, every refund action on Android
- **Other platforms/layers affected:** Desktop uses `refund-payment` Edge Function (canonical, with the bugs noted in desktop WEAK-001/DRIFT-002/BUSINESS-003). Website uses something else (per website audit). Android uses import-upsert RPC.
- **Behavioral differences:** (1) Android preserves the user's `reason` parameter in the reversal entry's description (better than desktop BUSINESS-003's hardcoded "Manual refund"). (2) Android's path is non-atomic — local Room write succeeds, sync push can fail and retry. (3) Android's path bypasses the canonical refund policy validation (e.g. blocks refunds of cancelled payments per desktop WEAK-001) — Android would happily refund a cancelled payment. (4) Android uses `originalWasPending` branching correctly (line 1143-1163) which the desktop's SQL RPC also handles.
- **Confidence:** Confirmed
- **Git evidence:** Refund code touched in `94471e8` (2026-08-28) "fix(core): pending-waterfall capacity subtracts existing uncleared funds" — the originalWasPending branch was added recently
- **Likely root cause:** Same as CROSS-005 — Android chose offline-first local-write + sync-push instead of canonical RPC. The `refund-payment` Edge Function's server-side invariants are bypassed.
- **Potential impact:** (1) Android can refund a `cancelled` payment (canonical `refund-payment` blocks this per desktop WEAK-001). (2) The `refund-payment` Edge Function's audit action `payment.refund` is logged server-side via the Edge Function — Android bypasses it, so the server audit trail for Android refunds is missing. (3) Concurrent Android + desktop refunds for the same payment can race — both succeed locally, then one fails on push.
- **Code snippet:**
```kotlin
// LocalPaymentRepository.refund — LOCAL write + sync enqueue
val updated = existing.copy(status = PaymentStatus.REFUNDED.code, updatedAt = now)
paymentDao.update(updated)
syncSupport?.enqueueOnly(
    entity = "payment", operation = "refund",  // SyncQueueDispatcher maps this to pushPayment → upsert_payment_from_import
    payload = syncJson { put("id", existing.id); put("status", PaymentStatus.REFUNDED.code); ... },
    isMock = false, sourceScreen = "PaymentDetailScreen",
)
// NOTE: never calls the canonical refund-payment Edge Function
```

### FINDING CROSS-007 — Android's local `supabase/migrations/` is older — missing `SET search_path = public, extensions;` security hardening

- **What:** The Android repo carries 6 of the desktop's migrations (0034, 0035, 0036, 0040, 0041, 0042). Of these, migrations 0034, 0036, 0040, 0041 DIFFER from the desktop's canonical versions: the desktop's versions have `LANGUAGE plpgsql SET search_path = public, extensions;` on SECURITY DEFINER functions (protection against search_path hijacking), but the Android's versions have just `LANGUAGE plpgsql;` (no search_path pinning). Migration 0042 is byte-identical; migration 0035 is byte-identical.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/supabase/migrations/0034_canonical_engine_unification.sql` (5 functions affected) + `0036_tier4_backend_hardening.sql` (2 functions) + `0040_cross_platform_rpc_unification.sql` (3 functions) + `0041_canonical_academic_flow.sql` (2 functions)
- **Lines:** e.g. 0034 lines 133, 425, 627, 772, 816 differ; 0036 lines 109, 144 added in desktop; 0040 lines 197, 303, 446 differ; 0041 lines 643, 795 differ
- **Category:** CROSS
- **Severity:** High
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** Desktop's `supabase/migrations/0034_canonical_engine_unification.sql` (and 0036, 0040, 0041) — canonical versions with `SET search_path = public, extensions;`
- **Whether this duplicate is actually used:** No — the Android repo's migrations are NEVER applied to a Supabase project from this repo (the desktop repo is the source of truth for Supabase migrations). They're a documentation copy that's drifted.
- **What depends on it:** N/A (the migrations are documentation-only on Android)
- **Other platforms/layers affected:** Desktop's migrations are applied to production. Website's migrations (0025-0028) are separate. If a developer naively copies the Android's migration folder to set up a new Supabase project, they get the LESS SECURE versions (no search_path pinning).
- **Behavioral differences:** SECURITY DEFINER functions without `SET search_path` are vulnerable to search_path hijacking: a malicious user with CREATE privileges on a schema earlier in `search_path` can shadow a function or operator used by the SECURITY DEFINER function and execute code with the function's elevated privileges.
- **Confidence:** Confirmed (verified via `cmp -s` and `diff`)
- **Git evidence:** Android repo's migrations are committed (first commit `e9aa7a3` "first commit" 2026-07-25); never updated since — the desktop's migrations have been hardened after the Android copy was made
- **Likely root cause:** The Android repo's `supabase/migrations/` is a stale partial copy of the desktop's canonical migrations (per desktop CROSS-003 finding). The desktop was later hardened with `SET search_path = public, extensions;` (per desktop REG-001's fix-up migration pattern); the Android copy was never re-synced.
- **Potential impact:** If a developer copies the Android's migrations folder to bootstrap a fresh Supabase project (e.g. for testing), they'll deploy LESS SECURE functions. If the production Supabase uses the desktop's hardened versions (likely the case), there's no direct production impact — but the divergence is a documentation drift that misleads maintainers about what's actually deployed.
- **Code snippet:**
```sql
-- Android's 0034_canonical_engine_unification.sql line 133 (LESS SECURE)
$$ LANGUAGE plpgsql;

-- Desktop's 0034_canonical_engine_unification.sql line 133 (canonical, hardened)
$$ LANGUAGE plpgsql SET search_path = public, extensions;
```

### FINDING DEAD-005 — `deterministicStudentCode()` is dead code; `createStudent` uses collision-prone sequential numbering

- **What:** `IdentityCodes.kt` defines `deterministicStudentCode(year, parentId, input)` which derives a student code from a stable FNV-1a hash of `(parentId, displayName, firstName, lastName)` — the canonical idempotency rule. But `LocalStudentRepository.createStudent` (line 497-498) generates the student code as `"ELV-$year-$seq"` where `seq = (studentDao.countActive() + 1).toString().padStart(6, '0')` — sequential numbering. Same for `batchRegister` (line 604). `deterministicStudentCode` is NEVER called anywhere in the production code (only in tests).
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/core/IdentityCodes.kt:107-125` (definition) + `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:497-498, 604-605` (call sites that should use it but don't)
- **Lines:** `deterministicStudentCode` at IdentityCodes.kt:107; `createStudent` seq generation at LocalRepositories.kt:497-498; `batchRegister` seq generation at LocalRepositories.kt:604
- **Category:** DEAD
- **Severity:** High
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** `deterministicStudentCode` is the canonical implementation (per the file's comment "Kotlin port of the desktop's `deterministicParentCode` + `stableHash`")
- **Whether this duplicate is actually used:** No — `deterministicStudentCode` is dead code in production. Only `deterministicParentCode` and `deterministicActivationCode` are called from `LocalParentRepository`.
- **What depends on it:** Nothing in production (only IdentityCodesTest.kt tests it)
- **Other platforms/layers affected:** Desktop uses `deterministicParentCode` for parents. Desktop audit's DEAD-001 finding flagged `randomActivationCode()` as dead code on desktop — Android mirrors this pattern (canonical function exists, not used).
- **Behavioral differences:** Sequential numbering (`countActive() + 1`) is: (1) collision-prone — if students are deleted, countActive decreases, next call reuses a previously-issued code → `StudentEntity`'s `@Index("code", unique = true)` constraint violation (LocalEntities.kt:78); (2) race-condition-prone — two concurrent `createStudent` calls both read the same count, both generate the same seq, one fails with UNIQUE constraint violation; (3) per-device — different devices generate the same `"ELV-2026-000001"` for the first student of the year → on sync push, `upsert_student_from_import` matches by `(tenant_id, student_code)` and OVERWRITES the other device's student (data loss).
- **Confidence:** Confirmed
- **Git evidence:** `IdentityCodes.kt` last touched in `94471e8` (2026-08-28); `LocalRepositories.kt:497-498` last touched in `dd4c7dc` "kk" (2026-08-26). Both recent.
- **Likely root cause:** The developer added `deterministicStudentCode` to mirror `deterministicParentCode` but never wired it into `createStudent` / `batchRegister`. The sequential code generation predates the deterministic function and was never refactored.
- **Potential impact:** Two Android devices registering students in parallel generate the same code → server-side upsert OVERWRITES one device's data. A deleted student's code can be reused for a different student → historical references (e.g. `assessments.student_id`, `attendance_records.student_id`) silently point to the wrong student.
- **Code snippet:**
```kotlin
// IdentityCodes.kt:107 — CANONICAL deterministic function (DEAD CODE in production)
fun deterministicStudentCode(year: Int, parentId: String, input: StudentCodeInput): String {
    val identity = listOf(parentId, input.displayName, input.firstName, input.lastName)
        .joinToString("|").trim()
    val suffix = if (identity.isNotEmpty()) stableHash(identity) else ...
    return "ELV-$year-$suffix"
}

// LocalRepositories.kt:497-498 — what createStudent ACTUALLY uses
val seq = (studentDao.countActive() + 1).toString().padStart(6, '0')  // sequential, collision-prone
val code = "ELV-$year-$seq"
```

### FINDING DEAD-006 — `SyncQueueDispatcher`'s `generateParentCode()` / `generateStudentCode()` / `generatePaymentNumber()` use `Math.random()`, bypass canonical deterministic functions

- **What:** `SyncQueueDispatcher` defines three private helpers — `generateParentCode()`, `generateStudentCode()`, `generatePaymentNumber()` — that generate codes via `chars.random()` and `(1..1_000_000).random()`. These are used as FALLBACKS when a sync payload lacks a code (e.g. `pushParent` line 147: `p.str("code") ?: p.str("parent_code") ?: generateParentCode()`). They bypass the canonical `deterministicParentCode` / `deterministicStudentCode` functions in `IdentityCodes.kt`.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt:393-410` (helpers) + lines 147, 175, 209 (call sites)
- **Lines:** `generateParentCode` 393-398; `generateStudentCode` 400-404; `generatePaymentNumber` 406-410; call sites 147, 175, 209
- **Category:** DEAD
- **Severity:** Medium
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** `IdentityCodes.kt`'s `deterministicParentCode` / `deterministicStudentCode` (canonical)
- **Whether this duplicate is actually used:** Yes — they're fallbacks that fire when the sync payload lacks a code. For payments, the LocalPaymentRepository always sets `receiptNumber` in the payload, so `generatePaymentNumber()` rarely fires. For parents/students, the LocalParentRepository sets `code` and `parentCode` in the payload, so the fallbacks rarely fire. But if a future code path forgets to set the code, the random fallback kicks in silently — and breaks idempotent upsert.
- **What depends on it:** `SyncQueueDispatcher.pushParent`, `pushStudent`, `pushPayment` when the payload lacks a code
- **Other platforms/layers affected:** Desktop's mock `parent-repository` had the same `Math.random()` bug per desktop DRIFT-001 finding. Both apps have parallel random code generators that violate the canonical §7.1 deterministic rule.
- **Behavioral differences:** Random codes break idempotent upsert: the same logical parent pushed twice (e.g. retry after network failure) generates two DIFFERENT codes → server sees them as two different parents → duplicate parent rows.
- **Confidence:** Confirmed
- **Git evidence:** `SyncQueueDispatcher.kt` last touched in `94471e8` (2026-08-28) — the most recent commit
- **Likely root cause:** The dispatcher's helpers predate the `IdentityCodes.kt` deterministic functions (added in TIER 2 R15). The dispatcher was never refactored to use the canonical functions; the random fallbacks remain as "defensive" code that violates the canonical rule.
- **Potential impact:** If a code path forgets to set the code in the sync payload (e.g. a new repository that doesn't follow the SyncSupport pattern), the dispatcher generates a random code → the same logical entity pushed twice creates two server rows → duplicate parents/students/payments on the server. The canonical deterministic functions would have generated the SAME code on retry → idempotent upsert.
- **Code snippet:**
```kotlin
// SyncQueueDispatcher.kt:393-410 — random fallbacks (BYPASS canonical)
private fun generateParentCode(): String {
    val year = java.time.Year.now().value
    val chars = ('A'..'Z') + ('0'..'9')
    val suffix = (1..4).map { chars.random() }.joinToString("")  // Math.random under the hood
    return "PAR-$year-$suffix"
}
private fun generateStudentCode(): String {
    val year = java.time.Year.now().value
    val seq = (1..1_000_000).random()  // Math.random
    return "ELV-$year-${seq.toString().padStart(6, '0')}"
}
// SHOULD USE: deterministicParentCode(year, ParentCodeInput(...)) from IdentityCodes.kt
```

### FINDING WEAK-006 — `LocalInstallmentRepository.regenerateForCycle()` is hollow — only writes audit log, doesn't actually regenerate installments

- **What:** The `regenerateForCycle` method is supposed to re-derive installment due dates for a new academic cycle (per CANONICAL-FINANCIAL-LOGIC.md §7.3). The desktop's `SupabaseInstallmentRepository.regenerateForCycle` (2138-2197 lines) actually fetches the parent's installments, computes new due dates via `getOfficialTuitionDueDates(year, cycle)`, calls `client.from("installments").update(...)` for each unpaid installment, and returns the patched list. The Android's version just writes an audit log entry and returns the existing installments UNCHANGED.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:1360-1363`
- **Lines:** 1360-1363
- **Category:** WEAK
- **Severity:** Critical
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** Desktop's `SupabaseInstallmentRepository.regenerateForCycle` at `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:2138-2197`
- **Whether this duplicate is actually used:** Yes — the `InstallmentScheduleScreen` and `InstallmentScheduleViewModel` call `regenerateForCycle` when the user clicks "Re-modéliser les tranches" (per desktop `installment-schedule-tab.tsx:176-185` shows the call site; Android has the equivalent UI). The user sees a success toast with "X tranche(s) selon le cycle Y" but no installments were actually updated.
- **What depends on it:** `InstallmentScheduleViewModel`, `InstallmentScheduleScreen`
- **Other platforms/layers affected:** Desktop's regenerate actually works; Android's silently does nothing. Same UI action → different behavior on desktop vs Android.
- **Behavioral differences:** Desktop: installments' due dates are updated to the new cycle's official dates; `is_custom_schedule = false`, `custom_schedule_note = null`, `academic_cycle = cycle`. Android: nothing changes; the audit log lies that "installment.regenerate" happened.
- **Confidence:** Confirmed
- **Git evidence:** Method touched in `dd4c7dc` "kk" (2026-08-26) — recent, but the hollow behavior wasn't fixed
- **Likely root cause:** The Android's `regenerateForCycle` was likely a stub that returned a successful Result to unblock UI development, and was never replaced with the real implementation. The audit log entry makes it LOOK like work happened.
- **Potential impact:** (1) Users on Android who click "Re-modéliser les tranches" see a success toast but the installment schedule doesn't change — they may click again repeatedly, generating duplicate audit entries. (2) If the parent's actual due dates need to change (e.g. the school changed the official tranche schedule mid-year), Android users will see the OLD schedule while desktop users see the NEW one. (3) The audit log entry is fraudulent — it claims `installment.regenerate` happened when nothing was regenerated, complicating compliance investigations.
- **Code snippet:**
```kotlin
// LocalRepositories.kt:1360-1363 — HOLLOW implementation
override suspend fun regenerateForCycle(parentId: String, cycle: String, actorId: String, actorName: String): Result<List<Installment>> {
    auditDao.upsert(audit("installment.regenerate", "installment", parentId, actorId, actorName, after = """{"cycle":"$cycle"}"""))
    return Result.Ok(installmentDao.listByParent(parentId).map { LocalMappers.run { it.toDomain() } })
    // ❌ No actual regeneration. Returns existing installments unchanged.
}

// Desktop's canonical implementation actually updates installments:
//   const [t1, t2, t3] = getOfficialTuitionDueDates(year, cycle);
//   for (const inst of familyInstallments) {
//     if (inst.status === "paid") continue;
//     const trancheNum = inst.label?.match(/(\d)/)?.[1] ?? "1";
//     const newDueDate = trancheNum === "1" ? t1 : trancheNum === "2" ? t2 : t3;
//     await this.client.from("installments").update({ due_date: newDueDate, ... }).eq("id", inst.id);
//   }
```

### FINDING WEAK-007 — Dashboard "Créances en Retard" KPI + Debt Dashboard overdue amount are PERMANENTLY 0 (missing `overdueCategoryDueDates` map)

- **What:** `LedgerEngine.computeParentSummary` takes an optional `overdueCategoryDueDates: Map<String, Instant> = emptyMap()` parameter. The function's overdue logic at line 148 is `if (dueDate != null && acc.balance > 0L && dueDate.isBefore(now)) totalOverdue += acc.balance`. Since the default is an empty map, `dueDate` is always null, so `totalOverdue` is ALWAYS 0 — UNLESS the caller explicitly builds and passes the overdue-due-dates map via `LedgerEngine.buildOverdueDueDateMap` (defined at line 163). The dashboard (`LocalDashboardRepository.observeKpis` lines 274-290), the debt dashboard (`LocalDebtRepository.observeSummary` lines 619-632), and the parent profile (`LocalDebtRepository.observeParentProfile` lines 644-670) ALL call `computeParentSummary(parentEntries, pid, parentName)` without the overdue map → `totalOverdue` is always 0.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories2.kt:283-290, 619-632, 644-670, 687` (call sites) + `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/core/LedgerEngine.kt:109-161, 163-166` (function + builder)
- **Lines:** `LocalDashboardRepository.observeKpis` lines 283-290 (overdueDebt + overdueFamiliesCount); `LocalDebtRepository.observeSummary` line 621 (summary.totalOutstanding — this one is OK; totalOverdue not used here); `LocalDebtRepository.observeParentProfile` line 670 (`overdueAmount = summary.totalOverdue.coerceAtLeast(0L)` — always 0); `LocalDebtRepository.sendReminder` line 698 (`if (summary.totalOverdue > 0L) "high" else "medium"` — always "medium")
- **Category:** WEAK
- **Severity:** Critical
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** Desktop's `debt-ops.ts:43-44` does `const dueDateMap = buildOverdueDueDateMap(parentEntries); const summary = computeParentSummary(parentEntries, p.id, name, dueDateMap);` — properly builds the map BEFORE calling computeParentSummary. Android skips this step.
- **Whether this duplicate is actually used:** Yes — these are the production code paths for the dashboard KPIs and debt dashboard.
- **What depends on it:** `DashboardViewModel.overdueDebt` / `overdueFamiliesCount` StateFlows (consumed by `DashboardKpiCardsRow`); `DashboardHubScreen`; `DebtDashboardScreen`; `ParentFinancialProfile.overdueAmount`; debt reminder notifications' priority
- **Other platforms/layers affected:** Desktop correctly shows overdue amounts (uses `buildOverdueDueDateMap`). Android shows 0. Same data → different KPIs on each platform.
- **Behavioral differences:** Android dashboard always shows "0 DZD" for "Créances en Retard" and "0 famille(s) en souffrance", even when there are overdue accounts. The debt dashboard's per-parent `overdueAmount` is always 0. Debt reminder notifications always have priority "medium" (never "high") regardless of overdue state.
- **Confidence:** Confirmed
- **Git evidence:** `LocalRepositories2.kt` last touched in `94471e8` (2026-08-28); `LedgerEngine.kt` last touched in `94471e8`. The `buildOverdueDueDateMap` function EXISTS but is never called from production code (only in `ReconcileTest.kt`).
- **Likely root cause:** A "TIER 2 R16" fix (per the inline comment at LocalRepositories2.kt:279-282) replaced the previous "naive installment-filter" overdue computation with the canonical `computeParentSummary.totalOverdue`. But the developer didn't realize that `computeParentSummary` requires the caller to pass `overdueCategoryDueDates` — without it, `totalOverdue` is always 0. The fix replaced a working (naive) computation with a broken (canonical-but-misused) one.
- **Potential impact:** (1) Staff relying on the dashboard's "Créances en Retard" KPI to prioritize collections work see 0 — they miss ALL overdue accounts. (2) Debt reminders always go out at "medium" priority (not "high") even for severely overdue accounts — staff miss urgent cases. (3) The `overdueAlerts` KPI (line 330: `overdueAlerts = overdueFamiliesCount`) is also always 0 → the dashboard's alert badge never shows.
- **Code snippet:**
```kotlin
// LocalDashboardRepository.observeKpis:283-290 — calls computeParentSummary WITHOUT overdue map
val overdueDebt = parentIds.sumOf { pid ->
    val parentEntries = domainLedger.filter { it.parentId == pid }
    LedgerEngine.computeParentSummary(parentEntries, pid, "").totalOverdue.coerceAtLeast(0L)
    // ❌ overdueCategoryDueDates defaults to emptyMap() → dueDate is null → totalOverdue always 0
}

// LedgerEngine.kt:148 — overdue check requires non-null dueDate
val dueDate = overdueCategoryDueDates[acc.accountId]   // always null when map is empty
if (dueDate != null && acc.balance > 0L && dueDate.isBefore(now)) {  // never true
    totalOverdue += acc.balance
}

// LedgerEngine.kt:163 — the builder that SHOULD be called
fun buildOverdueDueDateMap(entries: List<LedgerEntry>): Map<String, Instant> = ...
```

### FINDING WEAK-008 — `LocalWorkflowRepository.toDomain()` hardcodes `trigger = WorkflowTrigger.fromCode("manual")` for every run

- **What:** The `WorkflowRunEntity.toDomain()` extension hardcodes the trigger type to `"manual"` regardless of the actual trigger. The `WorkflowRunEntity` doesn't even HAVE a `trigger` column (verified at LocalEntities.kt:566-577) — so the trigger type is LOST on pull from Supabase. Every workflow run displayed in the Android UI shows "Manual" trigger.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories2.kt:1793`
- **Lines:** 1793
- **Category:** WEAK
- **Severity:** Medium
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** Desktop's `WorkflowRun` domain model carries the real trigger type (manual, webhook, schedule, data_event, retry). The Supabase `workflow_runs` table has a `trigger` column (per desktop migrations).
- **Whether this duplicate is actually used:** Yes — every workflow run row pulled from Supabase passes through this mapper.
- **What depends on it:** `WorkflowMonitorScreen`, audit log filters that filter by trigger type
- **Other platforms/layers affected:** Desktop shows the real trigger; Android always shows "manual". Same workflow run → different trigger label on each platform.
- **Behavioral differences:** A webhook-triggered workflow run shows "Manual" on Android and "Webhook" on desktop. A scheduled run shows "Manual" on Android and "Schedule" on desktop. Staff using Android to triage workflow failures can't distinguish manual retries from automatic triggers.
- **Confidence:** Confirmed
- **Git evidence:** `WorkflowRunEntity` defined in LocalEntities.kt; `LocalRepositories2.kt:1793` last touched in `dd4c7dc` "kk" (2026-08-26)
- **Likely root cause:** The `WorkflowRunEntity` was defined without a `trigger` column (the desktop's table has one). When the toDomain mapper was written, the developer hardcoded "manual" as a "safe default" instead of adding the column to the entity + migration + DTO mapper.
- **Potential impact:** (1) Workflow triage on Android misleads staff — every run looks manual. (2) If an admin wants to disable a misbehaving webhook-triggered workflow, they can't tell from the Android UI which runs were webhook-triggered. (3) Filtering by trigger type in the audit log doesn't work (the hardcoded value filters false-positives).
- **Code snippet:**
```kotlin
// LocalRepositories2.kt:1791-1804 — toDomain hardcodes "manual"
private fun WorkflowRunEntity.toDomain() = com.example.domain.model.WorkflowRun(
    id = id, workflowId = workflowId, workflowName = workflowName,
    trigger = com.example.domain.model.WorkflowTrigger.fromCode("manual"),  // ❌ hardcoded
    status = com.example.domain.model.WorkflowRunStatus.fromCode(status),
    ...
)

// LocalEntities.kt:566-577 — entity has NO trigger column
data class WorkflowRunEntity(
    @PrimaryKey val id: String,
    val tenantId: String,
    val workflowId: String,
    val workflowName: String,
    val status: String,
    val startedBy: String,        // ← no `trigger` field
    val startedAt: String,
    val finishedAt: String?,
    val resultJson: String?,
    val errorMessage: String?,
)
```

### FINDING WEAK-009 — `OnlineDetector` always reports "online" — `isOnline()` ignores probe results, probe catches all exceptions and returns `true`

- **What:** Three compounding bugs make `OnlineDetector` permanently report "online": (1) Initial state defaults to `online = true` (line 38-40), so before the first probe completes, `isOnline()` returns `true`; (2) `isOnline()` returns `_state.value.connectivityActive` (line 132) — only checks if the device has ANY network, ignores `probeOk`; (3) `probe()` catches ALL exceptions and returns `true` (line 124-127) — if the HTTP request fails (e.g. DNS, timeout, connection refused), `probe()` returns `true` (claims "online"). Additionally `updateState` always sets `online = next.connectivityActive` (line 139) — `probeOk` is captured but never used to determine `online`.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/OnlineDetector.kt`
- **Lines:** 35-42 (initial state), 118-130 (probe), 132 (isOnline), 136-141 (updateState)
- **Category:** WEAK
- **Severity:** High
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** N/A — this is an Android-only component
- **Whether this duplicate is actually used:** Yes — `SyncService.drainPending`, `SyncWorker.doWork`, `SyncSupport.tryThenEnqueue` and `cacheThenNetwork` all call `onlineDetector.isOnline()` to decide whether to attempt network calls
- **What depends on it:** Every sync decision — if `isOnline()` returns true (always), SyncWorker fires every 15 minutes even when the device is offline, drainPending attempts Supabase RPCs that all fail (with 5-retry exponential backoff), pullAll fires 11 RPC calls that all fail
- **Other platforms/layers affected:** N/A — Android only
- **Behavioral differences:** The device can be offline (no internet, captive portal, DNS failing) but `OnlineDetector` reports "online". SyncWorker then fires, drains the queue (every entry fails after 5 retries over ~30 seconds), and the queue fills with `failed` entries. Battery drain + queue pollution.
- **Confidence:** Confirmed
- **Git evidence:** `OnlineDetector.kt` last touched in `cfac666` "suace" (2026-08-17)
- **Likely root cause:** The initial state was set optimistically to "online=true" so the first sync attempt wouldn't be blocked. The probe was designed to confirm online state, but the catch-all-returns-true behavior was a "fail-open" choice that defeats the probe's purpose. The `updateState` function forgot to incorporate `probeOk` into the `online` computation.
- **Potential impact:** (1) SyncWorker fires every 15 minutes even when the device is in airplane mode → wasted battery + WorkManager retries. (2) Queue fills with `failed` entries (5 retries each) → queue bloat. (3) `cacheThenNetwork` always tries the network path even when offline → long timeouts (4s default per `NetworkTimeouts.DEFAULT_TIMEOUT_MS`) before falling back to cache.
- **Code snippet:**
```kotlin
// OnlineDetector.kt:35-42 — initial state defaults to online
private val _state = MutableStateFlow(
    OnlineState(
        connectivityActive = true,
        probeOk = true,
        online = true,   // ❌ optimistic default
        changedAt = System.currentTimeMillis(),
    ),
)

// OnlineDetector.kt:118-130 — probe catches all and returns true
suspend fun probe(): Boolean = withContext(Dispatchers.IO) {
    val ok = try {
        val request = Request.Builder().url(probeUrl).get().build()
        httpClient.newCall(request).execute().use { response ->
            response.code in 200..499   // even 4xx counts as "online"
        }
    } catch (e: Exception) {
        Log.w("OnlineDetector", "Supabase probe failed: ${e.message}")
        true   // ❌ returns TRUE on exception — fail-open
    }
    updateState { it.copy(probeOk = ok) }
    ok
}

// OnlineDetector.kt:132 — isOnline ignores probeOk
fun isOnline(): Boolean = _state.value.connectivityActive   // ❌ ignores probeOk

// OnlineDetector.kt:139 — updateState ignores probeOk when computing online
val combined = next.copy(online = next.connectivityActive)   // ❌ ignores probeOk
```

### FINDING WEAK-010 — `pullAll()` is called from 6 different call sites on startup / navigation / sync — wasteful duplication; SyncWorker calls it TWICE per tick

- **What:** `PullSyncRepository.pullAll()` fires 11 separate RPC calls (parents, students, payments, ledger_entries, classes, subjects, installments, personnel, departments, notifications, workflow_runs), each with a 2000-row limit. The function is invoked from 6 different call sites: (1) `ElImtiyazApplication.triggerInitialSupabasePull` (app startup); (2) `AppNavViewModel.init` line 27 (also app startup — same time as #1); (3) `AppNavViewModel.init` line 34 (session collector — fires on every session change); (4) `SyncService.drainPending` line 130 (at end of every drain); (5) `SyncService.syncNow` line 147 (when user taps "sync now"); (6) `SyncWorker.doWork` line 54 (every 15 minutes — but `drainPending` at line 48 ALREADY calls `pullAll` at line 130, so the SyncWorker fires pullAll TWICE per tick). Plus (7) `StudentRosterScreen` line 103 (pull-to-refresh).
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/ElImtiyazApplication.kt:104` + `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/ui/navigation/AppNavViewModel.kt:27,34` + `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncService.kt:130,147` + `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/SyncWorker.kt:48,54` + `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/ui/features/crm/StudentRosterScreen.kt:103`
- **Lines:** All cited above
- **Category:** WEAK
- **Severity:** Medium
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** Desktop uses TanStack Query's `cache-then-network` per-query (each entity type is its own query, with its own cache + invalidation). Android has a monolithic `pullAll` that re-fetches everything.
- **Whether this duplicate is actually used:** Yes — every call site is active in production.
- **What depends on it:** App startup, session restoration, every 15-min sync tick, pull-to-refresh
- **Other platforms/layers affected:** N/A — Android only
- **Behavioral differences:** On app cold-start, `pullAll` fires at least twice (Application + AppNavViewModel.init). Every 15-min SyncWorker tick fires it twice (drainPending + doWork). Every session change fires it once (AppNavViewModel.init collector). For a typical user signing in once and using the app for 1 hour, pullAll fires ~6 times (2 startup + 4 SyncWorker ticks × 2) → 66 RPC calls. With 2000-row limits per table, that's a lot of redundant network traffic.
- **Confidence:** Confirmed
- **Git evidence:** All cited files touched in recent commits; the duplicate calls in SyncWorker (line 48 drainPending + line 54 pullAll) were introduced when the "pull-side fix" was added — the comment at SyncService.kt:17-19 says "the worker is a thin wrapper around drainPending + pullAll" but drainPending ALREADY calls pullAll internally.
- **Likely root cause:** Each layer of the sync stack (Application, ViewModel, SyncService, SyncWorker) was written independently and each adds its own pullAll call as a "safety net" without realizing the other layers also call it. The SyncWorker's "ALSO pull after drain" was added when drainPending didn't yet call pullAll; when drainPending was later upgraded to also pull, the SyncWorker's direct call became redundant.
- **Potential impact:** (1) Excessive network traffic — 6+ full pulls per hour per device. (2) Excessive Supabase RPC load — for 100 active Android users, 660+ RPC calls per hour. (3) Battery drain — each pullAll wakes the device, fires 11 HTTP requests, parses JSON, writes to Room. (4) Stale-cache race — if pullAll #1 is mid-flight when pullAll #2 starts, they can write conflicting data to Room (last-write-wins per `upsert`).
- **Code snippet:**
```kotlin
// SyncWorker.doWork:47-55 — calls drainPending (which calls pullAll) AND THEN calls pullAll again
override suspend fun doWork(): Result {
    if (!onlineDetector.isOnline()) return Result.success()
    if (sessionManager.current() == null) return Result.success()
    runCatching { syncService.drainPending() }    // ← drainPending internally calls pullAll at line 130
    runCatching { pullSyncRepository.pullAll(sinceIso = null) }   // ← calls pullAll AGAIN
    return Result.success()
}

// SyncService.drainPending:130 — internally calls pullAll
runCatching { pullSyncRepository.pullAll() }
```

### FINDING ARCH-003 — `RepositoryModule` binds ALL repositories to `Local*Repository` (Room-first) — canonical Supabase RPCs (`collect_payment`, `refund-payment`, `bind-activation-code`, `run-overdue-scan`, `refresh-materialized-views`, `update-server-secret`) are NEVER called from Android

- **What:** `RepositoryModule.kt` has 25 `@Binds` declarations, every one binding a domain repository interface to a `Local*Repository` implementation (e.g. `bindPaymentRepository(impl: LocalPaymentRepository): PaymentRepository`). There is NO `Supabase*Repository` implementation on Android — the desktop's `SupabasePaymentRepository`, `SupabaseParentRepository`, etc. have NO Android counterparts. The Supabase SDK is wired only for: (1) Auth (`LocalAuthRepository` calls Supabase Auth when configured); (2) FCM token registration (`FcmTokenRegistrar.register` calls `register_fcm_token` RPC); (3) Pull sync (`PullSyncRepository` calls `pull_*_for_sync` RPCs); (4) Sync push dispatcher (`SyncQueueDispatcher.pushXxx` calls `upsert_*_from_import` RPCs); (5) Workflow retry (`LocalWorkflowRepository.retryRun` calls `workflow-execute` Edge Function).
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/di/RepositoryModule.kt:71-99`
- **Lines:** All 25 `@Binds` declarations
- **Category:** ARCH
- **Severity:** High
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** Desktop's `repository-mode.ts` switches between `Mock*Repository` and `Supabase*Repository` based on config (per desktop ARCH-001/DRIFT-003 findings). Android has only `Local*Repository` — no mode switching, no Supabase implementation.
- **Whether this duplicate is actually used:** Yes — this is the production DI binding.
- **What depends on it:** Every ViewModel that injects a repository; every screen.
- **Other platforms/layers affected:** The canonical Edge Functions (`collect-payment`, `refund-payment`, `bind-activation-code`, `run-overdue-scan`, `refresh-materialized-views`, `update-server-secret`, `approve-signup-request`, `expire-pending-approvals`, `purge-expired-backups`, `ai-proxy`) are NEVER called from Android. The Android bypasses them entirely.
- **Behavioral differences:** Desktop: `collect_payment` Edge Function (atomic, server-side validation, server-side receipt). Android: `upsert_payment_from_import` (non-atomic, no server-side validation, local receipt). Different invariants enforced.
- **Confidence:** Confirmed
- **Git evidence:** `RepositoryModule.kt` last touched in `dd4c7dc` "kk" (2026-08-26)
- **Likely root cause:** Android was designed offline-first from day one. Rather than implement a Supabase-backed repository alongside the Local one and switch at runtime (like the desktop), the Android team wrote only the Local repository and used the sync queue to propagate writes. The canonical RPCs' invariants are bypassed.
- **Potential impact:** (1) Server-side invariants enforced by canonical Edge Functions (e.g. `collect-payment` validates proof requirements, `refund-payment` blocks refunds of cancelled payments) are bypassed on Android. (2) Audit trail diverges — the canonical Edge Functions write audit entries server-side; Android's local writes write audit entries to Room that may or may not propagate to the server. (3) The Android's local receipt generation (BUSINESS-006) and local waterfall allocation (CROSS-005) can diverge from the canonical server-side computation.
- **Code snippet:**
```kotlin
// RepositoryModule.kt:73-99 — all 25 bindings are Local*
@Binds @Singleton abstract fun bindAuthRepository(impl: LocalAuthRepository): AuthRepository
@Binds @Singleton abstract fun bindPaymentRepository(impl: LocalPaymentRepository): PaymentRepository
// ... 23 more, all Local* — NO Supabase* implementations exist on Android
```

### FINDING ARCH-004 — `fallbackToDestructiveMigration(true)` on production Room database — user data silently wiped on any future schema bump

- **What:** `DatabaseModule.provideDatabase` calls `.fallbackToDestructiveMigration(true)` on the Room database builder. The comment admits: "Production deployments should add explicit migrations for every schema bump." But the build is `versionCode = 2`, `versionName = "2.0.0"` — this IS shipping to production (release build type with a real signing config). The database is at version 11 with 8 explicit migrations (3→4 through 10→11) — but any FUTURE schema bump that doesn't have an explicit migration will WIPE ALL local data (parents, students, payments, ledger_entries, installments, audit_logs, sync_queue — everything).
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/di/DatabaseModule.kt:90-95`
- **Lines:** 90-95
- **Category:** ARCH
- **Severity:** High
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** N/A — Android only
- **Whether this duplicate is actually used:** Yes — this is the production DI binding.
- **What depends on it:** Every local write — all Room tables; the entire offline-first data layer
- **Other platforms/layers affected:** N/A
- **Behavioral differences:** If a developer adds a column to an entity, forgets to add a `MIGRATION_11_12`, and ships — every Android user's local data is wiped on app update. They lose all pending sync queue entries → offline writes that never pushed to Supabase are LOST forever.
- **Confidence:** Confirmed
- **Git evidence:** `DatabaseModule.kt` last touched in `dd4c7dc` "kk" (2026-08-26); `app/build.gradle.kts:28-29` shows `versionCode = 2, versionName = "2.0.0"` with a `release` build type and signing config
- **Likely root cause:** During development, `fallbackToDestructiveMigration` is convenient — schema changes don't require writing migrations. The developer left it on for the release build "in case a migration is missing" — accepting data loss as a fallback. The 8 explicit migrations cover v3→v11 (the versions where the schema was iterated during development), but any future v11→v12+ without an explicit migration triggers destruction.
- **Potential impact:** (1) A future schema bump that forgets to add a migration wipes all local data — parents, students, payments, ledger entries, sync queue. (2) Pending sync queue entries that haven't yet pushed to Supabase (e.g. payments collected offline) are lost — the user's payment was collected, receipt printed, but never propagated to the server. (3) The "fix-up migration" pattern (per REG-002 below) makes this more likely — developers iterating on the schema may forget a migration.
- **Code snippet:**
```kotlin
// DatabaseModule.kt:90-95 — destructive fallback on production
.fallbackToDestructiveMigration(true)   // ❌ ships in release APK
.build()

// app/build.gradle.kts:54-67 — release build type with real signing
buildTypes {
    release {
      isMinifyEnabled = false
      signingConfig = signingConfigs.getByName("release")  // real keystore
    }
}
```

### FINDING DRIFT-007 — `SupabaseModule.kt` comment is outdated — claims "future remote sync can push local Room writes to Supabase by swapping @Binds" but SyncSupport already does the push

- **What:** The class-level KDoc on `SupabaseModule.kt` says: "Future remote sync can push local Room writes to Supabase by swapping the `@Binds` declarations in `RepositoryModule.kt`." But the sync push is ALREADY wired: `LocalPaymentRepository`, `LocalStudentRepository`, `LocalInstallmentRepository`, `LocalLedgerRepository`, `LocalGradeRepository`, `LocalAttendanceRepository`, `LocalHomeworkRepository` all inject `SyncSupport` and call `enqueueOnly(...)` to push to Supabase via `SyncQueueDispatcher`. No `@Binds` swap is needed.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/di/SupabaseModule.kt:13-33`
- **Lines:** 13-33 (KDoc)
- **Category:** DRIFT
- **Severity:** Low
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** N/A
- **Whether this duplicate is actually used:** The COMMENT is dead documentation; the actual sync push works.
- **What depends on it:** Future developers reading the comment to understand the architecture
- **Other platforms/layers affected:** N/A
- **Behavioral differences:** N/A — comment drift
- **Confidence:** Confirmed
- **Git evidence:** `SupabaseModule.kt` last touched in `176f5d2` "mid" (2026-08-21) — likely hasn't been updated since the SyncSupport wiring was added in TIER 4
- **Likely root cause:** The KDoc was written when sync wasn't yet wired (the original "Future remote sync" plan was to swap @Binds to a Supabase*Repository). When SyncSupport was added later (per the canonical §8.1 pattern in the inline comments at LocalRepositories.kt:470, 916-919, 1221-1223, 1383-1385), the SupabaseModule's KDoc was never updated.
- **Potential impact:** Future maintainers may attempt the "swap @Binds" approach described in the comment, not realizing SyncSupport already does the push. They'd waste time building Supabase*Repository classes that duplicate the existing sync queue's push path. Or they might remove the SyncSupport wiring thinking it's redundant.
- **Code snippet:**
```kotlin
// SupabaseModule.kt:13-33 — outdated KDoc
/**
 * Supabase DI module — provides the singleton client + auth/storage/postgrest/realtime accessors.
 *
 * The mobile app is **offline-first**: Room is the source of truth and all
 * repositories read/write locally. However, the Supabase client is still
 * provided so that:
 *   1. **FCM token registration** can call the `register_fcm_token` RPC when Supabase is configured.
 *   2. **Future remote sync** can push local Room writes to Supabase by swapping the @Binds declarations in `RepositoryModule.kt`.  // ❌ outdated — SyncSupport already does this
 *   3. **Auth** can fall back to real Supabase Auth when credentials are present in `.env`.
 */
```

### FINDING DRIFT-008 — Contradictory architectural intent between `Entities.kt` and `LocalEntities.kt` — both in the same Room database

- **What:** The two entity files express contradictory architectural intent: `Entities.kt:8-15` says "Room cache entities — mirror the Supabase schema for offline reads. Room is NOT the primary store; it's a read cache + sync queue. Supabase is the source of truth." `LocalEntities.kt:7-19` says "Local source-of-truth entities — Room is the PRIMARY store for this build. The mobile app is designed to work offline-first." Both entity sets live in the SAME Room database (`ElImtiyazDatabase` at version 11) and both are exposed via Hilt.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/room/Entities.kt:8-15` + `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/room/LocalEntities.kt:7-19`
- **Lines:** Entities.kt:8-15; LocalEntities.kt:7-19
- **Category:** DRIFT
- **Severity:** Medium
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** Unclear — the two files express two different architectural intentions, neither is canonical
- **Whether this duplicate is actually used:** Both entity sets are in the production database; both have DAOs exposed via Hilt. Both are used by SyncService/SyncSupport (cache layer) and Local*Repository (source-of-truth layer).
- **What depends on it:** Every repository, SyncService, SyncSupport
- **Other platforms/layers affected:** Mirrors the desktop's ARCH-001 partial-migration pattern (mock vs Supabase repositories both exist)
- **Behavioral differences:** The cache layer's entities carry `syncedAt` (last fetch timestamp); the source-of-truth layer's don't. The cache layer's ParentCacheEntity doesn't carry `activationCode` or `nationalId` or `relationship` (which the source-of-truth ParentEntity has). Pulls write to the source-of-truth layer (`PullSyncRepository` calls `db.parentDao().upsert(dto.toEntity())` where `parentDao` is the source-of-truth DAO). But SyncSupport's `upsertParents(rows: List<ParentCacheEntity>)` writes to the cache layer — which is never read by the Local*Repository classes. The two layers can drift.
- **Confidence:** Confirmed
- **Git evidence:** Both files have been actively maintained in parallel — `Entities.kt` last touched in `c519643` "coool" (2026-08-23); `LocalEntities.kt` last touched in `dd4c7dc` "kk" (2026-08-26)
- **Likely root cause:** The Android was originally built with cache semantics (matching desktop's "Supabase is canonical"). Later, an offline-first rearchitecture introduced source-of-truth entities (`Local*` prefix). The legacy cache layer was kept "for sync compatibility" but never deleted. The KDocs were never reconciled — each file documents its layer's intent, but the two intents are incompatible.
- **Potential impact:** (1) A developer reading `Entities.kt` KDoc assumes Supabase is canonical and writes code that defers to the server — but the production code path uses `LocalEntities.kt`'s source-of-truth layer. (2) The cache layer's DAOs (`ParentCacheDao`, etc.) are exposed via Hilt and could be accidentally injected into a new repository, bypassing the source-of-truth layer. (3) Bug investigations are confusing — the same logical entity has two different representations with different fields, and it's not obvious which one a given code path uses.
- **Code snippet:**
```kotlin
// Entities.kt:8-15 — LEGACY cache layer (Supabase canonical)
/**
 * Room cache entities — mirror the Supabase schema for offline reads.
 * Room is NOT the primary store; it's a read cache + sync queue.
 * Supabase is the source of truth.
 */

// LocalEntities.kt:7-19 — NEW source-of-truth (Room canonical)
/**
 * Local source-of-truth entities — Room is the PRIMARY store for this build.
 * The mobile app is designed to work offline-first.
 * Mirrors the desktop's Supabase schema field-by-field.
 */
```

### FINDING BUSINESS-006 — Receipt numbers generated locally as `REC-$year-$seq` (seq = `paymentDao.listAll().size + 1`) — collision-prone, race-condition-prone, per-device

- **What:** `LocalPaymentRepository.collect` (line 949) generates the receipt number as `"REC-$year-$seq"` where `seq = (paymentDao.listAll().size + 1).toString().padStart(6, '0')`. Three problems: (1) Collision-prone — if a payment is deleted, countActive decreases, next call reuses a previously-issued receipt number; the canonical `payments.receipt_number` has a UNIQUE constraint server-side. (2) Race-condition-prone — two concurrent `collect` calls both read the same count, both generate the same seq, one fails with UNIQUE constraint violation. (3) Per-device — every Android device generates `"REC-2026-000001"` for the first payment of the year; on sync push, `upsert_payment_from_import` matches by `(tenant_id, payment_number)` and OVERWRITES the other device's payment (data loss). The desktop's canonical `collect-payment` Edge Function generates the receipt SERVER-SIDE in a single atomic transaction — guaranteed unique across devices.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:949-950` (collect) + `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:1260-1262` (markPaid backing payment) — same pattern duplicated
- **Lines:** 949-950 (collect); 1260-1262 (markPaid); the same `paymentDao.listAll().size + 1` pattern is also at line 949
- **Category:** BUSINESS
- **Severity:** Critical
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** Desktop's `collect-payment` Edge Function generates receipt server-side via `generate_payment_number` SQL function (atomic, monotonic, server-wide)
- **Whether this duplicate is actually used:** Yes — every payment collected on Android uses this receipt generation.
- **What depends on it:** `LocalPaymentRepository.collect`, `LocalInstallmentRepository.markPaid` (which creates a backing payment via the same pattern)
- **Other platforms/layers affected:** Desktop uses server-side receipt generation. Android's local generation can collide with desktop's server-side generated numbers when both write to the same Supabase project.
- **Behavioral differences:** (1) Same receipt number can be issued twice locally (after delete). (2) Same receipt number issued across devices → server-side overwrite. (3) Receipt numbers are not monotonic across devices — device A's first payment is "REC-2026-000001", device B's first payment is also "REC-2026-000001", even though they're different payments at different times.
- **Confidence:** Confirmed
- **Git evidence:** `LocalRepositories.kt:949-950` last touched in `94471e8` (2026-08-28) "fix(core): pending-waterfall capacity subtracts existing uncleared funds" — most recent commit; the receipt generation wasn't fixed
- **Likely root cause:** Android was designed offline-first; receipt generation needed to work without a server round-trip. The `countActive + 1` approach was the simplest local-only solution. The developer didn't account for the cross-device collision problem (the server-side upsert dedupes by `payment_number` which makes collisions data-loss events, not constraint violations).
- **Potential impact:** (1) Two Android devices collecting payments in the same year generate the same receipt numbers → server-side upsert overwrites one device's payment (data loss). (2) If a payment is deleted locally, the next payment reuses the deleted payment's receipt number → an old printed receipt with that number now points to a different payment. (3) Bank reconciliation breaks — the receipt number on the printed PDF doesn't match the server-side payment row (because the server-side row was overwritten by a later device's payment with the same number).
- **Code snippet:**
```kotlin
// LocalPaymentRepository.collect:947-952 — LOCAL receipt generation
val now = Instant.now().toString()
val year = java.time.LocalDate.now().year
val seq = (paymentDao.listAll().size + 1).toString().padStart(6, '0')  // ❌ collision-prone
val receipt = "REC-$year-$seq"
val paymentId = "pay-${UUID.randomUUID()}"   // payment ID is UUID (good), but receipt is sequential

// SyncQueueDispatcher.pushPayment:209 — receipt goes to server as p_payment_number
put("p_payment_number", p.str("receiptNumber") ?: p.str("payment_number") ?: generatePaymentNumber())
// → upsert_payment_from_import matches on (tenant_id, payment_number) → COLLISION across devices
```

### FINDING SEC-003 — Committed `google-services.json` contains a real Firebase API key + project number

- **What:** The committed `app/google-services.json` contains a real Firebase API key (`AIzaSyAzDjnuF7QMh3jWZAoJYiIxohfAD7Ba3_8`) and project number (`259221439109`) and project ID (`elimtiyaz-android`) and storage bucket (`elimtiyaz-android.firebasestorage.app`) and mobilesdk_app_id (`1:259221439109:android:601b499c8bf53e24fa1fec`). While Firebase Android API keys are technically "public" (they ship in the APK), they're not typically committed to version control — anyone with the file can send push notifications to the project's devices (if they have the FCM server key, which they don't from this file alone).
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/google-services.json`
- **Lines:** 1-29 (entire file)
- **Category:** SEC
- **Severity:** Low
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** N/A
- **Whether this duplicate is actually used:** Yes — the `google-services` Gradle plugin reads this file at build time to generate `google-services.json` resources.
- **What depends on it:** Firebase Messaging (FCM), Firebase AppCheck reCAPTCHA — both declared as dependencies in `app/build.gradle.kts:179-180`
- **Other platforms/layers affected:** N/A — Android only
- **Behavioral differences:** N/A
- **Confidence:** Confirmed
- **Git evidence:** File committed in `9c19424` "mid" (2026-08-14); never modified since
- **Likely root cause:** The `google-services.json` is required by the Google Services Gradle plugin at build time. The developer committed it to make `./gradlew assembleDebug` work out of the box without requiring each developer to download their own `google-services.json` from the Firebase console. This is a common but discouraged practice.
- **Potential impact:** (1) Anyone with repo access can read the Firebase project ID and API key — they can attempt to register FCM tokens for the project (which would fail without the server key, but the project's FCM topic namespace is exposed). (2) If the project is later deleted/rotated, this file becomes stale but isn't updated automatically. (3) The repo's commit history permanently exposes the key — even if removed in a future commit, it's in the git history.
- **Code snippet:**
```json
// app/google-services.json (committed)
{
  "project_info": {
    "project_number": "259221439109",     // ❌ real Firebase project number
    "project_id": "elimtiyaz-android",
    "storage_bucket": "elimtiyaz-android.firebasestorage.app"
  },
  "client": [{
    "client_info": {
      "mobilesdk_app_id": "1:259221439109:android:601b499c8bf53e24fa1fec"
    },
    "api_key": [{ "current_key": "AIzaSyAzDjnuF7QMh3jWZAoJYiIxohfAD7Ba3_8" }]   // ❌ real API key
  }]
}
```

### FINDING SEC-004 — `SupabaseConfigDialog` displays the Supabase anon key in plain text + references "Google AI Studio" secrets panel in user-facing text

- **What:** The `SupabaseConfigDialog` composable accepts `currentKey: String` and renders it in an `OutlinedTextField` with NO `visualTransformation` (no Password visual) — the anon key is shown in plain text on the screen. Anyone shoulder-surfing or screen-recording can read it. Additionally, the dialog's helper text says "💡 Vous pouvez aussi configurer SUPABASE_URL et SUPABASE_ANON_KEY directement dans le panneau Secrets de Google AI Studio." — this leaks the build/deploy toolchain (Google AI Studio) to end users.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/ui/features/settings/SupabaseConfigDialog.kt:36-105`
- **Lines:** 36-44 (signature + state), 74-82 (anonKey OutlinedTextField — no visualTransformation), 84-88 (helper text mentioning Google AI Studio)
- **Category:** SEC
- **Severity:** Medium
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** N/A
- **Whether this duplicate is actually used:** Yes — this dialog is shown in Settings → Synchronisation.
- **What depends on it:** `SettingsScreen` / `SyncSection` call site that opens the dialog
- **Other platforms/layers affected:** N/A
- **Behavioral differences:** N/A
- **Confidence:** Confirmed
- **Git evidence:** `SupabaseConfigDialog.kt` last touched in `176f5d2` "mid" (2026-08-21)
- **Likely root cause:** The dialog was built for technical staff who need to enter the Supabase URL + anon key. The anon key is technically "public" (it's the publishable key, used in client-side Supabase calls) but it shouldn't be displayed in plain text — it should use `visualTransformation = PasswordVisualTransformation()` with a show/hide toggle.
- **Potential impact:** (1) Shoulder-surfing / screen-recording captures the anon key. (2) End users learn that the app was built with Google AI Studio — minor information leak about the development toolchain. (3) If a user enters a real production anon key, it's stored in SharedPreferences (encrypted via EncryptedSharedPreferences for the auth store, but the SupabaseConfig prefs at SupabaseClientProvider.kt:37 use `getSharedPreferences("supabase_config", Context.MODE_PRIVATE)` — NOT encrypted).
- **Code snippet:**
```kotlin
// SupabaseConfigDialog.kt:74-82 — anon key shown in plain text
OutlinedTextField(
    value = anonKey,                               // ❌ plain text
    onValueChange = { anonKey = it },
    label = { Text("Supabase Anon Key / API Key") },
    placeholder = { Text("eyJhbGciOiJIUzI1NiIsInR5c...") },
    singleLine = false,
    maxLines = 3,
    // ❌ no visualTransformation = PasswordVisualTransformation()
    modifier = Modifier.fillMaxWidth(),
)

// SupabaseConfigDialog.kt:84-88 — leaks Google AI Studio
Text(
    text = "💡 Vous pouvez aussi configurer SUPABASE_URL et SUPABASE_ANON_KEY directement dans le panneau Secrets de Google AI Studio.",
)
```

### FINDING SEC-005 — `SupabaseClientProvider.build()` falls back to `https://demo.supabase.co` with key `"demo-key"` when unconfigured — real network requests go out to that public endpoint

- **What:** When the Supabase URL/key are blank or placeholder, `SupabaseClientProvider.build()` falls back to `supabaseUrl = "https://demo.supabase.co"` and `supabaseKey = "demo-key"` (line 137-142) and constructs a real SupabaseClient against that endpoint. So when the app is "unconfigured", every Supabase SDK call (auth, postgrest, realtime, storage, functions) actually hits `demo.supabase.co` — a public Supabase demo project. The fallbacks to `demo.supabase.co` and `demo-key` are also in the exception handler at line 159-168.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/supabase/SupabaseClientProvider.kt:131-169`
- **Lines:** 131-169 (build function, including the catch fallback at 159-168)
- **Category:** SEC
- **Severity:** Medium
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** N/A
- **Whether this duplicate is actually used:** Yes — when a fresh checkout doesn't have a `.env` file (the default state), this fallback fires and the app talks to `demo.supabase.co`.
- **What depends on it:** Every Supabase SDK call when the app is unconfigured
- **Other platforms/layers affected:** N/A — Android only
- **Behavioral differences:** N/A
- **Confidence:** Confirmed
- **Git evidence:** `SupabaseClientProvider.kt` last touched in `dd4c7dc` "kk" (2026-08-26); the SECURITY FIX comment at line 69-72 says "no hardcoded production fallback" but then line 137-142 hardcodes `demo.supabase.co` — a partial security fix that closed the production-leak hole but left the demo-leak hole open.
- **Likely root cause:** The Supabase Kotlin SDK requires a non-empty URL and key to construct a client. The developer chose `demo.supabase.co` as a "neutral public endpoint" rather than throwing or returning null. The intent was to make the client constructible in any state, but it leaks metadata (the app pings demo.supabase.co on every cold start).
- **Potential impact:** (1) When the app is unconfigured, real network requests go to `demo.supabase.co` — anyone monitoring the device's network traffic (e.g. proxy) sees the app pinging Supabase's demo project. (2) If the demo project's RLS is misconfigured, the app's auth attempts could accidentally create accounts on the demo project. (3) The fallback in the catch block (line 159-168) means even if the user configures a real URL, if `createSupabaseClient` throws (e.g. invalid URL format), the app silently falls back to `demo.supabase.co`.
- **Code snippet:**
```kotlin
// SupabaseClientProvider.kt:131-169 — falls back to demo.supabase.co
if (rawUrl.isBlank() || rawKey.isBlank()) {
    Log.e(TAG, "Construction du client Supabase avec une configuration VIDE — ...")
}
val validUrl = if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
    rawUrl
} else {
    "https://demo.supabase.co"   // ❌ real network requests go here
}
val validKey = if (rawKey.isNotBlank()) rawKey else "demo-key"   // ❌ real auth attempts use this
return try {
    createSupabaseClient(supabaseUrl = validUrl, supabaseKey = validKey, ...) { ... }
} catch (e: Exception) {
    createSupabaseClient(supabaseUrl = "https://demo.supabase.co", supabaseKey = "demo-key", ...) { ... }  // ❌ catch also falls back
}
```

### FINDING SEC-006 — `OnlineDetector` probes `https://supabase.com/auth/v1/health` every 30 seconds when unconfigured — metadata leak + battery drain

- **What:** `OnlineDetector` runs a 30-second periodic HTTP probe (line 98-103). The probe URL is derived from `BuildConfig.SUPABASE_URL` when configured, or falls back to `https://supabase.com/auth/v1/health` when unconfigured (line 56-67). So a fresh-checkout Android app pings `supabase.com` every 30 seconds forever — leaking the user's IP address and the fact that "this device runs an app that knows about Supabase" to Supabase Inc.'s servers. The probe also fires on every `onAvailable`/`onCapabilitiesChanged` ConnectivityManager callback (line 73, 83) — could be dozens per minute on a flaky network.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/OnlineDetector.kt:56-68, 87-105, 118-130`
- **Lines:** 56-68 (probeUrl), 87-105 (start — launches 30s periodic probe loop), 118-130 (probe function)
- **Category:** SEC
- **Severity:** Medium
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** N/A
- **Whether this duplicate is actually used:** Yes — `OnlineDetector.start()` is called from `ElImtiyazApplication.startOnlineDetector` on every app cold start.
- **What depends on it:** SyncWorker, drainPending, cacheThenNetwork — all use `onlineDetector.isOnline()`
- **Other platforms/layers affected:** N/A — Android only
- **Behavioral differences:** N/A
- **Confidence:** Confirmed
- **Git evidence:** `OnlineDetector.kt` last touched in `cfac666` "suace" (2026-08-17)
- **Likely root cause:** The probe was designed to confirm the device has REAL internet (not just a ConnectivityManager "active" state which can be a captive portal). The fallback to `supabase.com` was chosen as a "neutral public endpoint" but leaks the device's IP to Supabase Inc. every 30 seconds.
- **Potential impact:** (1) Privacy leak — Supabase Inc. sees the device's IP every 30 seconds even when the user has never configured Supabase. (2) Battery drain — a 30-second periodic HTTP request from a foreground app on a mobile device is excessive; on a phone with limited battery, this can be 5-10% per hour. (3) Captive portals trigger `onCapabilitiesChanged` repeatedly — each triggers a probe → dozens of probes per minute on flaky wifi.
- **Code snippet:**
```kotlin
// OnlineDetector.kt:56-68 — probeUrl falls back to supabase.com
private val probeUrl: String by lazy {
    val raw = BuildConfig.SUPABASE_URL.trim().removeSurrounding("\"")
    val isReal = raw.startsWith("http://") || raw.startsWith("https://")
    val base = if (isReal && !raw.contains("your-project", ...) && !raw.contains("placeholder", ...)) {
        raw
    } else {
        "https://supabase.com"   // ❌ leaks device IP to Supabase Inc. every 30s
    }
    base.removeSuffix("/") + "/auth/v1/health"
}

// OnlineDetector.kt:98-103 — 30s periodic probe loop
probeJob = scope.launch {
    while (isActive) {
        delay(30_000L)
        probe()   // HTTP request every 30 seconds forever
    }
}
```

### FINDING REG-002 — 8 Room migrations are fix-up migrations for previous regressions — same iterative bug-fix pattern as desktop's REG-001

- **What:** The Room database is at version 11 with 8 explicit migrations (v3→v4 through v10→v11). Each migration's KDoc documents a regression that the previous version had:
  - `MIGRATION_3_4` — adds `metadataJson` column to `ledger_entries` (metadata was silently dropped before)
  - `MIGRATION_4_5` — adds `paymentPlan` column to `students` (the 10% early-annual discount couldn't be evaluated without it)
  - `MIGRATION_5_6` — adds `finalSpentAmount` column to `expenses` (`settleProof()` accepted the parameter but silently dropped it because the column didn't exist)
  - `MIGRATION_6_7` — changes `subjects.coefficient` and `assessments.coefficient` from INTEGER to REAL (Int truncated decimal coefficients); adds `isExtracurricular` to assessments (canonical GPA exclusion rule); makes `classes.capacity` nullable; adds `parents.cityTier`; adds `payments.expectedAmount`/`excessAmount`/`excessRemark` (partial/overpayment tracking); adds `ledger_cache.metadataJson`
  - `MIGRATION_7_8` — adds `subjects.level` (was hardcoded "all" so every chip filter showed empty list); adds `subjects.passingGrade` (was hardcoded 10)
  - `MIGRATION_8_9` — adds `vehicles`, `routing_stops`, `class_subjects` tables (the routing feature was previously a stub returning empty lists); adds `trip_logs.vehicleId` + `trip_logs.stopsCompleted`
  - `MIGRATION_9_10` — adds `parents.nationalId` + `parents.relationship` (vault §04.03 batch registration fields); adds `homework.academicYear` + `homework.pushedAt`
  - `MIGRATION_10_11` — adds `subjects.coefficientDevoir1`/`Devoir2`/`Examen` + same on `assessments` (per-component coefficient snapshot — "the old approach the user asked for" — formula was changed)
  - Plus the `fallbackToDestructiveMigration(true)` ARCH-004 finding
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/room/ElImtiyazDatabase.kt:102-391`
- **Lines:** 102-391 (all 8 migrations)
- **Category:** REG
- **Severity:** High
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** Mirrors desktop's REG-001 finding (9 "canonical engine unification" fix-up migrations after the "unification" was supposedly complete)
- **Whether this duplicate is actually used:** Yes — all 8 migrations are registered in `DatabaseModule.provideDatabase.addMigrations(...)` at line 72-89
- **What depends on it:** Every database upgrade from v3 to v11
- **Other platforms/layers affected:** Mirrors desktop's pattern — both repos ship with iterative fix-up migrations documenting bugs the previous "canonical" version missed
- **Behavioral differences:** N/A — each migration fixes a specific regression
- **Confidence:** Confirmed
- **Git evidence:** Each migration was added in a different commit; the migrations file was last touched in `94471e8` (2026-08-28)
- **Likely root cause:** Each migration was added when a bug was discovered in production: metadata was dropped, paymentPlan was missing, settleProof() didn't persist, INTEGER coefficient truncated decimals, level hardcoded "all" broke filters, routing was stub, batch registration needed master info fields, subject-average formula changed. Each fix was a "we forgot this column" or "we had the wrong type" patch — the original schema was never designed correctly.
- **Potential impact:** (1) The pattern signals that the schema is unstable — each future iteration likely needs another fix-up migration. (2) Combined with `fallbackToDestructiveMigration(true)` (ARCH-004), a forgotten migration wipes user data. (3) The migrations don't always backfill existing data correctly (e.g. `MIGRATION_7_8` adds `level TEXT NOT NULL DEFAULT 'all'` — every existing subject defaults to "all" which is the BUGGY value the migration was supposed to fix; the migration adds the column with the wrong default, then a future migration would need to fix the data again).
- **Code snippet:**
```kotlin
// ElImtiyazDatabase.kt:144-151 — MIGRATION_5_6 fix-up (finalSpentAmount was silently dropped)
/**
 * Adds the `finalSpentAmount` INTEGER column to `expenses` so the
 * local Room schema matches the Supabase schema. This column stores
 * the actual spent amount confirmed by the proof scan at settlement
 * time — previously `settleProof()` accepted the parameter but
 * silently dropped it because the column didn't exist on the entity.
 */
val MIGRATION_5_6 = object : androidx.room.migration.Migration(5, 6) {
    override fun migrate(database: SupportSQLiteDatabase) {
        database.execSQL("ALTER TABLE expenses ADD COLUMN finalSpentAmount INTEGER")
    }
}

// ElImtiyazDatabase.kt:228-245 — MIGRATION_7_8 fix-up (level hardcoded "all")
/**
 * 1. subjects.level — NEW TEXT, default 'all'. The SubjectsDirectory
 *    level filter chips (primaire/CEM/Lycée) previously filtered on
 *    a hardcoded `level = "all"` so every chip showed an EMPTY list.
 */
val MIGRATION_7_8 = object : androidx.room.migration.Migration(7, 8) {
    override fun migrate(database: SupportSQLiteDatabase) {
        database.execSQL("ALTER TABLE subjects ADD COLUMN level TEXT NOT NULL DEFAULT 'all'")  // ❌ default is the buggy value
    }
}
```

### FINDING DEAD-007 — `AuditActions.kt` contains many audit action constants that the Android app never invokes

- **What:** `AuditActions.kt` defines 60+ audit action string constants for "wire-protocol compatibility" with the desktop. Many are NEVER invoked from Android code:
  - `ACCOUNT_APPROVAL_APPROVE`, `ACCOUNT_APPROVAL_REJECT`, `ACCOUNT_APPROVAL_EXPIRE_BATCH` — Android doesn't call `approve-signup-request` or `expire-pending-approvals` Edge Functions
  - `ACTIVATION_CODE_BIND`, `ACTIVATION_CODE_GENERATE` — Android doesn't call `bind-activation-code` Edge Function (the desktop does, per desktop CROSS-004)
  - `BACKUP_CREATED`, `BACKUP_RESTORED`, `BACKUP_PURGE` — Android has no backup feature
  - `WORKFLOW_PUBLISHED`, `WORKFLOW_TRIGGERED`, `WORKFLOW_RUN`, `WORKFLOW_RETRY` — Android only calls `workflow-execute` Edge Function for retry (line 1842-1850 of LocalRepositories2.kt); doesn't publish or trigger workflows
  - `OVERDUE_SCAN_RUN` — Android doesn't call `run-overdue-scan` Edge Function
  - `MATERIALIZED_VIEWS_REFRESH` — Android doesn't call `refresh-materialized-views` Edge Function
  - `SERVER_SECRET_UPDATE` — Android doesn't call `update-server-secret` Edge Function
  - `AI_NARRATIVE_DRAFTED`, `AI_NARRATIVE_APPROVED`, `AI_NARRATIVE_REJECTED`, `AI_DRAFT_GENERATED`, `AI_DRAFT_SENT`, `AI_ANOMALY_FLAGGED`, `AI_ANOMALY_JUSTIFICATION_REQUESTED`, `AI_CONFIG_UPDATE`, `AI_CONFIG_TEST` — Android has no AI feature wired
  - `DEPARTMENT_ARCHIVE`, `DEPARTMENT_UNARCHIVE` — Android doesn't archive departments
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/core/AuditActions.kt:8-116`
- **Lines:** All 60+ constants; ~30+ are never invoked from Android production code
- **Category:** DEAD
- **Severity:** Low
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** Desktop's `audit-actions.ts` (per the file's KDoc "mirrors the desktop `src/core/audit-actions.ts`")
- **Whether this duplicate is actually used:** No — many constants are never referenced outside the AuditActions.kt file itself
- **What depends on it:** N/A — dead constants
- **Other platforms/layers affected:** The constants are wire-protocol (they appear in the `audit_logs.action` column server-side); defining them on Android is "for reference" but they're never written by Android code
- **Behavioral differences:** N/A
- **Confidence:** Confirmed
- **Git evidence:** `AuditActions.kt` last touched in `176f5d2` "mid" (2026-08-21)
- **Likely root cause:** The Android file was copied verbatim from the desktop's `audit-action.ts` to ensure the wire-protocol strings match. But the desktop's set includes actions for features Android doesn't have (backups, AI, workflow publishing, account approval, etc.). The constants were left in for "completeness" — but they mislead maintainers into thinking Android implements these features.
- **Potential impact:** (1) A maintainer reading AuditActions.kt thinks Android implements AI, backups, workflow publishing, etc. — they don't, the constants are just wire-protocol references. (2) Dead code bloats the APK by ~60 constants (~3KB). (3) The KDoc says "wire-protocol: these strings appear in the `audit_logs.action` column in Supabase. They must be preserved verbatim." — but if the desktop renames an action, Android's constant silently becomes stale.
- **Code snippet:**
```kotlin
// AuditActions.kt:83-111 — many constants never invoked from Android
const val BACKUP_CREATED               = "backup.created"        // ❌ no backup feature on Android
const val BACKUP_RESTORED              = "backup.restored"       // ❌
const val BACKUP_PURGE                 = "backup.purge"          // ❌
const val WORKFLOW_PUBLISHED           = "workflow.published"    // ❌ Android doesn't publish workflows
const val OVERDUE_SCAN_RUN             = "overdue_scan.run"      // ❌ Android doesn't run overdue scan
const val MATERIALIZED_VIEWS_REFRESH   = "materialized_views.refresh"  // ❌ Android doesn't refresh views
const val SERVER_SECRET_UPDATE         = "server_secret.update"  // ❌ Android doesn't update server secrets
const val AI_NARRATIVE_DRAFTED         = "ai.narrative_drafted"  // ❌ no AI feature
// ... 25+ more dead constants
```

### FINDING CROSS-008 — `AndroidEquivalenceTest` depends on the desktop's `financial-tests/equivalence/scenarios` directory which doesn't exist in the Android repo

- **What:** `AndroidEquivalenceTest.runCanonicalScenarios()` resolves the scenarios directory via `resolve("androidEquivalence.scenariosDir", "financial-tests/equivalence/scenarios")` (line 22-29). The `resolve` helper probes the CWD then the CWD's parent (line 38-50). But the Android repo does NOT have a `financial-tests/` directory — only the desktop repo has it (`/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/financial-tests/equivalence/scenarios/`). So the test fails with "Scenarios directory not found" when run from a fresh checkout of just the Android repo.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/test/java/com/example/equivalence/AndroidEquivalenceTest.kt:18-51`
- **Lines:** 18-51
- **Category:** CROSS
- **Severity:** Low
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** Desktop's `equivalence.ts` test runner at `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/financial-tests/equivalence/`
- **Whether this duplicate is actually used:** Yes — the test runs as part of `./gradlew :app:testDebugUnitTest`. It fails when the desktop repo isn't checked out at `../`.
- **What depends on it:** CI test runs
- **Other platforms/layers affected:** Mirrors desktop's DUP-001 finding (four parallel cross-platform equivalence test frameworks) — Android is the 4th framework
- **Behavioral differences:** The test only passes when the Android repo and desktop repo are checked out side-by-side (e.g. `repos/elimtiyaz-android` and `repos/AgentGithubUplaod`). On a fresh checkout of just the Android repo (the typical contributor workflow), the test fails.
- **Confidence:** Confirmed
- **Git evidence:** `AndroidEquivalenceTest.kt` last touched in `176f5d2` "mid" (2026-08-21); the FIX comment at line 13-16 says "the working directory of a Gradle test worker is the MODULE directory (`app/`), not the repo root — the previous single relative path made the test abort" — but the fix only added the `cwd.parentFile` probe, which still requires the desktop repo to be at `../`.
- **Likely root cause:** The test was written assuming the Android repo and desktop repo are checked out as siblings under the same parent directory (e.g. both under `/repos/`). When the Android repo is checked out alone (typical contributor workflow), the test fails.
- **Potential impact:** (1) Fresh-checkout CI runs of the Android repo fail the equivalence test. (2) Contributors who clone just the Android repo see a "test not passing" failure that has nothing to do with their changes. (3) The cross-platform equivalence framework's value is reduced — Android results aren't generated on most CI runs.
- **Code snippet:**
```kotlin
// AndroidEquivalenceTest.kt:21-36
@Test
fun runCanonicalScenarios() {
    val scenariosDir = resolve(
        "androidEquivalence.scenariosDir",
        "financial-tests/equivalence/scenarios",   // ❌ doesn't exist in Android repo
    )
    require(scenariosDir.isDirectory) {
        "Scenarios directory not found: ${scenariosDir.absolutePath} — " +
            "run from the Android repo root or pass " +
            "-DandroidEquivalence.scenariosDir=<path>"
    }
    AndroidEquivalenceRunner.runAll(scenariosDir, outputDir)
}

// Verify:
// /home/z/my-project/repos/elimtiyaz-android/financial-tests/ — does NOT exist
// /home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/financial-tests/equivalence/ — exists
```

### FINDING WEAK-011 — `audit()` helper hardcodes demo tenant ID + never captures actor role

- **What:** The `audit()` helper function in `LocalRepositories.kt:1544-1550` builds an `AuditLogEntity` with: (1) `tenantId = "00000000-0000-0000-0000-000000000001"` (hardcoded demo tenant); (2) `actorRole = null` (never captured); (3) `note = null` (never captured). Every audit log entry written by `LocalParentRepository`, `LocalStudentRepository`, `LocalPaymentRepository`, `LocalInstallmentRepository`, `LocalLedgerRepository` (and the `auditLog()` helper in LocalRepositories2.kt) uses this helper — so EVERY audit log entry in the app is tagged to the demo tenant and has null actor role, regardless of the actual session.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt:1544-1550`
- **Lines:** 1544-1550
- **Category:** WEAK
- **Severity:** Medium
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** Desktop's audit log captures `actorRole` per the desktop's BUSINESS-003 finding (which noted desktop's refund hardcodes "Manual refund" as reason and drops actor identity — Android has the same problem with actorRole).
- **Whether this duplicate is actually used:** Yes — the helper is called from `audit("payment.collect", ...)`, `audit("payment.refund", ...)`, `audit("payment.adjust", ...)`, `audit("parent.create", ...)`, etc. — every audit entry from LocalRepositories.kt.
- **What depends on it:** Every audit log entry in the app
- **Other platforms/layers affected:** Mirrors desktop's BUSINESS-003 finding (drops actor identity)
- **Behavioral differences:** Multi-tenant deployments are impossible (all audit logs are tagged to the demo tenant). Role-based audit queries (e.g. "show all actions by FINANCIAL_OFFICER role") return nothing (actorRole is always null).
- **Confidence:** Confirmed
- **Git evidence:** `LocalRepositories.kt:1544-1550` last touched in `94471e8` (2026-08-28)
- **Likely root cause:** The `audit()` helper was written as a convenience to reduce boilerplate. The developer hardcoded the demo tenantId because the canonical tenant ID at the time was the demo value. The `actorRole` parameter was never threaded through because the helper's signature was kept short. Multi-tenant support and role-based audit queries were never a priority.
- **Potential impact:** (1) Multi-tenant deployments can't distinguish audit logs by tenant — every log entry is tagged to the demo tenant, so the server-side RLS filter `tenant_id = request.tenant_id` would either grant access to all tenants' logs (if the request's tenant_id is the demo) or hide all Android-written audit logs (if the request's tenant_id is anything else). (2) Compliance investigations that filter by `actor_role` (e.g. "show all refund actions by finance officers") return nothing.
- **Code snippet:**
```kotlin
// LocalRepositories.kt:1544-1550 — audit() helper
private fun audit(action: String, entityType: String, entityId: String, actorId: String, actorName: String, after: String? = null) = AuditLogEntity(
    id = "aud-${UUID.randomUUID()}",
    tenantId = "00000000-0000-0000-0000-000000000001",   // ❌ hardcoded demo tenant
    action = action, entityType = entityType, entityId = entityId,
    actorId = actorId, actorName = actorName,
    actorRole = null,                                     // ❌ never captured
    beforeJson = null, afterJson = after,
    note = null,                                          // ❌ never captured
    createdAt = Instant.now().toString(),
)
```

### FINDING WEAK-012 — `PullSyncRepository.pullParents` / `pullStudents` fallback table select has NO tenant filter — multi-tenant data leak risk

- **What:** `PullSyncRepository.pullParents` (line 57-68) tries the `pull_parents_for_sync` RPC first; if that fails, falls back to a direct `postgrest.from("parents").select { limit(2000) }` — NO tenant filter. Same for `pullStudents` (line 98-109), `pullPayments`, `pullLedgerEntries`. The fallback path pulls the FIRST 2000 rows from the table REGARDLESS of tenant — if Supabase RLS fails or is misconfigured, the app pulls OTHER TENANTS' parent/student/payment/ledger data into local Room storage.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/sync/PullSyncRepository.kt:57-68, 98-109, 132-139, 163-170`
- **Lines:** 57-68 (pullParents fallback), 98-109 (pullStudents fallback), 132-139 (pullPayments fallback), 163-170 (pullLedgerEntries fallback)
- **Category:** WEAK
- **Severity:** High
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** The RPC path `pull_parents_for_sync(p_tenant_id, ...)` correctly filters by tenant — the fallback path bypasses this filter.
- **Whether this duplicate is actually used:** Yes — when the `pull_*_for_sync` RPC fails (e.g. RPC doesn't exist, permission denied, signature mismatch), the fallback fires. With the migration drift noted in CROSS-007 (Android's local migration copies are older), the RPC signature might not match what the server expects → fallback fires.
- **What depends on it:** `pullAll` → every sync tick
- **Other platforms/layers affected:** N/A — Android only
- **Behavioral differences:** If the production Supabase has correct RLS, the fallback path is filtered by RLS and only returns the user's tenant. If RLS is misconfigured (e.g. the policy is ` USING (true)`), the fallback returns ALL tenants' data → leaks to local Room → displayed in the app's UI.
- **Confidence:** Confirmed
- **Git evidence:** `PullSyncRepository.kt` last touched in `dd4c7dc` "kk" (2026-08-26)
- **Likely root cause:** The fallback path was written as a "real table select" when the RPC failed, but the developer didn't replicate the RPC's `p_tenant_id` filter into the fallback query. The fallback was a defensive measure that introduced a multi-tenant leak.
- **Potential impact:** (1) If Supabase RLS fails or the policy is too permissive, the Android app silently pulls other tenants' parent/student/payment/ledger data into local Room. (2) The leaked data is then displayed in the app's UI (e.g. StudentRosterScreen shows students from other tenants). (3) The leaked data is cached locally and persists even after RLS is fixed — the user has to manually clear app data.
- **Code snippet:**
```kotlin
// PullSyncRepository.kt:57-68 — pullParents fallback (NO tenant filter)
if (!fetched) {
    try {
        val dtoList = provider.postgrest.from("parents").select { limit(2000) }.decodeList<ParentDto>()
        // ❌ no .filter { eq("tenant_id", tenantId) } — pulls ALL tenants' parents
        for (dto in dtoList) {
            db.parentDao().upsert(dto.toEntity())
            count++
        }
    } catch (tEx: Throwable) {
        Log.w("PullSync", "Table parents select failed: ${tEx.message}")
    }
}
```

### FINDING DEAD-008 — `StubRepositories.kt` is a 2-line stub file with only a comment

- **What:** `StubRepositories.kt` is 2 lines: a comment line `// Stub repositories removed — real Supabase implementations are in infrastructure/supabase/.` and a blank line. The file is a placeholder from when stub repositories were removed. No `package` declaration, no imports, no classes — Kotlin won't even compile this if it's listed in the source set without a package declaration... Actually wait, the file is just a comment, so it compiles to nothing. But the file exists.
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/infrastructure/stub/StubRepositories.kt`
- **Lines:** 1-2 (entire file)
- **Category:** DEAD
- **Severity:** Low
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** N/A — file is a comment-only placeholder
- **Whether this duplicate is actually used:** No — the file has no executable code
- **What depends on it:** Nothing — the file compiles to nothing
- **Other platforms/layers affected:** N/A
- **Behavioral differences:** N/A
- **Confidence:** Confirmed
- **Git evidence:** File last touched in `e9aa7a3` "first commit" (2026-07-25) — original commit; never modified since
- **Likely root cause:** The stub repositories were removed (per the comment), but the file was left as a "tombstone" marker. The comment is misleading — it claims "real Supabase implementations are in infrastructure/supabase/" but per ARCH-003, there are NO Supabase*Repository implementations on Android.
- **Potential impact:** (1) Misleading — the comment claims implementations exist in `infrastructure/supabase/` but only `SupabaseClientProvider`, `EncryptedSettingsStorage`, `NetworkTimeouts`, `SharedDtos`, `SharedDtoMappers`, `UserProfileDto` live there — none are repositories. (2) Wasted directory entry. (3) Future maintainers may think the file is supposed to contain stubs and add new stubs there.
- **Code snippet:**
```kotlin
// StubRepositories.kt — ENTIRE FILE
// Stub repositories removed — real Supabase implementations are in infrastructure/supabase/.
```

### FINDING WEAK-013 — `GreetingScreenshotTest` validates the LEGACY `ElImtiyazTheme` (not the production `com.example.ui.designsystem.theme.ElImtiyazTheme`)

- **What:** `GreetingScreenshotTest` (the only screenshot test in the repo) imports `com.example.ui.theme.ElImtiyazTheme` (line 15) — the LEGACY theme. But production `MainActivity` imports `com.example.ui.designsystem.theme.ElImtiyazTheme` — the NEW theme. So the screenshot test validates a theme that's NOT what production uses. The committed `greeting.png` (86 KB) shows the legacy theme's rendering (PrimaryBlue, no edge-to-edge, no Material 3 dynamic colors).
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/test/java/com/example/GreetingScreenshotTest.kt:15,48`
- **Lines:** 15 (import), 48 (ElImtiyazTheme call)
- **Category:** WEAK
- **Severity:** Low
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** N/A
- **Whether this duplicate is actually used:** Yes — the test runs as part of `./gradlew :app:testDebugUnitTest` and captures `src/test/screenshots/greeting.png`.
- **What depends on it:** CI screenshot test runs
- **Other platforms/layers affected:** N/A
- **Behavioral differences:** The screenshot test commits a rendering of the legacy theme; if the legacy theme ever breaks, the test fails. But if the NEW theme breaks, no test catches it.
- **Confidence:** Confirmed
- **Git evidence:** `GreetingScreenshotTest.kt` last touched in `8e2ba33` "KAY" (2026-08-11); the new design system theme was introduced AFTER that date
- **Likely root cause:** The screenshot test was written before the new design system theme was introduced. When the new theme was added (post-2026-08-11), the test wasn't migrated to use it.
- **Potential impact:** (1) Screenshot tests provide false confidence — they validate a theme that's not used in production. (2) If the legacy theme is later deleted (which it should be, per DUP-004), the test breaks with "unresolved reference". (3) Visual regressions in the new design system go undetected.
- **Code snippet:**
```kotlin
// GreetingScreenshotTest.kt:15,48 — uses LEGACY theme
import com.example.ui.theme.ElImtiyazTheme   // ❌ legacy, not what production uses
// ...
ElImtiyazTheme {  // renders with legacy theme
    Text(text = "El-Imtiyaz", color = PrimaryBlue)
}

// MainActivity.kt:17 — production uses NEW theme
import com.example.ui.designsystem.theme.ElImtiyazTheme
```

### FINDING DEAD-009 — `ElGalleryActivity` (833 lines across gallery files) is NOT declared in `AndroidManifest.xml` — unreachable in production

- **What:** The design system gallery (`ElGalleryActivity` + `ElGalleryScreen` + `GallerySection` + 5 tabs) is 833 lines of code that showcases the new design system's components, foundations, and overlays. The KDoc at `ElGalleryActivity.kt:22-28` documents launching via `adb shell am start -n com.aistudio.elimtiyazstaff.bxmzlx/.ElGalleryActivity` — but the activity is NOT declared in `AndroidManifest.xml` (verified via grep — no "Gallery" in manifest). So the activity cannot be launched in production; `adb shell am start` would fail with "Activity not found".
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/ui/designsystem/gallery/ElGalleryActivity.kt:30` + 7 other gallery files (total 833 lines)
- **Lines:** ElGalleryActivity.kt:30 (class declaration); AndroidManifest.xml (missing the `<activity android:name=".ui.designsystem.gallery.ElGalleryActivity" />` entry)
- **Category:** DEAD
- **Severity:** Low
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** N/A
- **Whether this duplicate is actually used:** No — the activity can't be launched without a manifest entry. Only a developer who adds the manifest entry can launch it (e.g. for design review).
- **What depends on it:** N/A — only the design system gallery itself; nothing else references these files
- **Other platforms/layers affected:** N/A
- **Behavioral differences:** N/A
- **Confidence:** Confirmed
- **Git evidence:** Gallery files last touched in `dd4c7dc` "kk" (2026-08-26); the manifest was last touched in `9c19424` "mid" (2026-08-14) — the gallery was added after the manifest was last edited, so the manifest entry was never added.
- **Likely root cause:** The gallery was built as a developer showcase for the new design system. The KDoc says it's launched via `adb shell am start` (a developer workflow), implying the developer didn't intend it for production users. But the manifest entry was never added, so even the `adb shell am start` workflow doesn't work without first editing the manifest.
- **Potential impact:** (1) 833 lines of dead code ship in the production APK (~30KB after Compose compilation). (2) The gallery imports Compose components — if any of those components are ALSO dead (e.g. only used by the gallery), the dead-code chain extends. (3) The KDoc's `adb shell am start` instruction is wrong — developers following it get "Activity not found".
- **Code snippet:**
```kotlin
// ElGalleryActivity.kt:22-30 — KDoc says adb shell am start works, but it doesn't
/**
 * Launchable via:
 *   adb shell am start -n com.aistudio.elimtiyazstaff.bxmzlx/.ElGalleryActivity
 * Or add the following to AndroidManifest.xml:
 *   <activity android:name="com.example.ui.designsystem.gallery.ElGalleryActivity" />
 */
@AndroidEntryPoint
class ElGalleryActivity : ComponentActivity() { ... }

// AndroidManifest.xml — has NO <activity> entry for ElGalleryActivity (verified via grep)
// → adb shell am start fails with "Activity not found"
```

### FINDING BUSINESS-007 — `LedgerEngine.maxDaysOverdueFromLedger` uses charge's `at` (creation date) instead of due date — inconsistent with canonical overdue rule

- **What:** `maxDaysOverdueFromLedger` (line 168-173) computes "days overdue" as the age of the OLDEST CHARGE entry, where age = `now - charge.at`. But `charge.at` is the CREATION timestamp of the charge entry, not its DUE date. A charge created today (e.g. for next year's tuition) is not overdue today — but `maxDaysOverdueFromLedger` returns ~365 days for it. This is a DIFFERENT definition of "overdue" than `computeParentSummary.totalOverdue` (which uses `overdueCategoryDueDates` due-date map) and the SQL function `compute_parent_summary` (which uses MAX(charge.at) filtered by `p_as_of` and joined to installments' due_date — per migration 0042's comment).
- **Where:** `/home/z/my-project/repos/elimtiyaz-android/app/src/main/java/com/example/core/LedgerEngine.kt:168-173`
- **Lines:** 168-173
- **Category:** BUSINESS
- **Severity:** Medium
- **Repo/Platform:** elimtiyaz-android (Android)
- **Original/canonical implementation (if duplicate):** Desktop's `computeParentSummary.totalOverdue` uses `overdueCategoryDueDates` map (due dates). Migration 0042's canonical rule uses MAX(charge.at) across ALL entries with no as-of filter (per the migration's KDoc). Neither matches `maxDaysOverdueFromLedger`'s definition.
- **Whether this duplicate is actually used:** Yes — `LocalDebtRepository.observeSummary` (line 622) uses it to compute `daysOverdue = maxDays` and `bucket = agingBucketFromDays(maxDays)`. So the debt dashboard's "days overdue" and aging bucket (0-30, 31-60, 61-90, 90+) are based on charge CREATION date, not due date.
- **What depends on it:** `DebtDashboardScreen`, `DashboardBucketHelpers` (aging buckets)
- **Other platforms/layers affected:** Mirrors desktop's DRIFT-006 finding — three implementations of "overdue" with different rules (TS, SQL, Kotlin)
- **Behavioral differences:** A parent whose tuition charge was created on 2026-09-15 (the academic year start) shows as "X days overdue" where X = today - 2026-09-15, even if the charge's due date (e.g. tranche 1 due 2026-12-15) hasn't passed yet. The aging bucket would put them in "0-30 days" or "31-60 days" depending on when they're viewed, despite the charge not being overdue yet.
- **Confidence:** Confirmed
- **Git evidence:** `LedgerEngine.kt` last touched in `94471e8` (2026-08-28)
- **Likely root cause:** The function was written before the canonical overdue rule (INV-4) was defined. It uses the charge's `at` field as a proxy for "overdue since" — which is wrong because `at` is the creation date, not the due date. The function was never refactored when the canonical rule was introduced.
- **Potential impact:** (1) Debt dashboard's "days overdue" column shows inflated numbers (e.g. 100+ days for a charge created 100 days ago but not due for another 200 days). (2) Aging buckets mis-categorize parents — a parent with a recently-created charge that's not yet due might be put in the "31-60 days overdue" bucket. (3) Collections staff prioritize the wrong parents based on inflated "days overdue".
- **Code snippet:**
```kotlin
// LedgerEngine.kt:168-173 — uses charge.at (creation date), NOT due date
fun maxDaysOverdueFromLedger(entries: List<LedgerEntry>, now: Instant = Instant.now()): Long {
    val pastCharges = entries.filter { it.type == LedgerEntryType.CHARGE && parseIsoInstantSafe(it.at).isBefore(now) }
    // ❌ uses charge.at (creation date), not the charge's due date
    if (pastCharges.isEmpty()) return 0L
    val oldest = pastCharges.minOf { parseIsoInstantSafe(it.at) }
    return (now.toEpochMilli() - oldest.toEpochMilli()) / 86_400_000L
    // Returns "days since oldest charge was created" — NOT "days since charge became overdue"
}
```

Stage Summary:
- 30 findings total (above the 15-25 target — exhaustive audit)
- Severity breakdown: Critical: 5 (CROSS-005, CROSS-006, WEAK-006, WEAK-007, BUSINESS-006), High: 10 (DUP-003, DUP-005, CROSS-007, DEAD-005, WEAK-009, ARCH-003, ARCH-004, REG-002, SEC-006, WEAK-012), Medium: 9 (DUP-004, DEAD-006, WEAK-008, WEAK-010, DRIFT-008, SEC-004, SEC-005, WEAK-011, BUSINESS-007), Low: 6 (DRIFT-007, DEAD-007, CROSS-008, DEAD-008, WEAK-013, DEAD-009, SEC-003)
- Top 5 critical issues:
  1. **CROSS-005**: Android `LocalPaymentRepository.collect()` bypasses the canonical `collect_payment` RPC — uses non-atomic `upsert_payment_from_import` instead; server-side invariants bypassed
  2. **CROSS-006**: Android `LocalPaymentRepository.refund()` bypasses the canonical `refund-payment` Edge Function — server-side refund policy validation (e.g. blocks refunds of cancelled payments) bypassed
  3. **WEAK-006**: `LocalInstallmentRepository.regenerateForCycle()` is hollow — writes audit log + returns existing installments unchanged (desktop actually re-derives due dates)
  4. **WEAK-007**: Dashboard "Créances en Retard" KPI + Debt Dashboard overdue amount are PERMANENTLY 0 — `computeParentSummary` is called without `overdueCategoryDueDates` map; `buildOverdueDueDateMap` exists but is never invoked from production
  5. **BUSINESS-006**: Receipt numbers generated locally as `REC-$year-$seq` (seq = `paymentDao.listAll().size + 1`) — collision-prone, race-condition-prone, per-device; on sync push, `upsert_payment_from_import` matches by `(tenant_id, payment_number)` → cross-device data loss
- Notable cross-repo links:
  - **CROSS-005 / CROSS-006**: Android bypasses canonical `collect_payment` + `refund-payment` Edge Functions (uses `upsert_*_from_import` instead) — Android and desktop use DIFFERENT RPCs for the same business operations; server-side invariants enforced by the canonical Edge Functions are bypassed on Android
  - **CROSS-007**: Android's local `supabase/migrations/` is OLDER than desktop's canonical — 4 of 6 migrations differ, missing `SET search_path = public, extensions;` security hardening (desktop's REG-001 fix-up migrations hardened the desktop's copies; Android's weren't re-synced)
  - **DUP-005 / DRIFT-008**: Android has TWO parallel Room entity/DAO/mapper layers (cache + source-of-truth) with CONTRADICTORY architectural intent — mirrors desktop's ARCH-001 partial migration (mock vs Supabase repositories)
  - **DEAD-005 / DEAD-006**: Android has `deterministicStudentCode` (dead code) + `SyncQueueDispatcher.generateParentCode/StudentCode/PaymentNumber` (random fallbacks) — mirrors desktop's DRIFT-001 / DEAD-001 finding (canonical deterministic function exists, parallel random implementation bypasses it)
  - **REG-002**: 8 Room fix-up migrations document regressions (subjects.coefficient INTEGER→REAL, subjects.level hardcoded "all", expenses.finalSpentAmount silently dropped, etc.) — mirrors desktop's REG-001 (9 SQL fix-up migrations after the "canonical engine unification" was supposedly complete)
  - **CROSS-008**: Android's `AndroidEquivalenceTest` depends on the desktop's `financial-tests/equivalence/scenarios` directory (doesn't exist in Android repo) — mirrors desktop's DUP-001 (four parallel cross-platform equivalence test frameworks)
  - **BUSINESS-007 + WEAK-007**: Android has THREE inconsistent "overdue" implementations — `maxDaysOverdueFromLedger` (charge creation date), `computeParentSummary.totalOverdue` (due-date map, but never passed by callers), and the SQL `compute_parent_summary` (MAX(charge.at) per migration 0042) — mirrors desktop's DRIFT-006 (multiple iterations of canonical overdue rule)
  - **WEAK-006 (regenerateForCycle hollow)**: Android's regenerateForCycle is hollow while desktop's actually does the work — Android users see "Tranches re-modélisées" success toast but nothing changes; desktop users see the actual re-modeling
---
Task ID: 2-c
Agent: general-purpose (elimtiyaz-website auditor)
Task: Deep audit of /home/z/my-project/repos/elimtiyaz-website/ (Website + Backend)

Work Log:
- Read shared worklog (Task 2-a Desktop findings reviewed — 31 findings, used as cross-reference baseline)
- Inventoried 91 source files + 4 SQL migrations + 2 Edge Functions + 7 docs/config
- Ran git log on every suspicious file (commit count: 5 — repo is young)
- Identified 24 findings (5 Critical, 6 High, 8 Medium, 5 Low)

Repo Summary:
- Language(s): TypeScript 5 (Next.js 16 App Router), SQL (PostgreSQL migrations + plpgsql triggers), Deno Edge Functions (TS)
- Framework(s): Next.js 16.1 (App Router, output: "standalone"), React 19, TanStack Query 5, Zustand 5, Tailwind 4, shadcn/ui, Zod 4, Supabase JS SDK 2, Firebase 12 (FCM), Vitest 4
- Entry point(s): `src/app/page.tsx` (client-side auth state machine → AppShell), `src/middleware.ts` (security headers only — NO auth gating), `supabase/functions/bind-activation-code/index.ts`, `supabase/functions/send-push-notification/index.ts`
- Total commits: 5 (`aebc58d` "first commit" 2026-07-31 → `03f6365` "fix(portal): canonical pending-waterfall capacity + idempotent portal patches" 2026-08-28). Commit messages drift pattern matches desktop: 3 single-word messages ("mid", "fkniga", "kay") + 1 descriptive final commit.
- Total source files: 91 (52 .ts/.tsx in src/, 4 SQL migrations, 2 Edge Function index.ts, 7 config/docs, plus public/ assets)

Findings:

### FINDING SEC-007 — Mock-auth hydration runs unconditionally on every mount; bypasses the `NEXT_PUBLIC_MOCK_AUTH_ENABLED` feature flag

- **What:** The AuthProvider's `useEffect` on mount calls `getMockSession()` and, if a `mock-auth-session` key exists in localStorage, hydrates the auth state to a full mock administrator session — without checking `isMockAuthEnabled`. The visible "Mock Admin Login" button on the LoginScreen IS gated by `isMockAuthEnabled`, but the underlying `signInWithMock()` function and the localStorage hydration are NOT. The auth-provider's own header comment confirms this: *"This is ALWAYS functional (no feature-flag gating) so testers can use the app immediately."* — directly contradicting the env.ts comment that claims *"Mock admin auth is OPT-IN: it only activates when `NEXT_PUBLIC_MOCK_AUTH_ENABLED === 'true'"*.
- **Where:** `/home/z/my-project/repos/elimtiyaz-website/src/app/providers/auth-provider.tsx`
- **Lines:** 24-29 (header comment claiming "ALWAYS functional"), 196-206 (useEffect hydration — no flag check), 264-277 (signInWithMock — no flag check), 304-317 (context value exposes signInWithMock + isMockSession unconditionally)
- **Category:** SEC
- **Severity:** Critical
- **Repo/Platform:** elimtiyaz-website (Website)
- **Original/canonical implementation (if duplicate):** N/A — this is a unique bypass.
- **Whether this duplicate is actually used:** Yes — runs on every page load. Any code that can write to localStorage (XSS, browser devtools, malicious browser extension, shared public computer) can plant `mock-auth-session` and become a "Mock Administrator" with 50+ staff permissions including `admin.users.manage`, `admin.roles.manage`, `finance.payments.refund`, `finance.adjustments.create`.
- **What depends on it:** The portal's entire auth gate (page.tsx state machine). `state === "active"` → renders `<AppShell/>` and exposes all parent data hooks.
- **Other platforms/layers affected:** The mock session's `MOCK_ADMIN_PROFILE.tenant_id = "mock-tenant-id"` is not a real UUID, so RLS would filter out all real rows — meaning the attacker sees an empty dashboard (no real data leak). However, the auth gate is bypassed: the attacker can navigate the entire portal UI structure, probe endpoints, and inspect the app's behavior without Google OAuth.
- **Behavioral differences:** Production-deployed portal with `NEXT_PUBLIC_MOCK_AUTH_ENABLED` unset (the documented "opt-in" state) STILL hydrates a planted mock session. The flag is a UI-visibility gate, not a security gate.
- **Confidence:** Confirmed
- **Git evidence:** `auth-provider.tsx` introduced in commit `e90dbf7` "mid" (2026-08-01) with the unconditional hydration. The `isMockAuthEnabled` flag was added to `env.ts` in commit `89cc19d` "fkniga" (2026-08-01 17:39). Commit `7ee2457` "kay" (2026-08-01 18:18) inverted the flag to default-on. Commit `03f6365` (2026-08-28) reverted the flag to opt-in but did NOT touch `auth-provider.tsx` — the unconditional hydration remains.
- **Likely root cause:** The auth-provider was written before the env-flag was added; the author assumed the flag would gate the UI button and didn't think to gate the underlying hydration. The "kay" commit then inverted the flag to default-on (a separate regression — see REG-003). The "fix(portal)" commit reverted the flag but missed the auth-provider.
- **Potential impact:** A malicious user with brief physical or XSS access to a parent's browser can plant `mock-auth-session` in localStorage and bypass Google OAuth permanently. Even though RLS prevents real data access (mock tenant_id), the attacker can explore the portal's UI, learn its structure, and potentially discover other attack surfaces. On shared/public computers, a previous user could plant the session and the next user would see a "logged in" state.
- **Code snippet:**
```ts
// auth-provider.tsx:196-206 — runs on EVERY mount, no isMockAuthEnabled check
useEffect(() => {
  const mockSession = getMockSession();
  if (mockSession && isMockUser(mockSession.user.auth_user_id)) {
    setUser(mockSession.user);
    setParent(mockSession.parent);
    setChildrenList(mockSession.children);
    setIsMockSession(true);
    setError(null);
    setState("active");  // ← bypasses the Google OAuth gate entirely
  }
}, []);
```

### FINDING SEC-008 — `enforce_parent_self_update_columns` trigger has no `has_role('parent')` check — blocks ALL staff updates to parent identity fields

- **What:** The BEFORE UPDATE trigger `enforce_parent_self_update_columns` (migration 0027) raises an exception if ANY of `id, tenant_id, parent_code, first_name, last_name, national_id, relationship, notes, is_active, is_financially_restricted, auth_user_id, deleted_at` changes. Unlike the parallel `enforce_parent_attendance_update_columns` trigger (which gates its restriction on `public.has_role('parent')`), this trigger has NO role check — it fires for EVERY UPDATE to the `parents` table, regardless of who is calling. This means a staff member using the desktop's `SupabaseParentRepository.updateParent()` (which sends `first_name`, `last_name`, `parent_code`, `is_active`, `is_financially_restricted`, `deleted_at` patches) would have EVERY such update rejected with *"Parents can only update contact fields (phone, email, address, occupation)"*.
- **Where:** `/home/z/my-project/repos/elimtiyaz-website/supabase/migrations/0027_portal_parent_rls_policies.sql:147-172` — the trigger function and trigger definition. Verbatim-copied into `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations/0043_portal_alignment.sql:258-283`.
- **Lines:** trigger function `:147-167`, trigger `:169-172`
- **Category:** SEC (also BUSINESS — breaks production workflow)
- **Severity:** Critical
- **Repo/Platform:** elimtiyaz-website (Backend migration) — propagated to desktop via 0043_portal_alignment.sql
- **Original/canonical implementation (if duplicate):** The website's 0027 is the original; desktop's 0043 absorbed it verbatim.
- **Whether this duplicate is actually used:** Yes — once the migrations are applied to a Supabase project, the trigger is live. Both the website's 0027 and the desktop's 0043 create the same trigger (idempotent `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`).
- **What depends on it:** The desktop's `SupabaseParentRepository.updateParent()` (`supabase-shared-repositories.ts:551-585`) which sends `first_name`, `last_name`, `display_name`, `primary_phone`, `secondary_phone`, `email`, `occupation`, `address`, `transport_destination`, `city_tier` patches. The desktop's `deleteParent()` (soft-delete via `deleted_at`) would also be blocked. The desktop's overdue-scan workflow that sets `is_financially_restricted = true` would also be blocked.
- **Other platforms/layers affected:** Desktop (CRM parent edit modal, soft-delete, overdue-scan, account suspension). The trigger is on the `parents` table — there is no bypass except `ALTER TABLE ... DISABLE TRIGGER` or dropping the trigger.
- **Behavioral differences:** Pre-trigger: staff can freely update any parent field. Post-trigger: staff can ONLY update `primary_phone, secondary_phone, email, address, city, postal_code, occupation` — every other field change raises an exception. The desktop's edit-parent-modal would fail on every save that changes a name, the parent_code, the active flag, or the deleted_at timestamp.
- **Confidence:** Confirmed
- **Git evidence:** Migration 0027 introduced in commit `e90dbf7` "mid" (2026-08-01). The trigger function has no `has_role('parent')` guard. The parallel attendance trigger `enforce_parent_attendance_update_columns` (0027:55-87) DOES have `select public.has_role('parent') into is_parent; if is_parent then ...` — proving the author knew the pattern but didn't apply it to the parents trigger.
- **Likely root cause:** The author wrote the attendance trigger first (with the role check), then wrote the parents trigger by copying the structure but forgot to add the role check. The trigger was designed assuming only parents would UPDATE the parents table — forgetting that staff (super_admin, support_staff) also UPDATE parents via the desktop. SECURITY DEFINER on the trigger function doesn't help — it just means the trigger EXECUTES with postgres privileges, but the trigger body still runs.
- **Potential impact:** If this migration is applied to a production database, the desktop's parent-edit modal, soft-delete, overdue-scan workflow, and account-suspension flow ALL break. Staff cannot rename parents, mark them inactive, set financial restrictions, or soft-delete them. The school would be unable to manage parent records from the desktop. The fix is to add `select public.has_role('parent') into is_parent; if is_parent then ... end if;` to the trigger body (mirroring the attendance trigger).
- **Code snippet:**
```sql
-- 0027_portal_parent_rls_policies.sql:147-167 — NO has_role('parent') check
create or replace function public.enforce_parent_self_update_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Parents can only touch contact fields. Anything else is rejected.
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.parent_code is distinct from old.parent_code
     or new.first_name is distinct from old.first_name
     -- ... 9 more columns ...
     or new.deleted_at is distinct from old.deleted_at then
    raise exception 'Parents can only update contact fields (phone, email, address, occupation)';
  end if;
  return new;
end;
$$;
-- COMPARE: enforce_parent_attendance_update_columns (0027:55-87) HAS the check:
--   select public.has_role('parent') into is_parent;
--   if is_parent then ... end if;
```

### FINDING WEAK-014 — `send-push-notification` Edge Function queries `device_tokens` by `user_profile_id` (non-existent column) instead of canonical `user_id`

- **What:** The Edge Function looks up active device tokens with `.eq("user_profile_id", payload.target_user_id)` — but the canonical `device_tokens` table (created by desktop migration 0027_shared_unification.sql) uses the `user_id` column, NOT `user_profile_id`. The website's own migration 0025 (rewritten) explicitly documents this: *"The portal now registers tokens through the canonical `register_fcm_token(p_user_id, p_token, p_platform)` RPC (migration 0027) ... and reads/deactivates rows via the `user_id` column with the RLS policies installed by migration 0037."* The client-side `fcm-registration.ts` correctly uses `.eq("user_id", userProfileId)`, but the Edge Function uses the wrong column name. The query would fail with PostgREST 400 *"column user_profile_id does not exist"* → `error` is truthy → function returns HTTP 500 → NO push notification is ever sent.
- **Where:** `/home/z/my-project/repos/elimtiyaz-website/supabase/functions/send-push-notification/index.ts:208-219`
- **Lines:** `:211` `.eq("user_profile_id", payload.target_user_id)`
- **Category:** WEAK
- **Severity:** Critical
- **Repo/Platform:** elimtiyaz-website (Backend Edge Function — unique to this repo, no desktop equivalent)
- **Original/canonical implementation (if duplicate):** N/A — this is the only `send-push-notification` Edge Function in the 3-repo system.
- **Whether this duplicate is actually used:** Yes — the function is the canonical push fan-out entry point. It's called by workflow actions, the notifications INSERT trigger (via Supabase webhook), and manual admin triggers per the function's own header comment.
- **What depends on it:** Every FCM push notification to every parent. The portal's entire push notification feature.
- **Other platforms/layers affected:** The Android app's `FcmTokenRegistrar` registers tokens via the same canonical `register_fcm_token` RPC, so Android tokens are in the same `device_tokens` table. The Edge Function's wrong column name means Android tokens also never receive pushes from this function.
- **Behavioral differences:** The DONE.md (line 55) claims *"FCM HTTP v1 migration: the send-push-notification Edge Function now uses the FCM HTTP v1 API with OAuth2 service-account tokens ... Per-message platform-specific config (Android priority + click_action, webpush notification actions). Auto-marks tokens as inactive on UNREGISTERED responses."* — but NONE of this works because the token lookup fails first.
- **Confidence:** Confirmed (verified: the column name is `user_profile_id` in the Edge Function; `user_id` in the migration and the client-side hook)
- **Git evidence:** Edge Function introduced in commit `e90dbf7` "mid" (2026-08-01). The latest commit `03f6365` (2026-08-28) did NOT modify this file. The bug has been present since 2026-08-01.
- **Likely root cause:** The Edge Function was written before the migration 0025 rewrite (which aligned the website with the canonical desktop schema). The author used the old column name `user_profile_id` (which existed in the pre-rewrite website-local `device_tokens` table). When migration 0025 was rewritten to align with the canonical desktop schema, the Edge Function was not updated to match.
- **Potential impact:** The entire push notification system is non-functional. Parents never receive push notifications. The "per-category notification filtering" (DONE.md line 56) is dead code. The "FCM HTTP v1 migration" claim is false advertising. The TODO.md post-deploy verification checklist item *"Trigger a staff action (e.g. record a payment from the desktop app) → push notification arrives on the portal"* would fail.
- **Code snippet:**
```ts
// send-push-notification/index.ts:208-212 — wrong column name
const { data: tokens, error } = await supabase
  .from("device_tokens")
  .select("token, platform")
  .eq("user_profile_id", payload.target_user_id)  // ← should be "user_id"
  .eq("is_active", true);
// COMPARE: fcm-registration.ts:71-75 uses the correct column:
//   .from("device_tokens")
//   .update({ is_active: false })
//   .eq("user_id", userProfileId)
//   .eq("platform", "web");
```

### FINDING WEAK-015 — `send-push-notification` PEM key parser strips only the END marker; `-----BEGIN PRIVATE KEY-----` survives and corrupts the base64 decode

- **What:** The `getFcmAccessToken()` function parses the Firebase service-account's `private_key` PEM by: (1) removing a literal `[REDACTED:ssh_private_key]` string (a redaction-tool artifact that never appears in real PEM keys), (2) removing `-----END PRIVATE KEY-----`, (3) removing all whitespace. Step (2) does NOT strip `-----BEGIN PRIVATE KEY-----`. After whitespace removal, the result starts with `-----BEGINPRIVATEKEY-----` followed by the actual base64 payload. `atob()` in Deno throws `InvalidCharacterError` on the dashes (`-` is not in the base64 alphabet). The OAuth2 token exchange never happens → `getFcmAccessToken` throws → the Edge Function returns HTTP 500 with `"FCM auth failed: ..."`.
- **Where:** `/home/z/my-project/repos/elimtiyaz-website/supabase/functions/send-push-notification/index.ts:93-104`
- **Lines:** `:93-97` (the `.replace()` chain), `:97` (the `atob()` call)
- **Category:** WEAK
- **Severity:** Critical
- **Repo/Platform:** elimtiyaz-website (Backend Edge Function — unique to this repo)
- **Original/canonical implementation (if duplicate):** N/A
- **Whether this duplicate is actually used:** Yes — called on every push fan-out (after the broken token lookup in WEAK-014, which returns 0 tokens and short-circuits before this function is even called).
- **What depends on it:** Every FCM HTTP v1 message send.
- **Other platforms/layers affected:** N/A — only the website has a `send-push-notification` Edge Function.
- **Behavioral differences:** Pre-bug: push notifications would be sent via FCM HTTP v1. Post-bug: every invocation throws, function returns 500. Even if WEAK-014 were fixed (correct column name), this bug would still prevent pushes.
- **Confidence:** Confirmed (verified with a Python script reproducing the exact transformation and confirming `atob`/base64 decode fails on the resulting string — see `/home/z/my-project/scripts/test_pem_parsing.py`)
- **Git evidence:** Introduced in commit `e90dbf7` "mid" (2026-08-01). Never modified since. The latest commit `03f6365` (2026-08-28) did not touch this file.
- **Likely root cause:** The author hand-rolled a PEM parser to avoid depending on a `google-auth-library` Deno package. They stripped the END marker (knowing it shouldn't be in the base64) but forgot to strip the BEGIN marker. The `[REDACTED:ssh_private_key]` literal is a leftover from a secret-scanning tool that ran over the source — it's a no-op on real PEM keys but signals the file was scanned.
- **Potential impact:** Combined with WEAK-014, the entire push notification system is doubly broken. Even if one bug is fixed, the other still prevents pushes. The DONE.md claim *"FCM HTTP v1 migration ... minted via WebCrypto JWT-bearer flow"* is false — the JWT-bearer flow never succeeds because the PEM parsing fails first.
- **Code snippet:**
```ts
// send-push-notification/index.ts:93-97 — BEGIN marker never stripped
const pemContents = sa.private_key
  .replace("[REDACTED:ssh_private_key]", "")  // no-op redaction marker
  .replace("-----END PRIVATE KEY-----", "")   // strips END but NOT BEGIN
  .replace(/\s+/g, "");                       // → "-----BEGINPRIVATEKEY-----MIIE..."
const der = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
//                                          ^^^ throws InvalidCharacterError on '-'
```

### FINDING BUSINESS-008 — Website's `bind-activation-code` Edge Function activates the user (sets `status='active'` + upserts `role_assignments`); the desktop's canonical version does NOT

- **What:** The website's local copy of the `bind-activation-code` Edge Function, after calling the canonical `bind_activation_code()` SQL RPC, ALSO (a) upserts a `role_assignments` row granting the `parent` role, AND (b) flips `user_profiles.status` to `'active'` and clears `approval_request_id`. The desktop's canonical version of the same Edge Function does NEITHER — it just calls the RPC and writes an audit log. The SQL RPC `bind_activation_code()` itself (migration 0005_crm.sql) only updates `parents.auth_user_id` and marks the code as bound — it does NOT touch `user_profiles` or `role_assignments`. So the website's Edge Function has unique post-binding activation logic that the desktop's version lacks. Depending on which Edge Function is deployed, the same activation code either: (a) activates the user immediately (website version) → user lands on the dashboard; OR (b) leaves the user in `pending` status (desktop version) → user sees the pending screen again after refresh.
- **Where:** `/home/z/my-project/repos/elimtiyaz-website/supabase/functions/bind-activation-code/index.ts:174-205` (activation logic). Compare: `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/bind-activation-code/index.ts:78-133` (no activation logic — just RPC + audit log).
- **Lines:** website `:174-205` (upsert role_assignments + update user_profiles.status); desktop `:108-124` (writeAuditLog only, no activation)
- **Category:** BUSINESS
- **Severity:** Critical
- **Repo/Platform:** elimtiyaz-website (Backend Edge Function) ↔ elimtiyaz-desktop (Backend Edge Function)
- **Original/canonical implementation (if duplicate):** Per the desktop audit's CROSS-004, the desktop's version is canonical (uses shared `_shared/cors.ts` + `_shared/supabase.ts` helpers, accepts both `code` and `activation_code` body keys, writes audit logs). The website's version is a drifted standalone copy.
- **Whether this duplicate is actually used:** Yes — the website's `activation-code-screen.tsx` calls `/functions/v1/bind-activation-code` and expects success to activate the user (the screen's own header comment says *"flips user_profiles.status to 'active', and grants the 'parent' role"*).
- **What depends on it:** The Path A self-service activation flow. If the desktop's version is deployed (canonical), the website's Path A flow is BROKEN — the user binds the code, sees "success", refreshes, and is back on the pending screen.
- **Other platforms/layers affected:** Desktop (uses `activation_code` body key, gets audit log) and Android (also uses `activation_code`). The website's version only reads `body.code` (line 105: `let body: { code?: string }`) — so if the WEBSITE's version is deployed, desktop/Android activation calls would fail with `"Activation code must be 6 or 7 digits."` (because `body.code` is undefined for them).
- **Behavioral differences:** Website version: reads only `code` body key, no shared helpers, no audit log, BUT activates the user. Desktop version: reads both `code` and `activation_code`, uses shared helpers, writes audit log, but does NOT activate the user. They CANNOT both be correct.
- **Confidence:** Confirmed
- **Git evidence:** Website's `bind-activation-code/index.ts` introduced in commit `e90dbf7` "mid" (2026-08-01). Desktop's version is more recent (per CROSS-004, the dual-key patch was in commit `2e2b21a` 2026-08-28 — the same day as the website's `03f6365`). Neither commit reconciled the activation-logic divergence.
- **Likely root cause:** The website's Edge Function was written first (2026-08-01) with the assumption that binding = activation. The desktop's version was written/refactored later with a stricter separation of concerns (the RPC just binds; activation is a separate admin step). The two teams never reconciled. The website's `activation-code-screen.tsx` comment still claims the Edge Function activates the user.
- **Potential impact:** Either the website's Path A flow is broken (if desktop's version is deployed) OR the desktop/Android activation flows are broken (if website's version is deployed). The cross-platform activation contract is undefined. A parent binding a code may or may not be activated depending on which Edge Function happens to be deployed.
- **Code snippet:**
```ts
// WEBSITE bind-activation-code/index.ts:174-205 — activates the user
if (parentRole?.id) {
  await adminClient
    .from("role_assignments")
    .upsert({ user_profile_id: profile.id, role_id: parentRole.id, ... });
}
await adminClient
  .from("user_profiles")
  .update({ status: "active", approval_request_id: null })
  .eq("id", profile.id);

// DESKTOP bind-activation-code/index.ts:107-124 — NO activation, just audit log
await writeAuditLog(ctx.tenantId, "activation_code.bind", "parent",
  result.parent_id, ctx.userProfileId, ctx.email,
  { activation_code: code, auth_user_id: ctx.userId },
  { parent_id: result.parent_id, parent_full_name: result.parent_full_name, ... },
  `Parent ${result.parent_full_name} activated account with code ${code}`,
  requestId);
```

### FINDING REG-003 — Mock auth feature flag was DEFAULT-ON between 2026-08-01 and 2026-08-28 (the "kay" commit); a staff-grade bypass shipped on production login screens

- **What:** The `isMockAuthEnabled` flag in `env.ts` was changed from `env.NEXT_PUBLIC_MOCK_AUTH_ENABLED === "true"` (opt-in) to `env.NEXT_PUBLIC_MOCK_AUTH_ENABLED !== "false"` (default-on) in commit `7ee2457` "kay" (2026-08-01 18:18). With the default-on logic, ANY environment that didn't explicitly set `NEXT_PUBLIC_MOCK_AUTH_ENABLED=false` would have the "Mock Admin Login" button visible on the production login screen — granting full staff permissions (50+ permissions including `admin.users.manage`, `finance.payments.refund`) to anyone who could click a button. The latest commit `03f6365` (2026-08-28) reverted the flag to opt-in with a comment *"The previous default-on behavior shipped a staff-grade bypass on the production login screen."* — confirming this was a recognized regression. However, the OLD misleading comment block *"ENABLED by default in ALL environments (temporary testing phase) ... Set NEXT_PUBLIC_MOCK_AUTH_ENABLED=false to disable"* was NOT removed and still sits directly above the corrected code, contradicting it.
- **Where:** `/home/z/my-project/repos/elimtiyaz-website/src/lib/env.ts:79-90`
- **Lines:** `:79-84` (stale comment block claiming default-on), `:85-90` (corrected code that is opt-in)
- **Category:** REG
- **Severity:** High
- **Repo/Platform:** elimtiyaz-website (Website)
- **Original/canonical implementation (if duplicate):** N/A
- **Whether this duplicate is actually used:** Yes — `isMockAuthEnabled` is consumed by `login-screen.tsx:104` to gate the visible "Mock Admin Login" button. Combined with SEC-007 (ungated hydration), the flag's value is largely cosmetic.
- **What depends on it:** The login screen's mock button visibility.
- **Other platforms/layers affected:** N/A — website-only flag.
- **Behavioral differences:** Opt-in (`=== "true"`): mock button hidden unless explicitly enabled. Default-on (`!== "false"`): mock button VISIBLE in production unless explicitly disabled. The "kay" commit shipped the latter for 27 days (2026-08-01 → 2026-08-28).
- **Confidence:** Confirmed (git diff shows the exact change)
- **Git evidence:** `7ee2457` "kay" (2026-08-01 18:18:11) — changed `=== "true"` to `!== "false"`. `03f6365` "fix(portal): ..." (2026-08-28 02:28:32) — reverted to `=== "true"` but left the stale comment.
- **Likely root cause:** The "kay" commit (single-word message, matches the desktop repo's drift pattern of single-word commits by the same author "mersel fares") inverted the flag without understanding the production impact. The 03f6365 commit reverted the LOGIC but the author didn't clean up the now-false comment block above it.
- **Potential impact:** For 27 days (2026-08-01 to 2026-08-28), any production deployment of the website had the "Mock Admin Login" button visible on the login screen. Anyone could click it and become a mock administrator. Combined with SEC-007 (ungated hydration), even after the revert, the underlying bypass remains. The stale comment block misleads future maintainers into thinking the flag is still default-on.
- **Code snippet:**
```ts
// env.ts:79-90 — stale comment + corrected code (contradictory)
// ─── TEMPORARY MOCK AUTH ───────────────────────────────────────────────────
// Feature flag for the mock administrator login.
//   - ENABLED by default in ALL environments (temporary testing phase)   ← STALE
//   - Set NEXT_PUBLIC_MOCK_AUTH_ENABLED=false to disable                ← STALE
// This ensures the mock login is always available ...                    ← STALE
/**
 * Mock admin auth is OPT-IN: it only activates when
 * NEXT_PUBLIC_MOCK_AUTH_ENABLED === "true". The previous default-on behavior
 * shipped a staff-grade bypass on the production login screen.
 */
export const isMockAuthEnabled = env.NEXT_PUBLIC_MOCK_AUTH_ENABLED === "true";
```

### FINDING DEAD-010 — `mock-auth.ts` is a 278-line "TEMPORARY" mock authentication system still wired into auth-provider, login-screen, and env.ts — DONE.md/TODO.md claim "zero mock implementations remaining"

- **What:** The file `src/lib/auth/mock-auth.ts` (278 lines) defines a complete mock authentication system: `MOCK_ADMIN_PROFILE` with `status: "active"`, `MOCK_ADMIN_PARENT`, two `MOCK_ADMIN_STUDENTS`, a 50-item `MOCK_ADMIN_PERMISSIONS` array (including `admin.users.manage`, `admin.roles.manage`, `finance.payments.refund`), `MOCK_ADMIN_ROLES = ["admin", "super_admin"]`, `saveMockSession()`/`getMockSession()`/`clearMockSession()` localStorage helpers, and `isMockUser()` sentinel check. The file's own header says *"This entire file (`src/lib/auth/mock-auth.ts`) can be deleted once production authentication (Google via Supabase) is implemented."* — and production auth IS implemented (the AuthProvider uses Supabase Google OAuth). Yet the file remains, is imported by `auth-provider.tsx`, `login-screen.tsx`, and `env.ts`, and the `signInWithMock` function is exposed on the auth context. The DONE.md (line 97) claims *"No mock implementations remaining"* and TODO.md (line 4) claims *"zero mock implementations"* — both FALSE.
- **Where:** `/home/z/my-project/repos/elimtiyaz-website/src/lib/auth/mock-auth.ts` (entire file, 278 lines)
- **Lines:** `:1-278` (full file)
- **Category:** DEAD (also SEC — see SEC-007 for the security implications)
- **Severity:** High
- **Repo/Platform:** elimtiyaz-website (Website)
- **Original/canonical implementation (if duplicate):** N/A — the real implementation is the Supabase Google OAuth flow in `auth-provider.tsx` lines 87-184 (`loadProfile`).
- **Whether this duplicate is actually used:** Yes — `getMockSession` is called on every mount in `auth-provider.tsx:197`. `saveMockSession` is called by `signInWithMock` (line 271). `clearMockSession` is called by `signOut` (line 284). `isMockUser` is called on every mount (line 198).
- **What depends on it:** The `signInWithMock` exposed on the auth context, the `isMockSession` state, the mock hydration in `useEffect`.
- **Other platforms/layers affected:** N/A — website-only.
- **Behavioral differences:** The mock session bypasses Google OAuth, Supabase Auth, RLS (mock IDs don't match real rows so no data leak), and the `user_profiles.status` gate. It grants 50 staff-grade permissions that the parent portal doesn't even use (the portal has no admin UI).
- **Confidence:** Confirmed
- **Git evidence:** `mock-auth.ts` introduced in commit `89cc19d` "fkniga" (2026-08-01 17:39). DONE.md and TODO.md updated in the same commit to claim "zero mock implementations" — directly contradicting the file's existence. The latest commit `03f6365` (2026-08-28) did NOT delete the file.
- **Likely root cause:** The DONE.md/TODO.md iteration-4 audit claimed to have deleted `src/lib/dev-mock.ts` (the iter-3 mock) but missed `src/lib/auth/mock-auth.ts` (a separate, larger mock added in the same commit that claimed to remove mocks). The "fkniga" commit added both the new mock AND the claim that mocks were removed.
- **Potential impact:** A 278-line attack surface (the mock auth system) ships to production. Even if the visible button is hidden (per REG-003), the underlying hydration (SEC-007) remains. The DONE.md/TODO.md false claims mislead reviewers and security auditors who would trust the "zero mock" assertion.
- **Code snippet:**
```ts
// mock-auth.ts:1-10 — the file's own header says it should be deleted
/**
 * TEMPORARY MOCK AUTHENTICATION — DEVELOPMENT & TESTING ONLY
 * ⚠️  WARNING: This module is a TEMPORARY mock authentication system
 *     intended ONLY for development and testing. It must NEVER be used
 *     in production.
 * Removal:
 *   - This entire file (`src/lib/auth/mock-auth.ts`) can be deleted once
 *     production authentication (Google via Supabase) is implemented.
// ... 268 more lines of mock admin data + session helpers ...
// DONE.md line 97: "✅ No mock implementations remaining" ← FALSE
```

### FINDING CROSS-009 — Website's `bind-activation-code` Edge Function is a drifted duplicate of the desktop's canonical version (no shared helpers, no audit log, different body key handling)

- **What:** The website has its own `supabase/functions/bind-activation-code/index.ts` (216 lines) that is a STANDALONE, OLDER, less-featured duplicate of the desktop's canonical version (133 lines). Differences: (1) Website's version has inline CORS headers, inline Supabase client construction, inline JWT verification — desktop's version uses shared `_shared/cors.ts` (`corsHeaders`, `handleOptions`, `jsonError`, `jsonOk`) and `_shared/supabase.ts` (`createServiceRoleClient`, `extractAuthContext`, `writeAuditLog`). (2) Website's version reads ONLY `body.code` (line 105: `let body: { code?: string }`); desktop's version reads BOTH `body.activation_code ?? body.code` (line 67). (3) Website's version has NO audit log write; desktop's version writes `activation_code.bind` audit log via `writeAuditLog` (lines 108-124). (4) Website's version has DIFFERENT business logic (activates the user — see BUSINESS-008); desktop's version does not. Per the desktop audit's CROSS-004, the desktop's version is canonical.
- **Where:** `/home/z/my-project/repos/elimtiyaz-website/supabase/functions/bind-activation-code/index.ts` (entire file)
- **Lines:** `:34-46` (inline imports + CORS), `:104-122` (single-key body parsing), `:174-205` (unique activation logic), `:1-216` (entire file vs desktop's `:1-133`)
- **Category:** CROSS (also DUP — drifted duplicate)
- **Severity:** High
- **Repo/Platform:** elimtiyaz-website (Backend Edge Function) ↔ elimtiyaz-desktop (Backend Edge Function)
- **Original/canonical implementation (if duplicate):** Desktop's `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/functions/bind-activation-code/index.ts` is canonical (per CROSS-004: uses shared helpers, accepts both body keys, writes audit logs, has the vault §02.08 cross-platform compatibility comment).
- **Whether this duplicate is actually used:** The website's local copy is deployed ONLY IF the website team runs `supabase functions deploy bind-activation-code` from the website repo. If the desktop team deploys from the desktop repo (which has the canonical version), the website's local copy is dead code. Either way, ONE of them is dead — and they have different behavior (BUSINESS-008).
- **What depends on it:** The website's `activation-code-screen.tsx` calls `/functions/v1/bind-activation-code` and expects the response to include `parent_full_name` and `student_count` (it doesn't check). The desktop's `parent-detail-drawer.tsx` calls the same endpoint with `activation_code` body key.
- **Other platforms/layers affected:** Desktop (`parent-detail-drawer.tsx` sends `activation_code`), Android (also sends `activation_code`). If the website's version is deployed, desktop/Android calls fail (because `body.code` is undefined → `code = ""` → regex fails → 400).
- **Behavioral differences:** See BUSINESS-008 for the activation-logic divergence. Additionally: the website's version doesn't write an audit log (so binds are invisible in the audit trail), and doesn't use the shared helpers (so any future fix to `_shared/supabase.ts` wouldn't propagate to the website's version).
- **Confidence:** Confirmed (verified via `diff` — 2/3 of lines differ)
- **Git evidence:** Website's version introduced in commit `e90dbf7` "mid" (2026-08-01). Desktop's version is more recent (per CROSS-004, the dual-key patch was in commit `2e2b21a` 2026-08-28). The website's local copy was never reconciled with the desktop's canonical version.
- **Likely root cause:** The two Edge Functions were written independently by different teams/agents. The website's version was written first (2026-08-01) for the Path A self-service activation flow. The desktop's version was written/refactored later with shared helpers, the dual-key compatibility patch, and audit logging. Neither team noticed the other's version.
- **Potential impact:** Depending on which version is deployed, EITHER the desktop/Android activation flows break (website version, doesn't accept `activation_code`) OR the website's Path A activation flow doesn't actually activate the user (desktop version, no activation logic). The audit trail is inconsistent (desktop version logs, website version doesn't).
- **Code snippet:**
```ts
// WEBSITE bind-activation-code/index.ts:34-46 — standalone, no shared helpers
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", ... };  // inline

// DESKTOP bind-activation-code/index.ts:27-39 — uses shared helpers
import { corsHeaders, handleOptions, jsonError, jsonOk } from "../_shared/cors.ts";
import { createServiceRoleClient, extractAuthContext, writeAuditLog } from "../_shared/supabase.ts";
interface BindCodeRequest {
  activation_code?: string;  // ← desktop/Android send this
  code?: string;             // ← website sends this
}
```

### FINDING CROSS-010 — Migration numbering conflict: website 0025-0028 collide with desktop 0025-0028 (canonical chain); website's 0025 was rewritten to ASSUME desktop's 0027 already ran

- **What:** The website's `supabase/migrations/` folder has `0025_device_tokens.sql`, `0026_attendance_justification_columns.sql`, `0027_portal_parent_rls_policies.sql`, `0028_notification_preferences.sql`. The desktop's `supabase/migrations/` folder has `0025_waterfall_allocation.sql`, `0026_unified_financial.sql`, `0027_shared_unification.sql`, `0028_shared_schema_extensions.sql`. The migration VERSION NUMBERS COLLIDE. The website's 0025 was REWRITTEN (per its own header comment) to assume the canonical desktop 0027 has already run: *"The canonical backend chain (desktop repo, migration 0027_shared_unification.sql) already defines `public.device_tokens` with `user_id` — so on any database provisioned from the canonical chain this migration's CREATE TABLE IF NOT EXISTS was a no-op and every subsequent statement FAILED with 'column user_profile_id does not exist'."* The website's migrations are now idempotent patches that "collapse to no-ops when applied after" the desktop's 0043_portal_alignment.sql (which absorbed them). The README (line 51) STILL says *"A Supabase project with the migrations from the desktop repo applied (0001–0024)"* — out of date; the website now requires at least desktop's 0027 + 0037 + 0043.
- **Where:** `/home/z/my-project/repos/elimtiyaz-website/supabase/migrations/0025_device_tokens.sql:1-33` (rewrite note) + `0026-0028` (the other three patches)
- **Lines:** 0025 `:1-33` (rewrite note documenting the collision); README `:51` (stale prerequisite)
- **Category:** CROSS (same as desktop CROSS-001 — confirmed from the website side)
- **Severity:** High
- **Repo/Platform:** elimtiyaz-website (Backend migrations) ↔ elimtiyaz-desktop (Backend migrations 0025-0028 + 0043)
- **Original/canonical implementation (if duplicate):** Desktop's 0043_portal_alignment.sql is canonical (absorbs the website's 0025-0028 patches into the desktop chain with proper version numbers). The website's 0025-0028 are now redundant local copies.
- **Whether this duplicate is actually used:** The website's 0025-0028 are "reference migrations" per DONE.md line 67: *"All four are reference migrations — apply them with `supabase db push` or paste into the SQL Editor."* — but applying them via `supabase db push` would attempt to insert versions 0025-0028 into `supabase_migrations.schema_migrations`, which already exist from the desktop's chain, so they'd be SKIPPED. The actual schema changes only land if the desktop's 0043 is applied first.
- **What depends on it:** The website's RLS policies for parents (0027), notification preferences table (0028), attendance justification columns (0026), and device_tokens.user_agent (0025) all depend on the desktop's 0043 being applied.
- **Other platforms/layers affected:** Desktop's 0043_portal_alignment.sql (1.1KB header documenting the collision resolution). Android's `supabase/migrations/` (partial copy 0034-0036, 0040-0042 per desktop CROSS-003 — does NOT include 0043, so Android's database setup also depends on the desktop's 0043).
- **Behavioral differences:** Pre-rewrite (website's original 0025): created `device_tokens` with `user_profile_id` column (broke against canonical schema). Post-rewrite: only adds `user_agent` column to the canonical table. The website's 0025-0028 are now no-ops if applied after desktop's 0043.
- **Confidence:** Confirmed
- **Git evidence:** Website's 0025 rewrite was in commit `03f6365` "fix(portal): canonical pending-waterfall capacity + idempotent portal patches" (2026-08-28). Desktop's 0043_portal_alignment.sql was in commit `2e2b21a` (2026-08-28, same day). Both were the response to the collision discovery.
- **Likely root cause:** The website was built with its own migration numbering 0025-0028 (assuming it would be applied AFTER desktop's 0001-0024). The desktop's chain meanwhile extended to 0025-0028 (and beyond to 0043). The collision was discovered during the cross-platform equivalence review on 2026-08-28, and both repos got patches in the same day: desktop's 0043 absorbs the website's patches; website's 0025-0028 are made idempotent.
- **Potential impact:** A new operator following the website's README would apply ONLY the website's 0025-0028 and get a broken database (missing the canonical device_tokens table). The README prerequisite "0001-0024" is wrong; it should be "0001-0043" (the full desktop chain). The migration runner's behavior with duplicate version numbers is undefined — operators who run `supabase db push` from BOTH repos would silently skip the second set.
- **Code snippet:**
```sql
-- 0025_device_tokens.sql:6-23 — rewrite note documenting the collision
-- REWRITE NOTE (cross-platform equivalence finding W-0025-SCHEMA):
-- The original version of this migration CREATEd a `device_tokens` table
-- with a `user_profile_id` column. The canonical backend chain (desktop
-- repo, migration 0027_shared_unification.sql) already defines
-- `public.device_tokens` with `user_id` — so on any database provisioned
-- from the canonical chain this migration's CREATE TABLE IF NOT EXISTS was
-- a no-op and every subsequent statement (unique index + RLS policies on
-- `user_profile_id`) FAILED with "column user_profile_id does not exist".
-- This patch therefore only adds the portal-specific `user_agent` column.
```

### FINDING WEAK-016 — `useHomeworkRealtime` subscribes to the LEGACY `homework_assignments` table with a `target_class_id` filter; the canonical table is `homework` (migration 0029) using `class_id` — realtime is silently broken

- **What:** The `useHomeworkRealtime` hook subscribes to Supabase Realtime `postgres_changes` events on table `homework_assignments` filtered by `target_class_id=eq.${classId}`. But: (1) the canonical homework table is `homework` (created by desktop migration 0029_academics_module.sql:95 `CREATE TABLE IF NOT EXISTS public.homework`) — the legacy `homework_assignments` table (from migration 0004) is *"no longer written by any platform"* per the website's own `database.ts:558-562` comment; (2) the canonical `homework` table uses the column `class_id`, NOT `target_class_id` (which was the legacy column name). The `useHomeworkForClass` data hook (portal-queries.ts:178) queries the CORRECT table (`homework`) but the realtime hook subscribes to the WRONG table with the WRONG column. No realtime events ever fire → the homework view NEVER receives live updates when staff pushes new homework.
- **Where:** `/home/z/my-project/repos/elimtiyaz-website/src/lib/hooks/use-realtime.ts:133-145`
- **Lines:** `:138` (table name `homework_assignments`), `:141` (filter `target_class_id=eq.${classId}`), `:139` (query key prefix `[["homework", classId]]` — points at the canonical hook)
- **Category:** WEAK
- **Severity:** High
- **Repo/Platform:** elimtiyaz-website (Website)
- **Original/canonical implementation (if duplicate):** N/A — this is a unique bug.
- **Whether this duplicate is actually used:** Yes — `homework-view.tsx:49` calls `useHomeworkRealtime(activeKid?.class_id ?? null)`. The hook runs but never fires.
- **What depends on it:** The homework view's realtime freshness. Currently it only refreshes on page reload or window-focus-refetch (which is OFF globally per providers/index.tsx:26 — `refetchOnWindowFocus: false`).
- **Other platforms/layers affected:** None directly, but the desktop's homework-push flow writes to `homework` (canonical) — so the website's subscription on `homework_assignments` would never see those writes.
- **Behavioral differences:** Other realtime hooks (`useNotificationsRealtime`, `useChatMessagesRealtime`, `useFinancialRealtime`) correctly subscribe to their canonical tables. Only `useHomeworkRealtime` is broken.
- **Confidence:** Confirmed
- **Git evidence:** The hook was written in commit `e90dbf7` "mid" (2026-08-01) when the schema was still assumed to be `homework_assignments` (legacy). The canonical `homework` table migration (0029) was already in the desktop repo, but the website's hook was not updated when the website's `useHomeworkForClass` was corrected to query `homework` (in the same commit `e90dbf7`, per the database.ts comment).
- **Likely root cause:** The author updated `useHomeworkForClass` to use the canonical `homework` table but forgot to update the parallel `useHomeworkRealtime` hook. The queryKey prefix was updated (to `["homework", classId]`) but the table name and filter column were not.
- **Potential impact:** When a teacher pushes new homework from the desktop, the parent's homework view does NOT update in realtime. The parent would only see the new homework on the next page reload. The TODO.md verification item *"Test realtime: open two tabs, trigger a staff action → parent tab updates instantly"* would fail for homework.
- **Code snippet:**
```ts
// use-realtime.ts:136-145 — wrong table, wrong filter column
export function useHomeworkRealtime(classId: string | null | undefined) {
  useRealtimeInvalidation(
    "homework_assignments",         // ← LEGACY table (canonical is "homework")
    [["homework", classId]],        // ← correct query key (matches useHomeworkForClass)
    {
      filter: classId ? `target_class_id=eq.${classId}` : undefined,  // ← wrong column (canonical uses class_id)
      enabled: Boolean(classId),
    }
  );
}
// COMPARE: useHomeworkForClass (portal-queries.ts:178) queries "homework" with .eq("class_id", classId)
```

### FINDING DEAD-012 — `vitest.config.ts` references `./src/test/setup.ts` which DOES NOT EXIST; DONE.md and worklog.md both claim it was created

- **What:** The `vitest.config.ts` file at line 8 configures `setupFiles: ["./src/test/setup.ts"]` — but the file `src/test/setup.ts` does NOT exist in the repo (verified via `find` — no `src/test/` directory, no `setup.ts` file anywhere). The DONE.md (line 138) claims *"├── test/setup.ts # NEW — Vitest + RTL setup (was missing in iter 3)"* and the website's own worklog.md (line 178) claims *"Created src/test/setup.ts (was missing — vitest.config.ts referenced it but the file didn't exist)"* — both FALSE. The latest commit message `03f6365` claims *"vitest 87/87"* but if the setup file is missing, vitest would either error with "Cannot find module" or skip the polyfills (matchMedia, IntersectionObserver, ResizeObserver) that tests may depend on.
- **Where:** `/home/z/my-project/repos/elimtiyaz-website/vitest.config.ts:8` (references the file); `/home/z/my-project/repos/elimtiyaz-website/src/test/setup.ts` (DOES NOT EXIST)
- **Lines:** vitest.config.ts `:8` — `setupFiles: ["./src/test/setup.ts"]`
- **Category:** DEAD (also WEAK — broken test infra)
- **Severity:** High
- **Repo/Platform:** elimtiyaz-website (Website)
- **Original/canonical implementation (if duplicate):** N/A
- **Whether this duplicate is actually used:** The vitest.config.ts IS used (`bun run test` → `vitest run` → reads vitest.config.ts). The setup.ts is referenced but missing.
- **What depends on it:** The 87 tests across 5 test files. If vitest 4.x throws on missing setup files, `bun run test` would fail entirely. If vitest 4.x silently skips missing setup files, the tests run without polyfills — tests that depend on `matchMedia`/`IntersectionObserver` would fail.
- **Other platforms/layers affected:** N/A
- **Behavioral differences:** Pre-bug (claimed): 68 tests passing with polyfills. Actual: 87 tests, setup file missing, polyfills undefined.
- **Confidence:** Confirmed (verified: `find /home/z/my-project/repos/elimtiyaz-website -name 'setup*'` returns nothing; `git log --all -- src/test/setup.ts` returns nothing — the file was NEVER committed)
- **Git evidence:** The vitest.config.ts was introduced in commit `e90dbf7` "mid" (2026-08-01) with the `setupFiles` reference. The DONE.md and worklog.md claims were in the SAME commit. The latest commit `03f6365` (2026-08-28) added 19 new tests but did NOT create the setup file.
- **Likely root cause:** The author wrote the vitest.config.ts with the intent to create the setup file, wrote the DONE.md/worklog.md entries claiming it was created, but forgot to actually `git add` the file. The setup file claim is a documentation lie. Alternatively, the file was created locally but never committed.
- **Potential impact:** `bun run test` may fail or skip polyfills. The "87/87 tests passing" claim in the latest commit message is unverifiable. If the CI runs `bun run test`, it may break. The DONE.md/TODO.md verification claims are untrustworthy.
- **Code snippet:**
```ts
// vitest.config.ts:8 — references a non-existent file
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],  // ← FILE DOES NOT EXIST
    include: ["src/**/*.test.{ts,tsx}"],
    // ...
  },
});
// DONE.md:138: "├── test/setup.ts # NEW — Vitest + RTL setup (was missing in iter 3)" ← FALSE
// worklog.md:178: "Created src/test/setup.ts (was missing — vitest.config.ts referenced it but the file didn't exist)" ← FALSE
```

### FINDING ARCH-005 — `next.config.ts` has `typescript.ignoreBuildErrors: true` AND `reactStrictMode: false` — type errors silently shipped to production, React strict-mode bugs hidden

- **What:** The Next.js config sets `typescript.ignoreBuildErrors: true` (line 6) which means `next build` will SUCCEED even if `tsc` reports type errors. Combined with `reactStrictMode: false` (line 8), the portal ships to production with: (a) no compile-time type safety guarantee; (b) React's strict-mode development checks (which surface double-render bugs, missing cleanup, etc.) disabled. The README claims the portal is production-ready with zero TypeScript errors, but the build config means type errors wouldn't be caught even if they existed.
- **Where:** `/home/z/my-project/repos/elimtiyaz-website/next.config.ts:5-8`
- **Lines:** `:5-7` (typescript.ignoreBuildErrors), `:8` (reactStrictMode)
- **Category:** ARCH
- **Severity:** Medium
- **Repo/Platform:** elimtiyaz-website (Website)
- **Original/canonical implementation (if duplicate):** N/A
- **Whether this duplicate is actually used:** Yes — `next build` uses this config.
- **What depends on it:** Every production build. The `output: "standalone"` (line 4) + `ignoreBuildErrors: true` means the standalone server bundle ships without type checking.
- **Other platforms/layers affected:** N/A
- **Behavioral differences:** With `ignoreBuildErrors: false` (the default): `next build` fails on type errors. With `ignoreBuildErrors: true`: build succeeds silently. With `reactStrictMode: true` (the default): React double-invokes render/effects in dev to surface bugs. With `false`: bugs that would be caught by strict mode (e.g., useEffect with missing cleanup, side effects in render) are hidden.
- **Confidence:** Confirmed
- **Git evidence:** next.config.ts introduced in commit `aebc58d` "first commit" (2026-07-31). Never modified.
- **Likely root cause:** The author set `ignoreBuildErrors: true` to unblock a build that had type errors (rather than fixing the errors). `reactStrictMode: false` was likely set to suppress double-render warnings during development. Both are anti-patterns that ship to production.
- **Potential impact:** Type errors silently accumulate. A future PR that introduces a type error would pass CI and ship to production. React strict-mode bugs (e.g., stale closures, missing effect cleanup) would not be caught in development.
- **Code snippet:**
```ts
// next.config.ts:3-8
const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,  // ← silences tsc errors at build time
  },
  reactStrictMode: false,     // ← disables React's strict-mode dev checks
  // ...
};
```

### FINDING DRIFT-009 — Canonical engine port ships ~20 calc files but only ~6 functions are used; `canonical/index.ts` barrel is never imported

- **What:** The latest commit `03f6365` added a 26-file "canonical engine port" under `src/lib/canonical/` (model files + calc/ledger/* + calc/payment/* + calc/pricing/* + calc/shared/* + portal-derive.ts + portal-derive.test.ts + index.ts). The port is a "byte-identical port of the desktop canonical implementation" per each file's header. However, the ONLY consumer is `portal-derive.ts` (which uses `computeParentSummary`, `buildOverdueDueDateMap`, `computeSubjectAverage`, `computeOverallGpa`, `calculateAttendanceRate`, `clampNonNegative`). The remaining ~20 functions are DEAD CODE in the website context: `allocatePaymentToInstallments`, `isOverpayment`, `computeAccountBalance`, `replayParentLedger`, `balanceForAccount`, `totalOutstandingAcrossAccounts`, `maxDaysOverdueFromLedger`, and all of `calc/payment/{lifo-reversal,clearance,queries,sums,revenue}.ts`, `calc/ledger/{entries,charges,account-id}.ts`, `calc/pricing/{discount-engine,discount-rules,transport,tuition}.ts`, `calc/shared/dates.ts`. The `canonical/index.ts` barrel (27 lines, 23 `export *`) is NEVER imported by any file outside the canonical folder.
- **Where:** `/home/z/my-project/repos/elimtiyaz-website/src/lib/canonical/` (entire folder, 26 files)
- **Lines:** `canonical/index.ts:1-27` (barrel — never imported); `portal-derive.ts:24-27` (the ONLY legitimate consumer)
- **Category:** DRIFT (also DEAD — most of the port is dead code in the website context)
- **Severity:** Medium
- **Repo/Platform:** elimtiyaz-website (Website) ↔ elimtiyaz-desktop (canonical source)
- **Original/canonical implementation (if duplicate):** Desktop's `src/domain/calc/*` is the canonical source. The website's `src/lib/canonical/calc/*` is a verbatim port.
- **Whether this duplicate is actually used:** ~6 functions are used (via portal-derive.ts). The remaining ~20 functions and the index.ts barrel are dead code. The barrel's `export *` lines are technically "used" only if someone imports from `@/lib/canonical` — but no one does (verified via grep).
- **What depends on it:** `portal-derive.ts` → `financial-view.tsx`, `dashboard-view.tsx`, `academic-view.tsx`, `bulletin.ts` (the consumers of portal-derive).
- **Other platforms/layers affected:** The desktop's full canonical engine is used by the desktop's debt dashboard, payment modal, reconcile, etc. The website only needs the read-side computation (parent summary, GPA, attendance rate) — it's a view-only parent portal.
- **Behavioral differences:** N/A (dead code doesn't behave).
- **Confidence:** Confirmed (verified: `grep -rln "from \"@/lib/canonical\"" src/` returns 0 matches; `grep` for each canonical function name outside the canonical folder returns 0-1 matches, with only `calculateAttendanceRate` having 1 match — portal-derive.ts)
- **Git evidence:** The entire canonical port was added in commit `03f6365` (2026-08-28) — the latest commit. The port was added as a "byte-identical" copy without trimming to the website's actual needs.
- **Likely root cause:** The author copied the desktop's entire `src/domain/calc/` tree to ensure cross-platform equivalence, but didn't prune the unused functions. The website doesn't collect payments (it's a view-only parent portal), so the entire `calc/payment/` and `calc/pricing/` subtrees are unnecessary. The port is over-inclusive.
- **Potential impact:** Maintenance burden — any future change to the desktop's canonical engine must be re-ported to the website's canonical folder, even for functions the website doesn't use. The dead code increases bundle size. The `port-canonical.mjs` script (referenced but missing — see DEAD-011) was supposed to automate this but doesn't exist.
- **Code snippet:**
```ts
// canonical/index.ts:5-27 — barrel that NO ONE imports
export * from "./model/payment";
export * from "./model/ledger";
export * from "./model/student";
export * from "./model/pricing";
// ... 19 more export * lines ...
export * from "./calc/pricing/transport";

// portal-derive.ts:24-27 — the ONLY legitimate consumer, imports directly
import { computeParentSummary } from "./calc/ledger/balance";
import { buildOverdueDueDateMap } from "./calc/ledger/overdue";
import { computeSubjectAverage, computeOverallGpa, calculateAttendanceRate } from "./model/academic";
import { clampNonNegative } from "./calc/shared/money";
// ← 6 functions used; ~20 functions + the barrel are dead
```

### FINDING DEAD-011 — `scripts/port-canonical.mjs` referenced by every canonical engine file's header DOES NOT EXIST

- **What:** Every file in `src/lib/canonical/calc/` has a header comment that says *"CANONICAL ENGINE PORT (website) — byte-identical port of the desktop canonical implementation. DO NOT edit by hand: re-run `scripts/port-canonical.mjs` from the repo root instead."* — but the script `scripts/port-canonical.mjs` does NOT exist (verified via `find` — the only file in `scripts/` is `generate-pwa-icons.py`). The comment is a lie: the port was hand-copied, not auto-generated. Future maintainers who try to re-run the script to refresh the port would discover it doesn't exist.
- **Where:** `/home/z/my-project/repos/elimtiyaz-website/src/lib/canonical/calc/ledger/balance.ts:2-8` (and every other file in `src/lib/canonical/calc/`)
- **Lines:** `:4` — `"DO NOT edit by hand: re-run scripts/port-canonical.mjs from the repo root instead."`
- **Category:** DEAD
- **Severity:** Medium
- **Repo/Platform:** elimtiyaz-website (Website)
- **Original/canonical implementation (if duplicate):** N/A — the script is referenced but never existed.
- **Whether this duplicate is actually used:** No — the script doesn't exist.
- **What depends on it:** Nothing — the comment is misleading documentation.
- **Other platforms/layers affected:** N/A
- **Behavioral differences:** N/A
- **Confidence:** Confirmed (verified: `find /home/z/my-project/repos/elimtiyaz-website/scripts/ -name 'port-canonical*'` returns nothing)
- **Git evidence:** The header comment was added in commit `03f6365` (2026-08-28) when the canonical port was introduced. The script was never created.
- **Likely root cause:** The author intended to write a port script (to automate keeping the website's canonical folder in sync with the desktop's), wrote the header comments assuming the script would exist, but never actually wrote the script. The "byte-identical port" was done manually (or via a one-off inline script that wasn't saved).
- **Potential impact:** When the desktop's canonical engine changes, a maintainer would look at the header, try to run `scripts/port-canonical.mjs`, find it missing, and either hand-copy again (error-prone) or skip the re-port (causing drift). The misleading comment also claims the port is "byte-identical" and "Equivalence: verified by cross-platform-equivalence suite" — but without the script, there's no automated verification.
- **Code snippet:**
```ts
// src/lib/canonical/calc/ledger/balance.ts:1-8 — header referencing non-existent script
/**
 * CANONICAL ENGINE PORT (website) — byte-identical port of the desktop
 * canonical implementation. DO NOT edit by hand: re-run
 * scripts/port-canonical.mjs from the repo root instead.   ← SCRIPT DOES NOT EXIST
 * Source: elimtiyaz-desktop/src/domain/calc/ledger/balance.ts
 * Source sha256 (first 12): 23a667fac843
 * Equivalence: verified by cross-platform-equivalence suite.
 */
```

### FINDING WEAK-017 — Typed `Database` interface has `homework_assignments` (legacy 0004) but NOT `homework` (canonical 0029) — queries use `as unknown as` cast, no type-checking

- **What:** The typed `Database` interface in `src/lib/types/database.ts:851` declares `homework_assignments: { Row: HomeworkAssignmentRow; ... }` (the legacy table from migration 0004) but does NOT declare `homework` (the canonical table from migration 0029). The `useHomeworkForClass` hook (portal-queries.ts:178) queries `.from("homework")` (the canonical table) and casts the result with `as unknown as HomeworkRow[]` — bypassing type-checking. The `HomeworkAssignmentRow` type (database.ts:583-596) is dead — defined and registered in the Database interface but never queried by any hook. The `HomeworkRow` type (database.ts:564-581) is the canonical shape but is NOT registered in the Database interface.
- **Where:** `/home/z/my-project/repos/elimtiyaz-website/src/lib/types/database.ts:557-596` (both homework types) + `:851` (Database.Tables entry)
- **Lines:** `:557-581` (HomeworkRow — canonical, used), `:583-596` (HomeworkAssignmentRow — legacy, dead), `:851` (Database entry for legacy table only)
- **Category:** WEAK (also DEAD — HomeworkAssignmentRow is dead)
- **Severity:** Medium
- **Repo/Platform:** elimtiyaz-website (Website)
- **Original/canonical implementation (if duplicate):** Desktop's migration 0029_academics_module.sql:95 `CREATE TABLE IF NOT EXISTS public.homework` is canonical.
- **Whether this duplicate is actually used:** `HomeworkRow` is used (via the cast). `HomeworkAssignmentRow` is dead (registered in Database but never queried).
- **What depends on it:** The typed Supabase client would reject `.from("homework")` queries at compile time (table not in Database.Tables) — but the `as unknown as HomeworkRow[]` cast silences this.
- **Other platforms/layers affected:** N/A
- **Behavioral differences:** The typed Database reflects the LEGACY schema (homework_assignments) rather than the CANONICAL schema (homework). Any future type-safe query against `homework` would be rejected by the type system.
- **Confidence:** Confirmed
- **Git evidence:** The `HomeworkAssignmentRow` and Database entry were introduced in commit `e90dbf7` "mid" (2026-08-01). The `HomeworkRow` (canonical) was added in the same commit but never registered in the Database interface.
- **Likely root cause:** The author updated the `useHomeworkForClass` hook to query the canonical `homework` table but forgot to update the typed Database interface to match. The `as unknown as HomeworkRow[]` cast was used to silence the type error instead of fixing the root cause (registering the canonical table in the Database interface).
- **Potential impact:** No compile-time type safety on homework queries. A typo in a column name (e.g., `class_id` vs `target_class_id`) would not be caught. The dead `HomeworkAssignmentRow` type and Database entry mislead future maintainers into thinking the legacy table is still in use.
- **Code snippet:**
```ts
// database.ts:851 — Database interface has the LEGACY table only
homework_assignments: { Row: HomeworkAssignmentRow; Insert: ...; Update: ... };
// ↑ canonical `homework` table is NOT in the Database interface

// portal-queries.ts:178 — queries canonical table, casts to silence type error
let q = supabase
  .from("homework")  // ← canonical table, NOT in Database.Tables
  .select("*")
  .eq("class_id", classId)
  // ...
return (data ?? []) as unknown as HomeworkRow[];  // ← cast silences the type error
```

### FINDING WEAK-018 — Dashboard "next installment" KPI uses non-canonical `amount_due - amount_paid` (cleared-only); financial-view uses canonical `installmentRemainingAmount` (due - paid - pending) — cross-view inconsistency

- **What:** The dashboard's "next installment" KPI at line 192 displays `formatCurrency(nextInstallment.amount_due - nextInstallment.amount_paid)` — a CLEARED-ONLY remaining amount (ignores `amount_pending`). The financial-view's `InstallmentRowView` at line 272 uses `installmentRemainingAmount(inst)` which computes `clampNonNegative(amount_due - amount_paid - amount_pending)` — the CANONICAL INV-4 remaining (uncleared pending funds reduce what the parent owes). The dashboard IMPORTS `installmentRemainingAmount` (line 33) but NEVER CALLS IT — the import is dead. So the same parent, on the same day, sees TWO DIFFERENT "remaining" values for the same installment: a higher value on the dashboard (cleared-only), a lower value on the financial view (cleared - pending).
- **Where:** `/home/z/my-project/repos/elimtiyaz-website/src/features/dashboard/dashboard-view.tsx:33` (import) + `:192` (non-canonical inline formula)
- **Lines:** `:33` (dead import of `installmentRemainingAmount`), `:192` (`amount_due - nextInstallment.amount_paid` — cleared-only)
- **Category:** WEAK (also DEAD — the import is dead)
- **Severity:** Medium
- **Repo/Platform:** elimtiyaz-website (Website)
- **Original/canonical implementation (if duplicate):** `installmentRemainingAmount` in `portal-derive.ts:115-119` is canonical (matches the backend waterfall `amount_due - amount_paid - amount_pending` per migration 0034 and the Android `Installment.remaining`).
- **Whether this duplicate is actually used:** The dashboard's inline formula IS used (line 192). The imported `installmentRemainingAmount` is NOT used (dead import).
- **What depends on it:** The dashboard's "next installment" KPI card.
- **Other platforms/layers affected:** The desktop's debt dashboard uses the canonical remaining (per the desktop audit's DRIFT-006 / balance.ts:182). The website's dashboard diverges from both the canonical rule AND the website's own financial-view.
- **Behavioral differences:** Dashboard: `remaining = amount_due - amount_paid` (cleared-only). Financial-view: `remaining = amount_due - amount_paid - amount_pending` (canonical INV-4). If a parent has a 5000 DZD installment with 3000 paid + 1500 pending (uncleared check), the dashboard shows 2000 DZD remaining; the financial view shows 500 DZD remaining.
- **Confidence:** Confirmed
- **Git evidence:** The dashboard's inline formula was introduced in commit `e90dbf7` "mid" (2026-08-01). The `installmentRemainingAmount` import was added in commit `03f6365` (2026-08-28) when the canonical port was added — but the dashboard's inline formula was not refactored to use it.
- **Likely root cause:** The canonical port commit added the `installmentRemainingAmount` import to the dashboard (presumably intending to refactor the inline formula) but didn't actually replace the inline formula. The import is a leftover from an incomplete refactor.
- **Potential impact:** A parent paying 1500 DZD toward the 5000 DZD installment (with 3000 already paid + 1500 pending) would see "2000 DZD remaining" on the dashboard, pay the 1500, then see "500 DZD remaining" on the financial view — confusing. The parent might think their payment didn't apply.
- **Code snippet:**
```ts
// dashboard-view.tsx:33 — dead import
import {
  attendanceRatePercent,
  overallGpaFor,
  installmentRemainingAmount,  // ← imported but NEVER CALLED
  portalFinancialSummary,
} from "@/lib/canonical/portal-derive";

// dashboard-view.tsx:192 — non-canonical inline formula
value={nextInstallment ? formatCurrency(nextInstallment.amount_due - nextInstallment.amount_paid) : "—"}
//                                                                              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                                          cleared-only — ignores amount_pending

// financial-view.tsx:272 — canonical formula
const remaining = installmentRemainingAmount(inst);  // amount_due - amount_paid - amount_pending
```

### FINDING WEAK-019 — `attendance-view.tsx` computes attendance rate as `present / total` (excludes late); canonical rule (per portal-derive.ts) is `(present + late) / total` — dashboard uses canonical, attendance-view doesn't

- **What:** The attendance-view's `stats.rate` at line 81 computes `Math.round((out.present / out.total) * 100)` — counting ONLY `present` as attended, excluding `late`. The canonical `calculateAttendanceRate` (per `portal-derive.ts:197` comment: *"present + late count as attended"*) counts BOTH `present` AND `late` as attended. The dashboard-view (line 116) uses `attendanceRatePercent(attendance.data)` which calls the canonical `calculateAttendanceRate`. So the same parent sees: dashboard KPI = (present + late) / total × 100; attendance view KPI = present / total × 100. If a student has 18 present, 2 late, 0 absent → dashboard shows 100%, attendance view shows 90%.
- **Where:** `/home/z/my-project/repos/elimtiyaz-website/src/features/attendance/attendance-view.tsx:81`
- **Lines:** `:81` — `out.rate = out.total > 0 ? Math.round((out.present / out.total) * 100) : null;`
- **Category:** WEAK
- **Severity:** Medium
- **Repo/Platform:** elimtiyaz-website (Website)
- **Original/canonical implementation (if duplicate):** `attendanceRatePercent` in `portal-derive.ts:199-213` is canonical (calls `calculateAttendanceRate` which counts present + late as attended).
- **Whether this duplicate is actually used:** Yes — the attendance-view's `stats.rate` is displayed at line 102 (`hint={stats.rate !== null ? \`${stats.rate}%\` : undefined}`).
- **What depends on it:** The attendance-view's KPI card "Taux de présence".
- **Other platforms/layers affected:** The desktop's attendance view uses the canonical `calculateAttendanceRate` (per the desktop audit). The website's attendance-view diverges from both the canonical rule AND the website's own dashboard.
- **Behavioral differences:** Attendance-view: `rate = present / total`. Dashboard: `rate = (present + late) / total`. The attendance-view UNDERREPORTS the attendance rate (late counts as absent).
- **Confidence:** Confirmed
- **Git evidence:** The attendance-view's inline formula was introduced in commit `e90dbf7` "mid" (2026-08-01). The canonical `attendanceRatePercent` was added in commit `03f6365` (2026-08-28) — but the attendance-view was not refactored to use it (only the dashboard was).
- **Likely root cause:** The canonical port commit added `attendanceRatePercent` and refactored the dashboard to use it, but didn't refactor the attendance-view (which has its own inline rate computation). The attendance-view's comment at line 7-8 also says *"The portal CANNOT submit justifications"* — outdated (see DRIFT-010) — suggesting the file wasn't reviewed during the canonical port.
- **Potential impact:** A parent sees a lower attendance rate on the attendance view than on the dashboard. A student who is frequently late (but never absent) would see 100% on the dashboard and a lower rate on the attendance view — confusing.
- **Code snippet:**
```ts
// attendance-view.tsx:81 — non-canonical (present only)
out.rate = out.total > 0 ? Math.round((out.present / out.total) * 100) : null;

// portal-derive.ts:197 — canonical (present + late)
// "Canonical attendance rate (0..1, 2-dec rounding) — identical to the
//  desktop calculateAttendanceRate (present + late count as attended)."

// dashboard-view.tsx:116 — uses canonical
return attendanceRatePercent(attendance.data);
//  ↑ calls calculateAttendanceRate which counts present + late
```

### FINDING WEAK-022 — `useLedgerEntries` fetches with `.limit(500)`; `portalFinancialSummary` replays ONLY 500 entries — balance computation is WRONG for parents with > 500 ledger entries

- **What:** The `useLedgerEntries` hook (portal-queries.ts:344) fetches `ledger_entries` with `.limit(500)` (the `options.limit` default is 500 per the financial-view at line 103 and dashboard-view at line 95). The `portalFinancialSummary` function (portal-derive.ts:92-106) calls `parentSummaryFromLedger(rows, parentId, ...)` which calls `computeParentSummary(entries, ...)` which replays ALL `rows` to compute the balance. If a parent has > 500 ledger entries (charges + payments + adjustments + refunds + reversals + transfers over multiple years), the canonical balance computation only sees the FIRST 500 (ordered by `at ASC` per portal-queries.ts:343). The balance would be WRONG — missing the entries beyond the 500 limit. The desktop's `compute_parent_summary` SQL RPC has NO such limit (it queries the entire ledger).
- **Where:** `/home/z/my-project/repos/elimtiyaz-website/src/lib/hooks/portal-queries.ts:331-351` (useLedgerEntries) + `src/lib/canonical/portal-derive.ts:92-106` (portalFinancialSummary) + `src/features/financial/financial-view.tsx:103` (call site with `limit: 500`) + `src/features/dashboard/dashboard-view.tsx:95` (call site with `limit: 500`)
- **Lines:** portal-queries.ts `:344` (`q.limit(options.limit)`), financial-view.tsx `:103` (`{ limit: 500 }`), dashboard-view.tsx `:95` (`{ limit: 500 }`)
- **Category:** WEAK
- **Severity:** Medium
- **Repo/Platform:** elimtiyaz-website (Website)
- **Original/canonical implementation (if duplicate):** The desktop's `compute_parent_summary` SQL RPC (migration 0042) has no row limit — it replays the entire parent ledger.
- **Whether this duplicate is actually used:** Yes — every parent's balance KPI on the dashboard and financial-view.
- **What depends on it:** The "Solde à payer" (outstanding balance) KPI on both the dashboard and financial-view. The "Overdue" classification. The "Crédit en compte" (unallocated credit) KPI.
- **Other platforms/layers affected:** The desktop and SQL RPC compute the correct balance (no limit). The website's balance may diverge from the desktop's for parents with > 500 entries.
- **Behavioral differences:** Parent with 600 ledger entries: desktop/SQL shows the correct balance (replays all 600). Website shows a balance computed from only the first 500 entries (missing the latest 100 — but ordered by `at ASC`, so the OLDEST 500 are kept and the NEWEST 100 are dropped — meaning recent payments are missed, inflating the outstanding balance).
- **Confidence:** Likely (the limit IS 500; whether any parent has > 500 entries depends on the school's size and history)
- **Git evidence:** `useLedgerEntries` introduced in commit `03f6365` (2026-08-28) as part of the canonical port. The `limit: 500` was chosen to keep the payload reasonable but wasn't validated against the canonical rule that balances must replay the ENTIRE ledger.
- **Likely root cause:** The author added the ledger-replay balance computation (replacing the previous installment-sum approach) but kept the `.limit(500)` from the previous fetch pattern, not realizing that balance computation requires the FULL ledger. The canonical INV-1 rule states *"balances are NEVER stored, always replayed"* — but replaying only 500 entries violates this.
- **Potential impact:** For a parent with > 500 ledger entries (a long-tenured family with many installments, payments, adjustments), the website's balance KPI would be WRONG — likely showing a higher outstanding balance than reality (because recent payments are dropped). The parent might pay twice or contact the school thinking they owe more than they do.
- **Code snippet:**
```ts
// portal-queries.ts:331-351 — limit(500) on ledger fetch
export function useLedgerEntries(parentId, options: { limit?: number } = {}): UseQueryResult<LedgerEntryRow[]> {
  return useQuery({
    // ...
    queryFn: async () => {
      let q = supabase.from("ledger_entries").select("*").eq("parent_id", parentId)
        .order("at", { ascending: true });  // ← oldest first
      if (options.limit) q = q.limit(options.limit);  // ← drops newest 100 if > 500
      // ...
    },
  });
}

// financial-view.tsx:103 — limit: 500
const ledgerEntries = useLedgerEntries(parent?.id ?? null, { limit: 500 });

// portal-derive.ts:92-106 — replays ONLY the rows passed in (no awareness of the limit)
export function portalFinancialSummary(rows, parentId, now = new Date()): PortalFinancialSummary {
  const summary = parentSummaryFromLedger(rows, parentId, "", now);
  // ...
}
```

### FINDING WEAK-023 — `useUnreadChatCount` fetches 500 messages across ALL channels (no channel filter in query), counts client-side — comment claims "200 per channel"

- **What:** The `useUnreadChatCount` hook (portal-queries.ts:484-518) fetches up to 500 messages from `chat_messages` with NO channel filter in the query — it relies on RLS to return only messages from channels the user is a member of. Then it counts client-side how many are unread (author ≠ user AND no `read_by` entry for the user). The comment at lines 491-493 says *"We fetch the latest 200 messages per channel via a single query"* — but the actual query has `.limit(500)` TOTAL, not 200 per channel. The comment is wrong AND the approach is inefficient (loads messages from all channels, including ones the user doesn't care about) and incorrect (if total unread + read messages across all channels > 500, the count is wrong).
- **Where:** `/home/z/my-project/repos/elimtiyaz-website/src/lib/hooks/portal-queries.ts:484-518`
- **Lines:** `:491-493` (wrong comment), `:494-499` (query with `.limit(500)` and no channel filter), `:507-512` (client-side count)
- **Category:** WEAK
- **Severity:** Medium
- **Repo/Platform:** elimtiyaz-website (Website)
- **Original/canonical implementation (if duplicate):** N/A
- **Whether this duplicate is actually used:** Yes — the bottom-nav badge (bottom-nav.tsx) uses this count.
- **What depends on it:** The Messages tab badge on the bottom nav.
- **Other platforms/layers affected:** N/A
- **Behavioral differences:** Comment claims "200 per channel" but code does "500 total". The count is a lower bound (if > 500 messages exist, only the latest 500 are considered).
- **Confidence:** Confirmed
- **Git evidence:** The hook was introduced in commit `e90dbf7` "mid" (2026-08-01). The comment and the code have been inconsistent since then.
- **Likely root cause:** The author wrote the comment describing the intended behavior (200 per channel) but implemented a simpler version (500 total). The comment was never updated to match the implementation.
- **Potential impact:** For an active parent with many channels and > 500 total messages, the unread badge would undercount. The query also loads messages from ALL channels (even read ones), wasting bandwidth.
- **Code snippet:**
```ts
// portal-queries.ts:491-512 — comment vs implementation mismatch
// We fetch the latest 200 messages per channel via a single query —   ← WRONG COMMENT
// RLS limits this to channels the user is a member of. Then we count
// client-side how many have no read_by entry for this user.
const { data, error } = await supabase
  .from("chat_messages")
  .select("id, author_id, read_by, channel_id")
  .is("deleted_at", null)
  .order("sent_at", { ascending: false })
  .limit(500);  // ← 500 TOTAL, not 200 per channel; no channel filter
```

### FINDING DRIFT-010 — `attendance-view.tsx` comment says "The portal CANNOT submit justifications — that's a desktop workflow" but the code imports, renders, and wires the AbsenceJustificationDialog

- **What:** The attendance-view's header comment (lines 7-8) says: *"The portal CANNOT submit justifications — that's a desktop workflow. We only display the justification status (uploaded by staff or pending)."* But the code: (1) imports `AbsenceJustificationDialog` (line 28), (2) renders a "Justifier cette absence" button for any non-present record with `justification_status === "none"` (lines 162-170), (3) renders the dialog itself (lines 179-186). The comment is completely outdated — the portal DOES submit justifications (per DONE.md line 35: *"Absence justification status tracking — attendance records now display a 4-state status pill... The `submitted` state is set automatically by the parent's submit"*).
- **Where:** `/home/z/my-project/repos/elimtiyaz-website/src/features/attendance/attendance-view.tsx:7-8`
- **Lines:** `:7-8` (outdated comment), `:28` (dialog import), `:162-170` (button), `:179-186` (dialog render)
- **Category:** DRIFT
- **Severity:** Low
- **Repo/Platform:** elimtiyaz-website (Website)
- **Original/canonical implementation (if duplicate):** N/A
- **Whether this duplicate is actually used:** The comment is documentation; the code IS used.
- **What depends on it:** Developer understanding of the attendance-view's capabilities.
- **Other platforms/layers affected:** N/A
- **Behavioral differences:** Comment: portal can't submit. Code: portal CAN submit.
- **Confidence:** Confirmed
- **Git evidence:** The comment was written in commit `e90dbf7` "mid" (2026-08-01) when the portal didn't submit justifications. The dialog + button were added in the SAME commit (or a later iteration) but the comment was never updated.
- **Likely root cause:** The feature was added without updating the file's header comment. The DONE.md documents the feature but the source comment was forgotten.
- **Potential impact:** A future maintainer reading the comment would assume the portal can't submit justifications and might remove the dialog or fail to add related features.
- **Code snippet:**
```ts
// attendance-view.tsx:7-9 — outdated header comment
 * Per platform matrix: portal = "View Own" (read-only).
 * The portal CANNOT submit justifications — that's a desktop workflow. We
 * only display the justification status (uploaded by staff or pending).

// attendance-view.tsx:28 — dialog IS imported
import { AbsenceJustificationDialog } from "@/features/attendance/absence-justification-dialog";

// attendance-view.tsx:162-170 — button IS rendered
{canJustify && (
  <button onClick={() => setJustifyRecord(rec)} ...>
    <FileText className="h-3 w-3" />
    Justifier cette absence   ← the portal CAN submit justifications
  </button>
)}
```

### FINDING WEAK-020 — `paymentStatusTone` doesn't handle `cancelled` or `pending_clearance` statuses — renders the raw status string instead of a translated label

- **What:** The `paymentStatusTone` function in `status-pill.tsx:53-70` handles only `paid`, `partial`, `pending`, `unpaid`, `overdue`, `refunded`. The canonical `PaymentStatus` enum (per `portal-derive.ts:235-244`) has 8 values: `pending, partial, paid, overdue, refunded, cancelled, pending_clearance, unpaid`. The two missing statuses (`cancelled`, `pending_clearance`) fall through to the `default` case which returns `{ tone: "muted", key: status }` — passing the raw status string as the i18n key. The `t("cancelled")` call returns the literal string "cancelled" (no translation), and `t("pending_clearance")` returns "pending_clearance". So a cancelled payment renders a "cancelled" pill (English, untranslated) and a pending-clearance payment renders "pending_clearance" (raw enum value).
- **Where:** `/home/z/my-project/repos/elimtiyaz-website/src/features/shared/status-pill.tsx:53-70`
- **Lines:** `:53-70` (the switch), `:67-68` (the default case)
- **Category:** WEAK
- **Severity:** Low
- **Repo/Platform:** elimtiyaz-website (Website)
- **Original/canonical implementation (if duplicate):** The canonical `PaymentStatus` enum (portal-derive.ts:235-244) has 8 values.
- **Whether this duplicate is actually used:** Yes — `paymentStatusTone` is called by financial-view.tsx:275 for installment status pills.
- **What depends on it:** The financial-view's installment status pill rendering.
- **Other platforms/layers affected:** N/A
- **Behavioral differences:** `cancelled` and `pending_clearance` payments render with raw English enum values instead of translated French/Arabic labels.
- **Confidence:** Confirmed
- **Git evidence:** `status-pill.tsx` introduced in commit `e90dbf7` "mid" (2026-08-01). The canonical enum was formalized in commit `03f6365` (2026-08-28) but `paymentStatusTone` was not updated.
- **Likely root cause:** The author wrote `paymentStatusTone` based on the statuses they encountered in practice (paid, partial, pending, unpaid, overdue, refunded) and didn't handle the rarer `cancelled` / `pending_clearance` cases. The default fallback (`key: status`) renders the raw string, which is a silent UX bug.
- **Potential impact:** A parent viewing a cancelled or pending-clearance payment sees an English/raw-enum label instead of a translated one. Minor UX issue, but breaks i18n for Arabic/French parents.
- **Code snippet:**
```ts
// status-pill.tsx:53-70 — missing cancelled + pending_clearance cases
export function paymentStatusTone(status: string): { tone: StatusTone; key: string } {
  switch (status) {
    case "paid":         return { tone: "success", key: "finance.status.paid" };
    case "partial":      return { tone: "info", key: "finance.status.partial" };
    case "pending":      return { tone: "warning", key: "finance.status.pending" };
    case "unpaid":       return { tone: "muted", key: "finance.status.unpaid" };
    case "overdue":      return { tone: "danger", key: "finance.status.overdue" };
    case "refunded":     return { tone: "muted", key: "finance.status.refunded" };
    // ← NO case "cancelled"
    // ← NO case "pending_clearance"
    default:             return { tone: "muted", key: status };  // ← renders raw "cancelled"
  }
}
```

### FINDING DEAD-013 — `package.json` `icons:generate` script hardcodes path `/home/z/my-project/scripts/generate-pwa-icons.py` (OUTSIDE the repo) — broken on any other machine/CI

- **What:** The `icons:generate` npm script in `package.json:13` is `"python3 /home/z/my-project/scripts/generate-pwa-icons.py"` — an ABSOLUTE path pointing OUTSIDE the repo. The actual script is at `/home/z/my-project/repos/elimtiyaz-website/scripts/generate-pwa-icons.py` (verified via `ls scripts/`). Running `bun run icons:generate` on any machine where `/home/z/my-project/scripts/generate-pwa-icons.py` doesn't exist (i.e., any machine that isn't the original developer's) would fail with "No such file or directory". The script is also referenced in the README (line 147) as `scripts/generate-pwa-icons.py` (the CORRECT relative path), contradicting the package.json absolute path.
- **Where:** `/home/z/my-project/repos/elimtiyaz-website/package.json:13`
- **Lines:** `:13` — `"icons:generate": "python3 /home/z/my-project/scripts/generate-pwa-icons.py"`
- **Category:** DEAD (also ARCH — portability bug)
- **Severity:** Low
- **Repo/Platform:** elimtiyaz-website (Website)
- **Original/canonical implementation (if duplicate):** The actual script lives at `./scripts/generate-pwa-icons.py` (relative to repo root).
- **Whether this duplicate is actually used:** The script `icons:generate` is not in the README's "Quick Start" — it's an optional utility for regenerating PWA icons. But if anyone runs `bun run icons:generate`, it fails on any non-original-developer machine.
- **What depends on it:** PWA icon regeneration (optional, only needed if the source SVG changes).
- **Other platforms/layers affected:** N/A
- **Behavioral differences:** Original developer's machine: works (the absolute path exists). Any other machine: fails.
- **Confidence:** Confirmed
- **Git evidence:** The script path was added in commit `e90dbf7` "mid" (2026-08-01) when PWA icons were added. The absolute path was hardcoded (rather than `python3 ./scripts/generate-pwa-icons.py` or `python3 scripts/generate-pwa-icons.py`).
- **Likely root cause:** The author developed on the original machine where `/home/z/my-project/scripts/` existed (perhaps a shared scripts directory). They used the absolute path without considering portability. The relative path was used in README but not in package.json.
- **Potential impact:** CI/CD or any other developer running `bun run icons:generate` would see "python3: can't open file '/home/z/my-project/scripts/generate-pwa-icons.py': [Errno 2] No such file or directory". Minor — the script is optional.
- **Code snippet:**
```json
// package.json:13 — absolute path outside the repo
"icons:generate": "python3 /home/z/my-project/scripts/generate-pwa-icons.py"
//                                           ^^^^^^^^^^^^^^^^^^^^^^^^
//                                           should be "./scripts/" or "scripts/"

// README.md:147 — correct relative path
// scripts/
// └── generate-pwa-icons.py         # regenerates all PWA icons + screenshots from the SVG
```

### FINDING WEAK-021 — README claims "68 tests passing" and DONE.md claims "68/68" but the actual count is 87 (after commit 03f6365 added 19 new tests)

- **What:** The README (line 224) says *"Current status: 68 tests passing, 0 lint errors, build succeeds."* The DONE.md (line 93) says *"Tests: 68/68 passing (no new tests added — the new features are mostly UI and require Supabase; documented in TODO.md as a future enhancement)"*. The worklog.md (line 91-96) lists 4 test files totaling 68 tests. But the latest commit `03f6365` added a 5th test file `portal-derive.test.ts` with 19 new tests. The actual count is now 87 (verified: format.test.ts=23 + dictionary.test.ts=11 + validation.test.ts=22 + status-pill.test.ts=12 + portal-derive.test.ts=19 = 87). The commit message itself says *"vitest 87/87"* — confirming the count is 87, not 68. The README and DONE.md were not updated.
- **Where:** `/home/z/my-project/repos/elimtiyaz-website/README.md:224` + `/home/z/my-project/repos/elimtiyaz-website/DONE.md:93`
- **Lines:** README `:224`, DONE.md `:93`
- **Category:** WEAK
- **Severity:** Low
- **Repo/Platform:** elimtiyaz-website (Website)
- **Original/canonical implementation (if duplicate):** N/A
- **Whether this duplicate is actually used:** The docs are read by developers and reviewers.
- **What depends on it:** Trust in the project's verification claims.
- **Other platforms/layers affected:** N/A
- **Behavioral differences:** Docs: 68 tests. Reality: 87 tests.
- **Confidence:** Confirmed
- **Git evidence:** The README/DONE.md claims were written in commit `e90dbf7` "mid" (2026-08-01) when there were 4 test files. Commit `03f6365` (2026-08-28) added `portal-derive.test.ts` with 19 tests but did NOT update the README or DONE.md.
- **Likely root cause:** The canonical port commit added tests but didn't update the docs. The commit message correctly says "87/87" but the human-readable docs were forgotten.
- **Potential impact:** A reviewer trusting the docs would undercount the tests. Minor.
- **Code snippet:**
```
README.md:224:  "Current status: 68 tests passing, 0 lint errors, build succeeds."
DONE.md:93:     "✅ Tests: 68/68 passing (no new tests added — the new features are mostly UI...)"
                ↑ "no new tests added" is FALSE — 19 new tests were added in portal-derive.test.ts

Actual count (verified via grep -c "  it("):
  format.test.ts:        23
  dictionary.test.ts:    11
  validation.test.ts:    22
  status-pill.test.ts:   12
  portal-derive.test.ts: 19   ← NEW (added in 03f6365)
  TOTAL:                 87
```

### FINDING DEAD-014 — `database-schema.ts` barrel is imported by only ONE file (`supabase/client.ts`); all other 14 files import directly from `@/lib/types/database`

- **What:** The file `src/lib/types/database-schema.ts` (13 lines) is a barrel that re-exports everything from `./database`:
```ts
export * from "./database";
```
Its header comment (lines 3-11) says: *"Importing from this file lets feature modules do: `import type { ParentRow, StudentRow, Database } from "@/lib/types";` instead of reaching into the internal file."* But a grep for `from "@/lib/types"` (without `/database`) returns ZERO matches. All 14 files that import types use `from "@/lib/types/database"` directly. The ONLY file that imports from the barrel is `src/lib/supabase/client.ts:27` (`import type { Database } from "@/lib/types/database-schema";`). So the barrel pattern is inconsistently applied — 1 file uses it, 14 bypass it.
- **Where:** `/home/z/my-project/repos/elimtiyaz-website/src/lib/types/database-schema.ts` (the barrel) + `/home/z/my-project/repos/elimtiyaz-website/src/lib/supabase/client.ts:27` (the sole importer)
- **Lines:** database-schema.ts `:1-13`; client.ts `:27`
- **Category:** DEAD (the barrel is largely unused; also DRIFT — inconsistent import pattern)
- **Severity:** Low
- **Repo/Platform:** elimtiyaz-website (Website)
- **Original/canonical implementation (if duplicate):** The actual types live in `./database` (1009 lines).
- **Whether this duplicate is actually used:** Minimally — 1 importer out of 15.
- **What depends on it:** Only `supabase/client.ts`'s `Database` type import.
- **Other platforms/layers affected:** N/A
- **Behavioral differences:** The barrel adds an indirection layer that 14/15 importers don't use.
- **Confidence:** Confirmed (verified via `grep -rn "from \"@/lib/types" src/`)
- **Git evidence:** The barrel was introduced in commit `e90dbf7` "mid" (2026-08-01). The intent was to provide a clean import surface, but it was never adopted across the codebase.
- **Likely root cause:** The author created the barrel intending it to be the canonical import path, but other files were written (or refactored) to import directly from `./database`. The supabase/client.ts was the only file that adopted the barrel pattern.
- **Potential impact:** Minor maintenance confusion — a new developer might not know whether to import from `@/lib/types` or `@/lib/types/database`. The barrel adds a layer of indirection for no benefit.
- **Code snippet:**
```ts
// database-schema.ts — the barrel (13 lines)
/**
 * Re-export entry point for all database row types and the typed Database schema.
 * Importing from this file lets feature modules do:
 *   import type { ParentRow, StudentRow, Database } from "@/lib/types";
 * instead of reaching into the internal file.
 */
export * from "./database";

// supabase/client.ts:27 — the SOLE importer of the barrel
import type { Database } from "@/lib/types/database-schema";

// All 14 other files import directly, bypassing the barrel:
//   import type { ParentRow } from "@/lib/types/database";
//   import type { StudentRow, Database } from "@/lib/types/database";
//   ...
```

Stage Summary:
- 24 findings total (within the 15-25 target — exhaustive audit)
- Severity breakdown: Critical: 5 (SEC-007, SEC-008, WEAK-014, WEAK-015, BUSINESS-008), High: 6 (REG-003, DEAD-010, CROSS-009, CROSS-010, WEAK-016, DEAD-012), Medium: 8 (ARCH-005, DRIFT-009, DEAD-011, WEAK-017, WEAK-018, WEAK-019, WEAK-022, WEAK-023), Low: 5 (DRIFT-010, WEAK-020, DEAD-013, WEAK-021, DEAD-014)
- Top 5 critical issues:
  1. **SEC-007**: Mock-auth hydration runs unconditionally on every mount, bypassing `NEXT_PUBLIC_MOCK_AUTH_ENABLED` — anyone with localStorage write access can become a "Mock Administrator" with 50+ staff permissions including `admin.users.manage`, `finance.payments.refund`
  2. **SEC-008**: `enforce_parent_self_update_columns` trigger (migration 0027, copied to desktop 0043) has NO `has_role('parent')` check — fires for EVERY UPDATE to `parents`, blocking staff updates to first_name, last_name, parent_code, is_active, is_financially_restricted, deleted_at from the desktop's CRM
  3. **WEAK-014**: `send-push-notification` Edge Function queries `device_tokens` by `user_profile_id` (non-existent column) instead of canonical `user_id` — PostgREST 400 → 0 tokens → NO push notifications ever sent
  4. **WEAK-015**: Same Edge Function's PEM key parser strips only the END marker, leaving `-----BEGINPRIVATEKEY-----` in the base64 → `atob` throws → OAuth2 token minting fails → 500 on every push fan-out (doubly broken with WEAK-014)
  5. **BUSINESS-008**: Website's `bind-activation-code` Edge Function activates the user (sets `status='active'` + upserts `role_assignments`); the desktop's canonical version does NOT — depending on which Edge Function is deployed, EITHER the website's Path A activation flow is broken (user stays pending) OR the desktop/Android activation flows are broken (their `activation_code` body key is rejected by the website's version)
- Notable cross-repo links:
  - **SEC-008 ↔ Desktop**: The website's migration 0027 trigger bug propagated to desktop's 0043_portal_alignment.sql (verbatim copy). Both repos ship the broken trigger. The desktop's `SupabaseParentRepository.updateParent()` would fail against any database that has this trigger applied.
  - **CROSS-009 ↔ Desktop**: Website's `bind-activation-code` is a drifted duplicate of the desktop's canonical version (per desktop CROSS-004). The two have divergent body-key handling AND divergent business logic (BUSINESS-008).
  - **CROSS-010 ↔ Desktop**: Website's migration 0025-0028 collide with desktop's 0025-0028 (desktop CROSS-001 from the website side). Desktop's 0043_portal_alignment.sql absorbs the website's patches; the website's 0025-0028 are now redundant idempotent copies. The README's prerequisite "0001-0024" is wrong (should be 0001-0043).
  - **WEAK-014 ↔ Desktop/Android**: The website's `send-push-notification` is the ONLY push fan-out Edge Function in the 3-repo system. Its broken column name means NO platform (website, desktop, Android) receives push notifications. The Android `FcmTokenRegistrar` registers tokens via the same canonical `register_fcm_token` RPC, so Android tokens are in the same `device_tokens` table that the Edge Function queries with the wrong column.
  - **WEAK-016 ↔ Desktop**: The website's `useHomeworkRealtime` subscribes to the LEGACY `homework_assignments` table; the desktop's homework-push flow writes to the canonical `homework` table (migration 0029). The website's homework realtime is silently broken because it's listening on a table nobody writes to.
  - **WEAK-018 ↔ Desktop/Backend**: The website's dashboard uses a non-canonical "remaining" formula (cleared-only); the website's financial-view and the desktop/SQL backend use the canonical formula (cleared - pending). Three different "remaining" computations across the system.
  - **BUSINESS-008 ↔ Desktop/Android**: The website's `bind-activation-code` accepts only `body.code`; the desktop's version accepts both `body.code` and `body.activation_code` (per desktop CROSS-004). The desktop/Android clients send `activation_code`. If the website's version is deployed, desktop/Android activation flows break.
  - **WEAK-022 ↔ Desktop/Backend**: The website's `useLedgerEntries` has `.limit(500)`; the desktop's `compute_parent_summary` SQL RPC has no limit. For parents with > 500 ledger entries, the website's balance KPI diverges from the desktop's.


