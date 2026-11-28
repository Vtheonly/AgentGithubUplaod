# Similarity audit — full three-repository scan (2026-11-28)

The first complete run of the `tools/similarity-audit/` engine across **all three repositories together** (desktop + website + Android). Every detector pass completed cleanly; no pass hit the five-minute per-invocation timeout and no source was silently skipped. This folder is the frozen archive of that run. The live, Git-ignored review state (including verdicts recorded later) stays in `tools/similarity-audit/.audit/` per the engine's design — re-running `npm run scan` there regenerates/refreshes these documents.

- `inventory.json` — machine-readable inventory: every candidate group with all file paths, line ranges, detector signals, covered Git revisions, oversized exclusions and per-pass timings.
- `CANDIDATES.md` — the complete candidate inventory in readable form (all 6,450 groups, all spans).
- `REVIEW.md` — the prioritized review queue: the next 25 pending groups (batch 1 of 258 at the default batch size of 25).

## 1. Exact commands executed

From the main repository root (`AgentGithubUplaod`, all three checkouts side-by-side as sibling directories):

```sh
cd tools/similarity-audit
npm ci                                            # pinned deps + patch-package fix, isolated to this folder
npm run scan -- --website ../../../elimtiyaz-website --android ../../../elimtiyaz-android
```

Underlying invocation: `python3 audit.py scan --website ../../../elimtiyaz-website --android ../../../elimtiyaz-android`. A second identical `npm run scan` was executed afterwards to verify the cache path.

## 2. Scanned revisions (Git HEAD, clean trees)

| Repository | Scanned commit (HEAD of `main`) | Working tree |
|---|---|---|
| `Vtheonly/AgentGithubUplaod` (desktop, `elimtiyaz-desktop/`) | `0b9de9449668a8db64e03f78751461dadd5bdcbf` | clean before the tool changes below; the scanner materializes blobs from the committed revision, so the scanned content is exactly this SHA |
| `Vtheonly/elimtiyaz-website` | `f93d7642e43c5c17cef7e75022f327dd526eaaa9` | clean |
| `Vtheonly/elimtiyaz-android` | `9a414b1f133a598d33740e0775f05e8ffd047661` | clean |

`0b9de944` is the commit that introduced `tools/similarity-audit/` (the engine commit referenced by the task). No prior engine `.audit/` review state existed (fresh clone; the directory is Git-ignored), so no previous verdicts had to be carried over. The pre-existing manual register `elimtiyaz-desktop/docs/codebase-audit/MASTER-CONSOLIDATION-CANDIDATE-REGISTER.csv` is untouched by this engine run.

## 3. Scope — scanned vs. excluded

The engine snapshots **committed Git HEAD blobs** of the selected roots, so untracked build outputs (`node_modules/`, `dist/`, Gradle `build/`, etc.) are never part of the snapshot by construction.

Scanned roots (2,017 files, 24.0 MiB — within the 20,000-file / 200 MiB engine limits):

| Repository | Roots scanned | Files |
|---|---|---|
| desktop | `elimtiyaz-desktop/src`, `electron`, `supabase` (migrations + RPCs), `financial-tests`, `scripts` | 1,392 |
| website | `src`, `supabase` (none present at this revision), `scripts` | 178 |
| android | `app/src` | 447 |

Scanned extensions (engine set): `.ts` 844 · `.kt` 448 · `.tsx` 437 · `.sql` 231 · `.mjs` 44 · `.mts` 7 · `.cts` 5 · `.js` 1. Kotlin lives only in the Android repo and the desktop's `financial-tests/equivalence/android/` mirror; SQL only in the desktop's `supabase/` roots. Files over 5 MiB excluded: **0**. Everything under the selected roots with a supported extension was scanned; nothing inside the selected roots was skipped.

Not in scan scope (by the engine's configuration): desktop `docs/`, `public/`, config files, `tools/`, the website/android repositories' non-source roots, and all binary/markdown assets.

## 4. Detector passes and measured runtimes

All seven passes completed; per-pass timings are recorded inside `inventory.json` (`timings`).

| Pass | Runtime | Notes |
|---|---|---|
| snapshot materialization | 0.4 s | `git cat-file --batch` of all 2,017 blobs |
| `ast.cjs` (TypeScript AST exact + structure) | 2.6 s | |
| fallow strict | 1.0 s | 734 clone groups |
| fallow near (`--mode mild --near`) | 1.1 s | 998 clone groups |
| fallow semantic | 1.3 s | 3,162 clone groups |
| jscpd (token matching, min 5 lines / 65 tokens) | 93.6 s | 1,953 duplicate pairs → union-find families |
| cross-language function-name check | 0.6 s | 185 name groups |
| **Total scan (detection + grouping)** | **101.1 s** | wall clock incl. npm wrapper: 1 m 41 s |

Cache re-run verification: a second identical `npm run scan` printed `Source snapshot cache hit; skipped all scanner passes.` and finished in **0.27 s**, reproducing byte-identical `inventory.json`, `CANDIDATES.md` and `REVIEW.md`.

Failed-scan preservation verification: with the cache signature forced to miss and the per-invocation timeout forced to 0.01 s, the first detector (`ast.cjs`) was killed mid-scan; the previously published `inventory.json`, `CANDIDATES.md` and `REVIEW.md` remained **byte-identical** (documents are written only after every pass succeeds, under a SQLite writer transaction).

### jscpd full-scale fix (why this run needed a scanner change)

On the full three-repository snapshot the unpatched jscpd pass exceeded ten minutes (it was killed at 590 s without completing; a single 18,528-line SQL migration took 3 m 56 s alone). Root cause: `@jscpd/tokenizer` 4.0.1 rebuilds its token arrays with `concat`/spread on every token (`groupByFormat`, `tokenize`, `createTokens`) — quadratic per file, dominated by the largest files. Fix: `patches/@jscpd+tokenizer+4.0.1.patch`, applied automatically by `patch-package` on `npm ci`, replaces only the quadratic rebuilds with `push`. Output equivalence was verified byte-identical (after normalizing run timestamps) against pristine jscpd 4.0.5 both on the worst file (32 clones, identical) and on the website+Android subset (382 clones, identical). Post-fix, the worst file runs in 24 s and the whole-snapshot pass in 93.6 s — inside the 300 s engine timeout with headroom. No detection thresholds, modes or file selections were changed.

## 5. Results — the complete candidate inventory

**6,450 candidate groups · 15,171 spans (avg 2.35 spans/group) · 0 verdicts assigned** (this run deliberately records no verdicts: every group needs code reading and caller tracing by the review agent; none were guessed).

### Detector agreement

| Group carries… | Groups |
|---|---|
| 1 detector | 5,489 |
| 2 detectors | 638 |
| 3 detectors | 302 |
| 4 detectors | 20 |
| 5 detectors (ast-exact + ast-structure + fallow-strict + fallow-near + fallow-semantic) | 1 (`362f28446ffd917dcd3067c2`) |

Most frequent single-signal sets: `fallow-semantic` alone 2,891 · `jscpd` alone 1,759 · `fallow-near + fallow-strict` 424 · `ast-structure` alone 323 · `fallow-near + fallow-semantic + fallow-strict` 238 · `cross-language-name` 185 · `ast-exact + ast-structure` 151 · `ast-exact` alone 135.

Groups carrying each detector (a group can carry several): fallow-semantic 3,162 · jscpd 1,837 · fallow-near 998 · fallow-strict 734 · ast-structure 543 · ast-exact 297 · cross-language-name 185.

### Cross-repo vs. intra-repo

| Scope | Groups | Spans |
|---|---|---|
| Intra-desktop | 5,246 | |
| desktop + website | 542 | |
| Intra-android | 323 | |
| Intra-website | 168 | |
| android + desktop | 144 | |
| android + desktop + website | 24 | |
| android + website | 3 | |
| **Cross-repo total** | **713** | 1,775 |
| **Intra-repo total** | **5,737** | |

### By language

Single-language groups: TS 3,655 · TSX 1,503 · SQL 432 · Kotlin 333 · JS 202. Mixed-language groups (exactly the cross-language signal): Kotlin+TS 117 · TS+TSX 114 · Kotlin+TSX 33 · JS+TS 23 · SQL+TS 22 · Kotlin+SQL+TS 5 · Kotlin+TS+TSX 3 · Kotlin+SQL 3 · JS+TS+TSX 2 · SQL+TSX 2 · JS+TSX 1.

### Highest-impact leads (largest families; full detail in `CANDIDATES.md` / `inventory.json`)

- `fefff34360c305b3159802aa` — **41 spans**, fallow-semantic, intra-desktop: repeated list/table-building blocks across `src/features/academics/` (academic-year-detail-drawer, class-detail-page, class-subjects-tab), `src/features/crm/`, `src/features/dashboard/components/analytics/data-inspector-core.tsx` and more — the biggest single consolidation family.
- `ab4e84c7f1219749d96d484f` — **26 spans**, ast-exact (byte-identical function bodies), intra-desktop: the identical test-bootstrap helper duplicated across 26 test files in `src/tests/features/academics/` and `src/tests/features/dashboard/`.
- `4550c6e98fc9f274ce9a1944` — **25 spans**, ast-exact, intra-desktop: another verbatim test-setup family across `src/tests/features/` + `src/tests/infrastructure/`.
- `93a948a859b7aaaabca12b3c` (20 spans) and `f8055d3f3fdd120d07dd01df` (18 spans) — further ast-exact test-helper families.
- `fca0ec14a13796265ee83b4e` — **17 spans**, ast-structure, **desktop+website**: structurally identical test blocks shared across both repositories' test suites.
- `745bcd9d3a36b1e362031fe0` — 12 spans, fallow-semantic, **desktop+website**: type/shape definitions mirrored between `src/` and the website's canonical libs (incl. `shared/particle-engine/types.ts`, `excel/import-config` vs `import-engine` types).
- `07ff4a4c31d754d7bf5514d5` — 9 spans, fallow-semantic, **desktop+website**: `service-pricing-profile.ts` logic mirrored between desktop domain and `website/src/lib/canonical/`.
- `d8f084757541c4497aba5749` — 11 spans, cross-language-name: `WaterfallAllocation` implemented in Kotlin (`android/.../core/WaterfallAllocation.kt`), TypeScript domain (`lifo-reversal.ts`), the desktop's Kotlin-mirror test engine, and **six SQL migrations/RPCs** — a full cross-language financial-engine lead.
- `4b23863fa2c298b0e1b3db27` — 9 spans, cross-language-name: `LedgerEngine` in Kotlin, TS (`ledger/balance.ts`), the mirror engine, four SQL migrations, and the website's canonical `calc/ledger/balance.ts`.
- Batch 1 of the queue (`REVIEW.md`) already surfaces the desktop↔website ports (particle-canvas, debt-aging, overdue, i18n scan scripts) as 4–5-detector groups.

Most-involved files (spans hosted): `supabase-shared-repositories.ts` (340) · `supabase-academic-repository.ts` (240) · `migrations/0001_initial_consolidated_schema.sql` (205) · `financial-tests/equivalence/desktop/desktop_runner.ts` (152) · `mock/repositories/therapy-repository.ts` (142) · `mock/workforce/index.ts` (133).

## 6. How to continue

The next verification agent should start at `tools/similarity-audit/.audit/REVIEW.md` (25 groups per batch, 258 batches in total at the default size) and record verdicts only with code/caller evidence via `npm run review -- GROUP_ID VERDICT --owner … --evidence … --watch …`. No production code was modified by this scan; the only repository changes are the scanner fix/timing instrumentation under `tools/similarity-audit/` and this archived report.
