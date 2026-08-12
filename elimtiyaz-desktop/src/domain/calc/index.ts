/**
 * Centralized calculation engine — single source of truth for all
 * math/calculation logic in the platform.
 *
 * Architecture:
 *   - `shared/`     — Money + date utilities (no domain dependencies)
 *   - `ledger/`     — Account ID derivation, balance computation, entry
 *                     factories, charge builders, overdue helpers
 *   - `payment/`    — Payment/installment sums, overdue, aging, revenue
 *   - `pricing/`    — Tuition/transport/discount lookups + tranche schedules
 *   - `reconcile/`  — Ledger integrity checks + cross-entity validation
 *
 * Principles:
 *   1. Every function is PURE — no IO, no React, no side effects.
 *   2. Behavior is PRESERVED VERBATIM from the pre-refactor implementation.
 *      Tests verify exact output equality before/after extraction.
 *   3. Each file has ONE responsibility and stays under 200 lines.
 *   4. Dependencies flow ONE direction: shared → pricing → ledger → payment → reconcile.
 *
 * Public API: `import { computeAccountBalance, applyDiscount, ... } from "@/domain/calc"`
 */
export * from "./shared";
export * from "./ledger";
export * from "./payment";
export * from "./pricing";
export * from "./reconcile";
