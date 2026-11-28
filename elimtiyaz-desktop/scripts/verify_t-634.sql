-- T-634 / ADR-037: behavioral collision probe. Disposable transaction only.
-- Execute on the LOCAL OFFLINE chain first. No RLS or trigger is disabled.
BEGIN;
CREATE TEMP TABLE t634_results (label text, passed boolean);
GRANT SELECT, INSERT ON t634_results TO authenticated;
DO $$
DECLARE
  t uuid; u uuid := '00000000-0000-0000-0000-00000000e635';
  a uuid; b uuid; first_row record; second_row record; again_row record;
BEGIN
  INSERT INTO tenants(name,slug,country,default_locale,default_currency,timezone,is_active)
  VALUES ('T634 SQL fixture','t634-sql-fixture','DZ','fr','DZD','Africa/Algiers',true) RETURNING id INTO t;
  INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(u,'t634-sql@elimtiyaz.dz',now());
  UPDATE user_profiles SET tenant_id=t,status='active' WHERE auth_user_id=u;
  INSERT INTO role_assignments(tenant_id,user_profile_id,role_id)
    SELECT t,p.id,r.id FROM user_profiles p CROSS JOIN roles r WHERE p.auth_user_id=u AND r.code='super_admin';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','app_metadata',jsonb_build_object('tenant_id',t))::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT out_parent_id INTO a FROM upsert_parent_from_import(p_tenant_id=>t,p_parent_code=>'PAR-2026-C63401',p_first_name=>'Test',p_last_name=>'FamilyA',p_primary_phone=>'+213555016341',p_activation_code=>'634001');
  SELECT out_parent_id INTO b FROM upsert_parent_from_import(p_tenant_id=>t,p_parent_code=>'PAR-2026-C63402',p_first_name=>'Test',p_last_name=>'FamilyB',p_primary_phone=>'+213555016342',p_activation_code=>'634002');
  SELECT * INTO first_row FROM upsert_student_from_import(p_tenant_id=>t,p_student_code=>'ELV-2026-ABCDEF',p_parent_id=>a::text,p_first_name=>'First',p_last_name=>'Test');
  SELECT * INTO second_row FROM upsert_student_from_import(p_tenant_id=>t,p_student_code=>'ELV-2026-ABCDEF',p_parent_id=>b::text,p_first_name=>'Second',p_last_name=>'Test');
  INSERT INTO t634_results VALUES('different students',first_row.out_student_id<>second_row.out_student_id);
  INSERT INTO t634_results SELECT 'original family preserved',parent_id=a AND first_name='First' FROM students WHERE id=first_row.out_student_id;
  INSERT INTO t634_results VALUES('canonical alternate code',second_row.out_student_code ~ '^ELV-2026-[0-9A-F]{6}$' AND second_row.out_student_code<>first_row.out_student_code);
  SELECT * INTO again_row FROM upsert_student_from_import(p_tenant_id=>t,p_student_code=>'ELV-2026-ABCDEF',p_parent_id=>b::text,p_first_name=>'Second',p_last_name=>'Test');
  INSERT INTO t634_results VALUES('re-import stable',again_row.out_student_id=second_row.out_student_id AND again_row.out_student_code=second_row.out_student_code AND NOT again_row.out_was_inserted);
END $$;
SELECT * FROM t634_results;
ROLLBACK;
