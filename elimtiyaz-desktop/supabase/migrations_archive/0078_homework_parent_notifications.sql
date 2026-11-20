-- ============================================================================
-- 0078_homework_parent_notifications.sql — HOMEWORK PUSH FAN-OUT (T-193)
-- ============================================================================
-- OWNER MANDATE (2026-09-05, 30th session): "fix the messaging system …
-- across all platforms". The homework push path is a committed messaging
-- surface that PROMISED delivery but never delivered: the desktop's
-- homework-push-modal claims "sera notifié aux parents", yet the repository
-- only INSERTs the `homework` row — the old `push-homework-notification`
-- Edge Function never existed (dead invoke removed in T-023/HOMEWORK-100)
-- and NOTHING has ever created a notification for a homework push
-- (T-036/PUSH-100 deferred the parent-notification decision; the 30th
-- session owner mandate resolves it: notifications are the in-app
-- delivery layer, FCM push remains owner-secret-gated).
--
-- MSG-201 — a homework INSERT now fans out one notification per DISTINCT
-- parent of the class's ACTIVE students (parents WITH an active portal
-- account only — the same honest-delivery contract as 0077).
--
-- DESIGN NOTES:
--
--   * Server-side trigger (canonical — works for desktop, Android and any
--     future writer; the desktop repository keeps its row INSERT and adds
--     nothing client-side).
--   * SECURITY DEFINER per the 0061/0075 convention: homework rows are
--     inserted by STAFF under `homework_canonical_write` (tenant-scoped),
--     while notifications_insert (0048) is staff-or-self-gated — a definer
--     trigger is required for the fan-out to land. The body only targets
--     parents derived from the class roster of the inserted row (no
--     client-injectable target), so no authorization surface is weakened.
--   * Deduplicated: DISTINCT parent_id (siblings in the same class produce
--     ONE notification per parent).
--   * link_entity_type 'homework' → the website's linkEntityTypeToView maps
--     it to the homework view; the Android hub routes to the homework
--     screen (T-196 adds the 'homework' case); the desktop shows the modal.
--   * kind 'info' (the domain 'homework' type maps through KIND_TO_TYPE),
--     priority 'medium', source 'system', source_label 'Devoirs'.
--   * The due date is rendered into the body (fr-FR ISO date — the same
--     format the portal homework list uses).
--
-- IDEMPOTENCY: drop-trigger-if-exists + create-or-replace — safe to re-apply.
--
-- Per AGENTS.md §15 rule 10 (T-091/MIG-TOKENS pattern): this file is applied
-- to the live project TOGETHER with its schema_migrations registration in
-- one atomic transaction (scripts/apply_0078_live.sh).
-- ============================================================================

create or replace function public.notify_parents_on_homework()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.notifications (
        tenant_id, kind, title, body, priority,
        source, source_label,
        target_user_id,
        link_entity_type, link_entity_id,
        created_by, triggered_at
    )
    select distinct
        new.tenant_id,
        'info',
        'Nouveau devoir — ' || coalesce(new.subject_name, 'Matière'),
        left(
            new.title ||
            case when btrim(coalesce(new.description, '')) <> ''
                     then ' — ' || left(btrim(new.description), 120)
                 else ''
            end ||
            case when new.due_date is not null
                     then ' (à rendre le ' || to_char(new.due_date, 'DD/MM/YYYY') || ')'
                 else ''
            end,
            200
        ),
        'medium',
        'system',
        'Devoirs',
        up.id,
        'homework',
        new.id,
        new.teacher_id,
        now()
      from public.students s
      join public.parents p on p.id = s.parent_id and p.tenant_id = new.tenant_id
      join public.user_profiles up on up.auth_user_id = p.auth_user_id and up.status = 'active'
     where s.class_id = new.class_id
       and s.tenant_id = new.tenant_id
       and s.is_active = true
       and s.deleted_at is null
       and s.enrollment_status = 'active'
       and p.deleted_at is null
       and p.auth_user_id is not null;

    return new;
end;
$$;

comment on function public.notify_parents_on_homework is
  'MSG-201: fan out one notification per distinct parent (with an ACTIVE portal account) of the class roster on every homework INSERT. SECURITY DEFINER per the 0061/0075 convention — only roster-derived targets, no client-injectable destination.';

drop trigger if exists homework_notify_parents on public.homework;
create trigger homework_notify_parents
    after insert on public.homework
    for each row execute function public.notify_parents_on_homework();

-- ----------------------------------------------------------------------------
-- Registration row (T-091/MIG-TOKENS pattern — scripts/apply_0078_live.sh
-- embeds this so the DDL and the registration land in ONE atomic
-- transaction; ON CONFLICT keeps it idempotent.)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0078', '{0078_homework_parent_notifications.sql}', 'homework_parent_notifications')
on conflict (version) do nothing;
