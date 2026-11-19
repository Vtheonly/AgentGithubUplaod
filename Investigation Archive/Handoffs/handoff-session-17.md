# Handoff — Session 16 → Session 17

**Session ID:** S16 · **Date:** 2026-11-20 · **Branch:** `investigation/session-16` (merged to `main`, pushed) · **Repo HEAD at start:** `3e6ad7b9` (main, clean tree).

## Where everything is

- **This session's deliverables:** `Investigation Archive/Deep Sweep/12-BUG-044-ORIGIN-S16-VERIFICATIONS-2026-11-20.md` (BUG-044 origin pinned §1; the toast-churn family census §2; the 20-row [S-A]/[S-B] verification table §3) + `Refactoring Unified/EXECUTION-PLAN.md` **v1.2** (§11 — the standing S8–S13 queue T-555..T-560 folded into the plan of record + **T-572** registered + the T-560 ×5 / T-561 8-site scope corrections) + the S16 register rows (FINDINGS_INDEX addendum: +BUG-065, the BUG-044/BUG-042 refinements, the DS/11-flags discharge).
- **The plan of record:** EXECUTION-PLAN **v1.2** — now self-contained: the top-CRITICAL lane (BUG-042/T-559+T-560) is IN the file (§11), not handoff-only. **T-559/T-560 remain the top CRITICAL** (now with the five-site family scope); the OPS-015 sequencing constraint is sharpened: the cap lift must not precede T-559/T-560 + the BUG-058 fix, else FIVE request loops (not one) re-burn the egress quota.
- **Registers:** FINDINGS_INDEX carries the S16 addendum (**BUG-065**; BUG-044 → V with the origin pinned; BUG-042's family extension). **Next free IDs: DEAD-024, DUP-037, ARCH-046, BUG-066, OPS-016; next correction C-23 (unused).** SESSION_LOG row 16. Deep Sweep README row 12.
- **Infra:** `01-INFRASTRUCTURE-STATUS.md` has the S16 run (OPS-011 **14-run-stable**; GitHub PAT 200s + push; Vercel PAT VALID; mgmt token 401; poolers OPEN; **P9c: the direct-db host now resolves from the sandbox** — a sandbox DNS change, no project significance; Issue #32 — 0 comments, no owner activity, 13th consecutive quiet check).

## What Session 16 established (do not re-litigate without new evidence)

1. **BUG-044 is fully explained — origin pinned, both halves (DS/12 §1).** Half 1: the silent unconfigured send is a deterministic 7-link UX chain — the turn commits BEFORE the provider call (`ai-copilot-provider.tsx:496-497`); `loadConfig()` never returns null (`ai-config-storage.ts:114-116`); the runtime throws PRE-NETWORK (`agent-runtime.ts:184-193` — S12's zero-request datum); the ONLY surface is the 4.5 s toast (clean console by construction); T-268 persists the failed turn; the drawer shows a live-looking model badge with no unconfigured state; **the test suite pins the defective persistence (`copilot-drawer.test.tsx:245`)**. Half 2: the once-observed update-depth loop = **the BUG-042 toast-churn family triggered through the copilot's own `showError`** (churn ×108 useToast consumers × the mounted toast-keyed Settings effect; **zero error boundaries app-wide** → the root unmount = "drawer unmounted"). The loop sub-item is closed as explained-by-family; the UX fix is **T-572**.
2. **The toast-churn family has FIVE loop-capable sites (DS/12 §2):** configuration-tab:73-85 (the proven BUG-042) + accounts-tab:60-80 + pricing-year-config-bar:58-63 + promotion-cycle-detail:69-78 + promotion-cycles-tab:53-62. **T-560's scope is corrected to all five**; T-559 (split the toast context — stable `show*` identities) remains the one-line root fix for the whole family.
3. **The DS/11 §8 [S-A]/[S-B] obligation is DISCHARGED (DS/12 §3):** all 20 subagent-only claims personally re-verified at HEAD `3e6ad7b9` — 20/20 stand. Three record corrections: two file paths (teachers-tab at `features/academics/`; create-section-dialog at `features/academics/placement/`), and the dual-condition teacher filter is **8 sites, not 6** (+ class-detail-page.tsx:205, academic-year-detail-drawer.tsx:248). T-561's M-U2 rewire scope grows to 8.
4. **BUG-065 (new):** `CATEGORY_FROM_DB` maps DB `medical` → domain `'support'` while `CATEGORY_TO_DB` maps `medical` → `'medical'` (`supabase-personnel-repository.ts:110-129`) — medical staff silently read back as 'support' (wrong form value after reload, wrong payslip label, latent trap for medical-scoped logic; no test pins it). The round-trip parity test must land BEFORE the bridge deletes in T-561/M-U2.
5. **EXECUTION-PLAN is self-contained as of v1.2:** §11 carries T-555 (reserved) / T-556 / T-557 (owner D-call: fail-closed vs remove) / T-558 / T-559 / T-560 (×5) / T-572 with evidence links — the plan file no longer depends on the handoffs for the standing queue.

## Exact next steps for Session 17

### Gate check first (every run)
1. Sync repo; `git status` clean; re-read README → SESSION_LOG → this handoff → Deep Sweep/12 (this session's authority).
2. Check Issue #32 for owner activity (16 runs: 0 comments so far). Any D-1..D-16 answer → dated addendum in OWNER-DECISION-PACKET; any execution green-light → EXECUTION-PLAN §1 gates lift (**T-559/T-560 first** — now the five-loop family — then the BUG-058 probe fix, then DS/07 §8 Phase 0; the BUG-059..063 truncation lane and the T-561..T-571 pedagogy lane slot beside them; T-572 is independent).
3. GET-only infra probe set (keyless script pattern — `infra_test_s16.sh` outside the repo is this session's; keys via the chmod-600 env file OUTSIDE the repo); update `01-INFRASTRUCTURE-STATUS.md`. **If P2/P3 return 200, the cap is lifted** — confirm T-559/T-560 + the BUG-058 fix landed FIRST (OPS-015 sequencing, now five-loop), then run the three staged ceremonies (live census → S8 §8 re-verification → S11 §A1.5 ×10/legacy reconciliation), then schedule E7.9.

### Lane A — execution (if this is the consolidation session)
1. EXECUTION-PLAN §3 (T-549..T-554) then §11 (T-559 → T-560 ×5; T-556/T-557/T-558; T-572), the BUG-059..063 truncation lane, DS/07 §8 Phase 0–3, and §10 (the pedagogy lane T-561..T-571 — sequencing + the Phase-4-greps-before-Phase-5-deletion gate unchanged; T-561 now carries the 8-site M-U2 scope + the BUG-065 parity-test precondition).

### Lane B — remaining depth (read-only, opportunity-only)
1. **The runtime-item backlog is now EMPTY** — BUG-044 was the last one; nothing else in the register is marked "origin not pinned". Remaining depth candidates are verification-of-fix work (post-T-559/T-560 runtime re-probe against the five sites; post-T-572 copilot re-walk), which belong to execution sessions, not investigations.
2. If the owner supplies the FILLED workbook, run the S14 inspection recipe (`python3 /home/z/my-project/scripts/excel_inspect_s14.py` after updating SRC) and diff against the S14 structure record BEFORE any T-567 import work.
3. Optional depth (never run): a mock-mode runtime walk of the promotion-cycles + pricing tabs to runtime-corroborate the two new family sites' failure shapes (accounts/pricing/promotion lists failing → toast → refire) — low value while the cap stays down; skip unless idle.

### Lane C — register upkeep (every session)
1. New IDs from DEAD-024 / DUP-037 / ARCH-046 / BUG-066 / OPS-016; corrections from C-23.
2. Token hygiene grep (`sb_secret|sbp_|ghp_|vcp_|AIza|sb_publishable`) before every push; **the probe script stays keyless** (keys via environment only; the credentials env file stays OUTSIDE the repo at `/home/z/my-project/scripts/credentials.env`, chmod 600). NOTE: the sandbox recycles between sessions — recreate the env file + probe script from the session mandate's credential block each run (never commit either).
3. Frequent incremental commits on `investigation/session-17`; merge to `main` after verification; never force-push. **Never write application source/config/schema/dependencies outside an owner-green-lit execution lane.**

## Guardrails (unchanged)

1. Read-only regime for investigation sessions: only `Investigation Archive/` and `Refactoring Unified/`.
2. Challenge prior conclusions with new evidence — corrections join the register; originals are never erased.
3. Counting discipline: precise patterns + per-file aggregation + second-shape cross-check + manual spot-verification of every load-bearing site (the S16 greps: useToast 108 files; the toast-keyed dep family 6 hits all read; the dual-condition filter 8 sites repo-wide single-pattern; error boundaries 0; Guardian/Tuteur 0; the 20-row §3 table with every row read at HEAD).
4. Live probes are GET-only; token values never enter any repo file.
5. The census/evidence files are the authority: cite them (or re-run them) before citing a summary number.
