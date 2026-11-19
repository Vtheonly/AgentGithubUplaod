# Handoff — Session 7 → Session 8

**Session ID:** S7 · **Date:** 2026-11-19 · **Branch:** `investigation/session-07` (merged to `main`, pushed) · **Repo HEAD at start:** `37e9b1f7` (main, clean tree; the 6 pending S6 commits were pushed to origin/main at session start).

## Where everything is

- **The new evidence layer (this session's deliverable):** `Investigation Archive/Deep Sweep/` — README (methodology + census index) + `01-DEEP-UI-CENSUS` / `02-DEEP-TOKEN-CENSUS` / `03-DEEP-LOGIC-CENSUS` + `censuses/` (50+ raw evidence files: complete `file:line:match` dumps with commands/HEAD/counts, 24 per-file aggregations, 11 vocabulary distributions, 5 estate maps). **If a count in any older document is questioned, the census file is the authority — re-run its recorded command.**
- **The plan of record (unchanged):** `Refactoring Unified/EXECUTION-PLAN.md` v1.0 + BLUEPRINT v1.2 + ROADMAP. Session 7 did NOT revise them (read-only sweep session); the deltas to fold in at the next revision are listed in `03-DEEP-LOGIC-CENSUS §8` and `01-DEEP-UI-CENSUS §10`.
- **Registers:** FINDINGS_INDEX carries the S7 addendum (4 new IDs: **BUG-039, ARCH-036, DUP-034, DEAD-017**; 6 corrections: **C-13..C-18**). **Next free IDs: DEAD-018, DUP-035, ARCH-037, BUG-040, OPS-014; next correction C-19.** SESSION_LOG row 7; open questions 1-8 unchanged (1 blocked-on-cap, 2 blocked-on-repo, 3-4 CLOSED, 5-8 owner-gated).
- **Infra:** `01-INFRASTRUCTURE-STATUS.md` not re-tested this session (static censuses only; OPS-011 stands as 5-run-stable plan-layer). GitHub PAT re-verified by the session-start push.

## What Session 7 established (do not re-litigate without new evidence)

1. **The census layer exists and is reproducible.** Every load-bearing count in the archive now has a complete, line-numbered evidence file. The counting-method lesson (C-13/C-14): prior numbers measured with loose or paginated patterns were 2-12x off in scope (165→359; 496→413-real; 34→46 z-sites; 3→13 height values) while their dispositions survived.
2. **The design-token layer is inventoried** (index.css + tailwind.config.cjs read in full; all vocabularies measured) — including the token-layer defects the utility-class audit could not see: BUG-039 (`--radius-pill` never defined), ARCH-036 (brand parity contract violated by blue-deep/blue-light), DEAD-017 (accordion keyframes + rounded-pill + double fade family).
3. **The radix surface is exactly known:** 8 import sites (6 Dialog shells, 1 DropdownMenu, 1 Tooltip), 68 UnifiedModal importers (listed), 20 fixed-anchored files (listed; 12 feature-level fixed surfaces newly inventoried), 40 hand-rolled-table files, 9 native-select files, 1 native confirm.
4. **Two prior "verified" counts were method artifacts:** the S6 re-verification of 496 `.from()` and the S2 165 useObservable were reproductions of loose/paginated patterns, not true counts (C-14/C-13). Rule for every future count: pin the pattern to the precise shape (`\.from\("` not `\.from\(`), aggregate per-file, and cross-check with a second shape before recording.

## Exact next steps for Session 8

### Gate check first (every run)
1. Sync repo; `git status` clean; re-read README → SESSION_LOG → this handoff → EXECUTION-PLAN end-to-end → the Deep Sweep README (the census index).
2. Check Issue #32 for owner activity (comments/timeline events). Any D-1..D-12 answer → dated addendum in OWNER-DECISION-PACKET; any execution green-light → EXECUTION-PLAN §1 gates lift.
3. GET-only infra probe set; update `01-INFRASTRUCTURE-STATUS.md` (if REST-with-secret returns 200 → the cap is lifted → schedule the live census + E7.9 final-export ceremony).

### Lane A — execution (if this is the consolidation session)
1. Start with EXECUTION-PLAN §3 (register T-549..T-554 — note T-552's corrected verification grep: `\.from\("` quoted-name shape + the C-11 dynamic-import shape), then §4 stages under the gates.
2. **Fold the S7 deltas into EXECUTION-PLAN at first touch** (documented in `03-DEEP-LOGIC-CENSUS §8`): heaviest-pages list (6 files), SET-U2 base (40-file ceremony table), E6 additions (BUG-039, ARCH-036, DUP-034, DEAD-017 — all precisely specified with file:line and fix shapes), z-scale 7 layers, height 13-value worklist.

### Lane B — remaining depth (read-only, opportunity-only)
1. **Per-consumer class-string extraction for the remaining UnifiedModal consumers** (the top shells — modal-shell, entity-drawer, wizard, auto-form — have complete side-by-sides in the S2 audit; the 58 remaining consumers have the importer list + censuses but not per-consumer prop/class tables). Method: read each file's `<UnifiedModal` usage; tabulate props used vs the full contract; flag divergence. This is the last unbuilt depth lane of the UI mandate.
2. **Runtime UI inspection** (the one thing static censuses cannot provide): if an execution environment allows a foreground dev server, the app boots in mock mode (`useSupabase=false` → mockRepositories) — the login screen gates it, so this needs an auth bypass lane or the owner's environment; treat as stretch, not commitment.
3. Any further sweep asks from the owner → the census engine pattern (commands recorded in-file, per-file aggregation, vocabulary distribution) is the method.

### Lane C — register upkeep (every session)
1. New IDs from DEAD-018 / DUP-035 / ARCH-037 / BUG-040 / OPS-014; corrections from C-19.
2. Token hygiene grep (`sb_secret|sbp_|ghp_|vcp_|AIza`) before every push — standing false-positive hits are documentation text only.
3. Frequent incremental commits on `investigation/session-08`; merge to `main` after verification; never force-push. **Never write application source/config/schema/dependencies outside an owner-green-lit execution lane.**

## Guardrails (unchanged)

1. Read-only regime for investigation sessions: only `Investigation Archive/` and `Refactoring Unified/`.
2. Challenge prior conclusions with new evidence — corrections join the register (C-13..C-18 are this session's model); originals are never erased.
3. Counting discipline: precise patterns + per-file aggregation + second-shape cross-check (the C-13/C-14 lesson); never accept a reproduced artifact as verification.
4. Live probes are GET-only; token values never enter any file.
5. The census files are the evidence authority: cite them (or re-run them) before citing a summary number.
