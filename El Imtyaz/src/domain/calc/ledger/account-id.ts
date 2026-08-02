/**
 * Ledger account ID derivation — single source of truth.
 *
 * Account IDs are deterministic: the same `(parentId, category, studentId)`
 * always produces the same ID. This means balances can be looked up
 * without a separate "accounts" table.
 *
 * Format: `parent:{parentId}:category:{category}` (+ `:student:{studentId}`
 * when student-scoped).
 *
 * Extracted verbatim from `domain/model/ledger.ts` `deriveAccountId`.
 */
import type { PaymentCategory } from "@/domain/model/payment";

/**
 * Derive the canonical account ID for a parent + (optional) student + category.
 *
 * @param parentId   The parent's unique ID.
 * @param category   The payment category (tuition, transport, etc.).
 * @param studentId  Optional student ID for student-scoped accounts.
 * @returns The deterministic account ID string.
 */
export function deriveAccountId(
  parentId: string,
  category: PaymentCategory,
  studentId: string | null = null,
): string {
  // Use a delimiter that cannot appear in IDs themselves.
  const parts = ["parent", parentId, "category", category];
  if (studentId) parts.push("student", studentId);
  return parts.join(":");
}
