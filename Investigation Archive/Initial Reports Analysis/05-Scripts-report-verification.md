# Verification Report — 'Optimizing AI Context for Development — Scripts.md'

**Task RPT-5 · Agent SC · Read-only investigation.** Two scripts locations covered: repo-root `scripts/` (52 files) and `elimtiyaz-desktop/scripts/` (302 git-tracked files: 291 top-level + 11 in `i18n/`).

## 1. Report summary

- The report audits a SmartExport dump (`_entire_project_.txt`) that allegedly contained **only** `elimtiyaz-desktop/scripts/` (claimed 260 files) and proposes an exclusion/keep policy.
- Its quantitative backbone is almost exactly right: the 260 count matches the top-level non-`.mjs`/`.mts` files (291 − 29 `.mjs` − 2 `.mts` = 260), but the directory actually holds **302 git-tracked files** — the report never saw the `.mjs` family or `i18n/`.
- Family counts verified precisely: **80** apply/reconciliation scripts, **78** verification scripts, exactly **7** static JSON dumps plus the kept `test-baseline.json`.
- Every specific bug claim checked out verbatim: the `apply_0113` double-`'0113'` registration bug, the `apply_0071` says-0070 comment, `verify_t-407` mismatches, `t-408` 53-vs-52, stale chain counts, hardcoded service-role JWTs, `t-425` string `actorId`.
- The two-backend claim is verified: 30 `apply_*_live.sh` target dead `hkvkefubghbbotgnteir`, 41 target live `vebfehrpzajhstyhinnw`. One detail corrected: `policy_census.sh` hardcodes the old ref at **line 46**, not 58.
- The keep-list is genuinely active and wired, but **omits `run-unified-tests.mjs`** (`npm test`), **`build-windows.mjs`** (`npm run package:win`), the **`i18n/` toolchain** (9 scripts + dictionaries), `t404-postgrest-smoke.sh`, and `build-test-fixture.ts` — all invisible to the report because its export excluded `.mjs` files and the `i18n/` subdir.
- The report **completely ignores the second scripts location** — repo-root `scripts/` (52 files: 39 `tNNN-build-zips.sh` delivery-zip builders + 13 others) — which is where most currently-broken scripts live.
- Independent analysis: the 39 build-zip scripts are near-identical parameterizations (63–78 % common lines) of "stage repo tree with excludes → zip into `deliverables/` → session manifest check"; 8 + t498 + t460-h2j are broken by dead absolute paths.
- `deliverables/` is **985 MB of committed zip artifacts** (142 files, all git-tracked) — the dominant repo-bloat factor the report never mentions.
- `.smartexport/` (2 tracked JSONs, updated 2026-11-17) is the SmartExport AI-context selection state; `scripts/update-selection-state.py` + `dashboard-selection-part1/2.txt` are its (now drifted) allowlist applier.
- `Excel/` is not dead weight: the two workbooks are provenance evidence cited by `src/infrastructure/excel/import-config/configs/etat-*.ts`, and `excel_deep_inspector.py` generated the mapping reports those configs were built from.
- Root `build-windows.sh` vs `elimtiyaz-desktop/scripts/build-windows.mjs` vs `package:win` is a deliberate 3-layer entry chain (Linux Docker/Wine host wrapper → npm script → canonical packager), not duplication.

## 2. Claim-by-claim verification table

| Claim | Classification | Evidence | Notes |
|---|---|---|---|
| Export contained only `elimtiyaz-desktop/scripts/` (260 files) | UNRESOLVED (count CORRECTED) | `_entire_project_.txt` absent from repo; 291 top-level files − 29 `.mjs` − 2 `.mts` = 260; git-tracked total = 302 (incl. `i18n/` ×11) | 260 exactly matches non-`.mjs/.mts` top-level files |
| ~248 of 260 files (~95 %) don't belong in AI context | VERIFIED (arithmetic) | 260 − 12 keep-list files = 248; independent count of wired/active scripts ≈ 15–20 (incl. `.mjs` family the report missed) | |
| Only ~11–12 files actively relevant, incl. `check-migrations-append-only.sh` wired to `npm run check:migrations` and `t-058` test | VERIFIED (with gap) | `elimtiyaz-desktop/package.json:21`; `src/tests/infrastructure/t-058-migration-append-only.test.ts`; guard enforces NNNN_name.sql + `--` header + append-only (`check-migrations-append-only.sh:1–30`) | Omits `run-unified-tests.mjs`, `build-windows.mjs`, `i18n/*`, `t404-postgrest-smoke.sh` |
| `test-baseline.json`: 5,247 passed / 0 failed / 5 skipped, 320 files; runner breakdowns | VERIFIED | `scripts/test-baseline.json`: `tests/passed=5247`, `testFiles/total=320`, desktopRunner 810/820 errored 10, sanityComparator 820/820 canonical 319/319, mirrorRunner 774/820, tier4Comparator 784/820 | Matches to the digit |
| 80 migration apply & reconciliation scripts | VERIFIED | 72 `apply_[0-9]*_live.sh` + 3 `apply_chain_reconciliation_*.sh` + 5 `t*-apply-*.py` = 80 | Numbering has gaps (66→70, 87→89, etc.) |
| 78 SQL/CLI verification scripts | VERIFIED | 73 `verify_*` files (67 sql + 3 sh + 1 py + 1 ts + 1 js) + 5 `t502_*.sql` = 78; range `verify_t-006.sql`..`verify_t-527.sql` | |
| All 7 static JSON dumps listed exist | VERIFIED | `t-441-live-problem.json`, `t-487-e2e-report-FINAL.json`, `t-487-e2e-report-post-fix-run1.json`, `t-487-e2e-report-pre-fix-p0-p3.json`, `t505-file-workflows-live-report.json`, `t505-probe-report.json`, `t515-onboarding-census.json` | Plus kept `test-baseline.json` (8 json total) |
| Management-API/PostgREST/GoTrue boilerplate copy-pasted across ~150 scripts | VERIFIED (approx.) | grep = 193 files reference api.supabase.com/supabase.co; Management-API-only = 126 | "~150" is in range |
| Two backends: dead `hkvkefubghbbotgnteir` vs live `vebfehrpzajhstyhinnw` | VERIFIED | `apply_0107_live.sh:6` & `apply_0108_live.sh:6` "dead archive"; 30 apply scripts hardcode old ref, 41 new; `run_verify_sql_live.sh:23` `PROJECT_REF="vebfehrpzajhstyhinnw"` | AGENTS.md:110 documents old-ref references as "intentional both-project verification convention" |
| `policy_census.sh` still hardcodes old ref **at line 58** | CORRECTED | `policy_census.sh:46`: `PROJECT_REF="hkvkefubghbbotgnteir"` (line 58 is an arg-parsing `if`) | Substance true; line number wrong |
| `apply_0113_fk_0114_catalog_live.sh` inserts version `'0113'` twice instead of `'0114'` | VERIFIED | `apply_0113_fk_0114_catalog_live.sh:44` and `:46` both `VALUES ('0113')` while `:45` cats `0114_algerian_curriculum_catalog.sql` | Necessitated `apply_chain_reconciliation_0112_0114.sh` |
| Copy-paste comment bugs (apply_0071 says 0070; verify_t-407 says 0111 but uses t406_results; t-408 comment 53 vs code 52) | VERIFIED | `apply_0071_live.sh:2`; `verify_t-407.sql:3` + `:28`; `t-408-fake-academic-e2e.ts:33` vs `:586` | |
| Stale chain counts in t-148/151/174/175/176/214/387/404/510/487 | VERIFIED | `verify_t-148.sql:13` (64), `verify_t-151.sql:8` (65), `verify_t-174.sql:6` (66), `verify_t-175.sql:23` (67), `verify_t-176.sql:28` (68), `verify_t-214.sql:28` (77), `verify_t-387.sql:123` (97), `verify_t-404.sql:38–42` (0110), `verify_t-510.sql:75` (148), `t-487-workflow-e2e.ts:195` (`BASELINE`) & `:313` (`version === "0142"`) | All present as historical assertions |
| Hardcoded `service_role` JWTs in `t-368-live-export-e2e.ts`, `t-368-verify-live-summary.ts`, `verify_t-310_e2e.js` | VERIFIED | Each file contains ≥1 `eyJ…` JWT literal | Security contradiction claim stands |
| `t-425-live-reimport.ts` passes string `"t-425-remediation"` as actorId | VERIFIED | `t-425-live-reimport.ts:68` `userId: "t-425-remediation"`, `:117`/`:126` `actorId: "t-425-remediation"` | 22P02 risk |
| `t-058-guard-matrix.sh` hardcodes `/home/z/my-project/.t058-test`; `check-supabase.ts` uses `.delete()` on `parents` | VERIFIED | `t-058-guard-matrix.sh:6`; `check-supabase.ts:113`, `:155–156` | |
| Tranche model: `0124` reversed `0090` (CHECK `(0,1,2,3)`), `0137` made `tranche_number` nullable | VERIFIED | `0124_installments_official_three_tranches.sql:73–75`; `0137_manual_debt.sql:63` | |
| Debt-aging thresholds: grace 5 / yellow 15 / red 60 / active-payer 15 / amount yellow 20 000 / red 60 000 / severe 40 000 | VERIFIED | `0125_debt_aging_configurable_thresholds.sql:117–120`; `0138…:17` + `:91`; `0150_severe_debt_threshold.sql:23` | |
| Production corpus: 741 parents / 1,137 students / 2,198 payments (162,713,000 DZD) / 5,956 installments (356,844,800) / 3,342 ledger | VERIFIED | `t-487-workflow-e2e.ts:196–198` | |
| Publishable key `sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg` | VERIFIED | Present in `t-487-workflow-e2e.ts`, `t500-staff-live-audit.py`, `t-384-parent-removal-e2e.py`, `t511-webhook-diagnostics-live.ts`, `t-379-ef-fleet-matrix.sh` | |
| `apply_0146_live.sh` over-tightens on false premise, superseded by `apply_0146_0147_atomic_live.sh` | VERIFIED | `apply_0146_0147_atomic_live.sh:7–8` | |
| `t404-postgrest-smoke.sh`: pre-0113 expects 400, `--expect-fk` flips to 200 | VERIFIED | `t404-postgrest-smoke.sh:20–33` | AGENTS.md:488 also cites this script |
| Duplicated content has authoritative homes (migrations, AGENTS.md §11.1, credentials.md, financial-tests, src/domain/calc) | VERIFIED | All exist | |
| Report covers the repository's scripts landscape | REJECTED (coverage gap) | Repo-root `scripts/` = 52 files (39 `tNNN-build-zips.sh`, `update-selection-state.py`, `dp-sweep.py`, `sp-sweep.py`, `dashboard-selection-part1/2.txt`, …) — zero mentions in the report | As "Scripts" guidance it misses half the scripts |

## 3. Complete scripts inventory (both locations)

### A. Repo-root `scripts/` (52 files: 39 build-zip + 11 shell/py + 2 txt)

| script | purpose | referenced paths exist? | duplication class | verdict |
|---|---|---|---|---|
| `scripts/t418-build-zips.sh`, `t419-build-zips.sh` | Delivery-zip builders (hub + website + all-systems) | **No** — `HUB=/home/z/my-project/repos/AgentGithubUplaod`, `WEB=…/repos/elimtiyaz-website` (t418:7–8) | family template, absolute-path era | remove-candidate (broken) |
| `scripts/t423-build-zips.sh` | same, T-423 | Hub relative ✓; `WEB=${ELIMTIYAZ_WEBSITE:-/home/z/my-project/work/elimtiyaz-website}` ✗ | family | consolidate |
| `scripts/t425–t439-build-zips.sh` (14 files) | same, T-425..T-439 | Hub ✓; website default `/home/z/my-project/workspace/elimtiyaz-website` ✗ | family | consolidate |
| `scripts/t440–t449, t454-t455, t456-459-build-zips.sh` (8 files) | hub zip + website **carried forward** from prior zip in `deliverables/` | ✓ (relative + carry-forward) | family | consolidate |
| `scripts/t460-h2j-build-zips.sh` | Android + all-systems zips | **No** — `$BASE/AgentGithubUplaod`, `$BASE/elimtiyaz-android` | family (android variant) | remove-candidate (broken) |
| `scripts/t469–t497, t499, t500, t502-build-zip*.sh` (17 files) | hub-only delivery zip + session manifest verification | ✓ (relative `HUB`, `deliverables/` exists) | family, current convention | keep ONE parameterized builder; rest historical |
| `scripts/t498-build-zip.sh` | hub-only zip, T-498 | **No** — `HUB=/home/z/my-project/AgentGithubUplaod` | family (regression to abs path) | remove-candidate (broken) |
| `scripts/analyze-branches.sh` | T-418 remote-branch census | **No** — `cd /home/z/my-project/repos/AgentGithubUplaod` | one-off forensics | remove-candidate (broken) |
| `scripts/merge-commit-map.sh` | T-418 merge-commit map | **No** (same cd) | one-off forensics | remove-candidate (broken) |
| `scripts/verify-branch-containment.sh` | T-418 containment check | **No** (same cd) | one-off forensics | remove-candidate (broken) |
| `scripts/website-branch-check.sh` | website-repo branch containment | **No** | one-off forensics | remove-candidate (broken) |
| `scripts/t418-guarded-deletion.sh` | ADR-028 guarded deletion of merged hub refs | **No** | one-off ops | remove-candidate (broken) |
| `scripts/t418-website-deletion.sh` | same for the 3 website refs | **No** | one-off ops | remove-candidate (broken) |
| `scripts/t418-live-smoke.sh` | Read-only live Supabase smoke; env-credentialed | ✓ (`PROJECT_REF` default live) | unique | keep |
| `scripts/verify_t-092.sh` | Cross-platform migration-token consistency | Partial — sibling repos absent | unique | keep (re-runnable when sibling repos exist) |
| `scripts/dp-sweep.py` | T-460 Android Compose `N.dp` codemod | **No** — targets absent android repo | one-off codemod | remove-candidate |
| `scripts/sp-sweep.py` | T-460 Android `N.sp` codemod | **No** | one-off codemod | remove-candidate |
| `scripts/update-selection-state.py` | Applies allowlist to SmartExport selection state | ✓ (but default output `.smartexport/selection-state-state.json` doesn't match on-disk state files) | unique | keep (AI-context pipeline), fix default path |
| `scripts/dashboard-selection-part1.txt` (33 paths) + `part2.txt` (47) | 80-file Dashboard/Statistics UI allowlist | ✓ paths exist; **stale** vs current `.smartexport` selections (0/80 overlap with default profile, 68/80 with onlyui) | unique | keep or regenerate |

### B. `elimtiyaz-desktop/scripts/` (302 tracked files)

| script(s) | purpose | referenced paths exist? | verdict |
|---|---|---|---|
| `check-migrations-append-only.sh` | append-only migration guard | ✓ | **keep** (wired: `npm run check:migrations`) |
| `run-unified-tests.mjs` | THE unified test runner (typecheck + vitest + equivalence pipeline + baseline compare) | ✓ | **keep** (`npm test`) — missed by report |
| `build-windows.mjs` | canonical Windows packager + preflight/post checks (verifies live ref binding) | ✓ | **keep** (`npm run package:win`) — missed by report |
| `build-windows.cmd` / `smoke-test-windows.cmd` | Windows-native entry / launch smoke (PE `0x8664`, 20 s alive) | ✓ | **keep** |
| `test-baseline.json` | documented Vitest/equivalence baseline consumed by `run-unified-tests.mjs:142` | ✓ | **keep** |
| `generate_analytics_visuals_corpus.ts` / `generate_executive_statistics_corpus.ts` | regenerate equivalence `then` blocks | ✓ | **keep** |
| `run_verify_sql_live.sh` | generic live runner for `verify_t-*.sql` | ✓ | **keep** |
| `policy_census.sh` | RLS policy drift census | Partial — old ref at line 46 | keep with ref fix |
| `verify_t-*.sql` (67) + `verify_t-*.sh/.py/.ts/.js` (6) + `verify_s12_chain_consistency.sql` | per-task live SQL/E2E verification suites (BEGIN…ROLLBACK convention) | ✓ | keep convention + recent members; archive rest |
| `t404-postgrest-smoke.sh` | live PostgREST embed/FK smoke | ✓ | **keep** (AGENTS.md:488 convention model) |
| `apply_[0-9]*_live.sh` (72) + `apply_chain_reconciliation_*.sh` (3) + `t*-apply-*.py` (5) | one-migration live appliers via Management API | ✓; 30 target dead old ref | consolidate to one documented pattern |
| `t-0xx..t-3xx-*` (26) | pre-production-era live matrices, e2e, probes (old ref era) | mostly ✗ | historical archive |
| `t-4xx-*` (51) + `tNNN-*` (47) | session E2E/audit/probe/remediation scripts (T-400..T-529) | ✓ live ref era | historical |
| 7 static JSON evidence dumps | — | ✓ | remove-candidates |
| `check-supabase.ts` / `check-supabase.mjs` | Supabase diagnostics (ts version stale: `.delete()` on `parents`, old RPC shapes) | ✗ ts broken | remove ts, keep mjs |
| `clean-slate-reset.mjs` | truncate all imported data for clean-slate import testing | ✓ | keep as ops tool |
| `eyeball-probe-cleanup.py` | delete T-485 eyeball probe accounts | ✗ `CREDS=/home/z/my-project/scripts/eyeball-probe-creds.env` | remove-candidate |
| `update_allowed_origins.sh` | T-186: add portal origin to EF ALLOWED_ORIGINS | ✗ old ref | remove-candidate |
| `realtime-probe.mjs`, `timetable-packaging-smoke.mjs` | REALTIME-105 evidence probe / T-404 packaging gate | ✓ | keep |
| `build-test-fixture.ts` | synthetic `Suivis clients 2026_2027.xlsx` fixture builder | ✓ | keep |
| `i18n/` (11 files) | i18n codemod + parity toolchain (T-388): `apply-i18n.mjs`, `check-parity.mjs`, `scan-hardcoded-strings.mjs`, `collect-unique-strings.mjs`, `translate-*.mjs`, dictionaries/cache/plan JSONs | ✓ | **keep — entirely missed by report** |
| `t-421-live-verification.mts`, `t546-katex-render-check.mts` | late verification/check scripts | ✓ | keep |

## 4. Duplication quantification

**tNNN-build-zips family (39 scripts, repo-root `scripts/`)** — all parameterize the same operation: stage repo tree(s) via `rsync` with a fixed exclude list (`.git`, `node_modules`, `deliverables/*.zip`, `test-reports`, equivalence results/reports/generated, `*.log`, `.env*`), add the empty-`node_modules` placeholder, `zip -qr` into `deliverables/`, then echo a session-specific manifest verification.

Measured common-line ratios: `t499` vs `t500` differ **only** in header comment, `STAGE`, `ZIP_NAME`, and the manifest block; `t500` vs `t502`: 64 diff lines; `t485`/`t487`: 74/109 common; `t487`/`t488`: 75/103; `t477-t481`/`t482-t484`: 75/104; `t440`/`t441`: 35/56 (website-era variants). **Estimate: 39/39 are near-identical parameterizations.** A single `build-delivery-zip.sh --task T503 [--manifest <file>]` could replace the family; only the manifest blocks carry session-specific information.

**apply_NNNN_live family (80 scripts)** — `apply_0060` vs `apply_0061`: **42 of 54 lines byte-identical**; the 12 differing lines are pure substitutions (migration filename, version string). What they do: read `SUPABASE_ACCESS_TOKEN` from env, `PROJECT_REF` (old ref in 30 scripts; live ref or `${T401_REF:-…}` in 41+), wrap the migration file + `schema_migrations` registration in `BEGIN…COMMIT`, POST to `https://api.supabase.com/v1/projects/$REF/database/query` (later scripts add `-A "curl/8.5.0"` for the Cloudflare User-Agent quirk), then run a post-check query. All migrations 0059–0157 are applied — the family is pure historical boilerplate now; the reusable knowledge (atomic DDL+registration, endpoint quirks) is already codified in AGENTS.md §11.1/§15 and `run_verify_sql_live.sh`.

## 5. Findings on Excel/, deliverables/, .smartexport/, root build-windows.sh

**`Excel/` (12 tracked files, 2.0 MB)** — Mixed input-evidence + one-off analysis, *not* dead weight:
- `2027-2026.xlsx` (558 KB) and `Suivis clients  2026_2027.xlsx` (214 KB): the real owner workbooks; the import-config modules cite them as provenance — `src/infrastructure/excel/import-config/configs/etat-2026-2027.ts:32–33` and `etat-2027-2026.ts:66–67` ("the forensic evidence at the repository root"). No runtime code reads `Excel/` directly; the live import/reimport scripts (`t-420`, `t-425`, `t-433`) did.
- `excel_deep_inspector.py` (34 KB, openpyxl): the one-off "Excel Deep Inspection & Reverse-Engineering Engine" that generated `excel_deep_inspection_report.json` (837 KB) and `.md` (26 KB) — the documented basis of the ADR-017 price matrix and import configs.
- Two oddly-named CSV directories are raw sheet exports of both workbooks; `full_descbrtion.md` is a manual description.
- Verdict: keep the workbooks + inspector + md report (provenance for a production feature); the 837 KB JSON and CSV exports are borderline removable.

**`deliverables/`** — 142 files, **985 MB**, all git-tracked. Contents: 41 `AgentGithubUplaod-TNNN.zip` (41 MB each for the latest), 21 `elimtiyaz-website-*`, 17 `elimtiyaz-android-*`, 26 `all-systems-*`, plus older variants. Each regenerated by its `scripts/tNNN-build-zips.sh`; the historical zips are frozen delivery snapshots. This is the single largest repo-bloat item (985 MB ≫ all source) and was not mentioned anywhere in the report.

**`.smartexport/`** — 2 git-tracked JSONs: `selection-state.json` (profile `default`, 176 of 2,122 files selected; `updatedAt 2026-11-17T12:48Z`) and `selection-state-onlyui.json` (profile `onlyui`, 281 selected; 2026-10-15). This is the SmartExport tool's file-selection state for generating AI-context exports — the mechanism that produced the dumps the 7 Context Reports were written from. Writers: the external SmartExport tool and `scripts/update-selection-state.py` (which defaults to `.smartexport/selection-state-state.json` — a filename that doesn't exist on disk — and whose 80-file dashboard allowlist now has **0/80 overlap** with the default selection and only 68/80 with `onlyui`). Readers: nothing in app code; mentions only in `docs/recovery/*`.

**Root `build-windows.sh` vs `elimtiyaz-desktop/scripts/build-windows.mjs` vs `package.json` `package:win`** — Not duplication; a deliberate 3-layer chain: (1) root `build-windows.sh` (64 lines): Linux-host wrapper — prefers Docker `electronuserland/builder:wine`, falls back to local Wine; runs `npm ci && npm run package:win`; (2) `package.json:26` `"package:win": "node scripts/build-windows.mjs"`; (3) `build-windows.mjs` (398 lines): canonical packaging + validation logic (pins live Supabase URL, artifact checks). Only trivial overlap; each entry point serves a distinct host context.

## 6. Unresolved questions

1. `_entire_project_.txt` provenance — not in the repo; unverifiable.
2. Why the export excluded all 29 `.mjs` + 2 `.mts` files and the `i18n/` subdirectory — extension filter or tool gap?
3. `update-selection-state.py` default state filename (`.smartexport/selection-state-state.json`) vs on-disk files — leftover rename, or intentional third profile?
4. `policy_census.sh` old ref: bug to fix vs "intentional both-project verification convention" (AGENTS.md:110) — owner intent needed.
5. `deliverables/` retention policy — 985 MB of committed zips: still required in git, or move to release storage / git LFS?
6. `eyeball-probe-creds.env` and container-local scripts referenced by AGENTS.md outside the repo — unclear whether container tooling will be re-provisioned.
7. AGENTS.md:132 references `scripts/verify_t-122_mig_tokens.sh` which does not exist — a stale cross-reference in the authoritative doc (independent finding).

**Bottom line:** the Scripts context report is factually excellent — 20+ specific claims verified nearly verbatim, only two minor corrections — but its scope was materially incomplete: it missed the `.mjs`/`i18n` active toolchain, the entire repo-root `scripts/` location (where 11 of 52 scripts are outright broken by dead absolute paths), and the 985 MB `deliverables/` bloat. Its "keep ~12 files" recommendation should be extended to ~20 active files, and the 39 build-zip + 80 apply-live families are the two big consolidation targets.
