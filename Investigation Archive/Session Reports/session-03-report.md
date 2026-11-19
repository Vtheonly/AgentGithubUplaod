# Session 3 Report — Architecture Audit (2026-11-19)

**Session ID:** S3 · **Branch:** `investigation/session-03` (branched from `main` @ `9a91ba8f`) · **Mode:** strictly read-only on the application; only `Investigation Archive/` written.
**Charter:** the owner's four-part directive (core-logic unification verification, UI redundancy verification, the critical architecture audit — Supabase decoupling / local-first Electron / unified backup-restore-sync — and the archive deliverables), layered on the Issue #32 multi-session protocol.

## 1. What Session 3 did

Session 2 had already delivered the UI-component audit and the core-logic unification audit. Session 3 therefore:

1. **Re-verified the Session 1–2 record** before building on it (spot-checks below).
2. **Re-tested the live infrastructure** (owner-provided tokens; GET-only).
3. **Produced the four missing architecture deliverables** the owner's directive demanded:

| Deliverable | File | Size | One-line content |
|---|---|---|---|
| Supabase coupling map | `Database and Supabase/SUPABASE-COUPLING-MAP.md` | 303 lines | Every Supabase-coupled file (42 files / 26,684 lines in `src/infrastructure/supabase`; 56 RPCs / 89 call sites; 496 `.from()` queries over 73 tables; 152 migrations / 324 policies / 108 RLS enables; 16 EFs), severity + migration-risk rated per category, the existing repository-seam leak analysis, top-15 risk heat map, live re-test addendum |
| Data-pipeline inventory | `Data Pipeline Unification/01-PIPELINE-INVENTORY.md` | 313 lines | Every backup (4 producers + 3 purge layers), restore (5), sync (8 mechanisms), export (6 XLSX + 2 CSV + 2 PDF stacks + 2 ZIP + 3 download helpers), import (6 paths + 3 re-import drivers), offload (6) implementation with behavior contracts, comparisons, and a 15-row corruption-risk matrix (R-1..R-15) |
| Unified pipeline design | `Data Pipeline Unification/02-UNIFIED-PIPELINE-DESIGN.md` | 382 lines | PipelineCore + 8 services (Backup/Restore/Export/Import/Sync/Retention/Warmup/DownloadHelper), canonical versioned archive v2 (manifest + per-stream SHA-256), 10-step restore contract, 47-row consolidation map, hardening backlog mapped to R-1..R-15, phased plan P-0..P-4 |
| Local-first blueprint | `Local-First Architecture/LOCAL-FIRST-BLUEPRINT.md` | 401 lines | PGlite (WASM Postgres) in the Electron main process as the recommended local engine, formal `DataBackendPort`/AuthPort/SyncTransportPort boundary, 6-option multi-user sync decision matrix (recommended: tiny self-hosted relay reusing the existing sync queue + 0143 keyset contract), Supabase→local data migration path, LF-0..LF-5 phased plan, ADR-002/004/005/009/011 dispositions |

4. **Registered 24 new finding IDs** (ARCH-022..034, BUG-032..037, DEAD-015, DUP-031..032, OPS-012) and 5 corrections to prior-session records in `Findings and Hypotheses/FINDINGS_INDEX.md`.
5. **Updated the archive index**: README structure table + current-state, SESSION_LOG row 3 + open questions 6–7.

## 2. Verification of prior sessions (spot-checks, all PASS)

| Prior claim | Method | Result |
|---|---|---|
| ARCH-019's 9 feature files import `supabase-client` directly | fresh grep over `src/` | **VERIFIED verbatim** (9 files; plus `tenant-switcher.tsx` beyond the census → ARCH-022; providers/infrastructure importers are legitimate) |
| Shared-UI modal/drawer foundation (UnifiedModal + modal-shell + confirm-modal; entity-drawer; wizard; dropdown-menu; tooltip; auto-form) | LS of `src/shared/ui` | **VERIFIED** — matches the UI audit's component census |
| Import-path census (5 ingestion paths incl. backup restore + sync replay) | read of `02-import-and-fetching-audit.md` + LS of `infrastructure/{backup,sync,export,excel}` | **VERIFIED** — 7 backup files, 7 sync files, 5 export files, 27 import-engine files (count corrected 29→27) |
| OPS-011 live restriction | fresh GET-only re-test (2026-11-19) | **STILL RESTRICTED** — anon key → 401 restricted (`exceed_egress_quota` message body), service key → 402, management token → 401 invalid; GitHub PAT → 200/working (repo + issue + push verified) |
| Session-2 branch state | `git branch -a`, `git log` | **VERIFIED** — `investigation/session-02` merged to `main` (`9a91ba8f`); clean tree at session start |

## 3. Headline discoveries this session

1. **ARCH-029 / R-1 (CRITICAL):** restore never replays an archive to the live store — it only swaps the in-memory mock store, and the restore UI is not scoped to offline mode. There is no backup→live round-trip guarantee anywhere (R-3). The unified design's RestoreService + staged replay contract is the fix.
2. **BUG-032 / R-2 (CRITICAL):** therapy medical attachments store metadata only and discard the file bytes — "attached" documents are unrecoverable.
3. **ARCH-023:** `supabase-client.ts` production hard-lock (`VITE_DESKTOP_PRODUCTION` pins URL+key; `validateConnection` rejects non-`supabase.co` origins) — no local backend can even be pointed at without editing source; removal is migration step LF-0.
4. **ARCH-026 / R-4:** three competing "full data" perimeters (vault 8 streams ≠ full-export 13 streams ≠ import schemas) — unified to one 13-stream registry in the design.
5. **The quota catastrophe has already happened** (OPS-011, re-confirmed): the app's live mode is broken against the restricted project today, which converts the local-first blueprint from an option into the primary recovery path. Final data extraction requires the owner to lift the spend cap exactly once (blueprint §8).
6. **ARCH-033:** the 49-key repository factory override map is compiler-unaudited (T-498 silent-unwiring precedent).

## 4. What was deliberately NOT done

- **No `Refactoring Unified/` graduation**: the four S3 deliverables are single-session designs; per the archive charter they graduate only after cross-verification (next session) and owner sign-off on direction. The graduation checklist is in handoff-session-03 §4.
- **No execution**: no builds, tests, npm, migrations, or live mutations (GET-only probes). PGlite/relay claims are design-time assessments with verification gates embedded in LF-0/LF-1.
- **Android cross-checks**: still blocked on the sibling repo (open question 2).
- **Live-DB census**: still blocked by OPS-011 (open question 1).

## 5. Git record (this session)

Branch `investigation/session-03`, pushed after every commit:

| Commit | Content |
|---|---|
| `1c33deee` | Supabase coupling map |
| `e34c9dd4` | Data-pipeline inventory |
| `1a41c425` | Unified pipeline design |
| `b9fba186` | Local-first blueprint |
| (this session, continued) | FINDINGS_INDEX +24 IDs & 5 corrections; SESSION_LOG row 3 + open questions; README structure; session-03-report.md; handoff-session-03.md; merge to `main` |

Secret hygiene: every document was scanned for `sb_secret_|sbp_|ghp_|vcp_|AIza` before each push — zero matches; tokens were used in-memory only.

## 6. Bottom line

The app's Supabase entanglement is deep but **not unbounded**: it is channeled through one repository seam (54+ slots, mock/supabase dual mode) whose leaks are now enumerated (ARCH-019/022 bypasses, EF-only logic, SQL-authoritative business rules, GoTrue, realtime, storage, the production hard-lock). The local-first blueprint shows a concrete, phased escape (PGlite main-process engine + self-hosted relay sync) that keeps every existing behavior, requires zero end-user setup, and cannot be quota-locked — with the data pipeline unified underneath it (one commit path, one archive format, one restore contract). The single hardest external dependency: one final, owner-initiated export while the spend cap is lifted.
