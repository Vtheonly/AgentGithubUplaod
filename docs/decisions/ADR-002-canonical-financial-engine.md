# ADR-002 — The canonical financial engine is the server-side SQL RPC set; the desktop TS engine is the reference mirror

## Status

Accepted (2026-08-29)

## Context

The financial engine exists in multiple implementations: SQL functions (created/dropped across migrations 0022–0043), the desktop TypeScript engine (`src/domain/calc/`), the Android Kotlin engine (`core/LedgerEngine.kt`), a TS port of the Kotlin engine used by tests (two drifted copies — DUP-002), and a website port (`src/lib/canonical/`). Migrations 0034–0043 exist precisely because five divergent SQL implementations once coexisted (REG-001).

## Problem

With no declared authority, each platform drifts: the desktop silently falls back to a non-atomic upsert (BUSINESS-002), Android bypasses the atomic RPCs entirely (CROSS-005), and three "overdue" rules disagreed until migration 0042 aligned SQL with the desktop (DRIFT-006).

## Decision

1. **Server-side SQL RPCs are the canonical writers** for financial mutations: `collect_and_allocate_payment`, `revert_payment_allocation`, `mark_payment_cleared`, `mark_payment_bounced`. All clients must write through them (no client-side substitutes, no silent fallbacks).
2. **The desktop TypeScript engine is the executable reference specification** for read-side computation (balances, overdue, waterfall preview, reconciliation) — the implementation the SQL and Kotlin mirrors are verified against.
3. Android's Kotlin engine and the website port are **mirrors**: they must remain equivalent to the reference, enforced by the cross-platform equivalence suites, and must never diverge "for platform reasons" without an ADR.

## Alternatives

- Desktop engine as overall authority — rejected: clients shipping their own write logic is exactly what produced the current divergences; only the server can enforce atomicity and audit invariants for all clients.
- Kotlin engine as authority — rejected: the desktop engine is the most complete and is the one the equivalence corpus already validates against.

## Consequences

- Any change to financial behaviour starts in the SQL RPC + the desktop engine together, then propagates to the mirrors with equivalence runs.
- Client-side "shadow" write paths (fallback upserts, local-only refunds) are defects by definition, even when they appear to work.
- The `upsert_*_from_import` RPCs remain import/sync-only helpers, never substitutes for the canonical writers.

## Affected Components

SQL RPCs (0040/0041), desktop `src/domain/calc/` + `SupabasePaymentRepository`, Android `LedgerEngine` + `LocalPaymentRepository`, website `src/lib/canonical/`, equivalence suites.

## Related Problems

BUSINESS-002, BUSINESS-003, CROSS-005 (absorbs CROSS-006), ARCH-003, DRIFT-006, DUP-002, SEC-111, SEC-112

## Related Tasks

T-011, T-014, T-017, T-026, T-059

## Verification

Equivalence suites compare SQL, desktop, Kotlin-mirror and website outputs over the shared scenario corpus; no scenario may pass with platform-specific normalization that hides a semantic difference (see docs/testing/cross-platform.md).
