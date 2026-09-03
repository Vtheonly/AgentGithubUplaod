# Cross-Platform Verification

> Purpose: prevent different implementations of the same business behaviour from silently diverging across Desktop, Android, Website and Backend. The financial/academic engines exist in four places (SQL RPCs, desktop TS, Android Kotlin, website port); equivalence is a first-class requirement, not a nice-to-have.

## 1. What must be equivalent

| Behaviour | Implementations that must agree | Canonical |
|---|---|---|
| Parent/student balance (ledger replay) | desktop `computeParentSummary`, SQL `compute_parent_summary` (0042), Android `LedgerEngine.computeParentSummary`, website `parentFinancialSummary` | desktop TS (reference) |
| Overdue classification + amount | same four | desktop TS (INV-4) |
| Waterfall allocation (given installments + payment + category) | SQL (inside canonical RPC), desktop `allocatePaymentToInstallments`, Android local allocator | SQL canonical RPC + desktop reference |
| Installment remaining | SQL, desktop, Android `Installment.remaining`, website `installmentRemainingAmount` | `amount_due − amount_paid − amount_pending` |
| Identity codes (PAR-/ELV-/activation) | desktop `id.ts`, Android `IdentityCodes.kt`, SQL import RPCs | deterministic FNV-1a (ADR-003) |
| Receipt numbering | SQL canonical generator only | server `REC-YYYY-NNNNNN` (ADR-004) |
| Attendance rate | desktop `calculateAttendanceRate`, Android, website portal-derive, bulletin/narrative views | `(present + late) / total` |
| GPA / subject averages | desktop `computeOverallGpa`/`computeSubjectAverage`, website port | desktop TS |
| Refund reversal state | SQL `revert_payment_allocation`, desktop refund flow, Android local refund + sync | SQL canonical RPC |

## 2. Canonical comparison strategy

1. **Shared scenario corpus** (`financial-tests/equivalence/scenarios/*.json`): each scenario = initial state (parents, students, installments, ledger entries) + operations (collect X, refund Y, clear Z) + expected invariants (balances, overdue flags, installment states, receipt sequence). One corpus feeds every runner (ADR-006). **Single framework since T-043 (2026-09-03):** the three retired trees (`scenarios/*.yml` — 8 never-read YAML files, `cross-platform-v2/` — an empty scaffold, `equivalence-live/` — a standalone live-DB pipeline never wired to run) and the stale `_tier4` Kotlin mirror were deleted; `financial-tests/equivalence/` is the ONLY framework. Live-DB verification is owned by the `scripts/verify_t-XXX.sql` convention (AGENTS.md §11.1), which superseded equivalence-live's 11-layer pipeline in practice.
2. **Per-platform runners** execute the SAME scenario against their implementation:
   - desktop runner → TS engine (+ optional live Supabase runner for the SQL path);
   - Android runner → Kotlin engine (via the documented corpus access, §2.1);
   - website → `portal-derive` read-side functions;
   - SQL → run against a fresh schema with the full canonical chain applied.
3. **One comparator, one normalization** (post-ADR-006): normalization may only canonicalize *representation* (timestamps → ISO, amounts → minor units, key ordering), never *semantics* (thresholds, rounding modes, category defaults). If two implementations need different normalization to agree, that IS the divergence.
4. **Invariants over snapshots** where possible: prefer asserting the domain invariants (INV-1…INV-9) over byte-equality, so cosmetic changes don't mask/hide real drift — but never weaken an assertion to make a platform pass.

### 2.1 Android corpus access (ADR-006 decision 4 — the documented way)

The Android equivalence runner (`app/src/test/java/com/example/equivalence/AndroidEquivalenceTest.kt`) consumes the shared corpus from the hub repo's desktop module — NO copy step, the scenarios are read in place. The resolution order (implemented in `AndroidEquivalenceTest.resolve`, fixed by T-081/ARCH-007):

1. `-DandroidEquivalence.scenariosDir=<path>` / `-DandroidEquivalence.outputDir=<path>` system properties (explicit override);
2. the Gradle module directory (`app/`);
3. the Android repo root (`..`);
4. **the hub repo checked out as a SIBLING** — `../AgentGithubUplaod/elimtiyaz-desktop/financial-tests/equivalence/scenarios` (the canonical three-repo layout; results are written back to `…/results/android`);
5. a standalone desktop checkout as a sibling (`../elimtiyaz-desktop/…`).

Consequences: a standalone Android checkout skips the equivalence class (the `require(scenariosDir.isDirectory)` guard aborts with an actionable message), while the standard sibling checkout runs it as part of `./gradlew test` — both behaviours are intentional. Output artifacts (`results/android`, regression JSONs) stay in the hub repo so the corpus and its history live in ONE place.

## 3. Expected verification process (per change)

1. Add/extend a scenario that exercises the changed behaviour (e.g. "partial refund after cleared cheque").
2. Run all runners; all must pass. If one fails: **the failing platform diverges — fix the platform or (with an ADR) change the canonical rule everywhere**. Never special-case the comparator.
3. Record the run (command + summary) in the change-log entry.
4. For write-path changes, additionally verify **server-state equivalence**: a desktop-collected payment and an Android-collected payment (post ADR-005) must leave identical rows in `payments`, `ledger_entries`, `installments`, `audit_logs` (modulo actor/device metadata).

## 4. Divergences currently known (must be closed, not accommodated)

Registered in the problem registry — the headline ones: payment write paths ×3 (CROSS-005/BUSINESS-002), receipt numbering ×5 (DRIFT-011), overdue ×3 (DRIFT-006/WEAK-007/BUSINESS-007), attendance rate ×2 (WEAK-019 family), remaining-amount ×2 (WEAK-018), unread counts ×3 (NOTIF-102/103/104). The comparator must NOT gain per-platform quirks for any of these.

## 5. Anti-patterns (forbidden)

- Adding platform-specific expected-values to make a divergent platform pass.
- Comparing against a stale mirror (the `_tier4` Kotlin mirror — DUP-002 — was DELETED 2026-09-03, T-043 pass 1; all consumers import `financial-tests/equivalence/android_mirror/`) instead of the real engine.
- Marking equivalence "verified" without the corpus run output.
- Testing only the happy path — scenarios must include overpayment→parent_credit, refund-after-clearance, category-filtered payments, multi-year ledgers (>500 entries for the website — WEAK-022).
- Creating a NEW equivalence framework/tree/runner-comparator pair instead of extending `financial-tests/equivalence/` (the anti-pattern that created the four frameworks — ADR-006).
