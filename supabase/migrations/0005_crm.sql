-- ============================================================================
-- 0005_crm.sql
-- ============================================================================
-- Parent/guardian master records + students + family links + activation codes.
--
-- Per plan §04:
--   - Parent-first: student cannot exist without parent (parent_id NOT NULL FK)
--   - Unlimited 1→N children (no 4-child cap)
--   - Bidirectional navigation (parent ↔ student)
--   - Activation codes: 6-7 digit, single-use, bind to exactly one parent profile
--   - Soft-delete (deleted_at); RLS hides deleted rows
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. parents — master billing entity
-- ----------------------------------------------------------------------------
create table public.parents (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    parent_code     text        not null,                          -- 'PAR-2026-A4F9' (human-readable)
    first_name      text        not null,
    last_name       text        not null,
    primary_phone   text        not null,
    secondary_phone text,
    email           text,
    national_id     text,                                          -- Algerian NN (10 digits)
    occupation      text,
    address         text,
    city            text,
    postal_code     text,
    relationship    text        check (relationship in ('father', 'mother', 'guardian', 'other')),
    notes           text,
    is_active       boolean     not null default true,
    is_financially_restricted boolean not null default false,
    auth_user_id    uuid,                                          -- bound on activation (account_approval_requests)
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    deleted_at      timestamptz,
    unique (tenant_id, parent_code)
);

create unique index parents_email_uidx on public.parents (tenant_id, email) where email is not null and deleted_at is null;
create unique index parents_national_id_uidx on public.parents (tenant_id, national_id) where national_id is not null and deleted_at is null;
create index parents_tenant_active_idx on public.parents (tenant_id, last_name, first_name) where deleted_at is null;
create index parents_phone_idx on public.parents (primary_phone);
create index parents_trgm_idx on public.parents using gin (last_name extensions.gin_trgm_ops, first_name extensions.gin_trgm_ops);

comment on table public.parents is
  'Master billing entity. A parent may have N students. Soft-deleted via deleted_at; RLS hides deleted rows.';

-- ----------------------------------------------------------------------------
-- 2. students — child enrolled in academic programs
-- ----------------------------------------------------------------------------
create table public.students (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    parent_id       uuid        not null references public.parents(id) on delete restrict,
    student_code    text        not null,                          -- 'ELV-2026-001234'
    first_name      text        not null,
    middle_name     text,
    last_name       text        not null,
    date_of_birth   date        not null,
    gender          text        check (gender in ('male', 'female', 'other')),
    grade_level_id  uuid        references public.academic_levels(id) on delete restrict,
    class_id        uuid        references public.classes(id) on delete set null,
    enrollment_date date        not null default current_date,
    enrollment_status text      not null default 'active' check (enrollment_status in ('inquiry', 'quoted', 'enrolled', 'active', 'withdrawn', 'graduated')),
    medical_notes   text,
    is_active       boolean     not null default true,
    auth_user_id    uuid,                                          -- bound on activation (for student web login)
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    deleted_at      timestamptz,
    unique (tenant_id, student_code)
);

create index students_parent_idx on public.students (parent_id) where deleted_at is null;
create index students_tenant_active_idx on public.students (tenant_id, last_name, first_name) where deleted_at is null;
create index students_class_idx on public.students (class_id) where class_id is not null and deleted_at is null;
create index students_grade_level_idx on public.students (grade_level_id);
create index students_trgm_idx on public.students using gin (last_name extensions.gin_trgm_ops, first_name extensions.gin_trgm_ops);

comment on table public.students is
  'Child enrolled in academic programs. parent_id is NOT NULL FK (parent-first rule, plan §04.01). Soft-deleted via deleted_at.';

-- ----------------------------------------------------------------------------
-- 3. parent_student_links — optional junction for multi-guardian families
-- ----------------------------------------------------------------------------
create table public.parent_student_links (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    parent_id       uuid        not null references public.parents(id) on delete cascade,
    student_id      uuid        not null references public.students(id) on delete cascade,
    relationship    text        check (relationship in ('father', 'mother', 'guardian', 'other')),
    is_primary      boolean     not null default false,
    created_at      timestamptz not null default now(),
    unique (tenant_id, parent_id, student_id)
);

create index parent_student_links_student_idx on public.parent_student_links (student_id);
create index parent_student_links_parent_idx on public.parent_student_links (parent_id);

-- ----------------------------------------------------------------------------
-- 4. activation_codes — 6-7 digit, single-use binding codes
-- ----------------------------------------------------------------------------
create table public.activation_codes (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    code            text        not null,                          -- 6-7 digit numeric
    parent_id       uuid        references public.parents(id) on delete cascade,
    student_id      uuid        references public.students(id) on delete cascade,  -- for student login activation
    issued_by       uuid,                                          -- user_profiles.id (admin)
    issued_at       timestamptz not null default now(),
    bound_to_auth_user_id uuid,                                    -- auth.users.id, set on activation
    bound_at        timestamptz,
    expires_at      timestamptz not null default (now() + interval '30 days'),
    unique (tenant_id, code)
);

create index activation_codes_lookup_idx on public.activation_codes (tenant_id, code) where bound_to_auth_user_id is null;
create index activation_codes_parent_idx on public.activation_codes (parent_id);

comment on table public.activation_codes is
  '6-7 digit single-use codes that bind a parent''s auth.users.id to their master parent profile + all N students. Plan §06.';

-- ----------------------------------------------------------------------------
-- 5. student_documents — medical certificates, contracts, justification letters
-- ----------------------------------------------------------------------------
create table public.student_documents (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    student_id      uuid        not null references public.students(id) on delete cascade,
    kind            text        not null check (kind in (
                        'birth_certificate', 'medical_certificate', 'contract',
                        'justification_letter', 'id_photo', 'report_card', 'other'
                    )),
    file_name       text        not null,
    storage_path    text        not null,                          -- path under bucket 'student-documents'
    mime_type       text,
    size_bytes      bigint,
    uploaded_by     uuid,                                          -- user_profiles.id
    uploaded_at     timestamptz not null default now(),
    description     text
);

create index student_documents_student_idx on public.student_documents (student_id, uploaded_at desc);

-- ----------------------------------------------------------------------------
-- 6. Triggers
-- ----------------------------------------------------------------------------
create trigger parents_touch_updated_at before update on public.parents
    for each row execute function public.touch_updated_at();
create trigger students_touch_updated_at before update on public.students
    for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 7. Function: generate activation code (6-7 digit, unique within tenant)
-- ----------------------------------------------------------------------------
create or replace function public.generate_activation_code(p_tenant_id uuid)
returns text
language plpgsql
security definer
as $$
declare
    v_code text;
    v_attempts integer := 0;
begin
    loop
        v_code := lpad((floor(random() * 9000000 + 1000000))::text, 7, '0');
        v_attempts := v_attempts + 1;
        if not exists (
            select 1 from public.activation_codes
             where tenant_id = p_tenant_id
               and code = v_code
               and bound_to_auth_user_id is null
        ) then
            return v_code;
        end if;
        exit when v_attempts > 100;
    end loop;
    raise exception 'Could not generate unique activation code after 100 attempts';
end;
$$;

comment on function public.generate_activation_code is
  'Generates a 7-digit numeric activation code, ensuring uniqueness within the tenant for unbound codes.';

-- ----------------------------------------------------------------------------
-- 8. Function: bind activation code to auth.users.id (called from Edge Function)
-- ----------------------------------------------------------------------------
create or replace function public.bind_activation_code(
    p_tenant_id uuid,
    p_code text,
    p_auth_user_id uuid
)
returns table(parent_id uuid, parent_full_name text, student_count bigint)
language plpgsql
security definer
as $$
declare
    v_activation record;
    v_parent_id uuid;
begin
    -- Lock the activation code row
    select * into v_activation
      from public.activation_codes
     where tenant_id = p_tenant_id
       and code = p_code
       and bound_to_auth_user_id is null
     for update;

    if not found then
        raise exception 'Invalid or already-used activation code';
    end if;

    if v_activation.expires_at < now() then
        raise exception 'Activation code has expired';
    end if;

    v_parent_id := v_activation.parent_id;

    -- Mark the code as bound
    update public.activation_codes
       set bound_to_auth_user_id = p_auth_user_id,
           bound_at = now()
     where id = v_activation.id;

    -- Bind the auth.users.id to the parent record
    update public.parents
       set auth_user_id = p_auth_user_id
     where id = v_parent_id;

    -- Return parent + student count for the response
    return query
        select p.id as parent_id,
               (p.first_name || ' ' || p.last_name) as parent_full_name,
               count(s.id)::bigint as student_count
          from public.parents p
          left join public.students s on s.parent_id = p.id and s.deleted_at is null
         where p.id = v_parent_id
         group by p.id, p.first_name, p.last_name;
end;
$$;

comment on function public.bind_activation_code is
  'Atomically binds an activation code to the calling user''s auth.users.id. Marks code as used. Updates parents.auth_user_id. Returns parent info + student count.';

-- ----------------------------------------------------------------------------
-- 9. Function: approve account request (called from admin UI / Edge Function)
-- ----------------------------------------------------------------------------
create or replace function public.approve_account_request(
    p_request_id uuid,
    p_reviewer_profile_id uuid,
    p_target_parent_id uuid default null,
    p_target_student_id uuid default null,
    p_decision_note text default null
)
returns uuid  -- the role_id assigned
language plpgsql
security definer
as $$
declare
    v_request record;
    v_role_id uuid;
    v_role_code text;
begin
    select * into v_request
      from public.account_approval_requests
     where id = p_request_id
       and status = 'pending'
     for update;

    if not found then
        raise exception 'Approval request not found or already processed';
    end if;

    -- Determine role to assign
    v_role_code := case v_request.requested_role
        when 'parent' then 'parent'
        when 'student' then 'student'
        when 'staff' then 'support_staff'  -- admin must refine via RBAC editor
    end;

    select id into v_role_id from public.roles where code = v_role_code;

    -- Update the request
    update public.account_approval_requests
       set status = 'approved',
           reviewed_by = p_reviewer_profile_id,
           reviewed_at = now(),
           decision_note = p_decision_note,
           target_parent_id = coalesce(p_target_parent_id, v_request.target_parent_id),
           target_student_id = coalesce(p_target_student_id, v_request.target_student_id)
     where id = p_request_id;

    -- Activate the user profile
    update public.user_profiles
       set status = 'active',
           approval_request_id = p_request_id
     where auth_user_id = v_request.auth_user_id;

    -- Assign the role
    insert into public.role_assignments (user_profile_id, tenant_id, role_id, assigned_by)
    select up.id, v_request.tenant_id, v_role_id, p_reviewer_profile_id
      from public.user_profiles up
     where up.auth_user_id = v_request.auth_user_id
     on conflict (user_profile_id, tenant_id, role_id) where revoked_at is null do nothing;

    -- Bind to parent profile if requested_role='parent' and target_parent_id provided
    if v_request.requested_role = 'parent' and p_target_parent_id is not null then
        update public.parents
           set auth_user_id = v_request.auth_user_id
         where id = p_target_parent_id;
    end if;

    -- Bind to student profile if requested_role='student' and target_student_id provided
    if v_request.requested_role = 'student' and p_target_student_id is not null then
        update public.students
           set auth_user_id = v_request.auth_user_id
         where id = p_target_student_id;
    end if;

    return v_role_id;
end;
$$;

comment on function public.approve_account_request is
  'Approves a web registration request, activates the user profile, assigns the requested role, and (optionally) binds to an existing parent or student profile. Called from the desktop admin UI.';

-- ----------------------------------------------------------------------------
-- 10. Function: reject account request
-- ----------------------------------------------------------------------------
create or replace function public.reject_account_request(
    p_request_id uuid,
    p_reviewer_profile_id uuid,
    p_decision_note text
)
returns void
language plpgsql
security definer
as $$
begin
    if p_decision_note is null or trim(p_decision_note) = '' then
        raise exception 'A rejection reason is required';
    end if;

    update public.account_approval_requests
       set status = 'rejected',
           reviewed_by = p_reviewer_profile_id,
           reviewed_at = now(),
           decision_note = p_decision_note
     where id = p_request_id
       and status = 'pending';

    -- Suspend the user profile so they cannot sign in
    update public.user_profiles
       set status = 'suspended'
     where auth_user_id = (
         select auth_user_id from public.account_approval_requests where id = p_request_id
     );
end;
$$;

comment on function public.reject_account_request is
  'Rejects a web registration request with a mandatory reason. Suspends the user profile so they cannot sign in.';
