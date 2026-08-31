-- verify_s12_chain_consistency.sql — session-12 opening check (owner-requested
-- "migration properly applied and consistent everywhere").
--
-- Verifies the LIVE database functionally matches the local canonical chain
-- 0001–0057 (ADR-001), with focus on 0049/0050/0051 where the live registry
-- `name`/`statements` rows were recorded by earlier Management-API manual
-- applications and do NOT match the local filenames (pre-existing condition,
-- discovered 2026-08-31 session 12):
--   live 0049 = 'expire_pending_approvals_fix'  (local: 0049_dashboard_kpis_fanout_expire_fix)
--   live 0050 = 'chat_read_receipts'            (local: 0050_fcm_token_caller_verification)
--   live 0051 = 'chat_read_receipts'            (local: 0051_chat_read_receipts — match)
--
-- Convention (AGENTS.md §11.1): BEGIN…ROLLBACK wrapper + temp results table.
-- Read-only checks (catalog + prosrc inspection); no data mutated.

BEGIN;

CREATE TEMP TABLE s12_results (check_id TEXT, passed BOOLEAN, detail TEXT) ON COMMIT DROP;

DO $$
DECLARE
  v_count integer;
  v_n2 integer;
  v_missing text;
BEGIN
  -- C1 — version set equals the local chain exactly: 0001–0014 + 0018–0057
  -- (0015–0017 never existed in the repo chain — pre-audit numbering gap).
  SELECT string_agg(version, ',' ORDER BY version::int) INTO v_missing
  FROM (
    SELECT v.version FROM supabase_migrations.schema_migrations v
    EXCEPT
    SELECT t.v FROM (VALUES ('0001'),('0002'),('0003'),('0004'),('0005'),('0006'),
      ('0007'),('0008'),('0009'),('0010'),('0011'),('0012'),('0013'),('0014'),
      ('0018'),('0019'),('0020'),('0021'),('0022'),('0023'),('0024'),('0025'),
      ('0026'),('0027'),('0028'),('0029'),('0030'),('0031'),('0032'),('0033'),
      ('0034'),('0035'),('0036'),('0037'),('0038'),('0039'),('0040'),('0041'),
      ('0042'),('0043'),('0044'),('0045'),('0046'),('0047'),('0048'),('0049'),
      ('0050'),('0051'),('0052'),('0053'),('0054'),('0055'),('0056'),('0057')) AS t(v)
  ) x;
  SELECT COUNT(*) INTO v_count FROM supabase_migrations.schema_migrations;
  INSERT INTO s12_results VALUES ('C1 version set == local chain (0001-0014,0018-0057)',
    (v_missing IS NULL AND v_count = 54),
    'rows=' || v_count || COALESCE(' extra_versions=' || v_missing, ' no extras'));

  -- C2 — 0049a: expire_pending_approvals() references the REAL table (T-083 fix).
  SELECT COUNT(*) INTO v_count FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='expire_pending_approvals'
     AND position('account_approval_requests' in p.prosrc::text) > 0
     AND position('FROM users' in p.prosrc::text) = 0;
  INSERT INTO s12_results VALUES ('C2 0049 expire RPC uses account_approval_requests',
    v_count = 1, 'functions_matching=' || v_count);

  -- C3 — 0049b: unique indexes on all 4 MVs (REFRESH CONCURRENTLY works).
  SELECT COUNT(DISTINCT tablename) INTO v_count FROM pg_indexes
   WHERE schemaname='public' AND indexdef LIKE '%UNIQUE%'
     AND tablename IN ('mv_dashboard_kpis','mv_debt_aging','mv_top_debtors','mv_revenue_by_month');
  INSERT INTO s12_results VALUES ('C3 0049 unique indexes on 4 matviews', v_count = 4,
    'matviews_with_unique_idx=' || v_count || '/4');

  -- C4 — 0050a: register_fcm_token carries SEC-106 caller verification.
  SELECT COUNT(*) INTO v_count FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='register_fcm_token'
     AND position('auth.uid()' in p.prosrc::text) > 0;
  INSERT INTO s12_results VALUES ('C4 0050 register_fcm_token verifies auth.uid()',
    v_count = 1, 'functions_matching=' || v_count);

  -- C5 — 0050b: deactivate_fcm_tokens RPC exists (canonical sign-out path).
  SELECT COUNT(*) INTO v_count FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='deactivate_fcm_tokens';
  INSERT INTO s12_results VALUES ('C5 0050 deactivate_fcm_tokens exists', v_count >= 1,
    'functions=' || v_count);

  -- C6 — 0051: chat read-receipt policy + trigger + guard function exist.
  SELECT COUNT(*) INTO v_count FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname='public' AND t.tgname='chat_messages_read_by_guard';
  SELECT COUNT(*) INTO v_n2 FROM pg_policies
   WHERE schemaname='public' AND tablename='chat_messages' AND policyname='chat_messages_update_read_by';
  INSERT INTO s12_results VALUES ('C6 0051 chat read-receipt trigger+policy',
    (v_count = 1 AND v_n2 = 1), 'trigger=' || v_count || ' policy=' || v_n2);

  -- C7 — 0053: is_global_admin + tenant-scoped role resolver present.
  SELECT COUNT(*) INTO v_count FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='is_global_admin';
  SELECT COUNT(*) INTO v_n2 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='current_user_roles'
     AND position('tenant' in p.prosrc::text) > 0;
  INSERT INTO s12_results VALUES ('C7 0053 is_global_admin + tenant-scoped roles',
    (v_count = 1 AND v_n2 = 1), 'is_global_admin=' || v_count || ' scoped_current_user_roles=' || v_n2);

  -- C8 — 0054: handle_new_auth_user uses the created_by_admin gate (fixed marker).
  SELECT COUNT(*) INTO v_count FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='handle_new_auth_user'
     AND position('created_by_admin' in p.prosrc::text) > 0;
  INSERT INTO s12_results VALUES ('C8 0054 auth trigger created_by_admin gate',
    v_count = 1, 'functions_matching=' || v_count);

  -- C9 — 0055: revert_payment_allocation + upsert_payment_from_import carry
  -- SEC-112 / SEC-111 caller-tenant verification.
  SELECT COUNT(*) INTO v_count FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='revert_payment_allocation'
     AND position('SEC-112' in p.prosrc::text) > 0;
  SELECT COUNT(*) INTO v_n2 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='upsert_payment_from_import'
     AND position('SEC-111' in p.prosrc::text) > 0;
  INSERT INTO s12_results VALUES ('C9 0055 RPC caller verification (SEC-111/112)',
    (v_count = 1 AND v_n2 = 1), 'revert_SEC-112=' || v_count || ' upsert_SEC-111=' || v_n2);

  -- C10 — 0056: expense_tickets.payee column exists.
  SELECT COUNT(*) INTO v_count FROM information_schema.columns
   WHERE table_schema='public' AND table_name='expense_tickets' AND column_name='payee';
  INSERT INTO s12_results VALUES ('C10 0056 expense_tickets.payee column', v_count = 1,
    'columns=' || v_count);

  -- C11 — 0057: dead resolver gone + histories staff policy present.
  SELECT COUNT(*) INTO v_count FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='fn_current_tenant_id';
  SELECT COUNT(*) INTO v_n2 FROM pg_policies
   WHERE schemaname='public' AND tablename='student_academic_histories'
     AND policyname='student_academic_histories_staff';
  INSERT INTO s12_results VALUES ('C11 0057 dead resolver gone + staff policy',
    (v_count = 0 AND v_n2 = 1), 'fn_current_tenant_id=' || v_count || ' staff_policy=' || v_n2);

  -- C12 — record the registry name mismatches (documentation check — expected
  -- pre-existing condition, surfaced for the record; NOT a failure of function).
  SELECT COUNT(*) INTO v_count FROM supabase_migrations.schema_migrations
   WHERE version='0049' AND name <> 'dashboard_kpis_fanout_expire_fix'
      OR version='0050' AND name <> 'fcm_token_caller_verification';
  INSERT INTO s12_results VALUES ('C12 (record) registry name drift 0049/0050',
    v_count = 2, 'name-mismatched rows=' || v_count || ' (pre-existing, documented)');
END $$;

SELECT check_id, passed, detail FROM s12_results ORDER BY check_id;

ROLLBACK;
