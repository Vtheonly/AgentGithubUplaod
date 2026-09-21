-- ============================================================================
-- 0101_restore_sidi_family.sql
-- T-395 / OPS-319 (+ the BUSINESS-105 evidence): restore the REAL
-- "Famille SIDI — 0554288142" family (DATA-011 / migration 0063) that the
-- 2026-09-16 destructive-surface UI testing left SOFT-DELETED on production
-- (vebfehrpzajhstyhinnw), and return its 3 test-refunded payments to the
-- canonical 'paid' state.
--
-- WHAT HAPPENED (the forensic timeline, live-audit-proven):
--   2026-09-15 17:48 — the fresh-clone chain re-ran 0063 STEP 2: the row-242
--     family was created exactly per the workbook (devis 255,000 /
--     versements 255,000 / créance 0 — the DATA-011 reconciliation).
--   2026-09-16 17:23:32 — the student was soft-deleted (soft_delete_student,
--     audit 041b1ced), 17:23:36 the parent (soft_delete_parent, audit
--     228fa17e) — the guard-clears-after-student-removal sequence, i.e. a
--     MANUAL walk of the new T-384 removal buttons in the desktop UI on a
--     REAL family (the t-384 e2e used its own run-unique probe rows; the OLD
--     project's copy of the family was never touched — the desktop is
--     hard-locked to the NEW project).
--   2026-09-16 23:17 — the family's 3 payments were refunded via
--     revert_payment_allocation (audits: notes "idk" / "test" / "errr" —
--     test actions). The refunds HALF-EXECUTED: payments.status flipped to
--     'refunded', but NO reversal ledger entries were created and the LIFO
--     waterfall was never reverted — the RPC's original-entry lookup
--     (source_type='payment' AND source_id=<payment uuid>) cannot match the
--     0063-reconciliation ledger rows (source_type='bulk_import',
--     source_id='<student>:V2') — registered as BUSINESS-105.
--
-- WHY RESTORE (not re-import):
--   The soft-delete semantics preserved the family's entire financial
--   history (3 tranches fully paid, the devis charge, 3 payment rows, 5
--   allocations, the ledger) — re-creating would duplicate it. The workbook
--   truth (DATA-011): the family PAID 255,000 in full (créance 0). The
--   ledger, the installments and the allocations all still say exactly
--   that; ONLY payments.status ('refunded', with zero reversal entries)
--   contradicts them. This migration returns the family to the exact
--   0063 canonical state. Every step is guarded + idempotent; the OLD
--   project (family never deleted, payments never refunded) is a no-op
--   data-wise and only gains the chain registration (parity 98/98).
--
-- GUARDS (defense in depth):
--   1. the parent restore matches parent_code + the digit-normalized phone
--      (the 0063 identity convention) AND deleted_at IS NOT NULL;
--   2. the student restore matches student_code + the parent link AND
--      deleted_at IS NOT NULL;
--   3. the payments restore touches ONLY this family's payments that are
--      'refunded' AND have NO reversal ledger entry (the half-refund
--      signature — a financially-executed refund has one and is LEFT
--      ALONE);
--   4. re-running changes nothing (all guards re-evaluate).
--
-- AUDIT: parent.restore / student.restore / payment.restore rows with the
-- system actor 'Restauration 0101' (the 0063 'Réconciliation 0063'
-- convention). audit_logs is append-only (§15.26) — the 2026-09-16
-- parent.delete / student.delete / payment.refund rows stay as the honest
-- record.
--
-- Registration: the T-091/MIG-TOKENS embedded block (atomic with the DML
-- for the Management-API live application; idempotent via ON CONFLICT).
-- ============================================================================

DO $restore$
DECLARE
    v_tenant        uuid;
    v_parent        record;
    v_student       record;
    v_restored_p    integer := 0;
    v_restored_s    integer := 0;
    v_restored_pay  integer := 0;
    v_pay           record;
BEGIN
    -- STEP 1 — the parent (guarded: soft-deleted + the 0063 phone identity).
    SELECT * INTO v_parent
      FROM public.parents p
     WHERE p.parent_code = 'PAR-2026-8F4B97'
       AND regexp_replace(p.primary_phone, '[^0-9]', '', 'g') = '0554288142'
       AND p.deleted_at IS NOT NULL
     LIMIT 1;

    IF FOUND THEN
        v_tenant := v_parent.tenant_id;

        UPDATE public.parents
           SET deleted_at = NULL,
               is_active  = true,
               updated_at = now()
         WHERE id = v_parent.id;

        INSERT INTO public.audit_logs (id, tenant_id, action, entity_type,
          entity_id, actor_id, actor_name, actor_role, before_json,
          after_json, note, created_at)
        VALUES (gen_random_uuid(), v_tenant, 'parent.restore', 'parent',
          v_parent.id, NULL, 'Restauration 0101', 'system',
          to_jsonb(v_parent) - 'updated_at',
          jsonb_build_object('deleted_at', NULL, 'is_active', true),
          'T-395 / OPS-319: restauration de la famille réelle « Famille SIDI — 0554288142 » (réconciliation 0063 / DATA-011), soft-supprimée le 2026-09-16 17:23 lors des tests des boutons de suppression T-384 — la ligne existait en base mais était invisible dans le desktop (filtre deleted_at).',
          now());
        v_restored_p := 1;
    END IF;

    -- STEP 2 — the student (guarded: parent link + soft-deleted). Resolved
    -- by identity chain (parent_code → parent → student_code) so it also
    -- works when the parent was already restored by a prior run.
    SELECT s.* INTO v_student
      FROM public.students s
      JOIN public.parents p ON p.id = s.parent_id
     WHERE p.parent_code = 'PAR-2026-8F4B97'
       AND regexp_replace(p.primary_phone, '[^0-9]', '', 'g') = '0554288142'
       AND s.student_code = 'ELV-2026-E0E486'
       AND s.deleted_at IS NOT NULL
     LIMIT 1;

    IF FOUND THEN
        UPDATE public.students
           SET deleted_at = NULL,
               is_active  = true,
               updated_at = now()
         WHERE id = v_student.id;

        INSERT INTO public.audit_logs (id, tenant_id, action, entity_type,
          entity_id, actor_id, actor_name, actor_role, before_json,
          after_json, note, created_at)
        VALUES (gen_random_uuid(), v_student.tenant_id, 'student.restore',
          'student', v_student.id, NULL, 'Restauration 0101', 'system',
          to_jsonb(v_student) - 'updated_at',
          jsonb_build_object('deleted_at', NULL, 'is_active', true),
          'T-395 / OPS-319: restauration de l''élève SIDI MAMER SAMYI (ELV-2026-E0E486, 5ap — réconciliation 0063 / DATA-011), soft-supprimé le 2026-09-16 17:23 avec sa famille.',
          now());
        v_restored_s := 1;
    END IF;

    -- STEP 3 — the payments (guarded: this family + 'refunded' + NO reversal
    -- ledger entry — the half-refund signature; a financially-executed
    -- refund has a reversal entry and is deliberately left alone).
    IF v_tenant IS NULL THEN
        SELECT p.tenant_id INTO v_tenant
          FROM public.parents p
         WHERE p.parent_code = 'PAR-2026-8F4B97'
           AND regexp_replace(p.primary_phone, '[^0-9]', '', 'g') = '0554288142'
         LIMIT 1;
    END IF;

    IF v_tenant IS NOT NULL THEN
        FOR v_pay IN
            SELECT pay.*
              FROM public.payments pay
              JOIN public.parents p ON p.id = pay.parent_id
             WHERE p.parent_code = 'PAR-2026-8F4B97'
               AND regexp_replace(p.primary_phone, '[^0-9]', '', 'g') = '0554288142'
               AND pay.status = 'refunded'
               AND NOT EXISTS (
                    SELECT 1 FROM public.ledger_entries le
                     WHERE le.source_type = 'payment'
                       AND le.source_id = pay.id::text
                       AND le.entry_type = 'reversal')
        LOOP
            UPDATE public.payments
               SET status = 'paid', updated_at = now()
             WHERE id = v_pay.id;

            INSERT INTO public.audit_logs (id, tenant_id, action, entity_type,
              entity_id, actor_id, actor_name, actor_role, before_json,
              after_json, note, created_at)
            VALUES (gen_random_uuid(), v_tenant, 'payment.restore', 'payment',
              v_pay.id, NULL, 'Restauration 0101', 'system',
              jsonb_build_object('status', 'refunded', 'amount', v_pay.amount,
                                 'payment_number', v_pay.payment_number),
              jsonb_build_object('status', 'paid', 'amount', v_pay.amount,
                                 'payment_number', v_pay.payment_number),
              'T-395 / BUSINESS-105: remise à l''état canonique « paid » — le remboursement du 2026-09-16 23:17 (test) n''a créé AUCUNE écriture d''inversion ni touché la cascade LIFO (le lookup du RPC ne matche pas les écritures bulk_import de la réconciliation 0063), tandis que le ledger, les tranches et les allocations disent toutes « payées ». Classeur DATA-011: versements 255 000, créance 0.',
              now());
            v_restored_pay := v_restored_pay + 1;
        END LOOP;
    END IF;

    RAISE NOTICE '0101 restore: parent=%, student=%, payments=%',
        v_restored_p, v_restored_s, v_restored_pay;
END
$restore$;

-- ----------------------------------------------------------------------------
-- Registration (T-091/MIG-TOKENS pattern — the Management-API apply embeds
-- this statement so the DML and the registration land in ONE atomic
-- transaction; kept here so a fresh CLI deployment registers identically.
-- ON CONFLICT keeps it idempotent.)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0101', '{0101_restore_sidi_family.sql}', 'restore_sidi_family')
on conflict (version) do nothing;
