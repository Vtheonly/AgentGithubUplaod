# ARCHITECTURE REFACTORING PLAN — ordered, low-risk, evidence-linked

This is a **plan only** — the audit charter forbids refactoring in this branch. Each step cites its evidence file, is sized, and is sequenced so no step depends on an unmerged predecessor. Every step is testable against the existing suite (5,963/5,964 green, coverage 73.6% on domain) plus the checks named below.

## Order of attack (risk-ascending)

### R-0 — Hygiene batch (half day, zero behavior risk)
1. Delete/archive the 83 unused files (UNUSED-CODE §1): `git mv scripts/t-*.ts scripts/archive/` (keeps history), delete the 6 unused `src/` files. Re-run `npx knip` expecting `cascade_hidden` batch 2, repeat once.
2. Remove the 10 unused dependencies from `package.json` (UNUSED-CODE §4). `npm ci && npm run typecheck && npm test`.
3. Prune unused exports/types with `fallow dead-code --trace <file>:<export>` before each deletion (the tool traces real consumers).
4. Fix the 39 `react-hooks/exhaustive-deps` one component at a time (DESIGN-PATTERN-AUDIT §4) — each is a potential stale-closure bug.
5. Move `scripts/test-baseline.json` to the current reality (5,964/1) or fix `t-591` first (BASELINE §6).

### R-1 — Break the navigation cycle (1 day, one pattern change)
`shared/navigation/person-navigation-context.tsx` must not import feature drawers (ARCHITECTURE §3, 5 cycles). Introduce a navigation registry: features register drawer openers; context dispatches. Verification: `npx madge --circular` drops from 34 to ≤ 22; vitest green.

### R-2 — Split the God module (2–3 days, mechanical)
`supabase-shared-repositories.ts` (5,563 LOC, 6 classes, fan-in 81) → one file per repository into `infrastructure/supabase/repositories/` (they already exist as a convention — `supabase-teacher-repository.ts` etc.). Keep `supabase-repositories.ts` as the pure aggregator (no re-export cycles — ARCHITECTURE §3 infra cluster). Verification: fan-in redistributed, `fallow health` hotspot gone, IPC/e2e tests green.

### R-3 — Provider relocation (1–2 days, 148 files but scripted)
Move `app/providers/{repository,toast,auth,ai-copilot,sync}-provider` implementations to `shared/providers`; `app/` keeps composition/root only. Kills the 337 `features-no-app` violations and unblocks the `shared-no-upward` fixes (topbar/search-index). Scripted codemod + `npx depcruise` must report `features-no-app: 0`.

### R-4 — Single-owner consolidation (2–3 days)
1. `Result` ← `src/core/result.ts` everywhere (semantic-duplication §1, 4 copies deleted).
2. Merge the duplicate repository ports (`academic-repository.ts` → `repository.ts`, Fallow exact 48 lines).
3. Extract the workflow condition language into one module shared by `src/domain` and `supabase/functions/workflow-execute` (OPERATION-DUPLICATION §2 — the 68-line exact fork). The Edge Function imports the shared `.cts`-compatible source the same way `backend-profile-contract.cts` is already shared (BUG-054 precedent).
4. Extract `@elimtiyaz/canonical` shared package (desktop + website): start with the 13 `lib/canonical` forks + `domain/calc/shared/{money,dates}`. Publish as a workspace/git submodule package; both repos' equivalence suites continue to gate parity.

### R-5 — Mock-layer rationalization (potential, deliberate, 1 week class)
Keep the mock twin (ADR feature) but generate its scenario data from the same corpus as the financial equivalence rig (`financial-tests/equivalence/generators`), and dedupe the mock-vs-mock families (Fallow near-mode top cluster). Est. −8 K LOC without losing the offline mode.

### R-6 — Database hardening (DATABASE-AUDIT §; owner: DB)
1. Pin `search_path` on the 12 SECURITY DEFINER functions (one-line `SET search_path = public, extensions` per function).
2. Add indexes for the 68 unindexed FK columns (single migration, `create index concurrently`-safe in maintenance window).
3. RLS policy merge pass on the 3-policy overlaps (parents/students SELECT).
4. Decide the pagination policy for the 308 unbounded selects (bounded read: `.limit`/cursor; unbounded intent: document per call site).

## Explicitly NOT recommended

- Rewriting the mock layer away — it is a load-bearing offline/test mode.
- Splitting `domain/model` from `domain/calc` beyond the type-only cycle fix — the coupling there is real domain cohesion.
- Any change to `electron/*.cts` module conventions — BUG-054's `.cts/.cjs` contract is deliberate (ADR-036 era) and documented.
- Chasing the semantic-mode duplication queue (1,596 families) before the exact/near batches — it is a review queue, not a work list.

## Sequencing rationale

R-0 shrinks every later diff. R-1/R-2 are independent files, highest risk-per-line reduction. R-3 is the widest mechanical change and benefits from R-1 being clean. R-4 changes cross-app ownership and should land after desktop-internal structure is stable (so the shared package is extracted from a calm tree). R-5/R-6 are parallelizable with R-4.
