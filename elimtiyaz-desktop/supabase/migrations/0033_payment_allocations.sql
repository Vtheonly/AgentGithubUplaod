-- ============================================================================
-- 0033_payment_allocations.sql
-- ============================================================================
-- PAYMENT BREAKDOWN FEATURE: This migration adds the ability to link a single
-- payment to multiple charges/services. For example, if a parent pays 300,000
-- that covers Education (250,000) + Transportation (50,000), the payment is
-- linked to BOTH charges via `payment_allocations` rows.
--
-- This also supports OVERPAYMENT detection: if the expected amount is 300,000
-- but the parent pays 360,000, the excess 60,000 is recorded with a remark.
--
-- Schema:
--   payment_allocations (
--     id              uuid PK
--     tenant_id       uuid NOT NULL
--     payment_id      uuid NOT NULL REFERENCES payments(id)
--     charge_id       uuid REFERENCES ledger_entries(id) -- the charge this allocation covers
--     installment_id  uuid REFERENCES installments(id)  -- optional: the tranche covered
--     category        text NOT NULL                      -- tuition / transport / etc.
--     allocated_amount numeric NOT NULL                  -- how much of the payment went here
--     created_at      timestamptz
--   )
--
-- We also add columns to the `payments` table:
--   expected_amount   numeric — the total expected for the covered charges
--   excess_amount     numeric — amount paid above expected (0 when fully allocated)
--   excess_remark     text    — note explaining the overpayment
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. payment_allocations table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_allocations (
    id              uuid        PRIMARY KEY DEFAULT public.gen_uuid(),
    tenant_id       uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    payment_id      uuid        NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
    charge_id       uuid        REFERENCES public.ledger_entries(id) ON DELETE SET NULL,
    installment_id  uuid        REFERENCES public.installments(id) ON DELETE SET NULL,
    category        text        NOT NULL CHECK (category IN (
                    'tuition', 'transport', 'canteen', 'uniform', 'books',
                    'extracurricular', 'therapy_psychology', 'therapy_speech',
                    'second_apron', 'parent_credit', 'other'
                )),
    allocated_amount numeric(12,2) NOT NULL CHECK (allocated_amount >= 0),
    label           text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_allocations_payment_idx
    ON public.payment_allocations (payment_id);
CREATE INDEX IF NOT EXISTS payment_allocations_tenant_idx
    ON public.payment_allocations (tenant_id, payment_id);

COMMENT ON TABLE public.payment_allocations IS
  'Links a single payment to multiple charges/services. A 300,000 payment ' ||
  'can be split: 250,000 → tuition charge, 50,000 → transport charge. ' ||
  'Enables the Payment Breakdown UI feature.';

-- ----------------------------------------------------------------------------
-- 2. payments — add expected_amount + excess_amount + excess_remark
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name   = 'payments'
           AND column_name  = 'expected_amount'
    ) THEN
        ALTER TABLE public.payments ADD COLUMN expected_amount numeric(12,2) DEFAULT 0;
        COMMENT ON COLUMN public.payments.expected_amount IS
          'The total expected amount for the charges this payment covers. ' ||
          'When amount > expected_amount, the difference is excess_amount.';
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name   = 'payments'
           AND column_name  = 'excess_amount'
    ) THEN
        ALTER TABLE public.payments ADD COLUMN excess_amount numeric(12,2) DEFAULT 0;
        COMMENT ON COLUMN public.payments.excess_amount IS
          'The amount paid ABOVE the expected_amount. 0 when fully allocated. ' ||
          'When > 0, the excess_remark explains the overpayment.';
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name   = 'payments'
           AND column_name  = 'excess_remark'
    ) THEN
        ALTER TABLE public.payments ADD COLUMN excess_remark text;
        COMMENT ON COLUMN public.payments.excess_remark IS
          'Remark/note explaining an overpayment. Example: "Parent paid 360,000 ' ||
          'instead of 300,000 — excess 60,000 held as parent credit for next year."';
    END IF;
END$$;

-- ----------------------------------------------------------------------------
-- 3. Bootstrap summary
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    RAISE NOTICE 'Migration 0033 complete:';
    RAISE NOTICE '  - payment_allocations table created';
    RAISE NOTICE '  - payments.expected_amount column added';
    RAISE NOTICE '  - payments.excess_amount column added';
    RAISE NOTICE '  - payments.excess_remark column added';
END$$;
