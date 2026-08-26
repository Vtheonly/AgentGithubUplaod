-- ============================================================================
-- 0038 — Student documents (vault §04.06: Student Profile Drawer "Documents")
-- ============================================================================
-- Adds an additive `documents_json` column to `public.students` so uploaded
-- attachments (medical certificates, justification letters, contracts) can
-- be persisted per student.
--
-- Design notes:
--   - Mirrors the existing `personnel.documents_json` pattern (migration
--     0027) — a JSONB array of descriptive records:
--       [{ "id", "fileName", "category", "note", "uploadedBy", "uploadedAt" }]
--   - Fully additive and backward-compatible: NULL by default, no NOT NULL
--     constraint, no data migration. The desktop's Supabase student mapper
--     treats NULL as "no documents" exactly like the personnel mapper.
--   - Binary blobs themselves live in object storage (Supabase Storage);
--     this column stores the metadata/index only, consistent with how
--     personnel documents and homework attachments are modeled.
-- ============================================================================

ALTER TABLE public.students
    ADD COLUMN IF NOT EXISTS documents_json JSONB DEFAULT NULL;

COMMENT ON COLUMN public.students.documents_json IS
    'Descriptive attachment records for the student profile Documents tab (vault §04.06): medical certificates, justification letters, contracts. Array of {id, fileName, category(medical|justification|contract|other), note, uploadedBy, uploadedAt}. NULL = no documents.';
