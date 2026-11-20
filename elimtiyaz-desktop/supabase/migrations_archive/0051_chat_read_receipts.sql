-- ============================================================================
-- 0051_chat_read_receipts.sql — RECONCILIATION MIGRATION (T-091)
-- ============================================================================
-- PROBLEM (T-091, discovered 2026-08-30 during the 9th recovery session's
-- live backend health re-verification):
--
--   The local repo's migration 0050 (`0050_fcm_token_caller_verification.sql`)
--   contains the FCM token verification logic (SEC-106 + SYNC-104/105).
--   The LIVE Supabase project (hkvkefubghbbotgnteir) has migration 0050
--   registered in `supabase_migrations.schema_migrations` with a
--   DIFFERENT name (`chat_read_receipts`) and DIFFERENT statements
--   (the SQL below). The FCM functions DO exist on the live DB
--   (verified via `pg_get_functiondef` for register_fcm_token /
--   deactivate_fcm_tokens) — they were applied directly via the
--   Management API SQL endpoint during session 8 (per the change-log
--   entry: "POST /v1/projects/{ref}/database/query with the platform
--   access token"). That application bypassed the migration system,
--   so the schema_migrations record never advanced to "0050 =
--   fcm_token_caller_verification".
--
--   LATER, the chat_read_receipts migration was applied (probably by
--   a subsequent agent using the migration CLI), registering itself
--   as version 0050 in schema_migrations and overwriting the previous
--   record.
--
--   NET RESULT on the live DB:
--     - register_fcm_token with SEC-106 caller verification: PRESENT
--     - deactivate_fcm_tokens RPC: PRESENT
--     - chat_messages_update_read_by policy: PRESENT
--     - chat_messages_read_by_guard trigger: PRESENT
--     - enforce_chat_read_by_append_only function: PRESENT
--     - schema_migrations version 0050 name: "chat_read_receipts"
--     - Local repo file `0050_fcm_token_caller_verification.sql`:
--       contains the FCM verification SQL (matches what's on live
--       via direct SQL application, NOT via the migration system).
--
--   For a FRESH database deployment, applying the local repo's
--   migration chain would:
--     1. Apply 0050_fcm_token_caller_verification.sql → FCM functions
--        created. ✓
--     2. Skip the chat_read_receipts migration (it's not in the local
--        repo) → chat_messages_update_read_by policy MISSING. ✗
--
--   This migration reconciles the drift: it captures the
--   chat_read_receipts SQL that's on the live DB but missing from the
--   local repo, registered as 0051 (the next free migration number
--   per AGENTS.md §15 rule 9 — never edit applied migrations).
--
-- IDEMPOTENCY:
--   - The policy uses `drop policy if exists … create policy …` so
--     re-applying on the live DB (where it already exists) is a no-op.
--   - The function uses `create or replace function` (naturally
--     idempotent).
--   - The trigger uses `drop trigger if exists … create trigger …`
--     (naturally idempotent).
--
-- So applying this migration:
--   - On a FRESH DB: creates the policy + function + trigger.
--   - On the LIVE DB: no-ops (all three already exist with the same
--     definition).
--
-- SOURCE: this SQL was extracted verbatim from the live DB's
-- `supabase_migrations.schema_migrations.statements` column for
-- version 0050 on 2026-08-30 (T-091 verification script:
-- scripts/extract_migration_0050_live.sh).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Permissive policy: channel members may UPDATE messages in their channels
--    (column narrowing is enforced by the trigger in §2).
-- ----------------------------------------------------------------------------
drop policy if exists chat_messages_update_read_by on public.chat_messages;
create policy chat_messages_update_read_by
    on public.chat_messages
    for update to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and exists (
            select 1 from public.chat_channels c
            where c.id = chat_messages.channel_id
              and c.tenant_id = chat_messages.tenant_id
              and c.member_ids @> array[public.current_user_profile_id()]
        )
    )
    with check (
        tenant_id = public.current_tenant_id()
        and exists (
            select 1 from public.chat_channels c
            where c.id = chat_messages.channel_id
              and c.tenant_id = chat_messages.tenant_id
              and c.member_ids @> array[public.current_user_profile_id()]
        )
    );
comment on policy chat_messages_update_read_by on public.chat_messages is
    'T-032 / REALTIME-101: channel members may append their own read_by receipt to any message in their channels; enforce_chat_read_by_append_only() restricts member updates to exactly that.';

-- ----------------------------------------------------------------------------
-- 2. Trigger guard: member updates are append-only on read_by, own entry only.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_chat_read_by_append_only()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
    v_profile uuid := public.current_user_profile_id();
    v_old jsonb := coalesce(old.read_by, '[]'::jsonb);
    v_new jsonb := coalesce(new.read_by, '[]'::jsonb);
begin
    -- Authors keep the full-update path governed by chat_messages_update_own
    -- (edit body, edited_at, deleted_at, attachments …). Nothing changes
    -- for them.
    if v_profile is not null and old.author_id = v_profile then
        return new;
    end if;

    -- Non-author (recipient) path: every column except read_by must be
    -- byte-identical. This is what stops a member from editing or deleting
    -- other people's messages through the new permissive policy.
    if new.tenant_id is distinct from old.tenant_id
       or new.channel_id is distinct from old.channel_id
       or new.author_id is distinct from old.author_id
       or new.body is distinct from old.body
       or new.edited_at is distinct from old.edited_at
       or new.edited_by is distinct from old.edited_by
       or new.deleted_at is distinct from old.deleted_at
       or new.parent_message_id is distinct from old.parent_message_id
       or new.attachments is distinct from old.attachments
       or new.sent_at is distinct from old.sent_at then
        raise exception 'chat_messages: non-author updates may only touch read_by (REALTIME-101)';
    end if;

    -- read_by must GROW by exactly one entry…
    if jsonb_array_length(v_new) <> jsonb_array_length(v_old) + 1 then
        raise exception 'chat_messages: read_by must grow by exactly one entry per update (REALTIME-101)';
    end if;

    -- …without removing or mutating any existing entry…
    if not (v_new @> v_old) then
        raise exception 'chat_messages: existing read_by entries may not be removed or modified (REALTIME-101)';
    end if;

    -- …and the appended entry must be the caller's OWN receipt.
    if not exists (
        select 1
        from jsonb_array_elements(v_new) e
        where e ->> 'user_id' = v_profile::text
          and not (v_old @> jsonb_build_array(e))
    ) then
        raise exception 'chat_messages: the appended read_by entry must belong to the caller (REALTIME-101)';
    end if;

    return new;
end;
$$;
comment on function public.enforce_chat_read_by_append_only() is
    'T-032 / REALTIME-101: narrows the chat_messages_update_read_by member path to appending the caller''s own read receipt.';

drop trigger if exists chat_messages_read_by_guard on public.chat_messages;
create trigger chat_messages_read_by_guard
    before update on public.chat_messages
    for each row
    execute function public.enforce_chat_read_by_append_only();
