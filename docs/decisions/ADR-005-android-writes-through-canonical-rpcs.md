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

## Amendment (2026-09-01, T-034/CROSS-104b) — shared sync_queue audit-trail semantics

Status: DEFINED here so both platforms converge; the Android implementation itself stays with ADR-005's phased rollout (T-059 umbrella).

When Android pushes a queued mutation online, it MUST persist a server-side `sync_queue` row with the same semantics the desktop's `defaultPushHandler` already exhibits (sync-provider.tsx:92-103, migration 0027's design):

| Field | Semantics (both platforms) |
|---|---|
| `entity_kind` | the canonical entity family pushed (payment, parent, student, …) |
| `payload` | the pushed payload AS SENT (JSONB) — the audit question is "what did the client claim", answered by the canonical ledger/RPC audit entries, not by duplicating them here |
| `status` | `synced` on 2xx, `failed` on 4xx/5xx (never silently dropped — see SYNC-103/T-020's requeue policy for transient classes) |
| `attempts` / `last_error` | increment per retry; last error message verbatim |
| actor identity | the signed-in user's id resolved server-side from the JWT (never trusted from payload) |

Non-goals: the `sync_queue` table is NOT a second ledger and MUST NOT be consumed as business data by any read surface (it is an audit/diagnostic trail only — mixing it with business data would recreate a DUP-class problem). Row retention follows the server's normal data policies; no client deletes another client's rows.

This closes the DEFINITIONAL half of CROSS-104b; its Android implementation task remains inside T-059's phase plan.
