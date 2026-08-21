# Cross-Platform Financial Engine Equivalence Test Suite

This directory contains a **cross-platform equivalence test harness** that proves the desktop (TypeScript) and Android (Kotlin) financial engines produce **exactly identical results** for the same inputs.

The two engines may be written in different languages and use completely different internal code. That does not matter. If they implement the same business rules, then for the same inputs and the same business scenario, they must produce the **exact same outputs** — verified at centime-level precision.

## Architecture

```
                    Canonical JSON Scenario
                             │
                             ▼
                    Exact Same Input
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
      Desktop Runner                 Android Runner
      (TypeScript / tsx)             (Kotlin / JUnit)
              │                             │
              ▼                             ▼
      results/desktop/*.json         results/android/*.json
              │                             │
              └──────────────┬──────────────┘
                             ▼
                       Comparator
                  (deep JSON diff,
                centime-level precision,
              normalizes only dates &
                  key ordering)
                             │
                ┌────────────┴────────────┐
                ▼                         ▼
              PASS                      FAIL
                │                         │
                ▼                         ▼
       Reports equivalence         Saves discrepancy
       rate as evidence            as permanent regression
                                     test case
```

## Directory Layout

```
equivalence/
├── README.md                          # this file
├── schema/
│   └── scenario.schema.json          # JSON Schema for the canonical scenario format
├── scenarios/                        # 25 hand-crafted canonical scenarios
│   ├── 001_simple_payment.json
│   ├── 002_full_payment.json
│   ├── ... (boundary, discount, reconcile, etc.)
│   └── 025_parent_summary_multi_account.json
├── generated/                        # 500+ property-based generated scenarios (gitignored)
├── desktop/
│   └── desktop_runner.ts              # TypeScript runner — reads scenarios, runs desktop engine, writes results
├── android/
│   └── AndroidEquivalenceRunner.kt    # Kotlin runner — reads scenarios, runs Android engine, writes results
├── comparison/
│   └── comparator.ts                  # compares desktop vs android results, writes reports + regression files
├── generators/
│   └── scenario_generator.ts          # generates N scenarios with a deterministic seed
├── results/
│   ├── desktop/                       # desktop runner output (gitignored)
│   └── android/                       # android runner output (gitignored)
├── regression/                        # saved discrepancies as permanent test cases (committed)
├── reports/                           # generated equivalence reports (gitignored)
└── scripts/                           # convenience shell scripts
    ├── run_desktop.sh
    ├── run_android.sh
    ├── run_comparison.sh
    └── run_all.sh
```

## How to Run

### Full pipeline (run all three stages)

```bash
cd financial-tests/equivalence

# 1. Generate scenarios (500 with seed 42; deterministic — same seed = same scenarios)
./scripts/run_all.sh
```

This runs:
1. **Generator** → produces `generated/*.json` (500 scenarios)
2. **Desktop runner** → runs all 525 scenarios (25 hand-crafted + 500 generated), writes `results/desktop/*.json`
3. **Android runner** → user runs separately (see below)
4. **Comparator** → compares both result sets, writes `reports/equivalence_report_<timestamp>.md`

### Desktop side only (executable now)

```bash
cd financial-tests/equivalence

# Generate scenarios
npx tsx generators/scenario_generator.ts --count=500 --seed=42

# Run desktop engine on all scenarios (hand-crafted + generated)
npx tsx desktop/desktop_runner.ts --generated

# (Results written to results/desktop/)
```

### Android side (run in Android Studio or via gradle)

The Android runner is at:
- `financial-tests/equivalence/android/AndroidEquivalenceRunner.kt` (canonical copy)
- `app/src/test/java/com/example/equivalence/AndroidEquivalenceRunner.kt` (test source tree copy)

Run it via:

```bash
cd /path/to/elimtiyaz-android

# Option A: as a JUnit test (the runner has a `main()` entry point)
./gradlew :app:testDebugUnitTest --tests '*AndroidEquivalenceRunner*'

# Option B: as a standalone main() (requires the scenarios dir as input)
./gradlew :app:runEquivalenceRunner --args='financial-tests/equivalence/scenarios financial-tests/equivalence/results/android'

# Option C: run with generated scenarios too
./gradlew :app:runEquivalenceRunner --args='financial-tests/equivalence/generated financial-tests/equivalence/results/android'
```

The Android runner writes results to `results/android/<scenario_id>.json` — the same format as the desktop runner.

### Comparator (after both sides have run)

```bash
cd financial-tests/equivalence

# Run the comparator — reads results/desktop/ and results/android/, writes report
npx tsx comparison/comparator.ts

# Strict mode (treat warnings as errors)
npx tsx comparison/comparator.ts --strict
```

## What the Comparator Verifies

For each scenario present in **both** `results/desktop/` and `results/android/`:

1. **Cross-platform equivalence**: deep-compares the complete `result` object, field-by-field, at centime-level precision. A 1-centime difference is a discrepancy.

2. **Canonical expected match** (if the scenario defines a `then` block): verifies that BOTH the desktop and android results match the canonical expected values. This catches cases where both engines agree but both are wrong.

3. **Discrepancy persistence**: every discrepancy is saved as a permanent regression test case in `regression/<scenario_id>__<timestamp>.json` with full context (input, desktop output, android output, expected, delta, likely cause, status). These files are committed to the repo so the discrepancy becomes a permanent regression test after it's fixed.

4. **Category breakdown**: groups results by category (waterfall, overpayment, lifo_reversal, discount_engine, reconcile, boundary, etc.) so you can see which areas have the most divergence.

## Normalization Rules

The comparator normalizes **only** representational differences:

- **Date strings**: parsed as ISO-8601 instants and compared by epoch-millis. Desktop uses `Date.toISOString()` ("2026-09-15T00:00:00.000Z"), Android uses `OffsetDateTime.toString()` ("2026-09-15T00:00+00:00"). Both represent the same instant — they are treated as equal.

- **Object key ordering**: ignored. JSON objects are compared field-by-field.

The comparator does **NOT** normalize:

- **Centime values**: compared exactly. A 1-centime difference IS a discrepancy.
- **Status codes**: compared verbatim. Both engines use the same wire codes.
- **Violation codes**: compared verbatim.
- **Array ordering** (for installments, accounts, ledger entries): both engines must produce the same canonical order.

## Scenario Categories

| Category | Description | Count |
|---|---|---|
| `waterfall` | Payment allocation via chronological waterfall | 129 |
| `lifo_reversal` | Refund via LIFO reversal (cleared + pending branches) | 128 |
| `discount_engine` | 5-rule discount evaluation (single pass on gross) | 68 |
| `boundary` | Zero, 1-centime, exact-match, ±1 boundary cases | 66 |
| `reconcile` | All 6 reconciler cross-checks | 65 |
| `overpayment` | Overpayment → parent_credit account | 64 |
| `complex_sequence` | Multi-operation sequences (pay → refund → repay) | 1+ |
| `sync_round_trip` | Sync direction-neutrality (desktop → android → desktop) | 1+ |
| `idempotency` | Repeated operations | 1+ |
| `balance` | Account balance computation with reversals | 1+ |
| `parent_summary` | Multi-account parent summary rollup | 1+ |

## Property-Based Generation

The generator (`generators/scenario_generator.ts`) uses a seeded PRNG (mulberry32) so the same seed produces the same scenarios on every run — across both platforms.

```bash
# Generate 1000 scenarios with seed 42
npx tsx generators/scenario_generator.ts --count=1000 --seed=42

# Generate 500 boundary-heavy scenarios
npx tsx generators/scenario_generator.ts --count=500 --seed=98765 --boundary
```

The generator covers 8 categories in round-robin: payment, overpayment, refund_cleared, refund_pending, discount, reconcile, boundary, multi_tranche. Each category uses random combinations of:
- `amountDue` (from boundary values: 0, 1, 100, max-1, max, max+1)
- `paymentAmount` (varied around amountDue)
- `method` (cash, check, transfer)
- `status` (paid, pending)
- `category` (tuition, transport, canteen, uniform)
- `originalWasPending` (true, false) for refunds
- Discount params (previousGradeLevel, childIndex, paymentPlan, previousRank, enrollmentDate)

## Latest Report

After running both sides + comparator, see `reports/equivalence_report_<timestamp>.md` for the latest results. The report includes:

- Executive summary (equivalence rate, scenario counts)
- Per-category breakdown
- Detailed discrepancy tables (path, desktop value, android value, delta)
- Final conclusion with evidence

## Regression Cases

Every discrepancy is saved as a permanent regression test in `regression/`. The file format:

```json
{
  "scenarioId": "003_overpayment_creates_parent_credit",
  "category": "overpayment",
  "operationType": "allocatePayment",
  "discoveredAt": "2026-08-20T...",
  "discrepancies": [
    {
      "path": "result.totalPaid",
      "desktopValue": 10000000,
      "androidValue": 15000000,
      "delta": -5000000
    }
  ],
  "desktopStatus": "pass",
  "androidStatus": "pass",
  "canonicalExpectedMet": false,
  "durationMs": { "desktop": 0, "android": 1 },
  "status": "DISCOVERED"
}
```

After the discrepancy is fixed, change `status` to `"FIXED"` and keep the file as a permanent regression test — the comparator will re-verify on every run.

## Current Status

- **Desktop side**: fully working, 525/525 scenarios pass
- **Android runner**: source code provided, ready to run via gradle
- **Comparator**: fully working
- **Generator**: fully working, generates 500+ scenarios with deterministic seeds
- **Latest desktop-only sanity check** (comparing desktop results against a copy of themselves): **100.00% equivalence, 0 discrepancies**

To get the full cross-platform verification:
1. Run the Android side via gradle (instructions above)
2. Run the comparator
3. View the report

The comparator will then produce the final evidence-based statement:

> For the tested domain of valid business operations and inputs (N scenarios), the desktop and Android implementations produce **exactly equivalent financial and business results**.
