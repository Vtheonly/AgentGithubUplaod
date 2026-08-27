-- ============================================================================
-- supabase-shim.sql — Local-PostgreSQL environment shim for the
-- cross-platform equivalence suite.
--
-- The production backend runs on Supabase, which provides the `auth` and
-- `storage` schemas plus the `authenticated` / `anon` / `service_role` roles.
-- To execute the REAL migration chain (0001–0039 + portal patches) on a
-- vanilla PostgreSQL server, this shim creates environment-only stand-ins.
--
-- ⚠️ This file contains ZERO business logic. It only creates the Supabase
-- platform primitives the migrations reference syntactically:
--   * auth.users table (mirror of Supabase Auth users)
--   * auth.uid() / auth.jwt() / auth.role() (JWT claim readers — inert when unset)
--   * storage.buckets / storage.objects tables
--   * storage.foldername() helper
--   * the `authenticated` role referenced by RLS policies (`to authenticated`)
-- ============================================================================

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
    end if;
end
$$;

create schema if not exists auth;

create table if not exists auth.users (
    id                  uuid primary key default gen_random_uuid(),
    email               text,
    encrypted_password  text,
    raw_app_meta_data   jsonb not null default '{}'::jsonb,
    raw_user_meta_data  jsonb not null default '{}'::jsonb,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
    select coalesce(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb,
        '{}'::jsonb
    )
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
    select coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        'anon'
    )
$$;

create schema if not exists storage;

create table if not exists storage.buckets (
    id                  text primary key,
    name                text not null,
    public              boolean not null default false,
    file_size_limit     bigint,
    allowed_mime_types  text[],
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create table if not exists storage.objects (
    id          uuid primary key default gen_random_uuid(),
    bucket_id   text references storage.buckets (id),
    name        text not null,
    owner       uuid,
    metadata    jsonb,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create or replace function storage.foldername(path text)
returns text[]
language sql
immutable
as $$
    select string_to_array(path, '/')
$$;

-- The storage policies in 0018 require RLS on storage.objects.
alter table storage.objects enable row level security;
