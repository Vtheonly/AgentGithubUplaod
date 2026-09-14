-- ============================================================================
-- 0098 — Student documents unification (SYNC-110 / T-372)
-- ============================================================================
-- ONE canonical metadata store for student documents on every platform.
--
-- CONTEXT (the owner's live report): the web portal lists documents from the
-- `student_documents` TABLE (0005; parent RLS 0043; staff RLS 0019; storage
-- policies 0018/0092), while the desktop's Documents tab read/wrote the
-- additive `students.documents_json` JSONB column (0038) — each platform was
-- blind to the other's documents even though BOTH upload file bytes to the
-- SAME `student-documents` bucket with the SAME
-- `<tenant_id>/<student_id>/<filename>` path convention.
--
-- WHAT THIS MIGRATION DOES (data only — no schema change):
--   1. Backfills every legacy `students.documents_json` entry into
--      `student_documents` rows so historical DESKTOP-uploaded documents
--      become visible on the WEBSITE (and on the desktop through its new
--      table-backed read path).
--   2. Maps the legacy category values to the canonical CHECK-constrained
--      kinds: medical→medical_certificate, justification→justification_letter,
--      contract→contract, other→other (any already-canonical value passes
--      through unchanged; anything else lands as 'other').
--   3. Idempotency: an entry is skipped when a `student_documents` row with
--      the same (tenant_id, student_id, storage_path) already exists —
--      re-running the migration (or racing it with a live insert) never
--      duplicates a document.
--   4. Entries whose storagePath is NULL/empty are SKIPPED (the table's
--      storage_path column is NOT NULL — a legacy descriptive record with no
--      binary cannot be represented; the count is reported for forensics).
--   5. uploaded_by is set to NULL for backfilled rows: the JSON entries
--      carry a display NAME (e.g. "admin@elimtiyaz.dz"), not a
--      user_profiles.id — inventing a UUID would corrupt provenance.
--
-- WHAT THIS MIGRATION DOES **NOT** DO:
--   - It does NOT null/modify `students.documents_json`: the column stays
--     as a FORENSIC ARCHIVE. No client reads or writes it after this task
--     (the desktop's mapStudentRow/updateStudent dropped both directions in
--     the same change set); dropping the column is a separate owner-gated
--     decision.
--   - It does NOT recover the UPLOAD-104-era orphaned STORAGE objects
--     (binaries whose row-insert 403'd): live cross-check showed each
--     corresponds to a file the owner later re-uploaded successfully —
--     auto-recovering them would mint duplicate document rows. Registered
--     as an owner decision (see docs/recovery/unknowns.md).
--
-- Numbering note: 0097 is owned by the concurrent WORKFORCE-501 session
-- (T-371, admin-account↔employee linkage); this file takes 0098 per the
-- merge-time coordination recorded in the task registry.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The backfill (idempotent, tenant/student/path-keyed)
-- ----------------------------------------------------------------------------
with legacy as (
    select s.id as student_id,
           s.tenant_id,
           e.value as entry,
           e.ordinality
    from public.students s
    cross join lateral jsonb_array_elements(s.documents_json) with ordinality as e(value, ordinality)
    where s.documents_json is not null
      and s.documents_json::text <> '[]'
),
mapped as (
    select l.tenant_id,
           l.student_id,
           l.ordinality,
           coalesce(l.entry->>'fileName', 'document') as file_name,
           case l.entry->>'category'
               when 'medical'           then 'medical_certificate'
               when 'justification'     then 'justification_letter'
               when 'contract'          then 'contract'
               when 'other'             then 'other'
               when 'birth_certificate'     then 'birth_certificate'
               when 'medical_certificate'  then 'medical_certificate'
               when 'justification_letter' then 'justification_letter'
               when 'id_photo'              then 'id_photo'
               when 'report_card'           then 'report_card'
               else 'other'
           end as kind,
           nullif(btrim(coalesce(l.entry->>'storagePath', '')), '') as storage_path,
           l.entry->>'note' as description,
           (l.entry->>'uploadedAt')::timestamptz as uploaded_at
    from legacy l
)
insert into public.student_documents (
    tenant_id, student_id, kind, file_name, storage_path, uploaded_at, description, uploaded_by
)
select m.tenant_id,
       m.student_id,
       m.kind,
       m.file_name,
       m.storage_path,
       coalesce(m.uploaded_at, now()),
       m.description,
       null
from mapped m
where m.storage_path is not null
  and not exists (
      -- Idempotency: skip entries whose row already exists (same tenant,
      -- student and binary path — the vault suffix makes every path unique
      -- per upload, so this is the exact document identity).
      select 1
      from public.student_documents d
      where d.tenant_id = m.tenant_id
        and d.student_id = m.student_id
        and d.storage_path = m.storage_path
  );

-- ----------------------------------------------------------------------------
-- 2. Forensic report columns (informational only — SELECT, no state change)
-- ----------------------------------------------------------------------------
-- How many legacy entries were skipped for having no binary (storagePath NULL)?
-- SELECT count(*) FROM legacy l WHERE nullif(btrim(coalesce(l.entry->>'storagePath','')), '') IS NULL;
-- (the CTE is gone by this point; the verify script re-derives it.)
