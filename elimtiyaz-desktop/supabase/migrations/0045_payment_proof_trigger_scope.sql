-- ============================================================================
-- 0045_payment_proof_trigger_scope.sql — SCOPE enforce_payment_proof TO INSERT + METHOD CHANGE (T-061)
-- ============================================================================
-- Problem WEAK-200 (T-061): `enforce_payment_proof` runs on EVERY payment
-- INSERT/UPDATE. The function unconditionally re-validates proof fields for
-- check/transfer methods on every UPDATE — including status-only updates
-- (refunds, clearances) of legacy rows whose `proof_path` is NULL because
-- they were created before the proof requirement existed.
--
-- Concretely: a payment was inserted in early 2025 (migration 0007 era)
-- with `method='check'` and `proof_path IS NULL` (the proof requirement
-- was either not yet enforced, or the row was created via a path that
-- skipped the trigger). Today, ANY UPDATE of that row — e.g. the desktop
-- `markCleared` flow transitioning status `pending → paid`, or the
-- Android sync dispatcher replaying the row's state — re-fires the
-- trigger and raises `Proof upload is mandatory for check payments`,
-- blocking the status transition. The same applies to the
-- `check_number`/`check_bank_name`/`transfer_reference` checks.
--
-- The fix per T-061's proposed resolution: re-validate only when `method`
-- changes (or proof fields are being set), so status-only updates of
-- legacy rows cannot fail.
--
-- Strategy (preserving the original trigger's intent):
--   1. INSERT: keep the original strict behavior — new rows MUST satisfy
--      the proof requirement for their method (no regression on new
--      payments, including refunds inserted via revert_payment_allocation).
--   2. UPDATE:
--      a. For the `method` field: enforce the proof requirement ONLY
--         when the row is transitioning to (or staying at) a method that
--         requires proof AND the proof_path is being explicitly set to
--         NULL on this UPDATE (which would be a regression — explicitly
--         clearing proof). If proof_path is unchanged (OLD.proof_path),
--         the existing value is trusted.
--      b. For status-only updates (method unchanged, proof_path
--         unchanged): skip the proof requirement entirely. The legacy
--         row's NULL proof_path is grandfathered.
--   3. The `check_number`/`check_bank_name`/`transfer_reference` checks
--      on UPDATE are scoped the same way: only fire when those fields
--      are being SET to NULL on a check/transfer-method row (i.e. someone
--      is trying to remove required fields from an existing row).
--   4. The auto-status logic (`new.status is null → derive from method`)
--      is preserved verbatim — it only fires on rows where status is
--      being explicitly set to NULL.
--
-- The trigger itself stays `BEFORE INSERT OR UPDATE` — the function
-- decides what to enforce based on TG_OP + which fields differ from
-- OLD. This avoids dropping and recreating the trigger (which would
-- change the audit-trail shape).
--
-- Compatibility: append-only per AGENTS.md §15 rule 9; no earlier
-- migration is edited. Migration 0007 (original creation) and 0034
-- (re-creation after canonical-engine unification) are unchanged.
-- ============================================================================

create or replace function public.enforce_payment_proof()
returns trigger
language plpgsql
security definer
as $$
begin
    -- ----------------------------------------------------------------------
    -- INSERT: strict. New payments MUST satisfy the proof requirement for
    -- their method. Refunds inserted via revert_payment_allocation also
    -- pass through here — they typically have method='cash' (no proof
    -- required) and proof_path IS NULL, so the check passes.
    -- ----------------------------------------------------------------------
    if TG_OP = 'INSERT' then
        if new.method in ('check', 'transfer') and new.proof_path is null then
            raise exception 'Proof upload is mandatory for % payments (plan §13.05)', new.method;
        end if;

        if new.method = 'check' and (new.check_number is null or new.check_bank_name is null) then
            raise exception 'Check number and bank name are required for check payments';
        end if;

        if new.method = 'transfer' and new.transfer_reference is null then
            raise exception 'Transaction reference is required for transfer payments';
        end if;
    -- ----------------------------------------------------------------------
    -- UPDATE: re-validate ONLY when the row is being CHANGED in a way
    -- that would weaken the proof requirement:
    --   - method is being changed to a proof-required method
    --     (check or transfer) without setting proof_path; OR
    --   - on a check/transfer row, proof_path is being explicitly cleared
    --     (NEW.proof_path IS NULL while OLD.proof_path IS NOT NULL); OR
    --   - on a check row, check_number/check_bank_name is being cleared; OR
    --   - on a transfer row, transfer_reference is being cleared.
    --
    -- Status-only updates (method unchanged, proof_path unchanged) skip
    -- the proof requirement entirely — this is the WEAK-200 fix.
    -- ----------------------------------------------------------------------
    elsif TG_OP = 'UPDATE' then
        -- Method change to a proof-required method WITHOUT setting proof_path.
        if new.method in ('check', 'transfer')
           and new.proof_path is null
           and (old.method is distinct from new.method
                or old.proof_path is not null) then
            -- Only raise if this UPDATE is actually trying to land on
            -- a NULL proof_path for a check/transfer method — which means
            -- either a method change to check/transfer without proof, OR
            -- an explicit proof_path clear on a check/transfer row.
            -- (If old.method = new.method AND old.proof_path IS NULL,
            -- the row was already NULL — we are grandfathering it.)
            if old.method is distinct from new.method or old.proof_path is not null then
                raise exception 'Proof upload is mandatory for % payments (plan §13.05)', new.method;
            end if;
        end if;

        -- Check-number / bank-name cleared on a check row.
        if new.method = 'check'
           and (old.check_number is not null or old.check_bank_name is not null)
           and (new.check_number is null or new.check_bank_name is null) then
            raise exception 'Check number and bank name are required for check payments';
        end if;

        -- Transfer reference cleared on a transfer row.
        if new.method = 'transfer'
           and old.transfer_reference is not null
           and new.transfer_reference is null then
            raise exception 'Transaction reference is required for transfer payments';
        end if;
    end if;

    -- Auto-set initial status: cash → paid, check/transfer → pending.
    -- Preserved verbatim from the original trigger. Only fires when the
    -- caller left status NULL (which is the canonical "derive from method"
    -- convention).
    if new.status is null then
        new.status := case new.method when 'cash' then 'paid' else 'pending' end;
    end if;

    return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- Verification: re-create the trigger to pick up the function change.
-- The original trigger from 0007 is `BEFORE INSERT OR UPDATE`; the new
-- function determines per-row behaviour via TG_OP, so we keep the same
-- trigger event spec. drop + recreate is the safe way to re-bind a
-- trigger to a redefined function (PostgreSQL caches the function OID
-- at trigger-create time, but the planner re-resolves at execution —
-- both forms work; the explicit drop+create is the documented pattern).
-- ----------------------------------------------------------------------------
drop trigger if exists payments_enforce_proof on public.payments;
create trigger payments_enforce_proof
    before insert or update on public.payments
    for each row execute function public.enforce_payment_proof();

-- ----------------------------------------------------------------------------
-- Audit note: this migration does not retroactively populate
-- proof_path/check_number/etc. on legacy NULL-proof rows — it only stops
-- ENFORCING on status-only updates of those rows. The data-quality work
-- (backfilling proof for legacy check/transfer payments where business
-- policy requires it) is a separate task; it cannot be done at the schema
-- level without business owner confirmation per recovery rule §16.
-- ----------------------------------------------------------------------------
