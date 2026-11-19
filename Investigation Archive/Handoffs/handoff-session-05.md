# Handoff — Session 4 → Session 5

**Session ID:** S4 · **Date:** 2026-11-19 · **Branch:** `investigation/session-04` (merged to `main`, pushed) · **Repo HEAD at start:** `0e68fc57` (main, clean tree); all Session 4 documentation published on `main`.

## Where everything is

- **The authoritative execution plan (graduated this session):**
  - `Refactoring Unified/BLUEPRINT.md` **v1.2** — §1..§11 (Session 1 baseline + Session 2 risk additions), §12 (UI unification), **§13 (local-first + unified pipeline, S4-graduated)**.
  - `Refactoring Unified/ROADMAP.md` — Phases 0..5 (Sessions 1-2) + **Phase 6 (pipeline P-0..P-4, 19 rows) and Phase 7 (local-first LF-0..LF-5, 6 rows)** with the interlock paragraph and the INV-2 standing gate.
- **Session 4 evidence:** `Testing and Runtime Evidence/S4-CROSS-VERIFICATION-2026-11-19.md` (21 claims verified / 7 corrections C-1..C-7 / extension census ARCH-035 / live re-test + credential scorecard OPS-013).
- **The owner gate:** `OWNER-DECISION-PACKET.md` — D-1..D-12 with recommendations and ⏵ proposed defaults; unanswered items follow the defaults from Session 5 onward (the packet says so explicitly).
- **Registers:** FINDINGS_INDEX carries S4 IDs ARCH-035, OPS-013 + corrections (next free: DEAD-016, DUP-033, ARCH-036, BUG-038, OPS-014). SESSION_LOG row 4 + open questions 1-8. README current-state is up to date.

## What Session 4 established (do not re-litigate without new evidence)

1. **The S3 record is verified**: all footprint/runtime/SQL counts re-derived exactly; the two critical data-durability defects (ARCH-029 mock-only restore, BUG-032 therapy byte-discard) confirmed at source; the graduation into `Refactoring Unified/` is legitimate and DONE.
2. **The corrections that matter for execution sizing**: LF-0 routes **16** bypass files (not ~14); the untouched-table asymmetry is **27** tables (incl. `receipts`); test-surface blast radius is 158/321 files (sub-counts 107/74/19/77); the sync queue has **5 producer kinds / 8 push-path kinds / 5 enum-only** (lossier than S3's headline).
3. **The LF-0 engine gate is pre-computed** (ARCH-035): no PGlite extension blocker; the chain replay prologue needs exactly two skip-guards (uuid-ossp, pgjwt) + the auth-schema GUC shim (89 `auth.uid()` refs). Remaining LF-1 spike gates: Windows packaging (<30 MB installer growth), perf at t-368-scale corpus, 324/324 policy parse.
4. **OPS-011 persists** (re-verified: REST/secret 402, JWKS 402, auth-health 402) — live mode stays broken; the one-time cap lift for the final export remains the only owner-side Supabase action. GitHub PAT working; Vercel PAT invalid (OPS-013); Supabase management token invalid; Firebase key functionally unverified.
5. **The investigation charter is functionally complete**: every part of the owner's four-part directive has a cross-verified deliverable. Sessions from here are either **execution-prep**, **unblocked-verification**, or **register upkeep** — not re-investigation, unless the owner's answers to D-1..D-12 change the architecture.

## Exact next steps for Session 5 (priority order)

### Lane A — Execution prep (if the owner green-lights or stays silent on defaults)
1. **LF-0 / ROADMAP 7.0 is the first code session**: five ports as interfaces; hard-lock removal (`supabase-client.ts:35-38,148-157,171-172`, storageKey `:205`; `system-config.ts:431-433` backend-kind-aware validation); route the 16 bypass files; ADR-002/004 supersession drafts; `satisfies` factory check (ARCH-033). Verification: typecheck + full vitest + t-472 re-pointed. NOTE: execution sessions are CODE sessions — they leave the read-only regime ONLY when the owner says go; until then this lane stays preparatory (task breakdowns, T-number registration drafts per AGENTS.md §13).
2. **LF-1 spike scoping**: PGlite packaging on the Windows build chain (`build-windows.sh` 3-layer), the perf corpus (reuse `scripts/build-test-fixture.ts`), and the policy-parse census harness. All can be designed now, executed when green-lit.

### Lane B — Unblocked verification lanes (read-only, always available)
1. **Full `npx vitest run` census + t-502 root cause** (open question 3 — carried since S1; needs only the sandbox, never the live project). If run: record per-suite results in `Testing and Runtime Evidence/`, update RUNTIME-EVIDENCE.md, register the t-502 verdict.
2. **Static-only deepening that execution will need** (all read-only): inventory the 89 `auth.uid()` policy shapes (which need only uid vs JWT claims beyond uid — feeds the GUC shim design); map the 27 untouched tables to their RPC/EF/trigger writers (feeds the extraction script's RPC-read checklist); draft the two ADR supersession texts (ADR-002/004) as archive documents for LF-0 to adopt verbatim.

### Lane C — Environment-gated (unchanged)
1. **Live-DB census + final extraction** (open question 1): blocked on the owner lifting the spend cap ONCE; re-test the REST surface at session start (GET-only, the S4-CROSS-VERIFICATION §3.2 probe set) — if unrestricted, run `scripts/live_census.py` pattern immediately.
2. **Android sibling repo** (open question 2): student-code semantics, permission enum parity (ARCH-015), workflow engine mirror, `pull_*_for_sync` reachability — required before D-2 (Android cloud access) can be answered intelligently and before LF-4's Android surface.

### Lane D — Register upkeep (every session)
1. Re-read `Investigation Archive/README.md`, SESSION_LOG, this handoff.
2. Record `git status` at start and end; commit+push incrementally on `investigation/session-05`; merge to `main` after verification.
3. New findings take the next stable IDs (DEAD-016+, DUP-033+, ARCH-036+, BUG-038+, OPS-014+).
4. Token hygiene: grep for `sb_secret|sbp_|ghp_|vcp_|AIza` before every push; never commit credential values (OPS-012/013 remain owner actions — flag, don't fix).
5. If the owner answers any of D-1..D-12 in the issue, record the answers in `OWNER-DECISION-PACKET.md` (a dated addendum section) and adjust the ROADMAP rows that cited the defaults.

## Guardrails for every continuation session (unchanged + S4 additions)

1. Never modify application source, configs, schemas, or dependencies. Write only inside `Investigation Archive/` and `Refactoring Unified/` (execution sessions excepted only by explicit owner green-light, and then only per the ROADMAP rows + AGENTS.md governance).
2. Challenge prior conclusions with new evidence — record corrections in FINDINGS_INDEX, don't erase originals (S4's C-1..C-7 are the model).
3. Counting methodology matters: use the multiline-aware RPC census and comment-aware SQL census (documented in S4-CROSS-VERIFICATION §1 rows 5-7); single-line literal greps undercount (86 vs 89) and naive file-glob greps miss deep relative imports (`crud-test-tab.tsx`).
4. Live probes are GET-only unless the owner explicitly authorizes more; never attempt DB logins; token values never enter any file.
5. The graduated documents are now the plan of record: cite BLUEPRINT §13 / ROADMAP 6-7 by row; if execution evidence contradicts them, register a correction first, then amend.
