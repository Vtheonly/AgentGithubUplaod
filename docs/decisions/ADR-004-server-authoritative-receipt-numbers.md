# ADR-004 — Receipt numbers are server-authoritative and sequential

## Status

Accepted (2026-08-29)

## Context

Receipt numbers must be auditable: an auditor should be able to verify that `REC-2026-000123` was the 123rd receipt of 2026 for the tenant. Today five algorithms coexist: the canonical RPC's `REC-YYYY-NNNNNN` (sequential, server-side, migration 0040), the desktop fallback's `PAY-YYYY-random`, the desktop bulk-import's `PAY-<timestamp>-random`, Android's per-device `REC-YYYY-count+1`, and the Android dispatcher's random fallback.

## Problem

Non-sequential, client-generated numbers collide across devices (the server's unique constraint then rejects legitimate payments), cannot be audited in order, and make tax-style sequential receipt reporting impossible (DRIFT-011).

## Decision

The ONLY receipt-number generator is the server-side sequential algorithm inside `collect_and_allocate_payment` (`MAX(6-digit suffix)+1` per tenant+year, zero-padded `REC-YYYY-NNNNNN`). Clients never mint receipt numbers; import paths that cannot call the canonical RPC must obtain numbers from a server-side generator, not invent them.

## Alternatives

- UUID receipt ids — rejected: loses human-auditable sequence.
- Per-device ranges — rejected: operational complexity and no cross-device auditability.

## Consequences

- All four client-side generation paths are removed as part of T-015.
- Offline Android collections cannot know their final receipt number until sync; the UI must display a provisional local reference and the server-assigned number after sync (design note for ADR-005 implementation).

## Affected Components

SQL `collect_and_allocate_payment` (0040); desktop `SupabasePaymentRepository.collect/bulkCollect` fallbacks and `sync-provider` fallback; Android `LocalPaymentRepository.collect`, `SyncQueueDispatcher`.

## Related Problems

DRIFT-011 (absorbs BUSINESS-006, BUSINESS-105), CROSS-101

## Related Tasks

T-015, T-066

## Verification

Integration test: N concurrent collections across simulated desktop/Android clients produce N consecutive, unique `REC-YYYY-NNNNNN` numbers with no collisions; grep finds no client-side receipt-number formatting outside the canonical server path.
