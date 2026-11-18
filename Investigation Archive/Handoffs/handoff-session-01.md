# Handoff — Session 1 → Session 2

**Session ID:** S1 · **Date:** 2026-11-17 · **Baseline commit:** `ff2c4d19` (clean; only `Investigation Archive/` + `Refactoring Unified/` added since)

## Where everything is

- Master findings register: `Investigation Archive/Findings and Hypotheses/FINDINGS_INDEX.md` — stable IDs DEAD-001..014, DUP-001..023, ARCH-001..017, BUG-001..030, OPS-001..010 + rejected-claims register.
- Unified architecture map (incl. measured layer matrix): `Investigation Archive/Architecture Maps/unified-architecture-map.md`.
- Per-area claim-by-claim verification with file:line evidence: `Investigation Archive/Initial Reports Analysis/01..08-*.md`.
- Runtime evidence (typecheck PASS; reproduced t-502 parity failure): `Investigation Archive/Testing and Runtime Evidence/RUNTIME-EVIDENCE.md`.
- Blueprint: `Refactoring Unified/` (BLUEPRINT.md + ROADMAP.md).

## What Session 1 established (do not re-litigate without new evidence)

1. The seven Context Reports are ~85% accurate; their line numbers are systematically stale; four of their consumer claims are refuted (narrative-generator, ParentActionsMenu breakage, mock fixtures removable, `window.elImtiyaz` unexposed).
2. The measured layering: features→app 334 (service-locator providers), core/ai above domain (by design), 1 domain→infra violation (ARCH-001), 20 shared upward, 12 infra upward.
3. The four devis engines (DUP-001) are the single largest business-logic duplication.
4. The mock layer is structurally load-bearing in production mode (ARCH-006) — "mock = removable" is FALSE for subject-behavior, pricing-seed, the 5 live slots, fixtures (Ctrl+O), and mock-store (backup/sync).
5. Supabase side carries 11+ verified live bugs (BUG-006/007/008) including a broken bootstrap and an EF/INV-4 divergence.
6. ~985 MB of committed zips dominate repo weight (OPS-001).

## Exact next steps for Session 2 (in priority order)

### Step 1 — Runtime completion (if environment permits)
```bash
cd elimtiyaz-desktop && npx vitest run   # allow >10 min; capture full pass/fail census
```
Compare against `scripts/test-baseline.json` (5247/0/5, 320 files). Root-cause `src/tests/domain/t-502-wave-meter-thresholds.test.ts:169` (Finance strip `isOverdue=true` vs pooled `anyUnsettledOverdue=false` under configured grace). Determine: regression or date-sensitive test. Check `features/financials/installment-schedule-tab.tsx` Finance-strip derivation vs `domain/calc/payment/tranche-waves.ts` pooled derivation.

### Step 2 — Android repo cross-check (requires the sibling repo)
Verify parity for: `deterministicStudentCode` empty-field semantics (id.ts:166-175), `Permission` enum vs 71-code desktop enum (ARCH-015), workflow `engine.ts` mirror, `pull_*_for_sync` consumers, `register_family_batch` reachability (BUG-006 reachability question).

### Step 3 — Owner decision packet
Present the five product questions (see SESSION_LOG) and the Phase-0/1 items of the roadmap. Record answers in `Investigation Archive/Unresolved Issues/DECISIONS.md` (create it).

### Step 4 — Optional deep-dives not yet done
- `supabase/types.ts` systematic diff vs migrations (ARCH-014 quantification per table).
- i18n codemod git history (`scripts/i18n/codemod-plan.json`, `git log --follow src/i18n/gen/fr.ts`) to settle DEAD-005 disposition.
- `financial-tests/equivalence/` scenario coverage vs the four devis engines.
- Live-DB census if the owner provides read-only credentials (AGENTS_supabase.md rules apply).

## Guardrails for every continuation session

1. Re-read `Investigation Archive/README.md` and this file first.
2. Never modify application source, configs, schemas, or dependencies. Write only inside the two investigation folders.
3. Record `git status` at start and end of each session.
4. Challenge Session 1 conclusions where you have new evidence — record corrections, don't erase originals.
5. New findings get the next stable IDs (DEAD-015+, DUP-024+, ARCH-018+, BUG-031+, OPS-011+).
