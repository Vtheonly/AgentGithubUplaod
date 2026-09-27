-- ============================================================================
-- 0124_installments_official_three_tranches.sql
-- ============================================================================
-- T-425 (DATA-044, 109th session 2026-09-27): the OFFICIAL 3-tranche model
-- (the owner's confirmed spec: "THERE IS NO 4TH TRANCHE — Registration (FI)
-- + Tranche 1 (V1) + Tranche 2 (2V) + Tranche 3 (v3); Max Tuition
-- Installments: 3; Max Transport Installments: 3").
--
-- WHAT THIS DOES (and nothing else):
--
--   1. Clears the STALE Excel-import installments: source_type =
--      'bulk_import' AND source_id LIKE 'imp-%' — precisely the rows the
--      import engine's deterministic imp- identity writes. batchRegister's
--      wizard rows share source_type='bulk_import' but carry the
--      '{studentCode}:category:T{n}' source_id shape and are UNTOUCHED
--      (live census: 0 such rows today). The cleared rows are DERIVED
--      data — the T-425 re-import rebuilds them through the corrected
--      pipeline: the registration fee (FI) at tranche 0 due at signup,
--      V1/2V/v3 at tranches 1..3 on the Sept 15 / Dec 15 / Mar 15
--      schedule, the canonical waterfall attribution (the t-424 oracle:
--      Σremaining = the workbook's own TOTAL*CREANCE, 193,477,900
--      clamped, 0 overpaid rows).
--
--      Purge safety verified live TWICE (scripts/t-425-no-4th-tranche-
--      probe.mjs + scripts/t-425-purge-safety-check.mjs): 0 payments with
--      installment_id, 0 payment_allocations referencing installments,
--      every FK referencing installments is ON DELETE SET NULL; the
--      ledger + payments (the real financial records) are NOT touched —
--      the re-import's T-421 preflight skips their existing identities
--      (idempotent) and re-writes ONLY the installments.
--
--   2. Re-tightens the CHECK migration 0090 relaxed: tranche_number
--      IN (0, 1, 2, 3). 0 = the registration fee (FI — a fee, NOT a
--      tranche; a non-wave row); 1..3 = the official tranches. The
--      phantom tranche 4 is rejected at the DB level from now on.
--
-- WHY: migration 0090 (CALC-001, 55th session) canonized the old
-- workbook's BON receipt-template labels — the registration fee as
-- tranche 1 ("INSCRIPTION"), the real 1st versement (V1) as "2EME
-- TRANCHE" due Dec 15 (one term late), v3 as the phantom "4ème TRANCHE"
-- due Jun 15. The owner confirmed that template was "an unmaintained
-- receipt template… erroneously labeled the rows (Mistake: treating
-- registration as tranche 1, or copying a 4-term template)" and DELETED
-- it from the updated 2027/2026 workbook: the operational ledger
-- (ETAT 20262027, the P formula R+S+T+U+W+X+Y) has ALWAYS been
-- Registration + 3 tranches. Live consequence (the t-425 probe): tuition
-- T1 = the registration fee (n=1,137), tuition T4 = the phantom
-- (n=1,137, Σdue 96,918,500, due 2027-06-15) — every tuition wave's
-- label AND timing off by one term.
--
-- ORDER OF APPLICATION (the remediation runbook): deploy the T-425 app
-- build FIRST (the import engine's new structure), then THIS migration
-- (purge + CHECK), then the re-import, then the live verification
-- against the Excel oracle. Between the purge and the re-import the
-- Tranches tab shows its honest empty state (the CACHE-103 semantics —
-- never fabricated zeros).
--
-- Safe + idempotent: the DELETE matches nothing on re-run; the CHECK is
-- a re-tightening no-op on re-run; the registration is ON CONFLICT DO
-- NOTHING.
-- ============================================================================

-- 1. Clear the stale Excel-import installments (derived data — the
--    re-import rebuilds them through the corrected pipeline).
delete from public.installments
 where source_type = 'bulk_import'
   and source_id like 'imp-%';

-- 2. The official model's CHECK: 0 = the registration fee (FI — a fee,
--    NOT a tranche); 1..3 = the official tranches (V1/2V/v3); the
--    phantom 4 rejected.
ALTER TABLE public.installments
    DROP CONSTRAINT IF EXISTS installments_tranche_number_check,
    ADD  CONSTRAINT installments_tranche_number_check
         CHECK (tranche_number IN (0, 1, 2, 3));

COMMENT ON CONSTRAINT installments_tranche_number_check ON public.installments IS
    'T-425 official model (the owner''s confirmed spec): tuition = the registration fee (FI, tranche 0 — a fee, NOT a tranche, due at signup Sept 15) '
    '+ EXACTLY 3 tranches (1=V1 echeance 15 sep, 2=2V echeance 15 dec, 3=v3 echeance 15 mar). '
    'Transport = 3 tranches (1..3). There is NO 4th tranche (the old 4eme label was the deleted BON '
    'receipt template''s error — 0090 canonized it, T-425 corrects it).';

-- 3. Registration (T-091/MIG-TOKENS — atomic with the DDL; idempotent).
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0124', '{0124_installments_official_three_tranches.sql}', 'installments_official_three_tranches')
on conflict (version) do nothing;
