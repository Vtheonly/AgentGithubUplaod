# Session 58 — Working delivery and offline verification

Date: 2026-11-28 (Africa/Algiers). Agent: Codex. **Nine tasks delivered, RESOLVED-TESTED.** Production database and packaged/runtime verification remain explicit gaps.

## Scope and baseline

Both repositories were freshly cloned on clean `main`, equal to origin/main before work:

- Hub: `804180a2678ec74d88eda41e074910cb7077fb37`.
- Website: `f93d7642e43c5c17cef7e75022f327dd526eaaa9`.

The current handoff/rules, canonical authority, registries and relevant findings were consulted. Tasks were registered before application edits. Work stayed on current functional defects: no broad 6,450-group deduplication review, branch deletion, history rewrite, production database mutation, credential reset, RLS weakening or package release.

## Delivered tasks

| Task | Problem | Result | Delivery commits |
|---|---|---|---|
| T-628 | BUG-078 / C-25 | Validate nested placement drafts, duplicate identities and year/grade context before restoration. Other contexts remain intact. | `9c05bcd2` |
| T-629 | BUG-079 / C-25 | View-specific layout sessions, stale-read protection, handled reset/save failures and honest local-only French feedback. The full-suite guard regression was corrected forward. | `95b6b568`, `bae11538` |
| T-630 | BUG-080 | PDF and all four revenue Excel sheets use the same inclusive paid-only period population; the multi-service label is readable. | `ed1e7d16` |
| T-631 | BUG-081 / BUG-020 follow-up | Portal excludes cancelled discounts and reversed majorations symmetrically, matching the Desktop reference. | Website `d0bbc69`; hub `e534ac73` |
| T-632 | BUG-073 / T-613 export increment | Shared PDF/XLSX engines, complete pagination, searched record export, error feedback, separate technical sheet, accessible export control and « Voir le détail ». | `66342697`, `fcc28d79` |
| T-633 | TEST-506 | Six existing Website test-fixture TypeScript diagnostics repaired without weakening assertions. | Website `e8cbefe`; hub `eac3f2cf` |
| T-634 | BUG-082 / ADR-037 | New migration 0008 prevents another family’s child being overwritten on a short-code collision; alternate identity is stable on re-import. | `2a4fedad` |
| T-635 | BUG-083 | Preserve local payment-plan due dates across timezones using the existing formatter; money conservation unchanged. | `733d732b` |
| T-636 | TEST-507 | Remove 12 existing lint errors using static imports, obsolete-suppression removal and two const bindings. Rules and warning backlog remain. | `d697a0e8` |

The zero-tolerance workbook/portal gate was strengthened in `f3285e0e`. Every delivery commit was pushed to origin/main without force. All task/problem evidence is in the authoritative registries and change-log.

## Final verification

Desktop final frozen-source battery at `fcc28d79`: **379 files (378 passed / 1 skipped), 6,040 passed / 0 failed / 5 skipped**, 534.49 s. Registered baseline moved from 6,013 to 6,040 (+27) and 376 to 379 files (+3); no assertions or skips removed.

| Gate | Measured result |
|---|---|
| Website full Vitest battery | 62 files / 773 passed / 0 failed |
| Desktop renderer and Electron TypeScript | 0 errors in both programs |
| Website TypeScript | 0 errors |
| Desktop full lint | 0 errors / 1,380 warnings |
| Website full lint | 0 errors |
| Desktop production build | Passed, final Vite build 25.98 s |
| Website strict production build | Passed |
| Migration append-only guard | Passed: 8 current files, 152 historical archived files; no old migration edited |
| Placement neighborhood | 33/33, including 11 new draft-boundary cases |
| Full layout neighborhood | 47/47 across t-448, t-503, t-504 and repository suites |
| Inspector/report + real-data neighborhood | 52/52 across five files; all 2,198 real imported payments render in PDF and exact Excel population |
| Payment-plan timezone + AI neighborhood | 55/55; UTC, Algiers, Kolkata and New York subprocesses |
| Lint-repair neighborhood | 247/247 across nine files, one worker |
| Forced student-code collision matrix | 10/10 twice on fresh offline servers; RED control was 4 failed / 6 passed |
| SQL collision probe | 4/4 under authenticated role, BEGIN/ROLLBACK |
| Backend equivalence on local chain | 282 passed / 38 explicitly app-layer skips / 0 errors |
| Sync round-trip on local chain | 21/21 |
| Desktop and mirror corpus | Desktop 810 valid / 10 invalid-input rejections; mirror 774 valid / 10 rejections / 36 unsupported skips; no new divergence |
| Tier-4 comparison | 784/820 equivalent, 36 explicit skips, 0 discrepancies |
| Sanity/canonical comparison | 820/820; canonical expectations 319/319; 0 discrepancies |

The unified wrapper’s `npx tsx` invocation hit the environment’s Unix-IPC `EPERM`. Its same tools were executed successfully with `node --import tsx`; a green unified-wrapper invocation is **not** claimed.

GitHub’s commit status for Website `d0bbc6991d86fbea061383d762690fe402d1adbd` reports **Vercel success — Deployment has completed**. This is deployment metadata, not a real-parent browser test.

## Real Excel and database proof

No remote Supabase project was contacted. The repository’s offline PGlite 0.5.17 / PostgreSQL 18.7 harness applied the full chain 0001–0008 and exercised real SQL, constraints, triggers and authenticated RLS. This environment has no Docker/Supabase CLI stack; local GoTrue/PostgREST and packaged clients were not exercised.

Each workbook was imported and re-imported independently through the real ImportEngine/RepositoryStorageAdapter and canonical RPC-backed repositories.

| Workbook | Raw named rows | Raw devis | Canonical identity projection = DB | Re-import |
|---|---:|---:|---:|---|
| `Excel/2027-2026.xlsx` | 1,139 | 356,882,800 DZD | **356,222,800 DZD** | 0 new / 1,139 updated / 0 rejected; all business table counts unchanged; no duplicate/RPC failures |
| `Excel/Suivis clients  2026_2027.xlsx` | 390 | 113,503,800 DZD | **113,503,800 DZD** | Business counts unchanged: 253 parents / 390 students / 1,283 ledger rows / 891 payments / 1,966 installments; 0 rejected |

WB2’s **660,000 DZD** raw/projection difference is exactly the two documented first-wins student-identity merges (KHALEF pair and whitespace-variant HEROUA pair), preserved rather than presented as unexplained loss. WB1’s workbook-wide counters also include non-financial configuration sheets; the financial business counts are the idempotency assertion.

WB2 checks now allow **zero** drift. Every mapped source column equals the imported ledger sum:

| Workbook field | Projected amount = DB (DZD) |
|---|---:|
| Devis annuel | 356,222,800 |
| FI | 25,000 |
| V1 (canonical V2) | 108,606,100 |
| 2V | 23,938,500 |
| v3 | 19,999,900 |
| 1T | 8,496,500 |
| T2 | 851,000 |
| t3 | 702,000 |

Three period populations also match local SQL count/sum exactly (2026-07-01..09-30, December 2026, March 2027). Actual XLSX serialization/readback separately proves the filtered summary/detail sheets retain numeric values.

For **25 real imported families**, SQL and Desktop charged/paid/outstanding match exactly; the **executed sibling Website engine** matches Desktop charged/paid/adjusted/outstanding exactly. This proves the calculation layer over real rows. It does not claim both rendered applications were manually operated against a complete local Supabase API stack.

Workbook SHA-256:

- WB2: `b293b22bef41aa3df833d015c09d89021b28b519f324e0a63921553084f479ca`.
- WB1: `9decf3f7e7461b45bdc195dc74c180be8b1a3e897b2497dcb4add921bfc905c7`.

The actual inspector export adapters also rendered **all 2,198 imported payments**: every receipt was found in the PDF, and the Excel detail population and sum matched the resolved real rows exactly. A separate clerk-detail guard proves primary output omits run/UUID support tokens while the technical sheet preserves the raw text.

Full-chain census: 99 tables / 14 views / 5 materialized views / 162 functions / 89 triggers / 242 public policies / 99 RLS-enabled tables / 513 indexes / 226 FKs / 4 sequences; 95 permissions / 186 role-permission rows / 54 system settings. The five RLS helpers retain SECURITY DEFINER and search_path pinning. Migration 0008 changes a function body only, not privileges or policies.

## Discoveries and failed controls retained

- A WB2 run before 0008 measured **355,982,800** versus projected **356,222,800** (240,000 short), while adjacent fresh runs matched. The original ephemeral instance was torn down by its test cleanup. The six-hex identity hash and unsafe foreign-parent code match were then investigated; a forced collision **proved** that the old RPC overwrote another family’s child. The new guard prevents that confirmed mechanism. The historical 240,000 observation is not claimed conclusively attributed or remotely repaired.
- The first full layout battery caught two regressions introduced by using repository-object identity as the load sentinel. A provider may return fresh wrappers. The sentinel is again per view string inside the keyed session; stale-read revision fencing remains. Both original t-504 controls pass in the 47-test neighborhood. Commits and failed evidence were preserved; no assertion was weakened.
- The baseline AI plan date error was real: Oct 10 became Oct 9 on UTC-positive machines. Four isolated timezone tests now pin the calendar dates and exact monetary conservation.
- One highly parallel lint-neighborhood run timed out on a lazy tool import. The same nine suites passed **247/247** with one worker; no timeout was increased.
- Intermediate full runs overlapped source edits and cached earlier component versions. Their red results are diagnostic records, not the final gate. Only the final fresh-process, frozen-source battery is used for the registered count.

## Reproduction commands

From `elimtiyaz-desktop/`:

```bash
npx tsc --noEmit
npx tsc -p electron/tsconfig.json --noEmit
npm run lint
npm run build
npm run check:migrations
npx vitest run --maxWorkers=2 --minWorkers=1
node scripts/schema-test/local-pg.mjs census
npx vitest run src/tests/integration/real-excel-import-local-pg.test.ts
```

The real-workbook suite starts its own offline server on 5435. Keep the Website checkout as a sibling to execute its engine; otherwise the optional portal leg reports NOT RUN explicitly.

Start a fresh local server (e.g. 5433) before the standalone SQL/wire suites, run them **sequentially** under the harness’s single-backend discipline, then stop it:

```bash
LOCAL_PG_PORT=5433 node scripts/schema-test/t634-student-code-collision.mjs
# scripts/verify_t-634.sql is independently BEGIN/ROLLBACK-safe
node --import tsx financial-tests/equivalence/backend/backend_runner.ts --host 127.0.0.1 --port 5433 --user postgres --database postgres
EQ_SKIP_PROVISION=1 EQ_HOST=127.0.0.1 EQ_PORT=5433 node --import tsx financial-tests/equivalence/integration/sync_round_trip.ts
PROBE_TWICE=1 node --import tsx scripts/schema-test/probe-import-parity.mjs 5433 '../Excel/Suivis clients  2026_2027.xlsx'
```

The corpus generator/desktop/mirror/comparators also ran via `node --import tsx`; see the existing unified runner for the exact ordering/flags. Website gates from its own directory: `npx tsc --noEmit`, `npm run lint`, `npm test -- --maxWorkers=2`, `npm run build`.

## Remaining work

1. **Production window:** migrations **0006 + 0007 + 0008** remain unapplied by this session. Inspect actual chain state and preflight assumptions before applying in the authorized OPS-015 window. Do not infer production DB parity from local success or Vercel status. The existing preflight census was historically pinned to the Stage-A baseline; review the observed full-chain axes before the apply window.
2. **Packaged/runtime:** exact packaged Electron checks and live parent/staff browser flows, including both apps’ rendered figures, remain pending. Status stays TESTED, not VERIFIED.
3. **T-637 OPEN / C-25:** placement draft v1 is runtime-validated; tenant/cross-device draft synchronization and its concurrency/write contract remain open. Dashboard fallback wording is complete.
4. **ARCH-054:** legacy permission-vocabulary reconciliation is still a docs-first ADR/per-role-diff task. No default permission matrix was changed here.
5. **T-612/T-587 + T-613 remainder:** year-aware diagnostics, trigger/debt-basis work and the broader overhaul remain open. The export increment is complete; the whole overhaul is not.
6. If another workbook mismatch appears, capture the failing per-identity rows/codes before teardown. Do not relax the zero-tolerance gate or assume a hash collision without evidence.

No credentials were added to Git or persistent remote configuration. Final secret/diff/remote-SHA checks are recorded at closeout.
