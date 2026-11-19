# Session 4 Report — Cross-Verification, Graduation & Owner Decision Packet (2026-11-19)

**Session ID:** S4 · **Branch:** `investigation/session-04` (from `main` @ `0e68fc57`, clean tree at start) · **Mode:** strictly read-only on the application (only `Investigation Archive/` and `Refactoring Unified/` written); GET-only on live infrastructure · **Charter:** handoff-session-03 Steps 1-3 (owner decision packet, S3 cross-verification + graduation, environment-gated re-tests) under the Issue #32 multi-session protocol and the owner's four-part directive.

## 1. What Session 4 did

Session 3 had produced the four architecture deliverables as single-session designs; the archive charter graduates such designs only after cross-verification. Session 4 was the graduation session:

1. **Re-verified the Session 3 record claim-by-claim** (`Testing and Runtime Evidence/S4-CROSS-VERIFICATION-2026-11-19.md`): every load-bearing count re-derived with fresh commands (multiline-aware RPC census, comment-aware SQL census, direct reads at every cited line range), every disposition spot-checked at source.
2. **Pre-computed the LF-0 engine gate** — the migration-chain extension census the blueprint had left as an LF-0 TODO: pgcrypto/pg_trgm loadable-and-used, uuid-ossp/pgjwt declared-but-never-callable and absent from PGlite's set (two skip-guards needed in the replay prologue), pg_stat_statements already exception-guarded, 89 `auth.uid()` refs confirming the auth-GUC shim (registered as **ARCH-035**).
3. **Re-tested the live infrastructure** (GET-only, owner-provided tokens; in-memory only, never committed): OPS-011 restriction persists on every Supabase HTTP surface; GitHub PAT verified working (all session pushes); **Vercel PAT invalid**; Firebase key format-valid but functionally unverified (registered as **OPS-013**).
4. **Compiled the owner decision packet** (`OWNER-DECISION-PACKET.md`): the 12 open decisions (D-1..D-12 = 7 local-first + 5 pipeline) each with options, recommendation, and a proposed default so the program moves even without an answer; plus the credential scorecard and the three outstanding owner actions.
5. **Graduated the verified conclusions into `Refactoring Unified/`**: BLUEPRINT v1.2 gains §13 (local-first architecture + unified pipeline, with the S4 corrections folded in and the non-graduated items explicitly listed); ROADMAP gains Phases 6 (pipeline P-0..P-4) and 7 (local-first LF-0..LF-5) with the full interlock table and owner-decision gates; §10/§11 updated for consistency.
6. **Updated the registers**: FINDINGS_INDEX +2 IDs (ARCH-035, OPS-013) + 7 corrections (C-1..C-7); SESSION_LOG row 4, open questions 1/5/6/7 refreshed, question 8 added; README structure table + current-state.

## 2. Verification results (summary — full tables in S4-CROSS-VERIFICATION)

| Category | Result |
|---|---|
| Load-bearing claims re-derived | **21 verified EXACTLY** — all footprint counts (42/26,684; 37/24,277; 16/22/7,284; 152/43,388), runtime surface (56 RPCs / 89 call sites / 20 files; 496 `.from()` / 73 tables), SQL census (324 policies / 40 files; 108 RLS; 100/14/5 tables/views/matviews), factory map (49 overrides; T-498 comment verbatim; 5 mock slots absent), code-level claims (ARCH-023 hard-lock, ARCH-029 mock-only restore, BUG-032 therapy bytes, ARCH-026 perimeters, ARCH-034 phantom preload API, BUG-036 versioning asymmetry, ARCH-030 unaudited exports), test-surface sub-counts (321/107/74/19/77), scripts estate (292/193/144) |
| Corrections registered | **7** (C-1..C-7) — the notable ones: the untouched-table list is **27** not 26 (`receipts` was missing — a pointed omission given ADR-004); test-files-touching-Supabase is **158** not 188; the bypass-routing scope is **16** files not ~14; the sync queue is lossier than stated (**5 producer kinds**, 8 push-path kinds, 5 enum-only). None invalidates an S3 disposition; all are folded into the graduated documents |
| Anomaly chased to ground | An initial 86-vs-89 RPC call-site mismatch resolved to S3 being RIGHT: 3 RPC calls pass the function name as a variable (single-line literal greps undercount; the multiline census is the correct method — now documented in the verification file for future sessions) |

## 3. Live infrastructure state (2026-11-19, GET-only)

| Surface | Status |
|---|---|
| Supabase REST (secret key) / JWKS / auth-health | **402 `exceed_egress_quota` — OPS-011 persists**; the app's live mode remains broken; the one-time cap lift for the final export is unchanged as the only owner-side prerequisite |
| Supabase management token | 401 invalid (unchanged) |
| Anon-key REST probe | Error body changed from the restriction message to a key-layer rejection ("Secret API key required") — cosmetic gateway drift; the restriction itself is proven by the secret-key/JWKS/health probes |
| GitHub PAT | **Working** (user + repo admin; every session commit pushed with it) |
| Vercel PAT | **INVALID** (`403 invalidToken:true`) — OPS-013 |
| Firebase web key | Processed/valid-format; GCIP endpoint returns CONFIGURATION_NOT_FOUND; functionally unverified (all deeper probes are mutating — excluded by the GET-only rule) |
| DB pooler | TCP reachable 6543/5432; auth untestable (no password provided; none attempted) |

## 4. The graduation (what changed in `Refactoring Unified/`)

- **BLUEPRINT.md → v1.2**: new §13 (13.1 target architecture with the S4-verified gates and corrected counts; 13.2 sync recommendation; 13.3 unified pipeline; 13.4 sequencing; 13.5 explicit NOT-graduated list: PGlite runtime claims, relay ops, D-1..D-12 dependencies, Android cross-checks, the extraction). §10 roadmap summary and §11 risk register extended (risk 10).
- **ROADMAP.md**: **Phase 6** (19 rows, pipeline P-0..P-4 with the one-commit-path, RestoreService, 13-stream perimeter, archive v2, therapy bytes, hardening backlog) and **Phase 7** (6 rows, LF-0..LF-5) with the interlock paragraph (7.0 parallel-starts; 7.1 rides 6.5; 7.3 supersedes 6.16 and shrinks Phase 2; 7.4 consumes 6.6; D-1/D-8 gates) and the standing INV-2 gate definition.
- Graduation discipline held: only conclusions surviving S4 verification moved up; runtime/spike claims stayed in the archive with their gates.

## 5. What was deliberately NOT done

- **No execution**: no code, config, schema, dependency, or build/test command touched the application (the census scripts ran read-only analysis from outside the repo tree; nothing was written into it).
- **No live mutations**: all probes GET-only; no RPC calls, no writes, no project-state changes; no database login attempted (no password available).
- **No decision-taking**: the 12 owner decisions are collected with recommendations and defaults, not decided — the defaults activate only if the owner stays silent (stated in the packet itself).
- **Android cross-checks**: still blocked (sibling repo never provided; open question 2).
- **Full vitest census / t-502 root cause**: still environment-gated (open question 3) — not re-attempted this session to keep the graduation lane focused; remains a Session 5 lane.

## 6. Git record (this session)

Branch `investigation/session-04`, pushed after every commit; secret-scan (`sb_secret_|sbp_|ghp_|vcp_|AIza`) run before every push — zero matches:

| Commit | Content |
|---|---|
| `e357ce3f` | S4 cross-verification evidence doc (21 verified / 7 corrections / extension census / infra re-test) |
| `e5864a0f` | Owner decision packet (D-1..D-12 + defaults + credential scorecard) |
| `ecf5f7eb` | Graduation: BLUEPRINT v1.2 §13 + ROADMAP Phases 6-7 |
| `e7f24e85` | Registers: FINDINGS_INDEX (+ARCH-035, +OPS-013, C-1..C-7), SESSION_LOG, README |
| (this session, final) | session-04-report.md + handoff-session-05.md; merge to `main` |

## 7. Bottom line

The investigation charter is now functionally complete end-to-end: every part of the owner's four-part directive (core-logic unification, UI redundancy, Supabase decoupling + local-first + unified backup/restore/sync, and the archive deliverables) has an evidence-backed deliverable that has survived independent re-derivation. The blueprint (`Refactoring Unified/`) is the single authoritative execution plan — eight phases, interlocked, with named gates, named owners' decisions, and a kill-switch at every step. What remains is owner-gated (D-1..D-12 answers, the one-time spend-cap lift, credential rotations per OPS-012/013) or environment-gated (Android repo, full test run) — nothing in the plan itself is unscoped. The program can start LF-0 (ROADMAP 7.0) at the owner's word.
