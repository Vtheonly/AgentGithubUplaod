-- ============================================================================
-- 0085_audit_logs_realtime_publication.sql — T-299 (OFFLINE-400, 46th session):
--                                          add audit_logs to the realtime publication
--
-- Problem OFFLINE-400 sub-gap 5: no realtime audit/notification broadcast on
-- either platform — a change made on the desktop reaches Android's DATA via
-- the table pulls but never reaches either platform's ACTIVITY surface as an
-- attributable event ("X (role) did Y to Z").
--
-- The fix: ONE subscription covers the whole mandate — every mutation already
-- writes an audit_logs entry (write_audit_log, migration 0014), so the
-- audit_logs INSERT stream IS the canonical "every change" feed. This
-- migration adds the table to the supabase_realtime publication so those
-- INSERT events flow to authenticated subscribers.
--
-- SECURITY (deliberate design — the T-299 registry entry records the
-- deviation from the task text's "widen the realtime-read path"):
--   * NO RLS policy changes. Realtime postgres-changes events are filtered
--     by each subscriber's SELECT policies (0019): super_admin +
--     financial_officer receive the full tenant stream (the audit audience
--     the Journal d'audit tab already serves), other staff receive their
--     OWN entries (actor_id = current_user_profile_id()).
--   * Widening audit_logs SELECT to all staff would have leaked the full
--     forensic trail (before/after JSON snapshots) to every role — a
--     §15.4-class RLS weakening. The attributed ACTIVITY broadcast rides the
--     roles that hold audit visibility; targeted staff alerts already have
--     their channel (notifications, role/user-targeted, migration 0075
--     fanout precedent).
--   * The table is append-only (0014 triggers block UPDATE/DELETE), so the
--     publication only ever carries INSERT events — full new rows, no
--     REPLICA IDENTITY change needed.
--
-- Append-only per AGENTS.md §15 rule 9. Idempotent-ish: ALTER PUBLICATION
-- ADD TABLE errors if already a member — guarded by a membership check.
-- ============================================================================

do $$
begin
    -- Add audit_logs to the realtime publication ONLY when it is not
    -- already a member (idempotent re-runs are safe).
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'audit_logs'
    ) then
        alter publication supabase_realtime add table public.audit_logs;
    end if;
end;
$$;
