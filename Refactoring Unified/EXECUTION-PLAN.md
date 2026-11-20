# Execution Plan — the El-Imtiyaz Consolidation, Stage A/B Hybrid & Experience Overhaul (v2.0)

**Version:** 2.0 (Sessions 22–23, 2026-11-20 — the final consolidation: the complete `Investigation Archive/` Sessions 1–23 + the owner's locked-in decisions D-17/D-18/D-19 and the S23 unified-Excel lane unified; every registered finding task-homed; the T-register complete T-549..T-611) · **Status:** the plan of record's *operational layer* — it converts `Refactoring Unified/BLUEPRINT.md` v2.0 + `Refactoring Unified/ROADMAP.md` v2.0 (Phases 0–9) and the `Investigation Archive/` evidence base into a single ordered, step-by-step, dependency-aware execution program. The implementation sessions execute directly from this file.
**Companion documents (authoritative, never replaced by this file):** `Refactoring Unified/ROADMAP.md` v2.0 (the task table of record) · `Refactoring Unified/BLUEPRINT.md` v2.0 (the design of record, incl. §13 Stage A/B + §14 the query-minimization architecture) · `Investigation Archive/OWNER-DECISION-PACKET.md` (D-1..D-20 — Part F's locked-in decisions + Part G's S23 mandate core govern) · `Investigation Archive/Findings and Hypotheses/FINDINGS_INDEX.md` (every finding ID cited below; 190 registered IDs, all mapped in §6).

---

## 0. How to use this document — execution-session protocol

**You are the implementation session. Bootstrap in this exact order:**

1. `git fetch origin && git status` (must be clean; sync `main`).
2. Read: `Investigation Archive/README.md` (the master index) → `Investigation Archive/SESSION_LOG.md` (row 22 = the blueprint consolidation) → `Investigation Archive/PHASE-TRANSITION-HANDOFF.md` → **this file, end to end**.
3. Check Issue #32 for owner answers to the still-open decisions (D-5/D-6/D-8..D-16 + the Phase-4 product decisions). **If any answer exists:** record it as a dated addendum in `OWNER-DECISION-PACKET.md`, adjust the rows it gates, and re-read §5. If none: **the ⏵ defaults govern — except where D-17/D-18/D-19 are LOCKED IN (they are decisions, not defaults).**
4. Run the GET-only probe set (see `Investigation Archive/01-INFRASTRUCTURE-STATUS.md`) and update that file. **Watch for one thing:** if the Supabase REST probe with the secret key returns **200**, the spend cap has been lifted → verify the OPS-015 precondition FIRST (§1 G2: T-559 + T-560 + T-594 must already be green; if not, do them before anything else touches live traffic), then schedule the one-time live window (§4 E7A-12 / T-598 + the local seed ceremony E7B-10).
5. Then start executing at §3 (the immediate queue).

**Standing rules you must not break (inherited from the investigation charter + AGENTS.md):**

- One registered T-task per commit; five-question commit body; push immediately after every commit; never force-push. Register each task in `docs/recovery/task-registry.md` per the staged drafts BEFORE writing code.
- `npx tsc --noEmit` + the touched features' vitest suites green before each commit; full `npm test` + baseline move at each batch boundary (baseline moves ONLY per `scripts/test-baseline.json`'s own `_comment` rule, citing the task ID).
- SQL/EF changes follow the live-verify ceremony (AGENTS.md §11.1); migrations append-only; RLS never weakened.
- Every completed task updates `FINDINGS_INDEX.md` (item state) and `docs/recovery/task-registry.md`; unresolved items re-verified or escalated to the owner via Issue #32.
- Kill-switch rollback at every stage: the previous backend/behavior stays selectable until the next stage is green.
- **The web portal and Android clients keep consuming Supabase unchanged throughout (D-17) — no breaking change ships to them without the §10 mirror/divergence registration.**

---

## 1. Operating gates — what is executable NOW vs owner-gated

| Gate | State at Session 22 close | What it unlocks |
|---|---|---|
| **G0 — read-only regime** | ACTIVE (the owner has not green-lit code changes on Issue #32; the only comments are the session mandates; the FINAL BLUEPRINT CONSOLIDATION prompt explicitly defers ALL implementation) | Nothing in §4 is executable until G0 lifts — the implementation sessions execute directly from this plan once it does |
| **G2 — Supabase spend cap lifted (one time)** | NOT LIFTED (OPS-011, 17-run-stable `exceed_egress_quota`; the keys are recognized — the restriction is at the plan/spend-cap layer) | The one-time live window (T-598 reconciliation oracle + the live census + the local seed ceremony E7B-10) — **and ONLY after the OPS-015 precondition: T-559 + T-560 + T-594 green first** |
| **G2R — relocation readiness** | The OLD project is quota-blocked (OPS-016: no Windows installer buildable against it); the T-573/T-574/T-575 lane is executable WITHOUT G2 (the guide's Path 2) | The effortless Supabase→Supabase move; the packager unlock; the local seed's source project |
| **D-13..D-16 (pedagogy)** | ⏵ defaults staged (Part E) | The T-566/T-568/T-569/T-570 cards' final shape |
| ~~G3/G4 (the v1.x D-1/D-8 gates)~~ | **SUPERSEDED (D-17):** no relay topology decision remains (Supabase IS the sync layer); D-8's restore-UX copy rides E7B-4's card | — |

**Reading the gates correctly:** the investigation sessions (S1–S21) ran entirely inside G0; this blueprint session did too. The implementation session's first job is to establish (or explicitly assume) that G0 has lifted. **The three locked-in decisions (D-17 hybrid / D-18 OAuth stays / D-19 white theme + overhaul) are NOT gated — they are the program's shape.** The one-time cap lift (G2) wants the OPS-015 precondition verified green first, then the single live window runs T-598 + the census + the seed.

---

## 2. The master execution sequence — nine stages + two parallel lanes, dependency-tight

The ROADMAP's Phases 0–9 are re-sequenced here into execution stages E0–E8 + the parallel pedagogy and unified-Excel lanes. **The mapping is 1:1 — no roadmap row is dropped or reordered except where the Stage A/B interlocks dictate.**

```
E0    Session-zero housekeeping (no app-code changes)          ──┐ can start immediately under G0 as *prep*,
E1    Zero-risk cleanup (ROADMAP Phase 0)                        │ full speed once G0 lifts
E2    Money path (Phase 1 — per-era devis fixtures; T-549)      │
E2X   STAGE A HEAD: the cap-lift precondition set —             │  T-559 → T-560 (×5) → T-594 (BUG-058)
      THE FIRST CODE THE PROGRAM WRITES                          ──┘  (top-CRITICAL; OPS-015)
E3    Backend defect repair, live SQL/EF (Phase 2 — dual-valid & PERMANENT under D-17)
E4    Structure & contracts (Phase 3)     ── after E2.2 (INV-4 predicates exist)
E5    Platform hygiene (Phase 4)          ── independent of E4 except 5.2 (sibling-repo check)
E6    Experience overhaul (Phase 5, D-19) ── T-589 (white theme) before/with E6.1; T-596 after E7A-1
E7A   STAGE A completion (Phase 6): the query-minimization cards T-590..T-593 + T-595 gates;
      the relocation lane T-573 → T-574/T-575 (+ OPS-016 unlock, ARCH-046); T-598 (G2-gated)
E7B   STAGE B (Phase 7): the pipeline P-lanes (7.1..7.5) ∥/→ T-599 LF-1 engine → T-600 LF-2 auth →
      T-601 LF-3 ports → T-602 local↔Supabase delta sync → the local seed ceremony (G2)
E8    Verification & closeout (INV-2 kill-the-network gate, the egress gates, baseline moves, register sweep)
PAR   Pedagogy lane (Phase 8, T-561..T-571) — G0-gated, own sequencing, runs parallel from E2 onward
XL    Unified-Excel lane (Phase 9, T-603..T-611) — G0-gated, own sequencing, runs parallel from E2
      onward (§13; DS/13 §8's local gates precede ANY live traffic — zero remote calls until G1–G7)
```

**Parallelism map (for multi-agent execution):** E1∥E6 can run concurrently once started (disjoint file sets, except E1's 0.2 dashboard dead-file deletion vs T-596 — sequence E1.2 first); E4∥E5 likewise; the pedagogy lane parallels E2..E7 (its T-564 = E4.2's pedagogy-side execution — coordinate, never double-touch); inside Stage B: the pipeline facades (E7B-1) ∥ LF-0 entirely; T-599 rides the one-commit path (E7B-2); T-602 consumes T-593/T-592. Never parallelize anything onto the same repository file without a merge plan.

**Effort scale:** XS ≤ 1 day · S ≤ 3 days · M ≤ 2 weeks · L ≤ 1 month · XL = the T-599 engine build. The full program is a multi-session arc; the school is never blocked mid-arc (after T-599+T-600 the desktop is fully functional locally with zero Supabase dependency for daily work; Supabase serves sync + portal).

---

## 3. The immediate queue — exactly what the first implementation session does first

Eight concrete steps, in order. Steps 1–3 are executable **inside G0** (documentation/registry only). Steps 4+ need the gate lifted (§1).

### Step 1 — Register the staged tasks (no app code touched)

Register into `docs/recovery/task-registry.md` (the repository's own `## T-NNN` convention, `Status: Not Started`, appended to `docs/recovery/next-task.md`), from the staged drafts + this plan:

- **T-549** — BUG-038 fix lane (the only red file in the full vitest ladder; baseline deviation).
- **T-550..T-553** — LF-0 steps 1–4 (ports-as-interfaces; hard-lock removal — **T-551's scope executes INSIDE T-573**, see Step 6; bypass routing; ADR adoption).
- **T-554** — LF-1 spike scoping (PGlite packaging/perf/policy-parse harnesses).
- **T-555** — reserved/unused (kept out of circulation to preserve the numbering).
- **T-556..T-560, T-572** — the standing S8–S13 queue (§11).
- **T-561..T-571** — the pedagogy lane (§10).
- **T-573..T-575** — the relocation lane (§12).
- **T-576..T-602** — the v2.0 assignments (§4's E6/E7A/E7B cards): T-576 modal cleanup · T-577 Electron UX/hygiene · T-578 Encaissement context + slider · T-579 payment-details contract · T-580 WinAnsi · T-581 backup trio · T-582 parser · T-583 startup · T-584 automation runner · T-585 AI hardening · T-586 jargon purge + formatters · T-587 per-year diagnostics · T-588 settings 8-store · T-589 white theme · T-590 dashboard aggregation · T-591 projections/pagination · T-592 delta cache · T-593 batch sync RPC · T-594 health-probe · T-595 egress gates · T-596 dashboard overhaul · T-597 OAuth switching · T-598 reconciliation oracle · T-599 LF-1 engine · T-600 LF-2 auth · T-601 LF-3 ports · T-602 delta sync.

**Apply the S6 correction first:** T-552's recorded scope ("16 bypass files") is **17** — the S4 census missed the two *dynamic* importers (`conflict-detector.ts:405`, `default-push-handler.ts:76` via `await import(...)`). Register T-552 with scope 17 and its verification grep in BOTH shapes: `rg "from.*supabase-client" src -g '!src/infrastructure/supabase/**'` (expected after completion: only `repository-provider.tsx`) **and** `rg "import\(.*/supabase-client" src -g '!src/infrastructure/supabase/**'` (expected: zero non-supabase-tree hits).

### Step 2 — Adopt the two ADR supersessions (T-553, docs-only)

Execute T-553 exactly as drafted: assign real ADR numbers, copy `ADR-002-SUPERSESSION-DRAFT.md` and `ADR-004-SUPERSESSION-DRAFT.md` verbatim into `docs/decisions/`, add pointer-lines to the originals' Status sections, annotate AGENTS.md §15.5's "canonical server implementation" language. Verification criteria are inside the drafts. **v2.0 note:** under D-17 the ADR-002 supersession text needs one amendment — the SQL authority relocates to the main process for the DESKTOP while the Supabase RPCs remain the canonical shared layer (sync + web/mobile parity); draft the amendment alongside, don't rewrite the draft's structure.

### Step 3 — Re-pin the failing baseline expectation (test infra only)

Before touching source, record the current failing set: `npx vitest run src/tests/domain/t-502-wave-meter-thresholds.test.ts` → deterministic 8/8-minus-failing red since 2026-10-16 (BUG-038's date bomb). Nothing else in the 321-file ladder is red (Session 5 census: 5,270 passed / 1 failed / 5 skipped).

### Step 4 — Execute T-549 (the BUG-038 fix)

1. `src/features/financials/installment-schedule-tab.tsx` — add optional `nowEpochMs?: number` (default `Date.now()`) to the adapter signature at `deriveTrancheWaves` (`:228-231`), thread it into the `derivePooledTrancheWaves` call at `:246`; survey the two secondary wall reads (`:330`, `:708`) — inject the same param or leave each with an explanatory comment (no behavior change in production rendering).
2. `src/tests/domain/t-502-wave-meter-thresholds.test.ts` — pass the fixed `NOW` constant into the three finance adapter calls.
3. Verify: the t-502 suite → 8/8 green; `npx tsc --noEmit` → 0; full ladder = documented baseline with an empty failing set; move `scripts/test-baseline.json` ONLY per its own `_comment` rule citing T-549.
4. Commit (`T-549: inject evaluation clock into finance wave adapter…` + the five-question body), push.

### Step 5 — Execute T-559 + T-560 + T-594 (the STAGE A head — the cap-lift precondition)

1. **T-559** (`toast-provider.tsx:57-69`): keep `show/showSuccess/showError/showWarning/showInfo/dismiss/clear` in a memo keyed ONLY on stable deps (`[show, dismiss]`); expose `toasts` through a second context (or let only the toast viewport subscribe). Verify: the 108 `useToast()` consumers typecheck unchanged; the S10 regression shape (a failing listAll behind a mounted configuration-tab can no longer re-fire the effect from toast identity alone).
2. **T-560** (the five loop-capable sites — the load-generation-ref gate, load-on-mount + explicit refresh only): `configuration-tab.tsx:73-85`, `accounts-tab.tsx:60-80`, `pricing-year-config-bar.tsx:58-63`, `promotion-cycle-detail.tsx:69-78`, `promotion-cycles-tab.tsx:53-62` (+ the identical-consecutive-error-toast dedupe). Verify: per-site effect-count tests.
3. **T-594** (BUG-058): the online-detector's `/auth/v1/health` probe (~240 doomed requests/hour in ANY mode — the third two-gates seam member) respects the effective runtime config — mock/offline mode stops the drip entirely. Verify: an offline network census shows zero probes.

### Step 6 — Execute T-550 then T-573 (the seam + the profile switcher; T-551's scope lands here)

1. **T-550** — `src/infrastructure/backend/ports.ts`: interfaces ONLY (DataBackendPort, AuthPort, SyncTransportPort, StoragePort, DiagnosticsPort; exact shapes in `LOCAL-FIRST-BLUEPRINT.md` §5); the `satisfies`-based factory exhaustiveness check on the 54-slot map (ARCH-033). Zero runtime change.
2. **T-573** — the `BackendProfile` main-process runtime config switcher (ADD-9 / the S18 §B design): a versioned profile object resolved by ONE main-process service exposed via the preload bridge; the compiled-in canonical constants (`supabase-client.ts:35-38,148-157,171-172` + the storageKey pin `:205`) demote to factory defaults; `validateConnection` (`system-config.ts:431-433`) becomes backend-kind-aware; **the `vite-env.d.ts` `window.elImtiyaz.config` declarations are KEPT and become TRUE (R-1 — do NOT delete them; only the truly-unbuilt `app`/`fs` members get a doc note)**; the packager's preflight re-points from canonical-identity to target-readiness (the OPS-016 unlock — wires to T-575). **T-551's verification criteria carry over verbatim:** typecheck + full ladder; ARCH-019 suites; the manual matrix (`local:` accepted, non-canonical `https://<x>.supabase.co` accepted, canonical URL behavior unchanged); fail-closed default backend selection preserved. Acceptance: **a packaged app can be pointed at a new Supabase project WITHOUT a rebuild.**

### Step 7 — Execute T-552 (the 17 bypass files)

Route each bypass through the port/repository surface (per-file, behavior-preserving; the F-U3/ROADMAP 5.11 diagnostics lane is included). The 17 files (S6-verified census): 9 features (`crm/excel-import-modal.tsx`, `crm/parent-detail-drawer.tsx`, `settings/backup-tab.tsx`, `settings/configuration-tab.tsx`, `settings/contextual-thresholds-config.tsx`, `settings/danger-zone-card.tsx`, `settings/supabase-diagnostics/{crud-test-tab.tsx, diagnostics-runner.ts, supabase-diagnostics-tab.tsx}`) + `shared/layout/tenant-switcher.tsx` + `infrastructure/system-config.ts` + `infrastructure/storage/media-vault.ts` + `infrastructure/ai/llm-adapter.ts` + 4 sync-family (`app/providers/sync-provider.tsx`, `infrastructure/sync/online-detector.ts`, `infrastructure/sync/conflict-detector.ts` **(dynamic)**, `infrastructure/sync/default-push-handler.ts` **(dynamic)**).
**Verification (both grep shapes, per Step 1):** static-import grep returns only `repository-provider.tsx`; dynamic-import grep returns zero non-supabase-tree hits; typecheck + full ladder + the touched features' suites.

### Step 8 — Then proceed by stage

T-554 (the LF-1 spike harnesses) or the E-lanes per §2's order — the first E-lane work is E1/E2/E2X per the dependency map. If any still-open decision's answer appeared at bootstrap, adjust §5-gated rows first.

---

## 4. Task cards by stage

Format per card: **Target** (the authoritative decision) · **Steps** (concrete migration steps) · **Verify** · **Rollback** · **Deps**. Effort scale XS/S/M/L/XL as in §2. Every card inherits the standing rules (§0). Where a card says "per AGENTS §13", register the T-task first.

### E1 — Zero-risk cleanup (ROADMAP Phase 0; nothing user-visible changes)

**E1.1 Root strays (0.1) · XS · none** — delete the root `src/` stray tree (DEAD-001/023), the stub lockfile, the empty nested file (OPS-007). Verify: typecheck clean; grep first for imports. Findings: DEAD-001/002/023, OPS-007.

**E1.2 Dead-file batch (0.2) · S · none** — delete DEAD-003 (`dashboard-tab-layout-editor.tsx`, 267 L — **the D-U5 first move of the T-596 dashboard overhaul**), DEAD-010 (`narrative-generator`), DEAD-011 (3 barrels). Steps: grep each export for call sites; delete; full vitest; baseline move citing the T-task. Findings: DEAD-003/010/011.

**E1.3 DepartmentManagement decide (0.3) · S · OWNER-GATED** — DEAD-004 — remove OR wire; default remove with a documented revert path. Findings: DEAD-004.

**E1.4 Test-only domain files relocate (0.4) · S** — move 4 domain files under the test tree; fix import paths; run vitest from new paths. Findings: DEAD-008/011.

**E1.5 Dead-symbol batch (0.5) · M** — remove ~60 dead exported symbols across core/shared/domain/features/infra (exact symbol lists in FINDINGS_INDEX DEAD-006/007/009/012 rows; DEAD-014's flag machinery joins this batch). Findings: DEAD-006/007/009/012, DEAD-014.

**E1.6 Stale doc comments (0.6) · XS** — the 7 cited sites (BUG-030). Verify: review.

**E1.7 Phantom types (0.7) · S — RESCOPED (R-1)** — the `vite-env.d.ts` `window.elImtiyaz.config` declarations are KEPT (T-573's bridge makes them TRUE — already executed at §3 Step 6); only the truly-unbuilt `app`/`fs` members get a doc note; system-config dead branches simplify. Verify: typecheck + settings config tab suite. Findings: R-3.9 → T-573.

**E1.8 Ctrl+O autofill gating (0.8) · XS** — gate to dev builds (ARCH-010, ADD-5); T-583 completes the eager-mount removal. Verify: t-399 suite + manual.

**E1.9 Broken root scripts (0.9) · XS** — remove broken one-off root scripts + stale check-supabase.ts (OPS-002/008). Verify: clone + scripts inventory.

**E1.10 Static JSON dumps (0.10) · XS** — remove 7 static JSON dumps + old-ref cleanup scripts (OPS-004). Verify: docs references updated.

### E2 — The money path (ROADMAP Phase 1)

**E2.1 t-502 settle (1.1) · M · DONE-BY-T-549** — root cause settled in S5 (BUG-038 date bomb — **not** a predicate regression, R-3); the fix is T-549 (§3 step 4). Mark ROADMAP 1.1 resolved by T-549 on completion. Findings: BUG-012 (runtime facet), BUG-038.

**E2.2 INV-4 predicate conversion (1.2) · M · after T-549** — one settled/overdue vocabulary: convert the 6+ check sites to INV-4 predicates; map `deriveDebtTriage` onto domain `computeDebtAgingStatus`; align `sumPendingPayments` pending-semantics (BUG-019); DUP-017's gating idioms fold to the feature-registry in E4.6. Verify: per-site regression tests. Findings: DUP-016/017, BUG-012, BUG-019.

**E2.3 Devis fixtures (1.3) · M** — capture current persisted shapes as equivalence fixtures **per price era (2026-2027 AND 2027-2026 configs)** — R-2's precondition. Verify: fixture suite green.

**E2.4 Devis service (1.4–1.7) · M→S→S→S · after E2.3** — `domain/calc/pricing/devis.ts` composing matrix+tuition becomes THE billing preview engine **with a per-year `pricingBasis` parameter** (`yearPricingConfigs` + the updated `2027-2026.xlsx` pricing — never cementing the stale `REAL_TUITION_BY_GRADE` 2026-2027 fallback; T-587 regenerates/deletes it in the same arc). Steps: 1) the service (policy param reproducing today's #4 wiring, priced per-era); 2) switch feature `computeBilling` preview; 3) switch `registration-billing-wires` (mapping only); 4) mock batchRegister adopts. Verify per step: equivalence suite (× two eras) / batch-registration suites / registration e2e + live-verify script / mock parity tests. Findings: DUP-001, DUP-005, ARCH-037 (R-2).

**E2.5 Formatting consolidation batch (1.8) · M** — shared primitives for isoWindow, DZD formatting, dates, attendanceRate, label maps, periodMinutes, mapStudentRow, CYCLE_OF_GRADE, toIsoDate/currentAcademicYear, WhatsApp; the BUG-014 date/timezone split folds into the shared dates primitive; **S-U1 (person display helpers), S-U4 (attendance date-key), S-U5 (contact-actions) fold here; T-586 completes the money-formatter unification (BUG-057)**. Verify: affected suites + visual spot-check of money copy. Findings: DUP-008..014, 019, 020, 022, BUG-014.

**E2.6 Client-side defect batch (1.9) · M** — each verified defect = its own T-task: BUG-001 terms, BUG-002 gpa args, BUG-003 revenue label, BUG-004 student-code filter (+Android check), BUG-005 sort, BUG-016 memo, BUG-022 names, BUG-023 nulls, BUG-024 redaction, BUG-025 header drop, BUG-026 tab sync, BUG-013 role strings, BUG-027 copy, BUG-010 (SuperAdmin stamp), BUG-020 (pricing hardcode), BUG-021 (cross-check overwrite), BUG-028 (mock refund parity). Verify: per-fix test. Findings: as listed.

**E2.7 Render-phase setState (1.10) · S** — the 5 files (BUG-011). Verify: React suites + manual.

### E3 — Backend defect repair, SQL/EF (ROADMAP Phase 2 — **dual-valid and PERMANENT under D-17**)

**E3.0 Live-vs-chain census diff (2.0) · S · G2** — run `schema_migrations` + table census diff live; chain-side numbers census-verified (100/14/5; 324 policies). OPS-010's post-commit migration edits make this diff genuinely necessary before any live DDL.

**E3.1 Workflow registry alignment (2.1) · M · E3.0** — migration adding `source_handle`, removing `has_medical_justification` + EF/client parity test (C-4, BUG-009). **The v1.x "SQL side settles at LF-3" note is superseded — the alignment is permanent; T-601 later promotes the desktop engine as the parity reference.**

**E3.2..E3.5 EF repairs (2.2–2.5) · S each · E3.0** — `run-overdue-scan` INV-4 fix (C-5, BUG-008 — **permanent: the EF serves web/mobile parity + the sync layer; the desktop's local twin lands at T-601 as the offline-first path, not as a deletion of the EF**); `collect-payment` proof-fields + `ctx.userDisplayName` + refund double-audit (BUG-007); `ai-proxy` CHECK + corsHeaders + config.toml function list + auth-hook + verify_jwt (**folds ARCH-046 — coordinate with T-590's migration files, never double-touch**) (BUG-007); `update-server-secret` FCM v1 allowlist + in-tree audit copy (BUG-007). **The v1.x sequencing note "2.3/2.4 die at LF-3 — skip if E7 green-lit" is REVERSED (D-17): execute them unconditionally.**

**E3.6..E3.9 SQL repairs (2.6–2.9) · M each · E3.0** — `register_family_batch` source_id regression + data repair (BUG-006); `create_manual_debt`/purge/`revert_payment_allocation`/debt-bulk fixes (BUG-006/018); `attendance_select` RLS tightening + **the `mv_grade_summary` unique-index restore (the T-590 REFRESH CONCURRENTLY precondition)** (BUG-006); bootstrap-9000 rewrite as fresh-clone concern (BUG-006). Each: verify SQL + evidence per §11.1.

### E4 — Structure and contracts (ROADMAP Phase 3)

**E4.1 Price-source injection (3.1) · M · BEFORE any mock work** — sever domain→mock for non-tuition charges (ARCH-001, L-1). Verify: manual-charge suites.

**E4.2 Repository interface merge (3.2) · M** — merge the C-3 contract variants; add approvals/purge domain contracts (ADD-1, DUP-002, ARCH-007). **T-564 is the same consolidation's pedagogy-side execution (P-U6) — execute as one coordinated lane, one task series.** Verify: typecheck + t-313.

**E4.3 Supabase-shared split (3.3) · M** — split `supabase-shared-repositories.ts` by repository (ARCH-008, L-7). Verify: typecheck + suites.

**E4.4 UI relocations (3.4) · M** — sync-indicator, person-navigation-context, topbar split, tenant-switcher (ARCH-003/004, L-2..L-5). (Tenant-switcher is ALSO a T-552 bypass file — coordinate: do the relocation as part of T-552 routing.)

**E4.5 Dashboard analytics → domain (3.5) · M · after E2.2** — relocate `analytics-derivations`/`executive-statistics`/`operational-query-engine` thresholds to domain with settings-sourced thresholds (ARCH-009, L-6) — **the domain-engine half of the T-596 one-engine mandate (D-U2)**. Verify: pinned-output comparison.

**E4.6 Settings gating pass (3.6) · S** — per-tab `PageTab disabled` computed from feature-registry nodes; relocate `AccessDeniedCard` to shared (ARCH-012, L-9; folds SET-U3); **fix the BUG-029 registry accuracy (4 legacy nodes vs 22 workforce permissions; the PERMANENTLY_DISABLED copy)**. Verify: RBAC suites.

**E4.7 Mock-layer decisions (3.7) · L per port · after E4.1** — the 5 live-mode mock slots get real persistence or quarantine, per feature (ARCH-006; D-6 default: persist all five — under T-599 they get local tables anyway). Verify: per-feature live verification.

**E4.8 ADR documentation batch (3.8 + carry-ins) · S** — core/ai placement ADR (ARCH-002, L-8) + the service-locator ADR (ARCH-005) + **the observable data-layer ADR (ARCH-020, F-U1 — extended by T-592's one-coherent-caching-architecture decision)** + boundaries.md shared/ rule (ARCH-013 residue) + AGENTS §15.5 annotation (T-553) + the D-17 hybrid-sync ADR (the delta-sync model of T-602). Verify: ADR review.

**E4.9 Legacy timetable stack (3.9) · S — ABSORBED BY T-569** — the legacy teacher-timetable stack removal + mock migration (DUP-021, R-2.7) executes inside T-569's phantom-write-surface deletion (M-U3); no separate task.

### E5 — Platform hygiene (ROADMAP Phase 4)

**E5.1 DB-types pipeline (4.1) · M** — generated types from the migration chain (+ optional permission-enum generation) (ADD-2/6, ARCH-014/015, DEAD-015). Verify: diff vs migrations + parity test.

**E5.2 i18n decision (4.2) · S or L · sibling-repo check** — remove the gen dictionaries (DEAD-005) or complete the T-388 apply; default: remove. Verify: i18n parity tooling. Findings: DEAD-005, R-3.8, ARCH-013.

**E5.3 Scripts consolidation (4.3) · S** — parameterized delivery-zip builder; archive apply-live family (DUP-006/007, ADD-4, OPS-003/004). **Permanent protocol (D-17): the apply-live PATTERN stays documented — only the redundant copies go.** Verify: builder output comparison.

**E5.4 Deliverables disposition (4.4) · S-M · OWNER-GATED** — purge/LFS/keep for the 985 MB `deliverables/` + Excel provenance + smartexport fix (OPS-001/005/006, L-11, ARCH-017). Default: keep, flag for owner. Verify: repo size; workflow.

**E5.5 Table/select consolidation (4.5) · L incremental** — the 40 hand-rolled `<table>` files (C-15) + 9 native-select bypasses onto shared primitives (DUP-015); **S-U3 (StudentDirectoryTable) and S-U6 (GradeTable/SubjectAverage pair) fold here progressively**. Verify: per-feature visual + a11y.

**E5.6 Governance refresh (4.6) · S** — AGENTS.md §2/§3/§17, system-map, AGENTS_supabase refs (ARCH-016, OPS-009). Verify: doc review.

**E5.7 RBAC matrix persistence (4.7) · M — ABSORBED BY T-588** — the settings 8-store unification (T-588) writes `tenant_role_overrides` directly; no separate task. (BUG-017's home moves to T-588.)

**E5.8 Import-abort fail-closed (4.8) · S · D-12 default (b) — T-557** — remove the unreachable abort enum values (DEAD-013, R-3.6). Verify: import engine tests.

**E5.9 Settings deep-link fix (4.9) · XS — ABSORBED BY T-588** — the `?tab=` mount-time effect (BUG-031 + its runtime twin BUG-043) lands inside T-588 with the SET-U4 fold.

### E6 — The experience overhaul (ROADMAP Phase 5, D-19; evidence: UI Component Audit 00–05 + DS/01/06/07 + the S11/S12 checklist)

**E6.1 Z-tokens + animation family (5.2 / UI-U1) · XS · after T-589** — named z-scale + ONE animation family (tailwindcss-animate verbs; delete the custom `slide-in-right`/`slide-out-right`/`animate-slide-up` keyframes); the literal sites (`tooltip.tsx` z-[70] ×2, `toast-viewport.tsx` z-[100], `data-inspector-core.tsx` z-[70], `modal-host.tsx` z-[90] — the last dies with T-576); `splash-screen.tsx` z-[200] stays the documented boot-layer exception. Verify: snapshot tests on the 5 shell surfaces. Findings: DUP-023/028.

**E6.2 Wizard + AutoFormModal → ModalShell (5.3 / UI-U2) · S · after E6.1** — both render through ModalShell (props stable; 24 consumers untouched). Findings: DUP-025.

**E6.3 EntityDetailDrawer → ModalShell preset (5.4 / UI-U3) · S · after E6.1** — keeps ribbon/metadata/pill-tabs/footer identity; scrim 60; responsive DrawerSize scale. Findings: DUP-024.

**E6.4 Copilot drawer port + teacher overlay (5.5 / UI-U4, D-U4) · M · after E6.3** — `copilot-drawer.tsx` ports onto the drawer preset (portal + scrim + Escape + focus-trap gained; streaming kept verbatim); teacher-dashboard fullscreen becomes a route (preferred) or a compliant surface. Findings: ARCH-021, DUP-024.

**E6.5 title= eradication (5.6 / UI-U5) · M** — native `title=` → shared Radix Tooltip, batched per feature area; **the real census is 194 occurrences across 102 files (C-10)**. Findings: DUP-026.

**E6.6 Dead modal stack + header slot (5.7) · S — folds T-576** — BUG-025 header-slot + BUG-041 `data-testid` passthrough + the dead `useModal`/`ModalHost` stack (ARCH-018) + DUP-034's bare `confirm()` → ConfirmModal. Verify: unified-modal suites.

**E6.7 Collapsible primitive (5.8 / UI-U7a) · S** — `shared/ui/collapsible.tsx` (Radix) + the ~10 hand-rolled expandable migrations (the 2-of-~10 aria-expanded gap closes). Verify: affected feature suites.

**E6.8 KPI composition (5.9 / UI-U7b) · M · D-U2 pairing** — KpiCard as composition root; ExecutiveCards (1,096 L) decomposed — **re-composed by T-596's overhaul**. Findings: DUP-027.

**E6.9 Dashboard view-models (5.10 / D-U1, F-U2) · M** — `use-overview-data`/`use-analytics-data` extract the 6 subscriptions + 2 fetch blocks from `dashboard-page.tsx` (466 L); the F-U2 heaviest pages (financials-page 18 subs, academic-year-detail-drawer 18) adopt the same idiom. Findings: DUP-029.

**E6.10 Role dashboard template (5.11 / D-U3) · M** — extract `RoleDashboardTemplate` from the 7 near-parallel personnel dashboards. Verify: role-routing suites.

**E6.11 Settings ceremony (5.12 / SET-U1+U2+U6) · M** — promote `SettingsCard`/`SettingRow` to shared; `useSettingsSection<T>` kills the per-tab load/save/toast ceremony across the 14 tabs; the `useEditModal` idiom across the 5 tab modals. Verify: settings suites + RBAC matrix tests. Findings: DUP-030.

**E6.12..E6.21 — the v2.0 experience cards (T-576..T-597, ROADMAP Phase 5 rows 5.7–5.21):**

- **T-589 · the white-theme flip (5.1) · S-M · FIRST in E6.** Target: app-wide white/light default (D-19). Steps: 1) flip the default (`index.html:2` `class="dark"` → light, `DEFAULTS.theme`, preset order with "Clair Épuré" first); 2) fix the two stale boot colors (`electron/main.cts:19` `backgroundColor:"#242526"`, `index.html:6` meta theme-color); 3) ARCH-036: add the `--brand-blue-deep`/`--brand-blue-light` `-rgb` twins + re-map the static-hex tailwind entries; 4) BUG-039: define `--radius-pill`; 5) DEAD-017: delete the accordion keyframes; 6) tokenize the hardcodes (279 hex / 24 files: `timetable-grid.tsx:80-97` 18 pastels, the duplicated divergent personnel token map → `resolveToken`, `ai/chart-svg.tsx:31-34` + `diagram-svg.tsx:26-28`, `domain/model/workflow.ts` 5 hex, `mock/workforce/index.ts`); 7) extend t-546 to pin the light surfaces + the `var(--x,#fallback)` twin parity. Verify: t-546 extended; visual review of both themes; dark mode remains selectable. Findings: D-19/§E11, ARCH-036, BUG-039, DEAD-017.
- **T-576 · modal cosmetic cleanup (5.7) · S.** BUG-041 (UnifiedModal destructures 34 known props — forward the unknown ones; `data-testid` survives) + DUP-034 (`configuration-tab.tsx:149` bare `confirm()` → ConfirmModal) + the E6.6 stack. Verify: unified-modal suites + export-dialog test.
- **T-577 · Electron main UX & hygiene (5.8) · S.** BUG-045: add `{role:"editMenu"}` (French-labeled) to `buildMenu()` (`electron/main.cts:50-78`) + a `webContents.on("context-menu")` popup in `createWindow()` — right-click Copy/Paste works on every platform, macOS accelerators live. OPS-014: `requestSingleInstanceLock`, window-state persistence, `did-fail-load` handler, `sandbox:true`, remove `toggleDevTools` from the prod View menu. Verify: manual matrix (copy-paste on Windows/macOS/Linux; second launch focuses the first instance). Findings: BUG-045, OPS-014.
- **T-586 · modal text & jargon purge + formatter unification (5.9) · M.** Steps: 1) purge the 45+ internal-jargon leaks from user-facing strings (the catalogued sites: "Reste (INV-4)", "(règle INV-14)", "(T-502)" tooltips, "(modèle officiel T-425)", "plan §18.03", "(ADR-018)/(T-413)/(T-403)", "Allocation waterfall appliquée", the ~25 stats-tips glossary entries → code comments); 2) rewrite the 5 worst text blocks (the refund LIFO/contrepassation paragraph, the tranche-edit 5-clause toasts, the anomaly-explainer wall + duplicated disclaimer, the cash-flow-radar double-parentheticals); 3) standardize Payment Details on **Prix / Prix justifié / Couverture** (three labels, ≤2 sentences per explainer, details behind InfoTip); 4) BUG-057: unify the four formatters on `formatDzd*` — kill the raw `toLocaleString("fr-FR")` NaN sites (`unified-payment-modal.tsx:494,499`, `alert-detail-modal.tsx:136,306`, `financial-query-console.tsx:124-139`, `operational-query-console.tsx:984,995`), the `fr-DZ`/`DA` variants, the locale-less form; one `DZD` suffix; clamp the percentages; compact only on KPI tiles (the A1.4 illusion fix). Verify: copy review + formatter snapshot tests. Findings: B6/E12, BUG-057.
- **T-578 · one canonical Encaissement context + slider fix (5.10) · M.** `buildFamilyCollectContext(parentId, {targetInstallmentId?})` ALWAYS derives lineItems from the real installments stream (the modal already loads it at `unified-payment-modal.tsx:171-174`) — the synthetic consolidated item (`alreadyPaidAmount: 0` — BUG-046's erased history) dies; the tranche strip is uncapped (virtualized); the DebtMeter always receives the true alreadyPaid. BUG-048: render boundary labels only when the inter-label gap ≥ label width; clamp the last label `right-0 translate-x-0`; widen the strip; drop `dueWindowLabel` under 12% segments. All 10 entry points switch to the builder. Verify: the entry-point suites + a visual matrix (the multi-tranche strip present in every family context). Findings: BUG-046, BUG-048.
- **T-579 · full payment-details contract (5.11) · M.** One shared `buildPaymentCoverage(payment, allocations, installments)` reusing the card's canonical precedence chain (`payment-breakdown-card.tsx:47-87`): 1) `generatePaymentReceiptPdf` gains the "AFFECTATION / COUVERTURE" section + check/transfer key-value blocks + "Encaissé par" + `expectedAmount`/`excessAmount`; 2) `generateAccountStatementPdf` gains coverage sub-rows; 3) `PaymentBreakdownCard` mounts in the payment-detail drawer (+ the missing `method === "transfer"` block — BUG-053) and the modal's success stage (the discarded `allocationPreview` at `:854-876`); 4) t-368 content pins (assert drawn text for checkNumber, an allocation label, "Total attendu", "Excédent"). Findings: BUG-047, BUG-053.
- **T-580 · WinAnsi crash + PDF cosmetic (5.12) · XS.** `data-inspector-core.tsx:341-357` routes through `sanitizePdfText`/`dzdPdf` (the `formatDzdPlain` U+202F hazard); `generateRevenueReportPdf`'s period label filters or drops (`global-reports.ts:50,75`). Verify: a lineage-audit PDF ≥ 1,000 DZD exports cleanly. Findings: BUG-049.
- **T-581 · backup integrity trio (5.13) · S.** BUG-050: `backup-service.ts:172` reads the key the editor writes (`el-imtiyaz:rbac-overrides`); BUG-051: the daemon reads the DB-configured schedule (kill `SCHEDULE_HOUR=2`); BUG-015: the tenant-ID/actor literals (`tenant-el-imtiyaz-oran-001`, `"usr-current"`) become injected context in the backup family. Verify: backup round-trip with RBAC overrides present; the schedule change actually takes effect. Findings: BUG-050/051/015.
- **T-582 · import number-parser hardening (5.14) · XS.** `positive-number.ts:39-43`: restrict currency stripping to trailing `DA`/`DZD` tokens (no char-class); treat `.` as thousands separator only when followed by exactly 3 digits + separator/end. Verify: the adversarial parser suite ("1D500" → error; "1.500" → 1500; "1.500,00" → error-or-1500-per-rule). Findings: BUG-052.
- **T-583 · startup acceleration (5.15) · M.** Route-level `React.lazy`/`Suspense` (the 11 routes of `app-shell.tsx:10-20`; fix `vite.config.ts:60-68`'s false comment); dynamic-import exceljs + pdf-lib (`data-inspector-core.tsx:38-39`, `ai-copilot-provider.tsx:33-40`); splash ≤1 s + dismissible (`splash-screen.tsx:33`'s 2,200 ms gate); lazy ar/en dictionaries (the gen dicts die per E5.2 anyway); the autofill eager-mount removal (E1.8 gates it — T-583 removes the static mount). Verify: before/after boot-timeline evidence; the eager-JS bundle cut (est. 40-60%). Findings: BUG-054.
- **T-584 · scheduled automation runner + working example (5.16) · M.** A runner for `scheduled`/`calendar_cron_event` triggers (a 10-min cron EF enumerating deployed scheduled workflows, or pg_cron — the S11 §F15 design); the seeded published template + the roll-call `absence_limit_exceeded` trigger + the owner-secrets doc = the working example. Verify: a scheduled workflow fires end-to-end in mock + the EF dry-run. Findings: BUG-055.
- **T-585 · AI hardening remainder (5.17) · M · after T-572.** `AbortSignal.timeout(60-120 s)` on the fetch paths (`stream-client.ts:138`, `provider-registry.ts:90`); remove the dead model metadata (`narrative-generator.ts:73-74` dies with E1.2 — remove the reference); the passphrase → `safeStorage`/OS keychain (`ai-config-storage.ts:27,85-93`); the AI-i18n decision (document French-only or route per-locale). Verify: timeout tests; the keychain round-trip. Findings: BUG-056 (non-UX half).
- **T-572 · the copilot failure UX (5.22) · S.** (a) paired-error semantics (the failed turn gets a visible assistant error message, persisted) or commit-on-success; (b) the unconfigured empty state + honest header badge (`copilot-drawer.tsx:115`); (c) `logger.warn` the failed send; (d) UPDATE `copilot-drawer.test.tsx:204-246` (replace the :245 defect pin). Findings: BUG-044.
- **T-587 · per-year diagnostics price basis (5.18) · M · after E2.4 + T-562.** Thread `yearPricingConfigs` into the diagnostics card; resolve the price basis per row's attributed year (`attributeInstallmentAcademicYear`); regenerate-or-delete `REAL_TUITION_BY_GRADE` (also the registration fallback — `school-price-matrix.ts:319-340`); the "price basis: <year>" banner; the t-529 two-era extension. Findings: ARCH-037.
- **T-588 · settings 8-store unification (5.19) · M.** system_settings becomes the single tenant-level store: 1) the RBAC matrix saves to `tenant_role_overrides` (closes BUG-017; SET-U5); 2) dead keys removed (DEAD-018); 3) the `?tab=` deep-link effect (BUG-031 + BUG-043; SET-U4); 4) the backup passphrase mirror + the daemon-schedule read wire to the DB (with T-581); 5) the 8 stores collapse (config.json/local-config/prefs/ai-config/backup/rbac/experimental/session-cache boundaries documented). Verify: settings suites + RBAC matrix tests + the enforcement-parity probe (UI gates == server RLS). Findings: ARCH-038, DEAD-018, BUG-017/031/043.
- **T-596 · the dashboard overhaul UX (5.21) · L · after T-590 + T-589.** The owner-designed dashboard: fast, minimalist, uncluttered, non-amateurish, self-explanatory for an average user — D-U1 view-model hooks (E6.9) + D-U3 RoleDashboardTemplate + the KPI/collapsible composition (E6.7/E6.8) on T-590's compact-RPC data source; **ONE single calculation engine shared by Dashboard and Payments/Finance (D-U2/L-6/E4.5) — the numbers-equal test is the acceptance gate**; the demographic/aging surfaces consume the aggregation RPCs (BUG-059's UI side). Verify: dashboard snapshot suites + the Dashboard↔Finance numbers-equal test. Findings: ARCH-040 (UX), BUG-059 (surface), D-U1..U5.
- **T-597 · OAuth switching + Gmail rebinding (5.20) · M.** D-18's lane: the Settings → Account & OAuth section (getUserIdentities/link/unlink/updateUser wiring; the dead `signInWithGoogle` at `supabase-auth-repository.ts:240-252` becomes a live Electron-callback-correct surface); the transactional `replace-user-identity` EF (create-new → re-point `user_profiles.auth_user_id` + `parents.auth_user_id` + `students.auth_user_id` + `activation_codes.bound_to_auth_user_id` → delete-old last → audit); the `OWNER_PINNED_ADMIN_EMAIL` literal (`delete-user-account/index.ts:69`) → the `is_owner_pinned` DB flag. Verify: identity-swap integration test (profile + 100% history intact; portal access preserved). Findings: D-18, DS/07 §D9-D10.

### E7A — STAGE A completion (ROADMAP Phase 6 — the query-minimization + relocation lanes; D-17's immediate lane beyond §3 Step 5)

**E7A-1 · T-590 · the dashboard server-side aggregation (6.3) · M-L.**
Target: the desktop's dashboard reads compact JSON, not full collections. Steps: 1) new migration(s) with the aggregation RPCs / validated MVs for KPI, revenue-by-month, debt-aging, demographic counts/distributions — building on the 0021→0034/0041/0049/0111-corrected chain (`compute_parent_summary`/`compute_debt_aging_rows`/scalar-subquery counts; **parameterized academic-year-range windows — never `NOW()`-anchored rolling windows; never charges-only sums; never stale-positive-only** so arbitrary year ranges work accurately); 2) **the `mv_grade_summary` unique index** (the REFRESH CONCURRENTLY precondition — after 2.8's restore); 3) the aging-convention reconciliation (0111 `MAX(due_date)` vs 0123 `min(due_date)` — one documented convention); 4) the dashboard repository consumes them (feature-flagged); 5) `dashboard-page.tsx`'s triple data path collapses (`:181-201` uncached parallel downloads, `:251-270` prev-year second-tick duplicate, `:271-276` third parallel observable path — all die; the observables' caches stay for entity details); 6) parity tests vs the client-side engines (the S8-oracle discipline) per RPC. Verify: parity + year-range tests; the egress gate (T-595) shows the dashboard class dead. Findings: ARCH-040 (data path), BUG-059, DEAD-019.

**E7A-2 · T-591 · targeted projections + keyset pagination + on-demand details (6.4) · M.**
Target: zero unbounded `SELECT *` / full-tenant downloads. Steps (the census list, both house patterns — `paginateKeyset` for entity collections, the 0123 jsonb aggregate-RPC for tenant-wide derivations): `reconcile()`'s trio (BUG-061 — column-projected RPC reads; **the integrity-check surface must not run on truncated inputs: a prerequisite of the relocation guide's Path-2 verification**); `collectDebtors()` → `read_debt_summary_collection` (BUG-060); `refreshProfile()`'s ledger+installments → drawer-open on-demand fetches (BUG-063 a/b); `fetchDocumentRows`/`fetchAcademicHistoryRows` → keyset (BUG-063 c/d); `salary_payments` → keyset (BUG-063 e); the `er_*` quartet → keyset + server-side filters (BUG-063 f); calendar payments → keyset (BUG-063 g); overdue-alerts pair → keyset (BUG-062); `inventory_items` → keyset (BUG-063 h); **the lint guard**: flag any `.from()` read chain without limit/range/keyset/count context on >1,000-row tables. Verify: per-site query-shape tests + count correctness vs the full table; the lint guard wired to CI-ish check. Findings: BUG-060..063, OPS-015 (read family).

**E7A-3 · T-592 · the incremental delta cache (6.5) · M.**
Target: the 30 s/focus re-seed volley (~13,000+ rows per cycle across 9 caches) dies; incremental deltas live. Steps: 1) the cache layer consumes the `0143` `(updated_at, id)` composite keyset cursor per table (cursor state persisted per cache); 2) intelligent invalidation — write-path-keyed (a local mutation invalidates precisely its entity entry; a sync pull patches the cache); 3) the 30 s/focus triggers become delta pulls (empty-cursor tables skip network entirely); 4) full re-seed demotes to cold-start/manual refresh; 5) **the one-coherent-caching-architecture decision:** the `QueryClientProvider` phantom mount (`main.tsx:36-45,58` — ARCH-020/F-U4/L-13) is pruned with `@tanstack/react-query` OR wired in — ONE documented architecture (`useObservable` 359 sites / 105 files + `CacheFreshness` + the ADR from E4.8); 6) under Stage B this layer becomes local-IPC-backed. Verify: delta-correctness tests (insert/update/delete propagation); the volley gone (T-595 gate); zero phantom dependencies. Findings: OPS-015 class 1, ARCH-020, DUP-029 (layer), F-U1/F-U4.

**E7A-4 · T-593 · the transactional batch sync RPC (6.6) · M.**
Target: the ~3-4-requests-per-queued-item pattern collapses. Steps: 1) new migration: `sync_apply_batch(mutations jsonb[])` — one transaction; per-mutation apply via the existing canonical RPCs (ADR-002's authority unchanged); `sync_queue` status updated in bulk; compact per-item results returned; 2) `default-push-handler.ts` groups queue entries (bounded batch size); 3) the per-item fallback path kept during soak, then removed; 4) **the 30 s local IndexedDB check stays** (it already skips network when the queue is empty; `sync-service.ts:113` poll cadence = the local trigger); 5) failure-injection tests (atomicity: a mid-batch failure rolls back the whole batch + the queue rows). Verify: batch round-trip + atomicity tests; the 1,000-row import = a handful of requests (T-595 gate). Findings: OPS-015 class 4 (the sync push pipeline).

**E7A-5 · T-595 · the egress measurement gates (6.7) · S · after E7A-1..4 + T-559/T-560/T-594.**
Target: proof, not assertion. Steps: 1) a measurement harness (boot / dashboard load / navigation / 1,000-row sync batch scenarios; request counts + payload bytes; run against mock and — in the one-time live window — against live); 2) before/after artifacts recorded under `docs/recovery/` evidence; 3) the external-dependencies register: **the client portal (`portal.elimtiyaz.dz`) and the Android repo (`Vtheonly/elimtiyaz-android`) are registered for audit — their queries join the audit set if the repos are provided** (D-17); 4) the OPS-015 four-class delta table completed. Verify: the recorded artifacts; the four classes verified dead/collapsed. Findings: §14.5, D-17, OPS-015.

**E7A-6..E7A-10 · the relocation lane (6.8–6.12): T-573 → T-574 → T-575 + ARCH-046 + T-598.**
- **T-573 (6.8) · M** — the `BackendProfile` switcher (§3 Step 6; ADD-9; supersedes T-551's scope + E1.7's deletion; the OPS-016 unlock wires here). Acceptance: the packaged app re-points without a rebuild.
- **T-574 (6.9) · M · after T-573** — the relocation auth tooling: (a) the UUID-preserving auth-user export/import command pair (admin API); (b) the email-match remap script with a dry-run report; (c) the password-reset communication flow. Evidence: the 7-surface linkage map (GUID Layer 3.1). **Path 2's prerequisite: ARCH-029/BUG-061 must be fixed first (the runbook's hard flags).**
- **T-575 (6.10) · S · after T-573** — `scripts/preflight-target.mjs` (152 migrations / 100 tables / 5 matviews / 10 buckets / RLS census / the 5 RLS helpers' SECURITY DEFINER parity — the 54001 regression / EF drift check / authenticated REST smoke / verify_t-376 12/12) wired into the packager as the preflight of record → **OPS-016 unlocks: a Windows installer buildable against a healthy target**.
- **ARCH-046 (6.11 / 2.4) · XS** — the config.toml ↔ functions/ reconciliation (delete `[functions.export-data]`/`[functions.generate-receipt-pdf]`; add `create-user-account`/`delete-user-account`/`send-push-notification`). Execute ONCE (in 2.4 or here — never both).
- **T-598 (6.12) · M · G2-gated (after T-559/T-560/T-594 + E7A-2)** — the post-cap-lift payment reconciliation oracle: the live census + full export (`payments`, `installments`, `payment_allocations`, `ledger_entries`); the offline oracle per student (Σ allocations vs payment amounts; `amount_paid > amount_due` rows — the 1,281-class legacy set; workbook TOTAL*CREANCE vs derived remaining); the repair policy (corrective `account_adjustments` with provenance, never silent rewrites; re-import idempotence); the future-anchored bucket surfaced everywhere it can confuse. Verify: the oracle report over the full export. Findings: C-21, §A1.5, DS/07 §A1.5.

### E7B — STAGE B (ROADMAP Phase 7 — the unified pipeline + local-first hybrid; D-17)

**Precondition:** T-550..T-553 + T-573 complete (§3 steps 5–7). The pipeline facades parallel LF-0 entirely; T-599 rides the one-commit path; T-601 absorbs BUG-032; T-602 consumes T-593/T-592; the local seed ceremony needs G2 + the relocation lane.

**E7B-1 · Pipeline core facades (7.1) · S** — `src/infrastructure/pipeline/` as delegating facades (StreamRegistry dual-perimeter, SchemaVersionRegistry, FormatRegistry, ChecksumService, AuditBus); `DownloadHelper` consolidates downloadBlob/export-target/replaces `downloadPdf` (12 sites) (DUP-031, R-15); `exportToCsv` dialect param (`;` FR, BOM always; copilot routed through it); uniform `pipeline.export.*` audit events (ARCH-030). Zero caller-visible change. Verify: typecheck + unit tests; byte-compare artifacts; audit assertions in t-382/t-505.

**E7B-2 · The one commit path (7.2) · M** — `VaultReplayAdapter` (snapshot → `BatchUpsertRow[]` → `RepositoryStorageAdapter`) + ImportService facade — ONE commit path for restore AND import AND sync replay; the t-421 preflight triple as the mandatory pre-write gate (R-5); the 47-row consolidation map per `02-UNIFIED-PIPELINE-DESIGN.md`. Verify: t-364/t-421 green.

**E7B-3 · T-599 · LF-1 local engine (7.3) · XL · after E7B-2** — PGlite `LocalDatabaseService` in the Electron main process (userData/el-imtiyaz/db); chain replay + `0000_local_compat` prologue (pgcrypto+pg_trgm loadable; uuid-ossp+pgjwt skip-guards; the auth-schema GUC shim for the 69 executable `auth.uid()` refs — LF0-PREP-CENSUS Part B); `LocalBackendAdapter` for the 49 overridden slots; the 5 mock-only slots get real persistence (D-6 ⏵ persist all five); IPC channels (db:request/db:changes/auth:request/media:request); single-instance lock (rides T-577); mock↔local parity suite per repository (the C-7 parity corpus as template); T-554's spike gates verified (installer <30 MB growth; t-368-scale perf; 324/324 policy parse); feature-flag: the default backend remains supabase/mock until parity green. **The desktop now reads/edits/adds/transacts locally, offline-first, zero egress on UI navigation.** Verify: chain-census gate (100/14/5); t-364/t-421 vs local; INV-2 standing. Rollback: feature flag. Findings: ARCH-006, DEAD-015, ARCH-035, ARCH-032 (vault absorption begins).

**E7B-4 · Restore unification (7.4) · L · after E7B-2** — `RestoreService` 10-step contract (pick→verify→migrate→preview→safety-backup→dry-run→staged apply→verify→commit→report; absorbs restore/inspectArchive/backup-file-restore; safety-backup refusal at service level; transactional flush) — feature-flagged; live replay target + scoped restore UI per D-8 ⏵ (enabled locally, gated multi-user); 13-stream perimeter + v1-read absence warnings (ARCH-026/R-4); archive v2 (manifest + per-stream SHA-256 + machine id; v1 read migration; tamper detection) (BUG-035/036); `RetentionPolicy` ONE definition (BUG-034, DUP-032); `WarmupService` merge of 13 sources (ARCH-027/R-11); data-export JSON v1 retirement + checkpoint relabel per D-10 + inspector honesty (BUG-033, ARCH-028, R-10); the H-9..H-16 hardening backlog in severity order. Verify: t-415 + t-300 + NEW round-trip layers; the v2-format tamper suite; retention tests. Findings: ARCH-026/027/028/029, R-1/R-4/R-5/R-7/R-9/R-10/R-11/R-12/R-13, BUG-033/034/035/036, DUP-032, D-8/D-9/D-10/D-11.

**E7B-5 · Sync dispatch declarative (7.5) · S-M** — the `SYNC_POLICY` table (5 producer / 8 push-path / 5 enum-only kinds per the S4 refinement); fail-loud default kept; expense/personnel push paths or explicit prune; drop the enum-only kinds (BUG-037, R-6). Verify: t-022/t-171/t-305/t-415-sync. **This table becomes T-602's per-entity policy foundation.**

**E7B-6 · T-600 · LF-2 auth + RBAC local (7.6) · L · after E7B-3** — `LocalAuthService`: scrypt hashes in the `users` table, session minting (the Session shape preserved — opaque tokens, the mock precedent), activation-code single-use rules (0055 semantics), the role-escalation guard imported from EF `_shared/role-assignment.ts`; the user-manager UI re-points to local tables. **D-18 AMENDMENT: Google OAuth STAYS — the linked Google identity remains live on Supabase (web portal); T-597's Account & OAuth surface manages the linkage; global sign-out = the Supabase-side token revocation broadcast through the sync channel.** Verify: RBAC suites; T-266; activation lifecycle tests. Findings: ARCH-031, DEAD-015 (the guard's new home), D-18.

**E7B-7 · T-601 · LF-3 EF ports + local storage (7.7) · L · after E7B-3** — the workflow engine promoted (the 0088 divergence fix settles DUP-003 finally — the desktop engine becomes the parity reference); the overdue scanner's desktop twin canonized (INV-4 formula) **while the EF surfaces stay live on Supabase for web/mobile parity** (DUP-004's desktop parity closes; the EF's own INV-4 fix already landed in E3.2); the cron family → main-process scheduled tasks (rides T-584's runner design); `MediaStore` local folders (absorbs the BUG-032 therapy-bytes fix as a folder migration, NOT a SQL migration); the audit writer in the adapter; financial-realtime removed → the IPC change bus. Verify: workflow parity suite (re-pointed); overdue boundary fixtures; media round-trip. Findings: ARCH-025, R-2, DUP-003/004, ARCH-032 (vault absorption completes).

**E7B-8 · T-602 · local↔Supabase delta sync (7.8) · L · after E7B-6 + E7A-3 + E7A-4** — **replaces the v1.x LF-4 relay row entirely (D-17).** Push leg: T-593's batch RPC (offline queue → batched atomic applies); pull leg: the `0143` keyset cursor (T-592's engine) with per-table sync cursors; per-entity conflict policies (financial ops = deterministic replay of the ordered log through the same local RPCs — no row merges on money data; entity edits = the existing 3-way `conflict-detector.ts`; attendance/homework LWW; append-only streams union-merge); receipt sequencing per the ADR-004 supersession; cross-device invalidation rides the sync channel; **NO VPS relay is built — Supabase IS the sync layer (D-17 supersedes D-1/D-4).** If Supabase is unreachable, only cross-machine sync pauses — the school runs (INV-2/INV-5 by construction). Verify: two-node simulation (deterministic replay proofs); conflict-resolver UI suites; offline-drain tests (t-171/t-305 patterns). Findings: D-17, the E7B-5 policy table, ADR-004 amendment.

**E7B-9 · The local seed ceremony (7.10) · M · G2 + the relocation lane** — the one-time extraction's v2.0 shape: (1) the new project healthy (T-573..T-575 + G2) → (2) the extraction script (REST `.from()` + `read_*_collection` RPCs; the 27-table writer map + RPC-read checklist of LF0-PREP-CENSUS Part A as the seed spec) → (3) seed via the ImportService commit path (T-421 preflights + per-stream verify) → (4) safety backup → (5) second PC paired via activation code → (6) two-node sync smoke → (7) the cap back on (it no longer matters for daily use). **The extraction script design remains the designated archive-side prep work if any further investigation session runs before the green-light.** Verify: chain-census + parity + INV-2 gates. Findings: D-5, LF0-PREP Part A.

### E8 — Verification and closeout

1. Full `npm test` (321 files / 5,270+ expected green / 0 failed after T-549; 5 skipped documented); baseline ledger reconciled.
2. `npx tsc --noEmit` clean.
3. **INV-2 gate** (the program's definition of success): network fully blocked on the packaged Windows build → boot, sign-in, read, write, backup, restore all work.
4. **The egress gates** (T-595's artifacts): the four OPS-015 classes verified dead/collapsed (live numbers from the one-time window).
5. **The numbers-equal test** (T-596's acceptance): Dashboard and Payments/Finance render identical totals for the same query.
6. FINDINGS_INDEX sweep: every one of the 190 registered IDs moved to its terminal state (done / documented / owner-gated); corrections C-1..C-22 + the v2.0 reconciliation register R-1..R-5 recorded.
7. Final self-audit: only `Investigation Archive/` + `Refactoring Unified/` were ever touched during the investigation + blueprint phases; execution-phase commits cite T-tasks throughout.

---

## 5. Decision gates — the D-1..D-19 digest (full packet: `Investigation Archive/OWNER-DECISION-PACKET.md`)

| ID | Question | State |
|---|---|---|
| **D-17** | Sync topology / Supabase retention | **LOCKED IN (Part F): the hybrid** — offline-first desktop + lightweight Supabase sync + web portal; no relay; Supabase never dropped |
| **D-18** | Google OAuth | **LOCKED IN (Part F): STAYS** — the T-597 switching/rebinding lane |
| **D-19** | Theme / dashboard / modal copy | **LOCKED IN (Part F): white-light + overhaul + purge** — T-589/T-596/T-586 |
| D-1 / D-4 | Relay topology / one self-hosted service | **SUPERSEDED by D-17** (the VPS relay designs die; T-602 replaces ROADMAP 7.4) |
| D-2 / D-3 | Android cloud access / FCM push | Dissolved as relay questions — the Android app + portal consume Supabase directly; FCM stays via `update-server-secret` |
| D-5 | Cap lift vs stopgap | ⏵ lift ONCE for the local seed + T-598 (after T-559/T-560/T-594); no stopgap plan |
| D-6 | Mock-slot features | ⏵ persist all five (T-599's slot list) |
| D-7 | Google OAuth (old default) | **SUPERSEDED by D-18** |
| D-8 | Live-restore semantics | ⏵ enabled locally, gated multi-user (E7B-4's UX copy) |
| D-9 | Server metadata mirror | ⏵ drop `backup_archives` at Stage B completion (T-602); the vault is authoritative |
| D-10 | Checkpoint honesty | ⏵ relabel (E7B-4) |
| D-11 | `debtSummaries` | ⏵ derived (E7B-4's perimeter) |
| D-12 | Import-abort modes | ⏵ (b) remove (T-557/E5.8) |
| D-13..D-16 | Curriculum recipe / junction / teacher fields / portal seam | ⏵ staged (Part E; T-566/T-568/T-569/T-570) |

**Standing owner actions (no decision needed):** OPS-012 rotate/redact the committed credential sheet; OPS-013 the Vercel PAT is VALID (rotated by the owner — S13 re-test) — rotate only if the website workflow needs it; OPS-011 the Supabase management token tests invalid — REST with the secret key works once the cap lifts; a fresh valid management token only enables the census ceremony.

---

## 6. Finding → action traceability matrix (v2.0 — ALL 190 registered IDs → their execution homes)

**Registered set:** DEAD-001..015, 017..023 (22) · DUP-001..032, 034..036 (35) · ARCH-001..046 (46) · BUG-001..065 (65) · OPS-001..016 (16) — **184**. (DEAD-016 and DUP-033 were never assigned — skipped placeholders in the numbering; DEAD-024/DUP-037/ARCH-047/BUG-066/OPS-017 are the next free.) "Doc" = documentation-only disposition. "Owner" = owner-gated (§5). Orphan check: **zero** — every registered ID has a home below.

| Finding IDs | Execution home | Notes |
|---|---|---|
| DEAD-001/002/023, OPS-007 | E1.1 | root strays |
| DEAD-003 | E1.2 | dead files (D-U5 — the T-596 first move) |
| DEAD-004 | E1.3 (Owner) | remove-or-wire |
| DEAD-005, R-3.8 | E5.2 (sibling-repo check) | i18n dicts |
| DEAD-006/007/008/009/012/014 | E1.5 | symbol batches |
| DEAD-010/011 | E1.2/E1.4 | narrative-generator + barrels / test-only relocation |
| DEAD-013, R-3.6 | E5.8 / T-557 (D-12) | fail-closed |
| DEAD-015 | E5.1 (ADD-2) + T-599 | the stale hand-written types die at generation; the guard promotion rides LF-1 |
| DEAD-017 | T-589 | accordion keyframes |
| DEAD-018 | T-588 | dead system_settings keys |
| DEAD-019 | T-590 | the MV estate becomes the desktop's server-side reporting layer |
| DEAD-020 | T-568 (D-14 ⏵ adopt) | parent_student_links |
| DEAD-021/022 | T-570 | the dead-store drops (after the greps) |
| DUP-001, DUP-005 | E2.4 | devis service (per-year pricing basis) |
| DUP-002 | E4.2 ∥ T-564 | repository contracts (one coordinated lane) |
| DUP-003 | E3.1 + T-601 | workflow triplication (SQL alignment, then desktop canonization) |
| DUP-004 | E3.2 + T-601 | overdue EF parity (permanent + desktop twin) |
| DUP-006/007, ADD-4, R-4.1/4.2 | E5.3 | scripts |
| DUP-008..014, 019, 020, 022 | E2.5 | formatting batch |
| DUP-015 | E5.5 (+ S-U3/S-U6) | table/select consolidation (40 files, C-15) |
| DUP-016, BUG-012 | E2.2 (+T-549) | INV-4 vocabulary |
| DUP-017 | E2.2 / E4.6 | gating idioms |
| DUP-018 | Doc (E4.8 registers; E3 consolidates the redefinitions) | SQL redefinition census |
| DUP-021, R-2.7 | T-569 (absorbs E4.9) | legacy timetable family |
| DUP-023/028 | E6.1 | z/animation tokens |
| DUP-024 | E6.3/E6.4 | drawer unification |
| DUP-025 | E6.2 | modal shells |
| DUP-026 | E6.5 | title= eradication (194/102, C-10) |
| DUP-027 | E6.8 + T-596 | KPI composition |
| DUP-029 | E6.9 + T-592/T-596 | view-model hooks + the cache layer |
| DUP-030 | E6.11 + T-588 | settings ceremony + store unification |
| DUP-031 | E7B-1 | download/csv helpers |
| DUP-032 | E7B-4 | retention single definition |
| DUP-034 | T-576 | bare confirm() |
| DUP-035 | T-565 | filières drift-guard |
| DUP-036 | T-569 | phantom teacher entity |
| ARCH-001, L-1 | E4.1 | price-source injection |
| ARCH-002, L-8 | E4.8 | core/ai ADR |
| ARCH-003/004, L-2..L-5 | E4.4 | UI relocations |
| ARCH-005 | E4.8 | service-locator ADR |
| ARCH-006 | E4.7 → T-599 final | mock slots (D-6 ⏵ persist all five) |
| ARCH-007 | E4.2 | repo interface merge (ADD-1) |
| ARCH-008, L-7 | E4.3 | supabase-shared split |
| ARCH-009, L-6 | E4.5 + T-596 | dashboard→domain (the one-engine mandate's half) |
| ARCH-010, ADD-5 | E1.8 (+ T-583 completes) | Ctrl+O gating |
| ARCH-011 | E2.6 (own T-task) | /personnel route gating fix |
| ARCH-012, L-9 | E4.6 / E6.11 (+ T-588) | settings gating |
| ARCH-013 | E5.2 + E4.8 | i18n architecture |
| ARCH-014/015, ADD-2/6 | E5.1 | generated DB types |
| ARCH-016, OPS-009 | E5.6 | governance refresh |
| ARCH-017 | E5.4 (Owner) | repo hygiene |
| ARCH-018 | E6.6 / T-576 | dead modal stack |
| ARCH-019 | T-552 (+ E4.4 tenant-switcher) | bypass routing (17 files) |
| ARCH-020 | E4.8 + T-592 (F-U1/F-U4/L-13) | the data-layer ADR + the one-caching-architecture decision |
| ARCH-021 | E6.4 | copilot/teacher overlays |
| ARCH-022/023/024 | T-573 (absorbs T-551) | the hard-lock dies inside the profile switcher |
| ARCH-025 | T-601 | RPC-only tables (local DB runs them) |
| ARCH-026, R-4 | E7B-4 | 13-stream perimeter |
| ARCH-027, R-11 | E7B-4 | warmup merge |
| ARCH-028, R-10 | E7B-4 | data-export honesty |
| ARCH-029, R-1 | E7B-4 (+ T-574's Path-2 prerequisite) | restore replay |
| ARCH-030 | E7B-1 | export audit events |
| ARCH-031 | T-600 (amended: OAuth stays — D-18) | local auth |
| ARCH-032 | T-599 + T-601 | vault main-process absorption |
| ARCH-033 | T-550 | 49-key exhaustiveness (`satisfies`) |
| ARCH-034 | T-573 | phantom preload API → the real bridge (R-1) |
| ARCH-035 | T-599 gate | PGlite extension census (pre-verified: no blocker) |
| ARCH-036 | T-589 | brand-token -rgb parity |
| ARCH-037 | T-587 + E2.4 (R-2) | per-year price basis |
| ARCH-038 | T-588 | settings 8-store unification |
| ARCH-039 | T-562 | the second attribution chain dies |
| ARCH-040 | T-590 (data path) + T-596 (UX) | the dashboard's triple data path + the overhaul |
| ARCH-041 | T-561 | the level value spaces |
| ARCH-042 | T-566 | curriculum coverage (D-13 ⏵ composite) |
| ARCH-043 | T-562 | the period-grid fold |
| ARCH-044 | T-569 | teacher model inversion |
| ARCH-045 | T-570 | the enrollment chain |
| ARCH-046 | E3.3 (2.4) / E7A-6 | config.toml ↔ functions/ (execute once) |
| ARCH-047 | T-603/T-604/T-605 | the format-registry reject gate + year attribution + variant table |
| ARCH-048 | T-608/T-609 | CLIENT CRITIQ + document-sheet canonical targets |
| BUG-001..005, 010, 013, 016, 020, 021, 022..027 | E2.6 | per-fix T-tasks |
| BUG-006/018 | E3.6..E3.9 | SQL repairs (permanent) |
| BUG-007 | E3.2..E3.5 | EF repairs (permanent — D-17) |
| BUG-008, C-5 | E3.2 (+ T-601 desktop twin) | overdue EF |
| BUG-009, C-4 | E3.1 | workflow registry |
| BUG-011 | E2.7 | render-phase setState |
| BUG-014 | E2.5 (S-U4) | date/timezone split |
| BUG-015 | E2.6 + T-581 | literals (backup trio) |
| BUG-017 | T-588 (absorbs E5.7) | RBAC persistence |
| BUG-019 | E2.2 | pending semantics |
| BUG-025 | E6.6 / T-576 | header slot |
| BUG-026 | E2.6 | ClassDetailPage deep-link |
| BUG-028 | E2.4 | mock refund parity |
| BUG-029 | E4.6 | registry accuracy (4 legacy nodes vs 22 permissions) |
| BUG-030 | E1.6 | stale comments |
| BUG-031 (+BUG-043) | T-588 (SET-U4) | settings deep-link + its runtime twin |
| BUG-032, R-2 | T-601 (supersedes the 6.16 plan) | therapy bytes |
| BUG-033 | E7B-4 | checkpoint/import schema honesty |
| BUG-034, R-8 | E7B-4 | retention |
| BUG-035/036 | E7B-4 | archive v2 |
| BUG-037, R-6 | E7B-5 (+ T-602) | sync coverage |
| BUG-038 | T-549 (§3 step 4) | the date bomb |
| BUG-039 | T-589 | --radius-pill |
| BUG-040 | T-556 | contact backfill |
| BUG-041 | T-576 | data-testid passthrough (C-19) |
| BUG-042 | T-559/T-560 | toast-churn family (the five sites) |
| BUG-044 | T-572 | copilot failure UX |
| BUG-045 | T-577 | editMenu/context-menu |
| BUG-046 | T-578 | the erased payment history |
| BUG-047 | T-579 | PDF detail fields |
| BUG-048 | T-578 | slider labels |
| BUG-049 | T-580 | WinAnsi crash |
| BUG-050/051 | T-581 | backup key + schedule |
| BUG-052 | T-582 | number parser |
| BUG-053 | T-579 | transfer block + breakdown card |
| BUG-054 | T-583 | startup |
| BUG-055 | T-584 | automation runner |
| BUG-056 | T-572 + T-585 | AI hardening (UX + remainder) |
| BUG-057 | T-586 | formatter unification |
| BUG-058 | T-594 | health-probe drip |
| BUG-059 | T-590 | demographics/attendance truncation |
| BUG-060..063 | T-591 | the truncation family |
| BUG-064 | T-567 | classless import |
| BUG-065 | T-561 (precondition) | medical-bridge parity test |
| BUG-066 | T-604 | multi-sheet year-archive ledger pollution (188 mismatches) |
| BUG-067 | T-603 | EGV mis-detection + column-shift corruption |
| BUG-068 | T-605 | 3rd ETAT variant ancillary mis-mapping |
| OPS-001/005/006, L-11 | E5.4 (Owner) | deliverables |
| OPS-002/008 | E1.9 | broken scripts |
| OPS-003/004 | E5.3 | scripts archive (the pattern stays — D-17) |
| OPS-007 | E1.1 | stub lockfile |
| OPS-009 | E5.6 | governance refs |
| OPS-010 | Doc — ceremony context for E3 | migration history drift |
| OPS-011 | Gate tracker (G2; re-probe every session; `01-INFRASTRUCTURE-STATUS.md`) | quota restriction |
| OPS-012 | Owner — rotate/redact credentials | committed credentials |
| OPS-013 | Owner — Vercel PAT VALID (rotated); mgmt token invalid | credential scorecard |
| OPS-014 | T-577 | Electron hygiene |
| OPS-015 | T-595 (the budget record + the measurement gates) + the §1/§2 sequencing constraint | the egress budget |
| OPS-016 | T-573/T-575 | the packager unlock |
| R-1..R-15 (pipeline hardening) | E7B-1..E7B-4 as mapped above | the 02-UNIFIED-PIPELINE-DESIGN backlog |

---

## 7. Full-app migration impact map (what each stage touches, app-wide)

| Area | Touched by | Nature of impact |
|---|---|---|
| `src/shared/ui/**` | T-589, E6.1–E6.7, T-576 | light-theme tokenization; z-scale; ModalShell the single skeleton; no contract breaks (props stable) |
| `src/features/dashboard/**` (40 files) | E1.2, E4.5, T-590, T-596, E6.8/E6.9 | dead-file deletion; analytics → domain; compact-RPC data source; the overhaul |
| `src/features/personnel/dashboards/**` (9) | E6.4, E6.10 | template extraction; teacher overlay compliance |
| `src/features/settings/**` (39) | E4.6, T-588, E6.11, T-552, T-597 | gating; 8-store unification; ceremony; bypass routing; Account & OAuth |
| `src/features/financials/**` | T-549, E2.2, E2.4, E6.8, T-578/T-579/T-586 | wave adapter clock; INV-4; devis; KPI cards; the payment-clarity UX + copy |
| `src/features/crm/**` | E2.4, E2.6, T-552, T-578 | billing wires; defect fixes; bypass routing; the canonical Encaissement context |
| `src/features/academics/**` | T-561..T-571, T-601 | the pedagogy lane; `fn_*` RPCs keep running locally |
| `src/features/ai/**` | T-552, E6.4, T-572/T-585 | llm-adapter routing; drawer compliance; failure UX + hardening |
| `src/infrastructure/supabase/**` (42 files/26,684 L) | T-552/T-573, E3, E7A-1/2/4, T-599, T-602 | profile switcher; permanent EF/SQL repairs; aggregation + batch RPCs; the local adapter; the delta sync |
| `src/infrastructure/{backup,pipeline}/**` | E7B-1..E7B-4 | ONE commit path; RestoreService; archive v2 |
| `src/infrastructure/sync/**` | T-592/T-593/T-594, E7B-5, T-602 | the delta cache; the batch RPC; the probe fix; the policy table; the delta sync |
| `src/infrastructure/mock/**` | E7B-3 parity corpus | stays as dev/test mode permanently |
| `electron/main.cts` + `preload.cts` | T-573, T-577, T-599, T-584, T-585 | BackendProfile; UX/hygiene; LocalDatabaseService + IPC; the scheduler; safeStorage |
| `supabase/migrations/**` (152) + EFs (16) | E3, T-590/T-591/T-593, T-597, ARCH-046 | append-only repairs + the Stage A RPCs + `replace-user-identity`; all permanent |
| `src/tests/**` (321 files) | every stage | the safety net; baseline moves at batch boundaries |
| Sibling repos (Android / web portal) | §10 cross-platform rule | unchanged Supabase consumers (D-17); Stage A's RPCs serve them for free; register divergences |

---

## 8. Verification ladder reference (commands; from the archive's runtime-evidence records)

```bash
cd elimtiyaz-desktop
npx tsc --noEmit                                      # typecheck gate (every commit)
npx vitest run <suite>                                # touched-feature suites (every commit)
npm test                                              # full ladder (batch boundaries; ten-shard pattern if timeouts — S5-VITEST-CENSUS)
npx vitest run src/tests/domain/t-502-wave-meter-thresholds.test.ts   # the T-549 acceptance suite (8/8)
rg "from.*supabase-client" src -g '!src/infrastructure/supabase/**'   # T-552 completion (expect: repository-provider.tsx only)
rg "import\(.*/supabase-client" src -g '!src/infrastructure/supabase/**'  # T-552 completion, dynamic shapes (expect: zero)
rg 'title=' src --glob '*.tsx' -c                     # T-596/E6.5 progress (baseline 194 across 102 files)
```

Standing gates at every phase boundary: typecheck + full suite → INV-2 (kill-the-network on the packaged build) → the egress gates (T-595) → mock-parity (per repository slot) → chain-census (100/14/5; 324/324 policies parse) → money-parity (ADR-002 suites unchanged) → the numbers-equal test (T-596) → kill-switch rollback (previous backend selectable).

---

## 9. Register upkeep and escalation (the implementation session's bookkeeping)

1. **Before starting:** §0 bootstrap (fetch, status, README → SESSION_LOG → handoff → this file → Issue #32 → probes → `01-INFRASTRUCTURE-STATUS.md` update).
2. **Every completed task:** T-task status in `docs/recovery/task-registry.md`; FINDINGS_INDEX row state; one commit + push.
3. **New discoveries during execution:** register as new finding IDs (next free after S18: DEAD-024, DUP-037, ARCH-047, BUG-066, OPS-017) with file:line evidence; corrections from C-23 onward. Never erase prior records.
4. **Token hygiene before every push:** `rg "sb_secret|sbp_|ghp_|vcp_|AIza" --glob '!node_modules'` — investigate every match; the standing archive hits are documentation-text false positives (verified S5; re-verify if the pattern set changes).
5. **Owner escalation:** anything gated in §1/§5 that blocks progress gets posted to Issue #32; work continues on unblocked stages meanwhile.
6. **Session closeout:** session report + next handoff in `Investigation Archive/Session Reports/` + `Handoffs/`; SESSION_LOG row; push to `main`; never force-push.

---

## 10. The pedagogy-unification lane (T-561..T-571 — folded v1.1, corrected v2.0)

**Origin:** the owner's dedicated **Pedagogy Unification, Relational Linking & Legacy Deletion** mandate (Merge + Connect + Delete). Evidence base: `Deep Sweep/10` (the entity census + P-U1..P-U8) + `Deep Sweep/11` (the relational layer: M-U1..M-U10, the merge mechanics §3 with per-family conflict rules, the exhaustive REMOVE/DELETE manifest §4 with pre-deletion dependency proofs + the §4.4 post-deletion verification checklist). Gates: **G0 governs this lane exactly as it governs the rest**; D-13..D-16 carry ⏵ defaults so the lane is fully decidable.

**Sequencing:** T-561 → (T-562 ∥ T-563 ∥ T-564 ∥ T-565 ∥ T-568) → (T-566 ∥ T-569) → T-570 → T-567 → T-571. Hard constraints: P-U1/T-561 before the importer T-567; **Phase-4 greps return clean BEFORE any Phase-5 deletion executes** (DS/11 §4.3); OPS-015's cap-lift sequencing is untouched by this lane. **The lane parallels E2..E7 from PAR onward** (T-564 = E4.2's pedagogy side; T-562 feeds T-587/T-590's year-range queries).

**The task cards (the P-U/M-U folded set):**

- **T-561 · P-U1 + M-U2 — the GradeLevel spine + the staff-category vocabulary · M.** `GradeLevel` (14 codes) becomes the only stored level on students/classes/subjects/placement; AcademicCycle + the 3-value AcademicLevel become derived view-models; the legacy `level+gradeYear` pair, `AcademicCycleLegacy`, and `grade_level_code` migrate off (DS/10's ~15-file site list); the prescolaire special-case deletes. PLUS the StaffCategory collapse to the 4 DB CHECK values, the `CATEGORY_TO_DB/FROM_DB` bridge deletion, the **8** dual-condition UI filters unified on `isTeaching()` (DS/11 §2 M-U2; the S16 correction: + class-detail-page.tsx:205 + academic-year-detail-drawer.tsx:248) — **with the BUG-065 medical→medical round-trip parity test landed BEFORE the bridge deletes**. Verify: tsc 0; the GRADE_LEVELS↔academic_levels drift guard; the promotion suites; zero-remnant greps.
- **T-562 · P-U2 — the AcademicYearContext · S.** One year-resolution service (id-canonical, `isCurrent`-sourced); `DEFAULT_ACADEMIC_YEAR` + `resolveBillingAcademicYear` delete (billing-breakdown.ts:337/365); TEXT-code keys written/read THROUGH the service; the ARCH-043 period-grid parameterization folds at this seam. Verify: the payments↔scolaire seam test. **Closes ARCH-039 + ARCH-043.**
- **T-563 · P-U3 — the external class-code alias · S.** `classes.external_code` + unique per year + the UI label beside the app code; used by the importer for matching. No data migration.
- **T-564 · P-U6 — the repository contract consolidation · XS-S.** Delete the five duplicate interface declarations in `repository.ts:264-333` (+HomeworkRepository :376-389); `academic-repository.ts` becomes the only contract file; the provider slots re-type; the AttendanceRepository ×3 family splits by name. **Closes DUP-002 (= E4.2's pedagogy side).**
- **T-565 · P-U7 — the filières drift-guard · XS.** The test asserting `FILIERES`/`SPECIALITES` ↔ migration 0107 row-set equality. **Closes DUP-035.**
- **T-568 · M-U4 — the parent_student_links adoption · S-M · D-14 (⏵ adopt).** The backfill migration (DS/11 §2.1 SQL — one `is_primary=true` link per live student from `students.parent_id`, `ON CONFLICT DO NOTHING`); `parents.relationship` migrates onto the link rows then drops; the primary-pointer invariant (trigger recommended); guardian/sibling reads for the parent surfaces (CRM drawer + portal). Verify: links row-count = the pre-backfill count; the invariance test; the t-416 purge scripts still coherent. **Closes DEAD-020.**
- **T-566 · P-U4 — curriculum & assessment coverage · M-L · D-13 (⏵ A: the composite recipe).** The 4 missing subjects (محاسبة/مناجمنت/القانون/الأسبانية) + the recipe-component vocabulary (the workbook's 8 families) + the assessments mark columns (the cc precedent 0094) + the DB trigger generalization; confirm تكنولوجيا ≡ INFORMATIQUE with the school (non-blocking). Deps: T-561. **Closes ARCH-042.**
- **T-569 · M-U1/M-U3 — the teaching-staff consolidation · M · D-15 (⏵ delete the phantom).** `TeachingStaffService` lands (personnel + category/role + derived assignments + homeroom + timetable projections); the phantom year-scoped Teacher write-surface deletes (the 47-reference/10-file census — model/validation/supabase-rejection-strings/mock/UI/tests); `TeacherSubjectAssignment` + the legacy timetable family (DUP-021 = the absorbed E4.9) delete; `homework.teacher_id` gains its FK (the 0113 pattern: orphan pre-clean incl. the user_id-vs-personnel id-space check, then guarded ADD + VALIDATE); the mock layer simplifies to personnel + class_subjects. Verify: t-408 audit semantics unchanged; the teacher-repository integration suite; the T-500 staff register; zero-remnant greps. **Closes ARCH-044, DUP-036, DUP-021.**
- **T-570 · M-U5..M-U8 — EnrollmentService + the dead-store drops · M.** `EnrollmentService` composes the three time-frames of ONE chain (CURRENT `class_id`+spine / PAST histories / FUTURE re-enrollments) — **no new enrollments table**; `service_enrollments` documented as the portal seam (D-16 ⏵ keep); the enrollment-status vocabulary unifies on the DB 6-value set. THE DEAD DROPS EXECUTE HERE, ONLY AFTER the Phase-4 greps: `grades` (DEAD-021) and `academic_history` (DEAD-022) — each archive → merge-under-conflict-rules → DROP with triggers/indexes; the purge-script coverage census precedes each DROP. Verify: the full DS/11 §4.4 checklist (a–h: builds, promotion E2E, teacher-is-worker, parent↔student↔pedagogy traversal incl. multi-guardian, orphan SQL, drift guards, zero-remnant greps, the S8 oracle as the finance negative control). **Closes ARCH-045, DEAD-021/022.**
- **T-567 · P-U5 — the pedagogy-workbook importer · M.** The S8-proven engine + a new import-config family (block-header parsing الشعبة/القسم → filière + level + external class code; roster rows → student upserts WITH class resolution — the BUG-064 fix generalized; `معدل` columns IGNORED on import, recomputed by the app's engines). Deps: T-561, T-563, T-566(a). **Closes BUG-064.**
- **T-571 · M-U9/M-U10 + P-U8 — the ADR batch + the lane's exit gate · S.** The one-page ADRs (the three domain-separation seams + the projection whitelist); the full §4.4 re-run as the lane's closure; register closure in the archive.

**Register linkage:** DEAD-020..023, ARCH-044/045, DUP-036 (S15) + BUG-064, DUP-035, ARCH-041..043 (S14); the DS/12 §3 [S-A]/[S-B] re-verification is DISCHARGED (20/20 personally re-read at HEAD `3e6ad7b9`) — the executor inherits a fully personal-read evidence base.

---

## 11. The standing S8–S13 queue (T-555..T-560, T-572 — folded at Session 16; scope corrections intact)

**Sequencing within the folded set:** T-559 → T-560 (×5 sites) — both BEFORE any cap lift; T-556/T-557/T-558 independent import-engine items (T-557 wants the owner's fail-closed-vs-remove call — D-12); T-572 independent. **T-555 stays reserved/unused.**

- **T-559 · BUG-042 root fix — split the toast context · XS-M · THE top CRITICAL.** `toast-provider.tsx:57-69`: keep `show/showSuccess/showError/showWarning/showInfo/dismiss/clear` in a memo keyed ONLY on stable deps (`[show, dismiss]`); expose `toasts` through a second context (or only the toast viewport subscribes). After this, every consumer's `showError` is referentially stable and the ENTIRE churn family dies: the five loop-capable effects (T-560's set), the `askAgent`/`answerClarification` identity churn (`ai-copilot-provider.tsx:582`), and the BUG-044 loop vector. Verify: the 108 `useToast()` consumers typecheck unchanged; the DS/06 §3.2 exit criteria.
- **T-560 · BUG-042 family loop breakers — ALL FIVE SITES (DS/12 §2).** The load-generation-ref gate on: configuration-tab.tsx:73-85, accounts-tab.tsx:60-80, pricing-year-config-bar.tsx:58-63, promotion-cycle-detail.tsx:69-78, promotion-cycles-tab.tsx:53-62 (+ optionally the identical-consecutive-error-toast dedupe). Defense-in-depth behind T-559; REQUIRED before any cap lift if T-559 is deferred.
- **T-556 · BUG-040 contact backfill on placeholder-family merge · S.** In `processEtatFamily`: when a phone-bearing row resolves to a placeholder family, `updateParent(parent.id, { phone, email })` before the student upsert; pin with the B-test. Shape: DS/04 §7.1.
- **T-557 · dead-abort-mode removal · S · D-12 default (b).** Remove the dead `ATOMIC_IMPORT_ABORTED`/`STRICT_MODE_REJECTED` branches + the no-op `strict` option (DEAD-013), OR restore fail-closed row-rejection behind a config flag (the owner call — stage beside the D-packet question). Shape: DS/04 §7.2.
- **T-558 · dry-run audit tag · XS (cosmetic).** Suppress `import.run_completed` for dry-runs or tag it `dry_run: true`. Shape: DS/04 §7.3.
- **T-572 · BUG-044 the copilot failure UX · S (DS/12 §1.3).** The card is E6.21's (§4). Feeds T-585's follow-ups unchanged.

**Register linkage:** BUG-042/044/065, BUG-040, DEAD-013, BUG-056/058, OPS-015 (sharpened to the five-loop family).

---

## 12. The Supabase-relocation lane (T-573..T-575 — folded at Session 18; the Stage A portability core)

The owner's focused relocation mandate produced `Investigation Archive/SUPABASE-RELOCATION-AND-RELOAD-GUIDE.md` — the operational successor to the S13 RELOCATION-RUNBOOK, with the six-layer audit personally verified at HEAD `6c0b007e`. The execution-relevant outcomes:

- **OPS-016:** the Windows packager (`build-windows.mjs:80-97`) runs a LIVE preflight against the canonical project and fails on any non-200 — **no Windows installer buildable while the old project 402s**. Disposition: folded into T-573 (the preflight becomes a target-readiness check — wired to T-575).
- **ARCH-046:** config.toml ↔ `supabase/functions/` drift. Disposition: reconcile in the first SQL/EF touch (E3.3's 2.4 or E7A-6 — once).
- **T-573:** the BackendProfile service — **the runtime credential/endpoint switch; supersedes T-551's scope and E1.7's declaration deletion (R-1: the declarations stay and become TRUE); the single-source fix generalizing the T-559/T-560/BUG-058 family.** Acceptance: a packaged app re-points WITHOUT a rebuild; the packager validates the effective profile.
- **T-574:** relocation auth tooling — (a) the UUID-preserving auth-user export/import pair (admin API); (b) the email-match remap script with a dry-run report; (c) the password-reset communication flow. Evidence: the 7-surface `auth.users` linkage map (Layer 3.1).
- **T-575:** the one-command target preflight — `scripts/preflight-target.mjs` (152 migrations / 100 tables / 5 matviews / 10 buckets / RLS census / the 5 helpers' SECURITY DEFINER parity — the 54001 regression / EF drift / authenticated REST smoke / verify_t-376 12/12); wired into the packager as the preflight of record.
- **Sequencing note:** the guide's §A.0 preconditions restate the OPS-015 order (T-559/T-560 + BUG-058 before ANY live traffic); ARCH-029/BUG-061 are prerequisites of the guide's Path-2 emergency recovery and remain in their registered lanes (E7B-4 / E7A-2).
- **Positive finding (no action):** storage paths are bucket-relative everywhere — no URL-rewrite pass is ever needed in a relocation; preserve the invariant with a lint guard when convenient.

**Register linkage (S18):** OPS-016, ARCH-046; re-cited: OPS-011/015, BUG-042/058/061, ARCH-029, C-20, DEAD-019/023.

---

## 13. The unified-Excel-engine lane (T-603..T-611 — folded at Session 23; evidence: Deep Sweep/13 + Excel_Inspection/s23)

The owner's unified-Excel mandate ("ALL Excel spreadsheet processing engines unified… ALL supported Excel formats resolve through ONE unified underlying entity-resolution and financial-semantic model… performance a top priority") produced Deep Sweep/13 — the audit of record for this lane. The load-bearing discoveries: the S8 baseline STANDS (the two registered formats re-proven oracle-exact at 100% of rows; re-import a perfect no-op; the injected flush failure surfaces the honest `ÉTAT PARTIEL` sentence; rollback deletes every run-created row), while the new owner upload `ETAT 2024 -205.xlsx` is a 21-sheet historical archive whose default file-drop imports 7 sheets / 5,021 rows and **corrupts the money** (BUG-066/067/068: 188 current-year balance mismatches; EGV's mis-mapped import fabricates ≈ +281.6 M DZD charges / −68.3 M DZD refunds and silently drops ≈ 155 M DZD of real tuition payments; the 3rd variant's LIVRES data lands as psychology). `CLIENT CRITIQ` — the genuinely new family-level financial format — is entirely unsupported (23 families / 48 children / 31,584,600 DZD).

**The design of record (DS/13 §5, the X-lane):** format Adapters (one per format family — layout knowledge ONLY, incl. the mandated CLIENT CRITIQ family-level adapter) → **one Canonical Normalized Import Record** (student/guardian/charges/payments/tranches/totals) → **ONE unified entity-resolution pipeline** (the `domain/identity` ER-PMAE engine graduates from experimental to THE resolver: auto-accept definite / propose probable+review / legacy exact fallback; BatchParentIndex becomes its blocking fast-path) → **ONE financial & DB write pipeline** (the S8-proven financial semantics — REMISE-no-entry, T-105 reconciliation, T-424 waterfall, 3-bulk-RPC flush, 3-level dedup — refactored onto the canonical record; year-scoped ledger sourceIds).

- **T-603 (the reject gate):** tier-1 name matches that fail every adapter fingerprint → explicit `unknown_schema` skip; the `candidates[0]` + `?? nameMatch` auto-adopt paths are deleted. Acceptance: EGV alone imports 0 rows; the 21-sheet default drop selects only fingerprint-passing sheets.
- **T-604 (year attribution):** per-sheet academic-year identity (sheet-name parsing + picker fallback) + year-scoped ledger sourceIds `imp:{year}:{studentId}:{field}`. Acceptance: the DS/13 §6.3 oracle — the 188 cross-sheet balance mismatches → 0.
- **T-605 (the variant table):** the CanonicalRow + ONE `EtatColumnAdapter` core with 8 variant rows (2026/2027, 2027/2026, 3rd variant, 2023/2024, 2026/2025, 2024/2025, EGV, CLIENT CRITIQ's family form rides T-608). Acceptance: §8 G1's per-format oracle at 100% of rows; LIVRES@AB lands as books (80,000 DZD, 8 rows), not psy3.
- **T-606 (the unified resolver):** the ER-PMAE graduation with the legacy exact-match as the definite-band fast-path; BUG-040's contact backfill (T-556's scope) lands here. Acceptance: er-engine parity + zero-split/zero-false-merge fixtures.
- **T-607 (the write pipeline onto CanonicalRow):** the financial builders read the canonical record — semantics byte-identical (INV-1/INV-4 untouched). Acceptance: RUN A/B/E/F reproduction exact (1,137/741/3,342/2,198/5,956 + 390 + no-op + honest failure).
- **T-608 (the ClientCritiqAdapter):** family-level debtor state — Montant → family outstanding charge snapshot, Garanti/Obs/roster markers as metadata, roster names resolved through the unified resolver, `critiq:` deterministic sourceIds. Acceptance: 23/48/31,584,600 imported once; re-import no-op.
- **T-609 (the EGV + document-sheet adapters):** EGV as its own payments-ledger format; BON/Devis/REF get REAL canonical targets (receipt/quote documents) or explicit excluded-with-reason classification — the tracked-only no-op ends (ARCH-048). Acceptance: EGV ground truth (349,017,080 / 302,131,790 / 46,885,290) oracle-exact.
- **T-610 (the sheet-selection UX):** per-sheet detected-adapter + row count; default = current-year family only; historical/auxiliary sheets excluded-with-reason (the 13 auxiliary sheets get a stable vocabulary).
- **T-611 (the performance envelope):** the §7 blueprint — P1 keyset preflights (the `search("")` snapshots die), P2 schema-projection cell walk, P3 post-load sheet pruning, P4 real checksums + diff-skip re-import (DEAD-024's fix), P6 coercion-plan precompile. Acceptance: DS/13 §8 G6/G7 budgets at 1× and 5× scale + the S8 oracle still exact.

**The lane's gate discipline (DS/13 §8 — LOCAL-FIRST, zero remote calls before every gate passes):** G1 100%-row oracle per format (0 DZD delta — the sampling prohibition is absolute); G2 entity-resolution fixtures; G3 idempotency (0 delta per format); G4 failure injection (fail-closed preflight + honest partial-state + compensating rollback); G5 the multi-year gate (the 21-sheet archive: current-year imports; historical sheets only under their own year; EGV never as an etat roster); G6 performance budgets; G7 the S8 regression slice. Only after G1–G7 does the live-lane ceremony request occur (OPS-011 cap-lift + the T-420 Phase-6 pattern).

**Register linkage (S23):** BUG-066, BUG-067, BUG-068, ARCH-047, ARCH-048, DEAD-024; re-cited: BUG-040 (T-556 rides T-606), the S8 queue T-555..T-560 (unchanged), DS/04's engine verdict (the shell is reused, not rebuilt), DS/09's unbounded-SELECT family (T-611's P1 is its import-side sibling).

---

*End of execution plan v2.0. Evidence base: `Investigation Archive/` Sessions 1–23 (FINDINGS_INDEX 190 registered IDs, corrections C-1..C-22); designs: BLUEPRINT v2.0 (§13 Stage A/B + §14 the query-minimization architecture), ROADMAP v2.0 (Phases 0–8), LOCAL-FIRST-BLUEPRINT, 02-UNIFIED-PIPELINE-DESIGN, UI Component Audit 00–05, the DS/01–13 deep sweeps, the LF0-prep package, the SUPABASE-RELOCATION-AND-RELOAD-GUIDE, and the S23 Excel_Inspection/s23 evidence package (the four-workbook census + the 100%-row stress harness). The owner's locked-in decisions D-17/D-18/D-19 (OWNER-DECISION-PACKET Part F) govern wherever they apply; the v2.0 reconciliation register R-1..R-5 resolved every listed contradiction (E1.7↔T-573; E2.4↔ARCH-037; the withdrawn t-502 claim; T-561's 8-site scope; the census-corrected counts: 359 `useObservable`/105 files, 413 `.from()`, 194 `title=`/102 files, 69 executable `auth.uid()`, 40 hand-rolled table files, 70 modal files/114 usages, 17 `supabase-client` bypasses). Every registered finding (all 190) maps to an execution home in §6 — zero orphans (the S23 additions: BUG-066..068/ARCH-047/048/DEAD-024 → Phase 9's T-603..T-611, §13). All version labels unified as v2.0. No application source, configuration, schema, or dependency was modified in producing this plan; the read-only regime is maintained until the owner green-lights execution on Issue #32.*

