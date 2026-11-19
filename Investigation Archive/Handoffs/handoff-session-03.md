# Handoff — Session 3 → Session 4

**Session ID:** S3 · **Date:** 2026-11-19 · **Branch:** `investigation/session-03` (merged to `main`, pushed) · **Repo HEAD at start:** `9a91ba8f` (main, clean tree); all Session 3 documentation published on `main`.

## Where everything is

- **Architecture deliverables (the owner's directive §3):**
  - `Investigation Archive/Database and Supabase/SUPABASE-COUPLING-MAP.md` — file-by-file coupling map, severity/risk ratings, seam-leak analysis, top-15 heat map, live re-test addendum.
  - `Investigation Archive/Data Pipeline Unification/01-PIPELINE-INVENTORY.md` — every backup/restore/sync/export/import/offload implementation + the R-1..R-15 corruption-risk matrix.
  - `Investigation Archive/Data Pipeline Unification/02-UNIFIED-PIPELINE-DESIGN.md` — PipelineCore + 8 services, canonical archive v2, 10-step restore contract, 47-row consolidation map, P-0..P-4 phases.
  - `Investigation Archive/Local-First Architecture/LOCAL-FIRST-BLUEPRINT.md` — PGlite main-process engine, DataBackendPort/AuthPort/SyncTransportPort boundary, 6-option sync matrix (recommended: self-hosted relay), LF-0..LF-5 phases, ADR dispositions.
- **Registers:** FINDINGS_INDEX carries S3 IDs ARCH-022..034, BUG-032..037, DEAD-015, DUP-031..032, OPS-012 (next free: DEAD-016, DUP-033, ARCH-035, BUG-038, OPS-013) + 5 corrections. SESSION_LOG row 3 + open questions 6–7.

## What Session 3 established (do not re-litigate without new evidence)

1. **Restore is mock-store-only** (ARCH-029/R-1) and **therapy attachments discard file bytes** (BUG-032/R-2) — the two most severe data-durability defects; fixes are specified in 02-UNIFIED-PIPELINE-DESIGN §5/§6.
2. **Every pipeline category has 3+ competing implementations** (owner's suspicion confirmed with counts): backup 4+3, restore 5, sync 8, export 6 XLSX + 2 CSV + 2 PDF + 2 ZIP + 3 downloaders, import 6+3, offload 6.
3. **`supabase-client.ts` production hard-lock** (ARCH-023) is migration step LF-0: without removing the `VITE_DESKTOP_PRODUCTION` pin and the non-`supabase.co` URL rejection, no local backend is reachable.
4. **The coupling is channeled**: 42 files / 26,684 lines in `src/infrastructure/supabase`; 56 RPCs / 89 call sites; 496 `.from()` queries over 73 tables; the repository seam exists and its leaks are enumerated (ARCH-019 + ARCH-022 tenant-switcher, EF-only logic, 21 academic `fn_*` RPCs with no TS mirror, GoTrue lifecycle, realtime, storage, RLS estate 324 policies).
5. **Recommended target**: PGlite in the Electron main process (runs the existing 100-table schema + RPCs nearly verbatim) + a tiny self-hosted sync relay (Node + Postgres, one install by the owner, zero end-user config) reusing the existing sync queue + 0143 keyset contract; fallbacks named (better-sqlite3; CRDT-over-dumb-transport). ADR-002/004 supersession is an LF-0 precondition.
6. **Live Supabase is STILL restricted** (`exceed_egress_quota`; re-tested this session) — OPS-011 persists; the final data extraction needs the cap lifted exactly once (blueprint §8).
7. **Three "full data" perimeters existed** (8 vs 13 streams vs import schemas) — unified to the 13-stream registry in the design; the factory override map is compiler-unaudited (ARCH-033).

## Exact next steps for Session 4 (priority order)

### Step 1 — Owner decision packet (top gate)
Collect and present the 12 open decisions (SESSION_LOG questions 5–7): 7 local-first decisions (blueprint §11: sync topology, Android cloud access, push notifications, hosting appetite, stopgap-vs-go, mock-slot features, Google OAuth) + 5 pipeline decisions (02-DESIGN §9: live-restore semantics, mirror keep-or-drop, checkpoint relabeling vs workbook schema, `debtSummaries` derived-vs-stored, DEAD-013 fail-closed). Nothing in LF-1+/P-1+ should start before the sync-topology and live-restore answers.

### Step 2 — Cross-verify the S3 designs (graduation precondition)
Spot-verify the S3 deliverables' load-bearing claims against source (the coupling map's counts, the inventory's dispositions, the blueprint's PGlite gates), then graduate the verified conclusions into `Refactoring Unified/` per the charter: BLUEPRINT gets the local-first architecture section; ROADMAP gets the LF-0..LF-5 and P-0..P-4 phases interlocked with the existing phases.

### Step 3 — Environment-gated verifications (if unblocked)
- If the owner lifted the spend cap: run the final full export + live census (GET-only; `scripts/live_census.py` pattern) → close open question 1.
- Full `npx vitest run` census + t-502 root-cause (unchanged from S2 handoff).

### Step 4 — Execution prep (no code this session type)
When the owner green-lights execution: LF-0 first (hard-lock removal + seam formalization + `satisfies` check for ARCH-033 + ADR-002/004 amendments), then LF-1 gates (PGlite extension census over the chain, 324/324 policy-parse, perf gate at t-368 scale). UI work continues per UI-U1..U7 (start z-tokens + ModalShell); SET-U4/BUG-031 remains the XS quick win.

### Step 5 — Android repo cross-check (unchanged)
Student-code semantics, Permission enum parity (ARCH-015), workflow engine mirror, `pull_*_for_sync` reachability — the S3 sync design assumes these answers.

## Guardrails for every continuation session (unchanged + S3 additions)

1. Re-read `Investigation Archive/README.md`, SESSION_LOG.md, and the latest handoff first.
2. Never modify application source, configs, schemas, or dependencies. Write only inside `Investigation Archive/` and `Refactoring Unified/`.
3. Record `git status` at start and end of each session; commit+push incrementally on `investigation/session-NN` and merge to `main` after verification.
4. Challenge prior conclusions with new evidence — record corrections, don't erase originals.
5. New findings take the next stable IDs (DEAD-016+, DUP-033+, ARCH-035+, BUG-038+, OPS-013+).
6. Never commit tokens or credentials to any branch (grep for `sb_secret|sbp_|ghp_|vcp_|AIza` before every push). OPS-012 (credential committed in `docs/operations/credentials.md`) is an OWNER ACTION item — do not "fix" it by editing docs outside the two allowed folders; flag it in reports until the owner rotates.
7. Live Supabase access, when it returns, is GET-only unless the owner explicitly authorizes the §11.1 ceremony.
8. S3 designs (pipeline + local-first) are NOT yet cross-verified: treat them as the current best evidence, cite them by section, and register any contradiction as a correction rather than silently deviating.
