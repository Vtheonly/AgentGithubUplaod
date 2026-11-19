# LF-0 / LF-1 T-number registration DRAFTS (Session 5, 2026-11-19 — Lane A prep)

> **Read-only staging.** Per `Handoffs/handoff-session-05.md` Lane A: execution sessions are CODE sessions and leave the read-only regime ONLY on the owner's explicit go. Until then, the LF-0 work items are drafted here as `docs/recovery/task-registry.md` rows in the repository's exact `## T-NNN` format (next free number after T-548), so the execution session can register them **verbatim** (copy the row, set `Not Started`, add to `next-task.md`) and start work immediately. Nothing in `docs/` was touched by this session. Drafts inherit ROADMAP Phase 6/7 interlocks (P-0..P-4, LF-0..LF-5) and the AGENTS.md §13/§14/§15 governance verbatim.

---

## T-549 — BUG-038 (S5 finding): the finance wave adapter evaluates against the wall clock — add the explicit evaluation-clock parameter and re-pin t-502 per the T-470 convention

- **Status:** Not Started · **Priority:** P0 (the only red file in the full ladder; baseline deviation) · **Area:** desktop/financials
- **Problem:** BUG-038 (FINDINGS_INDEX). `deriveTrancheWaves` in `src/features/financials/installment-schedule-tab.tsx:228-231` has no clock parameter and hard-codes `Date.now()` at `:246` (also unticketed wall reads at `:330`, `:708`); the t-502 PARITY test pins a fixed clock and has been deterministically red since 2026-10-16 (evidence: `Testing and Runtime Evidence/S5-VITEST-CENSUS-2026-11-19.md` §4).
- **Scope:** add optional `nowEpochMs` (default `Date.now()`) to the adapter signature; pass through to `derivePooledTrancheWaves`; `t-502-wave-meter-thresholds.test.ts` passes `NOW` in the three finance calls; survey `:330`/`:708` for the same injection (pin or leave with a comment each — no behavior change in production rendering).
- **Verification:** `npx vitest run src/tests/domain/t-502-wave-meter-thresholds.test.ts` → 8/8; full ladder matches the documented baseline's failing set (empty) — move `scripts/test-baseline.json` ONLY per its own `_comment` rule with the T-549 citation; typecheck 0.
- **Left after completion:** nothing — task complete (1 session-fraction).
- **Next:** T-550 (LF-0 step 1) once the owner green-lights execution; T-549 itself is executable WITHOUT the green-light only if the owner treats it as a bug-fix lane — otherwise it waits with the rest.

## T-550 — LF-0 step 1: declare the five backend ports as interfaces (+ the `satisfies` factory proof per ARCH-033)

- **Status:** Not Started · **Priority:** P0 (ROADMAP 7.0) · **Area:** desktop/infrastructure
- **Problem:** the seam is implicit (54-slot repository + mock twin); LF-0 must make the 5 ports (DataBackendPort, AuthPort, RealtimePort, StoragePort, DiagnosticsPort — BLUEPRINT §13/LOCAL-FIRST-BLUEPRINT §5) explicit TS interfaces BEFORE any behavior changes.
- **Scope:** new `src/infrastructure/backend/ports.ts` (interfaces only, no implementations); the repository factory annotated with `satisfies` so the mock/supabase twins are compile-time checked against the port shapes (ARCH-033's 49-key map verification); zero runtime change.
- **Verification:** `npx tsc --noEmit` clean; full vitest ladder = documented baseline; ARCH-019 suites green.
- **Preserved:** everything — interfaces only.
- **Next:** T-551.

## T-551 — LF-0 step 2: remove the canonical hard-lock (`supabase-client.ts:35-38,148-157,171-172`, storageKey `:205`; `system-config.ts:431-433` backend-kind-aware validation)

- **Status:** Not Started · **Priority:** P0 (ROADMAP 7.0; ARCH-023) · **Area:** desktop/infrastructure + configuration
- **Problem:** packaged builds are pinned to the canonical project and `validateConnection` rejects any non-`*.supabase.co` URL — a local backend cannot even be pointed at.
- **Scope:** remove the URL allow-list pins; make `validateConnection` backend-kind-aware (accept `local:` and self-hosted URLs); storageKey stays namespaced per backend kind; the Configuration tab accepts a local backend without error.
- **Verification:** typecheck + full ladder; ARCH-019 suites; manual matrix: `local:` accepted, `https://<non-canonical>.supabase.co` accepted, canonical URL unchanged behavior.
- **Preserved:** fail-closed default backend selection (mock), the vault, all RLS-coupled client contracts.
- **Next:** T-552.

## T-552 — LF-0 step 3: route the 16 bypass files through the ports (C-7 census scope)

- **Status:** Not Started · **Priority:** P0 (ROADMAP 7.0; C-7) · **Area:** desktop/features + sync + config
- **Problem:** 17 direct `supabase-client` importers exist outside the supabase tree; `repository-provider.tsx` is the legitimate seam; the other **16** bypass it (9 features + tenant-switcher + sync-provider + system-config + media-vault + llm-adapter + 3 sync).
- **Scope:** per-file rerouting to the port surface (repository/DiagnosticsPort etc.); behavior-preserving; the F-U3/ROADMAP 5.11 diagnostics lane included.
- **Verification:** `rg "from.*supabase-client" src --glob '!src/infrastructure/supabase/**'` returns only `repository-provider.tsx`; typecheck + full ladder + the touched features' suites.
- **Next:** T-553.

## T-553 — LF-0 step 4: adopt the ADR-002/004 supersession ADRs verbatim (staged drafts S5) + governance pointers

- **Status:** Not Started · **Priority:** P0 (ROADMAP 7.0; BLUEPRINT §10 disposition table) · **Area:** docs/decisions + registry
- **Problem:** the graduated plan inverts ADR-002's location and re-homes ADR-004's authority; the ADR set must state this BEFORE the engine work lands.
- **Scope:** assign ADR-0XX numbers; copy `Investigation Archive/Local-First Architecture/ADR-002-SUPERSESSION-DRAFT.md` and `ADR-004-SUPERSESSION-DRAFT.md` verbatim into `docs/decisions/` with real dates; pointer-lines in ADR-002/ADR-004 Status sections; AGENTS §15.5's "canonical server implementation" language annotated to "canonical local Postgres implementation (see ADR-0XX)".
- **Verification:** the two drafts' verification sections become the acceptance criteria; no code change in this task.
- **Next:** T-554 (LF-1 spike scoping) or directly LF-1 execution if the owner green-lights the whole phase.

## T-554 — LF-1 spike scoping (executed when green-lit): PGlite on the Windows build chain (3-layer `build-windows.sh`), the t-368-scale perf corpus, the 324-policy parse harness

- **Status:** Not Started · **Priority:** P1 (ROADMAP 7.1 gates) · **Area:** desktop/electron + scripts
- **Problem:** the three LF-1 spike gates from ARCH-035/handoff: installer growth <30 MB, perf at t-368-scale corpus, 324/324 policy parse — each needs a designed harness before execution.
- **Scope (design + harness, execution behind the green-light):** packaging measurement plan reusing the 3-layer build; perf corpus built from `scripts/build-test-fixture.ts` at t-368 scale; the policy-parse harness runs the chain replay prologue (two skip-guards + GUC shim per LF0-PREP-CENSUS-2026-11-19 Part B) and asserts 324/324 policy statements parse.
- **Verification:** harnesses run locally (no live project); measurements recorded in `Testing and Runtime Evidence/`.
- **Next:** LF-1 execution tasks (register then, with the spike numbers attached).

---

**Registration note for the execution session:** T-549 is independent of the local-first go (it is a bug-fix lane with its own evidence base); T-550..T-553 are the LF-0 sequence (each one session-frac; T-551 and T-552 may parallelize across two agents after T-550); T-554 gates LF-1. All rows inherit the INV-2 standing gate (money-parity) and the five-question commit rule (AGENTS §14).
