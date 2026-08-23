# Cross-Platform Equivalence Test Framework (Live Database)

Multi-layer equivalence testing for the El-Imtiyaz CRM, verifying that **the same
business operation produces the same authoritative result regardless of which
client (Desktop web app / Android mobile app) performs it** — executed against
the **live Supabase database** with isolated test scope.

```
Canonical Input
      |
      +--------------------+
      |                    |
   Desktop              Mobile          (client adapters encode each app's
      |                    |              REAL API-call patterns from source)
      v                    v
 Business Logic       Business Logic
      |                    |
      v                    v
 API / Services       API / Services
      |                    |
      +---------+----------+
                |
                v
        Database State
                |
                v
       Normalized Comparison   (centime-exact, UUID/timestamp-insensitive)
                |
        +-------+-------+
        |               |
     Equivalent      Mismatch
        |               |
      PASS          Investigate
```

## The 11 layers

| # | Layer | What it verifies |
|---|-------|------------------|
| 01 | UI/Input | Equivalent user actions (raw keystrokes: names, phones, French-locale amounts, grades) produce the same canonical inputs on both clients |
| 02 | Validation | Both clients reject the same invalid states (client-side guard set + DB CHECK backstop: negative amounts, bad methods, bad categories) |
| 03 | Business logic | Same canonical operation → same business result: entity creation, status derivation (cash→paid), atomic `collect_and_allocate_payment` equivalence, canonical `compute_parent_summary` |
| 04 | Financial | Balances, payments, totals, adjustments — ledger-replay totals (INV-1), payments-table totals, installment state, **centime drift = 0** between the mobile centimes (`/100.0`) path and the desktop decimal path |
| 05 | Academic | Grade edits, enrollment state, roll-call/GPA RPC contract |
| 06 | CRM/domain | Parent/student profiles, relationships, identity-code formats, phone edits, ledger history completeness |
| 07 | API/service | Semantically equivalent operations: identical return shapes, idempotency contract (`out_was_inserted` true→false), 0037 ref-tolerance (parent-code vs UUID refs resolve to the same entity) |
| 08 | Database | Full normalized deep-compare of rows: FK integrity, source-id uniqueness, derived installment schedules (40/30/30), hidden fields (account_id shape, receipt linkage) |
| 09 | Audit/history | `write_audit_log` round-trips with equivalent payloads, ledger immutability, server-side audit by canonical RPCs |
| 10 | Document | PDF receipt/statement **data contracts**: both renderers consume the same authoritative fields (amount, method, category, status, payer, student, dates) |
| 11 | Sync | Idempotent re-submission (retry semantics), `pull_*_for_sync` round-trip, concurrent desktop+mobile submits converge to one row, ledger source-identity uniqueness |
| 12 | Guard | Real-data isolation: the production corpus is snapshotted before/after and asserted byte-identical |

## Client adapters — fidelity notes

- **DesktopClient** encodes `src/infrastructure/supabase/repositories/supabase-shared-repositories.ts`:
  DZD decimal amounts, UUID parent refs, `manual_entry` provenance, `p_status: null` (engine derives status).
- **MobileClient** encodes `app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt`:
  centimes stored locally → `/100.0` conversion before RPC, parent-code refs when
  the 0037 ref-tolerant contract is deployed (UUID otherwise), `android_sync` provenance.
- Both use the SAME RPC family (`upsert_*_from_import` / `pull_*_for_sync`) the real apps use.

## Canonical input

`lib/canon.mjs` builds a deterministic family scenario (seeded PRNG, mulberry32 —
same generator family as `financial-tests/equivalence`): parent → student →
tuition charge 330,000 DA (40/30/30 tranches) → cash payment 132,000 → partial
payment 40,000 → credit adjustment −5,000 → grade edit 1am→2am → phone edit.
**Canonical VALUES are identical for both scopes**; only entity codes, phones,
emails and display-name scope markers differ (live-DB collision isolation).
The parent upsert's identity chain (code → phone → display_name → email) makes
this isolation mandatory.

## Running

```bash
export SUPABASE_URL=https://<project>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # never commit
node run.mjs                       # full suite, 1 iteration
node run.mjs --iterations 3        # 3 deterministic scenario variants
node run.mjs --layers 04,08,11     # subset
EQUIVALENCE_DRY_RUN=1 node run.mjs # no writes
node run.mjs --out ./report        # report directory (default ./report)
```

Exit code: `0` = equivalent (no failures), `1` = mismatch, `2` = suite error.
Reports: `equivalence_live_report.md` + `.json`.

## Safety (live database)

- All test entities are tagged (`PAR-2026-EQTEST-*`, `ELV-2026-EQTEST-*`,
  `EQTEST-*` source ids, audit action `equivalence.probe`).
- `cleanupAll()` removes every EQTEST row (incl. orphan sweep) before AND after each run.
- Layer 12 asserts the real corpus (258 parents / 389 students / financial
  totals) is unchanged.

## Pre-migration vs post-migration behavior

The suite probes the deployed schema and **adapts**:

| Capability | Pre-0034 DB (current live) | Post-migration (0033–0037 applied) |
|---|---|---|
| Core equivalence (layers 1,2,4–11) | ✅ runs — **94/101 PASS** | ✅ runs |
| `compute_parent_summary` canonical check | SKIPPED (not deployed) | ✅ activates |
| Atomic `collect_and_allocate_payment` | SKIPPED — deployed 0026-era version has a **known ambiguous-column bug (SQL 42702)**, fixed by migration 0034 | ✅ activates |
| Installment schedule (40/30/30) via `upsert_installment_from_import` | SKIPPED (not deployed) | ✅ activates |
| 0037 ref-tolerance + ledger source-identity unique index | SKIPPED | ✅ activates |

**Run this suite again immediately after applying the migration package** — the
7 currently-skipped checks activate automatically and must pass, providing the
before/after equivalence evidence required by the migration validation plan.

## Relationship to the existing harnesses

- `financial-tests/equivalence/` — engine-level equivalence (desktop TS engine vs
  Kotlin mirror, 525 scenarios) — **pure logic, no database**.
- `financial-tests/scenarios/` — YAML DSL business scenarios, run by both apps' unit tests.
- **`financial-tests/equivalence-live/` (this suite)** — LIVE-database,
  API+DB+audit+sync+document layers, cross-client execution paths.

Together they cover the full stack from canonical input to persisted state.
