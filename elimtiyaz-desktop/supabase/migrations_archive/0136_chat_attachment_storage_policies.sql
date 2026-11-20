-- ============================================================================
-- 0136_chat_attachment_storage_policies.sql — THE CHAT ATTACHMENTS
-- LIFECYCLE, PART 1: MEMBER-SCOPED STORAGE ACCESS (T-464 / MEDIA-300,
-- 135th session, 2026-10-03)
-- ============================================================================
-- OWNER MANDATE (registered as MEDIA-300 before this fix, per AGENTS.md
-- §13): "fix all issues related to media/file attachments and test them
-- thoroughly across all platforms… images and PDFs can be uploaded, stored,
-- retrieved, displayed, and opened correctly across all supported
-- platforms. Do not only test the upload itself. Test the complete
-- lifecycle: Upload → Store → Send → Receive → Persist → Open → View →
-- Download. Verify this from every relevant client and communication
-- direction."
--
-- THE RLS BUG FIXED HERE: 0018's chat_attachments_read/write policies gate
-- on the 9-role STAFF list — 'parent' is NOT in it. The portal↔staff
-- channel is the owner-mandated communication path (ADR-012), yet a parent
-- opening an attachment the SCHOOL sent them gets a storage RLS denial,
-- and a parent can never attach a document to their own inquiry. The
-- bucket was therefore usable ONLY staff↔staff, contradicting ADR-012.
--
-- THE FIX — channel-membership scoping (the 0092 attendance-justifications
-- precedent, applied to chat): read AND write are authorized by the
-- object's CHANNEL FOLDER — folder[2] of the path must be a chat_channels
-- row the CALLER is a member of. This covers staff AND parent uniformly
-- (the caller's RLS-scoped chat_channels rows are exactly their own
-- conversations), and it is STRICTLY TIGHTER for staff than 0018's
-- role-list (any staff member could read ANY tenant chat attachment
-- before; now only channel members can).
--
-- PATH CONVENTION (canonical, effective now — mirrors the T-362
-- {tenant}/{entity}/{file} canon with entity = the channel):
--   {tenant_id}/{channel_id}/{timestamp}-{sanitized-filename}
-- The bucket itself is unchanged (private, 10 MB, jpeg/png/webp/pdf/xlsx/
-- plain — migration 0018): the MIME/size enforcement stays at the bucket
-- level, the membership enforcement moves to these policies.
--
-- IDEMPOTENCY: drop-if-exists + create-or-replace — safe to re-apply.
--
-- Per AGENTS.md §15 rule 10 (T-091/MIG-TOKENS pattern): applied to the
-- live project TOGETHER with its schema_migrations registration in one
-- atomic transaction (the 0105 registration stanza at the bottom).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Retire the 0018 staff-role-list policies (superseded by the
--    member-scoped policies below — the membership rule is strictly
--    tighter for staff and now includes parents in their own channels).
-- ----------------------------------------------------------------------------
drop policy if exists "chat_attachments_read" on storage.objects;
drop policy if exists "chat_attachments_write" on storage.objects;

-- ----------------------------------------------------------------------------
-- 2. Member-scoped READ — the object's channel folder must be one of the
--    caller's own conversations (staff and parent, uniformly).
-- ----------------------------------------------------------------------------
create policy "chat_attachments_member_read"
    on storage.objects for select to authenticated
    using (
        bucket_id = 'chat-attachments'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and (storage.foldername(name))[2] in (
            select c.id::text
              from public.chat_channels c
             where c.member_ids @> array[public.current_user_profile_id()]
        )
    );

-- ----------------------------------------------------------------------------
-- 3. Member-scoped WRITE (upload) — same membership rule: a channel member
--    may upload into their own conversation's folder. Parents can finally
--    attach documents to their inquiries (MEDIA-300's write half).
-- ----------------------------------------------------------------------------
create policy "chat_attachments_member_write"
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'chat-attachments'
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and (storage.foldername(name))[2] in (
            select c.id::text
              from public.chat_channels c
             where c.member_ids @> array[public.current_user_profile_id()]
        )
    );

-- ----------------------------------------------------------------------------
-- 4. Registration (T-091/MIG-TOKENS pattern — atomic with the live apply)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0136', '{0136_chat_attachment_storage_policies.sql}', 'chat_attachment_storage_policies')
on conflict (version) do nothing;
