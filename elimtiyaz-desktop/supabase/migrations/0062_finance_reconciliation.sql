-- 0062_finance_reconciliation.sql
-- T-103 / MIG-TOKENS — one-time financial data reconciliation (DATA-001…DATA-004).
--
-- OWNER MANDATE (2026-09-01, session 15): the owner reported the Finance tab
-- and the parent dossier showing divergent figures for the same parent.
-- Live forensics (see scripts/verify_t-103.sql + docs/recovery/t-103-live-verification.md)
-- traced the divergence to FOUR data defects left by the 2026-08-11 Excel bulk
-- import, all catalogued in the problem registry:
--
--   DATA-002 — payments table vs ledger disagree for parent e3e90f1f
--     (SIDI MAMER SAMYI): the payments row IMP-2a049159…-V2_ALT was imported
--     as 90,000 DZD while the ledger entry and the source Excel (row 235,
--     column "2V") both say 100,000. The second import run mis-read the 2V
--     column for one student. Excel row 242 (a DIFFERENT parent's student
--     with the same name) has 2V=90,000 — the row-confusion source.
--     FIX: correct the payments row to 100,000 (ledger + Excel are truth).
--
--   DATA-003 (transport half) — 34 parents have transport installments
--     (Σ due 2,064,000 DZD, fully paid) but NO transport charges in
--     ledger_entries. The import wrote transport PAYMENTS to the ledger but
--     never the corresponding CHARGES, so the ledger balance understates
--     those parents' (net-zero) transport position by the full transport due
--     and the installment schedule cannot explain the ledger balance.
--     FIX: insert one transport charge per student, mirroring the tuition
--     bulk-import charge shape (account parent:<p>:category:transport:student:<s>).
--
--   DATA-003 (dettes half) — 2 parents (METAH NADA, DAHMANI FARES) have
--     "Dettes antérieures" charges in the ledger (Excel "DETTES" column:
--     7,000 / 8,000 DZD) with NO matching installment rows, so the schedule
--     understates their obligation. FIX: add the missing installments.
--
--   DATA-003 (SIDI MAMER overstatement) — student 2a049159's tranches were
--     generated from the price tables (Σ 210,000) instead of the Excel devis
--     (236,750 − 63,250 remise = 173,500): +36,500 overstated.
--     FIX: reduce the last tranche's amount_due by 36,500 (63,000 → 26,500).
--     Deterministic rule: the LAST tranche absorbs the correction because the
--     Excel carries no per-tranche split (1T/T2/t3 columns empty for row 235)
--     and the waterfall fills tranches oldest-first, so only the last
--     tranche's split is cosmetic.
--
--   DATA-001 / DATA-004 — payment_allocations is EMPTY (0 rows) and every
--     payments.expected_amount / excess_amount is NULL: the import never ran
--     the canonical waterfall. It dumped whole versements onto single
--     tranches (e.g. parent e3e90f1f: Tranche 2 = 165,000 paid on a 63,000
--     tranche while Tranche 1 sits unpaid at 0) — the direct cause of the
--     Finance-tab vs dossier divergence the owner reported.
--     FIX: reset installments to zero and replay ALL payments through the
--     canonical waterfall (per parent + category, payments chronological,
--     installments oldest-due-first — the 0040 collect_and_allocate_payment
--     order), writing payment_allocations, payments.installment_id links
--     (single-target payments only) and expected/excess per payment.
--
-- DELIBERATE DESIGN DECISION (documented, DATA-009): the backfill does NOT
-- materialize parent_credit adjustment entries for the 59 historical
-- overpayers. The canonical writer (collect_and_allocate_payment) creates a
-- parent_credit entry (-unallocated) in ADDITION to the full-value payment
-- entry, which double-counts the credit in the raw ledger balance (verified
-- live: charge 100k + payment −150k + credit −50k → total_outstanding
-- −100k for a 50k overpayment). Replaying that shape into the historical
-- corpus would make every overpayer's displayed "Solde" twice their real
-- credit — directly worsening the cross-view divergence this migration
-- exists to fix. Historical overpayers keep balance = −excess (the school
-- owes exactly what was overpaid); new payments continue through the
-- canonical RPC unchanged. crossCheckParentCredit will surface
-- UNBACKED_PARENT_CREDIT *warnings* for the 59 historical rows — known and
-- accepted, recorded in docs/recovery/change-log.md.
--
-- Idempotency: the whole block is guarded — re-running on a reconciled
-- corpus is a no-op. On a FRESH deployment (empty tables) every step
-- targets zero rows, so the migration is safe inside the canonical chain.

DO $$
DECLARE
  v_tenant uuid;
  v_fixed_payment int := 0;
  v_transport_charges int := 0;
  v_dettes_rows int := 0;
  v_reduced_rows int := 0;
  v_alloc_rows int := 0;
  v_pay_rows int := 0;
  v_reset_rows int := 0;
  v_parent record;
  v_cat text;
  v_pay record;
  v_ins record;
  v_remaining numeric;
  v_allocate numeric;
  v_ins_remaining numeric;
  v_alloc_count int;
  v_single_target uuid;
  v_new_paid numeric;
  v_new_status text;
BEGIN
  SELECT id INTO v_tenant FROM tenants ORDER BY created_at LIMIT 1;
  IF v_tenant IS NULL THEN
    RAISE NOTICE '0062: no tenant rows — fresh deployment, nothing to reconcile';
    RETURN;
  END IF;

  -- GUARD: already reconciled? (payment_allocations populated by a previous
  -- run of this migration or by any canonical writer)
  IF EXISTS (SELECT 1 FROM payment_allocations WHERE tenant_id = v_tenant LIMIT 1) THEN
    RAISE NOTICE '0062: payment_allocations already populated — reconciliation skipped';
    RETURN;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- STEP 1 — DATA-002: correct the mis-imported V2_ALT payment (90k → 100k)
  -- ══════════════════════════════════════════════════════════════════════
  UPDATE payments
     SET amount = 100000, updated_at = NOW()
   WHERE tenant_id = v_tenant
     AND receipt_number = 'IMP-2a049159-ce2c-4f74-814d-2a133dd85334-V2_ALT'
     AND amount = 90000;
  GET DIAGNOSTICS v_fixed_payment = ROW_COUNT;
  IF v_fixed_payment > 0 THEN
    INSERT INTO audit_logs (id, tenant_id, action, entity_type, entity_id,
      actor_id, actor_name, actor_role, before_json, after_json, note, created_at)
    VALUES (gen_random_uuid(), v_tenant, 'payment.reconcile_fix', 'payment',
      (SELECT id FROM payments WHERE receipt_number = 'IMP-2a049159-ce2c-4f74-814d-2a133dd85334-V2_ALT'),
      NULL, 'Réconciliation 0062', 'system',
      JSONB_BUILD_OBJECT('amount', 90000),
      JSONB_BUILD_OBJECT('amount', 100000),
      'DATA-002: le versement V2_ALT a été importé à 90 000 DZD alors que le grand livre et le Excel source (ligne 235, colonne 2V) indiquent 100 000 DZD. Correction alignée sur la source de vérité.',
      NOW());
  END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- STEP 2 — DATA-003 (transport): insert the missing transport charges
  -- ══════════════════════════════════════════════════════════════════════
  INSERT INTO ledger_entries (entry_number, tenant_id, account_id, parent_id,
    student_id, category, amount, entry_type, source_type, source_id,
    method, receipt_number, payment_status, reverses_id, description,
    actor_id, actor_name, at, metadata)
  SELECT
    'led-recon0062-transport-' || i.student_id,
    v_tenant,
    'parent:' || i.parent_id || ':category:transport:student:' || i.student_id,
    i.parent_id,
    i.student_id,
    'transport',
    SUM(i.amount_due),
    'charge',
    'bulk_import',
    i.student_id || ':TRANSPORT',
    NULL, NULL, NULL, NULL,
    'Transport annuel (réconciliation 0062 — charge manquante de l''import Excel)',
    NULL, 'Réconciliation 0062',
    MIN(i.due_date),
    JSONB_BUILD_OBJECT('reconciliation', '0062', 'reason', 'missing_transport_charge')
  FROM installments i
  WHERE i.tenant_id = v_tenant
    AND i.category = 'transport'
    AND NOT EXISTS (
      SELECT 1 FROM ledger_entries le
      WHERE le.tenant_id = v_tenant
        AND le.parent_id = i.parent_id
        AND le.student_id = i.student_id
        AND le.category = 'transport'
        AND le.entry_type = 'charge'
        AND le.reverses_id IS NULL
    )
  GROUP BY i.parent_id, i.student_id;
  GET DIAGNOSTICS v_transport_charges = ROW_COUNT;
  IF v_transport_charges > 0 THEN
    INSERT INTO audit_logs (id, tenant_id, action, entity_type, entity_id,
      actor_id, actor_name, actor_role, before_json, after_json, note, created_at)
    VALUES (gen_random_uuid(), v_tenant, 'ledger.reconcile_transport_charges',
      'ledger', NULL, NULL, 'Réconciliation 0062', 'system',
      NULL,
      JSONB_BUILD_OBJECT('charges_inserted', v_transport_charges,
        'total_amount', (SELECT SUM(amount) FROM ledger_entries
                         WHERE description LIKE 'Transport annuel (réconciliation 0062%'),
        'parents_affected', (SELECT COUNT(DISTINCT parent_id) FROM ledger_entries
                             WHERE description LIKE 'Transport annuel (réconciliation 0062%')),
      'DATA-003 (moitié transport): 34 parents avaient des tranches de transport payées sans charge correspondante au grand livre. Charges insérées par élève, selon le même modèle que les charges de scolarité de l''import.',
      NOW());
  END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- STEP 3 — DATA-003 (dettes): add the missing "Dettes antérieures"
  -- installments so the schedule matches the ledger charges
  -- ══════════════════════════════════════════════════════════════════════
  -- The bulk-import unique identity (tenant, parent, student, category,
  -- tranche_number ∈ {1,2,3}) leaves no free tranche slot, so the dettes are
  -- folded into the student's Tranche 1 — the tranche the canonical waterfall
  -- fills first, which is exactly the settlement position a prior-year debt
  -- must occupy.
  UPDATE installments i
     SET amount_due = i.amount_due + d.dettes_amount,
         custom_schedule_note = COALESCE(i.custom_schedule_note, '')
           || CASE WHEN COALESCE(i.custom_schedule_note, '') = '' THEN '' ELSE ' | ' END
           || 'Comprend Dettes antérieures '
           || trim(to_char(d.dettes_amount, 'FM999999999'))
           || ' DZD (réconciliation 0062)',
         updated_at = NOW()
    FROM (
      SELECT le.parent_id, le.student_id, SUM(le.amount) AS dettes_amount
      FROM ledger_entries le
      WHERE le.tenant_id = v_tenant
        AND le.entry_type = 'charge'
        AND le.category = 'tuition'
        AND le.description LIKE 'Dettes antérieures%'
        AND le.reverses_id IS NULL
      GROUP BY le.parent_id, le.student_id
    ) d
   WHERE i.tenant_id = v_tenant
     AND i.parent_id = d.parent_id
     AND i.student_id = d.student_id
     AND i.category = 'tuition'
     AND i.tranche_number = 1
     AND NOT EXISTS (
       SELECT 1 FROM audit_logs al
       WHERE al.tenant_id = v_tenant
         AND al.action = 'installment.reconcile_dettes'
         AND al.entity_id = i.id
     );
  GET DIAGNOSTICS v_dettes_rows = ROW_COUNT;
  IF v_dettes_rows > 0 THEN
    INSERT INTO audit_logs (id, tenant_id, action, entity_type, entity_id,
      actor_id, actor_name, actor_role, before_json, after_json, note, created_at)
    SELECT gen_random_uuid(), v_tenant, 'installment.reconcile_dettes',
      'installment', i.id, NULL, 'Réconciliation 0062', 'system',
      JSONB_BUILD_OBJECT('amount_due', i.amount_due - d.dettes_amount),
      JSONB_BUILD_OBJECT('amount_due', i.amount_due),
      'DATA-003 (moitié dettes): la charge "Dettes antérieures" de l''import Excel (colonne DETTES) existait au grand livre sans tranche correspondante. Montant intégré à la Tranche 1 (remplie en premier par la cascade) avec note de traçabilité.',
      NOW()
    FROM installments i
    JOIN (
      SELECT le.parent_id, le.student_id, SUM(le.amount) AS dettes_amount
      FROM ledger_entries le
      WHERE le.tenant_id = v_tenant
        AND le.entry_type = 'charge' AND le.category = 'tuition'
        AND le.description LIKE 'Dettes antérieures%' AND le.reverses_id IS NULL
      GROUP BY le.parent_id, le.student_id
    ) d ON d.parent_id = i.parent_id AND d.student_id = i.student_id
    WHERE i.tenant_id = v_tenant AND i.category = 'tuition' AND i.tranche_number = 1
      AND i.custom_schedule_note LIKE '%réconciliation 0062%';
  END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- STEP 4 — DATA-003 (SIDI MAMER): reduce the overstated last tranche
  -- (price-table generation vs Excel devis: +36,500 overstated)
  -- ══════════════════════════════════════════════════════════════════════
  UPDATE installments
     SET amount_due = amount_due - 36500, updated_at = NOW()
   WHERE tenant_id = v_tenant
     AND parent_id = 'e3e90f1f-a8e6-428e-b05b-e757a8d53b09'
     AND student_id = '2a049159-ce2c-4f74-814d-2a133dd85334'
     AND label = 'Tranche 3 — Scolarité'
     AND amount_due = 63000;
  GET DIAGNOSTICS v_reduced_rows = ROW_COUNT;
  IF v_reduced_rows > 0 THEN
    INSERT INTO audit_logs (id, tenant_id, action, entity_type, entity_id,
      actor_id, actor_name, actor_role, before_json, after_json, note, created_at)
    VALUES (gen_random_uuid(), v_tenant, 'installment.reconcile_devis',
      'installment',
      (SELECT id FROM installments WHERE parent_id = 'e3e90f1f-a8e6-428e-b05b-e757a8d53b09'
        AND student_id = '2a049159-ce2c-4f74-814d-2a133dd85334' AND label = 'Tranche 3 — Scolarité'),
      NULL, 'Réconciliation 0062', 'system',
      JSONB_BUILD_OBJECT('amount_due', 63000),
      JSONB_BUILD_OBJECT('amount_due', 26500),
      'DATA-003 (SIDI MAMER): les tranches de l''élève 2a049159 totalisaient 210 000 DZD (générées depuis la grille tarifaire) alors que le devis Excel net de remise est 173 500 DZD (236 750 − 63 250). La dernière tranche absorbe la correction de 36 500 DZD.',
      NOW());
  END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- STEP 5 — DATA-001 / DATA-004: waterfall backfill
  -- Reset installments, replay every payment through the canonical
  -- waterfall (parent + category scope; payments chronological; tranches
  -- oldest-due-first, id tiebreak — the collect_and_allocate_payment order),
  -- write payment_allocations, link payments.installment_id for
  -- single-target payments, populate expected/excess per payment.
  -- ══════════════════════════════════════════════════════════════════════

  -- 5a. Reset every installment to a clean slate (the import's allocation
  -- was not waterfall-shaped — over-applied tranches + unpaid first
  -- tranches; amount_paid is a denormalized cache that the ledger +
  -- payments table fully re-derive).
  UPDATE installments
     SET amount_paid = 0, amount_pending = 0, paid_date = NULL,
         status = CASE WHEN amount_due > 0 THEN 'unpaid' ELSE status END,
         updated_at = NOW()
   WHERE tenant_id = v_tenant
     AND (amount_paid > 0 OR amount_pending > 0 OR paid_date IS NOT NULL
          OR status IN ('paid', 'partial', 'pending_clearance'));
  GET DIAGNOSTICS v_reset_rows = ROW_COUNT;

  -- 5b. Replay per parent, per category.
  FOR v_parent IN SELECT DISTINCT parent_id FROM payments
                  WHERE tenant_id = v_tenant
                    AND status NOT IN ('refunded', 'cancelled')
                  ORDER BY parent_id
  LOOP
    FOR v_cat IN SELECT DISTINCT category FROM payments
                 WHERE tenant_id = v_tenant AND parent_id = v_parent.parent_id
                   AND status NOT IN ('refunded', 'cancelled')
    LOOP
      FOR v_pay IN SELECT * FROM payments
                   WHERE tenant_id = v_tenant
                     AND parent_id = v_parent.parent_id
                     AND category = v_cat
                     AND status NOT IN ('refunded', 'cancelled')
                   ORDER BY collected_at ASC, id ASC
      LOOP
        v_remaining := v_pay.amount;
        v_alloc_count := 0;
        v_single_target := NULL;

        FOR v_ins IN
          SELECT i.id, i.label, i.amount_due, i.amount_paid,
                 COALESCE(i.amount_pending, 0) AS amount_pending,
                 GREATEST(0, i.amount_due - i.amount_paid - COALESCE(i.amount_pending, 0)) AS ins_remaining
          FROM installments i
          WHERE i.tenant_id = v_tenant
            AND i.parent_id = v_pay.parent_id
            AND i.category = v_pay.category
            AND GREATEST(0, i.amount_due - i.amount_paid - COALESCE(i.amount_pending, 0)) > 0
          ORDER BY i.due_date ASC, i.id ASC
        LOOP
          EXIT WHEN v_remaining <= 0;
          v_ins_remaining := v_ins.ins_remaining;
          v_allocate := LEAST(v_remaining, v_ins_remaining);
          IF v_allocate > 0 THEN
            v_new_paid := v_ins.amount_paid + v_allocate;
            IF v_new_paid >= v_ins.amount_due THEN v_new_status := 'paid';
            ELSE v_new_status := 'partial';
            END IF;
            UPDATE installments
               SET amount_paid = amount_paid + v_allocate,
                   status = v_new_status,
                   paid_date = CASE WHEN v_new_status = 'paid'
                                    THEN COALESCE(paid_date, v_pay.collected_at)
                                    ELSE paid_date END,
                   updated_at = NOW()
             WHERE id = v_ins.id;
            INSERT INTO payment_allocations (id, tenant_id, payment_id,
              charge_id, installment_id, category, allocated_amount, label, created_at)
            VALUES (gen_random_uuid(), v_tenant, v_pay.id, NULL, v_ins.id,
              v_pay.category, v_allocate, v_ins.label, NOW());
            v_remaining := v_remaining - v_allocate;
            v_alloc_count := v_alloc_count + 1;
            v_single_target := v_ins.id;
          END IF;
        END LOOP;

        -- DATA-004: expected = allocated part, excess = unallocated part.
        -- installment_id links only single-target payments (multi-split
        -- links live in payment_allocations).
        UPDATE payments
           SET expected_amount = v_pay.amount - v_remaining,
               excess_amount = v_remaining,
               excess_remark = CASE WHEN v_remaining > 0
                 THEN 'Réconciliation 0062 — excédent (crédit parent)'
                 ELSE NULL END,
               installment_id = CASE
                 WHEN v_alloc_count = 1 AND v_remaining <= 0 THEN v_single_target
                 ELSE installment_id END,
               updated_at = NOW()
         WHERE id = v_pay.id;
        v_alloc_rows := v_alloc_rows + v_alloc_count;
        v_pay_rows := v_pay_rows + 1;
      END LOOP;
    END LOOP;
  END LOOP;

  -- 5c. Reconciliation summary audit entry.
  INSERT INTO audit_logs (id, tenant_id, action, entity_type, entity_id,
    actor_id, actor_name, actor_role, before_json, after_json, note, created_at)
  VALUES (gen_random_uuid(), v_tenant, 'financial.reconcile_waterfall_backfill',
    'payment', NULL, NULL, 'Réconciliation 0062', 'system',
    JSONB_BUILD_OBJECT('payment_allocations_before', 0,
      'installments_reset_reimport', v_reset_rows),
    JSONB_BUILD_OBJECT('payments_replayed', v_pay_rows,
      'allocations_written', v_alloc_rows,
      'payment_amount_fixed', v_fixed_payment,
      'transport_charges_inserted', v_transport_charges,
      'dettes_folded_into_t1', v_dettes_rows,
      'devis_correction_rows', v_reduced_rows),
    'T-103 / DATA-001+DATA-004: rejeu intégral des paiements historiques par la cascade canonique (parent + catégorie, chrono, échéance croissante). payment_allocations peuplée, expected/excess renseignés, liens installment_id posés pour les paiements mono-tranche. Voir verify_t-103.sql pour la vérification triple-source.',
    NOW());

  RAISE NOTICE '0062 reconciliation complete: payments fixed=%, transport charges=%, dettes rows=%, devis corrections=%, installments reset=%, payments replayed=%, allocations=%',
    v_fixed_payment, v_transport_charges, v_dettes_rows, v_reduced_rows, v_reset_rows, v_pay_rows, v_alloc_rows;
END $$;
