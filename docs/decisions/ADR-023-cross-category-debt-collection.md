# ADR-023 — Cross-category consolidated debt collection: `p_category = NULL` is the canonical multi-service semantics

- **Status:** Accepted (2026-09-23, 95th repair session — T-411 Phase 1)
- **Task:** T-411 · **Problem:** BUSINESS-106 (CRITICAL), with DATA-029 (per-service attribution) as the read-side companion
- **Context input:** `docs/domain/financial-rules.md` §4 (the pre-existing canonical rule: "Category filter semantics: `NULL` / absent = **all categories** (canonical)"), the 94th-session Finance UI audit (`docs/audits/finance-ui-architecture-audit-2026-09-23.md` §F/FA-01, §J.2), migrations 0039/0040/0042 (the RPC's waterfall filters already implement the NULL semantics), T-060 (BUSINESS-005 — the exact-category fix this ADR now complements)

## Context

Every consolidated "Encaisser" entry point (Créances Top-20, Suivi des Dettes drawer, CRM parent drawer, Diagnostic console) means **the family's whole outstanding balance across all services**. But since T-060, the desktop ALWAYS sends a concrete category to `collect_and_allocate_payment`:

- the DebtTab / CRM drawer / DebtAgingTab contexts build their single line item with `category: "other"`;
- the Diagnostic console passes no category through `CounterPaymentModal`, so the modal keeps its `"tuition"` default;
- the repository coerces `p_category: input.category ?? "tuition"`.

The RPC waterfall filters `AND (p_category IS NULL OR category = p_category)`, so a consolidated collection today allocates to at most ONE category's installments — and since zero installments carry category `'other'` (live census 2026-09-23: tuition 46 / transport 9 / other 0), a consolidated cash collection allocates to **nothing** and books the ENTIRE amount as `parent_credit`, leaving every outstanding surface untouched.

The canonical rule (financial-rules §4) already defines the correct semantics — `NULL = all categories` — and the SQL waterfall filters already implement it. What was missing: (a) a NULL-category representation in the desktop context/collect contracts, (b) nullable storage columns, (c) honest UI labeling.

Two candidate resolutions were on the table (audit §J.2):

- **(a)** the modal gains a cross-category mode that sends `p_category = NULL` (the canonical §4 semantics) for consolidated contexts;
- **(b)** the RPC gains an explicit multi-category allocation contract (e.g. `p_categories text[]`), a new parameter shape consumed by every caller and mirror.

## Decision

**Option (a).** `p_category = NULL` is THE cross-category collection contract:

1. **Contract layer.** `PaymentLineItem.category` and `CollectPaymentInput.category` become `PaymentCategory | null`; `null` means "the family's whole balance — allocate across every category" (consolidated contexts). Concrete categories keep T-060's exact-category semantics for tranche-targeted collection.
2. **Repository layer.** `collect()` passes `p_category: input.category ?? null` — the `?? "tuition"` coercion is deleted. The mock twin treats `null` as "no category filter" in its waterfall.
3. **Storage layer.** `payments.category` and `ledger_entries.category` become NULLABLE (`ALTER COLUMN … DROP NOT NULL`): a NULL-category payment/entry IS a multi-service payment. `payment_allocations.category` stays NOT NULL — each allocation row carries the concrete category the waterfall actually satisfied (the per-service truth, per T-330/DATA-029).
4. **Ledger booking.** A cross-category payment books ONE payment entry (the revert RPC reverses a single entry by `source_id`) on the synthetic account `parent:{parentId}:category:all` with `category = NULL`. Parent-level replay (`computeParentSummary`) sums raw signed balances across accounts, so the entry reduces the parent outstanding correctly; per-category views read `payment_allocations`, never the payment row's category. The `parent_credit` overpayment entry is unchanged.
5. **UI layer.** The modal's category state is `PaymentCategory | null`: `consolidated_debt` mode pins it to `null` (the category selector renders "Multi-services" and is disabled — the scope IS the whole balance); `installment_tranche` / `single_item` modes keep the concrete category. Row/label maps render NULL as **"Multi-services"**.
6. **Clearance/refund parity.** `mark_payment_cleared` and `revert_payment_allocation` already branch on `v_payment.category IS NULL` → cross-category funds movement; making the column nullable activates that pre-existing branch.

## Consequences

- Positive: the CRITICAL defect is fixed with the semantics the domain rules already pinned — no new RPC parameter shape, no Android/website call-site breakage (they keep sending concrete categories; NULL is opt-in per entry point); `mark_payment_cleared`'s and `revert_payment_allocation`'s NULL branches become live instead of dead code.
- Costs: two columns drop NOT NULL (a schema relaxation — the check constraints are untouched, NULL never matches `category = 'x'` filters which is exactly right for multi-service rows); the UI label maps gain a NULL branch; the `due−paid−pending` cleared-branch fix (BUSINESS-107, same migration) changes allocation capacity for tranches carrying pending funds — pinned by new equivalence tests.
- Explicitly out of scope: splitting the payment ledger entry into per-category entries (would break `revert_payment_allocation`'s single-entry reversal); an `p_categories[]` array contract (option (b) — deferred unless a per-category split preview at collection time is ever required); the payments-row category of LEGACY `'other'`-filed consolidated payments (a data-repair decision for the owner if ever needed).

## Implementation map

| Platform | Artifact | Status |
|---|---|---|
| Backend | migration `0115_cross_category_collection_and_waterfall_inv4.sql`: DROP NOT NULL on `payments.category` + `ledger_entries.category`; `collect_and_allocate_payment` re-created (cross-category ledger booking on `:category:all`; **cleared-branch capacity `GREATEST(0, due − paid − pending)`** — the BUSINESS-107 TS/SQL alignment); `mark_payment_cleared` re-created (**overflow cap at `due − paid` + excess → `parent_credit` booking**) | TESTED (see verify script + unit suites) |
| Desktop engine | `waterfall-allocator.ts` cleared branch = `clampNonNegative(due − paid − pending)` | TESTED |
| Desktop contracts | `PaymentLineItem.category: PaymentCategory \| null`; `CollectPaymentInput.category: PaymentCategory \| null`; modal state + presets; 4 consolidated entry points send `category: null` | TESTED |
| Desktop repository | `collect()`: `p_category: input.category ?? null`; `mapPaymentRow` preserves NULL; mock twin cross-category waterfall | TESTED |
| Website / Android | no change required (read-side per-service attribution moves to `payment_allocations` under DATA-029; portal receipts render NULL category as "Multi-services" in the DATA-032 pass) | noted |
