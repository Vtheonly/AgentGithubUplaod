# Cross-Platform Equivalence Test Report (Live)

**Generated**: 2026-08-23T22:57:31.741Z
**Database**: hkvkefubghbbotgnteir.supabase.co (tenant 00000000-0000-0000-0000-000000000001)
**Migration state**: 0037-applied (canonical surface deployed)
**Verdict**: ✅ EQUIVALENT — all executed checks passed

| Total | PASS | FAIL | SKIPPED |
|---|---|---|---|
| 103 | 102 | 0 | 1 |

## Layer results

| Layer | Checks | PASS | FAIL | SKIPPED |
|---|---|---|---|---|
| 01-ui-input | 18 | 18 | 0 | 0 |
| 02-validation | 9 | 9 | 0 | 0 |
| 03-business-logic | 19 | 19 | 0 | 0 |
| 04-financial | 16 | 16 | 0 | 0 |
| 05-academic | 4 | 3 | 0 | 1 |
| 06-crm | 8 | 8 | 0 | 0 |
| 07-api | 4 | 4 | 0 | 0 |
| 08-database | 10 | 10 | 0 | 0 |
| 09-audit | 5 | 5 | 0 | 0 |
| 10-document | 4 | 4 | 0 | 0 |
| 11-sync | 5 | 5 | 0 | 0 |
| 12-guard | 1 | 1 | 0 | 0 |

## Skipped (with reasons)

- **[05-academic] record_roll_call responds identically for both scopes** — RPC exists but call signature differs (class/session-based) — attendance equivalence covered by desktop↔engine parity tests
