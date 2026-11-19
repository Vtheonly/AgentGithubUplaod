# Session 13 Report — Egress, Truncation & Relocation Audit

**Date:** 2026-11-19 · **Branch:** `investigation/session-13` (pushed; merged to `main`) · **HEAD at start:** `0d48564e` (main, clean tree). **Charter:** read-only — only `Investigation Archive/` written.

## What this session was

The owner re-issued the deep-audit mandate (the "much deeper, read-only audit prompt": Supabase decoupling + easy relocation with zero data loss, and the deep egress/performance/correctness audit with the preliminary clue list), with a fresh credential set and the instruction "test if it works make sure it works". The gate check (README → SESSION_LOG → handoff-session-13 → Deep Sweep/08; Issue #32 unchanged, 0 comments) confirmed the handoff's assignments: the three cap-lift ceremonies still owner-gated, Lane A (execution) not green-lit, Lane B's last runtime item (BUG-044 loop origin) optional, register upkeep mandatory. The session then cross-checked **every clue in the owner's deep-audit list against the existing archive** and found three genuinely uncovered quadrants, which became this session's work (the BUG-044 runtime probe stays carried forward — the uncovered quadrants were owner-mandated, the probe is opportunity-only):

1. **`max_rows = 1000` silent truncation — ZERO prior archive coverage** (`rg -i max_rows` over the whole archive = 0 hits).
2. **SQL-by-SQL materialized-view/financial verification** — the 07-report verification counted MV redefinitions but never verified financial correctness.
3. **The egress wire-cost framing** of the clue files (full-table reads, cache/seeded behavior, double downloads, amplification) — the S2/S3 docs cover architecture and mechanism, not the traffic classes.
4. **The Supabase project RELOCATION path** — LOCAL-FIRST-BLUEPRINT §8 covers only the one-time local migration.

## Headline results (all in `Deep Sweep/09` + the census + the runbook)

1. **The truncation census (413 sites, evidence `censuses/s13-maxrows-truncation-census.txt`):** WRITE 183 / NOLIMIT 108 / SINGLE 53 / LIMIT 44 / KEYSET 17 / COUNT 6 / RPC-FIRST 1 / RANGE 1. The financial core seeds are ALREADY immune — the codebase's own T-423 (keyset + the 0123 jsonb collection RPCs) and T-424 (dashboard) fixed them, with live counts embedded in the task comments (ledger 3,342; payments 2,198 paid; installments 5,963/4,227 unpaid; students 1,137; overdue 874) — this remediation history is now documented as baseline (it was never in the archive).
2. **Five live defect families registered (BUG-059..063):** the dashboard `demographics()` students read and the same-day attendance read truncate at TODAY's scale (1,137 > 1,000 — the demographics panels silently render over a biased sample while the KPI card shows the true count); `collectDebtors()` builds the restriction list from ≤1,000 of 4,227 unpaid rows (a 24% sample); `reconcile()`'s TIER-2 cross-check runs on three unfiltered full-table `SELECT *` (the integrity surface is itself truncated — flagged a hard prerequisite for the relocation gates); the overdue-alert generator is cap-edge at 874/1,000 (+ its notifications `limit(2000)` capped); and the 9-site per-entity family — including the per-parent ledger `.limit(2000)` at shared:4927 that the T-423 comment explicitly claims was fixed ("the per-parent ledger histories lost every entry past the first thousand" — this path was never migrated).
3. **The MV verification:** both owner-suspected 0021 bugs confirmed verbatim (`mv_debt_aging` sums `amount > 0` charges only, aged by entry_date; `mv_revenue_by_month` hard-limited to a rolling 11-months-back window) — and traced through the fix chain: 0034 documented and rewrote them canonically, 0041 removed the revenue window, **0049 fixed a live 389× fan-out multiplication (54.96M reported as 21.38B)** nobody had suspected, 0111 extended the aging. Final definitions are financially CORRECT — but **DEAD-019: the entire MV estate (5 matviews + refresh functions + the nightly EF) has ZERO desktop consumers** (owner decision: drop at the LF end-state or promote to the portal reporting layer).
4. **The egress verification (clue-by-clue, §3):** TanStack settled (ARCH-020 — the provider IS mounted, zero feature use); multi-window N/A (single BrowserWindow); the sync pipeline confirmed (30 s poller, 3-4 requests/entry, the T-171 "1 170-badge" live burn record); the dashboard's triple data path registered (**ARCH-040** — uncached per-filter-change collection downloads ×2 via the prev-year second tick, plus the parallel observable subscriptions); the TTL re-seed economics measured (**OPS-015**: ≈13k+ rows per 30 s/focus volley in live mode at current scale). **OPS-015's sequencing constraint: the cap lift MUST NOT precede the T-559/T-560 + BUG-058 fixes, or the app immediately re-burns the quota.**
5. **The RELOCATION-RUNBOOK** (`Local-First Architecture/RELOCATION-RUNBOOK.md`): the zero-data-loss Supabase→Supabase procedure the blueprint lacked — the 10 file:line blockers (the two-gates config seam is #1), the BackendProfile concept (one resolver, zero fallbacks — the generalized T-559/T-560/BUG-058 fix), 6 phases with verification gates (the S8 per-student balance oracle as the transfer gate; auth-UUID preservation; the offline-queue replay under the 3-way conflict guard), the rollback model, the interim §5 path, and the LF end-state that retires the runbook.

## Infrastructure (gate check + "make sure it works")

The GET-only probe set re-run with the owner's fresh credentials (keyless script outside the repo; keys via environment, never written to any file): **OPS-011 is now 11-run-stable** — P2/P3/P4/P5/P5b all 402 `exceed_egress_quota` (the cap is NOT lifted; both Supabase keys RECOGNIZED — P1's key-type gate + P2's quota body; the blocker remains the plan/spend-cap layer); P7 management token still 401-invalid; P8 Firebase key format-accepted; P9 pooler ports OPEN; P10 GitHub PAT **200 + this session's pushes**; **P11 Vercel PAT now VALID (200)** — the owner rotated it (S4's INVALID verdict applied to the old token) — OPS-013/open-question-8 updated. Full record: `01-INFRASTRUCTURE-STATUS.md` S13 run.

## Git discipline

Branch `investigation/session-13` off main `0d48564e`; incremental commits pushed immediately (the DS/09+census+runbook commit; the registers commit; this report + handoff commit); merged to `main` after verification; no force-push; token-hygiene grep run before every push (see below); **`git status` verified clean of any application-source change at every commit** — only `Investigation Archive/` was touched.

## Register deltas (Lane C)

- **FINDINGS_INDEX S13 addendum:** +BUG-059, BUG-060, BUG-061, BUG-062, BUG-063, ARCH-040, DEAD-019, OPS-015 (8 new IDs; the clue items already covered are cross-referenced, not re-registered). Next free IDs: **BUG-064, DEAD-020, DUP-035, ARCH-041, OPS-016; next correction C-23** (no corrections this session — the S13 census's own three classifier iterations were fixed before publication and are recorded in the census header, not the correction register).
- **SESSION_LOG:** row 13 + open-question 1 (11-run-stable + the OPS-015 sequencing constraint) + open-question 8 (Vercel re-validated).
- **01-INFRASTRUCTURE-STATUS:** the S13 run section.
- **README:** the DS/09 + RELOCATION-RUNBOOK + session-13-report/handoff-14 structure rows; the current-state Session 13 paragraph.
- **Token hygiene:** the pre-push grep (`sb_secret|sbp_|ghp_|vcp_|AIza`) over the changed files — zero token material in any committed file (the probe script is keyless and lives outside the repo; the census/audit documents reference only masked env-var names).

## Deliverables

| File | Content |
|---|---|
| `Deep Sweep/09-EGRESS-TRUNCATION-RELOCATION-AUDIT-2026-11-19.md` | The main deliverable: §1 truncation audit, §2 MV verification, §3 egress verification, §4 relocation summary, §5 register deltas |
| `Deep Sweep/censuses/s13-maxrows-truncation-census.txt` | The complete 413-site classification evidence (re-runnable: script path in header) |
| `Local-First Architecture/RELOCATION-RUNBOOK.md` | The zero-data-loss Supabase→Supabase relocation design |
| Registers | FINDINGS_INDEX S13 addendum; SESSION_LOG row 13 + open questions; 01-INFRASTRUCTURE-STATUS S13 run; README structure + current-state rows |
| This report + `Handoffs/handoff-session-14.md` | The session record and the next-session handoff |

## Carry-forward for Session 14

See `Handoffs/handoff-session-14.md` — the deep-audit mandate is now fully covered (every clue has a verdict + evidence); the remaining lanes are the standing executor queue (T-549..T-560 + the DS/07 §8 Phase 0-3 checklist, now with BUG-059..063's truncation fixes slotting beside them), the BUG-044 loop-origin runtime probe (still the last open runtime item), the three owner-gated ceremonies (unchanged, plus the NEW OPS-015 sequencing constraint on the cap lift), and the owner decisions (D-1..D-12 + the runbook's §7 open items).
