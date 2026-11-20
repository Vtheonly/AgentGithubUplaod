-- ============================================================================
-- 0129_installments_year_scoped_identity.sql
-- T-437 (116th session, 2026-09-29): DATA-054 — the installments identity
-- is YEAR-BLIND. Discovered LIVE during T-437 Phase 3 (the re-enrollment
-- billing composite): migration 0128's fn_re_enroll_student inserts the
-- target-year tuition T1/T2/T3 for a CONTINUING student — and the 0032
-- partial identity index (tenant_id, parent_id, student_id, category,
-- tranche_number) has NO academic-year column, so EVERY new-year tranche
-- row conflicts with the previous year's row and the INSERT's
-- ON CONFLICT DO NOTHING SILENTLY DROPS IT. Multi-year tranche rows are
-- structurally impossible for a continuing student — the exact failure
-- issue #18 §7 forbids ("the new enrollment should load/create the
-- applicable installments/tranches").
--
-- The same year-blindness lives in upsert_installment_from_import's
-- Identity-2 lookup (the 0127 recreation): it matches the canonical tranche
-- identity WITHOUT the year, so a year-aware re-import of a continuing
-- student's tranche row would UPDATE the WRONG (previous-year) row instead
-- of inserting the new-year row.
--
-- THE FIX (one identity, year-scoped):
--   §1  the identity index rebuilt with COALESCE(academic_year_id, zero-uuid)
--       as the 6th key column — NULL-year rows keep their pre-0127
--       deduplication semantics (all NULLs group under the zero uuid),
--       attributed rows are scoped per academic year. Safe to rebuild: rows
--       differing ONLY by year were previously IMPOSSIBLE (the old index
--       prevented them), so no existing data can violate the new key.
--   §2  upsert_installment_from_import recreated (the 0127 body VERBATIM +
--       the year-aware Identity-2): when p_academic_year/due-date resolves
--       a year, the lookup prefers the exact-year row, then a NULL-year
--       (claimable legacy) row; a DIFFERENT-year row is a different
--       obligation — never matched, never updated.
--   §3  Registration (T-091/MIG-TOKENS).
--
-- Numbering: 0129 (0128 is T-437's own migration, already live-applied —
-- §15.9: applied migrations are never edited; this is the follow-up fix).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1. The year-scoped identity index
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS public.installments_bulk_import_identity_idx;

CREATE UNIQUE INDEX installments_bulk_import_identity_idx
    ON public.installments (
        tenant_id, parent_id, student_id, category, tranche_number,
        COALESCE(academic_year_id, '00000000-0000-0000-0000-000000000000'::uuid)
    )
    WHERE parent_id IS NOT NULL
      AND student_id IS NOT NULL
      AND category IS NOT NULL
      AND tranche_number IS NOT NULL;

COMMENT ON INDEX public.installments_bulk_import_identity_idx IS
  'T-437 (DATA-054): the 0032 tranche identity, YEAR-SCOPED — the 6th key is '
  'COALESCE(academic_year_id, zero-uuid) so NULL-year (legacy/un-attributed) rows '
  'keep the pre-0127 deduplication semantics while attributed rows are distinct '
  'per academic year. A continuing student re-enrolled into a new year can carry '
  'T1/T2/T3 in BOTH years (issue #18 §7); a re-import of the SAME year still '
  'converges (same COALESCE key).';

-- ----------------------------------------------------------------------------
-- §2. upsert_installment_from_import — recreated with the year-aware
--      Identity-2 (the 0127 body VERBATIM, only the canonical-identity
--      lookup changes).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.upsert_installment_from_import(
    uuid, text, text, text, text, text, numeric, numeric, numeric, date, date,
    text, text, text);

CREATE OR REPLACE FUNCTION public.upsert_installment_from_import(
    p_tenant_id          uuid,
    p_parent_id          text,               -- UUID OR parent_code / local ref
    p_installment_ref    text DEFAULT NULL,  -- mobile local id ("ins-...")
    p_student_id         text DEFAULT NULL,  -- UUID OR student_code / local ref
    p_category           text DEFAULT 'tuition',
    p_label              text DEFAULT NULL,
    p_amount_due         numeric(12,2) DEFAULT NULL,
    p_amount_paid        numeric(12,2) DEFAULT NULL,
    p_amount_pending     numeric(12,2) DEFAULT NULL,
    p_due_date           date DEFAULT NULL,
    p_paid_date          date DEFAULT NULL,
    p_status             text DEFAULT 'unpaid',
    p_academic_cycle     text DEFAULT NULL,
    p_academic_year      text DEFAULT NULL
)
RETURNS table(installment_id uuid, was_inserted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path to public
AS $$
DECLARE
    v_id uuid;
    v_inserted boolean := false;
    v_existing uuid;
    v_parent uuid := public.resolve_parent_ref(p_tenant_id, p_parent_id);
    v_student uuid := public.resolve_student_ref(p_tenant_id, p_student_id);
    v_tranche int;
    v_label text := NULLIF(TRIM(COALESCE(p_label, '')), '');
    -- T-436 (DATA-052): the year id the parameter resolves to — an explicit
    -- code/label match against the tenant's academic_years first, then the
    -- INV-14 window on due_date; NULL when unresolvable (the read-side
    -- precedence fallback applies).
    v_year_id uuid := NULL;
BEGIN
    IF v_parent IS NULL THEN
        RAISE EXCEPTION 'upsert_installment_from_import: unresolvable parent ref %', p_parent_id;
    END IF;

    -- T-436: resolve p_academic_year (code or label match, tenant-scoped).
    IF p_academic_year IS NOT NULL AND NULLIF(TRIM(p_academic_year), '') IS NOT NULL THEN
        SELECT ay.id INTO v_year_id
          FROM public.academic_years ay
         WHERE ay.tenant_id = p_tenant_id
           AND (ay.code = p_academic_year OR ay.label = p_academic_year)
         ORDER BY ay.start_date DESC
         LIMIT 1;
    END IF;
    -- INV-14 window fallback on the due date when no explicit match.
    IF v_year_id IS NULL AND p_due_date IS NOT NULL THEN
        v_year_id := public.resolve_academic_year_id_for_date(p_due_date, p_tenant_id);
    END IF;

    -- Derive tranche_number from the label ("Tranche 2" -> 2) for identity matching.
    v_tranche := COALESCE(
        (SELECT NULLIF(regexp_replace(v_label, '\D', '', 'g'), '')::int WHERE v_label ~ 'Tranche\s*\d+'),
        NULL
    );

    -- Identity 1: mobile source provenance (source_type='android_sync', source_id=local ref)
    IF p_installment_ref IS NOT NULL AND TRIM(p_installment_ref) <> '' THEN
        SELECT id INTO v_existing
          FROM public.installments
         WHERE tenant_id = p_tenant_id
           AND source_type = 'android_sync'
           AND source_id = p_installment_ref
         LIMIT 1;
    END IF;

    -- Identity 2: canonical tranche identity (0032 bulk-import index columns)
    -- — T-437 (DATA-054): YEAR-AWARE. When the call resolves a year, the
    -- lookup prefers the EXACT-year row, then a NULL-year (claimable legacy)
    -- row; a DIFFERENT-year row is a different obligation — never matched
    -- (previously the year-blind match would UPDATE the previous year's
    -- tranche instead of inserting the new year's).
    IF v_existing IS NULL AND v_student IS NOT NULL AND v_tranche IS NOT NULL THEN
        SELECT id INTO v_existing
          FROM public.installments
         WHERE tenant_id = p_tenant_id
           AND parent_id = v_parent
           AND student_id = v_student
           AND category = COALESCE(NULLIF(p_category, ''), 'tuition')
           AND tranche_number = v_tranche
           AND (v_year_id IS NULL OR academic_year_id IS NULL OR academic_year_id = v_year_id)
         ORDER BY (academic_year_id = v_year_id) DESC NULLS LAST
         LIMIT 1;
    END IF;

    IF v_existing IS NOT NULL THEN
        UPDATE public.installments
           SET parent_id       = COALESCE(v_parent, parent_id),
               student_id      = COALESCE(v_student, student_id),
               category        = COALESCE(NULLIF(p_category, ''), category),
               label           = COALESCE(v_label, label),
               amount_due      = COALESCE(p_amount_due, amount_due),
               amount_paid     = COALESCE(p_amount_paid, amount_paid),
               amount_pending  = COALESCE(p_amount_pending, amount_pending),
               due_date        = COALESCE(p_due_date, due_date),
               paid_date       = COALESCE(p_paid_date, paid_date),
               status          = COALESCE(NULLIF(p_status, ''), status),
               academic_cycle  = COALESCE(p_academic_cycle, academic_cycle),
               academic_year_id = COALESCE(v_year_id, academic_year_id),
               source_type     = COALESCE(source_type, 'android_sync'),
               source_id       = COALESCE(source_id, p_installment_ref),
               updated_at      = now()
         WHERE id = v_existing;
        v_id := v_existing;
    ELSE
        v_id := public.gen_uuid();
        v_inserted := true;
        INSERT INTO public.installments (
            id, tenant_id, parent_id, student_id, category, label,
            tranche_number, amount_due, amount_paid, amount_pending,
            due_date, paid_date, status, academic_cycle,
            academic_year_id,
            source_type, source_id,
            created_at, updated_at
        ) VALUES (
            v_id, p_tenant_id, v_parent, v_student,
            COALESCE(NULLIF(p_category, ''), 'tuition'), v_label,
            v_tranche, p_amount_due,
            COALESCE(p_amount_paid, 0), COALESCE(p_amount_pending, 0),
            p_due_date, p_paid_date,
            COALESCE(NULLIF(p_status, ''), 'unpaid'),
            p_academic_cycle,
            v_year_id,
            CASE WHEN p_installment_ref IS NOT NULL THEN 'android_sync' END,
            p_installment_ref,
            now(), now()
        );
    END IF;

    RETURN QUERY SELECT v_id, v_inserted;
END;
$$;

COMMENT ON FUNCTION public.upsert_installment_from_import IS
  'Idempotent upsert for installments. Identity: (1) android_sync source '
  'provenance, (2) the canonical tranche identity (tenant, parent, student, '
  'category, tranche_number) — YEAR-AWARE since 0129 (T-437/DATA-054): with a '
  'resolved year, an exact-year row is preferred, then a NULL-year claimable '
  'row; a different-year row is a different obligation. p_academic_year wired '
  'since 0127 (DATA-052).';

-- ----------------------------------------------------------------------------
-- §3. Registration (T-091/MIG-TOKENS pattern).
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0129', '{0129_installments_year_scoped_identity.sql}', 'installments_year_scoped_identity')
on conflict (version) do nothing;
