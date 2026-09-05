-- ============================================================================
-- 0073 — Suppliers: category column + fractional rating (T-179 / T-047 port #4)
-- Task: T-179 (session 28, 2026-09-05)
--
-- WHAT:
--   1. Adds `category text` (nullable) to `suppliers`.
--   2. Recasts `rating` from smallint (1–5 integers) to numeric(3,1) with a
--      0.0–5.0 CHECK.
--
-- WHY:
--   1. The Supplier domain contract (operations-workforce.ts) carries
--      `category` (free text: 'Fournitures', 'Carburant', 'Manuels',
--      'Mobilier' — the mock seed set); 0011 has no column for it.
--   2. The domain contract rates suppliers 0–5 with FRACTIONAL values
--      (the mock seeds carry 3.8 / 4.0 / 4.5 / 4.8); 0011's smallint CHECK
--      (>= 1, integers only) cannot store them. Empty table (0 rows live —
--      the desktop mock was the only writer) → the recast + CHECK swap is
--      validation-safe.
--
-- SAFETY / IDEMPOTENCE:
--   - ADD COLUMN IF NOT EXISTS; the type recast is a no-op when already
--     numeric; the CHECK replacement drops ONLY constraints whose
--     definition references `rating` (definition-matched DO block,
--     name-agnostic).
--   - RLS untouched (0019: select tenant+not-deleted for all authenticated;
--     admin-all for super_admin/financial_officer/buyer/manager).
--   - All supplier FKs are ON DELETE SET NULL (purchase_requests,
--     purchase_orders) — hard delete stays safe.
-- ============================================================================

-- 1. The domain's category (free text — the mock seed set is the vocabulary).
alter table public.suppliers
    add column if not exists category text;

comment on column public.suppliers.category is
    'Free-text supplier category (Fournitures / Carburant / Manuels / Mobilier …). Added by 0073 (T-179) for the desktop domain contract.';

-- 2a. Recast rating smallint → numeric(3,1) (idempotent: recasting numeric
--     to the same type is a no-op).
alter table public.suppliers
    alter column rating type numeric(3,1) using rating::numeric(3,1);

-- 2b. Replace the 1–5 integer CHECK with the 0.0–5.0 fractional CHECK.
do $drop_rating_checks$
declare r record;
begin
    for r in
        select conname
          from pg_constraint
         where conrelid = 'public.suppliers'::regclass
           and contype = 'c'
           and pg_get_constraintdef(oid) ilike '%rating%'
    loop
        execute format('alter table public.suppliers drop constraint %I', r.conname);
    end loop;
end
$drop_rating_checks$;

alter table public.suppliers
    add constraint suppliers_rating_range_check
    check (rating is null or (rating >= 0 and rating <= 5));

comment on constraint suppliers_rating_range_check on public.suppliers is
    'Supplier rating 0.0–5.0 fractional (the desktop domain contract; the 0011 smallint 1–5 integer constraint could not store the seed corpus). Added by 0073 (T-179).';

-- Registration row (T-091/MIG-TOKENS pattern — scripts/apply_0073_live.sh
-- embeds this so the DDL and the registration land in ONE atomic
-- transaction; ON CONFLICT keeps it idempotent.)
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0073', '{0073_suppliers_category_rating.sql}', 'suppliers_category_rating')
on conflict (version) do nothing;
