# Session 4 Cross-Verification — S3 Deliverables + Live Infrastructure Re-Test (2026-11-19)

**Session ID:** S4 · **Mode:** read-only on the application; GET-only on live infrastructure · **Purpose:** the graduation precondition from `Handoffs/handoff-session-03.md` Step 2 — "spot-verify the S3 deliverables' load-bearing claims against source (the coupling map's counts, the inventory's dispositions, the blueprint's PGlite gates), then graduate the verified conclusions into `Refactoring Unified/`." This file is the evidence record of that verification. The graduation itself lands in `Refactoring Unified/BLUEPRINT.md` §13 and `Refactoring Unified/ROADMAP.md` Phases 6–7 (same session).

**Method.** Every count below was re-derived with a fresh command this session (Python census over non-test `src/`, comment-aware SQL census over `supabase/migrations/*.sql`, direct file reads at cited line ranges). The census scripts are reproducible from the descriptions inline; the S3 methodology (multiline-aware RPC matching, comment-stripped policy counting) was replicated, not trusted. Live probes mirror Session 2/3's GET-only protocol; tokens were used in-memory only and never written to any file in this repository.

---

## 1. Claims verified EXACTLY (load-bearing, re-derived)

| # | S3 claim (source doc) | S4 re-derivation | Result |
|---|---|---|---|
| 1 | 42 files / 26,684 lines in `src/infrastructure/supabase/` (coupling map §1) | `find … -name "*.ts" \| xargs wc -l` | **VERIFIED** — 42 / 26,684 |
| 2 | 37 repository adapters / 24,277 lines (§1) | same, `repositories/` subtree | **VERIFIED** — 37 / 24,277 |
| 3 | 16 EF folders / 22 .ts / 7,284 lines (§1) | `ls` + `find … \| xargs wc -l` over `supabase/functions/` | **VERIFIED** — 16 / 22 / 7,284 |
| 4 | 152 migrations / 43,388 lines (§1) | `ls` + `wc -l` over `supabase/migrations/*.sql` | **VERIFIED** — 152 / 43,388 |
| 5 | 56 distinct RPC names; 89 `.rpc()` call sites in 20 files (§1) | Python census, multiline-aware, non-test `src/` | **VERIFIED** — 56 / 89 / 20 (3 of the 89 pass the RPC name as a variable, all in `supabase-shared-repositories.ts` — exactly why S3's multiline census was needed; a single-line literal grep undercounts to 86) |
| 6 | 496 `.from()` table queries touching 73 tables (§1) | Python census | **VERIFIED** — 496 raw `.from(` occurrences in non-test `src/`; 413 carry literal table names over **73** distinct tables |
| 7 | 324 CREATE POLICY in 40 files; 108 ENABLE RLS (§1/§3g) | comment-aware SQL census over the 152 migrations | **VERIFIED** — 324 / 40 / 108 |
| 8 | Chain census 100 tables / 14 views / 5 matviews (LIVE-CENSUS §3) | comment-aware `CREATE TABLE/VIEW/MATERIALIZED VIEW` census | **VERIFIED** — 100 / 14 / 5 |
| 9 | 49 override keys in the factory map; T-498 comment at `:445-453`; 5 slots stay mock (ARCH-006) | Python key-extraction over the `const repositories: Repositories = {…}` block (`supabase-repositories.ts:423-486`) | **VERIFIED** — exactly 49 keys; the T-498 promotionCycles comment is verbatim at `:445-453`; clubs/psychology/orthophonie/aiConfig/performanceReviews are absent from the overrides |
| 10 | ARCH-023 hard-lock: canonical URL+key constants (`supabase-client.ts:35-38`), production ignores local config (`:148-157,171-172`), storageKey pinned to project ref (`:205`), `validateConnection` rejects non-`supabase.co` (`system-config.ts:431-433`) | direct reads at each cited range | **VERIFIED verbatim** — every line cite holds |
| 11 | ARCH-029: restore only calls `mockStore.replaceOperationalState` (`backup-service.ts:597`; `mock-store.ts:268-300`) | direct read | **VERIFIED** — restore swaps the in-memory mock store and RBAC overrides via localStorage; no live-store replay exists |
| 12 | BUG-032: therapy attachments keep metadata only — file bytes discarded (`therapy-attachments-card.tsx:63-75`) | direct read of `handleFilesSelected` | **VERIFIED** — `Array.from(files).map(…)` builds `{id, fileName, kind, uploadedBy, uploadedAt, note}`; no `arrayBuffer()`/upload call anywhere in the handler |
| 13 | ARCH-026: three perimeters — vault snapshot 8 streams (`backup-service.ts:168-197`) vs `FullExportData` 13 streams (`full-export.ts:63`) | direct reads | **VERIFIED** — snapshot = parents, students, payments, installments, ledger, expenses, personnel, workflows (+RBAC/ER sections); FullExportData = those plus assessments, subjects, attendance, debtSummaries, classes, pricing (13) |
| 14 | ARCH-034: `vite-env.d.ts:15-41` declares `app`/`fs`/`config` members `preload.cts` never exposes | direct read + grep of `electron/preload.cts` | **VERIFIED** — preload exposes only `window`, `zoom`, `shell.openExternal`, `saveFile`, `pickFile`, `pickBackupFile`, `pickDirectory`; no `config`, no `app`, no `fs` (and `shell.openPath` is also declared-but-unexposed) |
| 15 | Electron main/preload are Supabase-clean (§3a) | `grep -ci supabase electron/main.cts electron/preload.cts` | **VERIFIED** — 0 / 0 |
| 16 | Test surface: 321 test files; 107 import `infrastructure/supabase`; 74 import `@supabase/supabase-js`; 19 read EF source; 77 reference `Supabase*Repository` (§3j) | fresh greps over `src/tests` | **VERIFIED** — 321 / 107 / 74 / 19 / 77, all exact |
| 17 | BUG-036: vault records carry no `schemaVersion` locally while the mirror writes `schemaVersion: 1` (`supabase-backup-repository.ts:234`) | grep | **VERIFIED** — the only `schemaVersion` in the backup layer is the mirror's `1` |
| 18 | ARCH-030: `archive-export.ts` writes no audit events | grep for audit imports/calls | **VERIFIED** — zero audit imports; the word "audit" appears only in a comment |
| 19 | BUG-037 shape: 8 of 15 `SyncEntityKind`s have push paths; 5 kinds have zero producers (§3 of the design / H-6) | census of `default-push-handler.ts` case labels + producer grep | **VERIFIED with refinement** — push paths: 8 kinds (`parent, student, payment, ledger_entry, installment, attendance, grade, homework`); enqueue producers exist for only **5** kinds (`parent, student, payment, installment, ledger_entry` — via `mock-store.armStaging` checkpoints + the excel-import modal); the 5 zero-producer kinds (`invoice, audit_log, notification, calendar_event, other`) confirmed by grep. The S3 phrase "only 8 of 15 staged" conflates push paths with staging — see correction C-6 |
| 20 | Scripts estate: 292 files in `elimtiyaz-desktop/scripts/`; 193 reference `SUPABASE_*`; 144 docs files reference supabase; 19 ADRs reference Supabase (§3i/§3k) | fresh counts | **VERIFIED** — 292 / 193 / 144 / 19 (the ADR file count drifted: 35 files exist, not 30 — correction C-4) |
| 21 | ARCH-019's 9 feature files import `supabase-client` directly; + `tenant-switcher` beyond them (§3h) | grep for the import across `src/` excluding tests and the supabase tree | **VERIFIED** — 9 feature files (incl. `crud-test-tab.tsx:40`, which a shallow grep misses due to its 3-level relative path); total direct importers outside `src/infrastructure/supabase/` = **17** (9 features, `repository-provider` [the seam itself], `sync-provider`, `tenant-switcher`, `system-config`, `media-vault`, `llm-adapter`, 3 sync files) |

## 2. Corrections to the S3 record (registered, originals stand corrected-aside per archive rules)

| # | S3 statement | S4 finding | Severity |
|---|---|---|---|
| C-1 | "26 chain tables are RPC/EF/trigger-only" / "73 of the 99 live chain tables" (coupling map §1; blueprint §2; ARCH-025) | **27 of 100**. The untouched list is re-derived as the S3 list of 26 **plus `receipts`** — a chain table the desktop never queries via `.from()` (it is written only by receipt-numbering RPCs/triggers, 0034/0058). `receipts` is a particularly pointed omission: it is the ADR-004 server-authoritative table. ARCH-025's substance (coupling-visibility asymmetry) is unchanged and strengthened. | Medium (count + missing table name) |
| C-2 | "Test files touching Supabase: 188 of 321" (coupling map §1/§3j) | **158 of 321** mention "supabase" case-insensitively (grep -li over all 321 `.test.*` files; also 158 when counting all 325 files under `src/tests`). The sub-counts (107/74/19/77) verify exactly, so the 188 appears to be a method artifact of the "rg -L complement" approach. The conclusion (largest hidden migration cost) is unaffected — 158/321 = 49% of the suite. | Medium (headline number) |
| C-3 | "Repo-root `scripts/` — 54 files; 41 `tNNN-build-zips.sh`" (§3i) | **52 files**; **42** `tNNN`-prefixed scripts, of which **39** are build-zip(s) builders (35 `-build-zips.sh` + 4 `-build-zip.sh`). | Low (category conclusion unchanged) |
| C-4 | "75 `apply_*_live.sh`" (§1/§3i); "30 ADRs" (§3k) | **72** files match `*apply*live*` (75 total `apply_*` scripts; 3 lack "live" in the name). ADRs: **35 files** in `docs/decisions/`, 19 referencing Supabase (the 19 verifies). | Low |
| C-5 | Line-cite drifts: EF "+90 days" header at `purge-expired-backups/index.ts:17-18` → actual `:12`; backup `tenantId` hard-code at `:168,241` → actual `:179,249`; factory block "421-486" → actual object literal `:423-486` (the spread starts `:427`) | Substance of all three VERIFIED (the +90-vs-365 retention drift BUG-034; the hard-coded `tenant-el-imtiyaz-oran-001`; the 49-key block). Only the line numbers drifted. | Low (citation hygiene) |
| C-6 | "only 8 of 15 entity kinds staged" (BUG-037 / design H-6) | Precision: **8 kinds have push paths** (drain handlers in `default-push-handler.ts:108-299`); only **5 kinds have enqueue producers** (mock-store staging checkpoints + excel-import staging: `parent, student, payment, installment, ledger_entry`); attendance/grade/homework have push paths but no enqueue producers in non-test src (their writes go direct-to-Supabase in live mode, mock-in-memory otherwise); `expense`/`personnel` are "restored-but-never-staged" exactly as H-6 says. Net: the queue is even lossier than the headline suggests — 5 of 15 kinds ever enter the queue. | Medium (precision; strengthens H-6) |
| C-7 | "14 bypass files" (coupling map §4 leak table; blueprint §2 "the 14 bypass files") | The reproducible count of direct `supabase-client` importers outside the supabase tree is **17**, of which 16 need routing through ports (all except `repository-provider.tsx`, which IS the seam): 9 features + `tenant-switcher` + `sync-provider` + `system-config` + `media-vault` + `llm-adapter` + 3 sync files. LF-0's routing scope should be sized at 16, not ~14. | Medium (LF-0 scope sizing) |

## 3. New evidence produced this session

### 3.1 Extension census over the migration chain — the LF-0 PGlite gate, pre-computed

The blueprint's §4 PGlite gate said "grep the 152 migrations in LF-0 — the census script pattern from LIVE-CENSUS §3 applies." Session 4 ran that census. Result (per `0001_extensions.sql` + usage greps over the whole chain):

| Extension | Declared | Actually used | In PGlite's extension set? | LF-0 replay consequence |
|---|---|---|---|---|
| `pgcrypto` | `0001` (`with schema extensions`) | **YES** — 100 `gen_random_uuid` refs, funneled through the `public.gen_uuid()` wrapper (`0001:46-53`) which calls `extensions.gen_random_uuid()` | Yes (PGlite ships pgcrypto as a loadable extension) | Install with `schema extensions`; the wrapper keeps working |
| `pg_trgm` | `0001` | **YES** — 19 `extensions.gin_trgm_ops` refs across 7+ migrations (0005/0009/0010/0011/0012/0013/0027: trigram GIN indexes on search columns) | Yes (loadable) | Install; indexes build normally |
| `btree_gist` | `0001` | **NO** — declared only; zero `USING GIST`/exclusion constraints found in the chain | Yes (loadable) | Harmless either way |
| `uuid-ossp` | `0001` | **NO** — zero `uuid_generate*` calls anywhere in the chain | **No** (not in PGlite's curated set) | Replay prologue must guard/skip — an unguarded `CREATE EXTENSION "uuid-ossp"` failure would roll back all of 0001 |
| `pgjwt` | `0001` | **NO** — zero `extensions.jwt_*` function calls; JWT access in the chain is via `current_setting('request.jwt.claims', true)` and only in 0120/0121 (purge RPC actor names) | **No** | Skip via the same prologue guard; the `auth.uid()` shim (blueprint §8) is what policies actually need — 89 `auth.uid()` references across the chain confirm the shim is mandatory for replay |
| `pg_stat_statements` | `0001` (DO-block with exception handler) | **NO** — never queried | No (requires `shared_preload_libraries`) | **Already safe by design**: 0001's own DO block catches `insufficient_privilege`/`feature_not_supported`/`undefined_file` and raises a notice — the local replay takes the skip path |

Two additional replay facts: (a) `0001` itself creates the `extensions` schema (`create schema if not exists extensions`) — no prologue needed for the schema; (b) the chain's extension surface is otherwise plain Postgres 15. **Net: the PGlite engine gate is now evidence-backed — no blocker found; the replay prologue needs exactly two skip-guards (uuid-ossp, pgjwt) plus the auth-schema/GUC shim already specified in blueprint §8.** Registered as ARCH-035.

### 3.2 Live infrastructure re-test (GET-only, 2026-11-19 ~01:20 UTC)

| # | Probe | Result | vs Session 3 |
|---|---|---|---|
| 1 | REST root (`GET /rest/v1/`) + anon/publishable key | **HTTP 401** — body now `{"message":"Secret API key required","hint":"Only secret API keys can be used for this endpoint."}` | **Message changed**: S3 recorded 401 with the `exceed_egress_quota` body; the gateway now rejects the publishable key at the key-type layer before surfacing the restriction. Operative fact unchanged (see probes 2/4/6) |
| 2 | REST root + secret key | **HTTP 402** — `exceed_egress_quota` … "The project owner must upgrade their plan or remove spend caps to restore service." | **UNCHANGED — restriction persists (OPS-011)** |
| 3 | Management API (`GET /v1/projects/vebfehrpzajhstyhinnw`) + `sbp_` access token | **HTTP 401** — `Invalid access token` | **UNCHANGED** — token still invalid/revoked |
| 4 | JWKS (`GET /auth/v1/.well-known/jwks.json`) | **HTTP 402** — `exceed_egress_quota` | New probe this session — even the public JWKS endpoint is restricted |
| 5 | `GET /auth/v1/health` (no key / with publishable key) | 401 no apikey → **402 `exceed_egress_quota`** with key | **UNCHANGED — restriction persists** |
| 6 | GitHub PAT (`GET /user`, `GET /repos/Vtheonly/AgentGithubUplaod`) | **HTTP 200** — user `Vtheonly`; repo permissions `admin/maintain/push/triage/pull` all true | **WORKING** (also proven operationally: this session's branch `investigation/session-04` was created and pushed with it) |
| 7 | Vercel PAT (`GET /v2/user`) | **HTTP 403** — `{"error":{"code":"forbidden","message":"Not authorized","invalidToken":true}}` | **NEW — first Vercel test: the token is INVALID** (revoked or mistyped). Registered as OPS-013 |
| 8 | Firebase API key (GCIP endpoint `GET /v1/projects?name=projects/elimtiyaz-android&key=…`) | **HTTP 400** `CONFIGURATION_NOT_FOUND` | **NEW — first Firebase test**: the key is syntactically accepted (an invalid key returns `API_KEY_INVALID`/403 instead), but the project's Identity-Platform config is not exposed on this endpoint. Inconclusive beyond that: deeper verification requires either a POST (`accounts:signInWithPassword` — mutating, excluded by the GET-only rule) or OAuth (not provided). The RTDB default-instance probe 404s (no RTDB instance — expected; the config declares a Storage bucket) |
| 9 | Pooler TCP reachability (`aws-1-eu-west-1.pooler.supabase.com:6543/5432`) | **TCP reachable** on both ports | New probe: the network path is open; authentication is untestable — no database password was provided (the owner's sheet carries a `[YOUR-PASSWORD]` placeholder). No login was attempted |

**OPS-011 verdict: STILL RESTRICTED.** The `exceed_egress_quota` restriction persists on every authenticated and public HTTP surface (REST-with-secret-key, JWKS, auth health). Open question 1 remains open: the live-DB census and the final full extraction both wait on the owner lifting the spend cap. The one-time extraction precondition in LOCAL-FIRST-BLUEPRINT §8 is unchanged.

**Credential scorecard (owner-provided, tested this session):** Supabase publishable key — recognized, project restricted; Supabase secret key — recognized, project restricted; Supabase management access token — **invalid**; GitHub PAT — **working** (full repo admin); Vercel PAT — **invalid**; Firebase web API key — processed/valid-format, functionality unverified (no non-mutating probe exists). Token values are never reproduced in this archive; see OPS-013 for the rotation recommendation.

## 4. Graduation verdict

With 21 load-bearing claims verified exactly and 7 corrections registered (none invalidating a disposition; C-1/C-6/C-7 refine scope numbers that the graduation documents now carry corrected), the S3 deliverables meet the archive's graduation standard:

- **SUPABASE-COUPLING-MAP.md** → counts verified; the bypass-routing scope graduates as **16 files** (C-7); the untouched-table asymmetry graduates as **27 tables** including `receipts` (C-1).
- **01-PIPELINE-INVENTORY.md / 02-UNIFIED-PIPELINE-DESIGN.md** → dispositions verified (R-1 mock-only restore, R-2 therapy bytes, R-4 perimeters, retention drift, sync-kind coverage refined per C-6); the 13-stream perimeter, 10-step restore contract, and consolidation map graduate as the pipeline plan of record.
- **LOCAL-FIRST-BLUEPRINT.md** → PGlite gates now evidence-backed (§3.1 above: no extension blocker; two prologue skip-guards + the auth GUC shim); the LF-0..LF-5 phases and the self-hosted-relay recommendation graduate into the ROADMAP and BLUEPRINT.

What does **not** graduate (unchanged from S3's own honesty section): the runtime claims about PGlite performance/bundle size (LF-1 spike gates), the relay's operational characteristics (LF-4), and anything dependent on the 12 owner decisions (see `OWNER-DECISION-PACKET.md`, same session) or on the sibling Android repo (open question 2).

---

*End of verification record. No application source, configuration, schema, or dependency was modified this session; live probes were GET-only; no token value was written to any file in this repository.*
