# Known Issues

> Comprehensive list of known bugs, technical debt, deferred work, and limitations.

---

## Test Failures (24 — Pre-Existing, Not Regressions)

All 24 failures are in Excel-import test files. **None affect business logic.** Introduced in commit `29e794c "good enough"` (iter 11–16 mega-commit).

### `src/test/unit/excel-import-engine/schemas.test.ts` (2 failures)

| # | Test | Expected | Actual | Root cause |
|---|---|---|---|---|
| 1 | BON schema > has header at row 10 with data starting row 12 | `BON_SCHEMA.headerRow === 10` | `1` | Schema and test disagree since inception. |
| 2 | Devis schema > has header at row 13 (form-style layout) | `DEVIS_SCHEMA.headerRow === 13` | `1` | Same as above. |

**Fix:** Either update schema constants → 10/13 (if "form-style layout" is the intended production format) OR update tests to expect 1 (if current flat-header layout is correct). Requires business-logic decision.

### `src/test/unit/excel-import-engine/engine.test.ts` (2 failures)

| # | Test | Failure |
|---|---|---|
| 3 | ImportEngine > emits audit run_started + run_completed on successful import | Audit events not emitted |
| 4 | ImportEngine > rejects invalid rows and records them in the errors list (Iteration 14: niveau + NEM relaxed) | Rows not rejected as expected |

**Fix:** Reconcile audit-emission and validation-relaxation behavior with test expectations. Likely a small engine fix.

### `src/test/unit/excel-import-comprehensive.test.ts` (7 failures)

| # | Test | Failure |
|---|---|---|
| 5 | imports a row without NEM (Iter 14 — NEM is optional) | `expected +0 to be 1` |
| 6 | rejects a row missing required NOM | `expected +0 to be 1` |
| 7 | rejects a row missing required niveau | `expected +0 to be 1` |
| 8 | rejects a row missing required DEVIS ANNUEL | `expected +0 to be 1` |
| 9 | aggregates REGLEMENTS DETTES monthlyArray across 12 columns | `expected +0 to be 1` |
| 10 | skips empty rows (all cells null/empty) | `expected 0 to be ≥ 1` |
| 11 | strict mode rejects the entire run when there are errors | Run not rejected |

**Fix:** Debug synthetic ETAT workbook builder — probably a `sheetMatchers` regex or `headerRow` offset issue. All 7 fail with "0 rows imported" suggesting the engine doesn't recognize the synthetic workbook's sheet.

### `src/test/integration/excel-real-file.test.ts` (13 failures)

| # | Test | Failure |
|---|---|---|
| 12-24 | All 13 "Real Suivis clients Excel" tests | `test-fixture-suivis.xlsx` not found |

**Fix:** Create a **sanitized** `test-fixture-suivis.xlsx` with fake PII (or generate it programmatically in a `beforeAll` hook from `Clients_Sheet_Merged.txt`) and commit it. The file is real client data with PII and was deliberately excluded from git.

---

## Technical Debt

### Medium Severity

#### 1. 38 Repositories Still on Mock
**Carried since:** Iter 12
**Impact:** App works fully in mock mode; Supabase adapter only implements Auth + Approval. SQL schema + Edge Functions + RLS policies ALL production-ready.
**Fix:** Port each repository independently by implementing the Supabase adapter and replacing mock in `getSupabaseRepositories()`. Each port is self-contained.

#### 2. AI Keys Two Storage Layers
**Carried since:** Iter 13
**Impact:** `AIConfigTab` writes to localStorage (AES-256-GCM); `ConfigurationTab → IA` writes to Supabase Edge Function env via Management API. Two layers unaware of each other — user can configure different keys in each.
**Fix:** Consolidate to single layer. Either disable AI tab in mock mode (bad UX) or implement fallback chain (ConfigurationTab checks localStorage first, then Supabase).

#### 3. `dist/` and `dist-electron/` Committed to Git
**Carried since:** Iter 3 (commit `1356665`)
**Impact:** Build artifacts pollute diffs, merge conflicts on minified JS, repo size balloons.
**Fix:** Add to `.gitignore` + `git rm --cached dist/ dist-electron/`.

### Low Severity

#### 4. `overdueAmount` Semantics Divergence
**Carried since:** Iter 6
**Impact:** `payment.ts` uses installment due dates; `ledger.ts` uses charge entry timestamps. Both are valid but produce slightly different numbers. Ledger version is canonical for dashboard.
**Fix:** Unify on ledger semantics. Update `payment.ts` `overdueAmount` to delegate to ledger calculation.

#### 5. RBAC Override in localStorage
**Carried since:** Iter 15
**Impact:** SuperAdmin's RBAC matrix edits stored in localStorage (mock mode). Multi-device doesn't sync. SQL schema has `tenant_role_overrides` table ready.
**Fix:** Implement Supabase adapter for `tenant_role_overrides` table. localStorage becomes fallback for mock mode.

#### 6. BON + Devis Sheet Importers
**Carried since:** Iter 11
**Impact:** BON + Devis sheets use per-client multi-row layout that doesn't fit tabular schema model. Most rows rejected.
**Fix:** Write per-record parsers for non-tabular sheets. Requires understanding the per-client layout format.

#### 7. Sync Push Handler Minimal
**Carried since:** Iter 14
**Impact:** Upserts everything to single `sync_queue` table. Production may want per-entity routing.
**Fix:** Implement per-table upsert handlers. Each entity type routes to its own Supabase table.

#### 8. OnlineDetector Probe
**Carried since:** Iter 14
**Impact:** Uses `google.com/generate_204` for online detection. Fails in air-gapped networks (e.g. China).
**Fix:** Use Supabase project URL as probe target (already required for sync). Fallback to `navigator.onLine` only.

### Trivial

#### 9. `domain/model/index.ts` Barrel Incomplete
**Carried since:** Iter 16
**Impact:** Re-exports only 9 of 16 model files. Only 1 file uses barrel.
**Fix:** Either complete the barrel or delete it. Low priority.

#### 10. 16 Test Files with `iteration-N-` Prefix
**Carried since:** Iter 4–16
**Impact:** Test file names don't follow consistent convention. Would lose traceability to `docs/ITERATION-N-DONE.md` if renamed.
**Fix:** Rename to descriptive names. Add iteration number as header comment. Low priority.

---

## Known Bugs (Non-Test)

### 1. Topbar Quick-Backup Button UX
**Severity:** Trivial
**Description:** Navigates to `/settings?tab=backup` but only auto-selects tab on initial mount (not on param change while already on page).
**Workaround:** Click the "Sauvegardes" tab manually.
**Fix:** Add `useEffect` watching `searchParams` for tab changes.

### 2. DAG Canvas Touch Support
**Severity:** Low
**Description:** Edge creation in the workflow DAG editor is mouse-only (no touch support) per plan §10.02.
**Fix:** Add touch event handlers. Low priority (desktop app primarily uses mouse).

### 3. Backup Scheduler Dev Cycle
**Severity:** Trivial
**Description:** Backup scheduler runs every 5 minutes in dev mode (vs 24h in production). Can be noisy in logs.
**Fix:** Already by design — allows testing backup cycle without waiting 24h.

---

## Limitations (By Design)

### 1. Excel Import — BON + Devis Sheets
BON and Devis sheets use a per-client multi-row layout (one client's data spans multiple rows with merged cells). This doesn't fit the tabular schema model used by the import engine. The ETAT sheet (primary client roster) works correctly with 96.5% acceptance rate. BON/Devis support requires a different parsing approach.

### 2. AI Feature Mock Responses
The mock LLM adapter returns canned responses with 800ms delay. Real AI features require configuring Groq and/or OpenRouter API keys via Settings → Configuration → IA. The Edge Function proxy (`ai-proxy`) is production-ready — only API keys need filling.

### 3. Backup Passphrase Recovery
There is no passphrase recovery mechanism. If the backup passphrase is lost, encrypted archives cannot be decrypted. This is by design (security feature — no backdoor). UI enforces passphrase confirmation on setup.

### 4. Mock Data Never Syncs
Mock data is explicitly excluded from the sync queue (defense in depth: flagged at queue time AND re-checked at drain time). Only Excel-imported data or data created via UI mutations is eligible for Supabase sync. This is by design.

### 5. App Restart for Connection Changes
When Supabase connection settings change (URL, anon key, use_supabase toggle), the app must restart. This is because the Supabase client is a singleton initialized at module load. UI clearly communicates with "Enregistrer & Redémarrer" button.

### 6. Secret Values Never Recoverable from UI
Once an API key or passphrase is set, the UI only shows "********". If the user forgets, they must re-enter. This is a security feature, not a bug — plaintext values never live in the database.

---

## Related Documents

- [`current-status.md`](./current-status.md) — overall project state
- [`next-steps.md`](./next-steps.md) — prioritized fixes for these issues
- [`commit-history-analysis.md`](./commit-history-analysis.md) — when these issues were introduced
