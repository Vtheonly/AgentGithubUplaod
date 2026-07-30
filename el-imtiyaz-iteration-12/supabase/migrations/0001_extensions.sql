-- ============================================================================
-- 0001_extensions.sql
-- ============================================================================
-- Enable the PostgreSQL extensions required by the El-Imtiyaz platform.
--
-- These extensions are prerequisites for:
--   - `pgcrypto`      — `gen_random_uuid()` for primary keys
--   - `pgjwt`         — JWT inspection inside RLS policies (auth.uid())
--   - `uuid-ossp`     — legacy UUID generation (kept for portability)
--   - `pg_trgm`       — trigram indexes for fuzzy search (parents, students)
--   - `btree_gist`    — GiST indexes on scalar columns (exclusion constraints)
--   - `pg_stat_statements` — query performance monitoring (optional, opt-in)
--
-- All extensions are declared inside the `extensions` schema (Supabase default)
-- to keep the public schema clean.
-- ============================================================================

create schema if not exists extensions;

create extension if not exists pgcrypto      with schema extensions;
create extension if not exists pgjwt         with schema extensions;
create extension if not exists "uuid-ossp"   with schema extensions;
create extension if not exists pg_trgm       with schema extensions;
create extension if not exists btree_gist    with schema extensions;
-- pg_stat_statements requires shared_preload_libraries on the server; declare
-- it but tolerate failure if the server is not configured for it.
create extension if not exists pg_stat_statements with schema extensions;

-- ============================================================================
-- Canonical helper: gen_random_uuid() exposed in public schema for ergonomics.
-- ============================================================================
create or replace function public.gen_uuid()
returns uuid
language sql
stable
as $$
  select extensions.gen_random_uuid();
$$;

comment on schema extensions is 'PostgreSQL extensions used by El-Imtiyaz (pgcrypto, pgjwt, pg_trgm, btree_gist).';
comment on function public.gen_uuid is 'Canonical UUID generator wrapper used by every entity table.';
