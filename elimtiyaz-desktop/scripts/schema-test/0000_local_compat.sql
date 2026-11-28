-- ============================================================================
-- 0000_local_compat.sql
-- ============================================================================
-- THE LOCAL-COMPATIBILITY PROLOGUE for running the canonical Supabase
-- migration chain (supabase/migrations/0001..0005) on a plain/offline
-- PostgreSQL (PGlite in-memory, per the MIGRATION-CONSOLIDATION-AND-EGRESS
-- CHARTER Rule 3 and the T-599/LF-1 discipline referenced by 0001's header
-- §PLATFORM PRECONDITIONS).
--
-- It creates ONLY the platform preconditions a managed Supabase project
-- provides out of the box. It creates NO `public` content whatsoever —
-- the chain owns all of it.
--
--   * the platform roles: anon / authenticated / service_role
--   * the `auth` schema: auth.users (a stub of the GoTrue table with the
--     columns the chain references) + auth.uid() / auth.jwt() / auth.role()
--     claim shims reading `request.jwt.claims` (the GUC PostgREST sets)
--   * the `storage` schema: storage.buckets / storage.objects stubs +
--     storage.foldername(name text) -> text[] / filename / extension
--   * the `supabase_realtime` publication
--   * the `supabase_migrations` bookkeeping table (the CLI's shape)
--
-- Usage (see scripts/schema-test/local-pg.mjs and scripts/schema-test/README.md):
--   this file is applied FIRST, then the chain 0001..0005 byte-untouched
--   (the ONLY documented in-memory exception: the `create extension pgjwt`
--   statement is skipped on runtimes without the pgjwt tarball — pgjwt is
--   created-never-called in the chain; see the charter's skip-guard note).
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ── §1 Platform roles + the platform grant model ──────────────────────────
-- The 0001 chain grants EXECUTE to these roles and assumes the Supabase
-- platform's standard table/usage grants (broad grants + RLS as the guard).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- Schema usage + extension access for the platform roles. The `extensions`
-- schema is itself a platform precondition (the chain's §1 then installs
-- the extension tarballs into it, idempotently).
create schema if not exists extensions;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

-- The Supabase platform's default-privilege model: every table/sequence the
-- chain (as postgres) creates after this point is granted broadly to the
-- platform roles, with RLS as the row-level guard (the 0001 chain FORCEs
-- RLS on every public table). Function EXECUTE stays governed by the
-- chain's explicit §11 grants (Supabase's hardening revokes PUBLIC execute;
-- the prologue mirrors it so the chain's grants are the final word).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public revoke execute on functions from public;

-- ── §2 The auth schema (GoTrue preconditions) ────────────────────────────
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

-- The stub of GoTrue's users table carrying the columns the canonical chain
-- references (FK targets + join reads). Management API columns are omitted —
-- nothing in the chain reads them.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  aud text,
  role text,
  banned_until timestamptz
);

-- Claim shims over the PostgREST GUC. On a managed project these come from
-- the platform; here they read `request.jwt.claims` exactly like PostgREST
-- does, so `set local request.jwt.claims = '...'` in a test session drives
-- auth.uid()/auth.jwt()/auth.role() the same way a real JWT would.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'role', 'anon')
$$;

-- GoTrue's helper the chain's comments reference; harmless to provide.
create or replace function auth.email()
returns text
language sql
stable
as $$
  select auth.jwt() ->> 'email'
$$;

-- ── §3 The storage schema (Storage API preconditions) ────────────────────
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  public boolean default false,
  -- the columns the chain's bucket seeds write (0018's shape)
  file_size_limit bigint,
  allowed_mime_types text[],
  -- the columns later chain functions reference
  owner_id text
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  path_tokens text[] default '{}',
  version text
);

-- The storage helper functions the chain's policies call.
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(name, '/')
$$;

create or replace function storage.filename(name text)
returns text
language sql
immutable
as $$
  select reverse(split_part(reverse(name), '/', 1))
$$;

create or replace function storage.extension(name text)
returns text
language sql
immutable
as $$
  select
    case
      when position('.' in storage.filename(name)) = 0 then ''
      else split_part(storage.filename(name), '.', 2)
    end
$$;

-- ── §4 The realtime publication ───────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
exception when others then
  -- PGlite does not support publications (the wasm build has no logical
  -- replication); the `alter publication` statements inside the chain are
  -- noise there. The census documents the difference.
  raise notice 'supabase_realtime publication unavailable on this runtime; skipping.';
end $$;

-- ── §5 The migrations bookkeeping table ───────────────────────────────────
-- NOT created here: the chain itself creates `supabase_migrations` and the
-- 0001 self-registration (version text primary key, statements text[],
-- name text — the recorded local shape). The prologue creates nothing the
-- chain owns.
