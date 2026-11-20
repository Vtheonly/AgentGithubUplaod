# Handoff — Session 19 → Session 20

**Session ID:** S19 · **Date:** 2026-11-20 · **Branch:** `investigation/session-19` (merged to `main`, pushed) · **Repo HEAD at start:** `d5534a6f` (main, clean; sandbox recycled at session start — the repo was re-cloned, and the credentials env + keyless probe script survived at `/home/z/my-project/scripts/`).

## Where everything is

- **This session's work:** the standing gate check + the recycle-integrity verification (no new deliverable — the handoff-18 Lane B backlog was empty and its one optional item was explicitly graded "skip unless idle"). The session's record: `Session Reports/session-19-report.md`, `01-INFRASTRUCTURE-STATUS.md` §Session 19, SESSION_LOG row 19, README current-state row.
- **The plan of record:** EXECUTION-PLAN **v1.3** (unchanged this session) — §3 T-549..T-554, §11 T-555..T-560/T-572, the pedagogy lane T-561..T-571, §12 the relocation lane T-573 → T-575 → T-574 (+ OPS-016/ARCH-046 dispositions).
- **Registers (unchanged this session):** FINDINGS_INDEX next free **DEAD-024, DUP-037, ARCH-047, BUG-066, OPS-017; next correction C-23 (unused)**. SESSION_LOG row 19. README current-state row S19.
- **Infra:** OPS-011 **16-run-stable** (P2/P3/P4/P5 all 402 `exceed_egress_quota`; P1 401 key-type gate — both Supabase keys recognized; mgmt token 401; GitHub PAT 200+push, authenticates as the owner account; Vercel PAT still VALID; poolers OPEN both ports; P9c direct-db host unresolvable this run — sandbox DNS variance, no project significance). Issue #32 open, **0 comments** — the 19th consecutive silent run.

## What Session 19 established (do not re-litigate without new evidence)

1. **The recycle-integrity check is now a standing session-start datum (recommended to keep):** filter `git diff <last-verified-HEAD>..<current-HEAD>` to non-archive paths — this session it was ZERO, which is what makes carrying prior sessions' verified claims to the new HEAD legitimate without re-reading everything. The S18 guide's three most load-bearing claims were additionally spot-verified at HEAD (supabase-client.ts:35-38; build-windows.mjs:161-163; :303-315; zero `.env*` files).
2. **Sandbox-recycle tell worth reusing:** an empty `AgentGithubUplaod/` directory makes `git` resolve to a PARENT repo (empty `git remote`, a foreign "Initial commit" in `log --all`). Detect it (`git remote` empty OR no `.git` inside the repo dir) and re-clone — don't trust `git status` from inside it.
3. **OPS-011 signature unchanged across 16 runs** — the blocker is exclusively the plan/spend-cap layer; no credential action substitutes. The OPS-015 sequencing constraint stands (T-559/T-560 five-site family + BUG-058 fix BEFORE any cap lift).

## Exact next steps for Session 20

### Gate check first (every run)
1. Sync repo (watch the recycle tell above); `git status` clean; re-read README → SESSION_LOG → this handoff → the GUIDE (the current authority). Run the recycle-integrity diff (`git diff d5534a6f..<new-HEAD> --name-only` filtered to non-archive paths — update the reference commit to the latest verified HEAD).
2. Check Issue #32 for owner activity (19 runs: 0 comments so far). Any D-1..D-16 answer → dated addendum in OWNER-DECISION-PACKET; any execution green-light → EXECUTION-PLAN §1 gates lift (**T-559/T-560 first — the five-loop family — then the BUG-058 probe fix**; the relocation lane T-573..T-575 slots after them; ARCH-046 is a one-file E3-lane fix).
3. GET-only infra probe set; update `01-INFRASTRUCTURE-STATUS.md`. If P2/P3 return 200: the cap lifted — confirm T-559/T-560 + BUG-058 landed FIRST (OPS-015), then the three staged ceremonies, then (if relocating) the guide's Path 1.

### Lane A — execution (if the green light lands)
1. EXECUTION-PLAN §3 (T-549..T-554) then §11 (T-559 → T-560 ×5; T-556/T-557/T-558; T-572), the BUG-059..063 truncation lane, DS/07 §8 Phase 0-3, §10 (the pedagogy lane T-561..T-571), §12 (T-573 → T-575 → T-574; ARCH-046 rides the next SQL/EF touch).

### Lane B — remaining depth (read-only, opportunity-only)
1. The runtime-item backlog remains EMPTY; the relocation audit is complete; the archive's investigation phase is functionally complete. The only never-run optional item left: a mock-mode runtime walk of the guide's §A.6 checklist steps that are client-verifiable without a live backend (e.g., the vault archive round-trip in mock mode) — low value; skip unless idle (two sessions have now skipped it).
2. If the owner supplies the FILLED workbook: the S14 inspection recipe before any T-567 import work (unchanged; `scripts/excel_inspect_s14.py` survived this recycle).

### Lane C — register upkeep (every session)
1. New IDs from DEAD-024 / DUP-037 / ARCH-047 / BUG-066 / OPS-017; corrections from C-23.
2. Token hygiene grep (`sb_secret|sbp_|ghp_|vcp_|AIza|sb_publishable`) before every push; the probe script stays keyless; the credentials env file stays OUTSIDE the repo (chmod 600).
3. Frequent incremental commits on `investigation/session-20`; merge to `main` after verification; never force-push. **Never write application source/config/schema/dependencies outside an owner-green-lit execution lane.**

## Guardrails (unchanged)

1. Read-only regime for investigation sessions: only `Investigation Archive/` and `Refactoring Unified/`.
2. Challenge prior conclusions with new evidence — corrections join the register; originals are never erased.
3. Counting discipline: precise patterns + per-file aggregation + second-shape cross-check + manual spot-verification of every load-bearing site (S19's addition: the recycle-integrity diff as the cheap standing head-check).
4. Live probes are GET-only; token values never enter any repo file.
5. The census/evidence files are the authority: cite them (or re-run them) before citing a summary number.
