-- ============================================================================
-- 0090_installments_four_payment_bon.sql
-- ============================================================================
-- CALC-001 follow-up (55th session, 2026-09-13) — the Excel import engine
-- now builds the REAL 4-payment BON structure per student:
--
--   INSCRIPTION (FI) / 2EME TRANCHE (V2) / 3ème TRANCHE (2V) / 4ème TRANCHE
--
-- This matches the school's own receipt template (the workbook's BON sheet
-- carries exactly these four labels) and the audit finding #5: tuition is
-- FI + 3 installments, with the REMISE deducted from the 2EME (V2) tranche
-- ONLY (workbook S-column formulas `=122000-J58`).
--
-- 0007 created `installments.tranche_number` with CHECK (in (1, 2, 3)) —
-- the 3-tranche-only shape. A live Supabase import of the real workbook
-- with the 4-payment structure would be REJECTED by that CHECK (tranche 4
-- = 4ème TRANCHE). This migration relaxes the constraint to (1, 2, 3, 4).
--
-- Safe + additive:
--   - Existing rows (tranche 1..3) remain valid under the wider CHECK.
--   - No column is dropped or retyped; no data is rewritten.
--   - The unique index (tenant, parent, student, category, tranche_number)
--     from 0032 keeps its semantics — tranche 4 is simply a new slot.
--   - The wizard's batchRegister path still emits 3 tranches + a separate
--     registration-fee charge; it is unaffected.

-- 1. Relax the CHECK so the 4ème TRANCHE (BON tranche 4) can be persisted.
ALTER TABLE public.installments
    DROP CONSTRAINT IF EXISTS installments_tranche_number_check,
    ADD  CONSTRAINT installments_tranche_number_check
         CHECK (tranche_number IN (1, 2, 3, 4));

COMMENT ON CONSTRAINT installments_tranche_number_check ON public.installments IS
    'BON 4-payment structure (CALC-001): 1=INSCRIPTION (FI), 2=2EME TRANCHE (V2), '
    '3=3eme TRANCHE (2V), 4=4eme TRANCHE (v3). Transport rows stay 1..3.';

-- 2. Backfill labels for legacy import rows so the UI shows the BON names.
--    Only rows whose label still carries the old generic pattern are
--    relabeled (idempotent — the WHERE clause matches nothing on re-run).
UPDATE public.installments
   SET label = 'INSCRIPTION (FI)'
 WHERE category = 'tuition' AND tranche_number = 1
   AND label LIKE 'Tranche 1%';
UPDATE public.installments
   SET label = '2EME TRANCHE (V2)'
 WHERE category = 'tuition' AND tranche_number = 2
   AND label LIKE 'Tranche 2%';
UPDATE public.installments
   SET label = '3ème TRANCHE (2V)'
 WHERE category = 'tuition' AND tranche_number = 3
   AND label LIKE 'Tranche 3%';
