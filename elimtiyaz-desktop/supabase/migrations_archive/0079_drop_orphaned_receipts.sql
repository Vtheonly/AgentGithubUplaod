-- ============================================================================
-- 0079_drop_orphaned_receipts.sql — CROSS-101 RESOLUTION (T-195, ADR-014)
-- ============================================================================
-- The `receipts` table (migration 0007) is the textbook orphan:
--   * its ONLY writer was the `collect_payment` SQL RPC — DROPPED by
--     migration 0034 when the canonical `collect_and_allocate_payment`
--     took over (which allocates receipt numbers on the payments row,
--     migration 0058, and writes NO receipts rows);
--   * zero writers since 0034, ZERO live rows (verified 2026-09-05:
--     0 rows, 0 storage objects in the `receipts` bucket);
--   * the website's dead hooks (useReceiptsForPayment/useReceipts) queried
--     it with ZERO consumers — removed in the same change set (T-195);
--   * the storage policies documented "system writes (Edge Function)" —
--     an Edge Function that never existed.
--
-- ADR-014 (30th session) resolves UNKNOWN-004: receipts are generated
-- CLIENT-SIDE, deterministically from the canonical payments/ledger rows
-- (desktop: receipt-pdf since iteration 5; website: the T-194/T-195 pdf-lib
-- ports). No server persistence is wanted; the orphaned table + bucket +
-- policies are dead weight that misleads every future reader.
--
-- GUARDS (defense in depth, even though the live state is verified empty):
--   * the DROP TABLE is wrapped in a DO block that REFUSES to run when the
--     table still holds rows (fresh deployments with legacy data would
--     need an explicit export decision first);
--   * the bucket drop is likewise guarded on being empty.
--
-- Per AGENTS.md §15 rule 10 (T-091/MIG-TOKENS pattern): this file is applied
-- to the live project TOGETHER with its schema_migrations registration in
-- one atomic transaction (scripts/apply_0079_live.sh).
-- ============================================================================

-- 1. Storage policies for the dead bucket (system writes never existed).
drop policy if exists "receipts_read" on storage.objects;
drop policy if exists "receipts_write" on storage.objects;

-- 2. The empty bucket itself. DISCOVERY (2026-09-05, live apply attempt):
--    Supabase REJECTS direct SQL on storage.buckets ("Direct deletion from
--    storage tables is not allowed. Use the Storage API instead." — the
--    storage.protect_delete() trigger). The bucket is therefore removed
--    OUTSIDE this file, via the Storage API, in scripts/apply_0079_live.sh
--    (DELETE /storage/v1/bucket/receipts with the service key). A fresh CLI
--    deployment never creates it (0018's insert remains for historical
--    chain fidelity — the bucket existing with no policies and no objects
--    is inert; scripts/apply_0079_live.sh removes it live).

-- 3. The orphaned table (refuse when rows exist — the data-export decision
--    must be taken explicitly, never silently).
do $$
begin
    if (select count(*) from public.receipts) = 0 then
        drop table public.receipts;
    else
        raise exception '0079: public.receipts still holds % row(s) — export them explicitly before dropping (ADR-014 assumed an empty orphan)', (select count(*) from public.receipts)
            using errcode = '23502';
    end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Registration row (T-091/MIG-TOKENS pattern — scripts/apply_0079_live.sh
-- embeds this so the DDL and the registration land in ONE atomic
-- transaction; ON CONFLICT keeps it idempotent.)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0079', '{0079_drop_orphaned_receipts.sql}', 'drop_orphaned_receipts')
on conflict (version) do nothing;
