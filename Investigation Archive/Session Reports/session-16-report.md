# Session 16 Report — BUG-044 origin pinned, the toast-churn family census & the DS/11 verification discharge

**Session ID:** S16 · **Date:** 2026-11-20 · **Branch:** `investigation/session-16` (merged to `main`, pushed) · **Repo HEAD at start:** `3e6ad7b9` (main, clean tree; all 14 prior session branches verified merged via `git merge-base --is-ancestor`).
**Charter:** handoff-session-16 Lane B — the two remaining open depth items (BUG-044's loop origin, standing since handoff-13; the DS/11 §8 [S-A]/[S-B] re-verification flags on T-569/T-570), plus the per-run gate check and register upkeep. **Strictly read-only; zero subagents; every claim a personal source read at HEAD.**

## 1. Gate check

- **Repo:** clean; `git fetch --all --prune` no-op; local main == origin main == `3e6ad7b9`.
- **Issue #32:** open, 0 comments, `updated_at 2026-11-19T00:06:59Z` — no owner activity (13th consecutive quiet check). No D-1..D-16 answers; G0 stays ACTIVE; the ⏵ defaults govern.
- **Infra (GET-only, keyless script outside the repo; keys via environment):** P1 401 key-type gate (publishable recognized) · P2/P3/P4/P5/P5b 402 `exceed_egress_quota` (**OPS-011 now 14-run-stable**) · P7 mgmt token 401 · P8 Firebase 400 format-accepted · P9 poolers OPEN · **P9c the direct-db host now resolves from the sandbox** (S15: unresolvable — sandbox DNS change, no project significance; login untested per charter) · P10 GitHub PAT 200 + push verified by this session's branch push · P11 Vercel PAT 200 VALID. Full record: `01-INFRASTRUCTURE-STATUS.md` S16 run.
- **Excel workbooks:** none new since S14 — the filled-workbook inspection recipe stays staged (nothing to run it against).

## 2. What this session established

### 2.1 BUG-044's origin is pinned — both halves (the last open runtime item, closed)

**Half 1 — the deterministic silent failure (7-link source chain, `Deep Sweep/12` §1.1):**
1. `ai-copilot-provider.tsx:496-497` — the user turn commits (`setMessages(nextConversation)`) BEFORE the provider call; no rollback exists.
2. `ai-config-storage.ts:114-116` — `loadConfig()` never returns null; the unconfigured state masquerades as DEFAULT_AI_PROVIDER_CONFIG (groq / null key).
3. `agent-runtime.ts:184-193` — the runtime throws "Clé API manquante…" BEFORE any fetch — the S12 zero-network-requests observation, explained.
4. `ai-copilot-provider.tsx:573-575` + `toast-provider.tsx:45` — the ONLY failure surface is a 4.5-second toast; no conversation error, no log — the clean console, by construction.
5. `ai-copilot-provider.tsx:155-171` — the T-268 effect persists the failed turn (the unanswered-message-after-reload evidence).
6. `copilot-drawer.tsx:115` — the header badge shows the live-looking default model id; NO unconfigured empty state exists.
7. `copilot-drawer.test.tsx:245` — **the test suite asserts the failed turn stays in the thread** — the defect is test-enshrined; any fix updates this test.

**Half 2 — the once-observed `Maximum update depth exceeded` (§1.2):** it is **the BUG-042 toast-churn family triggered through the copilot's own `showError`**: the toast context value churns on every show/dismiss (`toast-provider.tsx:57-69`) for all **108 `useToast()` consumers**; the copilot send's error toast churned the context **while the toast-keyed Settings effect was mounted** (S10's walkthrough ledger shows the Settings visit immediately before the Topbar copilot probe — the drawer opens as an overlay on the current page); the synchronous cascade tripped React's 50-update guard; **zero error boundaries exist app-wide** (grep-verified), so the root unmounted — S10's "drawer subsequently unmounted". Non-deterministic because the trip needs the timing confluence; S12's clean-console variant is the expected outcome. The loop sub-item closes as explained-by-family (T-559/T-560 own it); the silent-failure sub-item is BUG-044's own UX defect — fix staged as **T-572** (§1.3: paired-error semantics or commit-on-success; the unconfigured empty state + honest badge; `logger.warn`; the test update).

### 2.2 The toast-churn family census — T-560's scope corrected ×5 (§2)

The complete census of the loop-capable pattern (useCallback keyed on a toast-derived fn/value × an effect that fails and toasts again): **five sites** — `configuration-tab.tsx:73-85` (BUG-042, runtime-proven) + `accounts-tab.tsx:60-80` + `pricing-year-config-bar.tsx:58-63` + `promotion-cycle-detail.tsx:69-78` + `promotion-cycles-tab.tsx:53-62` (the four new ones all fail into `showError` on their list calls in live mode). T-559 (split the toast context) remains the one-line root fix for the whole family; **T-560's loop-breaker scope corrects to all five sites**. OPS-015 sharpened: a premature cap lift with the family unfixed opens five egress-burning request loops, not one.

### 2.3 The DS/11 §8 [S-A]/[S-B] discharge — 20/20 verified, 3 corrections, 1 new defect (§3)

All 20 subagent-only claims personally re-read at HEAD: **every one verified**. Three record corrections: `teachers-tab.tsx` lives at `features/academics/` (not personnel/); `create-section-dialog.tsx` at `features/academics/placement/`; and the dual-condition teacher filter census is **8 sites, not 6** (`class-detail-page.tsx:205` and `academic-year-detail-drawer.tsx:248` were missed by S15 — T-561's M-U2 rewire scope grows accordingly). One new defect discovered mid-verification: **BUG-065** — `CATEGORY_FROM_DB` maps DB `medical` → domain `'support'` while `CATEGORY_TO_DB` maps `medical` → `'medical'` (`supabase-personnel-repository.ts:110-129`): medical staff are persisted correctly but **silently read back as 'support'** (wrong category in the employee form after reload; wrong payslip label; a latent trap for any future medical-scoped logic). No test pins the round-trip. Fix folds into T-561/M-U2 with the round-trip parity test as a precondition of the bridge deletion.

### 2.4 EXECUTION-PLAN v1.2 — the plan of record made self-contained (§11)

The standing S8–S13 queue existed only in handoffs/Deep Sweeps — including the **top-CRITICAL T-559/T-560 lane**. v1.2 folds it into the plan as §11 task cards (T-555 reserved/unused; T-556 contact backfill; T-557 dead-abort-mode, owner D-call; T-558 dry-run tag; T-559 toast split; T-560 ×5 loop breakers; **T-572 new** — the copilot failure UX) + the T-561 scope amendments + the T-569/T-570 discharge note + §9.3's next-free-ID refresh.

## 3. Register deltas

- **BUG-065 (new, V):** the medical→support asymmetric read-back.
- **BUG-044 (refinement, V-partial → V):** origin pinned both halves; fix = T-572 (+ T-559/T-560 for the loop family).
- **BUG-042 (refinement):** the five-site family census; T-560 scope corrected; OPS-015 sharpened.
- **DS/11-flags discharge:** 20/20 verified; 3 corrections folded into T-561's scope.
- **OPS-011:** 14-run-stable.
- Next free IDs: **DEAD-024, DUP-037, ARCH-046, BUG-066, OPS-016**; next correction C-23 (unused). Correction ledger unchanged (the §3 fixes are recorded in the S16 addendum + EXECUTION-PLAN scope notes; no prior conclusion invalidated).

## 4. Git discipline

Incremental commits on `investigation/session-16`, each pushed immediately (DS/12 + registers; EXECUTION-PLAN v1.2; this report + handoff + README rows); merge to `main` after verification; never force-pushed. Token-hygiene grep clean over every changed file before every push (the only pattern match is the guardrail rule string itself, the standing convention). Only `Investigation Archive/` and `Refactoring Unified/` were written; no application source, configuration, schema, or dependency was touched.

## 5. What remains open (carried to handoff-session-17)

1. The standing executor queue (now fully in EXECUTION-PLAN): **T-559/T-560 first** (the OPS-015 cap-lift prerequisite — now the five-loop family), then T-549..T-554, T-556..T-558, **T-572**, the BUG-059..063 truncation lane, the DS/07 §8 Phase 0–3 queue, and the T-561..T-571 pedagogy lane — all G0-gated.
2. The owner's pending actions: the spend-cap lift (unblocks the live census + the E7.9 final export), D-1..D-16 answers, credential rotation (OPS-012 — the tokens were pasted in plaintext chat).
3. The filled pedagogy workbook (if supplied → run the S14 recipe before any T-567 import work).
