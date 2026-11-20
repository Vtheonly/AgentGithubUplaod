-- 0065_canonical_identity_codes.sql
-- T-115 / DRIFT-001 (backend half) — canonical DETERMINISTIC identity-code
-- generators at the database layer.
--
-- RECONSTRUCTION NOTE (2026-09-02, 19th session): this migration was applied
-- to the live project hkvkefubghbbotgnteir by an actor outside the committed
-- repositories (registered as schema_migrations version '0065',
-- name 'canonical_identity_codes', statements
-- ['0065_canonical_identity_codes.sql']) AFTER the 18th session closed
-- (2026-09-01 ~04:30 UTC) and BEFORE the 19th session opened (2026-09-02).
-- The file below was reconstructed VERBATIM from the live catalog via
-- pg_get_functiondef() so that a fresh `db push` reproduces the live state
-- exactly (the ARCH-011 discipline: file + registration must never diverge).
-- The five FUNCTION DEFINITIONS are byte-identical to live (verified 5/5,
-- scripts/verify_t-115.sql + the one-time file-vs-live check recorded in
-- docs/recovery/t-115-live-verification.md). The COMMENT statements below are
-- file-only: the Management API SQL endpoint silently DROPS COMMENT ON
-- statements (discovered live, 2026-09-02 — see the live-verification doc), so
-- the live catalog carries NULL comments for these functions; a fresh CLI
-- deployment applies them. Same cosmetic-divergence class as the documented
-- 0049/0050 live-label quirk. See docs/recovery/problem-registry.md ARCH-013
-- for the process violation and docs/recovery/t-115-live-verification.md for
-- the verification evidence.
--
-- WHAT THIS MIGRATION DOES (scope verified live, 2026-09-02):
--   1. fn_fnv1a(text)                  — FNV-1a 32-bit hash in plpgsql with
--        signed-XOR normalization so the bit pattern matches JavaScript's
--        Math.imul-based canonical generator (desktop src/core/format/id.ts)
--        and Kotlin's IdentityCodes.kt mirror exactly.
--   2. fn_stable_hash(text)            — 6-char uppercase hex of fn_fnv1a
--        (lpad to 8, first 6) — mirrors stableHash() on both clients.
--   3. fn_deterministic_parent_code(year, phone, display_name, first_name,
--        last_name, fallback_seed) — PAR-{year}-{stable_hash(identity)} where
--        identity = per-field-trimmed, empty-dropped fields joined with '|'
--        (the cross-platform canonical rule); NO random fallback — an empty
--        identity uses the stable seed ('orphan-parent' default). Mirrors
--        deterministicParentCode() (desktop id.ts / Android IdentityCodes.kt).
--   4. fn_deterministic_activation_code(parent_code, tenant_id) —
--        FNV-1a of '{tenant_id}|{parent_code}' mapped into [100000, 999999];
--        mirrors deterministicActivationCode() on both clients.
--   5. batch_register_family REWRITE — the parent code becomes
--        fn_deterministic_parent_code(...) (was gen_random_bytes(3) — the
--        0036 guard comment's "backend fallback only" posture is now closed:
--        the RPC is safe to call); empty identity is REJECTED (the canonical
--        idempotency contract: the dedup match IS the code — the
--        unique (tenant_id, parent_code) constraint refuses duplicate family
--        registrations for the same identity). The DEFAULT activation code
--        becomes fn_deterministic_activation_code(parent_code, tenant_id)
--        with a collision fallback to generate_activation_code() when a
--        DIFFERENT parent's unbound code collides (~3.7% birthday space at
--        259 parents — safety first). Student codes stay sequential
--        ELV-{year}-{6-digit} (student_seq) — the deterministic-ELV variant
--        belongs to the sync/import upsert paths (0037), per the live
--        function's own documentation.
--
-- WHY (ADR-003 / DRIFT-001): re-registering the same family identity — via
-- the Excel import, the Android batch path, or a retry — now converges on
-- the SAME parent code server-side, so the (tenant_id, parent_code) unique
-- constraint is the idempotency gate and duplicate parents can no longer be
-- created by the RPC. T-018 completed the desktop + sync layer in the 12th
-- session; this is the backend half (previously "Left: needs a migration").
--
-- IDEMPOTENCY: everything here is CREATE OR REPLACE / DROP-IF-EXISTS-free;
-- re-running on the live DB is a no-op (verified live 2026-09-02, see
-- t-115-live-verification.md). No data migrations are performed — the
-- existing 259 production parent codes are untouched (they were created by
-- the import path, which already used the deterministic generators).

-- ----------------------------------------------------------------------------
-- 1. FNV-1a 32-bit hash (plpgsql, Math.imul-compatible bit semantics)
-- ----------------------------------------------------------------------------
create or replace function public.fn_fnv1a(s text)
returns bigint
language plpgsql
immutable
parallel safe
as $$
declare
    h bigint := 2166136261;   -- 0x811C9DC5 (FNV-1a offset basis, unsigned)
    c integer;
    x bigint;
begin
    if s is null then s := ''; end if;
    for i in 1 .. length(s) loop
        c := ascii(substring(s from i for 1));
        -- XOR needs both operands in signed int range: normalize h.
        x := h;
        if x >= 2147483648 then x := x - 4294967296; end if;
        x := (x # c)::bigint;
        if x < 0 then x := x + 4294967296; end if;
        -- JS Math.imul truncates to 32 bits == mod 2^32 (bigint-safe).
        h := (x * 16777619) % 4294967296;
    end loop;
    return h;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Stable hash — 6-char uppercase hex of the FNV-1a digest
-- ----------------------------------------------------------------------------
create or replace function public.fn_stable_hash(s text)
returns text
language sql
immutable
parallel safe
as $$
    select upper(substring(lpad(to_hex(public.fn_fnv1a(s)), 8, '0'), 1, 6));
$$;

-- ----------------------------------------------------------------------------
-- 3. Deterministic parent code — PAR-{year}-{stable_hash(identity)}
-- ----------------------------------------------------------------------------
create or replace function public.fn_deterministic_parent_code(
    p_year integer,
    p_phone text default null,
    p_display_name text default null,
    p_first_name text default null,
    p_last_name text default null,
    p_fallback_seed text default null
)
returns text
language plpgsql
immutable
as $$
declare
    parts text[] := array[]::text[];
    identity text;
begin
    -- Canonical rule: per-field trim, DROP empty fields, join with '|'.
    if coalesce(btrim(p_phone), '') <> '' then parts := parts || btrim(p_phone); end if;
    if coalesce(btrim(p_display_name), '') <> '' then parts := parts || btrim(p_display_name); end if;
    if coalesce(btrim(p_first_name), '') <> '' then parts := parts || btrim(p_first_name); end if;
    if coalesce(btrim(p_last_name), '') <> '' then parts := parts || btrim(p_last_name); end if;
    identity := array_to_string(parts, '|');
    -- T-018 rule: NO random fallback — empty identity uses the stable seed.
    if identity = '' then
        identity := coalesce(nullif(btrim(p_fallback_seed), ''), 'orphan-parent');
    end if;
    return 'PAR-' || p_year::text || '-' || public.fn_stable_hash(identity);
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Deterministic activation code — 6-digit from FNV-1a(tenant|parent_code)
-- ----------------------------------------------------------------------------
create or replace function public.fn_deterministic_activation_code(
    p_parent_code text,
    p_tenant_id uuid
)
returns text
language plpgsql
immutable
as $$
declare
    identity text := btrim(coalesce(p_tenant_id::text, '') || '|' || coalesce(p_parent_code, ''));
    h bigint;
begin
    if identity = '' then
        return '000000';
    end if;
    h := public.fn_fnv1a(identity);
    return ((h % 900000) + 100000)::text;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. batch_register_family — deterministic parent code + activation code
--    (replaces 0022's gen_random_bytes path; supersedes 0036's guard comment)
-- ----------------------------------------------------------------------------
create or replace function public.batch_register_family(
    p_tenant_id uuid,
    p_parent jsonb,
    p_students jsonb,
    p_actor_profile_id uuid,
    p_activation_code text default null
)
returns table(parent_id uuid, student_ids uuid[])
language plpgsql
security definer
set search_path = public
as $$
declare
    v_parent_id uuid;
    v_student_ids uuid[] := '{}';
    v_student_id uuid;
    v_student jsonb;
    v_parent_code text;
    v_student_code text;
    v_seq integer;
    v_activation_code text;
    v_audit_id uuid;
begin
    -- DRIFT-001 / T-115 (migration 0065): the parent code is CANONICAL and
    -- DETERMINISTIC — FNV-1a of the identity fields, exactly like the
    -- desktop's SupabaseParentRepository and the approve-signup-request EF.
    -- The unique (tenant_id, parent_code) constraint then refuses duplicate
    -- family registrations for the same identity — that refusal IS the
    -- canonical idempotency contract ("the dedup match IS the code").
    if coalesce(btrim(p_parent->>'primary_phone'), '') = ''
       and coalesce(btrim(p_parent->>'display_name'), '') = ''
       and coalesce(btrim(p_parent->>'first_name'), '') = ''
       and coalesce(btrim(p_parent->>'last_name'), '') = '' then
        raise exception 'batch_register_family: parent identity fields required (primary_phone / display_name / first_name / last_name) — the canonical code generator has no random fallback (DRIFT-001, migration 0065)';
    end if;

    v_parent_code := public.fn_deterministic_parent_code(
        extract(year from now())::int,
        p_parent->>'primary_phone',
        p_parent->>'display_name',
        p_parent->>'first_name',
        p_parent->>'last_name'
    );

    -- Insert parent
    insert into public.parents (
        tenant_id, parent_code, first_name, last_name, primary_phone,
        secondary_phone, email, national_id, occupation, address, city,
        postal_code, relationship, notes, is_active, created_at, updated_at
    ) values (
        p_tenant_id, v_parent_code,
        p_parent->>'first_name', p_parent->>'last_name', p_parent->>'primary_phone',
        p_parent->>'secondary_phone', p_parent->>'email', p_parent->>'national_id',
        p_parent->>'occupation', p_parent->>'address', p_parent->>'city',
        p_parent->>'postal_code', p_parent->>'relationship', p_parent->>'notes',
        true, now(), now()
    )
    returning id into v_parent_id;

    -- Insert students (sequential ELV-{year}-{6-digit} — canonical student
    -- format per core/format/id.ts; DRIFT-001's RPC finding targets the
    -- PARENT code, the deterministic-ELV variant belongs to the
    -- sync/import upsert paths).
    for v_student in select * from jsonb_array_elements(p_students)
    loop
        v_seq := nextval('public.student_seq');
        v_student_code := 'ELV-' || extract(year from now())::text || '-' || lpad(v_seq::text, 6, '0');

        insert into public.students (
            tenant_id, parent_id, student_code, first_name, middle_name, last_name,
            date_of_birth, gender, grade_level_id, class_id, enrollment_date,
            enrollment_status, medical_notes, is_active, created_at, updated_at
        ) values (
            p_tenant_id, v_parent_id, v_student_code,
            v_student->>'first_name', v_student->>'middle_name', v_student->>'last_name',
            (v_student->>'date_of_birth')::date,
            v_student->>'gender',
            nullif(v_student->>'grade_level_id', '')::uuid,
            nullif(v_student->>'class_id', '')::uuid,
            current_date, 'enrolled', v_student->>'medical_notes',
            true, now(), now()
        )
        returning id into v_student_id;
        v_student_ids := array_append(v_student_ids, v_student_id);
    end loop;

    -- Issue activation code (or use provided one).
    -- DRIFT-001 / T-115: the DEFAULT is now the canonical DETERMINISTIC code
    -- (same family -> same activation code on retry). Collision fallback:
    -- the 6-digit space can collide across parents in a tenant (~3.7% at
    -- 259 parents); on a collision with a DIFFERENT parent's unbound code,
    -- fall back to the random-with-uniqueness generator (safety first).
    if p_activation_code is not null then
        v_activation_code := p_activation_code;
    else
        v_activation_code := public.fn_deterministic_activation_code(v_parent_code, p_tenant_id);
        if exists (
            select 1 from public.activation_codes ac
             where ac.tenant_id = p_tenant_id
               and ac.code = v_activation_code
               and ac.bound_to_auth_user_id is null
               and ac.parent_id is distinct from v_parent_id
        ) then
            v_activation_code := public.generate_activation_code(p_tenant_id);
        end if;
    end if;

    insert into public.activation_codes (
        tenant_id, code, parent_id, issued_by, issued_at, expires_at
    ) values (
        p_tenant_id, v_activation_code, v_parent_id, p_actor_profile_id, now(), now() + interval '30 days'
    );

    -- Write audit log
    v_audit_id := public.write_audit_log(
        p_tenant_id := p_tenant_id,
        p_action := 'parent.batch_register',
        p_entity_type := 'parent',
        p_entity_id := v_parent_id,
        p_actor_id := p_actor_profile_id,
        p_before_json := null,
        p_after_json := jsonb_build_object('parent_id', v_parent_id, 'student_ids', v_student_ids, 'activation_code', v_activation_code, 'parent_code', v_parent_code, 'code_rule', 'deterministic_fnv1a_0065'),
        p_note := 'Atomic batch registration: parent + ' || cardinality(v_student_ids) || ' students (canonical deterministic parent code, migration 0065)'
    );

    return query select v_parent_id, v_student_ids;
end;
$$;

comment on function public.batch_register_family is
    'T-115 / DRIFT-001 (migration 0065): parent code is the canonical DETERMINISTIC PAR-{year}-{FNV-1a 6-hex} of the identity fields (empty identity REJECTED — no random fallback); default activation code is deterministic with a collision fallback to generate_activation_code; student codes stay sequential ELV-{year}-{6-digit}. The unique (tenant_id, parent_code) constraint is the idempotency gate: re-registering the same identity is refused. Supersedes 0036''s "backend fallback only" guard comment.';

comment on function public.fn_deterministic_parent_code is
    'Canonical deterministic parent code (ADR-003): PAR-{year}-{fn_stable_hash(identity)}; identity = trimmed non-empty (phone, display_name, first_name, last_name) joined with ''|''; empty identity uses the fallback seed (default ''orphan-parent'') — NEVER random. Mirrors desktop src/core/format/id.ts deterministicParentCode and Android core/IdentityCodes.kt.';

comment on function public.fn_deterministic_activation_code is
    'Canonical deterministic activation code: 6 digits [100000, 999999] from fn_fnv1a(''{tenant_id}|{parent_code}''). Mirrors deterministicActivationCode on both clients. Collisions across parents are handled by the CALLER (batch_register_family falls back to generate_activation_code).';

comment on function public.fn_stable_hash is
    'Upper 6 hex chars of the FNV-1a 32-bit hash (fn_fnv1a). Mirrors stableHash() on desktop (src/core/format/id.ts) and Android (core/IdentityCodes.kt).';

comment on function public.fn_fnv1a is
    'FNV-1a 32-bit hash, bit-exact with the JS Math.imul / Kotlin Int-based canonical implementations (signed-XOR normalization + mod 2^32 multiply). BMP characters only (charCodeAt/code-point parity) — an accepted constraint, identity fields are names/phones.';
