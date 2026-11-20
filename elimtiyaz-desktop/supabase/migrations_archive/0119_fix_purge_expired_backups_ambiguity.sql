-- ============================================================================
-- 0119_fix_purge_expired_backups_ambiguity.sql
-- ============================================================================
-- T-415 (BKUP-507, issue #13): fix the purge_expired_backups RPC's Postgres
-- 42702 "column reference \"file_name\" is ambiguous" — the 0022 body's
-- RETURNS TABLE clause declares OUT parameters (archive_id, file_name,
-- purged_at) whose names collide with the backup_archives columns
-- referenced UNQUALIFIED in the FOR loop's select list. Every call since
-- deployment failed with 42702; the weekly purge-expired-backups EF has
-- been logging "Purge failed for tenant …" and continuing — the retention
-- purge pipeline never purged anything (live-caught by the T-415 live
-- verification script, step A3).
--
-- The fix: table-alias-qualify EVERY column reference inside the body. The
-- function's public contract (the returned row keys archive_id / file_name
-- / purged_at) is unchanged — the only in-repo consumer (the
-- purge-expired-backups EF) ignores the keys and now maps the rows by
-- their real shape (r.archive_id — the EF-side fix rides this migration's
-- commit).
--
-- Registration (idempotent — the MIG-TOKENS pattern): inserted inside the
-- same transaction as the body by the apply script; re-running is a no-op.
-- ============================================================================

create or replace function public.purge_expired_backups(p_tenant_id uuid)
returns table(archive_id uuid, file_name text, purged_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_archive record;
begin
    -- BKUP-507: the alias `ba` + fully-qualified references resolve the
    -- OUT-parameter/column ambiguity (42702). The OUT parameter names stay
    -- identical — the returned row-key contract is unchanged.
    for v_archive in
        select ba.id, ba.file_name
          from public.backup_archives ba
         where ba.tenant_id = p_tenant_id
           and ba.retention_expires_at < now()
           and ba.status <> 'purged'
    loop
        update public.backup_archives
           set status = 'purged',
               purge_at = now(),
               updated_at = now()
         where id = v_archive.id;

        perform public.write_audit_log(
            p_tenant_id := p_tenant_id,
            p_action := 'backup.purge',
            p_entity_type := 'backup_archive',
            p_entity_id := v_archive.id,
            p_after_json := jsonb_build_object('file_name', v_archive.file_name, 'purged_at', now())
        );

        return query select v_archive.id, v_archive.file_name, now();
    end loop;
end;
$$;

comment on function public.purge_expired_backups is
  'Marks expired backup archives as purged in metadata. Actual ciphertext deletion happens in Electron IndexedDB (plan §13.03). T-415/BKUP-507: the body now alias-qualifies every column reference (the 0022 unqualified file_name collided with the RETURNS TABLE OUT parameter — 42702 on every call).';

-- ----------------------------------------------------------------------------
-- Registration (T-091/MIG-TOKENS pattern — atomic with the DDL for the
-- Management-API live application; idempotent via ON CONFLICT)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0119', '{0119_fix_purge_expired_backups_ambiguity.sql}', 'fix_purge_expired_backups_ambiguity')
on conflict (version) do nothing;
