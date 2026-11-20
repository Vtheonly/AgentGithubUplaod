# Session 18 Report — the Supabase Relocation & Reload Guide

**Date:** 2026-11-20 · **Mode:** STRICTLY READ-ONLY audit + documentation (the owner's focused relocation mandate) · **HEAD at start:** `6c0b007e` (main, clean; sandbox recycled at session start — repo re-cloned) · **Branch:** `investigation/session-18`

## 1. The mandate

"Assume we are given credentials for a brand-new Supabase account/project… audit the entire codebase thoroughly and create complete, exact, step-by-step documentation explaining (1) how to relocate and reload the entire application onto a new Supabase account today — including both standard migration and emergency recovery when the old Supabase project is already quota-blocked — and (2) every hardcoded dependency, architectural trap, and breaking point… plus the exact refactoring steps to make future relocations effortless with ZERO data loss." Six audit layers specified; execution mode read-only (only `Investigation Archive/` + `Refactoring Unified/` writable; no secrets in files or replies).

## 2. What was delivered

**`Investigation Archive/SUPABASE-RELOCATION-AND-RELOAD-GUIDE.md`** — the operational successor to the S13 RELOCATION-RUNBOOK. Structure: Part 1 = the six-layer audit (every claim file:line-cited, personally verified); Part 2 Section A = the step-by-step runbook (A.0 preconditions → A.6 verification checklist) covering BOTH paths (online export; emergency recovery from local state — the path available under today's 402); Section B = the 9-item ranked blocker register + the effortless-relocation refactoring plan.

Register/plan updates: FINDINGS_INDEX S18 addendum (+OPS-016, +ARCH-046, the OPS-313-fixed refresh); EXECUTION-PLAN **v1.3** §12 (T-573 BackendProfile, T-574 auth-UUID tooling, T-575 one-command preflight, folded with the two new IDs); README structure row + current-state rows (S17 carried, S18 new); SESSION_LOG row 18; this report + handoff-session-18.

## 3. Headline findings (all verified this session at HEAD `6c0b007e`)

1. **The three-way build-time credential lockdown.** Production builds hard-code the old project (supabase-client.ts:35-38,148-157 — localStorage ignored BY DESIGN); the packager refuses any foreign key (build-windows.mjs:161-185) and asserts the canonical URL is literally inside the compiled payload (:305/:314). No `.env*` files exist anywhere. **Re-pointing a packaged Windows client = a 6-line source edit (the guide's §A.5.1 table) + rebuild + reinstall on every client.** The dev-only runtime override (Settings → Configuration) is production-disabled.
2. **OPS-016 (new): the packager is hostage to the old project's billing state.** build-windows.mjs:80-97 runs a live REST preflight and fails the build on any non-200 — under the current 402, **no Windows installer can be built at all**.
3. **The `auth.users` UUID portability surface is 7 tables/functions deep** (user_profiles, account_approval_requests, parents, students, activation bindings, personnel linkage, audit attribution) — a naive relocation locks EVERYONE out (the login join at supabase-auth-repository.ts:96-100). Two remedies documented: UUID-preserving creation (admin API honors `user_id`) or the email-match remap SQL (§A.4.3.3b).
4. **The chain is blank-project ready:** 152 migrations, OPS-313's parse bug FIXED at HEAD, the 54001 SECURITY DEFINER lesson carried in-chain by 0099 — but "N/N applied ≠ parity" (the previous relocation's rule): the guide mandates the pg_proc parity check + verify_t-376 12/12 + an authenticated REST smoke before any data load. The bootstrap-9000 single-file path is a subset trap (RLS-disabled importer quickstart — never for full relocation).
5. **Storage is fully portable (positive finding):** 10 private buckets, all chain-created; paths bucket-relative; signed URLs minted at runtime; `getPublicUrl` forbidden — **no URL-rewrite pass is ever needed**.
6. **The local estate is completely inventoried** (§5.1 table): the IndexedDB sync queue (full entry shape; 8 idempotent upsert RPCs; the 3-way basePayload conflict guard), the AES-256 encrypted backup vault (+salt in localStorage), the full-export ZIPs, the CacheFreshness self-heal, and the exact CLEAR-vs-PRESERVE client state-transition table for the switchover.
7. **ARCH-046 (new): EF config drift** — config.toml declares 2 functions that don't exist (`export-data`, `generate-receipt-pdf`) and omits 4 that do (`create-user-account`, `delete-user-account`, `send-push-notification`, +`_shared`).
8. **Historical precedent recovered:** AGENTS_supabase.md documents that the CURRENT project was itself a relocation (from `hkvkefubghbbotgnteir`, 95-migration era) — its 54001 failure and "never diagnose from the client console" rules are folded into the runbook's verification gates. (Its §5.2 "OPS-313 OPEN" is stale — fixed 2026-09-15, T-378; recorded in the FINDINGS_INDEX refresh.)

## 4. Infra posture this session

No new probe was due within this session's window (the S17 run, same day, stands: OPS-011 **15-run-stable** — REST/auth 402 `exceed_egress_quota`, mgmt token 401, GitHub PAT 200+push, Vercel PAT valid, poolers open). The 402 reality is exactly why the guide's **Path 2 (emergency recovery from local state)** is the operative path today; Path 1 requires the one-time cap-lift window.

## 5. Discipline verification

- Read-only regime maintained: only `Investigation Archive/` and `Refactoring Unified/` files created/modified; zero application source/config/schema/dependency touches (`git status` verified docs-only before commit).
- Token hygiene: no credential values in any changed file (grep over the changed set before push); the guide references the canonical publishable key by location (`supabase-client.ts:36-37`), never by value.
- Every load-bearing claim personally read at HEAD (no subagents this session); counting method recorded for the RLS census (109 enables/331 policies vs S13's 108/324 — delta from 0154-0157 + case-insensitive method, both cited).

## 6. What remains open (owner-gated)

1. The execution green-light for T-573/T-574/T-575 (the effortless-relocation lane — EXECUTION-PLAN v1.3 §12), sequenced after/with T-559/T-560 + BUG-058 per OPS-015.
2. The one-time old-project cap lift if Path 1 (online export) is preferred over Path 2.
3. The relocation decision itself: relocate now (the guide is ready) vs. wait for the LF end-state (LOCAL-FIRST-BLUEPRINT) where relocation degenerates to a profile swap.
