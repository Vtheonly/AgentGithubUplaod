# T-285 — Live-Database Equivalence Verification (44th session, 2026-09-11)

> PARITY-002 / T-285 leg (c): the owner's mandate — "an equivalent-data test … verifies all statistics and class-related data against the database … every numerical value identical across desktop and mobile."

## What was run

**The Android-side harness** (`elimtiyaz-android/app/src/test/java/com/example/equivalence/LiveDatabaseEquivalenceTest.kt`, JVM JUnit):

1. Pulls the RAW rows from the live Supabase PostgREST API with the service key (paginated, `order=id.asc` + `Range`):
   - `payments?status=eq.paid` → 891 rows (amount/method/status/category/collected_at)
   - `installments` (all) → 1 276 rows (amount_due/amount_paid/amount_pending/due_date/status/parent_id)
   - `classes` (count)
   - The DZD→centimes ×100 boundary mirrors `PaymentDto.toEntity()` (the production pull mapper).
2. Runs the production `core/StatisticsEngine.kt` over those rows — the exact code the Android dashboard renders.
3. Runs the canonical truth SQL **server-side** (the same statement as `scripts/verify_t-285.sql`) via the Management API SQL endpoint with the access token, and asserts value-by-value equality.

Command (credentials via env; the build script forwards them to the forked test JVM — `-D` flags do NOT cross the Gradle daemon boundary, discovery recorded in the Android AGENTS.md §8):

```
SUPABASE_URL=… SUPABASE_SERVICE_KEY=… SUPABASE_ACCESS_TOKEN=… \
  ./gradlew :app:testDebugUnitTest --tests "com.example.equivalence.LiveDatabaseEquivalenceTest"
```

**Result: 1 test, 0 failures, 0 errors, 0 skipped.** (Without the env, the test SKIPS by assumption — a skip is never live evidence.)

## The verified values (engine output == database truth, 2026-09-11)

| Statistic | DB truth | Engine | Match |
|---|---|---|---|
| Paid operations (count) | 891 | 891 | ✓ |
| Total encaissé | 5 522 710 000 centimes (55 227 100 DZD) | same | ✓ |
| Panier moyen (mean) | 6 198 300 (61 983 DZD) | same | ✓ |
| Médiane | 6 100 000 (61 000 DZD) | same | ✓ |
| Volatilité σ (sample, ÷(n−1)) | 4 495 100 (44 951 DZD) | same | ✓ |
| Min / Max | 200 000 / 32 650 000 | same | ✓ |
| Meilleur mois | Aug → FR "Août", 5 522 710 000 | same | ✓ |
| Bin 0–5k / 5k–10k / 10k–20k / 20k–50k / 50k+ | 3 / 2 / 63 / 341 / 482 | same | ✓ (50k+ dominant = 54%) |
| Category mix | tuition 785 ops / 5 316 310 000 / 96%; transport 106 ops / 206 400 000 / 4% | same | ✓ |
| Aging census 91–180 j | 2 691 975 000 / 196 familles | same | ✓ |
| Aging census 180+ j | 3 143 595 000 / 183 familles | same | ✓ |
| Funnel "En retard" total | Σ bucket counts = 379 | 379 | ✓ (census semantics) |
| Créances ouvertes (outstanding) | 5 835 570 000 (58 355 700 DZD) | same | ✓ |
| En retard (overdue) | 5 835 570 000 | same | ✓ |
| Taux de recouvrement | 55 227 100 / (55 227 100 + 58 355 700) = 48.62 → **49%** | 49 | ✓ |
| Classes | 24 | 24 | ✓ |
| Attendance today | NULL (no roll call that day — honest state) | n/a | ✓ (nullable contract) |

## The corpus leg (b) — desktop ≡ android centime-exact

- New canonical op `deriveAnalyticsStats` (pinned `when.now`) implemented in BOTH `financial-tests/equivalence/desktop/desktop_runner.ts` (via `analytics_bridge.ts` → the production `analytics-derivations.ts` + the verbatim funnel/collection-rate extractions) and both `AndroidEquivalenceRunner.kt` copies (hub + android repo) via `core/StatisticsEngine`.
- 3 new scenarios (`analytics_descriptive_stats_and_mixes`, `analytics_debt_aging_census_and_funnel`, `analytics_empty_honest_states`); schema extended (category `analytics_statistics`, operation + `when.now`).
- Comparator: **category `analytics_statistics` 3/3 EQUIVALENT, 0 discrepancies.**
- Full-corpus context: 303/307 — the 4 non-equivalent scenarios (017/023/024/025) were proven PRE-EXISTING by re-running the comparator on the stashed (unmodified) runners: identical 303/307, same 4. They are old corpus display-quirks (NaN-vs-NaN, null-vs-empty studentId, undefined totalRefunded/totalCleared/totalPending) in operations this session never touched.

## The engine leg (a) — desktop-fixture pins

`StatisticsEngineTest` (24 tests): every derivation pinned against the desktop's own `analytics-visuals.test.tsx` fixtures (×100 centimes), plus two traps discovered and pinned forever:

1. **DZD-granularity rounding**: money-valued roundings (mean, even median, σ, MA3) round at DZD precision (`dzRound = round(x/100)*100`) because the DESKTOP rounds its integer-DZD numbers — centime-granularity rounding silently diverges (MA3 of 46k+20k+40k DZD: desktop 35 333, centime-round 35 333.33).
2. **Funnel census semantics**: stage counts are the Σ of bucket family-counts (379 = 196 + 183; families counted once PER BUCKET), NOT the distinct-parent count (196), NOT a per-family worst-bucket assignment.

## Reproduction

- SQL truth alone: `scripts/verify_t-285.sql` (BEGIN/ROLLBACK, temp table `t285_truth`) — via the Management API SQL endpoint (curl-like User-Agent required — quirk #9) or `supabase db query --linked < scripts/verify_t-285.sql`.
- Full live test: the env-gated gradle command above.
- Corpus: `npx tsx financial-tests/equivalence/desktop/desktop_runner.ts` + the Android `AndroidEquivalenceTest` + `npx tsx financial-tests/equivalence/comparison/comparator.ts`.

## Boundary conditions (honest limits)

- The aging census compares engine-`now` (test JVM) vs SQL `now()` — a same-second bucket boundary could theoretically flip ONE installment; the 44th-session corpus sits 91+ days deep in 91_180/180_plus, so the risk is nil for this data and the tolerance is documented.
- The test's final block pins the 44th-session snapshot values (891 / 55 227 100 / 49%) as regression SENTINELS — they will legitimately move as the school collects more; updating them is a one-line doc change, not a defect.
- The live run used the owner-supplied service key + access token from the session (never persisted in any repo — env-only, AGENTS.md §15.12).
