-- ============================================================================
-- 0056_expense_tickets_payee.sql — T-093 (DRIFT-013)
-- ============================================================================
-- WHAT IT FIXES:
--   The desktop `Expense` domain model (src/domain/model/expense.ts) carries
--   `payee` ("Bénéficiaire / Fournisseur") — the person/supplier who receives
--   the money. The UI captures it as a REQUIRED field on submit
--   (expense-submit-modal.tsx: payee z.string().min(2)), displays it in the
--   tickets table ("Bénéficiaire" column), the detail drawer, the disburse
--   confirmation and the anomaly explainer (PII-masked).
--
--   The canonical `expense_tickets` table (migration 0008) has NO payee
--   column, so a Supabase-backed expense repository would silently DROP the
--   payee on every submit — exactly the class of silent data loss this
--   recovery is fighting (cf. DRIFT-013: the desktop previously wrote to a
--   nonexistent `expenses` table instead).
--
-- CHANGE: add nullable `payee text` to expense_tickets + an index matching
-- the payee search field (financials-page searchFields includes payee).
-- Nullable on purpose: rows written by other paths before this migration
-- stay valid; the desktop submit flow always supplies it.
--
-- IDEMPOTENCY: `add column if not exists` + `create index if not exists`.
-- AGENTS.md §15 rule 9 respected: this is a NEW migration — 0008 (applied)
-- is untouched.
-- ============================================================================

alter table public.expense_tickets
    add column if not exists payee text;

create index if not exists expense_tickets_payee_idx
    on public.expense_tickets (tenant_id, payee);
