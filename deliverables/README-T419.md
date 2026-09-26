# T-419 Delivery — the issue-#22 unified testing architecture (2026-09-27, the 103rd session)

## The mandate

The owner's GitHub issue #22: **"Unify, Audit, and Preserve All Existing Test Suites"** — take the three independently-evolved test systems, recover everything valuable, and consolidate them into one clean, unified, structured testing framework with a single execution flow, without rewriting or deleting existing work.

## What was delivered (the six verified phases)

| Phase | Commit | What |
|---|---|---|
| 0+1 | `49a1537` | The charter: ADR-029 + T-419 + TEST-307/308/309 + the pre-change baseline evidence (`docs/recovery/t-419-test-unification-baseline.md`) |
| 2 | `cf507a9` | The root unification: `src/test/` (12 files, the second Vitest root) absorbed into `src/tests/` — a depth-preserving `git mv`; the failing set stayed byte-identical |
| 3 | `0c16713` | The comparator audit: TEST-308 fixed (the error-expectation contract + the NaN guard + the stale scenario-017 `then` corrected); the tier-4 comparator's crash repaired; **PARITY-005 registered** (the CALC-001 mirror drift — the session's discovery) |
| 4 | `9de7834` | The unified runner: `npm test` = Layer 0 typecheck + Layer 1 the full Vitest suite + Layer 2 the equivalence pipeline + Layer 3 the environment-gated census; baseline-deviation detection (`scripts/test-baseline.json`) |
| 5 | `b4e3ab8` | `docs/testing/unified-architecture.md` — the layer map + the complete migration manifest (every artifact accounted) + the correctness-audit record + the fakes census |
| 6 | `2803043` | The closeout: the registries truth-synced, the change-log/current-state/next-task records, AGENTS.md §15.60 |

## The one command

```
cd elimtiyaz-desktop && npm test
```

Runs every layer of the ONE framework and prints the unified summary: the Vitest totals + the BASELINE-MATCHED/DEVIATION verdict, the equivalence pipeline (desktop runner, mirror runner, the tier-4 comparison, the sanity/canonical gate), and the environment-gated census (real Kotlin / backend / live-E2E) with explicit reasons — never a silent skip. The full report lands in `test-reports/unified-report_<ts>.md`. The fast inner loop: `npm run test:vitest`.

## The verification evidence (the gates every phase re-ran)

- **TypeScript**: `tsc --noEmit` → **0 errors** (every phase).
- **The full Vitest suite**: 224 files / 4 175 tests → **4 145 passed / 25 failed / 5 skipped — the failing set byte-identical to the documented pre-existing baseline through every phase** (no coverage lost, no new failures; the unified runner now verifies this by name on every run: `BASELINE-MATCHED`).
- **The equivalence pipeline**: desktop runner 809/0/10 (the 10 = the zero-payment error-equivalence family, by design); the sanity comparator **819/819 with canonical expected 318/318 and 0 false regression artifacts** (was 818/819 + 317/318 + one false artifact per run — TEST-308); the mirror runner 784/0/0 with 35 REPORTED skips; the tier-4 comparison **completes and reports for the first time in recorded history**.
- **The negative test** (the harness-must-fail discipline): a tampered error message IS flagged as the single `canonical.error` discrepancy.
- **The website**: 657/657 tests green (unchanged by this task; included in the combined zip).
- **The live infrastructure smoke** (2026-09-27, read-only, the owner's credentials via env injection): chain head **0121** (118 applied) · auth health **200** (GoTrue v2.197.0) · RLS **enforcing** (anon → `[]`) · censuses 742 parents / 1 137 students / 14 personnel / 5 classes · **15 Edge Functions ACTIVE**.

## The session's discovery — PARITY-005 (registered, OPEN)

The tier-4 comparator had NEVER been run (one junk-era commit; its report writer crashed on undefined values). Its first completed run exposed: **the Kotlin mirror engine still applies the CALC-001-REMOVED fictional discount rules** (passage_palier ×94, sibling-fixed divergence ×76, seniority_5y ×62, highest_average ×34, full_annual ×12 — 77 scenarios / 499 rows / 112 ERROR-level) **and accepts zero-amount payments that the desktop engine and the SQL RPC both reject** (10 error-vs-success rows). The desktop side is canonical (post-CALC-001 + the corpus's corrected expectations); the mirror — and, suspected, the real Android `DiscountEngine.kt` — is the stale side. The repair is the registered follow-up (`docs/recovery/problem-registry.md` PARITY-005); until it closes, the tier-4 comparison runs REPORTED (non-gating) in the unified summary — visible every run, never hidden.

Also open: **TEST-309** (the 24-file Supabase-fakes consolidation queue — the census + the suite-by-suite pattern are documented in `docs/testing/unified-architecture.md` §4).

## The zips

| File | Contents | Size |
|---|---|---|
| `AgentGithubUplaod-T419.zip` | the hub repo (the desktop app + the canonical backend + the documentation system + the unified test system) at the delivery commit | 7.5 MB |
| `elimtiyaz-website-T419.zip` | the parent web portal repo at its main tip (5c530b6, 657/657 green) | 708 KB |
| `elimtiyaz-all-systems-T419.zip` | both systems under `all-systems-T419/` | 8.3 MB |

Excluded everywhere: `.git` (history lives on GitHub), `node_modules` (an empty placeholder marks the convention — run `npm ci` after extraction), build outputs, runner result/report artifacts (regenerated deterministically by `npm test`), and every `.env` class of file (no secrets in archives — the §15.12 discipline).

## To run after extraction

```
cd elimtiyaz-desktop && npm ci
npm test          # the ONE authoritative command — the unified summary
```
