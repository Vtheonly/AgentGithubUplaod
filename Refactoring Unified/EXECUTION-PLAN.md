# Execution Plan — the El-Imtiyaz Consolidation & Local-First Migration

**Version:** 1.2 (Session 16, 2026-11-20 — the standing S8–S13 queue T-555..T-560 folded into the plan of record + T-572 registered + T-560/T-561 scope corrections, §11; v1.1 Session 15 folded the pedagogy lane T-561..T-571, §10; v1.0 authored Session 6, 2026-11-19) · **Status:** the plan of record's *operational layer* — it converts `Refactoring Unified/BLUEPRINT.md` v1.2 + `Refactoring Unified/ROADMAP.md` (Phases 0–7) and the `Investigation Archive/` evidence base into a single ordered, step-by-step, dependency-aware execution program.
**Companion documents (authoritative, never replaced by this file):** `Refactoring Unified/ROADMAP.md` (the task table of record) · `Refactoring Unified/BLUEPRINT.md` v1.2 (the design of record) · `Investigation Archive/OWNER-DECISION-PACKET.md` (D-1..D-12 decision gates) · `Investigation Archive/Findings and Hypotheses/FINDINGS_INDEX.md` (every finding ID cited below).
**Why this file exists (owner directive, Session 6):** the next session must be able to *act immediately* — every issue found carries an exact target decision, concrete migration steps, execution order, and dependencies. No laundry lists; nothing left to re-interpret.

---

## 0. How to use this document — execution-session protocol

**You are the consolidation/refactoring session. Bootstrap in this exact order:**

1. `git fetch origin && git status` (must be clean; sync `main`).
2. Read: `Investigation Archive/README.md` → `Investigation Archive/SESSION_LOG.md` (row 6 = Session 6) → `Investigation Archive/Handoffs/handoff-session-07.md` → **this file, end to end**.
3. Check Issue #32 (`/repos/Vtheonly/AgentGithubUplaod/issues/32` + `/comments`) for owner answers to D-1..D-12. **If any answer exists:** record it as a dated addendum in `OWNER-DECISION-PACKET.md`, adjust the ROADMAP rows it gates, and re-read §5 of this file. If none: **the ⏵ DEFAULTs govern** (they are self-consistent and nothing below changes).
4. Run the GET-only probe set (see `Investigation Archive/01-INFRASTRUCTURE-STATUS.md`; the probe script pattern is recorded there) and update that file. **Watch for one thing:** if the Supabase REST probe with the secret key returns **200**, the spend cap has been lifted → immediately schedule the live-DB census + final-export ceremony (§4, stage E7 step 1; the one-time extraction becomes possible).
5. Then start executing at §3 (the immediate queue) — regardless of owner silence, because its first item (T-549) is pre-authorized as an independent bug-fix lane if you accept the default reading; everything after it is gated per §1.

**Standing rules you must not break (inherited from the investigation charter + AGENTS.md):**

- One registered T-task per commit; five-question commit body; push immediately after every commit; never force-push. Register each task in `docs/recovery/task-registry.md` per the staged drafts BEFORE writing code.
- `npx tsc --noEmit` + the touched features' vitest suites green before each commit; full `npm test` + baseline move at each batch boundary (baseline moves ONLY per `scripts/test-baseline.json`'s own `_comment` rule, citing the task ID).
- SQL/EF changes follow the live-verify ceremony (AGENTS.md §11.1); migrations append-only; RLS never weakened.
- Every completed task updates `FINDINGS_INDEX.md` (item state) and `docs/recovery/task-registry.md`; unresolved items re-verified or escalated to the owner via Issue #32.
- Kill-switch rollback at every stage: the previous backend/behavior stays selectable until the next stage is green.

---

## 1. Operating gates — what is executable NOW vs owner-gated

| Gate | State at Session 6 close | What it unlocks |
|---|---|---|
| **G0 — read-only regime** | ACTIVE (owner has not green-lit code changes on Issue #32; the only comments are the session mandates) | Nothing in §4 is executable until G0 lifts — **EXCEPT** the T-549 bug-fix lane (pre-authorized as an independent defect fix, see §3) if the executing agent adopts that reading; the strict alternative is to register it and wait with the rest |
| **G1 — owner green-light for LF-0..LF-5** | NOT GIVEN | T-550..T-553 (LF-0) + everything in stage E7 |
| **G2 — Supabase spend cap lifted (one time)** | NOT LIFTED (probe-verified Sessions 2–6: `exceed_egress_quota` 402 on REST/secret/JWKS/auth-health; the NEW keys provided Session 6 are recognized but the project remains plan-restricted — the restriction is at the plan/spend-cap layer, not the credential layer) | The final full data extraction (E7 step 1) + the live-DB census; 24h notice in the issue before the migration weekend per D-5 |
| **G3 — D-1 sync topology confirmed** | DEFAULT (b): internet VPS relay | Only the LF-4 relay deployment details; LF-1..LF-3 do not wait |
| **G4 — D-8 live-restore semantics** | DEFAULT: enabled locally, gated multi-user | E7's restore UX copy only |

**Reading the gates correctly:** investigation sessions (S1–S6) ran entirely inside G0. The execution session's first job is to establish (or explicitly assume) that G0 has lifted. If you are reading this as the execution session, the owner's Issue-#32 mandate for a consolidation/refactoring session *is* the green-light for the refactoring program itself (Phases 0–5 + pipeline P-0..P-2) — the local-first migration (E7) additionally wants G1 stated explicitly, and the final export hard-requires G2. When in doubt: execute in the order below, stopping at the gates, and post the pending owner actions to Issue #32 (they are pre-collected in `OWNER-DECISION-PACKET.md`).

---

## 2. The master execution sequence — eight stages, dependency-tight

The ROADMAP's Phases 0–7 are re-sequenced here into execution stages E0–E8. **The mapping is 1:1 — no roadmap row is dropped or reordered except where the graduated interlocks dictate** (Phase 6↔7 interlocks and the 7.3-supersedes-6.16 rule are folded in below).

```
E0  Session-zero housekeeping (no app-code changes)         ──┐
E1  Zero-risk cleanup (ROADMAP Phase 0)                      ──┤ can start immediately under G0 as *prep*,
E2  Money path (Phase 1)                                     ──┤ full speed once G0 lifts
E3  Backend defect repair, live SQL/EF (Phase 2)             ──┘ (E3 items are G2-sequenced per row)

E4  Structure & contracts (Phase 3)   ── after E2.2 (INV-4 predicates exist)
E5  Platform hygiene (Phase 4)         ── independent of E4 except 4.2 (sibling-repo check)
E6  UI unification (Phase 5)          ── independent of E4/E5; UI-U1 before UI-U2/U3

E7  Local-first migration (Phase 7 = LF-0..LF-5) + pipeline unification (Phase 6) interleaved:
    7.0 LF-0 seam ─┬─ 6.1..6.4 pipeline core facades (parallel)
    7.1 LF-1 engine ←─ 6.5 one-commit-path (VaultReplayAdapter)   [6.5 feeds 7.1]
    6.8..6.14 restore/archive hardening ←─ 6.5
    7.2 LF-2 auth  ←─ 7.1
    7.3 LF-3 EF ports + storage ←─ 7.1   (absorbs 6.16; deletes 2.3/2.4 scope)
    7.4 LF-4 sync relay ←─ 7.1 + 6.6     (G3-gated deployment only)
    7.5 LF-5 demotion + teardown ←─ 7.3 + 7.4
    FINAL EXPORT (G2) sits between 7.1 and 7.5 — the one-time Supabase extraction
E8  Verification & closeout (INV-2 kill-the-network gate, baseline moves, register sweep)
```

**Parallelism map (for multi-agent execution):** E1∥E6 can run concurrently once started (disjoint file sets, except E1's 0.2 dashboard dead-file deletion vs E6's D-U1 — sequence E1.2 first); E4∥E5 likewise. Inside E7: LF-0 steps 1–2 ∥ LF-0 steps 3–4 after T-550 (per the S5 draft note); 6.1–6.4 ∥ LF-0 entirely. Never parallelize anything onto the same repository file without a merge plan.

**Effort scale (from the graduated docs):** XS ≤ 1 day · S ≤ 3 days · M ≤ 2 weeks · L ≤ 1 month · XL = the LF-1 engine build. The full program is a multi-session arc; the school is never blocked mid-arc (after LF-1+LF-2 the app is fully functional locally with zero Supabase dependency).

---

## 3. The immediate queue — exactly what the next session does first

Seven concrete steps, in order. Steps 1–3 are executable **inside G0** (documentation/registry only). Steps 4+ need the gate lifted (§1).

### Step 1 — Register the staged tasks (no app code touched)

Copy the six pre-drafted rows **verbatim** from `Investigation Archive/Local-First Architecture/LF0-TNUMBER-DRAFTS-2026-11-19.md` into `docs/recovery/task-registry.md` (format: the repository's own `## T-NNN` convention), set `Status: Not Started`, and append them to `docs/recovery/next-task.md`:

- **T-549** — BUG-038 fix lane (the only red file in the full vitest ladder; baseline deviation).
- **T-550..T-553** — LF-0 steps 1–4 (ports-as-interfaces; hard-lock removal; bypass routing; ADR adoption).
- **T-554** — LF-1 spike scoping (PGlite packaging/perf/policy-parse harnesses).

**Apply the S6 correction first:** T-552's recorded scope ("16 bypass files") is **17** — the S4 census missed the two *dynamic* importers (`src/infrastructure/sync/conflict-detector.ts:405` and `src/infrastructure/sync/default-push-handler.ts:76` reach `getSupabaseClient` via `await import(...)`). Register T-552 with scope 17 and extend its verification grep to BOTH shapes: `rg "from.*supabase-client" src -g '!src/infrastructure/supabase/**'` **and** `rg "import\(.*/supabase-client" src -g '!src/infrastructure/supabase/**'` (expected after completion: only `repository-provider.tsx` on the first; zero non-supabase-tree hits on the second).

### Step 2 — Adopt the two ADR supersessions (T-553, docs-only)

Execute T-553 exactly as drafted: assign real ADR numbers, copy `ADR-002-SUPERSSION-DRAFT.md` and `ADR-004-SUPERSESSION-DRAFT.md` verbatim into `docs/decisions/`, add pointer-lines to the originals' Status sections, annotate AGENTS.md §15.5's "canonical server implementation" language. Verification criteria are inside the drafts. (If G0 is still considered to bar `docs/` writes, this step waits with the rest — but note the investigation sessions never wrote outside the two archive folders; the execution session writes docs/ as part of T-553's own scope.)

### Step 3 — Re-pin the failing baseline expectation (test infra only, G0-safe if the T-549 lane is accepted)

Before touching source, record the current failing set: `npx vitest run src/tests/domain/t-502-wave-meter-thresholds.test.ts` → deterministic 8/8-minus-failing red since 2026-10-16 (BUG-038's date bomb — the finance adapter's hard-coded wall clock). Nothing else in the 321-file ladder is red (Session 5 census: 5,270 passed / 1 failed / 5 skipped).

### Step 4 — Execute T-549 (the BUG-038 fix)

1. `src/features/financials/installment-schedule-tab.tsx` — add optional `nowEpochMs?: number` (default `Date.now()`) to the adapter signature at `deriveTrancheWaves` (`:228-231`), thread it into the `derivePooledTrancheWaves` call at `:246`; survey the two secondary wall reads (`:330`, `:708`) — inject the same param or leave each with an explanatory comment (no behavior change in production rendering).
2. `src/tests/domain/t-502-wave-meter-thresholds.test.ts` — pass the fixed `NOW` constant into the three finance adapter calls.
3. Verify: the t-502 suite → 8/8 green; `npx tsc --noEmit` → 0; full ladder = documented baseline with an empty failing set; move `scripts/test-baseline.json` ONLY per its own `_comment` rule citing T-549.
4. Commit (`T-549: inject evaluation clock into finance wave adapter…` + the five-question body), push.

### Step 5 — Execute T-550 (LF-0 step 1: the five ports as interfaces)

1. Create `src/infrastructure/backend/ports.ts` — interfaces ONLY (DataBackendPort, AuthPort, RealtimePort, StoragePort, DiagnosticsPort; exact shapes in `Investigation Archive/Local-First Architecture/LOCAL-FIRST-BLUEPRINT.md` §5, which also lists what implements each today).
2. Annotate the repository factory (`src/infrastructure/supabase/supabase-repositories.ts` + the mock twin) with `satisfies` so the 54-slot map is compile-time-checked (this is ARCH-033's exhaustiveness proof — the T-498 `promotionCycles` silent-unwiring class of bug becomes a type error).
3. Zero runtime change. Verify: `npx tsc --noEmit` clean; full ladder = baseline; ARCH-019 suites green.

### Step 6 — Execute T-551 (LF-0 step 2: remove the canonical hard-lock)

1. `src/infrastructure/supabase/supabase-client.ts` — remove the production pin: `CANONICAL_PRODUCTION_SUPABASE_URL` (`:35`), the `VITE_DESKTOP_PRODUCTION` branches (`:148-157`, `:171-172`), and unpin the session storageKey from `CANONICAL_PROJECT_REF` (`:205`, keep it namespaced per backend kind).
2. `src/infrastructure/system-config.ts` — make `validateConnection` backend-kind-aware (currently `:431-433` rejects every non-`*.supabase.co` URL): `local:` = no URL required; relay = any `https://` origin; supabase = the current check.
3. Verify: typecheck + full ladder; ARCH-019 suites; manual matrix — `local:` accepted, non-canonical `https://<x>.supabase.co` accepted, canonical URL behavior unchanged; Configuration tab accepts a local backend without error. Preserved: fail-closed default backend selection (mock), the vault, all RLS-coupled client contracts.

### Step 7 — Execute T-552 (LF-0 step 3: route the 17 bypass files)

Route each bypass through the port/repository surface (per-file, behavior-preserving; the F-U3/ROADMAP 5.11 diagnostics lane is included). The 17 files (S6-verified census): 9 features (`crm/excel-import-modal.tsx`, `crm/parent-detail-drawer.tsx`, `settings/backup-tab.tsx`, `settings/configuration-tab.tsx`, `settings/contextual-thresholds-config.tsx`, `settings/danger-zone-card.tsx`, `settings/supabase-diagnostics/{crud-test-tab.tsx, diagnostics-runner.ts, supabase-diagnostics-tab.tsx}`) + `shared/layout/tenant-switcher.tsx` + `infrastructure/system-config.ts` + `infrastructure/storage/media-vault.ts` + `infrastructure/ai/llm-adapter.ts` + 4 sync-family (`app/providers/sync-provider.tsx`, `infrastructure/sync/online-detector.ts`, `infrastructure/sync/conflict-detector.ts` **(dynamic import)**, `infrastructure/sync/default-push-handler.ts` **(dynamic import)**).
**Verification (both grep shapes, per Step 1's correction):** static-import grep returns only `repository-provider.tsx`; dynamic-import grep returns zero non-supabase-tree hits; typecheck + full ladder + the touched features' suites.

**After Step 7:** T-554 (the LF-1 spike harnesses) then the E7 engine build per §4. If any D-1..D-12 answer appeared at bootstrap, adjust §5-gated rows first.

---

## 4. Task cards by stage

Format per card: **Target** (the authoritative decision) · **Steps** (concrete migration steps) · **Verify** · **Rollback** · **Deps**. Effort scale XS/S/M/L/XL as in §2. Every card inherits the standing rules (§0). Where a card says "per AGENTS §13", register the T-task first.

### E1 — Zero-risk cleanup (ROADMAP Phase 0; nothing user-visible changes)

**E1.1 Root strays (0.1) · XS · none**
Target: repo root = code + governed docs only. Steps: 1) delete the root `src/` stray directory, the stub lockfile, the empty nested file (exact paths in FINDINGS_INDEX DEAD-001/002, OPS-007); 2) `npx tsc --noEmit`. Verify: typecheck clean; no imports referenced the strays (grep first). Rollback: git revert. Findings: DEAD-001/002, OPS-007.

**E1.2 Dead-file batch (0.2) · S · none**
Target: delete DEAD-003 (`dashboard-tab-layout-editor.tsx`, 267 L), DEAD-010 (`narrative-generator`), DEAD-011 (3 barrels). Steps: 1) grep each export for call sites (the import-graph analysis already cleared them — re-run `rg` to confirm nothing landed since); 2) delete files; 3) full vitest; 4) baseline move citing the T-task. Verify: typecheck + full ladder + baseline moved per rule. Findings: DEAD-003/010/011.

**E1.3 DepartmentManagement decide (0.3) · S · OWNER-GATED**
Target: DEAD-004 — remove OR wire. Default: remove (dead since discovery; wiring is a feature decision). If owner silent → remove with a documented revert path. Verify: grep + vitest. Findings: DEAD-004.

**E1.4 Test-only domain files relocate (0.4) · S · none**
Target: 4 domain files consumed only by tests move under the test tree. Steps: move; fix import paths; run vitest from new paths. Findings: DEAD-008/011.

**E1.5 Dead-symbol batch (0.5) · M · none**
Target: remove ~60 dead exported symbols across core/shared/domain/features/infra (exact symbol lists in FINDINGS_INDEX DEAD-006/007/009/012 rows; DEAD-014's flag machinery joins this batch). Steps: per-symbol grep → delete → typecheck → affected suites → baseline move at boundary. Findings: DEAD-006/007/009/012, DEAD-014.

**E1.6 Stale doc comments (0.6) · XS** — fix the 7 cited sites (BUG-030). Verify: review.

**E1.7 Phantom types + dead branches (0.7) · S** — align `vite-env.d.ts` to the real preload surface (this ALSO collapses the LF-0 prep finding: the declared-but-absent `app/fs/config` members are the main-process config bridge LF-0 must build); simplify system-config dead branches. Verify: typecheck + settings config tab suite. Findings: R-3.9, ARCH-class prep (BLUEPRINT §12.4 candidate 1).

**E1.8 Ctrl+O autofill gating (0.8) · XS** — gate to dev builds (ARCH-010, ADD-5). Verify: t-399 suite + manual.

**E1.9 Broken root scripts (0.9) · XS** — remove broken one-off root scripts + stale check-supabase.ts (OPS-002/008). Verify: clone + scripts inventory.

**E1.10 Static JSON dumps (0.10) · XS** — remove 7 static JSON dumps + old-ref cleanup scripts (OPS-004). Verify: docs references updated.

### E2 — The money path (ROADMAP Phase 1)

**E2.1 t-502 settle (1.1) · M · DONE-BY-T-549** — root cause settled in S5 (BUG-038 date bomb, not a predicate regression); the fix is T-549 (§3 step 4). Mark ROADMAP 1.1 resolved by T-549 on completion. Findings: BUG-012(runtime facet), BUG-038.

**E2.2 INV-4 predicate conversion (1.2) · M · after T-549**
Target: one settled/overdue vocabulary. Steps: 1) convert the 6+ settled/overdue check sites to INV-4 predicates; 2) map `deriveDebtTriage` (dashboard `executive-statistics.ts`) onto domain `computeDebtAgingStatus`; 3) align `sumPendingPayments` pending-semantics with the query-engine vocabulary (BUG-019). Verify: per-site regression tests; dashboards' numbers unchanged where vocabulary already agreed. Findings: DUP-016, BUG-012, BUG-019.

**E2.3 Devis fixtures (1.3) · M** — capture current persisted shapes as equivalence fixtures. Verify: fixture suite green.

**E2.4 Devis service (1.4–1.7) · M→S→S→S · after E2.3**
Target: `domain/calc/pricing/devis.ts` composing matrix+tuition becomes THE billing preview engine. Steps: 1) introduce the service (policy param reproducing today's #4 wiring); 2) switch feature `computeBilling` preview → devis service; 3) switch `registration-billing-wires` (mapping only); 4) mock batchRegister adopts it. Verify per step: equivalence suite / batch-registration suites / registration e2e + live-verify script / mock parity tests. Findings: DUP-001, DUP-005.

**E2.5 Formatting consolidation batch (1.8) · M**
Target: shared primitives for isoWindow, DZD formatting, dates, attendanceRate, label maps, periodMinutes, mapStudentRow, CYCLE_OF_GRADE, toIsoDate/currentAcademicYear, WhatsApp; ALSO fold the date/timezone split (BUG-014: UTC slice vs Africa/Algiers) into the shared dates primitive. Steps: per-pair extraction → dual-call-site swap → affected suites. Verify: affected suites + visual spot-check of money copy. Findings: DUP-008..014, 019, 020, 022, BUG-014.

**E2.6 Client-side defect batch (1.9) · M**
Target: each verified defect = its own T-task (per AGENTS §13). The registered set: BUG-001 terms, BUG-002 gpa args, BUG-003 revenue label, BUG-004 student-code filter (+Android check), BUG-005 sort, BUG-016 memo, BUG-022 names, BUG-023 nulls, BUG-024 redaction, BUG-025 header drop, BUG-026 tab sync, BUG-013 role strings, BUG-015 literals, BUG-027 copy — PLUS the S1 defects not carried in the ROADMAP row text: BUG-010 (stamp SuperAdmin bypass on session restore), BUG-020 (service-pricing early-payment deadline hardcode + reversesId exclusion), BUG-021 (cross-check Map.set overwrite). Verify: per-fix test (each its own T-task). Findings: as listed.

**E2.7 Render-phase setState (1.10) · S** — fix the 5 files (BUG-011). Verify: React suites + manual.

### E3 — Backend defect repair, SQL/EF (ROADMAP Phase 2; live-ceremony gated per AGENTS §11.1)

**E3.0 Live-vs-chain census diff (2.0) · S · G2** — run `schema_migrations` + table census diff live (risk #1). BLOCKED until the cap lifts; the chain-side numbers are already census-verified (100/14/5; 324 policies). Note: OPS-010's post-commit migration edits make this diff genuinely necessary before any live DDL.

**E3.1 Workflow registry alignment (2.1) · M · E3.0** — migration adding `source_handle`, removing `has_medical_justification` + EF/client parity test (C-4, BUG-009). This settles DUP-003's SQL-vs-EF divergence ONE side; LF-3 (E7) later canonizes the desktop engine.

**E3.2..E3.5 EF repairs (2.2–2.5) · S each · E3.0** — `run-overdue-scan` INV-4 fix (C-5, BUG-008 — the EF twin dies at LF-3/E7 anyway: sequence accordingly); `collect-payment` proof-fields + `ctx.userDisplayName` + refund double-audit (BUG-007); `ai-proxy` CHECK + corsHeaders + config.toml function list + auth-hook + verify_jwt (BUG-007 — dies at LF-3); `update-server-secret` FCM v1 allowlist + in-tree audit copy (BUG-007).
**Sequencing note (graduated interlock):** 2.3's collect-payment EF work and 2.4's config.toml work are DELETED by LF-3 — if E7 is green-lit, skip them here and let LF-3 absorb; if E7 is not yet green-lit, execute them (live mode is the only mode until then).

**E3.6..E3.9 SQL repairs (2.6–2.9) · M each · E3.0** — `register_family_batch` source_id regression + data repair (BUG-006); `create_manual_debt`/purge/`revert_payment_allocation`/debt-bulk fixes (BUG-006/018); `attendance_select` RLS tightening + `mv_grade_summary` unique-index restore (BUG-006); bootstrap-9000 rewrite as fresh-clone concern (BUG-006). Each: verify SQL + evidence per §11.1.

### E4 — Structure and contracts (ROADMAP Phase 3)

**E4.1 Price-source injection (3.1) · M · BEFORE any mock work** — sever domain→mock for non-tuition charges (ARCH-001, L-1). Verify: manual-charge suites.

**E4.2 Repository interface merge (3.2) · M** — merge the C-3 contract variants; add approvals/purge domain contracts (ADD-1, DUP-002, ARCH-007). Verify: typecheck + t-313.

**E4.3 Supabase-shared split (3.3) · M** — split `supabase-shared-repositories.ts` by repository (ARCH-008, L-7). Verify: typecheck + suites.

**E4.4 UI relocations (3.4) · M** — sync-indicator, person-navigation-context, topbar split, tenant-switcher (ARCH-003/004, L-2..L-5). Verify: typecheck + UI smoke. (Tenant-switcher is ALSO an E7/T-552 bypass file — coordinate: do the relocation as part of T-552 routing.)

**E4.5 Dashboard analytics → domain (3.5) · M · after E2.2** — relocate `analytics-derivations`/`executive-statistics`/`operational-query-engine` thresholds to domain with settings-sourced thresholds (ARCH-009, L-6). Verify: pinned-output comparison.

**E4.6 Settings gating pass (3.6) · S** — per-tab `PageTab disabled` computed from feature-registry nodes; relocate `AccessDeniedCard` to shared (ARCH-012, L-9; folds SET-U3). Verify: RBAC suites.

**E4.7 Mock-layer decisions (3.7) · L per port · after E4.1** — the 5 live-mode mock slots get real persistence or quarantine, per feature (ARCH-006; D-6 default: persist all five — under E7/LF-1 they get local tables anyway). Verify: per-feature live verification.

**E4.8 ADR documentation batch (3.8 + carry-ins) · S** — core/ai placement ADR (ARCH-002, L-8) + the service-locator architecture ADR (ARCH-005) + the observable-data-layer ADR (ARCH-020: repository+observable IS the data layer; TanStack Query is phantom) + boundaries.md shared/ rule (ARCH-013 residue) + AGENTS §15.5 annotation (T-553). Verify: ADR review.

**E4.9 Legacy timetable stack (3.9) · S** — remove legacy teacher-timetable stack + mock migration (DUP-021, R-2.7). Verify: mock teacher suites.

### E5 — Platform hygiene (ROADMAP Phase 4)

**E5.1 DB-types pipeline (4.1) · M** — generated types from the migration chain (+ optional permission-enum generation) (ADD-2/6, ARCH-014/015). Verify: diff vs migrations + parity test.

**E5.2 i18n decision (4.2) · S or L · sibling-repo check** — remove the gen dictionaries (DEAD-005) or complete the T-388 apply; default: remove. Verify: i18n parity tooling. Findings: DEAD-005, R-3.8, ARCH-013.

**E5.3 Scripts consolidation (4.3) · S** — parameterized delivery-zip builder; archive apply-live family (DUP-006/007, ADD-4). Verify: builder output comparison.

**E5.4 Deliverables disposition (4.4) · S-M · OWNER-GATED** — purge/LFS/keep for the 985 MB `deliverables/` + Excel provenance + smartexport fix (OPS-001/005/006, L-11, ARCH-017). Default: keep, flag for owner. Verify: repo size; workflow.

**E5.5 Table/select consolidation (4.5) · L incremental** — 39 tables, 9 native-select bypasses onto shared primitives (DUP-015). Verify: per-feature visual + a11y.

**E5.6 Governance refresh (4.6) · S** — AGENTS.md §2/§3/§17, system-map, AGENTS_supabase refs (ARCH-016, OPS-009). Verify: doc review.

**E5.7 RBAC matrix persistence (4.7) · M · OWNER-GATED** — complete `tenant_role_overrides` wiring (BUG-017; SET-U5). Verify: settings suites.

**E5.8 Import-abort fail-closed (4.8) · S · D-12 default (b)** — remove the unreachable abort enum values (DEAD-013, R-3.6). Verify: import engine tests.

**E5.9 Settings deep-link fix (4.9) · XS** — add the mount-time `?tab=` effect in settings-page (BUG-031; SET-U4). Verify: settings tab suites. **This is a 20-minute quick win — do it first in E5.**

### E6 — UI unification (ROADMAP Phase 5; evidence: UI Component Audit 00–05 + the S6-verified census corrections)

**E6.1 Z-tokens + animation family (5.1 / UI-U1) · XS · first**
Target: named z-scale (`z-overlay`/`z-tooltip`/`z-toast` in tailwind config) + ONE animation family (tailwindcss-animate verbs; delete the custom `slide-in-right`/`slide-out-right`/`animate-slide-up` keyframes). Steps: 1) add tokens; 2) swap ModalShell drawer + toast to `slide-in-from-right`/`slide-in-from-bottom`; 3) update the literal sites (`tooltip.tsx` z-[70] ×2, `toast-viewport.tsx` z-[100], `data-inspector-core.tsx` z-[70], `modal-host.tsx` z-[90] — the last dies with E6.6); leave `splash-screen.tsx` z-[200] as the documented boot-layer exception (S6 census addition). Verify: snapshot tests on the 5 shell surfaces. Findings: DUP-023/028.

**E6.2 Wizard + AutoFormModal → ModalShell (5.2 / UI-U2) · S · after E6.1**
Target: both render through ModalShell (props stable; 24 consumers untouched). Steps: swap the RadixDialogContent internals for ModalShell's; align shadow (`shadow-2xl`), height cap (`max-h-[88vh]` body flex), close-button dialect, logical `end-4`. Verify: existing wizard/form-modal suites + visual review of the 24 surfaces. Findings: DUP-025.

**E6.3 EntityDetailDrawer → ModalShell preset (5.3 / UI-U3) · S · after E6.1**
Target: EntityDetailDrawer becomes a preset over ModalShell (keeps ribbon/metadata/pill-tabs/footer identity), scrim 60 (drawer standard), animation family unified, close-button unified, responsive DrawerSize scale (`w-full sm:max-w-xl…` per the foundation spec §3). Steps per foundation spec §2-§4. Verify: drawer suites (t-405 et al.) + visual review of the 7 consumers. Findings: DUP-024.

**E6.4 Copilot drawer port + teacher overlay (5.4 / UI-U4) · M · after E6.3**
Target: `copilot-drawer.tsx` ports onto the drawer preset (portal + scrim + Escape + focus-trap gained; streaming behaviors kept verbatim); teacher-dashboard fullscreen `role="dialog"` (`teacher-dashboard.tsx:335`) becomes a route (preferred) or a compliant surface. Verify: copilot streaming tests + role-dashboard suites. Findings: ARCH-021, DUP-024.

**E6.5 title= eradication (5.5 / UI-U5) · M**
Target: native `title=` → shared Radix Tooltip, batched per feature area. **Scope correction (S6/C-10): the real census is 194 occurrences across 102 files — DOUBLE the S2 estimate (90/40+).** Plan the batches per feature directory; keep InfoTip for rich/formula content. Verify: per-area suites; a11y spot-check. Findings: DUP-026 (+C-10).

**E6.6 Dead modal stack + header slot (5.6 / UI-U6) · S** — fix BUG-025 header-slot; delete `useModal`/`ModalHost`/`ModalProvider` (0 feature consumers — ARCH-018) and its z-[90]. Verify: unified-modal suites.

**E6.7 Collapsible primitive (5.7 / UI-U7a) · S** — new `shared/ui/collapsible.tsx` (Radix) + migrate the ~10 hand-rolled expandable sites (UI audit `04`). Verify: affected feature suites.

**E6.8 KPI composition (5.8 / UI-U7b) · M · D-U2 pairing** — KpiCard as composition root; SparklineKpiCard/StatStrip/MixCards become slot compositions; ExecutiveCards (1,096 L) decomposed. Verify: dashboard/financials snapshots. Findings: DUP-027.

**E6.9 Dashboard view-models (5.9 / D-U1) · M** — `use-overview-data`/`use-analytics-data` extract the 6 subscriptions + 2 fetch blocks from `dashboard-page.tsx` (466 L); tabs read their hook (AnalyticsTab's 14-field props interface collapses). Verify: existing tab tests. Findings: DUP-029.

**E6.10 Role dashboard template (D-U3) · M** — extract `RoleDashboardTemplate` from the 7 near-parallel personnel dashboards. Verify: role-routing suites.

**E6.11 Settings ceremony (5.10 / SET-U1+U2) · M** — promote `SettingsCard`/`SettingRow` to shared; `useSettingsSection<T>` hook kills the per-tab load/save/toast ceremony across the 14 tabs; `useEditModal` idiom across the 5 tab modals (SET-U6). Verify: settings suites + RBAC matrix tests. Findings: DUP-030, ARCH-012.

**E6.12 Repository-bypass routing (5.11) · S-M** — parent-detail-drawer + `PlatformDiagnosticsPort` for settings tooling (ARCH-019) — NOTE: this is the same routing work as E7/T-552; execute there to avoid double-touching.

### E7 — The local-first migration + unified pipeline (ROADMAP Phases 6+7, interleaved per the graduated interlocks)

**Precondition:** T-550..T-553 complete (§3 steps 5–7). Sequence below preserves every graduated interlock: 7.0 starts immediately and parallels 6.1–6.4; 7.1 rides 6.5's commit path; 7.3 supersedes 6.16; 7.4 consumes 6.6; 6.9 and 7.4 wait on D-8/D-1 (defaults proposed).

**E7.0 LF-0 seam (7.0) · M · after §3 steps 5–7** — covered by T-550..T-553; nothing further.
**E7.0p Pipeline core facades (6.1–6.4) · S–XS · parallels LF-0**
Target: `src/infrastructure/pipeline/` as delegating facades — StreamRegistry (dual-perimeter), SchemaVersionRegistry, FormatRegistry, ChecksumService, AuditBus; `DownloadHelper` consolidates downloadBlob/export-target/replaces `downloadPdf` (12 sites) (6.2, DUP-031, R-15); `exportToCsv` dialect param (`;` FR, BOM always; copilot routed through it) (6.3); uniform `pipeline.export.*` audit events (6.4, ARCH-030). Zero caller-visible change. Verify: typecheck + new unit tests; t-368 suites + byte-compare artifacts; dialect unit test; audit assertions in t-382/t-505.

**E7.1 The one commit path (6.5) · M**
Target: `VaultReplayAdapter` (snapshot → `BatchUpsertRow[]` → `RepositoryStorageAdapter`) + ImportService facade — ONE commit path for restore AND import AND sync replay. Steps per `02-UNIFIED-PIPELINE-DESIGN.md` §"Consolidation map" (47 rows: authoritative/absorbed/retired/adapter). Verify: t-364/t-421 green. Findings: R-1 groundwork, P-5.

**E7.2 LF-1 local engine (7.1) · XL · after E7.0 + E7.1**
Target: PGlite `LocalDatabaseService` in the Electron main process (userData/el-imtiyaz/db), replaying the 152-migration chain + `0000_local_compat` prologue (pgcrypto+pg_trgm loadable; uuid-ossp+pgjwt skip-guards; auth-schema GUC shim — the 69 executable `auth.uid()` refs + claims list are in `LF0-PREP-CENSUS-2026-11-19.md` Part B); `LocalBackendAdapter` for the 49 overridden slots (mechanical recipe per BLUEPRINT §3.3 table); the 5 mock-only slots get real persistence (D-6 default); IPC channels (db:request/db:changes/auth:request/media:request per BLUEPRINT §3.3); single-instance lock; mock↔local parity suite per repository. Steps in order: 1) T-554 spike harnesses (installer <30 MB growth; t-368-scale perf; 324/324 policy parse); 2) chain replay + census gate (100 tables/14 views/5 matviews); 3) adapter-by-adapter re-point (37 files; the recipe table applies); 4) parity suites green; 5) feature-flag: default backend remains supabase/mock until parity green. Verify: chain-census gate; t-364/t-421 vs local; perf gate; Windows packaging spike; INV-2 standing gate. Rollback: feature flag. Findings: ARCH-006, DEAD-015, ARCH-035, ARCH-032 (vault absorption begins).

**E7.3 Restore unification (6.8, 6.9, 6.10, 6.11) · L→M→M→S · after E7.1**
Target: `RestoreService` 10-step contract (absorbs restore/inspectArchive/backup-file-restore; safety-backup refusal at service level; t-421 preflight triple as mandatory pre-write gate; transactional flush) — feature-flagged (6.8, ARCH-029/R-1, R-5); live replay target + scoped restore UI per D-8 default (6.9); 13-stream perimeter in backup+restore + v1-read absence warnings (6.10, ARCH-026/R-4); safety-backup refusal generalized (6.11, P-11). Verify: t-415 + t-300 + NEW round-trip layer 1 (mock 13-stream); layer 2 (fake client) after 6.9; refusal tests; failure-injection for the transactional flush (6.17).

**E7.4 Sync dispatch declarative (6.6, 6.18) · S→M**
Target: `SYNC_POLICY` declarative table (5 producer kinds / 8 push-path kinds / 5 enum-only kinds per S4 C-6); fail-loud default kept; expense/personnel push paths or explicit prune; drop enum-only kinds (BUG-037, R-6). Verify: t-022/t-171/t-305/t-415-sync.

**E7.5 Archive v2 + retention + warmup (6.12–6.15) · M→S→M→S · after E7.3**
Target: canonical archive v2 (manifest + per-stream SHA-256 + machine id; v1 read migration; tamper detection) (6.12, BUG-035/036); `RetentionPolicy` ONE definition feeds vault sweep/service/mirror/RPC/EF + EF header fix (6.13, BUG-034/R-8, DUP-032); `WarmupService` merge of 13 sources, retire warmSnapshotSources (6.14, ARCH-027/R-11); data-export JSON v1 retirement + checkpoint relabel per D-10 + inspector → SheetSpec + honest truncation (6.15, BUG-033, ARCH-028, R-10). Verify: NEW v2-format suite (writer↔reader + tamper); t-415 retention tests; t-487 + t-505; t-368 suites + inspector test.

**E7.6 Hardening backlog (6.19 + H-9..H-16) · M · after E7.5** — mirror reconciliation, passphrase wording, state-off-localStorage, disk preflight, checksum alarms, quarantine, Deflate read — in severity order. Verify: per-item suites.

**E7.7 LF-2 auth + RBAC local (7.2) · L · after E7.2**
Target: `LocalAuthService` — scrypt hashes in the `users` table, session minting (Session shape preserved — opaque tokens, the mock precedent), activation-code single-use rules (0055 semantics), role-escalation guard imported from EF `_shared/role-assignment.ts`; user-manager UI re-points from EFs to local tables; OAuth dropped, global sign-out kept as relay broadcast (D-7 default). Verify: RBAC suites; T-266; activation lifecycle tests. Findings: ARCH-031 (candidate 2: Session token fields stay, documented as opaque).

**E7.8 LF-3 EF ports + storage (7.3) · L · after E7.2**
Target: workflow engine promoted (fix the 0088 divergence first — settles DUP-003 finally); overdue scanner canonized (desktop INV-4 formula; EF twin deleted — closes DUP-004 and absorbs E3.2); cron family → main-process scheduled tasks; `MediaStore` local folders (absorbs 6.16 therapy-bytes fix — BUG-032/R-2 — as a folder migration, NOT a SQL migration); audit writer in adapter; financial-realtime channel removed → IPC change bus. Verify: workflow parity suite (re-pointed); overdue boundary fixtures; media round-trip. Findings: ARCH-025, R-2, DUP-003/004, ARCH-032 (vault absorption completes).

**E7.9 THE FINAL EXPORT (blueprint §8; G2-gated) · owner-run, ~1 day**
The one-time extraction — the ONLY step that needs the Supabase spend cap lifted. The 9-step migration-day runbook is BLUEPRINT §8 "Sequencing": (1) LF-1 build on the primary PC → (2) chain-replay census gate → (3) extraction script (REST `.from()` + `read_*_collection` RPCs; the 27-table writer map + RPC-read checklist in LF0-PREP-CENSUS Part A is the script's seed spec) → (4) seed via the ImportService commit path with T-421 preflights + per-stream verify → (5) safety backup → (6) relay configured → (7) second PC paired via activation code → (8) two-node sync smoke → (9) cap back on (it no longer matters). **The extraction script design is the designated archive-side prep work if any further investigation session runs before the green-light.**

**E7.10 LF-4 sync relay + conflict policies (7.4) · L · after E7.2 + E7.4 · G3/D-1..D-4**
Target: the tiny self-hosted relay (Node + Postgres; dumb append-log + keyset pull + sequence minter + optional FCM forwarder); `SyncTransportPort` adapters (relay + supabase-as-relay); op-log change-log table; per-entity policy table (E7.4's SYNC_POLICY consumed); receipt sequencing per the ADR-004 supersession; cross-machine invalidation bus; Android surface per D-2; FCM per D-3. The conflict model is BLUEPRINT §7 (operational replay for money; 3-way merge for staged entity edits — existing `conflict-detector.ts`; LWW for attendance/homework; union for append-only). Verify: two-node simulation (deterministic replay proofs); conflict-resolver UI suites; offline-drain tests (t-171/t-305 patterns). Rollback: relay disabled = today's offline behavior.

**E7.11 LF-5 Supabase demotion + teardown (7.5) · S-M · after E7.8 + E7.10**
Target: supabase adapter = optional relay only (the quota can never break the app again — INV-5 satisfied); scripts archive sweep (292+52 files); AGENTS §11.1 ceremony → local DB commands; ADRs finalized; `docs/operations/credentials.md` cleanup (OPS-012 — owner action). Verify: full suite + the **INV-2 kill-the-network boot test** (§8). Findings: OPS-003/004/008/012.

### E8 — Verification and closeout

1. Full `npm test` (321 files / 5,270+ expected green / 0 failed after T-549; 5 skipped documented); baseline ledger reconciled.
2. `npx tsc --noEmit` clean.
3. **INV-2 gate** (the program's definition of success): network fully blocked on the packaged Windows build → boot, sign-in, read, write, backup, restore all work.
4. FINDINGS_INDEX sweep: every ID moved to its terminal state (done / documented / owner-gated); corrections C-1..C-12 recorded.
5. Final self-audit of the two folders (per the original charter): only `Investigation Archive/` + `Refactoring Unified/` were ever touched during investigation; execution-phase commits cite T-tasks throughout.

---

## 5. Decision gates — D-1..D-12 digest (full packet: `Investigation Archive/OWNER-DECISION-PACKET.md`)

| ID | Question | ⏵ Default (governs until overridden in Issue #32) | Gates |
|---|---|---|---|
| D-1 | Sync topology | (b) internet VPS relay (LAN possible later, same software) | LF-4 deployment only |
| D-2 | Android cloud access | keep the relay surface; Android QA out of scope until desktop green | relay API shape |
| D-3 | Push (FCM) | keep via relay (graceful degradation; credentials exist) | relay capability list |
| D-4 | One self-hosted service | accept (the CRDT alternative forces the engine switch — rejected) | whole LF-4 design |
| D-5 | Cap lift vs stopgap | lift ONCE for the export (24h notice); do NOT buy a stopgap plan | the final export (E7.9) |
| D-6 | Mock-slot features | persist all five (clubs, psychology, orthophonie, aiConfig, performanceReviews) | LF-1 slot list |
| D-7 | Google OAuth / global sign-out | drop OAuth, keep global sign-out via relay | LF-2 scope |
| D-8 | Live-restore semantics | enabled locally, gated for multi-user replay | E7.3's 6.9 UX copy |
| D-9 | Server metadata mirror | drop `backup_archives` mirror at LF-5 (vault is authoritative) | retention wiring, H-9 |
| D-10 | Checkpoint honesty | relabel Excel checkpoint as human report + partial ETAT recovery | P-3.4 |
| D-11 | debtSummaries | derived (recomputed on restore), not stored | perimeter finalization |
| D-12 | Import-abort modes | (b) remove unreachable enum values | E5.8 |

**Standing owner actions (no decision needed):** OPS-012 rotate/redact the committed credential sheet; OPS-013 the Vercel PAT is invalid (rotate only if the website workflow needs it); OPS-011 the Supabase management token (including the NEW one provided Session 6) tests invalid — REST with the secret key works once the cap lifts, a fresh valid management token only enables the census ceremony.

---

## 6. Finding → action traceability matrix (every registered ID → its execution home)

Grouped ranges resolve together; single IDs are listed individually. "Doc" = documentation-only disposition (ADR/governance card, no code change). "Owner" = owner-gated (§5). Full evidence per ID: FINDINGS_INDEX.

| Finding IDs | Execution home | Notes |
|---|---|---|
| DEAD-001/002, OPS-007 | E1.1 | root strays |
| DEAD-003/010/011 | E1.2 | dead files |
| DEAD-004 | E1.3 (Owner) | remove-or-wire |
| DEAD-005, R-3.8 | E5.2 (sibling-repo check) | i18n dicts |
| DEAD-006/007/008/009/012/014 | E1.5 | symbol batches |
| DEAD-013, R-3.6 | E5.8 (D-12) | fail-closed |
| DEAD-015 | E7.2 | `_shared/role-assignment.ts` promotion (local-first keeps it) |
| DUP-001, DUP-005 | E2.4 | devis service |
| DUP-002, ADD-1 | E4.2 | repository contracts |
| DUP-003 | E3.1 + E7.8 | workflow triplication (SQL alignment, then desktop canonization) |
| DUP-004 | E7.8 | overdue EF twin dies |
| DUP-006/007, ADD-4, R-4.1/4.2 | E5.3 | scripts |
| DUP-008..014, 019, 020, 022 | E2.5 | formatting batch |
| DUP-015 | E5.5 | table/select consolidation |
| DUP-016, BUG-012 | E2.2 (+T-549) | INV-4 vocabulary |
| DUP-017 | E2.2/E4.6 | gating idioms collapse to feature-registry |
| DUP-018 | Doc (E4.8 registers the churn; E3 sequence consolidates the redefinitions) | SQL redefinition census |
| DUP-021, R-2.7 | E4.9 | legacy timetable |
| DUP-023/028 | E6.1 | z/animation tokens |
| DUP-024 | E6.3/E6.4 | drawer unification |
| DUP-025 | E6.2 | modal shells |
| DUP-026 | E6.5 | title= eradication (C-10 scope: 194/102) |
| DUP-027 | E6.8 | KPI composition |
| DUP-029 | E6.9 | view-model hooks |
| DUP-030 | E6.11 | settings ceremony |
| DUP-031 | E7.0p (6.2/6.3) | download/csv helpers |
| DUP-032 | E7.5 (6.13) | retention single definition |
| ARCH-001, L-1 | E4.1 | price-source injection |
| ARCH-002, L-8 | E4.8 | core/ai ADR (document) |
| ARCH-003/004, L-2..L-5 | E4.4 | UI relocations |
| ARCH-005 | E4.8 | service-locator ADR (document) |
| ARCH-006 | E4.7 → E7.2 final | mock slots |
| ARCH-007 | E4.2 | repo interface merge |
| ARCH-008, L-7 | E4.3 | supabase-shared split |
| ARCH-009, L-6 | E4.5 | dashboard→domain |
| ARCH-010, ADD-5 | E1.8 | Ctrl+O gating |
| ARCH-011 | E2.6 (own T-task) | /personnel route gating fix |
| ARCH-012, L-9 | E4.6/E6.11 | settings gating |
| ARCH-013 | E5.2 + E4.8 (boundaries rule) | i18n architecture |
| ARCH-014/015, ADD-2/6 | E5.1 | generated DB types |
| ARCH-016, OPS-009 | E5.6 | governance refresh |
| ARCH-017 | E5.4 (Owner) | repo hygiene |
| ARCH-018 | E6.6 | dead modal stack |
| ARCH-019 | E7.0/T-552 (+E4.4 tenant-switcher) | bypass routing |
| ARCH-020 | E4.8 | data-layer ADR (document) |
| ARCH-021 | E6.4 | copilot/teacher overlays |
| ARCH-022/023/024 | E7.0/T-551 | hard-lock removal |
| ARCH-025 | E7.8 | RPC-only tables (local DB runs them) |
| ARCH-026, R-4 | E7.3 (6.10) | 13-stream perimeter |
| ARCH-027, R-11 | E7.5 (6.14) | warmup merge |
| ARCH-028, R-10 | E7.5 (6.15) | data-export honesty |
| ARCH-029, R-1 | E7.3 (6.8) | restore replay |
| ARCH-030 | E7.0p (6.4) | export audit events |
| ARCH-031 | E7.7 | local auth |
| ARCH-032 | E7.2 + E7.8 | vault main-process absorption |
| ARCH-033 | E7.0/T-550 | 49-key exhaustiveness (`satisfies`) |
| ARCH-034 | E7.0/T-552 | phantom preload API (dies with real bridge) |
| ARCH-035 | E7.2 gate | PGlite extension census (pre-verified: no blocker) |
| BUG-001..005, 013, 015, 016, 022..027 | E2.6 | per-fix T-tasks |
| BUG-006/018 | E3.6..E3.9 | SQL repairs |
| BUG-007 | E3.2..E3.5 (2.3/2.4 absorbed by E7.8 if green-lit) | EF repairs |
| BUG-008, C-5 | E3.2 (absorbed by E7.8) | overdue EF |
| BUG-009, C-4 | E3.1 | workflow registry |
| BUG-010 | E2.6 | session restore stamping |
| BUG-011 | E2.7 | render-phase setState |
| BUG-017 | E5.7 (Owner) | RBAC persistence |
| BUG-019 | E2.2 | pending semantics |
| BUG-020/021 | E2.6 | pricing hardcode / cross-check |
| BUG-025 | E6.6 | header slot |
| BUG-026/BUG-031 | E2.6 / E5.9 | deep-link fixes |
| BUG-030 | E1.6 | stale comments |
| BUG-032, R-2 | E7.8 (supersedes 6.16) | therapy bytes |
| BUG-033 | E7.5 (6.15) | checkpoint/import schema honesty |
| BUG-034, R-8 | E7.5 (6.13) | retention |
| BUG-035/036 | E7.5 (6.12) | archive v2 |
| BUG-037, R-6 | E7.4 | sync coverage |
| BUG-038 | §3 step 4 (T-549) | date bomb |
| OPS-001/005/006, L-11 | E5.4 (Owner) | deliverables |
| OPS-002/008 | E1.9 | broken scripts |
| OPS-003/004 | E7.11 | scripts archive sweep |
| OPS-010 | Doc — ceremony context for E3 (append-only discipline enforced from E3 onward) | migration history drift |
| OPS-011 | E7.9 gate tracker (re-probe every session; standing record `01-INFRASTRUCTURE-STATUS.md`) | quota restriction |
| OPS-012 | Owner — rotate/redact credentials (E7.11 finishes the cleanup) | committed credentials |
| OPS-013 | Owner — Vercel PAT invalid; mgmt token invalid (re-tested S6) | credential scorecard |
| R-1..R-15 | E7.1..E7.6 as mapped above | pipeline hardening map (02-UNIFIED-PIPELINE-DESIGN §"Hardening backlog") |

---

## 7. Full-app migration impact map (what each stage touches, app-wide)

| Area | Touched by | Nature of impact |
|---|---|---|
| `src/shared/ui/**` | E6.1–E6.7 | base classes/tokens; ModalShell becomes the single skeleton; no contract breaks (props stable) |
| `src/features/dashboard/**` (40 files) | E1.2, E4.5, E6.8, E6.9 | dead-file deletion; analytics logic → domain; KPI composition; view-model hooks |
| `src/features/personnel/dashboards/**` (9) | E6.4, E6.10 | template extraction; teacher overlay compliance |
| `src/features/settings/**` (39) | E4.6, E5.9, E6.11, E7.0p | gating pass; deep-link fix; ceremony primitives; DiagnosticsPort routing |
| `src/features/financials/**` | T-549, E2.2, E2.4, E6.8 | wave adapter clock; INV-4 vocabulary; devis service; KPI cards |
| `src/features/crm/**` | E2.4, E2.6, E7.0/T-552 | billing wires; defect fixes; bypass routing |
| `src/features/academics/**` | E7.8 | `fn_*` RPCs keep running locally (no port); workflow engine promotion |
| `src/features/ai/**` | E7.0/T-552, E6.4 | llm-adapter port routing; copilot drawer compliance |
| `src/infrastructure/supabase/**` (42 files/26,684 L) | E7.0, E7.2, E7.11 | interfaces first; 37 adapters re-pointed behind the port; demoted to optional relay at LF-5 |
| `src/infrastructure/backup/**` + `pipeline/**` | E7.1, E7.3–E7.6 | ONE commit path; RestoreService; archive v2 |
| `src/infrastructure/sync/**` | E7.4, E7.10 | declarative policy; transport port |
| `src/infrastructure/mock/**` | E7.2 parity corpus | stays as dev/test mode permanently |
| `electron/main.cts` + `preload.cts` | E7.2 | LocalDatabaseService + IPC channels (currently a window shell — zero supabase hits) |
| `supabase/migrations/**` (152) + EFs (16) | E3, E7.8, E7.11 | append-only repairs; EF ports; archival |
| `src/tests/**` (321 files) | every stage | the safety net; baseline moves at batch boundaries |
| Sibling repos (Android/website) | §10 cross-platform rule | not present in this repo; register divergences |

---

## 8. Verification ladder reference (commands; from the archive's runtime-evidence records)

```bash
cd elimtiyaz-desktop
npx tsc --noEmit                                      # typecheck gate (every commit)
npx vitest run <suite>                                # touched-feature suites (every commit)
npm test                                              # full ladder (batch boundaries; ten-shard pattern if timeouts — see S5-VITEST-CENSUS)
npx vitest run src/tests/domain/t-502-wave-meter-thresholds.test.ts   # the T-549 acceptance suite (8/8)
rg "from.*supabase-client" src -g '!src/infrastructure/supabase/**'   # T-552 completion (expect: repository-provider.tsx only)
rg "import\(.*/supabase-client" src -g '!src/infrastructure/supabase/**'  # T-552 completion, dynamic shapes (expect: zero)
```

Standing gates at every phase boundary (from BLUEPRINT §13 / LF-BLUEPRINT §9): typecheck + full suite → INV-2 (kill-the-network on the packaged build) → mock-parity (per repository slot) → chain-census (100/14/5, 324/324 policies parse) → money-parity (ADR-002 suites unchanged) → kill-switch rollback (previous backend selectable).

---

## 9. Register upkeep and escalation (the execution session's bookkeeping)

1. **Before starting:** §0 bootstrap (fetch, status, README → SESSION_LOG → handoff → this file → Issue #32 → probes → `01-INFRASTRUCTURE-STATUS.md` update).
2. **Every completed task:** T-task status in `docs/recovery/task-registry.md`; FINDINGS_INDEX row state; one commit + push.
3. **New discoveries during execution:** register as new finding IDs (next free after S16: DEAD-024, DUP-037, ARCH-046, BUG-066, OPS-016) with file:line evidence; corrections from C-23 onward. Never erase prior records.
4. **Token hygiene before every push:** `rg "sb_secret|sbp_|ghp_|vcp_|AIza" --glob '!node_modules'` — investigate every match; the standing archive hits are documentation-text false positives (verified S5; re-verify if the pattern set changes).
5. **Owner escalation:** anything gated in §1/§5 that blocks progress gets posted to Issue #32 (the packet already collects them); work continues on unblocked stages meanwhile.
6. **Session closeout:** session report + next handoff in `Investigation Archive/Session Reports/` + `Handoffs/`; SESSION_LOG row; merge to `main` after verification; never force-push.

---

## 10. Session 15 addendum (2026-11-20) — the pedagogy unification lane (T-561..T-571)

**Origin:** the owner's dedicated **Pedagogy Unification, Relational Linking & Legacy Deletion** mandate (Merge + Connect + Delete). Evidence base: `Investigation Archive/Deep Sweep/10` (the pedagogy entity census + the P-U1..P-U8 academic-structure target) + `Investigation Archive/Deep Sweep/11-DEEP-PEDAGOGY-UNIFICATION-RELATIONAL-DELETION-BLUEPRINT-2026-11-20.md` (the relational layer: the M-U1..M-U10 canonical model, the merge mechanics §3 with per-family conflict rules, the **exhaustive REMOVE/DELETE manifest §4** with pre-deletion dependency proofs and the §4.4 post-deletion verification checklist). Gates: **G0 governs this lane exactly as it governs the rest** — nothing below executes before the owner green-lights execution; D-13..D-16 (OWNER-DECISION-PACKET Part E) carry ⏵ defaults so the lane is fully decidable.

**Sequencing:** T-561 → (T-562 ∥ T-563 ∥ T-564 ∥ T-565 ∥ T-568) → (T-566 ∥ T-569) → T-570 → T-567 → T-571. Hard constraints: P-U1/T-561 before the importer T-567; **Phase-4 greps must return clean BEFORE any Phase-5 deletion executes** (DS/11 §4.3); OPS-015's cap-lift sequencing is untouched by this lane.

**The task cards (the P-U/M-U folded set):**

- **T-561 · P-U1 + M-U2 — the GradeLevel spine + the staff-category vocabulary · M.** `GradeLevel` (14 codes) becomes the only stored level on students/classes/subjects/placement; AcademicCycle + the 3-value AcademicLevel become derived view-models; the legacy `level+gradeYear` pair, `AcademicCycleLegacy`, and `grade_level_code` migrate off (DS/10's ~15-file site list); the prescolaire special-case deletes. PLUS the StaffCategory collapse to the 4 DB CHECK values, the `CATEGORY_TO_DB/FROM_DB` bridge deletion, the six dual-condition UI filters unified on `isTeaching()` (DS/11 §2 M-U2). Verify: tsc 0; the GRADE_LEVELS↔academic_levels drift guard; the promotion suites (the 038/040 equivalence regressions); zero-remnant greps for the deleted vocabulary.
- **T-562 · P-U2 — the AcademicYearContext · S.** One year-resolution service (id-canonical, `isCurrent`-sourced); `DEFAULT_ACADEMIC_YEAR` + `resolveBillingAcademicYear` delete (billing-breakdown.ts:337/365); TEXT-code keys are written/read THROUGH the service; the ARCH-043 period-grid parameterization folds at this seam (one school-calendar service per audience). Verify: the payments↔scolaire seam test (one seam to test).
- **T-563 · P-U3 — the external class-code alias · S.** `classes.external_code` + unique per year + the UI label beside the app code; used by the importer for matching. No data migration (today's classes have none).
- **T-564 · P-U6 — the repository contract consolidation · XS-S.** Delete the five duplicate interface declarations in `repository.ts:264-333` (+HomeworkRepository :376-389); `academic-repository.ts` becomes the only contract file; the provider slots re-type; the AttendanceRepository ×3 family (repository/academic/workforce) splits by name into pedagogy vs staff contracts. Closes DUP-002.
- **T-565 · P-U7 — the filières drift-guard · XS.** The test asserting `FILIERES`/`SPECIALITES` ↔ migration 0107 row-set equality (the algerian-curriculum mirror discipline); the table stays (DUP-035 disposition).
- **T-568 · M-U4 — the parent_student_links adoption · S-M · D-14 (⏵ adopt).** The backfill migration (DS/11 §2.1 SQL — one `is_primary=true` link per live student from `students.parent_id`, `ON CONFLICT DO NOTHING`); `parents.relationship` migrates onto the link rows then drops; the primary-pointer invariant (trigger recommended — survives app bugs the same way 0113's constraints do); guardian/sibling reads for the parent surfaces (CRM drawer + portal). Verify: links row-count = the pre-backfill parent-link count; the primary-pointer invariance test; the t-416 purge scripts still coherent (they reference links — keep).
- **T-566 · P-U4 — curriculum & assessment coverage · M-L · D-13 (⏵ A: the composite recipe).** The 4 missing subjects (محاسبة/مناجمنت/القانون/الأسبانية) + the recipe-component vocabulary (the workbook's 8 families) + the assessments mark columns (the cc precedent 0094) + the DB trigger generalization; confirm تكنولوجيا ≡ INFORMATIQUE with the school (non-blocking). Deps: T-561.
- **T-569 · M-U1/M-U3 — the teaching-staff consolidation · M · D-15 (⏵ delete the phantom).** `TeachingStaffService` lands (personnel + category/role + derived assignments + homeroom + timetable projections); the phantom year-scoped Teacher write-surface deletes (the 47-reference/10-file census, DS/11 §1.1 — model/validation/supabase-rejection-strings/mock/UI/tests); `TeacherSubjectAssignment` + the legacy timetable family (DUP-021) delete; `homework.teacher_id` gains its FK (the 0113 pattern: orphan pre-clean **including the user_id-vs-personnel id-space check**, then guarded ADD + VALIDATE); the mock layer simplifies to personnel + class_subjects. Verify: t-408 audit semantics unchanged; the teacher-repository integration suite against the collapsed contract; the T-500 staff register not regressed; zero-remnant greps (`maxWeeklyHours`, `qualifiedSubjectIds`, `TeacherSubjectAssignment`, the legacy `TimetableEntry` import path).
- **T-570 · M-U5..M-U8 — EnrollmentService + the dead-store drops · M.** `EnrollmentService` composes the three time-frames of ONE chain (CURRENT `class_id`+spine / PAST histories / FUTURE re-enrollments) — **no new enrollments table** (an 8th representation would BE the duplication the mandate kills); `service_enrollments` documented as the portal seam (D-16 ⏵ keep); the enrollment-status vocabulary unifies on the DB 6-value set with ONE conversion point. THE DEAD DROPS EXECUTE HERE, ONLY AFTER the Phase-4 greps: `grades` (DEAD-021) and `academic_history` (DEAD-022) — each archive → merge-under-conflict-rules (DS/11 §3.2.6) → DROP with triggers/indexes; the purge-script coverage census precedes each DROP. Verify: the full DS/11 §4.4 checklist (a–h: builds, promotion E2E, teacher-is-worker, parent↔student↔pedagogy traversal incl. the multi-guardian case, orphan SQL, drift guards, zero-remnant greps, the S8 oracle as the finance negative control).
- **T-567 · P-U5 — the pedagogy-workbook importer · M.** The S8-proven engine + a new import-config family (block-header parsing الشعبة/القسم → filière + level + external class code; roster rows → student upserts WITH class resolution — the BUG-064 fix generalized; `معدل` columns IGNORED on import, recomputed by the app's engines). Deps: T-561, T-563, T-566(a).
- **T-571 · M-U9/M-U10 + P-U8 — the ADR batch + the lane's exit gate · S.** The one-page ADRs (the three domain-separation seams + the projection whitelist — the sanctioned denormalizations enumerated in DS/11 §2 M-U9); the full §4.4 re-run as the lane's closure; register closure in the archive.

**Register linkage:** DEAD-020..023, ARCH-044/045, DUP-036 (S15) + BUG-064, DUP-035, ARCH-041..043 (S14) are the lane's evidence base; the next free IDs after S15 are DEAD-024/DUP-037/ARCH-046/BUG-065/OPS-016 (§9.3 updated accordingly).

---

## 11. Session 16 addendum (2026-11-20) — the standing S8–S13 queue folded (T-555..T-560, T-572) + the DS/12 scope corrections

**Origin:** these tasks were staged across Sessions 8–13 in the Deep Sweeps and handoffs but never folded into this plan's own task cards — the plan of record was missing its top-CRITICAL lane (T-559/T-560) from the file itself. Session 16 folds them verbatim, applies the DS/12 corrections, and registers T-572. Evidence base: `Deep Sweep/04` (the import engine), `Deep Sweep/06` (the runtime inspection — BUG-042/T-559/T-560), `Deep Sweep/12` (BUG-044 origin + the family census + the [S-A]/[S-B] discharge). Gates: **G0 governs all of it**; T-559/T-560 additionally carry the **OPS-015 cap-lift sequencing constraint** (the cap lift MUST NOT precede them + the BUG-058 fix — with the family census, a premature lift opens FIVE egress-burning request loops, DS/12 §2).

**Sequencing within the folded set:** T-559 → T-560 (x5 sites) — both BEFORE any cap lift; T-556/T-557/T-558 are independent import-engine items (T-557 wants the owner's D-13-style fail-closed-vs-remove call — see OWNER-DECISION-PACKET); T-572 is independent (no ordering constraint vs T-559/T-560). **T-555 stays reserved/unused** (never assigned; kept out of circulation to preserve the numbering).

**The task cards (folded + corrected):**

- **T-559 · BUG-042 root fix — split the toast context · XS-M · THE top CRITICAL.** `toast-provider.tsx:57-69`: keep `show/showSuccess/showError/showWarning/showInfo/dismiss/clear` in a memo keyed ONLY on stable deps (`[show, dismiss]`); expose `toasts` through a second context (or let only the toast viewport subscribe). After this, every consumer's `showError` is referentially stable and the ENTIRE churn family dies: the five loop-capable effects (T-560's set), the `askAgent`/`answerClarification` identity churn (ai-copilot-provider.tsx:582), and the BUG-044 loop vector. Verify: the 108 `useToast()` consumers typecheck unchanged; the S10 regression shape (a failing listAll behind a mounted configuration-tab can no longer re-fire the effect from toast identity alone) — the DS/06 §3.2 exit criteria apply.
- **T-560 · BUG-042 family loop breakers — CORRECTED SCOPE: ALL FIVE SITES (DS/12 §2).** The load-generation-ref gate (load-on-mount + explicit refresh only) on: configuration-tab.tsx:73-85, accounts-tab.tsx:60-80, pricing-year-config-bar.tsx:58-63, promotion-cycle-detail.tsx:69-78, promotion-cycles-tab.tsx:53-62 (+ optionally the identical-consecutive-error-toast dedupe). Defense-in-depth behind T-559; REQUIRED before any cap lift if T-559 is deferred.
- **T-556 · BUG-040 contact backfill on placeholder-family merge · S.** In `processEtatFamily`: when a phone-bearing row resolves to a placeholder family, `updateParent(parent.id, { phone, email })` before the student upsert; pin with the B-test (placeholder-first + phone-later → backfilled; phone-first + phoneless-later unchanged). Shape: DS/04 §7.1.
- **T-557 · dead-abort-mode removal · S · owner D-call.** Remove the dead `ATOMIC_IMPORT_ABORTED`/`STRICT_MODE_REJECTED` branches + the no-op `strict` option (DEAD-013), OR restore fail-closed row-rejection behind a config flag if the owner wants the semantics (the fail-closed-vs-remove call is an owner decision — stage beside the D-13 packet question). Shape: DS/04 §7.2.
- **T-558 · dry-run audit tag · XS (cosmetic).** Suppress `import.run_completed` for dry-runs or tag it `dry_run: true`. Shape: DS/04 §7.3.
- **T-572 · BUG-044 the copilot failure UX · S · NEW (DS/12 §1.3).** (a) paired-error semantics: keep the optimistic turn but append a visible assistant error message ("Échec — clé API manquante. Configurez Réglages → IA.") to the thread, persisted — OR commit-on-success; (b) the unconfigured empty state in the drawer (config with no key → the configuration call-to-action linking `#/settings` AI tab; `reloadConfig` is already wired, ai-config-tab.tsx:258) + the honest header badge ("Non configuré" instead of the live-looking default model id, copilot-drawer.tsx:115); (c) `logger.warn` the failed send (provider + error class); (d) UPDATE copilot-drawer.test.tsx:204-246 (the current test PINS the defective persistence at :245 — replace with the chosen semantics) + the empty-state render test. Feeds BUG-056's follow-ups (fetch timeout, dead model metadata, AI i18n) unchanged.
- **T-561 scope corrections (from DS/12 §3 — the card above stands, scope amended):** the M-U2 dual-condition filter rewire is **8 sites, not 6** — add class-detail-page.tsx:205 and academic-year-detail-drawer.tsx:248; path fixes: teachers-tab.tsx at `features/academics/`, create-section-dialog.tsx at `features/academics/placement/`, create-account-modal.tsx at `features/settings/`. PLUS **BUG-065**: the category round-trip parity test (medical→medical) must land BEFORE the `CATEGORY_TO_DB/FROM_DB` bridge deletes.
- **T-569/T-570 evidence-base note:** the DS/11 §8 [S-A]/[S-B] re-verification obligation is DISCHARGED by DS/12 §3 (all 20 claims personally re-read at HEAD `3e6ad7b9`; 20/20 verified; the 3 corrections are folded above) — the executor inherits a fully personal-read evidence base for the pedagogy lane.

**Register linkage:** BUG-042/044/065 (S16 refinements + new), BUG-040, DEAD-013, BUG-056/058, OPS-015 (sharpened to the five-loop family); the next free IDs after S16 are DEAD-024/DUP-037/ARCH-046/BUG-066/OPS-016.

---

*End of execution plan v1.2. Evidence base: `Investigation Archive/` Sessions 1–6 (FINDINGS_INDEX 130 IDs, corrections C-1..C-12); designs: BLUEPRINT v1.2, ROADMAP Phases 0–7, LOCAL-FIRST-BLUEPRINT, 02-UNIFIED-PIPELINE-DESIGN, UI Component Audit 00–05, LF0-prep package. Session 6 (this file's author) verified the load-bearing counts directly against HEAD `01e6f33f`: 961 src files; 42 files/26,684 lines in the supabase tree; 496 `.from()`; 89 `.rpc()` in 20 files; 56 distinct RPCs; the hard-lock lines 35/148-157/171-172/205; BUG-038 at installment-schedule-tab.tsx:246; the KPI widget line counts 50/225/137/1096/288; BUG-031; 6 Radix-Dialog importers; 10 drawer-variant call sites; 0 onContextMenu. Corrections registered: C-10 (title= 194/102), C-11 (bypass set 17 incl. dynamic imports), C-12 (z-literal additions + AnalyticsTabProps 14 fields). No application source, configuration, schema, or dependency was modified in producing this plan. Session 15 (v1.1) folded the pedagogy-unification lane (T-561..T-571) from the cross-verified DS/10 + DS/11 evidence; same read-only discipline. Session 16 (v1.2) folded the standing S8–S13 queue (T-555 reserved, T-556..T-560 + the new T-572) with the DS/12 scope corrections (T-560 x5 sites; T-561's 8-site M-U2 rewire + the BUG-065 parity-test precondition); every load-bearing claim personally re-verified at HEAD `3e6ad7b9`; same read-only discipline.*
