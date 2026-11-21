# Handoff — Session 27 → the execution sessions

**Date:** 2026-11-21 · **HEAD at close:** the S27 commits landed on `main` (the continuation run re-applied the preserved session artifacts verbatim after the mid-close context expiry and completed the push + the no-ff merge; the tree byte-consistent with the recorded state) · **G0:** still ACTIVE (Issue #32: 0 comments — the 22nd consecutive silent run, GET-verified).

## The state of record (what changed this session)

1. **The triad is v2.3 — the FINAL pre-Go lock-in:** the §2 three-track HARD order (Track 1 baseline-green → Track 2 `T-559 → T-560 ×5 → T-594` → Track 3 relocation + website cutover + Stage A, BEFORE Phases 1–5; T-577 immediately after Track 3); the full-light primary theme mandate (the ENTIRE Dashboard + Statistics UI); the every-detail Encaissement + full-table report PDFs; the One-By-One actual-Excel gate; NEW §16 (the Payment Error Detector, Diagnostics & Data Inspector Overhaul — T-587 + T-612 + T-613, the G-DETECT-1..4 gates) + NEW T-614 (the Website Cutover card); §0.1's AUTONOMOUS HANDOFF & NEXT-TASK QUEUE protocol (the queue header is written to `docs/recovery/next-task.md` at G0-lift — the FIRST docs-only act). The register: **204 IDs / 0 orphans**.
2. **The website portal is audited (DS/16; OPS-021):** the live site is UP on Vercel but its bundle pins the OLD project; the complete dependency census (31 tables + the view + 4 RPCs + the EF + 5 buckets + 6 realtime channels — all in `0001`); the committed-default trap (`public-config.ts:89-92`); the dynamic-origin OAuth redirect; the three pinning tests. **The cutover plan: T-614 + the RELOAD-GUIDE §A.7.** The owner supplies Vercel access (or the PAT) + the website repo push at cutover time.
3. **The error detector / Data Inspector is root-caused (DS/15):** the year-blind ACTIVE-config-only wiring is the primary "wrong outputs" cause; BUG-072..075/DUP-040/ARCH-052 + C-27 registered; the dedicated overhaul is EXECUTION-PLAN §16 with the 1-by-1 actual-Excel acceptance gates.
4. **The mechanics are surprise-proofed:** the OPS-018 Commit-1 census re-verified 33/33 + 4/4 at HEAD with zero drift (the §1b numbering reconciled); the runner/scripts/package scripts/Stage-A card sites/Excel set all confirmed; `0001` ↔ the guide's §A.2 verification SQL consistent (no archive push).
5. **The charter typo is fixed** (CONCATENATION-FREE) and the §0 protocol makes execution sessions queue-driven (no archive re-reads).

## The next session's bootstrap (in order)

1. `git fetch origin && git status` (must be clean; sync `main` — the S27 commits are landed and pushed; the v2.3 triad is the plan of record).
2. Check Issue #32 (GET-only). **If G0 is lifted:** the first session installs the §0.1 queue header at the top of `docs/recovery/next-task.md` (docs-only), then executes **Commit 1 = the OPS-018 blueprint** (the sed pass + the 4 constructed-path segment edits + the five gates; then the §3 Step 3 baseline re-pin), then T-549 → Track 2 (`T-559 → T-560 ×5 → T-594`) → Track 3 (`T-550 → T-573 → T-552 → ARCH-046 → T-575 → T-574 → the cutover/website T-614 → T-590..T-593 → T-595`) → T-577 (early right-click) → the phases (E2..E6) with the §16 overhaul after E2.4 + T-562. **If not lifted:** the standing GET-only probe set + any documentation/verification work the owner mandates.
3. **The owner-side lanes (unchanged):** D-21/OPS-019 (the Google client's redirect URI — then the OPS-012 full-set rotation); at cutover time the Vercel access + the website repo push for T-614; `ETAT 2024 -205.xlsx` as the owner-supplied external path when the Excel-lane fixtures run.
4. **Charter enforcement (OPS-020) continues** — and the OPS-015 lock now explicitly includes the website deploy (no live build points at either project until Track 2 is green).

## Standing constraints (unchanged)

Read-only until G0 lifts; one T-task per commit with the five-question body; push immediately; never force-push; SQL/EF changes under the §11.1 ceremony; RLS never weakened; the archive's historical reports never re-edited (corrections as addenda); the web portal and Android keep consuming Supabase unchanged (D-17); OPS-015's cap-lift/live-build ordering is absolute — the website deploy included; NO key material in any file, output, or commit; the queue protocol (§0.1) governs every execution session's reading list.
