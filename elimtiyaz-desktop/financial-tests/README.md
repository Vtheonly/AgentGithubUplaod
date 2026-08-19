# Cross-Platform Financial Consistency Test DSL

This directory holds the **source of truth** for cross-platform financial
scenario tests. Both the Android and desktop apps run the same scenarios
and must produce the same resulting state.

## File format

Each `*.yml` file is a single scenario with the structure:

```yaml
name: <short identifier>
description: <human-readable description>
given:
  # Initial state — ledger entries to seed both implementations with.
  ledger_entries:
    - id: <string>
      tenant_id: <string>
      account_id: <string>          # MUST be derived via deriveAccountId
      parent_id: <string>
      student_id: <string|null>
      category: <PaymentCategory.code>
      amount: <Long centimes>        # signed per canonical convention
      type: <LedgerEntryType.code>
      source_type: <LedgerSourceType.code>
      source_id: <string>
      method: <PaymentMethod.code|null>
      receipt_number: <string|null>
      payment_status: <PaymentStatus.code|null>
      reverses_id: <string|null>
      description: <string>
      actor_id: <string>
      actor_name: <string>
      at: <ISO-8601 string>
      metadata: <object|null>
  # Optional initial installments for the waterfall / revert tests.
  installments:
    - id: <string>
      parent_id: <string>
      student_id: <string|null>
      category: <PaymentCategory.code>
      label: <string>
      amount_due: <Long centimes>
      amount_paid: <Long centimes>
      amount_pending: <Long centimes>
      due_date: <ISO-8601 string>
      status: <PaymentStatus.code>
when:
  # The operation to perform on both implementations.
  # One of:
  #   - { kind: collect_payment, parent_id, student_id, amount, method, category, actor_id, actor_name }
  #   - { kind: refund_payment, payment_id, reason, actor_id, actor_name }
  #   - { kind: adjust, parent_id, student_id, category, amount, reason, actor_id, actor_name }
  #   - { kind: compute_balance, account_id }
  #   - { kind: compute_parent_summary, parent_id, parent_name }
  #   - { kind: reconcile }
  #   - { kind: evaluate_discounts, gross_tuition, previous_grade_level, current_grade_level,
  #       child_index, payment_plan, payment_date, academic_year_start_year,
  #       academic_year_start, enrollment_date, previous_rank }
then:
  # Expected post-operation state — both implementations must produce this.
  expected_account_balance:
    account_id: <string>
    balance: <Long centimes>
    total_charged: <Long centimes>
    total_paid: <Long centimes>
    total_cleared: <Long centimes>
    total_pending: <Long centimes>
    total_adjusted: <Long centimes>
    total_refunded: <Long centimes>
    unallocated_credit: <Long centimes>
  expected_parent_summary:
    parent_id: <string>
    total_outstanding: <Long centimes>
    total_overdue: <Long centimes>
    total_charged: <Long centimes>
    total_paid: <Long centimes>
    total_cleared: <Long centimes>
    total_pending: <Long centimes>
    total_adjusted: <Long centimes>
    total_refunded: <Long centimes>
    total_unallocated_credit: <Long centimes>
  expected_reconciliation:
    passed: <boolean>
    error_count: <int>
    warning_count: <int>
  expected_discounts:
    - code: <string>
      amount: <Long centimes>
  expected_installments:
    - id: <string>
      amount_paid: <Long centimes>
      amount_pending: <Long centimes>
      status: <PaymentStatus.code>
```

## Conventions

1. **Money is in centimes (Long)**. Conversion: `centimes = round(dzd × 100)`.
   - 100,000 DZD = 10,000,000 centimes.
   - 5,000 DZD = 500,000 centimes.
2. **Timestamps are ISO-8601 with offset** (e.g. `2026-09-15T00:00:00Z`).
3. **Account IDs follow the canonical derivation**: `parent:{parentId}:category:{category}[:student:{studentId}]`.
4. **Categories use the wire codes** (e.g. `tuition`, `parent_credit`, `therapy_psychology`).
5. **Statuses use the wire codes** (e.g. `paid`, `pending_clearance`, `unpaid`).

## Runners

Two runners consume the same YAML:

- **Android**: `app/src/test/java/com/example/core/CrossPlatformScenarioRunner.kt`
- **Desktop**: `src/test/cross-platform/ScenarioRunner.ts`

Both runners:
1. Load all `*.yml` files from `financial-tests/scenarios/`.
2. For each scenario: seed the initial state, run the operation, assert the result.
3. Report any divergences as test failures.

Both runners are deterministic — given the same scenario file, they produce
the same pass/fail result.
