# Execution Plan — the El-Imtiyaz Consolidation, Stage A/B Hybrid & Experience Overhaul (v2.3)

**Version:** 2.3 (Session 27, 2026-11-21 — the FINAL pre-Go lock-in, owner-mandated: **(1) the track re-order** — §2 now runs Track 1 (baseline green: Commit 1 + T-549) → Track 2 (`OPS-015` egress-loop safety: `T-559 → T-560 ×5 → T-594`) → Track 3 (relocation onto `gvuvibcsfjhwcjikgxql` + website cutover + Stage A minimization `T-550 → T-573 → T-552 → ARCH-046 → T-575 → T-574 → Cutover/Website(T-614) → T-590..T-593 → T-595`) **FIRST, BEFORE Phases 1–5 (`E2..E6`)** (E1/T-549 stays first as stabilization); **(2) full LIGHT theme as the app-wide PRIMARY** — T-589 + T-596 rebuilt to name the complete Dashboard AND Statistics UI surface set (OverviewTab, AnalyticsTab, StatStrip, ExecutiveCards, MixCards, InfoTip, `dashboard-theme.ts`, all chart SVGs/cards — zero leftover dark surfaces); **(3) full-detail Encaissement + Report PDFs** — T-579 + T-580 acceptance criteria expanded to the every-detail contract (paid now, total paid to date, total due `Prix`/`Prix justifié` net, exact remaining balance, per-tranche FI/T1/T2/T3 + per-category breakdown, method + full check/transfer fields, collector, academic year; report PDFs = full tables matching applied UI filters); **(4) the One-By-One actual-Excel verification gate** — E2.3/E2.4 + T-598 + the §16 overhaul acceptance gates test against EACH actual workbook INDIVIDUALLY (`Excel/Suivis clients  2026_2027.xlsx` alone AND `Excel/2027-2026.xlsx` alone; the school workbook + `ETAT 2024 -205.xlsx` external fixtures where applicable) — no combined-run masking; **(5) T-577 moved EARLY** (immediately after Track 3, not Phase 5) and expanded to Cut (`Couper`)/Copy (`Copier`)/Paste (`Coller`)/Select-All (`Tout sélectionner`) incl. read-only surfaces + automated menu tests; **NEW §16** — the Payment Error Detector, Diagnostics & Data Inspector Overhaul (T-587 + T-612 + T-613 with the G-DETECT-1..4 gates; Deep Sweep/15; BUG-072..075/DUP-040/ARCH-052 + C-27); **NEW T-614** — the Website Cutover, Env Update, Redeploy & Operational Verification card (Deep Sweep/16; OPS-021; §12 + Track 3 + ROADMAP 6.14 + the RELOAD-GUIDE §A.7); **§0's AUTONOMOUS HANDOFF & NEXT-TASK QUEUE protocol** (zero context overload — the queue header written to `docs/recovery/next-task.md` at G0-lift, `docs/` untouched this session); the register 197 → **204** (§17's homes); the S27 mechanics spot-checks recorded (OPS-018 33/33+4/4 re-verified at HEAD; the runner/scripts/Stage-A/Excel census — §17.4)) · **v2.2** (Session 26, 2026-11-21 — the v2.2 self-containment sync: every S24 §14 delta folded INLINE into the task cards (T-594 narrows per C-23; T-591 gains BUG-069; T-592's radius is ARCH-049's 30 instances/18 files; E2.4 owns DUP-037; T-569's DB-side scope is EMPTY per C-24 — `class_subjects` stays; T-588 widens to 13+ per C-25; T-578 carries BUG-046's 7 synthetic sites + the `unified-payment-modal.tsx:283-285` root; T-561 carries BUG-065's medical→support read-corruption precondition; T-587 carries ARCH-037's flat/non-year-keyed `REAL_TUITION_BY_GRADE` + `REAL_FI_AUTISTE`; T-586 carries the 96×3=288 stats-tips blocks); Session 25 folded in (OPS-019 → §6/§12/§1 + D-21 → §5 + the widened OPS-012); the §6 register counts fixed (the stale 184/190 → the true 197); the relocation-lane target assertions re-based on the consolidated baseline; the Permanent Migration Consolidation & Egress Charter adopted as §15.3 (OPS-020); the OPS-015 no-live-builds lock in §15.4) · **v2.1** (Session 24, 2026-11-20 — the S24 verification + consolidated-baseline addendum: five new findings homed in §6 (DUP-037→E2.4, ARCH-049→E7A-3/T-592, BUG-069→E7A-2/T-591, OPS-017→the §1 G2R gate, OPS-018→the §0 execution preamble); three card corrections folded (T-594 narrows per C-23; T-569's DB-side deletion scope empties per C-24; T-588's store inventory widens per C-25); the migration chain is now the consolidated single-file baseline — the append-only regime continues from `0002_*.sql`; the verification verdict (Deep Sweep/14): 78 families re-verified, zero substance refutations, the 190→195-ID orphan check passes programmatically). · **v2.0** (Sessions 22–23, 2026-11-20 — the final consolidation: the complete `Investigation Archive/` Sessions 1–23 + the owner's locked-in decisions D-17/D-18/D-19 and the S23 unified-Excel lane unified; every registered finding task-homed; the T-register complete T-549..T-611) · **Status:** the plan of record's *operational layer* — it converts `Refactoring Unified/BLUEPRINT.md` v2.0 + `Refactoring Unified/ROADMAP.md` v2.0 (Phases 0–9) and the `Investigation Archive/` evidence base into a single ordered, step-by-step, dependency-aware execution program. The implementation sessions execute directly from this file.
**Companion documents (authoritative, never replaced by this file):** `Refactoring Unified/ROADMAP.md` v2.3 (the task table of record) · `Refactoring Unified/BLUEPRINT.md` v2.3 (the design of record, incl. §13 Stage A/B + §14 the query-minimization architecture + §18 the standing charter + §19 the S27 addendum) · `Investigation Archive/OWNER-DECISION-PACKET.md` (D-1..D-20 — Part F's locked-in decisions + Part G's S23 mandate core govern) · `Investigation Archive/Findings and Hypotheses/FINDINGS_INDEX.md` (every finding ID cited below; 204 registered IDs, all mapped in §6).

---

## 0. How to use this document — execution-session protocol

**You are the implementation session. Bootstrap in this exact order:**

1. `git fetch origin && git status` (must be clean; sync `main`).
2. **Read the `## AUTONOMOUS HANDOFF & NEXT-TASK QUEUE` header at the top of `docs/recovery/next-task.md`** (§0.1 — the v2.3 zero-context-overload protocol): that queue + your chosen batch's T-cards in THIS file + the target code files are the ENTIRE execution context. **Execution sessions do NOT re-read `Investigation Archive/` (README/SESSION_LOG/handoffs) or full `BLUEPRINT.md`** — those are investigation-phase documents; this plan is self-contained (every correction inline at its card since v2.2). Only the FIRST execution session (the G0-lift bootstrap) reads §0 once end-to-end and installs the queue header (§0.1).
3. Check Issue #32 for owner answers to the still-open decisions (D-5/D-6/D-8..D-16 + the Phase-4 product decisions). **If any answer exists:** record it as a dated addendum in `OWNER-DECISION-PACKET.md`, adjust the rows it gates, and re-read §5. If none: **the ⏵ defaults govern — except where D-17/D-18/D-19 are LOCKED IN (they are decisions, not defaults).**
4. Run the GET-only probe set (see `Investigation Archive/01-INFRASTRUCTURE-STATUS.md`) and update that file. **Watch for one thing:** if the Supabase REST probe with the secret key returns **200**, the spend cap has been lifted → verify the OPS-015 precondition FIRST (§1 G2: T-559 + T-560 + T-594 must already be green; if not, do them before anything else touches live traffic), then schedule the one-time live window (§4 E7A-12 / T-598 + the local seed ceremony E7B-10).
5. Then start executing at §3 (the immediate queue) — whose first act is **Commit 1: the OPS-018 mechanical path update** (the exact, line-numbered spec: `Investigation Archive/OPS-018-COMMIT-1-BLUEPRINT.md`; the S26 full-ladder run proved every live site fails ENOENT until it lands; the S27 re-verification confirmed 33/33 + 4/4 sites at HEAD with zero drift).

### 0.1 The AUTONOMOUS HANDOFF & NEXT-TASK QUEUE protocol (v2.3 — the multi-task session's lightweight context)

**The problem it solves:** autonomous execution sessions were burning context re-reading the whole archive per session. **The rule from v2.3 onward:** `docs/recovery/next-task.md` carries a **queue header** as its FIRST section; every execution session reads ONLY that header + the T-cards it names in this file + the target code files. The queue is maintained by each session as it completes tasks (one line per task: ID → state → next pointer).

**Installation (the G0-lift bootstrap's first docs-only act — `docs/` stays untouched while G0 holds):** write this block verbatim at the TOP of `docs/recovery/next-task.md` (above all historical session headers — the history below it is never deleted):

```markdown
## AUTONOMOUS HANDOFF & NEXT-TASK QUEUE (the v2.3 protocol — maintained by every execution session)

> **Read ONLY this queue + the named T-cards in `Refactoring Unified/EXECUTION-PLAN.md` + the target code files.**
> Never re-read `Investigation Archive/` in an execution session — the plan is self-contained (v2.2+ inline discipline).
> Track order (EXECUTION-PLAN §2, v2.3 — HARD): Track 1 (baseline green) → Track 2 (T-559 → T-560 ×5 → T-594) →
> Track 3 (T-550 → T-573 → T-552 → ARCH-046 → T-575 → T-574 → Cutover/Website T-614 → T-590..T-593 → T-595)
> → T-577 (early right-click) → then Phases 1–5 (E2..E6) → §16 overhaul (T-587+T-612+T-613) per §2's parallelism.

| Task | State | Next pointer |
|---|---|---|
| Commit 1 (OPS-018 path fix) | NOT STARTED | after G0-lift: §3 Step 3 → then T-549 |
| T-549 (BUG-038 clock) | NOT STARTED | §3 Step 4 → then Track 2 |
| T-559 → T-560 ×5 → T-594 | NOT STARTED | §3 Step 5 → then Track 3 |
| (…one line per registered task; append as they start; update State/Next as they complete…)
```

**Maintenance rules:** (a) one `| Task | State | Next pointer |` row per T-task, appended in start order; (b) on completion, the session updates the row's State + Next pointer and appends its one-line closeout ABOVE the historical headers (the existing dated-header convention continues below the queue); (c) the queue NEVER carries findings evidence — that stays in FINDINGS_INDEX; (d) if a task blocks on an owner gate (§1/§5), the row says so and the session moves to the next unblocked row.

**Standing rules you must not break (inherited from the investigation charter + AGENTS.md):**

- One registered T-task per commit; five-question commit body; push immediately after every commit; never force-push. Register each task in `docs/recovery/task-registry.md` per the staged drafts BEFORE writing code.
- `npx tsc --noEmit` + the touched features' vitest suites green before each commit; full `npm test` + baseline move at each batch boundary (baseline moves ONLY per `scripts/test-baseline.json`'s own `_comment` rule, citing the task ID).
- SQL/EF changes follow the live-verify ceremony (AGENTS.md §11.1); migrations append-only; RLS never weakened.
- Every completed task updates `FINDINGS_INDEX.md` (item state) and `docs/recovery/task-registry.md`; unresolved items re-verified or escalated to the owner via Issue #32.
- Kill-switch rollback at every stage: the previous backend/behavior stays selectable until the next stage is green.
- **The web portal and Android clients keep consuming Supabase unchanged throughout (D-17) — no breaking change ships to them without the §10 mirror/divergence registration.**

---

## 1. Operating gates — what is executable NOW vs owner-gated

| Gate | State at Session 26 close (S27-verified) | What it unlocks |
|---|---|---|
| **G0 — read-only regime** | ACTIVE (the owner has not green-lit code changes on Issue #32 — 0 comments, the 22nd consecutive silent run (S27 GET re-check); every mandate so far defers ALL implementation) | Nothing in §4 is executable until G0 lifts — the implementation sessions execute directly from this plan once it does |
| **G2 — Supabase spend cap lifted (one time)** | NOT LIFTED (OPS-011, 21-run-stable `exceed_egress_quota` at S26; the S27 run skipped live Supabase probes — no keys in the current env set; the restriction is at the plan/spend-cap layer) | The one-time live window (T-598 reconciliation oracle + the live census + the local seed ceremony E7B-10) — **and ONLY after the OPS-015 precondition: T-559 + T-560 + T-594 green first** |
| **G2R — relocation readiness** | The OLD project is quota-blocked (OPS-016: no Windows installer buildable against it); the T-573/T-574/T-575 lane is executable WITHOUT G2 (the guide's Path 2) | The effortless Supabase→Supabase move; the packager unlock; the local seed's source project |
| **OPS-021 — the website cutover dependency set** | **AUDITED (S27, Deep Sweep/16):** the live portal (`elimtiyaz-website.vercel.app`) is UP but its bundle still pins the OLD project; the cutover needs the Vercel env re-point + redeploy + the website repo's pinning-test commit + the new project's auth/EF/storage/realtime parity | T-614 (the Website Cutover card — §12/§16/Track 3) + the RELOAD-GUIDE §A.7 checklist; the owner supplies Vercel access (or the PAT) + the website repo push at cutover time |
| **D-13..D-16 (pedagogy)** | ⏵ defaults staged (Part E; the S26 workbook re-inspection changed nothing — byte-identical blank template) | The T-566/T-568/T-569/T-570 cards' final shape |
| **D-21 / OPS-019 (owner-side OAuth)** | Google sign-in fully wired on the NEW project's Supabase side; the Google-side client lacks its callback — the owner's single manual step | Google sign-in completes on the NEW project (and on the portal after T-614); then the widened OPS-012 full-set rotation |
| ~~G3/G4 (the v1.x D-1/D-8 gates)~~ | **SUPERSEDED (D-17):** no relay topology decision remains (Supabase IS the sync layer); D-8's restore-UX copy rides E7B-4's card | — |

**Reading the gates correctly:** the investigation sessions (S1–S21) ran entirely inside G0; this blueprint session did too. The implementation session's first job is to establish (or explicitly assume) that G0 has lifted. **The three locked-in decisions (D-17 hybrid / D-18 OAuth stays / D-19 white theme + overhaul) are NOT gated — they are the program's shape.** The one-time cap lift (G2) wants the OPS-015 precondition verified green first, then the single live window runs T-598 + the census + the seed.

---

## 2. The master execution sequence — v2.3 THE THREE TRACKS FIRST, then the phases (dependency-tight)

**The v2.3 HARD ORDER (owner-mandated):** **Track 1 (baseline green) → Track 2 (`OPS-015` egress-loop safety) → Track 3 (relocation onto `gvuvibcsfjhwcjikgxql` + the website cutover + Stage A query minimization) run FIRST, BEFORE Phases 1–5 (`E2..E6`)** — with `E1` / `T-549` kept first as the stabilization head. The E-numbered stages below are unchanged in content; only their ORDER is re-expressed (the mapping stays 1:1 — no roadmap row dropped).

```
TRACK 1 — BASELINE GREEN (the stabilization head; Phase 0):
E0    Session-zero housekeeping (no app-code changes)          ──┐ can start immediately under G0 as *prep*,
E1    Zero-risk cleanup (ROADMAP Phase 0)                        │ full speed once G0 lifts
      Commit 1 (OPS-018 path fix) + T-549 (BUG-038)               ──┘ ← the full ladder goes GREEN here

TRACK 2 — OPS-015 EGRESS-LOOP SAFETY (the live-traffic precondition):
E2X   T-559 → T-560 (×5) → T-594 (BUG-058) — THE FIRST CODE      (top-CRITICAL; no live traffic — incl.
      any website deploy — before this is green)

TRACK 3 — RELOCATION ONTO gvuvibcsfjhwcjikgxql + WEBSITE CUTOVER + STAGE A MINIMIZATION:
      T-550 (the port seam) → T-573 (BackendProfile) → T-552 (17 bypass files) → ARCH-046 (config.toml sync)
      → T-575 (target preflight; OPS-016 unlock) → T-574 (auth tooling) → Cutover + Website (T-614)
      → T-590 → T-591 → T-592 → T-593 (Stage A minimization) → T-595 (the egress gates)
      (T-598 stays G2-gated — the one-time live window after the cap lifts; E7B-10's seed rides the lane)

T-577 the EARLY right-click Cut/Copy/Paste/Select-All + Electron hygiene — immediately after Track 3
      (owner-mandated early move, v2.3; NOT Phase 5)

THEN PHASES 1–5 (the program's body — unchanged):
E2    Money path (Phase 1 — per-era devis fixtures; T-549) 
E3    Backend defect repair, live SQL/EF (Phase 2 — dual-valid & PERMANENT under D-17)
E4    Structure & contracts (Phase 3)     ── after E2.2 (INV-4 predicates exist)
E5    Platform hygiene (Phase 4)          ── independent of E4 except 5.2 (sibling-repo check)
E6    Experience overhaul (Phase 5, D-19) ── T-589 (full-light) before/with E6.1; T-596 after T-590

§16   The Payment Error Detector, Diagnostics & Data Inspector Overhaul (T-587 + T-612 + T-613)
      — after E2.4 + T-562; may start once Track 3 lands (disjoint from the relocation files)

E7B   STAGE B (Phase 7): the pipeline P-lanes (7.1..7.5) ∥/→ T-599 LF-1 engine → T-600 LF-2 auth →
      T-601 LF-3 ports → T-602 local↔Supabase delta sync → the local seed ceremony (G2)
E8    Verification & closeout (INV-2 kill-the-network gate, the egress gates, baseline moves, register sweep)
PAR   Pedagogy lane (Phase 8, T-561..T-571) — G0-gated, own sequencing, runs parallel from E2 onward
XL    Unified-Excel lane (Phase 9, T-603..T-611) — G0-gated, own sequencing, runs parallel from E2
      onward (§13; DS/13 §8's local gates precede ANY live traffic — zero remote calls until G1–G7)
```

**Parallelism map (for multi-agent execution):** E1∥E6 can run concurrently once started (disjoint file sets, except E1's 0.2 dashboard dead-file deletion vs T-596 — sequence E1.2 first); E4∥E5 likewise; the pedagogy lane parallels E2..E7 (its T-564 = E4.2's pedagogy-side execution — coordinate, never double-touch); inside Stage B: the pipeline facades (E7B-1) ∥ LF-0 entirely; T-599 rides the one-commit path (E7B-2); T-602 consumes T-593/T-592; **the §16 overhaul (T-612/T-613) parallels E6 once Track 3 lands (disjoint from the relocation/Stage-A files except the shared `executive-statistics`/`dashboard` surfaces — coordinate the T-613 ∥ T-596 boundary: T-613's export/theme fixes land BEFORE T-596's re-composition)**; T-614 is owner-gated (Vercel access) but blocks nothing code-side. Never parallelize anything onto the same repository file without a merge plan.

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
- **T-576..T-602 + T-612..T-614** — the v2.0/v2.3 assignments (§4's E6/E7A/E7B/§16 cards): T-576 modal cleanup · T-577 Electron UX/hygiene (**moved early — immediately after Track 3, v2.3**) · T-578 Encaissement context + slider · T-579 payment-details contract · T-580 WinAnsi · T-581 backup trio · T-582 parser · T-583 startup · T-584 automation runner · T-585 AI hardening · T-586 jargon purge + formatters · T-587 per-year diagnostics (**executes INSIDE §16's overhaul, v2.3**) · T-588 settings 8-store · T-589 full-light theme · T-590 dashboard aggregation · T-591 projections/pagination · T-592 delta cache · T-593 batch sync RPC · T-594 health-probe · T-595 egress gates · T-596 dashboard overhaul · T-597 OAuth switching · T-598 reconciliation oracle · T-599 LF-1 engine · T-600 LF-2 auth · T-601 LF-3 ports · T-602 delta sync · T-612 the diagnostics/reconcile engine overhaul (§16) · T-613 the inspector/console overhaul (§16) · T-614 the Website Cutover, Env Update, Redeploy & Operational Verification card (§12/§16/Track 3).

**Apply the S6 correction first:** T-552's recorded scope ("16 bypass files") is **17** — the S4 census missed the two *dynamic* importers (`conflict-detector.ts:405`, `default-push-handler.ts:76` via `await import(...)`). Register T-552 with scope 17 and its verification grep in BOTH shapes: `rg "from.*supabase-client" src -g '!src/infrastructure/supabase/**'` (expected after completion: only `repository-provider.tsx`) **and** `rg "import\(.*/supabase-client" src -g '!src/infrastructure/supabase/**'` (expected: zero non-supabase-tree hits).

### Step 2 — Adopt the two ADR supersessions (T-553, docs-only)

Execute T-553 exactly as drafted: assign real ADR numbers, copy `ADR-002-SUPERSESSION-DRAFT.md` and `ADR-004-SUPERSESSION-DRAFT.md` verbatim into `docs/decisions/`, add pointer-lines to the originals' Status sections, annotate AGENTS.md §15.5's "canonical server implementation" language. Verification criteria are inside the drafts. **v2.0 note:** under D-17 the ADR-002 supersession text needs one amendment — the SQL authority relocates to the main process for the DESKTOP while the Supabase RPCs remain the canonical shared layer (sync + web/mobile parity); draft the amendment alongside, don't rewrite the draft's structure.

### Step 3 — Commit 1 (OPS-018) + re-pin the failing baseline expectation (test infra only)

**Commit 1 — the OPS-018 path update FIRST** (the exact line-numbered spec: `Investigation Archive/OPS-018-COMMIT-1-BLUEPRINT.md`): re-point the 30 live + 3 comment `supabase/migrations/0NNN_*.sql` references (28 test files + 2 doc-comment files) to `migrations_archive/` — the S26 full-ladder run proved every live site fails ENOENT after the S24 consolidation; t-058's two throwaway-repo fixture strings are excluded by design. Until Commit 1 runs, the full-ladder baseline carries the OPS-018 failures ALONGSIDE the t-502 red. Then, before touching any other source, record the current failing set: `npx vitest run src/tests/domain/t-502-wave-meter-thresholds.test.ts` → deterministic 8/8-minus-failing red since 2026-10-16 (BUG-038's date bomb). Nothing else in the 321-file ladder is red (Session 5 census: 5,270 passed / 1 failed / 5 skipped).

### Step 4 — Execute T-549 (the BUG-038 fix)

1. `src/features/financials/installment-schedule-tab.tsx` — add optional `nowEpochMs?: number` (default `Date.now()`) to the adapter signature at `deriveTrancheWaves` (`:228-231`), thread it into the `derivePooledTrancheWaves` call at `:246`; survey the two secondary wall reads (`:330`, `:708`) — inject the same param or leave each with an explanatory comment (no behavior change in production rendering).
2. `src/tests/domain/t-502-wave-meter-thresholds.test.ts` — pass the fixed `NOW` constant into the three finance adapter calls.
3. Verify: the t-502 suite → 8/8 green; `npx tsc --noEmit` → 0; full ladder = documented baseline with an empty failing set; move `scripts/test-baseline.json` ONLY per its own `_comment` rule citing T-549.
4. Commit (`T-549: inject evaluation clock into finance wave adapter…` + the five-question body), push.

### Step 5 — Execute T-559 + T-560 + T-594 (the STAGE A head — the cap-lift precondition)

1. **T-559** (`toast-provider.tsx:57-69`): keep `show/showSuccess/showError/showWarning/showInfo/dismiss/clear` in a memo keyed ONLY on stable deps (`[show, dismiss]`); expose `toasts` through a second context (or let only the toast viewport subscribe). Verify: the 108 `useToast()` consumers typecheck unchanged; the S10 regression shape (a failing listAll behind a mounted configuration-tab can no longer re-fire the effect from toast identity alone).
2. **T-560** (the five loop-capable sites — the load-generation-ref gate, load-on-mount + explicit refresh only): `configuration-tab.tsx:73-85`, `accounts-tab.tsx:60-80`, `pricing-year-config-bar.tsx:58-63`, `promotion-cycle-detail.tsx:69-78`, `promotion-cycles-tab.tsx:53-62` (+ the identical-consecutive-error-toast dedupe). Verify: per-site effect-count tests.
3. **T-594** (BUG-058): the online-detector's `/auth/v1/health` probe (~120 doomed requests/hour in CONFIGURED mode only — ZERO in mock/unconfigured mode by design (C-23); the third two-gates seam member) respects the effective runtime config — mock/offline mode stops the drip entirely. Verify: an offline network census shows zero probes.

### Step 6 — Execute T-550 then T-573 (the seam + the profile switcher; T-551's scope lands here)

1. **T-550** — `src/infrastructure/backend/ports.ts`: interfaces ONLY (DataBackendPort, AuthPort, SyncTransportPort, StoragePort, DiagnosticsPort; exact shapes in `LOCAL-FIRST-BLUEPRINT.md` §5); the `satisfies`-based factory exhaustiveness check on the 54-slot map (ARCH-033). Zero runtime change.
2. **T-573** — the `BackendProfile` main-process runtime config switcher (ADD-9 / the S18 §B design): a versioned profile object resolved by ONE main-process service exposed via the preload bridge; the compiled-in canonical constants (`supabase-client.ts:35-38,148-157,171-172` + the storageKey pin `:205`) demote to factory defaults; `validateConnection` (`system-config.ts:431-433`) becomes backend-kind-aware; **the `vite-env.d.ts` `window.elImtiyaz.config` declarations are KEPT and become TRUE (R-1 — do NOT delete them; only the truly-unbuilt `app`/`fs` members get a doc note)**; the packager's preflight re-points from canonical-identity to target-readiness (the OPS-016 unlock — wires to T-575). **T-551's verification criteria carry over verbatim:** typecheck + full ladder; ARCH-019 suites; the manual matrix (`local:` accepted, non-canonical `https://<x>.supabase.co` accepted, canonical URL behavior unchanged); fail-closed default backend selection preserved. Acceptance: **a packaged app can be pointed at a new Supabase project WITHOUT a rebuild.**

### Step 7 — Execute T-552 (the 17 bypass files)

Route each bypass through the port/repository surface (per-file, behavior-preserving; the F-U3/ROADMAP 5.11 diagnostics lane is included). The 17 files (S6-verified census): 9 features (`crm/excel-import-modal.tsx`, `crm/parent-detail-drawer.tsx`, `settings/backup-tab.tsx`, `settings/configuration-tab.tsx`, `settings/contextual-thresholds-config.tsx`, `settings/danger-zone-card.tsx`, `settings/supabase-diagnostics/{crud-test-tab.tsx, diagnostics-runner.ts, supabase-diagnostics-tab.tsx}`) + `shared/layout/tenant-switcher.tsx` + `infrastructure/system-config.ts` + `infrastructure/storage/media-vault.ts` + `infrastructure/ai/llm-adapter.ts` + 4 sync-family (`app/providers/sync-provider.tsx`, `infrastructure/sync/online-detector.ts`, `infrastructure/sync/conflict-detector.ts` **(dynamic)**, `infrastructure/sync/default-push-handler.ts` **(dynamic)**).
**Verification (both grep shapes, per Step 1):** static-import grep returns only `repository-provider.tsx`; dynamic-import grep returns zero non-supabase-tree hits; typecheck + full ladder + the touched features' suites.

### Step 8 — Then proceed by stage

Per §2's v2.3 order: **Track 3's remainder (T-550 → T-573 → T-552 → ARCH-046 → T-575 → T-574 → the cutover/website T-614 → T-590..T-593 → T-595) comes BEFORE the E2..E6 phase work**, then T-577 (early right-click), then the phases; the §16 overhaul starts after E2.4 + T-562 (parallel with E6 per the parallelism map). If any still-open decision's answer appeared at bootstrap, adjust §5-gated rows first.

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

**E2.3 Devis fixtures (1.3) · M** — capture current persisted shapes as equivalence fixtures **per price era (2026-2027 AND 2027-2026 configs)** — R-2's precondition. **v2.3 (the One-By-One gate):** the fixtures are cut from and verified against **EACH actual workbook INDIVIDUALLY** — `Excel/Suivis clients  2026_2027.xlsx` (213,689 B, SHA `9decf3f7…05c7`) ALONE and `Excel/2027-2026.xlsx` (558,443 B, SHA `b293b22b…79ca`) ALONE — never a combined import (the owner's no-combined-masking rule). Verify: fixture suite green, per-file.

**E2.4 Devis service (1.4–1.7) · M→S→S→S · after E2.3** — `domain/calc/pricing/devis.ts` composing matrix+tuition becomes THE billing preview engine **with a per-year `pricingBasis` parameter** (`yearPricingConfigs` + the updated `2027-2026.xlsx` pricing — never cementing the stale `REAL_TUITION_BY_GRADE` 2026-2027 fallback; T-587/§16 regenerates/deletes it in the same arc). Steps: 1) the service (policy param reproducing today's #4 wiring, priced per-era); 2) switch feature `computeBilling` preview; 3) switch `registration-billing-wires` (mapping only); 4) mock batchRegister adopts the canonical wire construction — **DUP-037 (the FIFTH billing site): `infrastructure/mock/repositories/student-repository.ts:526-548`'s remise-on-sticker divergence dies; mock and live produce the same installment plan for the same wizard input**. Verify per step: equivalence suite (× two eras, each actual workbook individually) / batch-registration suites / registration e2e + live-verify script / mock parity tests. Findings: DUP-001, DUP-005, DUP-037, ARCH-037 (R-2).

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

- **T-589 · the full-light theme flip (5.1) · S-M · FIRST in E6. · v2.3: Light/White is the PRIMARY theme app-wide (D-19, the owner's locked mandate).** Target: the app defaults to **light** and the light theme is COMPLETE, cohesive, and high-contrast everywhere — **explicitly including the entire Dashboard AND Statistics UI: `OverviewTab`, `AnalyticsTab`, `StatStrip`, `ExecutiveCards`, `MixCards`, `InfoTip`, `dashboard-theme.ts`, and ALL chart SVGs/cards** must be rebuilt/styled in clean full light theme (no leftover dark cards, dark chart backgrounds, or unreadable contrast). Steps: 1) flip the default (`index.html:2` `class="dark"` → light, `DEFAULTS.theme`, preset order with "Clair Épuré" first; `src/index.css` — the `:root` block becomes the LIGHT surface set, the dark values move under `.dark`/`[data-theme="dark"]` — the inversion of today's dark-first `:root`); 2) fix the two stale boot colors (`electron/main.cts:19` `backgroundColor:"#242526"`, `index.html:6` meta theme-color); 3) ARCH-036: add the `--brand-blue-deep`/`--brand-blue-light` `-rgb` twins + re-map the static-hex tailwind entries; 4) BUG-039: define `--radius-pill`; 5) DEAD-017: delete the accordion keyframes; 6) tokenize the hardcodes (279 hex / 24 files: `timetable-grid.tsx:80-97` 18 pastels, the duplicated divergent personnel token map → `resolveToken`, `ai/chart-svg.tsx:31-34` + `diagram-svg.tsx:26-28`, `domain/model/workflow.ts` 5 hex, `mock/workforce/index.ts`); 7) **BUG-075: retarget `mix-cards.tsx:37-51`'s module-level `METHOD_COLORS` capture to the live-getter/Proxy pattern (the T-546 stale-capture class's last survivor) + re-pin `dashboard-theme.ts`'s midnight fallbacks (`:21-23`, chartPalette `:63-103`, tooltip `:133/:136`) to light-first values** so every chart renders light-native; 8) extend t-546 to pin the light surfaces + the `var(--x,#fallback)` twin parity. Verify: t-546 extended; **a full-dashboard + full-statistics visual pass on light (zero dark surfaces, zero low-contrast text)**; dark mode remains selectable. Findings: D-19/§E11, ARCH-036, BUG-039, DEAD-017, BUG-075.
- **T-576 · modal cosmetic cleanup (5.7) · S.** BUG-041 (UnifiedModal destructures 34 known props — forward the unknown ones; `data-testid` survives) + DUP-034 (`configuration-tab.tsx:149` bare `confirm()` → ConfirmModal) + the E6.6 stack. Verify: unified-modal suites + export-dialog test.
- **T-577 · Electron main UX & hygiene (5.8) · S · v2.3: MOVED EARLY — executes immediately after Track 3, NOT Phase 5.** **BUG-045 (the expanded v2.3 contract):** add the French-labeled `{ role: "editMenu" }` to `buildMenu()` (`electron/main.cts:50-78` — the S27 re-check: buildMenu at `:50`; NO editMenu and NO context-menu exist at HEAD) + a `webContents.on("context-menu")` popup in `createWindow()` supporting — **Cut (`Couper`)** on `isEditable` (`canCut`), **Paste (`Coller`)** on `isEditable` (`canPaste`), **Copy (`Copier`)** on ANY selected text (`canCopy` / non-empty `selectionText` — **including read-only surfaces: tables, cards, receipts — the owner's explicit requirement**), and **Select All (`Tout sélectionner`)** (`canSelectAll`); macOS accelerators live via the role. OPS-014: `requestSingleInstanceLock`, window-state persistence, `did-fail-load` handler, `sandbox:true`, remove `toggleDevTools` from the prod View menu. Verify: **automated unit tests for the menu builder + the context-menu builder (the enabled-flag matrix × editable/read-only/selection states)** + the manual matrix (cut-copy-paste-select-all on Windows/macOS/Linux, incl. a read-only table and a receipt PDF preview; second launch focuses the first instance). Findings: BUG-045, OPS-014.
- **T-586 · modal text & jargon purge + formatter unification (5.9) · M.** Steps: 1) purge the ~34 user-visible jargon-leak sites (the "45+" basis counted comment annotations — the S24 count-only correction) (the catalogued sites: "Reste (INV-4)", "(règle INV-14)", "(T-502)" tooltips, "(modèle officiel T-425)", "plan §18.03", "(ADR-018)/(T-413)/(T-403)", "Allocation waterfall appliquée", the stats-tips glossary's 96 entries × 3 locales = 288 blocks → code comments); 2) rewrite the 5 worst text blocks (the refund LIFO/contrepassation paragraph, the tranche-edit 5-clause toasts, the anomaly-explainer wall + duplicated disclaimer, the cash-flow-radar double-parentheticals); 3) standardize Payment Details on **Prix / Prix justifié / Couverture** (three labels, ≤2 sentences per explainer, details behind InfoTip); 4) BUG-057: unify the four formatters on `formatDzd*` — kill the raw `toLocaleString("fr-FR")` NaN sites (`unified-payment-modal.tsx:494,499`, `alert-detail-modal.tsx:136,306`, `financial-query-console.tsx:124-139`, `operational-query-console.tsx:984,995`), the `fr-DZ`/`DA` variants, the locale-less form; one `DZD` suffix; clamp the percentages; compact only on KPI tiles (the A1.4 illusion fix). Verify: copy review + formatter snapshot tests. Findings: B6/E12, BUG-057.
- **T-578 · one canonical Encaissement context + slider fix (5.10) · M.** `buildFamilyCollectContext(parentId, {targetInstallmentId?})` ALWAYS derives lineItems from the real installments stream (the modal already loads it at `unified-payment-modal.tsx:171-174`) — the synthetic consolidated item (`alreadyPaidAmount: 0` — BUG-046's erased history; **all 7 synthetic sites: financials-page:1289, debt-aging-tab:593, counter-payment-modal:65, club-detail-drawer:493, orthophonie-tab:415, psychology-tab:458, parent-detail-drawer:709 — the root is the lineItems-take-precedence branch `unified-payment-modal.tsx:283-285`**) dies; the tranche strip is uncapped (virtualized); the DebtMeter always receives the true alreadyPaid. BUG-048: render boundary labels only when the inter-label gap ≥ label width; clamp the last label `right-0 translate-x-0`; widen the strip; drop `dueWindowLabel` under 12% segments. All 10 entry points switch to the builder. Verify: the entry-point suites + a visual matrix (the multi-tranche strip present in every family context). Findings: BUG-046, BUG-048.
- **T-579 · full payment-details contract (5.11) · M · v2.3: the EVERY-DETAIL expansion.** One shared `buildPaymentCoverage(payment, allocations, installments)` reusing the card's canonical precedence chain (`payment-breakdown-card.tsx:47-87`). **The v2.3 acceptance contract — the Encaissement / Receipt & Account Statement PDFs (`payment-receipt.ts`, `account-statement.ts`) include EVERY detail:** 1) **what was paid in this payment** (the amount + its allocation/coverage lines); 2) **total paid historically** (the family's cumulative paid-to-date); 3) **total due — `Prix` / `Prix justifié` (the net after discount)**; 4) **the EXACT remaining balance owed ("what the family/student owes")**; 5) the **per-tranche (FI / T1 / T2 / T3) AND per-category breakdown**; 6) the payment method + **the FULL check/transfer field set** (check number/bank/date; transfer reference/date); 7) the **collector ("Encaissé par")**; 8) the **academic year**. Mechanically: 1) `generatePaymentReceiptPdf` gains the "AFFECTATION / COUVERTURE" section + the check/transfer key-value blocks + the per-tranche/per-category breakdown + the totals block (paid-now / paid-to-date / Prix justifié / reste dû); 2) `generateAccountStatementPdf` gains coverage sub-rows + the same totals contract per statement period; 3) `PaymentBreakdownCard` mounts in the payment-detail drawer (+ the missing `method === "transfer"` block — BUG-053) and the modal's success stage (the discarded `allocationPreview` at `:854-876`); 4) t-368 content pins — assert drawn text for checkNumber, an allocation label, "Total attendu", "Excédent", **the per-tranche FI/T1/T2/T3 lines, the paid-to-date, the remaining balance, and the academic year**. Findings: BUG-047, BUG-053.
- **T-580 · WinAnsi crash + PDF cosmetic (5.12) · XS · v2.3: widened to the report-PDF family.** `data-inspector-core.tsx:341-357` routes through `sanitizePdfText`/`dzdPdf` (the `formatDzdPlain` U+202F hazard — **plus the BUG-073 pagination const + the discarded `addPage` return + the swallowed `void exportPdf()` failures, which die with T-613's unified stack — coordinate: T-580 owns the global-reports side; T-613 owns the inspector side**). **The v2.3 report-PDF contract:** the REPORT PDFs — `global-reports.ts`, `debt-report.ts`, `class-report.ts`, `report-document.ts` — render **complete, detailed tables/breakdowns matching the applied UI filters** (no bare or truncated summaries — every filtered row/field appears; the filter set is printed on the report header), with **full WinAnsi safety** (the `sanitizePdfText`/`dzdPdf` pair on every drawn string across all four generators). `generateRevenueReportPdf`'s period label filters or drops (`global-reports.ts:50,75`). Verify: a lineage-audit PDF ≥ 1,000 DZD exports cleanly; **a report PDF with é/è/Arabic names + a large filtered row set exports with every row present**. Findings: BUG-049 (the ARCH-028/BUG-073 inspector side rides T-613).
- **T-581 · backup integrity trio (5.13) · S.** BUG-050: `backup-service.ts:172` reads the key the editor writes (`el-imtiyaz:rbac-overrides`); BUG-051: the daemon reads the DB-configured schedule (kill `SCHEDULE_HOUR=2`); BUG-015: the tenant-ID/actor literals (`tenant-el-imtiyaz-oran-001`, `"usr-current"`) become injected context in the backup family. Verify: backup round-trip with RBAC overrides present; the schedule change actually takes effect. Findings: BUG-050/051/015.
- **T-582 · import number-parser hardening (5.14) · XS.** `positive-number.ts:39-43`: restrict currency stripping to trailing `DA`/`DZD` tokens (no char-class); treat `.` as thousands separator only when followed by exactly 3 digits + separator/end. Verify: the adversarial parser suite ("1D500" → error; "1.500" → 1500; "1.500,00" → error-or-1500-per-rule). Findings: BUG-052.
- **T-583 · startup acceleration (5.15) · M.** Route-level `React.lazy`/`Suspense` (the 11 routes of `app-shell.tsx:10-20`; fix `vite.config.ts:60-68`'s false comment); dynamic-import exceljs + pdf-lib (`data-inspector-core.tsx:38-39`, `ai-copilot-provider.tsx:33-40`); splash ≤1 s + dismissible (`splash-screen.tsx:33`'s 2,200 ms gate); lazy ar/en dictionaries (the gen dicts die per E5.2 anyway); the autofill eager-mount removal (E1.8 gates it — T-583 removes the static mount). Verify: before/after boot-timeline evidence; the eager-JS bundle cut (est. 40-60%). Findings: BUG-054.
- **T-584 · scheduled automation runner + working example (5.16) · M.** A runner for `scheduled`/`calendar_cron_event` triggers (a 10-min cron EF enumerating deployed scheduled workflows, or pg_cron — the S11 §F15 design); the seeded published template + the roll-call `absence_limit_exceeded` trigger + the owner-secrets doc = the working example. Verify: a scheduled workflow fires end-to-end in mock + the EF dry-run. Findings: BUG-055.
- **T-585 · AI hardening remainder (5.17) · M · after T-572.** `AbortSignal.timeout(60-120 s)` on the fetch paths (`stream-client.ts:138`, `provider-registry.ts:90`); remove the dead model metadata (`narrative-generator.ts:73-74` dies with E1.2 — remove the reference); the passphrase → `safeStorage`/OS keychain (`ai-config-storage.ts:27,85-93`); the AI-i18n decision (document French-only or route per-locale). Verify: timeout tests; the keychain round-trip. Findings: BUG-056 (non-UX half).
- **T-572 · the copilot failure UX (5.22) · S.** (a) paired-error semantics (the failed turn gets a visible assistant error message, persisted) or commit-on-success; (b) the unconfigured empty state + honest header badge (`copilot-drawer.tsx:115`); (c) `logger.warn` the failed send; (d) UPDATE `copilot-drawer.test.tsx:204-246` (replace the :245 defect pin). Findings: BUG-044.
- **T-587 · per-year diagnostics price basis (5.18) · M · after E2.4 + T-562 · v2.3: executes INSIDE the §16 overhaul (its pricing-basis stage).** Thread `yearPricingConfigs` into the diagnostics card; resolve the price basis per row's attributed year (`attributeInstallmentAcademicYear`); regenerate-or-delete `REAL_TUITION_BY_GRADE` — **flat and NOT year-keyed at all (the import applies 2026-2027 pricing to every format incl. 2027-2026) + the hidden `REAL_FI_AUTISTE` 23,000 special case in the adapter; corrected location `school-price-matrix.ts:99-130` (the registration fallback; consumed `webhook-diagnostics.ts:76/:1397`, autiste hardcoded OFF at `:1407`)**; the "price basis: <year>" banner; the t-529 two-era extension. **The full engine defect set (year threading, current-grade audit, the ×2 FI gate, all-years pooling, `dzd()` guard, thresholds API) lives in §16/T-612.** Findings: ARCH-037.
- **T-588 · settings 8-store unification (5.19) · M.** system_settings becomes the single tenant-level store: 1) the RBAC matrix saves to `tenant_role_overrides` (closes BUG-017; SET-U5); 2) dead keys removed (DEAD-018); 3) the `?tab=` deep-link effect (BUG-031 + BUG-043; SET-U4); 4) the backup passphrase mirror + the daemon-schedule read wire to the DB (with T-581); 5) the 13+ stores collapse (C-25: the 8 recorded — config.json/local-config/prefs/ai-config/backup/rbac/experimental/session-cache — + dashboard-layout, placement-draft, custom-themes, sync.lastSyncAt, ai-passphrase; boundaries documented). Verify: settings suites + RBAC matrix tests + the enforcement-parity probe (UI gates == server RLS). Findings: ARCH-038, DEAD-018, BUG-017/031/043.
- **T-596 · the dashboard overhaul UX (5.21) · L · after T-590 + T-589. · v2.3: the full-light Statistics UI mandate.** The owner-designed dashboard: fast, minimalist, uncluttered, non-amateurish, self-explanatory for an average user — D-U1 view-model hooks (E6.9) + D-U3 RoleDashboardTemplate + the KPI/collapsible composition (E6.7/E6.8) on T-590's compact-RPC data source; **ONE single calculation engine shared by Dashboard and Payments/Finance (D-U2/L-6/E4.5) — the numbers-equal test is the acceptance gate**; the demographic/aging surfaces consume the aggregation RPCs (BUG-059's UI side). **v2.3 (the owner's locked mandate): the ENTIRE Dashboard AND Statistics UI is rebuilt/styled as a clean, cohesive FULL LIGHT experience — Light/White is the PRIMARY theme: `OverviewTab`, `AnalyticsTab`, `StatStrip`, `ExecutiveCards`, `MixCards`, `InfoTip`, `dashboard-theme.ts`, and every chart SVG/card (including the aging/Pareto/YoY/mix/payroll charts and the inspector surfaces after T-613) — zero leftover dark cards, dark chart backgrounds, or unreadable contrast; every chart consumes the live light tokens (BUG-075's fix is the precondition).** Verify: dashboard snapshot suites + the Dashboard↔Finance numbers-equal test + **the full-light visual pass over every tab/card**. Findings: ARCH-040 (UX), BUG-059 (surface), D-U1..U5, BUG-075.
- **T-597 · OAuth switching + Gmail rebinding (5.20) · M.** D-18's lane: the Settings → Account & OAuth section (getUserIdentities/link/unlink/updateUser wiring; the dead `signInWithGoogle` at `supabase-auth-repository.ts:240-252` becomes a live Electron-callback-correct surface); the transactional `replace-user-identity` EF (create-new → re-point `user_profiles.auth_user_id` + `parents.auth_user_id` + `students.auth_user_id` + `activation_codes.bound_to_auth_user_id` → delete-old last → audit); the `OWNER_PINNED_ADMIN_EMAIL` literal (`delete-user-account/index.ts:69`) → the `is_owner_pinned` DB flag. Verify: identity-swap integration test (profile + 100% history intact; portal access preserved). Findings: D-18, DS/07 §D9-D10.

### E7A — STAGE A completion (ROADMAP Phase 6 — the query-minimization + relocation lanes; D-17's immediate lane beyond §3 Step 5)

**E7A-1 · T-590 · the dashboard server-side aggregation (6.3) · M-L.**
Target: the desktop's dashboard reads compact JSON, not full collections. Steps: 1) new migration(s) with the aggregation RPCs / validated MVs for KPI, revenue-by-month, debt-aging, demographic counts/distributions — building on the 0021→0034/0041/0049/0111-corrected chain (`compute_parent_summary`/`compute_debt_aging_rows`/scalar-subquery counts; **parameterized academic-year-range windows — never `NOW()`-anchored rolling windows; never charges-only sums; never stale-positive-only** so arbitrary year ranges work accurately); 2) **the `mv_grade_summary` unique index** (the REFRESH CONCURRENTLY precondition — **S26 audit: confirmed STILL ABSENT in `0001` (chain-faithful: 0041:51 dropped 0021's index with the matview and never restored it; the other four matviews carry theirs); the `refresh_materialized_view` whitelist also excludes the name — widen BOTH when the index lands**); 3) the aging-convention reconciliation (0111 `MAX(due_date)` vs 0123 `min(due_date)` — one documented convention); 4) the dashboard repository consumes them (feature-flagged); 5) `dashboard-page.tsx`'s triple data path collapses (`:181-201` uncached parallel downloads, `:251-270` prev-year second-tick duplicate, `:271-276` third parallel observable path — all die; the observables' caches stay for entity details); 6) parity tests vs the client-side engines (the S8-oracle discipline) per RPC. Verify: parity + year-range tests; the egress gate (T-595) shows the dashboard class dead. Findings: ARCH-040 (data path), BUG-059, DEAD-019.

**E7A-2 · T-591 · targeted projections + keyset pagination + on-demand details (6.4) · M.**
Target: zero unbounded `SELECT *` / full-tenant downloads. Steps (the census list, both house patterns — `paginateKeyset` for entity collections, the 0123 jsonb aggregate-RPC for tenant-wide derivations): `reconcile()`'s trio (BUG-061 + **BUG-069/BUG-072 — the reads are not even tenant-scoped today: `supabase-shared-repositories.ts:3418-3422` (three `select("*")`, no `.eq("tenant_id")`, no limit) and `:5195-5199` (the delinquent source, equally unscoped+uncapped) — this card adds the tenant-scope filters + the keyset/RPC walks** (S27/C-27: the LEDGER leg was already fixed by T-423 — the RPC/keyset seed at `:3030-3062` is tenant-scoped and untruncated; the truncation class lives exactly at these two remaining sites) — column-projected RPC reads; **the integrity-check surface must not run on truncated inputs: a prerequisite of the relocation guide's Path-2 verification**); `collectDebtors()` → `read_debt_summary_collection` (BUG-060); `refreshProfile()`'s ledger+installments → drawer-open on-demand fetches (BUG-063 a/b); `fetchDocumentRows`/`fetchAcademicHistoryRows` → keyset (BUG-063 c/d); `salary_payments` → keyset (BUG-063 e); the `er_*` quartet → keyset + server-side filters (BUG-063 f); calendar payments → keyset (BUG-063 g); overdue-alerts pair → keyset (BUG-062); `inventory_items` → keyset (BUG-063 h); **the lint guard**: flag any `.from()` read chain without limit/range/keyset/count context on >1,000-row tables. Verify: per-site query-shape tests + count correctness vs the full table; the lint guard wired to CI-ish check. Findings: BUG-060..063, OPS-015 (read family).

**E7A-3 · T-592 · the incremental delta cache (6.5) · M.**
Target: the 30 s/focus re-seed volley (~13,000+ rows per cycle — **ARCH-049's corrected blast radius: 30 `CacheFreshness` instances across 18 repository files, ~3× the "9 caches" design comment**) dies; incremental deltas live. Steps: 1) the cache layer consumes the `0143` `(updated_at, id)` composite keyset cursor per table (cursor state persisted per cache); 2) intelligent invalidation — write-path-keyed (a local mutation invalidates precisely its entity entry; a sync pull patches the cache); 3) the 30 s/focus triggers become delta pulls (empty-cursor tables skip network entirely); 4) full re-seed demotes to cold-start/manual refresh; 5) **the one-coherent-caching-architecture decision:** the `QueryClientProvider` phantom mount (`main.tsx:36-45,58` — ARCH-020/F-U4/L-13) is pruned with `@tanstack/react-query` OR wired in — ONE documented architecture (`useObservable` 359 sites / 105 files + `CacheFreshness` + the ADR from E4.8); 6) under Stage B this layer becomes local-IPC-backed. Verify: delta-correctness tests (insert/update/delete propagation); the volley gone (T-595 gate); zero phantom dependencies. Findings: OPS-015 class 1, ARCH-020, DUP-029 (layer), F-U1/F-U4.

**E7A-4 · T-593 · the transactional batch sync RPC (6.6) · M.**
Target: the ~3-4-requests-per-queued-item pattern collapses. Steps: 1) new migration: `sync_apply_batch(mutations jsonb[])` — one transaction; per-mutation apply via the existing canonical RPCs (ADR-002's authority unchanged); `sync_queue` status updated in bulk; compact per-item results returned; 2) `default-push-handler.ts` groups queue entries (bounded batch size); 3) the per-item fallback path kept during soak, then removed; 4) **the 30 s local IndexedDB check stays** (it already skips network when the queue is empty; `sync-service.ts:113` poll cadence = the local trigger); 5) failure-injection tests (atomicity: a mid-batch failure rolls back the whole batch + the queue rows). Verify: batch round-trip + atomicity tests; the 1,000-row import = a handful of requests (T-595 gate). Findings: OPS-015 class 4 (the sync push pipeline).

**E7A-5 · T-595 · the egress measurement gates (6.7) · S · after E7A-1..4 + T-559/T-560/T-594.**
Target: proof, not assertion. Steps: 1) a measurement harness (boot / dashboard load / navigation / 1,000-row sync batch scenarios; request counts + payload bytes; run against mock and — in the one-time live window — against live); 2) before/after artifacts recorded under `docs/recovery/` evidence; 3) the external-dependencies register: **the client portal (`portal.elimtiyaz.dz`) and the Android repo (`Vtheonly/elimtiyaz-android`) are registered for audit — their queries join the audit set if the repos are provided** (D-17); 4) the OPS-015 four-class delta table completed. Verify: the recorded artifacts; the four classes verified dead/collapsed. Findings: §14.5, D-17, OPS-015.

**E7A-6..E7A-10 · the relocation lane (6.8–6.12): T-573 → T-574 → T-575 + ARCH-046 + T-598 → then T-614 (the website cutover, 6.14).**
- **T-573 (6.8) · M** — the `BackendProfile` switcher (§3 Step 6; ADD-9; supersedes T-551's scope + E1.7's deletion; the OPS-016 unlock wires here). Acceptance: the packaged app re-points without a rebuild.
- **T-574 (6.9) · M · after T-573** — the relocation auth tooling: (a) the UUID-preserving auth-user export/import command pair (admin API); (b) the email-match remap script with a dry-run report; (c) the password-reset communication flow. Evidence: the 7-surface linkage map (GUID Layer 3.1). **Path 2's prerequisite: ARCH-029/BUG-061 must be fixed first (the runbook's hard flags).**
- **T-575 (6.10) · S · after T-573** — `scripts/preflight-target.mjs` (**the consolidated baseline: 1 migration (`0001`) / 99 tables / 14 views / 5 matviews / 11 buckets / 264 policies (242 public + 22 storage) / 147 functions / 90 triggers — Deep Sweep/14 Part C.3, re-proven by the S26 PGlite from-scratch audit; the §A.2 verification SQL (supabase_migrations = 1 row version '0001'; verify_t-376 12/12) re-checked against `0001` at HEAD in S27 — zero broken references; NO `migrations_archive/` push, only `0001`)** wired into the packager as the preflight of record → **OPS-016 unlocks: a Windows installer buildable against a healthy target**.
- **ARCH-046 (6.11 / 2.4) · XS** — the config.toml ↔ functions/ reconciliation (delete `[functions.export-data]`/`[functions.generate-receipt-pdf]`; add `create-user-account`/`delete-user-account`/`send-push-notification`; the S27 re-check: the 15 EF dirs + `_shared` all exist under `supabase/functions/`). Execute ONCE (in 2.4 or here — never both).
- **T-614 (6.14 — v2.3 NEW) · S · after T-575/T-574 + D-21/OPS-019, owner-gated (Vercel access) — the Website Cutover, Env Update, Redeploy & Operational Verification card.** The full checklist (the runbook's §A.7; the audit: Deep Sweep/16; the finding: OPS-021): (1) the Vercel env re-point (`NEXT_PUBLIC_SUPABASE_URL=https://gvuvibcsfjhwcjikgxql.supabase.co` + the NEW project's publishable key — **env beats the repo's committed OLD-ref defaults (`public-config.ts:89-92`) but a redeploy is mandatory (build-time inlining)**); (2) the website repo's pinning-test commit (t-516/t-096 re-pinned to the new identity); (3) the new project's auth parity (site_url + the redirect allow-list containing `https://elimtiyaz-website.vercel.app` + the Google provider per D-21); (4) the EF/buckets/realtime parity (`bind-activation-code` + the 5 buckets WITH objects + the 6 realtime tables); (5) the end-to-end portal smoke (login → bootstrap → finance → activation → timetable → documents → notifications/chat → FCM). **Boundary honesty: the website source lives in `Vtheonly/elimtiyaz-website` (outside this repo); the owner supplies Vercel access (or the PAT) + the website repo push.** Verify: the §A.7 checklist ALL-pass + the portal's own `vitest run` green post-re-pin. Findings: OPS-021, D-17 (the portal consumes Supabase unchanged).
- **T-598 (6.12) · M · G2-gated (after T-559/T-560/T-594 + E7A-2)** — the post-cap-lift payment reconciliation oracle: the live census + full export (`payments`, `installments`, `payment_allocations`, `ledger_entries`); the offline oracle per student (Σ allocations vs payment amounts; `amount_paid > amount_due` rows — the 1,281-class legacy set; workbook TOTAL*CREANCE vs derived remaining); the repair policy (corrective `account_adjustments` with provenance, never silent rewrites; re-import idempotence); the future-anchored bucket surfaced everywhere it can confuse. **v2.3: the One-By-One Excel gate applies — the oracle validates against EACH actual financial workbook INDIVIDUALLY (`Excel/Suivis clients  2026_2027.xlsx` alone AND `Excel/2027-2026.xlsx` alone; `ETAT 2024 -205.xlsx` as the owner-supplied external path + the S23 fixtures; the school workbook where applicable) — 100%-row 0-DZD-delta per file, no combined-run masking.** Verify: the oracle report over the full export, per-file. Findings: C-21, §A1.5, DS/07 §A1.5, OPS-021 (the website consumes the same data — cross-verified at cutover).

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
6. FINDINGS_INDEX sweep: every one of the **204** registered IDs moved to its terminal state (done / documented / owner-gated); corrections C-1..C-27 (C-23..C-25 from S24; C-27 from S27) + the v2.0 reconciliation register R-1..R-5 recorded.
7. Final self-audit: only `Investigation Archive/` + `Refactoring Unified/` were ever touched during the investigation + blueprint phases; execution-phase commits cite T-tasks throughout.

---

## 5. Decision gates — the D-1..D-21 digest (full packet: `Investigation Archive/OWNER-DECISION-PACKET.md` + the S23/S25 addenda: D-20's five-row ⏵ table, D-21's owner-side OAuth step)

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
| **D-20** | Unified-Excel lane semantics | ⏵ staged defaults (the five-row table, Part G — T-604/T-608/T-609) |
| **D-21** | Google OAuth completion (the NEW project) | **Owner-side single step** (the Google client's redirect URI + consent screen — the Supabase side is already wired, OPS-019) |

**Standing owner actions (no decision needed):** OPS-012 rotate/redact the committed credential sheet — **widened (S25/S26): the owner re-pasted the COMPLETE inventory in plaintext chat (both projects' key sets + both management tokens + the GitHub PAT + the Vercel PAT + the Firebase key) — rotate the full set once the OAuth setup completes**; OPS-013 the Vercel PAT is VALID (rotated by the owner — S13 re-test; S26 re-probe 200; **not in the S27 env set — the Vercel API probe skipped, honestly recorded**) — rotate only if the website workflow needs it; OPS-011 the OLD management token tests invalid (the NEW one is valid — OPS-017) — REST with the secret key works once the cap lifts. **OPS-019 (S25):** the NEW project's Google client needs its redirect URI added on the Google side — D-21's single owner step; the Supabase side is fully wired. **P8/P11 (S26):** the Firebase/Vercel tokens were re-supplied — both probes RESTORED (P11 200 VALID; P8 400 format-accepted, unchanged). **OPS-021 (S27):** at cutover time the owner supplies Vercel access (or the PAT) + the website repo's push for T-614's env re-point/redeploy/pinning commit; `ETAT 2024 -205.xlsx` stays an owner-supplied external path for the T-603..T-611/T-598 fixtures.

---

## 6. Finding → action traceability matrix (v2.3 — ALL 204 registered IDs → their execution homes)

**Registered set (v2.3):** DEAD-001..015, 017..024 (23) · DUP-001..032, 034..037, 040 (37) · ARCH-001..049, 052 (50) · BUG-001..075 (75) · OPS-001..021 (21) — **204**. (DEAD-016, DUP-033, DEAD-026/027, DUP-038/039, ARCH-050/051, BUG-070/071 were never assigned — skipped placeholders in the numbering. S23 added BUG-066..068/ARCH-047/048/DEAD-024; S24 added DUP-037/ARCH-049/BUG-069/OPS-017/OPS-018; S25 added OPS-019; S26 added OPS-020 — the charter; S27 added BUG-072..075/DUP-040/ARCH-052/OPS-021 + C-27.) "Doc" = documentation-only disposition. "Owner" = owner-gated (§5). Orphan check: **zero** — every registered ID has a home below (§17.1's extension).

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
| BUG-072 | E7A-2 (T-591) + §16 (T-612) | the unscoped+uncapped `reconcile()`/`collectDebtors()` reads (the corrected BUG-061/069 home) |
| BUG-073 | §16 (T-613) | the inspector PDF pagination + WinAnsi + silent failures |
| BUG-074 | §16 (T-613) | the three inspector trigger-seam mismatches |
| BUG-075 | T-589/T-596 + §16 (T-613) | mix-cards' frozen dark palette capture |
| DUP-040 | §16 (T-613) | the three inline INV-4 copies + the raw settled predicate |
| ARCH-052 | §16 (T-613) | the third debt basis (ledger-balance vs INV-4) + the mock aging parity split |
| OPS-021 | T-614 (§12/§16/Track 3) + §5 standing owner actions | the website relocation dependency set (DS/16) |
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
| `supabase/migrations/**` (the consolidated baseline `0001` + `0002+` append-only; the 152 originals frozen verbatim in `migrations_archive/`) + EFs (16) | E3, T-590/T-591/T-593, T-597, ARCH-046 | append-only repairs + the Stage A RPCs + `replace-user-identity`; all permanent |
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
3. **New discoveries during execution:** register as new finding IDs (next free after S27: DEAD-027, DUP-041, ARCH-053, BUG-076, OPS-022) with file:line evidence; corrections from C-28 onward. Never erase prior records.
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
- **T-575:** the one-command target preflight — `scripts/preflight-target.mjs` (**the consolidated baseline: 1 migration (`0001`) / 99 tables / 14 views / 5 matviews / 11 buckets / 264 policies (242 public + 22 storage) / 147 functions / 90 triggers — Deep Sweep/14 Part C.3, S26-re-proven** / RLS census / the 5 helpers' SECURITY DEFINER parity — the 54001 regression / EF drift / authenticated REST smoke / verify_t-376 12/12); wired into the packager as the preflight of record. **Charter rule 3 (OPS-020): the preflight's apply path runs ONLY after a fresh 100% local from-scratch validation pass — `Investigation Archive/MIGRATION-CONSOLIDATION-AND-EGRESS-CHARTER.md`.**
- **Sequencing note:** the guide's §A.0 preconditions restate the OPS-015 order (T-559/T-560 + BUG-058 before ANY live traffic); ARCH-029/BUG-061 are prerequisites of the guide's Path-2 emergency recovery and remain in their registered lanes (E7B-4 / E7A-2).
- **Positive finding (no action):** storage paths are bucket-relative everywhere — no URL-rewrite pass is ever needed in a relocation; preserve the invariant with a lint guard when convenient.

**Register linkage (S18; S25/S26/S27 additions):** OPS-016, ARCH-046, OPS-017 (the READY blank target — the lane's live seed), OPS-019 (the owner-side OAuth blocker — D-21), OPS-020 (the charter; the relocation guide's §A.2 carries the corrected consolidated-baseline counts), OPS-021 (the website relocation dependency set — DS/16); re-cited: OPS-011/015, BUG-042/058/061, ARCH-029, C-20, DEAD-019/023.

**The website lane (v2.3 — the owner-supplied portal joins the relocation track):** the owner provided the website repo (`https://github.com/Vtheonly/elimtiyaz-website`) + the live URL (`https://elimtiyaz-website.vercel.app/`). The S27 audit (Deep Sweep/16) censused the portal's COMPLETE Supabase dependency set — 31 tables + `v_timetable_published` + 4 RPCs + the `bind-activation-code` EF + 5 buckets + 6 realtime tables; ONE browser client consuming `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` with **committed OLD-ref defaults (`public-config.ts:89-92`) that silently rule the production bundle when the Vercel env vars are unset**; the dynamic-origin OAuth redirect (no `/auth/callback` route, zero literal portal URLs); three pinning tests (t-516/t-096) that go red post-cutover; the CSP wildcard `*.supabase.co` (no change needed). **The execution home: T-614 (§4 E7A / ROADMAP 6.14 / the RELOAD-GUIDE §A.7) — the Website Cutover, Env Update, Redeploy & Operational Verification card, sequenced at the Cutover position of Track 3, after T-575/T-574 + D-21/OPS-019, owner-gated on Vercel access.**

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

---

## 15. The Session 25 + 26 addendum (v2.2) — the S25 fold, the S26 empirical baseline, and the standing charter

### 15.1 The new-ID homes (§6 extension — S25/S26)

| Finding IDs | Execution home | Notes |
|---|---|---|
| OPS-019 | §5 standing owner actions + §1 gates row + §12 register linkage + ROADMAP 6.13 | Google sign-in on the NEW project: fully wired on the Supabase side, blocked on the Google side (the client's redirect URIs lack `https://gvuvibcsfjhwcjikgxql.supabase.co/auth/v1/callback`) — D-21's single owner step; the S26 re-probe found the config unchanged |
| OPS-020 | §15.3 (the Charter) + BLUEPRINT §18 + ROADMAP coverage row | the Permanent Migration Consolidation & Egress Charter — standing policy; the verbatim AGENTS.md/AGENTS_supabase.md adoption draft is staged at `Investigation Archive/AGENTS-CHARTER-AMENDMENT-DRAFT.md` (G0-gated) |

### 15.2 The S26 empirical post-consolidation baseline (read-only runs; the first on the post-consolidation tree)

S24 consolidated the migrations **without `node_modules` present** — so nothing had actually been run against the consolidated tree. Session 26 installed the dependencies (`npm ci --ignore-scripts`, gitignored, 603 packages) and ran the full local ladder:

- `npx tsc --noEmit` → **exit 0, zero diagnostics** (two independent runs);
- `bash scripts/check-migrations-append-only.sh` → **exit 0**: `append-only guard OK: 1 migration file(s) (+0 added vs origin/main, +0 new in worktree); 152 archived historical file(s)`;
- `npx vitest run src/tests/infrastructure/t-058-migration-append-only.test.ts` → **6/6 passed** (the suite runs the guard, which understands the layout — no change needed);
- full `npx vitest run` → **Test Files 33 failed | 287 passed | 1 skipped (321); Tests 29 failed | 5116 passed | 5 skipped (5150); duration 626s; exit 1** — the failures decompose EXACTLY into **25 OPS-018 test-failing files + 7 OPS-018 collection-error files + exactly one pre-existing red (the t-502 wave-meter family, BUG-038, T-549's fix)**: every OPS-018-class failure is a stale `supabase/migrations/0NNN` reference (30 literal live sites + 4 constructed-path sites — the constructed ones are visible only by running the suite, and include t-215's creator-map assertions that now see `0001_initial_consolidated_schema.sql` instead of the chain files). The exact file:line census + the one-command fix: `Investigation Archive/OPS-018-COMMIT-1-BLUEPRINT.md`;
- the local from-scratch PGlite audit of `0001_initial_consolidated_schema.sql` → **2,348 statements, ZERO failures; census EQUAL to the S24 record on every axis** (99/14/5/147/90/226/512/242+22/99-RLS/11 buckets/11-54-145 seeds/89 grants/realtime) — the full record: `Investigation Archive/MIGRATION-CONSOLIDATION-AND-EGRESS-CHARTER.md` Part 2.

### 15.3 The Permanent Migration Consolidation & Egress Charter (OPS-020 — the standing policy)

Adopted as standing policy (v2.2): **(1)** never concatenate — consolidations produce ONE minimal canonical file generated from a replayed live catalog; **(2)** design for minimal future Supabase egress (aggregation RPCs/MVs with the unique indexes `REFRESH CONCURRENTLY` requires on EVERY matview, keyset delta primitives, batch mutation RPCs, targeted projections, no unused/high-churn artifacts); **(3)** 100% local from-scratch validation (the PGlite harness + the full census) before ANY remote apply; **(4)** zero production-Supabase writes during consolidation/validation (GET-only probes, keys outside the repo); **(5)** the append-only guard + the migration-path test-reference census (OPS-018-class) updated with every consolidation. The full charter + the S26 re-validation record + the staged AGENTS adoption draft: `Investigation Archive/MIGRATION-CONSOLIDATION-AND-EGRESS-CHARTER.md`. **The egress gaps inside `0001` are confirmed and registered, not defects of the consolidation:** `mv_grade_summary` still lacks its unique index (chain-faithful — 0041 dropped 0021's; T-590/E7A-1 owns the fix + the refresh-whitelist widening); `sync_apply_batch` (T-593) and the parameterized year-range aggregations (T-590) are absent by design; the current `mv_dashboard_kpis`/`mv_debt_aging` are NOW()-anchored (T-590's supersession targets). **`0001` stays the pre-Stage-A baseline; Stage A ships as `0002_*.sql`+ beside it; re-consolidation is reconsidered ONLY after Stage A lands** — never mid-flight.

### 15.4 The OPS-015 hard lock (explicit, v2.2)

**No live builds, no CI/deploy targets, no cap lifts touch EITHER Supabase project (`gvuvibcsfjhwcjikgxql` or `vebfehrpzajhstyhinnw`) until T-559 + T-560 (the five loop-capable sites) + T-594 are coded and verified locally.** This extends the standing OPS-015 ordering (§1 G2, §2 E2X, ROADMAP rule 6) from "no cap lift" to "no live traffic of ANY kind" — including builds pointed at the new project: the egress burn the Stage A lane exists to prevent must not be re-created by a deploy before the fixes are in.

### 15.5 The S26 workbook datum (the pedagogy lane)

The owner's `new excel` commit placed `Excel/متابعة تمدرس التلاميذ.xlsx` — **byte-identical (SHA-256) to the S14 blank template** (programmatically re-inspected twice-loaded; all values dumps byte-identical; 0 formulas): no new rosters, marks, subjects, or averaging rules. `ETAT 2024 -205.xlsx` remains external-only (not in the repo). T-563/T-566/T-567/D-13/BUG-064 are UNCHANGED; the S14 open questions (تكنولوجيا≡INFORMATIQUE, تا/ج, ت اسلا, الوجبات sic, the 4 missing subjects) remain open. Record: `Investigation Archive/Excel_Inspection/s26/`.

*End of execution plan (label: **v2.3** — the five owner mandates locked (the §2 track order; the full-light Dashboard+Statistics rebuild; the full-detail Encaissement+Report PDFs; the One-By-One actual-Excel gate; the early T-577); §16 the inspector/error-detector overhaul + T-614 the website cutover card NEW; the register at 204 IDs — zero orphans; the §0 autonomous queue protocol. Every S24 §14 delta still lives inline at its card (§3 Step 5.3, E2.4, E7A-1..3, §10's cards, §12); Session 25 folded (OPS-019/D-21 + the widened OPS-012); the Charter adopted as §15.3; the v2.2-era label: every S24 §14 delta inline at its card; Session 25 folded; the Charter §15.3; 197 registered IDs — zero orphans. The v2.0-era closing record below is kept verbatim; its "190 registered IDs" was the v2.0-era count). Evidence base: `Investigation Archive/` Sessions 1–23 (FINDINGS_INDEX 190 registered IDs, corrections C-1..C-22); designs: BLUEPRINT v2.0 (§13 Stage A/B + §14 the query-minimization architecture), ROADMAP v2.0 (Phases 0–8), LOCAL-FIRST-BLUEPRINT, 02-UNIFIED-PIPELINE-DESIGN, UI Component Audit 00–05, the DS/01–13 deep sweeps, the LF0-prep package, the SUPABASE-RELOCATION-AND-RELOAD-GUIDE, and the S23 Excel_Inspection/s23 evidence package (the four-workbook census + the 100%-row stress harness). The owner's locked-in decisions D-17/D-18/D-19 (OWNER-DECISION-PACKET Part F) govern wherever they apply; the v2.0 reconciliation register R-1..R-5 resolved every listed contradiction (E1.7↔T-573; E2.4↔ARCH-037; the withdrawn t-502 claim; T-561's 8-site scope; the census-corrected counts: 359 `useObservable`/105 files, 413 `.from()`, 194 `title=`/102 files, 69 executable `auth.uid()`, 40 hand-rolled table files, 70 modal files/114 usages, 17 `supabase-client` bypasses). Every registered finding (all 190) maps to an execution home in §6 — zero orphans (the S23 additions: BUG-066..068/ARCH-047/048/DEAD-024 → Phase 9's T-603..T-611, §13). All version labels unified as v2.0. No application source, configuration, schema, or dependency was modified in producing this plan; the read-only regime is maintained until the owner green-lights execution on Issue #32.*



---

## 14. The Session 24 addendum (v2.1) — the S24 verification, the new homes, and the consolidated baseline

### 14.1 The verification verdict (Deep Sweep/14)

The S24 mandate re-verified this plan's underlying claims against actual code (four read-only agents; 78 claim families): **67 exact-confirmed, 10 confirmed-with-corrections, 3 scope-refuted — zero substance refutations.** The Step 6 completeness audit: **the orphan check passes programmatically (190/190 pre-S24; 195/195 after the addendum below); T-549..T-611 complete; BUG-001..068 complete; the hard orderings verified** (T-549→C-2; T-559→T-560→T-594 before any cap lift; T-561→T-567; greps→deletions; G1–G7→live traffic).

### 14.2 The new-ID homes (§6 extension)

| Finding IDs | Execution home | Notes |
|---|---|---|
| DUP-037 | E2.4 | the FIFTH billing site (mock batchRegister, remise-on-sticker divergence) — the devis consolidation's mock-adoption step absorbs it |
| ARCH-049 | E7A-3 (T-592) | the re-seed volley's true blast radius: 30 CacheFreshness instances / 18 files |
| BUG-069 | E7A-2 (T-591) | reconcile() + collectDebtors() unscoped AND uncapped — add tenant filters + keyset walks |
| OPS-017 | §1 G2R + E7A-6..10 | the NEW project is a READY blank target (REST 200, not capped, schema-empty, valid mgmt token) — the consolidated schema is its seed; the lane's first live step |
| OPS-018 | §0 execution preamble (G0-lift) | 31 src/tests files' `supabase/migrations/0NNN` paths → one mechanical prefix update, the FIRST post-consolidation execution commit |

### 14.3 The card corrections

- **T-594 (§3 Step 5.3 / 6.2) — C-23:** the probe does NOT fire in mock/unconfigured mode (zero requests by design); the drip is ~120/h in configured mode (+1 per online event / manual check). The fix narrows to: resolve the probe URL from the effective runtime config (the T-573 single-source fix generalizes it). The offline network-census verification is unchanged.
- **T-569 (§10) — C-24:** no `teacher_subject_assignments` table exists in the chain — the DB side has been `class_subjects` all along. The DB-side deletion scope is EMPTY; the deletion is the app-side model + mock store + UI surfaces (the 13-file phantom census stands).
- **T-588 (E6.19) — C-25:** the store inventory widens from 8 to 13+ (add dashboard-layout, placement-draft, custom-themes, sync.lastSyncAt, ai-passphrase) — the unification map covers the full inventory.

### 14.4 The consolidated baseline (the ADR-001 amendment)

`supabase/migrations/` now holds the single-pass consolidated baseline (`0001_initial_consolidated_schema.sql` — 99 tables / 14 views / 5 matviews / 147 functions / 90 triggers / 242+22 policies / 11 buckets / canonical seeds; single-pass-verified with ZERO failures, census equal to the chain replay; Deep Sweep/14 Part C); the 152 originals are VERBATIM in `supabase/migrations_archive/`; the append-only guard recognizes the archive move and enforces archive immutability. **Every future SQL change ships as a NEW numbered migration (0002, 0003, …) beside the baseline.** Execution-session consequence: before the first SQL/EF task, run the OPS-018 path update (§14.2); the E3-lane's live-verify ceremony now targets the consolidated baseline's objects (the names are identical — the census proofs in Deep Sweep/14 Part C.3 are the equivalence evidence).

---

## 16. The Payment Error Detector, Diagnostics & Data Inspector Overhaul (v2.3 NEW — T-587 + T-612 + T-613; the dedicated high-priority program)

**Origin (the owner's report):** "the payment error finder / error detector / Data Inspector produces obviously wrong outputs." **The audit of record: `Investigation Archive/Deep Sweep/15-PAYMENT-INSPECTOR-AND-ERROR-DETECTOR-AUDIT-2026-11-21.md`** (two parallel read-only agents; every claim re-verified at HEAD `58662636`; the newly registered set BUG-072..075 / DUP-040 / ARCH-052 + the corrections C-27). **The primary root cause of the wrong outputs is the year-blind, ACTIVE-config-only wiring** — the engine has NO academic-year parameter, the inputs are whole-tenant all-years streams, the pricing basis is today's single ACTIVE config (+ a flat 2026/27 hardcoded fallback matrix with the autiste branch hardcoded OFF), historical rows are audited against the student's CURRENT grade, the FI gate is ×2-asymmetric, and the outlier sum pools every year's tranches — compounded by the 1,000-row truncation in the integrity reads (BUG-072), the dual contradictory reconcilers (ARCH-037/BUG-021), and the Data Inspector's own export/trigger-seam defects (BUG-073/074).

**This section UNITES the previously scattered cards into ONE cohesive overhaul (three task cards, one acceptance gate set):**

### 16.1 T-612 — the diagnostics/reconcile ENGINE overhaul (5.18a) · L · after E2.4 + T-562 (T-587's scope executes here as the pricing-basis stage)

1. **Year threading (the headline fix):** `runWebhookDiagnostics` gains an academic-year parameter; `AuditContext` carries the year; `installmentsByStudent`, the FI-payment loops (`:1762-1990`), and the price audits partition per attributed year (`attributeInstallmentAcademicYear`); the card's year selector (`financials-page.tsx` + `webhook-diagnostics-card.tsx`) filters the streams on the models' existing `academicYearId` and passes **the year's** config (`repos.pricing.readForYear` / the `listConfigs`-by-code map pattern).
2. **The price basis per row (T-587's registered scope):** year-attributed `REAL_TUITION_BY_GRADE` replacement (per-year `yearPricingConfigs`; the flat matrix demoted to a documented last-resort or deleted); the autiste branch live (`REAL_FI_AUTISTE`/`REAL_TUITION_AUTISTE` propagated — parity with the import engine's adapter); the grade at time of record (not the current grade); the "price basis: <year>" banner; the t-529 two-era extension.
3. **The gate repairs:** the symmetric FI tolerance (replace `:1508-1509`'s ×2 multiplier with a symmetric deviation tolerance); the `pay-multi-ledger` reversed-original exclusion (align `:372-379` with `crossCheckClearedBalance`'s `:340-348`); `alloc-sum` crediting `parent_credit` adjustments (`:2087-2122`); the description/adjustment amount-sanity rules (overpriced manual charges no longer "reconciled").
4. **The thresholds API made real:** move the inline tolerances (`:1572`'s 0.1, `:300`'s length cutoff) into `WebhookDiagnosticsThresholds`; the caller (`financials-page.tsx:509-520`) passes configured thresholds (ARCH-009's diagnostics share).
5. **The truncated integrity reads die (BUG-072; with T-591's projection family):** `reconcile()`'s trio (`:3418-3422`) and `collectDebtors()` (`:5195-5199`) become tenant-scoped, keyset/RPC-walked reads (`read_payments_collection`/`read_installments_collection`/the parents cache) — false-clean reconciliations and unreminded debtors past row 1,000 are gone.
6. **The dual-reconciler unification (BUG-021/ARCH-037):** extract the diagnostics' two-form charge resolution (`:502-551`) into a shared module consumed by `crossCheckInstallments`; `Map<string, LedgerEntry[]>` with `length > 1` flagged (the PK-only + last-wins overwrites die); the precise-mode coverage fix (an installment with `amountPaid > 0` and no payment link always covered); mock and Supabase run the same mode.
7. **The hygiene set:** `dzd()` finite guard (`:305-307`); `studentByCode` duplicate guard (`:398-401`); the engine's execution off the render thread (web-worker/computed-cache — the card's `useMemo` over the whole tenant dies); `anomaly-explainer-modal` recomputes on stream change + the stray `<li>` fix.

### 16.2 T-613 — the inspector/console/exports overhaul (5.18b) · L · after T-612 (shares the year context); coordinates with T-596 (its export/theme fixes land first)

1. **The unified export stacks (BUG-073/ARCH-028):** both inspector exports route through the unified engines (`excel/export-engine.ts` for XLSX; `receipt-pdf/report-document.ts` + `sanitizePdfText`/`dzdPdf` for PDF) — the rogue `new ExcelJS.Workbook()` (`data-inspector-core.tsx:275`), the rogue `PDFDocument.create()` (`:337`), the local `downloadBlob` (`:87-94`) all die; the broken pagination (the discarded `addPage` return, `:338-346`), the 80-row/130-char truncation constants (`:342/:351/:352/:355`), and the WinAnsi trio all die with the stack; export failures toast (`void export*()` → handled).
2. **The trigger-seam fixes (BUG-074):** the aging-total trigger passes the strictly-past semantics; the prev-year revenue trigger passes the shifted window (`from/to`); the risk-matrix trigger passes the filtered count — the permanently false Écarts die at the seam (`analytics-tab.tsx:692/:671/:552`).
3. **The canonical predicates (DUP-040):** `installmentRemaining`/`isInstallmentSettled` imported into `operational-query-console.tsx` (the three inline copies at `:351/:383-387/:691-695` die) + `data-inspector-lineage.ts:730`'s raw predicate replaced; the `(amountPending ?? 0)` guard inherited.
4. **The debt basis unification (ARCH-052):** ONE documented basis for the console's risk gates + AI prompts (the INV-4 installments basis, with the ledger-balance family kept as a separately-labeled figure); the mock↔Supabase `debtByAgingForRange` parity suite; the lying labels fixed (`executive-cards.tsx:684`, `data-inspector-core.tsx:143`, `operational-query-engine.ts:43` vs `:273`).
5. **The subscription dedup + the light theme:** the 9 double-subscribed streams deduplicated between `analytics-tab.tsx` and the inspector provider (props, not re-subscription); Student360Modal's 9 full streams become targeted on-open fetches; BUG-075's `mix-cards` frozen palette retargeted; the inspector/console surfaces restyled per the T-589/T-596 full-light mandate; the "Paiement moyen" population fix (`:357-361`); the sentinel/locale unification (`2020..2030` vs `2035`; `fr-FR` vs `fr-DZ`; `DZD` vs `DA`).

### 16.3 The mandatory acceptance gates (all four; the overhaul is NOT done until all pass)

- **G-DETECT-1 (zero false errors, 1-by-1):** the FULL detector + inspector run against a clean import of **each actual financial workbook INDIVIDUALLY** — `Excel/Suivis clients  2026_2027.xlsx` ALONE and `Excel/2027-2026.xlsx` ALONE — produces **zero false-positive findings** in each run (combined runs mask nothing).
- **G-DETECT-2 (100% detection):** an adversarial planted-error corpus — underpayment, overpayment, duplicate payment, devis mismatch, orphaned allocation, wrong academic year, tampered ledger/amount — is **100% detected**, each with the correct rule attribution.
- **G-DETECT-3 (canonical bases):** year-attributed pricing (`yearPricingConfigs` + `AcademicYearContext`), the autiste schedule live, canonical INV-4 predicates everywhere, ONE documented debt basis, tenant-scoped un-truncated integrity reads (verified by row-count parity vs the full tables).
- **G-DETECT-4 (light theme + exports):** every inspector/console surface renders in the full-light primary theme (zero dark leftovers — the T-589/T-596 visual pass extended over the inspector); both exports produce complete, correctly-paginated, WinAnsi-safe artifacts (verified ≥ 100-row exports with é/è/Arabic).

**Sequencing:** T-612 after E2.4 + T-562 (the pricing/year seams exist); T-613 after T-612; both may start once Track 3 lands (disjoint from the relocation files — see §2's parallelism map); the acceptance gates run per task + once at the overhaul's close. **Register linkage:** ARCH-037/BUG-021 (carried), BUG-072..075, DUP-040, ARCH-052, ARCH-009/028 (the diagnostics share), R-10's PDF half, BUG-049's inspector half (T-580 keeps the report-PDF family).

---

## 17. The Session 27 addendum (v2.3) — the final pre-Go audit, the five mandate locks, and the new-ID homes

### 17.1 The new-ID homes (§6 extension — S27)

| Finding IDs | Execution home | Notes |
|---|---|---|
| BUG-072 | E7A-2 (T-591) + §16 (T-612) | the unscoped+uncapped `reconcile()`/`collectDebtors()` reads — the corrected home of the BUG-061/069 truncation class (the ledger leg was already fixed by T-423, per C-27) |
| BUG-073 | §16 (T-613) | the inspector PDF pagination + WinAnsi + silent failures (R-10's PDF-only truncation confirmed; the XLSX half refuted) |
| BUG-074 | §16 (T-613) | the three inspector trigger-seam mismatches (aging-total, prev-year revenue, risk-matrix population) |
| BUG-075 | T-589/T-596 + §16 (T-613) | `mix-cards.tsx:37-51`'s frozen dark palette capture (the T-546 class's last survivor) |
| DUP-040 | §16 (T-613) | the three inline INV-4 remaining copies + `data-inspector-lineage.ts:730`'s raw settled predicate (BUG-012's corrected site) |
| ARCH-052 | §16 (T-613) | the third debt basis (ledger-balance vs INV-4) + the mock↔Supabase aging parity split |
| OPS-021 | T-614 (§12/§16/Track 3) + §5 standing owner actions | the website relocation dependency set — Deep Sweep/16 (the committed-default trap, the pinning tests, the auth/EF/buckets/realtime parity set, the Vercel/owner boundary) |
| C-27 | Doc (the corrections register) | six corrections: BUG-012's site → `data-inspector-lineage.ts:730`; BUG-061/069's ledger leg FIXED (T-423) — the class lives at BUG-072's sites; R-10's XLSX half refuted (PDF-only); DUP-011's console site corrected to `operational-query-console.tsx` (DUP-040); BUG-057's literal NaN refuted (guards exist; the residuals are the silent-zero semantics + the unguarded `dzd()`); `reconcile()` has zero production UI call sites |

### 17.2 The website portal audit verdict (Deep Sweep/16)

The live portal is UP (GET 200, Vercel) with its bundle still on the OLD project; the repo is a mature Next.js 16 SPA (61 test files; the T-531-era presentation polish) with ONE Supabase browser client, a dynamic-origin Google OAuth redirect (no `/auth/callback` route, zero literal portal URLs), PAGE_SIZE-1000 `.range()` pagination (no egress-violation class of its own), and the committed-default trap (`public-config.ts:89-92`). **The cutover plan: T-614 + the RELOAD-GUIDE §A.7 + `02-NEW-PROJECT-VERIFICATION.md`'s S27 addendum (the redirect-URL set on the new project).** The honest boundary: the portal's code lives in `Vtheonly/elimtiyaz-website` (outside this repo); the owner supplies Vercel access (or the PAT) + the website repo's push at cutover; the Vercel config API was NOT probed this session (no PAT in the env set).

### 17.3 The five mandate locks (the v2.3 changes, enumerated)

1. **The early-relocation track order (§2):** Track 1 (baseline green: Commit 1 + T-549) → Track 2 (OPS-015: T-559 → T-560 ×5 → T-594) → Track 3 (relocation + website cutover + Stage A: `T-550 → T-573 → T-552 → ARCH-046 → T-575 → T-574 → Cutover/Website T-614 → T-590..T-593 → T-595`) BEFORE Phases 1–5 (E2..E6); E1/T-549 first as stabilization; T-577 immediately after Track 3.
2. **Full-light primary theme (T-589 + T-596):** Light/White is THE app-wide primary; the complete Dashboard AND Statistics UI (OverviewTab, AnalyticsTab, StatStrip, ExecutiveCards, MixCards, InfoTip, dashboard-theme.ts, all chart SVGs/cards) rebuilt in cohesive full light — zero dark leftovers.
3. **Full-detail PDFs (T-579 + T-580):** the every-detail Encaissement/receipt/statement contract + the full-table report-PDFs contract (both cards above).
4. **The One-By-One actual-Excel gate (E2.3/E2.4 + T-598 + G-DETECT-1):** every ledger/balance/detector verification runs against each actual workbook INDIVIDUALLY — the two in-repo financial workbooks pinned by SHA (`Excel/Suivis clients  2026_2027.xlsx` 213,689 B; `Excel/2027-2026.xlsx` 558,443 B), the school workbook (195,516 B, byte-identical to the S14 blank), and `ETAT 2024 -205.xlsx` as the owner-supplied external path + the S23 fixtures (its 6 sheets verified one-by-one — `ETAT 20262027`, `ETAT 20232024`, `ETAT 20262025`, `' ETAT 20242025'`, `Etat General Versement`, `CLIENT CRITIQ` — via the archived JSON/CSV fixtures under `Excel_Inspection/s23/`, the external path supplied at test time).
5. **The early right-click (T-577):** Cut/Copy/Paste/Select-All with French labels, read-only surfaces included, automated menu tests — moved to immediately after Track 3.

### 17.4 The S27 mechanics spot-checks (Task 4's results — all CONFIRMED at HEAD `58662636`)

- **OPS-018 blueprint:** 30/30 live literal sites + 3/3 comment sites + 4/4 constructed-path sites verified at the exact cited lines; every cited archived filename resolves in `migrations_archive/`; the §1b "30→33" numbering reconciled (§1c's two t-058 fixtures occupy items 31/32 of the 35-occurrence whole-src numbering — §5 of the blueprint).
- **The runner mechanics:** `scripts/run-unified-tests.mjs` + `scripts/test-baseline.json` (keys: `_comment`/`_task`/`testFiles`/`tests`/`failingFiles`/`equivalence`) + `package.json` scripts all resolve: `test` = `node scripts/run-unified-tests.mjs`; `test:vitest` = `vitest run`; `check:migrations` = `bash scripts/check-migrations-append-only.sh`; `typecheck` = `tsc --noEmit`; `package:win` = `node scripts/build-windows.mjs` (exists at `elimtiyaz-desktop/scripts/build-windows.mjs`); `scripts/verify_t-376.sql` exists — no broken paths, no missing binaries.
- **The Stage-A cards:** T-559 (`toast-provider.tsx:57-69` — the `[toasts, show, dismiss]` memo confirmed at `src/app/providers/toast-provider.tsx:57-69`); T-560 (all five sites in-range: configuration-tab `:72-84`, accounts-tab `:60-80`, pricing-year-config-bar `:58-63` at `features/settings/pricing/`, promotion-cycle-detail `:68-79`, promotion-cycles-tab `:52-63` at `features/academics/promotion-cycles/`); T-594 (`online-detector.ts:87`); T-573 (`supabase-client.ts:35/:205`, `system-config.ts:431`); T-552 (17/17 bypass files + both dynamic-import shapes); T-577 (`electron/main.cts:50` buildMenu — editMenu + context-menu both ABSENT today, the fix target confirmed).
- **The Excel set:** the three in-repo workbooks pinned (sizes + SHA-256 above; the school workbook = the S26 record); **`ETAT 2024 -205.xlsx` NOT in the repo — external-only** (the S23 fixtures carry its per-sheet content; T-603..T-611/T-598 keep it as an owner-supplied external path).
- **`0001` vs the RELOAD-GUIDE §A.2:** the verification SQL's expectations (supabase_migrations = 1 row version '0001'; 99 tables; 264 policies; 11 buckets; the 5 matviews) all match the baseline at HEAD; the 15 EF dirs + `_shared` exist; no `migrations_archive/` push anywhere in the guide (only `0001`) — zero broken references.

### 17.5 The charter typo fix

`AGENTS-CHARTER-AMENDMENT-DRAFT.md` Block B item 7: "CHARITY-FREE" → **"CONCATENATION-FREE"** (the owner-mandated correction, applied verbatim this session — the draft otherwise untouched).
