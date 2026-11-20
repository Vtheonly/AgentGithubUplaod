-- ============================================================================
-- 0144: ATT-104 — drop the legacy 0004 session-blind attendance index +
--       reconcile the legacy 0022 record_roll_call RPC
--       (T-501, 152nd session, 2026-10-11)
-- ============================================================================
--
-- THE DEFECT (T-500 live proof, F3, 2026-10-10):
--
--   Recording roll call for session 'both' after a 'morning' row exists
--   fails with 409 `duplicate key value violates unique constraint
--   "attendance_records_unique_session_uidx"` — for the WHOLE batch. The
--   legacy 0004 index
--     (tenant_id, student_id, class_id, date,
--      coalesce(class_subject_id, '00000000-0000-0000-0000-000000000000'))
--   does NOT include `session`, so a SECOND attendance session per
--   student+class+date is impossible — even though the canonical 0041
--   index `uq_attendance_canonical (tenant_id, student_id, record_date,
--   session)` (which the desktop's PostgREST upsert targets) allows
--   per-session rows. The tighter (older) constraint wins on every
--   second-session insert: the standard Algerian morning+afternoon school
--   day cannot be recorded.
--
-- THE FIX:
--   §1 drops the legacy index. The canonical 0041 index remains the ONE
--      attendance uniqueness contract.
--   §2 reconciles the legacy 0022 `record_roll_call` RPC: its ON CONFLICT
--      clause targets the dropped index expression, so it would fail at
--      runtime with 42P10 after §1. The RPC has ZERO consumers across all
--      three repositories (verified 2026-10-11: rg over desktop + Android
--      + website source — only the problem registry and the audit report
--      mention it); its insert shape (no `session`, no `record_date`)
--      cannot satisfy the canonical index without a rewrite. It is
--      DROPPED (documented; git history preserves the forensic copy).
--      The canonical roll-call path is the desktop's PostgREST upsert on
--      uq_attendance_canonical (T-023), live-proven by T-500 F1/F1b/F2.
--   §3 registers this migration (T-091/MIG-TOKENS pattern).
--
-- IDEMPOTENCY: `drop index if exists` + `drop function if exists` — safe to
-- re-apply.
--
-- OWNER-GATED LIVE APPLICATION (§15.77a): this session has NO DDL channel
-- (the sbp_ management token is invalid — the documented dead-PAT pattern;
-- the DB password is not provisioned). Apply with a FRESH token via
-- scripts/apply_0144_live.sh, then re-run the T-500 F3 probe (the
-- morning→both second-session upsert must 201, not 409) as the
-- verification. Until applied, the desktop's roll-call re-save with a
-- different session keeps failing for the whole batch (documented live
-- behavior — the repository is correct; the blocker is the index).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1. Drop the legacy session-blind unique index (0004 line 176)
-- ----------------------------------------------------------------------------
drop index if exists public.attendance_records_unique_session_uidx;

comment on index public.uq_attendance_canonical is
    'ATT-104 (0144): the ONE attendance uniqueness contract — (tenant_id, student_id, record_date, session). The legacy 0004 session-blind index attendance_records_unique_session_uidx is DROPPED by 0144 (a second session per student+class+date was impossible: 409 on every re-save with a different session, live-proven by T-500 F3).';

-- ----------------------------------------------------------------------------
-- §2. Reconcile the legacy 0022 record_roll_call RPC
-- ----------------------------------------------------------------------------
-- Its ON CONFLICT targets the dropped 0004 index expression → guaranteed
-- 42P10 after §1. Zero consumers in any repository (the desktop uses the
-- PostgREST upsert on uq_attendance_canonical; Android syncs through the
-- 0041-keyed upsert; the website never writes attendance). Dropped rather
-- than rewritten: the insert shape predates both `record_date` and
-- `session` and cannot target the canonical index.
drop function if exists public.record_roll_call(
    p_tenant_id uuid,
    p_class_id uuid,
    p_date date,
    p_records jsonb,
    p_teacher_profile_id uuid
);

-- ----------------------------------------------------------------------------
-- §3. Registration (T-091/MIG-TOKENS pattern)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0144', '{0144_drop_legacy_attendance_session_index.sql}', 'drop_legacy_attendance_session_index')
on conflict (version) do nothing;
