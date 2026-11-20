# Handoff — Session 18 → Session 19

**Session ID:** S18 · **Date:** 2026-11-20 · **Branch:** `investigation/session-18` (merged to `main`, pushed) · **Repo HEAD at start:** `6c0b007e` (main, clean; sandbox recycled at session start — the repo was re-cloned, and the credentials env + keyless probe script survived at `/home/z/my-project/scripts/`).

## Where everything is

- **This session's deliverable:** `Investigation Archive/SUPABASE-RELOCATION-AND-RELOAD-GUIDE.md` — the OPERATIONAL relocation & reload guide (the S13 RELOCATION-RUNBOOK's successor): six-layer audit (verified at HEAD, every claim file:line-cited) + Section A runbook (Path 1 online / **Path 2 quota-blocked emergency recovery** — the operative path under OPS-011's 15-run-stable 402) + Section B the 9-item blocker register with the T-573/T-574/T-575 effortless-relocation plan.
- **The plan of record:** EXECUTION-PLAN **v1.3** (§12 — the relocation lane folded: **T-573** BackendProfile runtime switch; **T-574** auth-UUID tooling; **T-575** one-command target preflight; + **OPS-016** (the packager hostage to the old project's 402 — no Windows installer buildable during the block) and **ARCH-046** (config.toml ↔ functions/ EF drift), both with dispositions).
- **Registers:** FINDINGS_INDEX carries the S18 addendum (OPS-016, ARCH-046, the OPS-313-fixed refresh vs the stale AGENTS_supabase.md §5.2). **Next free IDs: DEAD-024, DUP-037, ARCH-047, BUG-066, OPS-017; next correction C-23 (unused).** SESSION_LOG row 18. README structure row + current-state rows S17/S18.
- **Infra:** OPS-011 **15-run-stable** (the S17 run, same day: REST/auth 402 `exceed_egress_quota`; mgmt token 401; GitHub PAT 200+push; Vercel PAT valid; poolers open; Issue #32 open, 0 comments).

## What Session 18 established (do not re-litigate without new evidence)

1. **The three-way build-time lockdown is complete and verified:** production builds hard-code the old project (supabase-client.ts:35-38,148-157 — runtime config ignored BY DESIGN; the packager's one-key Set guard build-windows.mjs:161-185; the payload assertion :305/:314; NO `.env*` files anywhere; the Electron main process has zero Supabase references). **A production re-point = the guide's §A.5.1 6-line edit list + rebuild + reinstall.**
2. **OPS-016:** the packager's live preflight (:80-97) fails under the old project's 402 — **no Windows build is possible during the quota block** (either lift the old cap or execute T-573/T-575 first).
3. **The auth UUID surface is 7 deep** (user_profiles/account_approval_requests/parents/students/activation-bindings/personnel/audit) — the login join (supabase-auth-repository.ts:96-100) is the lockout point; remedies: UUID-preserving creation (admin API) or the email-match remap SQL (guide §A.4.3.3b). Passwords are never exportable (reset flow required).
4. **The chain is blank-project ready** (OPS-313 fixed; the 54001 lesson carried by 0099) but parity must be PROVEN: the pg_proc helper check + verify_t-376 12/12 + authenticated REST smoke are mandatory gates (guide §A.2). The bootstrap-9000 file is a subset trap (RLS-disabled, unregistered — importer/Android quickstart only).
5. **Storage is portable by construction** (10 chain-created private buckets; bucket-relative paths; runtime signed URLs; no getPublicUrl) — no URL rewrite ever needed. **Realtime follows the client; publications ride the chain.**
6. **The client state-transition table is canonical** (guide §5.4/A.5.2): CLEAR `el-imtiyaz.session` + the old SDK session key + `sync.lastSyncAt`; PRESERVE the IndexedDB sync queue + the encrypted vault + the backup salt; the queue replays safely (8 idempotent RPCs + the 3-way basePayload guard) ONCE the referenced tenant/actor rows exist.
7. **The current project was itself a relocation** (AGENTS_supabase.md: from `hkvkefubghbbotgnteir`) — the guide inherits its rules; its §5.2 "OPS-313 OPEN" is stale (fixed 2026-09-15 in-source).

## Exact next steps for Session 19

### Gate check first (every run)
1. Sync repo; `git status` clean; re-read README → SESSION_LOG → this handoff → the GUIDE (this session's authority). **NOTE: the sandbox recycles between sessions — re-clone from `main`, and recreate the credentials env + keyless probe script from the session mandate's credential block each run (never commit either).**
2. Check Issue #32 for owner activity (18 runs: 0 comments so far). Any D-1..D-16 answer → dated addendum in OWNER-DECISION-PACKET; any execution green-light → EXECUTION-PLAN §1 gates lift (**T-559/T-560 first — the five-loop family — then the BUG-058 probe fix**; the relocation lane T-573..T-575 slots after them; ARCH-046 is a one-file E3-lane fix).
3. GET-only infra probe set; update `01-INFRASTRUCTURE-STATUS.md`. If P2/P3 return 200: the cap lifted — confirm T-559/T-560 + BUG-058 landed FIRST (OPS-015), then the three staged ceremonies, then (if relocating) the guide's Path 1.

### Lane A — execution (if the green light lands)
1. EXECUTION-PLAN §3 (T-549..T-554) then §11 (T-559 → T-560 ×5; T-556/T-557/T-558; T-572), the BUG-059..063 truncation lane, DS/07 §8 Phase 0-3, §10 (the pedagogy lane T-561..T-571), and now **§12 (T-573 → T-575 → T-574; ARCH-046 rides the next SQL/EF touch)**.

### Lane B — remaining depth (read-only, opportunity-only)
1. The runtime-item backlog remains EMPTY; the relocation audit is complete. Optional depth (never run): a mock-mode runtime walk of the guide's §A.6 checklist steps that are client-verifiable without a live backend (e.g., the vault archive round-trip in mock mode) — low value; skip unless idle.
2. If the owner supplies the FILLED workbook: the S14 inspection recipe before any T-567 import work (unchanged).

### Lane C — register upkeep (every session)
1. New IDs from DEAD-024 / DUP-037 / ARCH-047 / BUG-066 / OPS-017; corrections from C-23.
2. Token hygiene grep (`sb_secret|sbp_|ghp_|vcp_|AIza|sb_publishable`) before every push; the probe script stays keyless; the credentials env file stays OUTSIDE the repo (chmod 600).
3. Frequent incremental commits on `investigation/session-19`; merge to `main` after verification; never force-push. **Never write application source/config/schema/dependencies outside an owner-green-lit execution lane.**

## Guardrails (unchanged)

1. Read-only regime for investigation sessions: only `Investigation Archive/` and `Refactoring Unified/`.
2. Challenge prior conclusions with new evidence — corrections join the register; originals are never erased.
3. Counting discipline: precise patterns + per-file aggregation + second-shape cross-check + manual spot-verification of every load-bearing site (S18's method: every guide claim personally read at HEAD; the RLS census 109/331 recorded with its method and reconciled against S13's 108/324).
4. Live probes are GET-only; token values never enter any repo file.
5. The census/evidence files are the authority: cite them (or re-run them) before citing a summary number.
