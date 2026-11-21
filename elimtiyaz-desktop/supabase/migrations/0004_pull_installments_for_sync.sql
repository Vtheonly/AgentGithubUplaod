-- ============================================================================
-- 0004_pull_installments_for_sync.sql
-- T-592 (E7A-3 / ROADMAP 6.5) — the incremental delta cache's server half.
--
-- WHAT: `pull_installments_for_sync(p_tenant_id, p_since, p_after_id,
-- p_limit)` — the installments member of the 0143 (SYNC-304) composite
-- keyset cursor family. The consolidated baseline already carries the
-- payments / ledger_entries / parents / students / device_tokens legs
-- (0001: pull_payments_for_sync, pull_ledger_entries_for_sync,
-- pull_parents_for_sync, pull_students_for_sync,
-- pull_device_tokens_for_sync); the installments leg — the desktop cache
-- layer's fifth table — was the absent member.
--
-- WHY (OPS-015 class 1 / ARCH-049): the desktop's 30 s / window-focus
-- re-seed volley previously re-downloaded the WHOLE collections
-- (~13,000+ rows per cycle across the cached tables). The delta cache
-- layer consumes the (updated_at, id) composite cursor per table: a warm
-- pull reads ONLY the rows changed since the cursor — the volley dies.
--
-- THE CURSOR CONTRACT (the 0143 convention, verbatim): rows strictly
-- AFTER (p_since, p_after_id) in (updated_at ASC, id ASC) order; NULL
-- p_since = the full walk (the cold-start seed through the same
-- primitive); the composite tie-break makes the cursor resumable without
-- duplicates or skips.
--
-- SECURITY: SECURITY DEFINER + search_path 'public' (the house rule); the
-- tenant scope is explicit (p_tenant_id = the session's tenant — the
-- caller validates). The row projection mirrors pull_payments_for_sync
-- (the full row: the cache layer maps through the SAME mappers).
--
-- APPEND-ONLY (OPS-020): 0001..0003 untouched; this file appends as 0004.
-- ============================================================================

create or replace function public.pull_installments_for_sync(
    p_tenant_id uuid,
    p_since timestamp with time zone default null,
    p_after_id uuid default null,
    p_limit integer default 1000
)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
AS $function$
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      FROM (
        SELECT i.id, i.tenant_id, i.parent_id, i.student_id, i.service_enrollment_id,
               i.invoice_id, i.tranche_number, i.label, i.category, i.amount_due,
               i.amount_paid, i.amount_pending, i.due_date, i.paid_date, i.status,
               i.academic_cycle, i.payment_plan, i.is_custom_schedule,
               i.custom_schedule_note, i.source_type, i.source_id, i.academic_year_id,
               i.created_at, i.updated_at
          FROM public.installments i
         WHERE i.tenant_id = p_tenant_id
           AND (
             p_since IS NULL
             OR i.updated_at > p_since
             OR (p_after_id IS NOT NULL AND i.updated_at = p_since AND i.id > p_after_id)
           )
         ORDER BY i.updated_at ASC, i.id ASC
         LIMIT p_limit
      ) t;
$function$
;
comment on function pull_installments_for_sync(uuid, timestamp with time zone, uuid, integer) is 'T-592 (E7A-3): the installments leg of the 0143 (SYNC-304) composite keyset cursor family — the desktop delta cache layer''s fifth table. NULL p_since = the full cold-start walk through the same primitive.';
