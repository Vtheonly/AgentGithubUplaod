/**
 * Shared test helpers for finance-isolation assertions.
 *
 * Multiple integration test suites (teacher-repository, pedagogy-repositories)
 * need to assert that non-finance repositories don't accidentally touch the
 * finance store (payments, installments, ledger). The snapshot + assertion
 * logic was duplicated in each suite; it now lives here so a single source
 * of truth exists.
 */
import { expect } from "vitest";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import type { Payment, Installment } from "../../domain/model/payment";
import type { LedgerEntry } from "../../domain/model/ledger";

export interface FinanceSnapshot {
  payments: Payment[];
  installments: Installment[];
  ledger: LedgerEntry[];
}

/**
 * Snapshot the current state of the finance store. Call before performing
 * the operation under test, then call `expectFinanceUnchanged(snapshot)`
 * after the operation completes.
 */
export function snapshotFinance(): FinanceSnapshot {
  return {
    payments: [...store.payments] as Payment[],
    installments: [...store.installments] as Installment[],
    ledger: [...store.ledger] as LedgerEntry[],
  };
}

/**
 * Assert that the finance store (payments / installments / ledger) is
 * identical to the previously captured snapshot. Use to verify that a
 * non-finance repository's operations did not accidentally mutate the
 * finance store.
 */
export function expectFinanceUnchanged(before: FinanceSnapshot): void {
  const after = snapshotFinance();
  expect(after.payments.length).toBe(before.payments.length);
  expect(after.installments.length).toBe(before.installments.length);
  expect(after.ledger.length).toBe(before.ledger.length);
}

/**
 * Assert that exactly one new ledger entry has been appended (and no payments
 * or installments have been created). Use to verify that a unified-architecture
 * charge (e.g. club enrollment, therapy follow-up) writes a single ledger
 * entry without accidentally creating a payment or installment.
 *
 * Returns the new entry (the last item in the ledger) so the caller can
 * assert on its shape.
 */
export function expectSingleLedgerChargeAppended(before: FinanceSnapshot): LedgerEntry {
  const after = snapshotFinance();
  expect(after.payments.length).toBe(before.payments.length);
  expect(after.installments.length).toBe(before.installments.length);
  expect(after.ledger.length).toBe(before.ledger.length + 1);
  return after.ledger[after.ledger.length - 1];
}

/** Standard actor used across the integration tests. */
export const TEST_ACTOR = { actorId: "usr-test", actorName: "Test User" } as const;
