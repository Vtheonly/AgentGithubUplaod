# ADR-005 — TARGET: Android writes through the canonical RPCs; Room becomes the offline cache, not an alternative write engine

## Status

Proposed (2026-08-29) — **target state only; NOT the current implementation.** Blocked by UNKNOWN-002 (owner confirmation). Do not begin implementation until this ADR moves to Accepted.

## Context

Android is offline-first: every repository binds to `Local*Repository` (Room is the primary store), and writes propagate later through `SyncQueueDispatcher` → `upsert_*_from_import` RPCs. The canonical financial RPCs (`collect_and_allocate_payment`, `revert_payment_allocation`, …) are never called from Android (ARCH-003). Meanwhile the desktop calls them directly, and its own "fallback to import-upsert" pattern is registered as a Critical defect (BUSINESS-002) because the import path writes less state (no ledger, no waterfall, no audit).

## Problem

Android's only server write path is the path the rest of the system classifies as a silent-corruption defect. This produces: server-side installments stale after refunds (CROSS-103), refund reasons lost (CROSS-102), non-idempotent refunds (BUSINESS-102), client-minted receipt numbers (DRIFT-011), and zero server-side RBAC/audit on Android writes.

## Decision (proposed)

1. When online, Android mutations call the **canonical RPCs** directly (same as desktop).
2. When offline, mutations are stored in a durable local queue (Room) and, on replay, call the **same canonical RPCs** — never `upsert_*_from_import` for financial entities.
3. Room remains the offline read cache and the queue store; it stops being an independent financial write engine. The local Kotlin engine remains for optimistic UI previews only, verified equivalent by the suites.
4. `upsert_*_from_import` remains exclusively for the desktop Excel import bridge.
5. The two parallel Room entity layers are consolidated to one (resolves DUP-005's "which layer survives").

## Alternatives

- Keep Room-first + import upserts and "fix" the import RPCs to parity — rejected: duplicates the canonical engine a third time server-side and permanently splits the audit/waterfall semantics between paths.
- Online-only Android (no offline writes) — rejected: breaks the product's offline-first requirement.

## Consequences

- Android gets server-side validation, RBAC, audit and receipt numbering for every write.
- Sync replay becomes idempotent-by-construction (canonical RPCs guard terminal states).
- Requires: sync error surfacing (CROSS-200 fix), 5xx requeue policy (SYNC-103), provisional receipt UX, and migration of the sync dispatcher — a substantial, phased change (T-059).

## Affected Components

Android `RepositoryModule`, `Local*Repository` write paths, `SyncSupport`, `SyncQueueDispatcher`, `PullSyncRepository`; server canonical RPCs; equivalence suites.

## Related Problems

ARCH-003, CROSS-005, DUP-005, BUSINESS-102, CROSS-102, CROSS-103, DRIFT-011, SEC-111

## Related Tasks

T-059 (umbrella), T-017, T-019, T-020, T-045

## Verification

Per phase: equivalence suites pass for Android-collected payments (ledger/waterfall/audit/receipt parity with desktop-collected ones); offline→online replay produces identical server state to online collection; no `upsert_payment_from_import` call sites remain in Android production code.
