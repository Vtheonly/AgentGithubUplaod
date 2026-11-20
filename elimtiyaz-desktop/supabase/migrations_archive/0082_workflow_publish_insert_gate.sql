-- ============================================================================
-- 0082_workflow_publish_insert_gate.sql
-- ============================================================================
-- Task: T-228 (34th session, 2026-09-07) — hardening discovered by the
-- multi-hop delay live test.
--
-- WHAT: a BEFORE INSERT trigger on workflows that applies the SAME publish
-- gate as 0081's BEFORE UPDATE trigger — a row INSERTED directly with
-- status='published' (SQL scripts, future importers) is validated too, and
-- its version lands at 1 (0 = never published is an UPDATE-path-only
-- concept; an inserted-published row has been "published" exactly once).
--
-- WHY: 0081's gate fired only on UPDATE — a direct INSERT of a published
-- CYCLIC workflow would have bypassed validation entirely, and a published
-- row with version=0 then violated workflow_runs.workflow_version_check
-- on the first execution (live evidence: WF-T228-MULTI, insert-published,
-- run insert rejected with 23514).
--
-- SAFETY / IDEMPOTENCE: pure additive trigger; re-runnable (drop-if-exists
-- + create). No business rule change — the SAME validator, the SAME
-- strictness, extended to the INSERT path.
-- ============================================================================

create or replace function public.workflows_publish_gate_insert()
returns trigger
language plpgsql
as $$
declare
    v_result jsonb;
    v_errors text[];
begin
    if new.status = 'published' then
        v_result := public.validate_workflow_dag(new.dag_definition, true);
        if not (v_result ->> 'valid')::boolean then
            v_errors := array(select jsonb_array_elements_text(v_result -> 'errors'));
            raise exception 'workflow publish rejected: %',
                    array_to_string(v_errors, ' | ')
                using errcode = '23514';
        end if;
        -- Direct-insert publish: the publish counter starts at 1.
        if coalesce(new.version, 0) < 1 then
            new.version := 1;
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists workflows_publish_gate_insert on public.workflows;
create trigger workflows_publish_gate_insert
    before insert on public.workflows
    for each row execute function public.workflows_publish_gate_insert();

-- ----------------------------------------------------------------------------
-- Registration (T-091/MIG-TOKENS pattern — applied live atomically by
-- scripts/apply_0082_live.sh)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0082', '{0082_workflow_publish_insert_gate.sql}', 'workflow_publish_insert_gate')
on conflict (version) do nothing;
