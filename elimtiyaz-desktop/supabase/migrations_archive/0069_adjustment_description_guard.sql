-- ============================================================================
-- 0069 — Adjustment description guard (DATA-013 prevention)
-- Task: T-165 (session 26, 2026-09-05)
--
-- WHAT: Adds a CHECK constraint requiring every `adjustment` and `reversal`
--   ledger entry to carry a human-readable description of at least 3
--   characters (after trim). Charge/payment/refund/transfer entries are
--   unaffected.
--
-- WHY (the "No-Mystery-Numbers" rule, docs/domain/financial-rules.md):
--   Adjustments are the only ledger entries that move a family's balance
--   without money changing hands (discounts, discount reversals,
--   counter-passations). When an automated writer (Excel re-import,
--   migration script, refund compensation) inserts them with a NULL or
--   blank description, the parent-facing surfaces can only render a bare
--   "+50 000 / -71 000" with no reason — which reads as a bookkeeping
--   error and triggers support disputes. The desktop drawer (T-164) now
--   displays a clearly-flagged diagnostic for legacy blank rows; this
--   constraint makes sure no NEW blank row can ever be written.
--
--   Writer-side contract: `upsert_ledger_entry_from_import` /
--   `collect_and_allocate_payment` / `revert_payment_allocation` /
--   `revert_payment_allocation` compensation entries and the desktop
--   `adjust()` path must pass p_description as a real sentence, e.g.
--   "Annulation de remise lors du ré-import Excel du 2026-09-05".
--
-- LIVE EVIDENCE (2026-09-05, read-only audit):
--   SELECT count(*) FROM ledger_entries
--    WHERE entry_type IN ('adjustment','reversal')
--      AND (description IS NULL OR length(trim(description)) < 3);
--   → 0  (690 adjustment rows, all documented; 0 reversal rows)
--   The VALIDATE step below therefore cannot fail on production data.
--
-- SAFETY / IDEMPOTENCE:
--   - ADD CONSTRAINT ... NOT VALID then VALIDATE CONSTRAINT: the online
--     pattern — NOT VALID takes a brief ACCESS EXCLUSIVE lock without a
--     full-table scan, VALIDATE runs with a SHARE UPDATE EXCLUSIVE lock
--     so concurrent writes continue.
--   - The DO block guards by constraint name, so re-running ADD is a no-op;
--     VALIDATE on an already-validated constraint simply re-scans (no
--     error), so re-running the whole migration is safe.
--   - Existing RLS policies and RPC signatures are untouched.
-- ============================================================================

DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ledger_entries_adjustment_description_guard'
  ) THEN
    ALTER TABLE public.ledger_entries
      ADD CONSTRAINT ledger_entries_adjustment_description_guard
      CHECK (
        entry_type NOT IN ('adjustment', 'reversal')
        OR (description IS NOT NULL AND length(btrim(description)) >= 3)
      )
      NOT VALID;
  END IF;
END
$mig$;

-- Validate against existing rows (verified 0 violations above). Runs in its
-- own statement so a concurrent writer racing the NOT VALID add cannot abort
-- the ADD step.
ALTER TABLE public.ledger_entries
  VALIDATE CONSTRAINT ledger_entries_adjustment_description_guard;
