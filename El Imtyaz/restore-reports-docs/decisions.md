# Architectural Decisions

> Key engineering and architectural decisions made throughout the project, with rationale.

---

## Decision 1: Domain-Driven Layered Architecture

**Decision:** Organize the codebase into strict layers: `core/` (pure utils) → `domain/` (business logic, no I/O) → `infrastructure/` (adapters) → `features/` (UI modules) → `app/` (shell).

**Rationale:** A pure domain layer (no React, no network, no I/O) is fully testable in isolation. Repository contracts return `Promise<Result<T>>` for fallible operations and `Observable<T>` for reactive reads, enabling UI reactivity without coupling to specific backend. The mock layer can be swapped for Supabase without touching domain or features.

**Trade-off:** More files and indirection than a flat structure. Worth it for testability and backend swappability.

**Made in:** Iteration 1 (Era 2 rewrite, commit `2fdf7c0`).

---

## Decision 2: Ledger-Based Accounting (Single Source of Truth)

**Decision:** Every financial value is computed by replaying an immutable ledger. Balances are NEVER stored as isolated numbers. The ledger is canonical; the payment table is a denormalized view.

**Rationale:**
1. **Complete audit trail** — every DZD has a traceable origin.
2. **Determinism** — replaying the ledger always yields the same balance.
3. **No ambiguity** — exactly one way to compute any balance.
4. **Reversibility** — corrections are new `reversal` entries with `reversesId`, never mutations to existing entries.
5. **Reconcilability** — sum of all entries' signed amounts = sum of all account balances.

**Trade-off:** Slower than stored balances (replay required). Mitigated by materialized views in Supabase (refreshed daily).

**Made in:** Iteration 5. Centralized in `src/domain/calc/ledger/` in refactor iteration 1.

---

## Decision 3: Unified Modal System (100% Enforcement)

**Decision:** ALL modals use `<UnifiedModal>` with three variants (dialog, drawer, command-palette). Zero raw `@radix-ui/react-dialog` imports in production code outside `unified-modal.tsx`. Enforced by regression test.

**Rationale:**
1. **Consistent UX** — every modal shares layout, header, footer, spacing, typography, animations, loading/error/success behavior.
2. **Maintainability** — design system changes propagate to all modals automatically.
3. **Prevents erosion** — regression test catches any new raw `Dialog` import.

**Trade-off:** `unified-modal.tsx` is 751 LOC (may need splitting in future iteration). Acceptable — the complexity is in the primitive, not the call sites.

**Made in:** Iteration 3 (introduced), Iteration 4 (truly unified), Iteration 7 (final unification including command palette), Iteration 14 (regression test guard).

---

## Decision 4: Mock-First Development with Supabase Fallback

**Decision:** Default to in-memory mock repositories. Supabase is opt-in via `VITE_USE_SUPABASE=true` + connection configuration. `RepositoryProvider` auto-selects with mock fallback if Supabase is misconfigured.

**Rationale:**
1. **Development velocity** — full app works without backend setup.
2. **Demo capability** — realistic seed data allows end-to-end demos from day 1.
3. **Incremental migration** — each repository can be ported to Supabase independently.
4. **Resilience** — mock fallback prevents crashes if Supabase is down or misconfigured.

**Trade-off:** Two code paths to maintain (mock + Supabase). Mitigated by repository contract interfaces — both implement the same interface.

**Made in:** Iteration 1 (mock layer), Iteration 12 (Supabase adapter with fallback).

---

## Decision 5: AES-256-GCM for Backup Encryption

**Decision:** Use AES-256-GCM (authenticated encryption) with PBKDF2 key derivation (100,000 iterations) via Web Crypto API. Never CBC/CTR without MAC.

**Rationale:**
1. **Authenticated encryption** — GCM provides both confidentiality and integrity. Tampered ciphertext is detected.
2. **Web Crypto API** — works in Electron renderer + modern Node.js. No native dependencies.
3. **PBKDF2 100k iterations** — brute-force resistant.
4. **IndexedDB vault** — ciphertext stored locally, never in Supabase database (only metadata).

**Trade-off:** Passphrase cannot be recovered if lost (by design — no backdoor). UI enforces passphrase confirmation.

**Made in:** Iteration 7.

---

## Decision 6: PII Masking Before LLM Calls

**Decision:** All AI features mask PII (phone, email, IBAN, NN, parent/student names) before sending text to LLM. Response is unmasked before display.

**Rationale:**
1. **Privacy** — PII never leaves the client, even if LLM provider logs requests.
2. **Compliance** — aligns with data protection best practices.
3. **Masking order matters** — mask longest patterns first (IBAN) so shorter patterns (NN) don't grab parts of them.

**Trade-off:** Masking/unmasking adds complexity. Mitigated by comprehensive tests (17 tests in `pii-mask.test.ts`).

**Made in:** Iteration 7.

---

## Decision 7: Multi-Tenant from Day 1

**Decision:** Every Supabase table has `tenant_id` NOT NULL FK + Row Level Security policy. `service_role` key never in client code (server-side only). `anon` key used in all client code (gated by RLS).

**Rationale:**
1. **Data isolation** — tenants cannot see each other's data, enforced at database level.
2. **Defense in depth** — even if client code has a bug, RLS prevents cross-tenant access.
3. **Future-proof** — supports multi-school deployment without refactoring.

**Trade-off:** Every query includes `tenant_id` filter (via RLS). Minor performance cost. Mitigated by indexes on `tenant_id` + hot query columns.

**Made in:** Iteration 12 (Supabase integration).

---

## Decision 8: Defense in Depth for Critical Invariants

**Decision:** Business rules enforced at multiple layers:
- **No-self-approval** — UI (hide button) + repository (`ERR_FORBIDDEN`) + DB (trigger).
- **Mock data exclusion from sync** — flagged at queue time AND re-checked at drain time.
- **Atomic writes** — snapshot/rollback at repository layer + DB transaction at Supabase layer.

**Rationale:** Any single layer can have bugs. Multiple layers ensure the invariant holds even if one layer fails.

**Trade-off:** More code. Worth it for critical invariants (financial integrity, data isolation).

**Made in:** Iteration 6 (no-self-approval), Iteration 6 (atomic batch registration), Iteration 14 (mock exclusion).

---

## Decision 9: Schema-Driven Excel Import

**Decision:** Generic import engine that works against any `.xlsx` file matching a registered `ImportSchema`. Adding a new format means adding a schema, not modifying the engine.

**Rationale:**
1. **Extensibility** — new sheet types (e.g., teacher roster) added by defining a schema, not writing engine code.
2. **Maintainability** — engine logic separated from business-specific column mappings.
3. **Testability** — engine tested independently of specific schemas.

**Trade-off:** More complex than a hardcoded importer. Worth it — the original hardcoded importer was replaced because it couldn't handle the real `Suivis clients 2026_2027.xlsx` format.

**Made in:** Iteration 5 (dynamic-import.ts), Iteration 11 (full engine reintegration from standalone package).

---

## Decision 10: UI-Driven Configuration (No `.env` Files)

**Decision:** Every configuration option accessible from Settings → Configuration tab. Two-tier storage: local (Electron `userData/config.json` for connection settings) + server (Supabase `system_settings` table for everything else). Secret values NEVER stored in database — only as Supabase Edge Function environment variables.

**Rationale:**
1. **User experience** — no manual `.env` editing, no technical knowledge required.
2. **Security** — secrets never in database, never in plaintext, never logged.
3. **Auditability** — all config changes audit-logged (key name + category, never value).

**Trade-off:** App restart required for connection changes (singleton client). Acceptable — clearly communicated in UI.

**Made in:** Iteration 13.

---

## Decision 11: Centralized Math Engine (`src/domain/calc/`)

**Decision:** All calculation logic (ledger balance, payment sums, pricing tranches, reconciliation) centralized in `src/domain/calc/` with one responsibility per module. Original files become thin re-export shims.

**Rationale:**
1. **Single source of truth** — every balance, debt, payment total computed through one set of pure functions.
2. **Testability** — pure functions (no I/O, no React) enable 100% line + branch coverage.
3. **Navigability** — 16 focused modules (100-200 LOC each) instead of 4 mega-files (2,894 LOC total).
4. **Behavior preservation** — characterization tests lock in current behavior before extraction.

**Trade-off:** `entries.ts` (261 LOC) and `checks.ts` (254 LOC) slightly exceed 200-line target. Acceptable — tightly cohesive modules where splitting further would harm readability.

**Made in:** Refactor iteration 1.

---

## Decision 12: Per-Entity Mock Repository Split

**Decision:** Split the 3,206-LOC `mock-repositories.ts` into 14 per-entity / per-domain files under `repositories/`. Shared `MockStore` extracted to `mock-store.ts`. Original file becomes thin barrel re-export.

**Rationale:**
1. **Navigability** — find a repository by domain, not by scrolling 3,206 lines.
2. **SRP** — each file has one responsibility (one entity or one tightly-coupled domain).
3. **Testability** — smoke tests verify each singleton is defined and wired correctly.
4. **Backwards compatibility** — thin barrel re-exports mean zero call-site changes.

**Trade-off:** `financial-repository.ts` (600 LOC) groups 4 tightly-coupled repos. Splitting further would require exposing `store.ledger` mutation as public API, harming encapsulation. Acceptable exception.

**Made in:** Refactor iteration 2.

---

## Decision 13: Conventional Commits (Era 3 Onward)

**Decision:** All refactor commits use conventional-commit format: `refactor(calc): centralize math engine into src/domain/calc/ (iter 1)`. Reject `cv`/`kk`/`mid`/`go` style messages.

**Rationale:**
1. **Reviewability** — reviewers understand intent from message alone.
2. **Bisect-ability** — `git bisect` can identify which type of change introduced a bug.
3. **Changelog generation** — conventional commits enable automatic changelog generation.

**Trade-off:** Slightly more effort per commit. Worth it — the Era-2 history (62% non-descriptive messages) demonstrated the cost of poor commit hygiene.

**Made in:** Refactor iteration 1 (Era 3 start).

---

## Decision 14: Keep Iteration-Prefixed Test File Names

**Decision:** Test files like `iteration-9-alerts.test.ts` keep their iteration prefix rather than being renamed to descriptive names.

**Rationale:**
1. **Traceability** — test file name links directly to `docs/ITERATION-N-DONE.md` (now `restore-reports-docs/iteration-history.md`).
2. **Context** — reader knows when and why the test was written.

**Trade-off:** Inconsistent naming convention (some files use `iteration-N-*`, others use descriptive names). Acceptable — the traceability benefit outweighs the naming inconsistency.

**Made in:** Iteration 16 (explicitly decided NOT to rename during structure refactor).

---

## Decision 15: Documentation Centralization

**Decision:** Consolidate all 30+ scattered Markdown files into `restore-reports-docs/` as the single source of truth. Remove redundant files from `docs/`, `supabase/docs/`, and repo root.

**Rationale:**
1. **Single source of truth** — every topic has one authoritative location.
2. **No duplication** — eliminates divergent information across multiple files.
3. **Navigability** — clear index (`README.md`) + logical document names.
4. **Professional standard** — follows industry best practices for engineering documentation.

**Trade-off:** `docs/` folder no longer exists — historical references to `docs/ITERATION-N-DONE.md` in git history and worklog entries are stale. Acceptable — git history preserves them; `restore-reports-docs/` is the current truth.

**Made in:** Documentation centralization effort (this iteration).

---

## Related Documents

- [`architecture.md`](./architecture.md) — how these decisions manifest in the codebase
- [`iteration-history.md`](./iteration-history.md) — when each decision was made
- [`restoration-plan.md`](./restoration-plan.md) — strategy informed by these decisions
