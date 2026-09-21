-- ============================================================================
-- 0108_promotion_cycles.sql — T-403 (ACAD-503)
-- ============================================================================
-- The human-in-the-loop academic-year promotion workflow:
--
--   Academic Year → Promotion Cycle → Level/Grade → Class/Group → Student
--   decisions → Review → Confirm
--
-- Batch promotion is a BATCH operation in scope, but NOT a blind one-click
-- operation: the whole year is a managed CYCLE while each class/group is
-- reviewed and explicitly confirmed ONE AT A TIME.
--
--   §1  `promotion_cycles` — one row per (tenant, source academic year):
--       status draft → in_review → partially_processed → completed
--       (or cancelled); audit fields throughout.
--   §2  `promotion_cycle_classes` — one row per SOURCE-year class in the
--       cycle: status pending → in_review → processed (or exception /
--       skipped), the decision tallies, the processor + timestamp.
--   §3  `fn_create_promotion_cycle` — validates the source year, refuses a
--       second active cycle for the same source year, enumerates the
--       source-year classes with their live student counts.
--   §4  `fn_get_promotion_cycles` / `fn_get_promotion_cycle_classes` — the
--       read surfaces (aggregates computed from the class rows — no drift).
--   §5  `fn_confirm_promotion_cycle_class` — THE class-level confirmation:
--       locks the cycle + the class row, requires a decision for EVERY
--       active student of the class, enforces the incomplete-notes warning
--       (a two-phase ack), and executes the decisions through
--       execute_batch_promotion — the SAME canonical 0059/0107 RPC the
--       batch flow uses (ONE business-logic path — no second promotion
--       engine). Updates the class tallies + the cycle status + ONE audit
--       entry.
--   §6  `fn_reopen_promotion_cycle_class` — a processed class stays
--       auditable and reopenable (back to in_review) while the cycle is
--       not completed. Re-confirming goes through the SAME idempotent
--       upsert path.
--   §7  `fn_complete_promotion_cycle` — every class processed / exception /
--       skipped or the completion is refused with the list of what is
--       missing; flips is_current is deliberately NOT part of completion
--       (set_current_academic_year stays its own explicit operation).
--   §8  `fn_cancel_promotion_cycle`.
--
-- SAFETY / GUARDS (the 0055/0059/0107 hardening pattern):
--   * SECURITY INVOKER — the caller's RLS applies to every table touched.
--   * Caller-verified tenant resolution (current_tenant_id(); explicit
--     p_tenant_id only for service_role / global admins).
--   * The decisions themselves are validated by execute_batch_promotion
--     (the 0059 contract: any invalid or foreign-tenant decision rolls
--     back the WHOLE confirm — including the cycle-class row updates).
-- ============================================================================

-- ─── §1. promotion_cycles ──────────────────────────────────────────────────

create table if not exists public.promotion_cycles (
    id                    uuid        primary key default gen_random_uuid(),
    tenant_id             uuid        not null references public.tenants(id) on delete cascade,
    source_academic_year  text        not null,
    target_academic_year  text        not null,
    status                text        not null default 'draft'
                          check (status in ('draft', 'in_review', 'partially_processed', 'completed', 'cancelled')),
    notes                 text,
    created_by_profile_id uuid,
    created_by_name       text,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now(),
    completed_at          timestamptz,
    completed_by_name     text,
    -- ONE active cycle per source year per tenant (cancelled cycles free
    -- the slot for a fresh attempt).
    constraint promotion_cycles_active_source_key unique (tenant_id, source_academic_year)
);

comment on table public.promotion_cycles is
  'T-403: one human-in-the-loop promotion cycle per (tenant, source academic year). The whole year is managed as ONE cycle; each class is reviewed and confirmed one at a time via promotion_cycle_classes.';

-- ─── §2. promotion_cycle_classes ───────────────────────────────────────────

create table if not exists public.promotion_cycle_classes (
    id                 uuid        primary key default gen_random_uuid(),
    tenant_id          uuid        not null references public.tenants(id) on delete cascade,
    cycle_id           uuid        not null references public.promotion_cycles(id) on delete cascade,
    class_id           uuid        not null references public.classes(id) on delete cascade,
    class_code         text        not null,
    class_name         text        not null,
    grade_code         text        not null,
    status             text        not null default 'pending'
                       check (status in ('pending', 'in_review', 'processed', 'exception', 'skipped')),
    students_awaiting  integer     not null default 0,
    promoted_count     integer     not null default 0,
    repeating_count    integer     not null default 0,
    deferred_count     integer     not null default 0,
    exception_note     text,
    processed_by_name  text,
    processed_at       timestamptz,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    constraint promotion_cycle_classes_unique unique (cycle_id, class_id)
);

create index if not exists promotion_cycle_classes_cycle_idx on public.promotion_cycle_classes (cycle_id, status);

comment on table public.promotion_cycle_classes is
  'T-403: the per-class review state inside a promotion cycle. One row per source-year class; processed rows carry the decision tallies and remain auditable/reopenable.';

-- RLS: staff of the tenant manage the cycle (super_admin + support_staff —
-- the promotion is an admin operation; teachers READ for visibility).
alter table public.promotion_cycles enable row level security;
alter table public.promotion_cycle_classes enable row level security;

drop policy if exists promotion_cycles_staff_read on public.promotion_cycles;
create policy promotion_cycles_staff_read on public.promotion_cycles
  for select
  using (
    tenant_id = public.current_tenant_id()
    and public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text, 'teacher'::text])
  );

drop policy if exists promotion_cycles_admin_manage on public.promotion_cycles;
create policy promotion_cycles_admin_manage on public.promotion_cycles
  for all
  using (
    tenant_id = public.current_tenant_id()
    and public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text])
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text])
  );

drop policy if exists promotion_cycle_classes_staff_read on public.promotion_cycle_classes;
create policy promotion_cycle_classes_staff_read on public.promotion_cycle_classes
  for select
  using (
    tenant_id = public.current_tenant_id()
    and public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text, 'teacher'::text])
  );

drop policy if exists promotion_cycle_classes_admin_manage on public.promotion_cycle_classes;
create policy promotion_cycle_classes_admin_manage on public.promotion_cycle_classes
  for all
  using (
    tenant_id = public.current_tenant_id()
    and public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text])
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text])
  );

-- ─── shared tenant resolution helper (§0) ─────────────────────────────────

create or replace function public.fn_resolve_cycle_tenant(p_tenant_id uuid default null)
returns uuid
language plpgsql
stable
as $$
declare
    v_tenant uuid;
    v_caller_is_service_role boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
    v_tenant := public.current_tenant_id();
    if p_tenant_id is not null and (v_tenant is null or p_tenant_id <> v_tenant) then
        if not v_caller_is_service_role and not public.is_global_admin() then
            raise exception 'promotion cycle: caller tenant mismatch (p_tenant_id=%)', p_tenant_id
              using errcode = '42501';
        end if;
        v_tenant := p_tenant_id;
    end if;
    if v_tenant is null then
        raise exception 'promotion cycle: caller tenant unresolvable'
          using errcode = '42501';
    end if;
    return v_tenant;
end;
$$;

-- ─── §3. fn_create_promotion_cycle ─────────────────────────────────────────

create or replace function public.fn_create_promotion_cycle(
    p_source_academic_year text,
    p_target_academic_year text default null,
    p_actor_profile_id uuid default null,
    p_actor_name text default null,
    p_tenant_id uuid default null
)
returns jsonb
language plpgsql
as $$
declare
    v_tenant uuid := public.fn_resolve_cycle_tenant(p_tenant_id);
    v_source_year public.academic_years;
    v_target text;
    v_cycle public.promotion_cycles;
    v_count integer;
    v_classes integer;
begin
    if p_source_academic_year is null or btrim(p_source_academic_year) = '' then
        raise exception 'fn_create_promotion_cycle: p_source_academic_year is required'
          using errcode = '22023';
    end if;

    -- The source year must exist in the tenant (by code OR label — the
    -- fn_finalize_class_placements resolution convention).
    select * into v_source_year
      from public.academic_years ay
     where ay.tenant_id = v_tenant
       and (ay.code = p_source_academic_year or ay.label = p_source_academic_year)
     order by ay.is_current desc, ay.start_date desc
     limit 1;
    if v_source_year.id is null then
        raise exception 'fn_create_promotion_cycle: source academic year "%" not found in tenant (create it in Années scolaires first)', p_source_academic_year
          using errcode = '23503';
    end if;

    -- The target year defaults to source + 1 ("2026-2027" → "2027-2028").
    v_target := coalesce(nullif(btrim(p_target_academic_year), ''),
                         (regexp_replace(v_source_year.code, '^\d{4}', (substring(v_source_year.code from 1 for 4)::int + 1)::text)));
    if v_target is null or v_target = v_source_year.code then
        raise exception 'fn_create_promotion_cycle: target year "%" must differ from the source year "%"', coalesce(v_target, '(null)'), v_source_year.code
          using errcode = '22023';
    end if;

    -- ONE active cycle per source year (cancelled ones free the slot).
    select count(*) into v_count
      from public.promotion_cycles pc
     where pc.tenant_id = v_tenant
       and pc.source_academic_year = v_source_year.code
       and pc.status <> 'cancelled';
    if v_count > 0 then
        raise exception 'fn_create_promotion_cycle: an active cycle already exists for the year % (open it instead of creating a second one)', v_source_year.code
          using errcode = '23505';
    end if;

    insert into public.promotion_cycles (
        tenant_id, source_academic_year, target_academic_year, status,
        created_by_profile_id, created_by_name
    ) values (
        v_tenant, v_source_year.code, v_target, 'draft',
        p_actor_profile_id, coalesce(p_actor_name, '—')
    )
    returning * into v_cycle;

    -- Enumerate the source year's classes with their LIVE student counts.
    insert into public.promotion_cycle_classes (
        tenant_id, cycle_id, class_id, class_code, class_name, grade_code,
        status, students_awaiting
    )
    select v_tenant, v_cycle.id, c.id, c.code, coalesce(c.name, c.code),
           coalesce(c.grade_code, '?'), 'pending',
           (select count(*) from public.students s
             where s.class_id = c.id
               and s.tenant_id = v_tenant
               and s.deleted_at is null
               and s.is_active)
      from public.classes c
     where c.tenant_id = v_tenant
       and c.academic_year_id = v_source_year.id
       and c.is_active;

    select count(*) into v_classes
      from public.promotion_cycle_classes pcc
     where pcc.cycle_id = v_cycle.id;

    perform public.write_audit_log(
        p_tenant_id   := v_tenant,
        p_action      := 'promotion.cycle_create',
        p_entity_type := 'promotion_cycle',
        p_entity_id   := v_cycle.id,
        p_actor_id    := p_actor_profile_id,
        p_actor_name  := p_actor_name,
        p_after_json   := jsonb_build_object(
                             'source_academic_year', v_cycle.source_academic_year,
                             'target_academic_year', v_cycle.target_academic_year,
                             'classes', v_classes
                         ),
        p_note         := format('Cycle de promotion créé pour %s → %s : %s classe(s) à examiner.', v_cycle.source_academic_year, v_cycle.target_academic_year, v_classes)
    );

    return jsonb_build_object(
        'ok', true,
        'cycle_id', v_cycle.id,
        'source_academic_year', v_cycle.source_academic_year,
        'target_academic_year', v_cycle.target_academic_year,
        'classes_count', v_classes
    );
end;
$$;

-- ─── §4. the read surfaces ─────────────────────────────────────────────────

create or replace function public.fn_get_promotion_cycles(
    p_tenant_id uuid default null
)
returns table (
    id uuid,
    source_academic_year text,
    target_academic_year text,
    status text,
    notes text,
    created_by_name text,
    created_at timestamptz,
    updated_at timestamptz,
    completed_at timestamptz,
    completed_by_name text,
    classes_total integer,
    classes_processed integer,
    students_awaiting integer,
    promoted_count integer,
    repeating_count integer,
    deferred_count integer
)
language plpgsql
stable
as $$
declare
    v_tenant uuid := public.fn_resolve_cycle_tenant(p_tenant_id);
begin
    return query
    select pc.id,
           pc.source_academic_year,
           pc.target_academic_year,
           pc.status,
           pc.notes,
           pc.created_by_name,
           pc.created_at,
           pc.updated_at,
           pc.completed_at,
           pc.completed_by_name,
           (select count(*)::int from public.promotion_cycle_classes pcc where pcc.cycle_id = pc.id),
           (select count(*)::int from public.promotion_cycle_classes pcc where pcc.cycle_id = pc.id and pcc.status = 'processed'),
           (select coalesce(sum(pcc.students_awaiting), 0)::int from public.promotion_cycle_classes pcc where pcc.cycle_id = pc.id and pcc.status not in ('processed', 'skipped')),
           (select coalesce(sum(pcc.promoted_count), 0)::int from public.promotion_cycle_classes pcc where pcc.cycle_id = pc.id),
           (select coalesce(sum(pcc.repeating_count), 0)::int from public.promotion_cycle_classes pcc where pcc.cycle_id = pc.id),
           (select coalesce(sum(pcc.deferred_count), 0)::int from public.promotion_cycle_classes pcc where pcc.cycle_id = pc.id)
      from public.promotion_cycles pc
     where pc.tenant_id = v_tenant
     order by pc.source_academic_year desc, pc.created_at desc;
end;
$$;

create or replace function public.fn_get_promotion_cycle_classes(
    p_cycle_id uuid,
    p_tenant_id uuid default null
)
returns table (
    id uuid,
    cycle_id uuid,
    class_id uuid,
    class_code text,
    class_name text,
    grade_code text,
    status text,
    students_awaiting integer,
    promoted_count integer,
    repeating_count integer,
    deferred_count integer,
    exception_note text,
    processed_by_name text,
    processed_at timestamptz
)
language plpgsql
stable
as $$
declare
    v_tenant uuid := public.fn_resolve_cycle_tenant(p_tenant_id);
begin
    return query
    select pcc.id, pcc.cycle_id, pcc.class_id, pcc.class_code, pcc.class_name,
           pcc.grade_code, pcc.status, pcc.students_awaiting,
           pcc.promoted_count, pcc.repeating_count, pcc.deferred_count,
           pcc.exception_note, pcc.processed_by_name, pcc.processed_at
      from public.promotion_cycle_classes pcc
     where pcc.tenant_id = v_tenant
       and pcc.cycle_id = p_cycle_id
     order by pcc.grade_code asc, pcc.class_code asc;
end;
$$;

-- ─── §5. fn_confirm_promotion_cycle_class ─────────────────────────────────

create or replace function public.fn_confirm_promotion_cycle_class(
    p_cycle_id uuid,
    p_class_id uuid,
    p_decisions jsonb,
    p_ack_incomplete_notes boolean default false,
    p_actor_profile_id uuid default null,
    p_actor_name text default null,
    p_tenant_id uuid default null
)
returns jsonb
language plpgsql
as $$
declare
    v_tenant uuid := public.fn_resolve_cycle_tenant(p_tenant_id);
    v_cycle public.promotion_cycles;
    v_class_row public.promotion_cycle_classes;
    v_decision jsonb;
    v_student_id uuid;
    v_declared_ids uuid[] := '{}';
    v_missing_ids uuid[] := '{}';
    v_missing_list text;
    v_incomplete_count integer := 0;
    v_incomplete_names text;
    v_promoted integer := 0;
    v_repeated integer := 0;
    v_deferred integer := 0;
    v_result jsonb;
begin
    if p_decisions is null or jsonb_typeof(p_decisions) <> 'array' then
        raise exception 'fn_confirm_promotion_cycle_class: p_decisions must be a JSON array'
          using errcode = '22023';
    end if;

    -- Lock the cycle row (the human-in-the-loop unit — one year at a time).
    select * into v_cycle
      from public.promotion_cycles pc
     where pc.id = p_cycle_id
       and pc.tenant_id = v_tenant
     for update;
    if v_cycle.id is null then
        raise exception 'fn_confirm_promotion_cycle_class: cycle % not found in tenant', p_cycle_id
          using errcode = '23503';
    end if;
    if v_cycle.status in ('completed', 'cancelled') then
        raise exception 'fn_confirm_promotion_cycle_class: the cycle for % is % — it can no longer be modified', v_cycle.source_academic_year, v_cycle.status
          using errcode = '55006';
    end if;

    -- Lock the class row (the review unit — one class at a time).
    select * into v_class_row
      from public.promotion_cycle_classes pcc
     where pcc.cycle_id = p_cycle_id
       and pcc.class_id = p_class_id
       and pcc.tenant_id = v_tenant
     for update;
    if v_class_row.id is null then
        raise exception 'fn_confirm_promotion_cycle_class: class % is not part of cycle %', p_class_id, p_cycle_id
          using errcode = '23503';
    end if;
    if v_class_row.status in ('processed', 'exception', 'skipped') then
        raise exception 'fn_confirm_promotion_cycle_class: the class % is already % (reopen it first if you need to re-confirm)', v_class_row.class_name, v_class_row.status
          using errcode = '55006';
    end if;

    -- ── Rule: EVERY active student of the class must have a decision ──
    select array_agg(d ->> 'student_id') into v_declared_ids
      from jsonb_array_elements(p_decisions) d;
    select array_agg(s.id) into v_missing_ids
      from public.students s
     where s.class_id = p_class_id
       and s.tenant_id = v_tenant
       and s.deleted_at is null
       and s.is_active
       and not (s.id = any (coalesce(v_declared_ids, '{}'::uuid[])));
    if v_missing_ids is not null and array_length(v_missing_ids, 1) > 0 then
        select string_agg(s.first_name || ' ' || s.last_name, ', ')
          into v_missing_list
          from public.students s
         where s.id = any (v_missing_ids);
        raise exception 'fn_confirm_promotion_cycle_class: every élève de la classe doit avoir une décision — manquants : %', coalesce(v_missing_list, array_to_string(v_missing_ids, ', '))
          using errcode = '22023';
    end if;

    -- ── The incomplete-notes warning (the two-phase ack) ──
    -- A student's notes are incomplete when ANY of their assessment rows
    -- for the source year has a missing mark, or when they have NO
    -- assessment rows at all. The T-336 honesty rule: never silently treat
    -- missing grades as zero.
    with class_students as (
        select s.id, s.first_name, s.last_name
          from public.students s
         where s.class_id = p_class_id
           and s.tenant_id = v_tenant
           and s.deleted_at is null
           and s.is_active
    ),
    incomplete as (
        select cs.id, cs.first_name || ' ' || cs.last_name as name
          from class_students cs
         where not exists (
                select 1 from public.assessments a
                 where a.student_id = cs.id
                   and a.devoir1 is not null
                   and a.devoir2 is not null
                   and a.examen is not null
                   and a.academic_year = v_cycle.source_academic_year
              )
    )
    select count(*)::int, coalesce(string_agg(name, ', '), '')
      into v_incomplete_count, v_incomplete_names
      from incomplete;

    if v_incomplete_count > 0 and coalesce(p_ack_incomplete_notes, false) is false then
        raise exception '[NOTES_INCOMPLETES] Les notes ne sont pas encore toutes renseignées (%s élève(s) : %s). Êtes-vous sûr de vouloir continuer ?',
            v_incomplete_count, coalesce(v_incomplete_names, '—')
          using errcode = 'P0001';
    end if;

    -- ── THE canonical execution: the SAME atomic RPC the batch flow uses
    -- (ONE business-logic path — the 0059/0107 contract validates and
    -- applies the decisions, archives the histories with the classification
    -- stamp, advances the grades, writes the student.promote audit). ──
    select public.execute_batch_promotion(
               p_decisions,
               p_actor_profile_id,
               coalesce(p_actor_name, 'Cycle de promotion'),
               v_tenant
           ) into v_result;

    -- ── The tallies + the class-row flip (same transaction) ──
    select
        count(*) filter (where d ->> 'decision' = 'promoted')::int,
        count(*) filter (where d ->> 'decision' = 'repeated')::int,
        count(*) filter (where d ->> 'decision' in ('transferred', 'graduated'))::int
      into v_promoted, v_repeated, v_deferred
      from jsonb_array_elements(p_decisions) d;

    update public.promotion_cycle_classes pcc
       set status = 'processed',
           students_awaiting = 0,
           promoted_count = v_promoted,
           repeating_count = v_repeated,
           deferred_count = v_deferred,
           processed_by_name = coalesce(p_actor_name, '—'),
           processed_at = now(),
           updated_at = now()
     where pcc.id = v_class_row.id;

    -- The cycle graduates draft → (in_review|partially_processed).
    update public.promotion_cycles pc
       set status = case when pc.status in ('draft', 'in_review') then 'partially_processed' else pc.status end,
           updated_at = now()
     where pc.id = p_cycle_id;

    perform public.write_audit_log(
        p_tenant_id   := v_tenant,
        p_action      := 'promotion.cycle_class_confirm',
        p_entity_type := 'promotion_cycle',
        p_entity_id   := p_cycle_id,
        p_actor_id     := p_actor_profile_id,
        p_actor_name  := p_actor_name,
        p_after_json   := jsonb_build_object(
                             'class', v_class_row.class_name,
                             'promoted', v_promoted,
                             'repeated', v_repeated,
                             'deferred', v_deferred,
                             'incomplete_notes_acked', coalesce(p_ack_incomplete_notes, false),
                             'incomplete_notes_count', v_incomplete_count
                         ),
        p_note         := format('Classe %s confirmée dans le cycle %s → %s : %s promu(s), %s redoublant(s), %s dérogation(s).',
                                v_class_row.class_name, v_cycle.source_academic_year, v_cycle.target_academic_year,
                                v_promoted, v_repeated, v_deferred)
    );

    return jsonb_build_object(
        'ok', true,
        'cycle_id', p_cycle_id,
        'class_id', p_class_id,
        'class_name', v_class_row.class_name,
        'promoted', v_promoted,
        'repeated', v_repeated,
        'deferred', v_deferred,
        'incomplete_notes_count', v_incomplete_count,
        'incomplete_notes_acked', coalesce(p_ack_incomplete_notes, false)
    );
end;
$$;

-- ─── §6. fn_reopen_promotion_cycle_class ──────────────────────────────────

create or replace function public.fn_reopen_promotion_cycle_class(
    p_cycle_id uuid,
    p_class_id uuid,
    p_reason text default null,
    p_actor_profile_id uuid default null,
    p_actor_name text default null,
    p_tenant_id uuid default null
)
returns jsonb
language plpgsql
as $$
declare
    v_tenant uuid := public.fn_resolve_cycle_tenant(p_tenant_id);
    v_cycle public.promotion_cycles;
    v_class_row public.promotion_cycle_classes;
    v_awaiting integer;
begin
    select * into v_cycle
      from public.promotion_cycles pc
     where pc.id = p_cycle_id and pc.tenant_id = v_tenant
     for update;
    if v_cycle.id is null then
        raise exception 'fn_reopen_promotion_cycle_class: cycle % not found in tenant', p_cycle_id
          using errcode = '23503';
    end if;
    if v_cycle.status in ('completed', 'cancelled') then
        raise exception 'fn_reopen_promotion_cycle_class: the cycle for % is % — its classes can no longer be reopened', v_cycle.source_academic_year, v_cycle.status
          using errcode = '55006';
    end if;

    select * into v_class_row
      from public.promotion_cycle_classes pcc
     where pcc.cycle_id = p_cycle_id and pcc.class_id = p_class_id and pcc.tenant_id = v_tenant
     for update;
    if v_class_row.id is null then
        raise exception 'fn_reopen_promotion_cycle_class: class % is not part of cycle %', p_class_id, p_cycle_id
          using errcode = '23503';
    end if;
    if v_class_row.status not in ('processed', 'exception', 'skipped') then
        raise exception 'fn_reopen_promotion_cycle_class: the class % is % — nothing to reopen', v_class_row.class_name, v_class_row.status
          using errcode = '55006';
    end if;

    -- The live awaiting count for a reopened review.
    select count(*) into v_awaiting
      from public.students s
     where s.class_id = p_class_id
       and s.tenant_id = v_tenant
       and s.deleted_at is null
       and s.is_active;

    update public.promotion_cycle_classes pcc
       set status = 'in_review',
           students_awaiting = v_awaiting,
           exception_note = null,
           updated_at = now()
     where pcc.id = v_class_row.id;

    perform public.write_audit_log(
        p_tenant_id   := v_tenant,
        p_action      := 'promotion.cycle_class_reopen',
        p_entity_type := 'promotion_cycle',
        p_entity_id   := p_cycle_id,
        p_actor_id    := p_actor_profile_id,
        p_actor_name  := p_actor_name,
        p_after_json   := jsonb_build_object('class', v_class_row.class_name, 'reason', p_reason),
        p_note         := format('Classe %s rouverte dans le cycle %s → %s.', v_class_row.class_name, v_cycle.source_academic_year, v_cycle.target_academic_year)
    );

    return jsonb_build_object('ok', true, 'class_name', v_class_row.class_name, 'status', 'in_review');
end;
$$;

-- ─── §7. fn_complete_promotion_cycle ──────────────────────────────────────

create or replace function public.fn_complete_promotion_cycle(
    p_cycle_id uuid,
    p_actor_profile_id uuid default null,
    p_actor_name text default null,
    p_tenant_id uuid default null
)
returns jsonb
language plpgsql
as $$
declare
    v_tenant uuid := public.fn_resolve_cycle_tenant(p_tenant_id);
    v_cycle public.promotion_cycles;
    v_pending text;
begin
    select * into v_cycle
      from public.promotion_cycles pc
     where pc.id = p_cycle_id and pc.tenant_id = v_tenant
     for update;
    if v_cycle.id is null then
        raise exception 'fn_complete_promotion_cycle: cycle % not found in tenant', p_cycle_id
          using errcode = '23503';
    end if;
    if v_cycle.status = 'completed' then
        raise exception 'fn_complete_promotion_cycle: the cycle for % is already completed', v_cycle.source_academic_year
          using errcode = '55006';
    end if;
    if v_cycle.status = 'cancelled' then
        raise exception 'fn_complete_promotion_cycle: the cycle for % is cancelled — it cannot be completed', v_cycle.source_academic_year
          using errcode = '55006';
    end if;

    -- EVERY class must be processed / exception / skipped.
    select string_agg(pcc.class_name, ', ') into v_pending
      from public.promotion_cycle_classes pcc
     where pcc.cycle_id = p_cycle_id
       and pcc.status not in ('processed', 'exception', 'skipped');
    if v_pending is not null then
        raise exception 'fn_complete_promotion_cycle: le cycle ne peut pas être terminé — classes restant à traiter : %', v_pending
          using errcode = '22023';
    end if;

    update public.promotion_cycles pc
       set status = 'completed',
           completed_at = now(),
           completed_by_name = coalesce(p_actor_name, '—'),
           updated_at = now()
     where pc.id = p_cycle_id
    returning * into v_cycle;

    perform public.write_audit_log(
        p_tenant_id   := v_tenant,
        p_action      := 'promotion.cycle_complete',
        p_entity_type := 'promotion_cycle',
        p_entity_id   := p_cycle_id,
        p_actor_id    := p_actor_profile_id,
        p_actor_name  := p_actor_name,
        p_after_json   := (select jsonb_build_object(
                               'source_academic_year', pc.source_academic_year,
                               'target_academic_year', pc.target_academic_year,
                               'classes', (select count(*) from public.promotion_cycle_classes pcc where pcc.cycle_id = pc.id),
                               'promoted', (select coalesce(sum(pcc.promoted_count), 0) from public.promotion_cycle_classes pcc where pcc.cycle_id = pc.id),
                               'repeated', (select coalesce(sum(pcc.repeating_count), 0) from public.promotion_cycle_classes pcc where pcc.cycle_id = pc.id)
                           ) from public.promotion_cycles pc where pc.id = p_cycle_id),
        p_note         := format('Cycle de promotion %s → %s TERMINÉ.', v_cycle.source_academic_year, v_cycle.target_academic_year)
    );

    return jsonb_build_object(
        'ok', true,
        'cycle_id', p_cycle_id,
        'status', 'completed'
    );
end;
$$;

-- ─── §8. fn_cancel_promotion_cycle ────────────────────────────────────────

create or replace function public.fn_cancel_promotion_cycle(
    p_cycle_id uuid,
    p_reason text default null,
    p_actor_profile_id uuid default null,
    p_actor_name text default null,
    p_tenant_id uuid default null
)
returns jsonb
language plpgsql
as $$
declare
    v_tenant uuid := public.fn_resolve_cycle_tenant(p_tenant_id);
    v_cycle public.promotion_cycles;
begin
    select * into v_cycle
      from public.promotion_cycles pc
     where pc.id = p_cycle_id and pc.tenant_id = v_tenant
     for update;
    if v_cycle.id is null then
        raise exception 'fn_cancel_promotion_cycle: cycle % not found in tenant', p_cycle_id
          using errcode = '23503';
    end if;
    if v_cycle.status = 'completed' then
        raise exception 'fn_cancel_promotion_cycle: the cycle for % is completed — it cannot be cancelled (its history is immutable)', v_cycle.source_academic_year
          using errcode = '55006';
    end if;
    if v_cycle.status = 'cancelled' then
        raise exception 'fn_cancel_promotion_cycle: the cycle for % is already cancelled', v_cycle.source_academic_year
          using errcode = '55006';
    end if;

    update public.promotion_cycles pc
       set status = 'cancelled',
           notes = coalesce(p_reason, notes),
           updated_at = now()
     where pc.id = p_cycle_id;

    perform public.write_audit_log(
        p_tenant_id   := v_tenant,
        p_action      := 'promotion.cycle_cancel',
        p_entity_type := 'promotion_cycle',
        p_entity_id   := p_cycle_id,
        p_actor_id    := p_actor_profile_id,
        p_actor_name  := p_actor_name,
        p_after_json   := jsonb_build_object('reason', p_reason),
        p_note         := format('Cycle de promotion %s → %s ANNULÉ.', v_cycle.source_academic_year, v_cycle.target_academic_year)
    );

    return jsonb_build_object('ok', true, 'cycle_id', p_cycle_id, 'status', 'cancelled');
end;
$$;

comment on function public.fn_confirm_promotion_cycle_class is
  'T-403: the ONE class-level confirmation of the human-in-the-loop promotion cycle. Requires a decision for EVERY active student of the class; enforces the incomplete-notes warning (two-phase ack — the [NOTES_INCOMPLETES] exception must be re-submitted with p_ack_incomplete_notes=true); executes through the canonical execute_batch_promotion RPC (0059/0107 — ONE business path).';

-- ----------------------------------------------------------------------------
-- Grants (the 0096/0107 convention — tenant-guarded functions fail closed
-- at the tenant resolution for anon callers).
-- ----------------------------------------------------------------------------
revoke all on function public.fn_create_promotion_cycle(text, text, uuid, text, uuid) from public;
grant execute on function public.fn_create_promotion_cycle(text, text, uuid, text, uuid) to authenticated, service_role, anon;
revoke all on function public.fn_get_promotion_cycles(uuid) from public;
grant execute on function public.fn_get_promotion_cycles(uuid) to authenticated, service_role, anon;
revoke all on function public.fn_get_promotion_cycle_classes(uuid, uuid) from public;
grant execute on function public.fn_get_promotion_cycle_classes(uuid, uuid) to authenticated, service_role, anon;
revoke all on function public.fn_confirm_promotion_cycle_class(uuid, uuid, jsonb, boolean, uuid, text, uuid) from public;
grant execute on function public.fn_confirm_promotion_cycle_class(uuid, uuid, jsonb, boolean, uuid, text, uuid) to authenticated, service_role, anon;
revoke all on function public.fn_reopen_promotion_cycle_class(uuid, uuid, text, uuid, text, uuid) from public;
grant execute on function public.fn_reopen_promotion_cycle_class(uuid, uuid, text, uuid, text, uuid) to authenticated, service_role, anon;
revoke all on function public.fn_complete_promotion_cycle(uuid, uuid, text, uuid) from public;
grant execute on function public.fn_complete_promotion_cycle(uuid, uuid, text, uuid) to authenticated, service_role, anon;
revoke all on function public.fn_cancel_promotion_cycle(uuid, text, uuid, text, uuid) from public;
grant execute on function public.fn_cancel_promotion_cycle(uuid, text, uuid, text, uuid) to authenticated, service_role, anon;

-- ----------------------------------------------------------------------------
-- Registration (T-091/MIG-TOKENS pattern — the apply script embeds this so
-- the DDL and the registration land in ONE atomic transaction).
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0108', '{0108_promotion_cycles.sql}', 'promotion_cycles')
on conflict (version) do nothing;
