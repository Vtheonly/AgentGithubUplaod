-- ============================================================================
-- 0107_filiere_specialite_classification.sql — T-401 (ACAD-501)
-- ============================================================================
-- The canonical academic classification model:
--
--   Niveau → Filière → Spécialité → Classe/Section
--
-- Before this migration the database had ZERO filière/spécialité support:
-- the only filière-adjacent field in the whole schema was
-- `subject_configurations.direction text DEFAULT 'general'` (0094, the
-- ADR-018 residual placeholder).
--
-- This migration:
--
--   §1  Creates the tenant-scoped `filieres` catalog table (filières AND
--       their spécialités — spécialités are rows with a `parent_code`)
--       with `applicable_grades text[]` on the canonical 14-code ladder.
--       Seeds the Algerian secondary-school catalog for every tenant that
--       owns academic_levels.
--
--   §2  Adds `filiere_code` / `specialite_code` to `classes`, `students`
--       and `student_academic_histories` (all nullable — NULL means
--       "untagged / general", which is the pre-0107 state of every
--       existing row, so the change is backward-compatible by
--       construction). Adds tenant-scoped indexes for filtering/statistics.
--
--   §3  Creates `fn_track_compatible(...)` — the ONE canonical
--       compatibility predicate (class formation must reject incompatible
--       student → class assignments):
--         * untagged class (NULL)          → always compatible;
--         * tagged class, untagged student → compatible (assignment
--           will tag the student — see §4);
--         * same filière                   → compatible;
--         * different filière that does NOT apply at the target grade
--           (e.g. a 1AS tronc-commun stream entering a 2AS filière) →
--           compatible (re-streaming is the point of class formation);
--         * different filière that DOES apply at the target grade
--           (e.g. a 2AS mathématiques student into a 2AS lettres class)
--           → INCOMPATIBLE.
--       Spécialité: a tagged class spécialité requires an equal student
--       spécialité (untagged student spécialité passes — assignment tags).
--
--   §4  Replaces `fn_finalize_class_placements` (0096): new-class drafts
--       carry `filiereCode`/`specialiteCode` (validated against the
--       catalog), student assignments run the §3 compatibility check,
--       and an assignment into a TAGGED class updates the student's
--       filière/spécialité to the class's (this is how classification
--       legitimately changes between academic years — T-401's
--       academic-year rule). Payload keys are optional: old clients
--       keep working (NULL = untagged, exactly the pre-0107 behavior).
--
--   §5  Replaces `upsert_student_from_import` (0037): adds
--       `p_filiere_code` / `p_specialite_code` (trailing params,
--       old-signature dropped first — the 0028/0037 pattern). The Excel
--       import corpus has no filière columns → NULL → COALESCE preserves
--       whatever is already stored (imports never erase classification).
--
--   §6  Replaces `execute_batch_promotion` (0059): the history rows now
--       stamp the student's filière/spécialité (the classification that
--       was in force during the completed year) — history preserves the
--       academic-year context of the classification (T-401 rule).
--
-- DESIGN NOTES / DELIBERATE OMISSIONS (see ADR-019):
--   * NO FK from classes/students to filieres — the catalog is seeded
--     per-tenant and future tenants are created without it; write paths
--     validate codes against the catalog instead (§4 for classes, the
--     desktop domain for students). Recorded as a residual in ADR-019.
--   * NO trigger on students.class_id enforcing compatibility — the
--     Android offline sync pushes partial student rows and must never be
--     rejected by a classification it does not know about. Compatibility
--     is enforced at class formation (§4) and in the desktop UI
--     validation, per ADR-019.
--   * The filières catalog is a DATA table (school-manageable), not an
--     enum — per T-401: "The exact catalog of valid values belongs to the
--     canonical academic configuration/database data, not to individual
--     UI components." The desktop mirrors it in
--     src/domain/model/filiere.ts (same mirroring convention as
--     GRADE_LEVELS vs academic_levels).
--
-- SAFETY / GUARDS (the 0055/0059/0096 hardening pattern):
--   * Caller-verified tenant resolution (current_tenant_id(); explicit
--     p_tenant_id only for service_role / global admins).
--   * SECURITY INVOKER everywhere — the caller's RLS applies.
--   * All new payloads are optional keys — pre-0107 clients keep working.
-- ============================================================================

-- ─── §1. The filières catalog ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.filieres (
    id                uuid        primary key default gen_random_uuid(),
    tenant_id         uuid        not null references public.tenants(id) on delete cascade,
    code              text        not null,
    label_fr          text        not null,
    label_ar          text,
    -- Canonical grade codes this track applies to (subset of the 14-code
    -- ladder: prescolaire_1..prescolaire_2, 1ap..5ap, 1am..4am,
    -- 1ere_annee..3eme_annee). NOT a range — an explicit list, so no
    -- ladder-ordering logic is ever needed to test applicability.
    applicable_grades text[]      not null,
    -- NULL = a filière; set = a spécialité (subdivision of the parent).
    parent_code       text,
    is_active         boolean     not null default true,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    constraint filieres_tenant_code_key unique (tenant_id, code),
    constraint filieres_parent_fk foreign key (tenant_id, parent_code)
        references public.filieres (tenant_id, code) on delete restrict
);

comment on table public.filieres is
  'T-401: the canonical academic classification catalog (filières and their spécialités). Specialities are rows with parent_code set. applicable_grades lists canonical grade_level codes.';

-- RLS: staff read the catalog; super_admin/support_staff manage it.
alter table public.filieres enable row level security;

drop policy if exists filieres_staff_read on public.filieres;
create policy filieres_staff_read on public.filieres
  for select
  using (
    tenant_id = public.current_tenant_id()
    and public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text, 'teacher'::text, 'financial_officer'::text])
  );

drop policy if exists filieres_admin_manage on public.filieres;
create policy filieres_admin_manage on public.filieres
  for all
  using (
    tenant_id = public.current_tenant_id()
    and public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text])
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text])
  );

-- The Algerian secondary-school catalog, seeded for every tenant that
-- owns academic levels (the demo tenant + any production tenants).
-- 'general' applies to the full ladder; tronc-commun streams to 1AS;
-- the six national filières to 2AS/3AS. Two statements so parent
-- filières exist before the spécialité rows reference them (the FK is
-- immediate). Gestion & Économie spécialités are NOT seeded (the school's
-- actual practice is unconfirmed — recorded in docs/recovery/unknowns.md;
-- the catalog is data, they can be added).

-- (1) the filières
insert into public.filieres (tenant_id, code, label_fr, label_ar, applicable_grades, parent_code)
select t.tenant_id, v.code, v.label_fr, v.label_ar, v.applicable_grades, NULL::text
from (select distinct tenant_id from public.academic_levels) t
cross join (values
    ('general',                  'Générale',                          'عامة',                  ARRAY['prescolaire_1','prescolaire_2','1ap','2ap','3ap','4ap','5ap','1am','2am','3am','4am','1ere_annee','2eme_annee','3eme_annee']::text[]),
    ('tronc_commun_sciences',    'Tronc Commun Sciences',             'جذع مشترك علوم',        ARRAY['1ere_annee']::text[]),
    ('tronc_commun_lettres',     'Tronc Commun Lettres',              'جذع مشترك آداب',        ARRAY['1ere_annee']::text[]),
    ('tronc_commun_technologie', 'Tronc Commun Technologie',          'جذع مشترك تكنولوجيا',   ARRAY['1ere_annee']::text[]),
    ('lettres_philosophie',      'Lettres et Philosophie',            'آداب وفلسفة',           ARRAY['2eme_annee','3eme_annee']::text[]),
    ('langues_etrangeres',       'Langues Étrangères',                'لغات أجنبية',           ARRAY['2eme_annee','3eme_annee']::text[]),
    ('sciences_experimentales',  'Sciences Expérimentales',           'علوم تجريبية',           ARRAY['2eme_annee','3eme_annee']::text[]),
    ('mathematiques',            'Mathématiques',                     'رياضيات',               ARRAY['2eme_annee','3eme_annee']::text[]),
    ('gestion_economie',        'Gestion et Économie',               'تسيير واقتصاد',         ARRAY['2eme_annee','3eme_annee']::text[]),
    ('technique_mathematique',   'Technique Mathématique',            'تقني رياضي',            ARRAY['2eme_annee','3eme_annee']::text[])
) as v(code, label_fr, label_ar, applicable_grades)
on conflict (tenant_id, code) do nothing;

-- (2) the génie spécialités (Technique Mathématique)
insert into public.filieres (tenant_id, code, label_fr, label_ar, applicable_grades, parent_code)
select t.tenant_id, v.code, v.label_fr, v.label_ar, v.applicable_grades, 'technique_mathematique'
from (select distinct tenant_id from public.academic_levels) t
cross join (values
    ('genie_mecanique',         'Génie Mécanique',                   'هندسة ميكانيكية',       ARRAY['2eme_annee','3eme_annee']::text[]),
    ('genie_civil',             'Génie Civil',                       'هندسة مدنية',           ARRAY['2eme_annee','3eme_annee']::text[]),
    ('genie_electrique',        'Génie Électrique',                  'هندسة كهربائية',        ARRAY['2eme_annee','3eme_annee']::text[]),
    ('genie_procedes',          'Génie des Procédés',                'هندسة الطرائق',         ARRAY['2eme_annee','3eme_annee']::text[])
) as v(code, label_fr, label_ar, applicable_grades)
on conflict (tenant_id, code) do nothing;

-- ─── §2. Classification columns ────────────────────────────────────────────

alter table public.classes add column if not exists filiere_code text;
alter table public.classes add column if not exists specialite_code text;
comment on column public.classes.filiere_code is
  'T-401: the class''s academic stream (filieres.code). NULL = untagged/general (pre-0107 classes).';
comment on column public.classes.specialite_code is
  'T-401: the class''s spécialité (filieres.code with parent_code set). NULL = none.';

alter table public.students add column if not exists filiere_code text;
alter table public.students add column if not exists specialite_code text;
comment on column public.students.filiere_code is
  'T-401: the student''s current academic stream (filieres.code). NULL = untagged/general.';
comment on column public.students.specialite_code is
  'T-401: the student''s current spécialité. NULL = none.';

alter table public.student_academic_histories add column if not exists filiere_code text;
alter table public.student_academic_histories add column if not exists specialite_code text;
comment on column public.student_academic_histories.filiere_code is
  'T-401: the classification in force during the archived year (stamped by execute_batch_promotion).';

create index if not exists classes_filiere_idx on public.classes (tenant_id, filiere_code);
create index if not exists students_filiere_idx on public.students (tenant_id, filiere_code) where deleted_at is null;

-- ─── §3. fn_track_compatible — the ONE compatibility predicate ─────────────

create or replace function public.fn_track_compatible(
    p_student_filiere   text,
    p_student_specialite text,
    p_class_filiere     text,
    p_class_specialite  text,
    p_class_grade        text,
    p_tenant_id         uuid default null
)
returns boolean
language plpgsql
stable
as $$
declare
    v_tenant uuid;
    v_student_filiere text := lower(coalesce(nullif(btrim(p_student_filiere), ''), 'general'));
    v_class_filiere   text := lower(coalesce(nullif(btrim(p_class_filiere), ''), 'general'));
    v_student_spec    text := lower(nullif(btrim(p_student_specialite), ''));
    v_class_spec      text := lower(nullif(btrim(p_class_specialite), ''));
    v_applies         boolean;
begin
    -- Untagged class: always compatible (legacy pre-0107 behavior).
    if p_class_filiere is null or v_class_filiere = 'general' then
        return true;
    end if;

    -- Spécialité integrity: a class tagged with a spécialité requires an
    -- equal student spécialité (an untagged student spécialité passes —
    -- the assignment tags them).
    if v_class_spec is not null and v_student_spec is not null and v_student_spec <> v_class_spec then
        return false;
    end if;

    -- Untagged student: compatible with any tagged class (the assignment
    -- tags the student with the class's stream).
    if p_student_filiere is null or v_student_filiere = 'general' then
        return true;
    end if;

    -- Same stream: compatible.
    if v_student_filiere = v_class_filiere then
        return true;
    end if;

    -- Different stream: compatible only when the student's stream is NOT
    -- applicable at the class's grade — that is a re-streaming promotion
    -- (1AS tronc commun → 2AS filière), the whole point of year-end
    -- class formation. A stream that DOES apply at this grade and differs
    -- (2AS maths student into a 2AS lettres class) is a real conflict.
    v_tenant := coalesce(p_tenant_id, public.current_tenant_id());
    select exists (
        select 1
          from public.filieres f
         where f.tenant_id = v_tenant
           and f.code = v_student_filiere
           and p_class_grade = any (f.applicable_grades)
    ) into v_applies;

    return v_applies is not true;
end;
$$;

comment on function public.fn_track_compatible is
  'T-401: the canonical student→class classification-compatibility predicate (class formation guard). Untagged class/student always pass; a differing stream that applies at the target grade is a conflict.';

-- ─── §4. fn_finalize_class_placements v2 (classification-aware) ────────────
-- Full replacement of the 0096 definition. The only behavioral changes:
--   * new-class drafts accept optional filiereCode/specialiteCode
--     (validated against the tenant catalog when set);
--   * student assignments run fn_track_compatible and FAIL (22023) on a
--     conflicting classification;
--   * an assignment into a TAGGED class stamps the student's
--     filière/spécialité from the class (the legitimate classification
--     transition of year-end class formation).
-- Everything else (tenant guards, year resolution, draft-id mapping,
-- duplicate-code check, grade-integrity check, audit entry, return shape)
-- is byte-equivalent in behavior to 0096.

create or replace function public.fn_finalize_class_placements(p_target_year_id uuid default null::uuid, p_target_year_code text default null::text, p_new_classes jsonb default '[]'::jsonb, p_updated_classes jsonb default '[]'::jsonb, p_student_assignments jsonb default '[]'::jsonb, p_actor_profile_id uuid default null::uuid, p_actor_name text default null::text, p_tenant_id uuid default null::uuid)
 returns jsonb
 language plpgsql
as $function$
DECLARE
    v_class_record jsonb;
    v_student_record jsonb;
    v_update_record jsonb;
    v_tenant uuid;
    v_caller_is_service_role boolean;
    v_target_year public.academic_years;
    v_academic_level_id uuid;
    v_created_class_id uuid;
    v_created_classes_map jsonb := '{}'::jsonb;
    v_final_target_class_id uuid;
    v_target_class_grade text;
    v_class_found boolean;
    v_class_filiere text;
    v_class_specialite text;
    v_filiere_code text;
    v_specialite_code text;
    v_student_filiere text;
    v_student_specialite text;
    v_created_classes_count integer := 0;
    v_updated_classes_count integer := 0;
    v_assigned_students_count integer := 0;
    v_draft_id text;
    v_code text;
BEGIN
    IF p_new_classes IS NULL OR jsonb_typeof(p_new_classes) <> 'array' THEN
        RAISE EXCEPTION 'fn_finalize_class_placements: p_new_classes must be a JSON array'
          USING ERRCODE = '22023';
    END IF;
    IF p_updated_classes IS NULL OR jsonb_typeof(p_updated_classes) <> 'array' THEN
        RAISE EXCEPTION 'fn_finalize_class_placements: p_updated_classes must be a JSON array'
          USING ERRCODE = '22023';
    END IF;
    IF p_student_assignments IS NULL OR jsonb_typeof(p_student_assignments) <> 'array' THEN
        RAISE EXCEPTION 'fn_finalize_class_placements: p_student_assignments must be a JSON array'
          USING ERRCODE = '22023';
    END IF;

    v_caller_is_service_role := coalesce(auth.jwt() ->> 'role', '') = 'service_role';

    -- Tenant resolution + caller verification (0055/0059 pattern).
    v_tenant := public.current_tenant_id();
    IF p_tenant_id IS NOT NULL AND (v_tenant IS NULL OR p_tenant_id <> v_tenant) THEN
        IF NOT v_caller_is_service_role AND NOT public.is_global_admin() THEN
            RAISE EXCEPTION 'fn_finalize_class_placements: caller tenant mismatch (p_tenant_id=%)', p_tenant_id
              USING ERRCODE = '42501';
        END IF;
        v_tenant := p_tenant_id;
    END IF;

    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'fn_finalize_class_placements: caller tenant unresolvable'
          USING ERRCODE = '42501';
    END IF;

    -- ── target academic year: by id when a UUID is supplied, else by code ──
    IF p_target_year_id IS NOT NULL THEN
        SELECT * INTO v_target_year
          FROM public.academic_years ay
         WHERE ay.id = p_target_year_id
           AND ay.tenant_id = v_tenant;
    END IF;
    IF v_target_year.id IS NULL AND p_target_year_code IS NOT NULL AND p_target_year_code <> '' THEN
        SELECT * INTO v_target_year
          FROM public.academic_years ay
         WHERE ay.tenant_id = v_tenant
           AND (ay.code = p_target_year_code OR ay.label = p_target_year_code)
         ORDER BY ay.is_current DESC, ay.start_date DESC
         LIMIT 1;
    END IF;
    IF v_target_year.id IS NULL THEN
        RAISE EXCEPTION 'fn_finalize_class_placements: target academic year "%" not found in tenant (create it in Années scolaires first)', coalesce(p_target_year_code, p_target_year_id::text)
          USING ERRCODE = '23503';
    END IF;

    -- ── Step A: insert the newly drafted classes ──────────────────────────
    FOR v_class_record IN SELECT * FROM jsonb_array_elements(p_new_classes)
    LOOP
        v_draft_id := NULLIF(v_class_record ->> 'clientDraftId', '');
        v_code := NULLIF(v_class_record ->> 'code', '');

        IF NULLIF(v_class_record ->> 'name', '') IS NULL THEN
            RAISE EXCEPTION 'fn_finalize_class_placements: new class draft % lacks a name', v_class_record
              USING ERRCODE = '22023';
        END IF;
        IF NULLIF(v_class_record ->> 'gradeCode', '') IS NULL THEN
            RAISE EXCEPTION 'fn_finalize_class_placements: new class draft "%" lacks a gradeCode', v_class_record ->> 'name'
              USING ERRCODE = '22023';
        END IF;
        IF v_code IS NULL THEN
            RAISE EXCEPTION 'fn_finalize_class_placements: new class draft "%" lacks a code', v_class_record ->> 'name'
              USING ERRCODE = '22023';
        END IF;

        -- academic_level_id RESOLVED from academic_levels.grade_code (the
        -- column is a real UUID FK — never synthesized).
        SELECT al.id INTO v_academic_level_id
          FROM public.academic_levels al
         WHERE al.tenant_id = v_tenant
           AND al.grade_code = v_class_record ->> 'gradeCode';
        IF v_academic_level_id IS NULL THEN
            RAISE EXCEPTION 'fn_finalize_class_placements: no academic_level for grade_code "%" (tenant %)', v_class_record ->> 'gradeCode', v_tenant
              USING ERRCODE = '23503';
        END IF;

        -- T-401: classification codes validated against the tenant catalog
        -- when provided (NULL = untagged, the pre-0107 default).
        v_filiere_code := lower(NULLIF(btrim(v_class_record ->> 'filiereCode'), ''));
        v_specialite_code := lower(NULLIF(btrim(v_class_record ->> 'specialiteCode'), ''));
        IF v_filiere_code IS NOT NULL THEN
            IF NOT EXISTS (SELECT 1 FROM public.filieres f
                            WHERE f.tenant_id = v_tenant AND f.code = v_filiere_code
                              AND f.parent_code IS NULL AND f.is_active) THEN
                RAISE EXCEPTION 'fn_finalize_class_placements: unknown filiere_code "%" for tenant (draft "%")', v_filiere_code, v_class_record ->> 'name'
                  USING ERRCODE = '23503';
            END IF;
            IF v_filiere_code = 'general' AND v_specialite_code IS NOT NULL THEN
                RAISE EXCEPTION 'fn_finalize_class_placements: a general class cannot carry a specialite (draft "%")', v_class_record ->> 'name'
                  USING ERRCODE = '22023';
            END IF;
            IF v_specialite_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.filieres f
                                                              WHERE f.tenant_id = v_tenant AND f.code = v_specialite_code
                                                                AND f.parent_code = v_filiere_code AND f.is_active) THEN
                RAISE EXCEPTION 'fn_finalize_class_placements: specialite_code "%" is not a spécialité of filière "%" (draft "%")', v_specialite_code, v_filiere_code, v_class_record ->> 'name'
                  USING ERRCODE = '23503';
            END IF;
        END IF;

        -- The unique constraint is (tenant_id, academic_year_id, code).
        SELECT TRUE INTO v_class_found
          FROM public.classes c
         WHERE c.tenant_id = v_tenant
           AND c.academic_year_id = v_target_year.id
           AND c.code = v_code;
        IF v_class_found THEN
            RAISE EXCEPTION 'fn_finalize_class_placements: class code "%" already exists in year %', v_code, v_target_year.label
              USING ERRCODE = '23505';
        END IF;

        INSERT INTO public.classes (
            tenant_id, academic_year_id, academic_level_id,
            code, name, grade_code, section,
            room, capacity,
            homeroom_teacher_id, homeroom_teacher_name,
            filiere_code, specialite_code,
            is_active
        ) VALUES (
            v_tenant, v_target_year.id, v_academic_level_id,
            v_code, v_class_record ->> 'name', v_class_record ->> 'gradeCode',
            COALESCE(NULLIF(v_class_record ->> 'section', ''), 'A'),
            NULLIF(v_class_record ->> 'room', ''),
            COALESCE(NULLIF(v_class_record ->> 'capacity', '')::int, 30),
            CASE
                WHEN NULLIF(v_class_record ->> 'homeroomTeacherId', '') IS NULL THEN NULL
                ELSE (v_class_record ->> 'homeroomTeacherId')::uuid
            END,
            NULLIF(v_class_record ->> 'homeroomTeacherName', ''),
            CASE WHEN v_filiere_code = 'general' THEN NULL ELSE v_filiere_code END,
            v_specialite_code,
            TRUE
        )
        RETURNING id INTO v_created_class_id;

        IF v_draft_id IS NOT NULL THEN
            v_created_classes_map := jsonb_set(
                v_created_classes_map,
                ARRAY[v_draft_id],
                to_jsonb(v_created_class_id::text)
            );
        END IF;

        v_created_classes_count := v_created_classes_count + 1;
    END LOOP;

    -- ── Step B: apply patches to EXISTING classes of the target year ──────
    -- (room / capacity / homeroom only — classification is set at creation
    --  or via class editing, deliberately not patchable here: changing a
    --  class's stream mid-formation would strand already-assigned students.)
    FOR v_update_record IN SELECT * FROM jsonb_array_elements(p_updated_classes)
    LOOP
        IF (v_update_record ->> 'id')::uuid IS NULL THEN
            RAISE EXCEPTION 'fn_finalize_class_placements: class update entry lacks a valid id (%)', v_update_record
              USING ERRCODE = '22023';
        END IF;

        UPDATE public.classes c
           SET room = CASE WHEN v_update_record ? 'room'
                           THEN NULLIF(v_update_record ->> 'room', '') ELSE c.room END,
               capacity = CASE WHEN v_update_record ? 'capacity'
                               THEN COALESCE(NULLIF(v_update_record ->> 'capacity', '')::int, c.capacity)
                               ELSE c.capacity END,
               homeroom_teacher_id = CASE
                   WHEN v_update_record ? 'homeroomTeacherId' THEN
                       CASE WHEN NULLIF(v_update_record ->> 'homeroomTeacherId', '') IS NULL THEN NULL
                            ELSE (v_update_record ->> 'homeroomTeacherId')::uuid END
                   ELSE c.homeroom_teacher_id END,
               homeroom_teacher_name = CASE WHEN v_update_record ? 'homeroomTeacherName'
                                             THEN NULLIF(v_update_record ->> 'homeroomTeacherName', '')
                                             ELSE c.homeroom_teacher_name END,
               updated_at = now()
         WHERE c.id = (v_update_record ->> 'id')::uuid
           AND c.tenant_id = v_tenant
           AND c.academic_year_id = v_target_year.id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'fn_finalize_class_placements: class % not found in tenant/year % (existing-class patches must target the placement year)', v_update_record ->> 'id', v_target_year.label
              USING ERRCODE = '23503';
        END IF;

        v_updated_classes_count := v_updated_classes_count + 1;
    END LOOP;

    -- ── Step C: assign students to their target sections ──────────────────
    -- Historical records are deliberately NOT touched (INV-1 of the studio
    -- spec): student_academic_histories rows belong to the promotion flow.
    FOR v_student_record IN SELECT * FROM jsonb_array_elements(p_student_assignments)
    LOOP
        -- Resolve the final target class id (draft map first, then UUID).
        IF v_student_record ->> 'targetClassId' IS NOT NULL
           AND v_created_classes_map ? (v_student_record ->> 'targetClassId') THEN
            v_final_target_class_id := (v_created_classes_map ->> (v_student_record ->> 'targetClassId'))::uuid;
        ELSIF NULLIF(v_student_record ->> 'targetClassId', '') IS NOT NULL THEN
            v_final_target_class_id := (v_student_record ->> 'targetClassId')::uuid;
        ELSE
            RAISE EXCEPTION 'fn_finalize_class_placements: assignment for student % lacks a targetClassId', v_student_record ->> 'studentId'
              USING ERRCODE = '22023';
        END IF;

        -- Target class must exist in the tenant (RLS hides foreign rows →
        -- not found → the batch fails closed).
        SELECT c.grade_code, c.filiere_code, c.specialite_code
          INTO v_target_class_grade, v_class_filiere, v_class_specialite
          FROM public.classes c
         WHERE c.id = v_final_target_class_id
           AND c.tenant_id = v_tenant;
        IF v_target_class_grade IS NULL THEN
            RAISE EXCEPTION 'fn_finalize_class_placements: target class % not found in tenant %', v_final_target_class_id, v_tenant
              USING ERRCODE = '23503';
        END IF;

        -- Grade integrity: the assignment's gradeLevel must match the
        -- target section's grade (prevents cross-grade corruption).
        IF NULLIF(v_student_record ->> 'gradeLevel', '') IS NOT NULL
           AND v_student_record ->> 'gradeLevel' <> v_target_class_grade THEN
            RAISE EXCEPTION 'fn_finalize_class_placements: student % assignment grade "%" does not match target class grade "%"', v_student_record ->> 'studentId', v_student_record ->> 'gradeLevel', v_target_class_grade
              USING ERRCODE = '22023';
        END IF;

        -- Student must exist in the caller's tenant (not deleted); fetch
        -- the current classification for the compatibility check. FOUND
        -- distinguishes "row with NULL filière" from "no row".
        SELECT s.filiere_code, s.specialite_code
          INTO v_student_filiere, v_student_specialite
          FROM public.students s
         WHERE s.id = (v_student_record ->> 'studentId')::uuid
           AND s.tenant_id = v_tenant
           AND s.deleted_at IS NULL;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'fn_finalize_class_placements: student % not found in tenant %', v_student_record ->> 'studentId', v_tenant
              USING ERRCODE = '23503';
        END IF;

        -- T-401: classification compatibility — a conflicting stream is a
        -- hard error (the whole batch rolls back, like the grade check).
        IF NOT public.fn_track_compatible(
                 v_student_filiere, v_student_specialite,
                 v_class_filiere, v_class_specialite,
                 v_target_class_grade, v_tenant) THEN
            RAISE EXCEPTION 'fn_finalize_class_placements: student % classification (filière "%" / spécialité "%") is incompatible with target class % (filière "%" / spécialité "%")',
                v_student_record ->> 'studentId', coalesce(v_student_filiere, '—'), coalesce(v_student_specialite, '—'),
                v_final_target_class_id, coalesce(v_class_filiere, '—'), coalesce(v_class_specialite, '—')
              USING ERRCODE = '22023';
        END IF;

        UPDATE public.students
           SET class_id = v_final_target_class_id,
               grade_level_code = COALESCE(NULLIF(v_student_record ->> 'gradeLevel', ''), grade_level_code),
               -- T-401: a tagged class stamps the student's classification
               -- (the legitimate year-end re-streaming transition). An
               -- untagged class leaves the student's classification intact.
               filiere_code = CASE WHEN v_class_filiere IS NOT NULL THEN v_class_filiere
                                   ELSE filiere_code END,
               specialite_code = CASE WHEN v_class_specialite IS NOT NULL THEN v_class_specialite
                                       ELSE specialite_code END,
               updated_at = now()
         WHERE id = (v_student_record ->> 'studentId')::uuid
           AND tenant_id = v_tenant;

        v_assigned_students_count := v_assigned_students_count + 1;
    END LOOP;

    -- ── Step D: ONE audit entry for the whole batch (0014 entry point) ────
    PERFORM public.write_audit_log(
        p_tenant_id   := v_tenant,
        p_action      := 'class.placement_finalize',
        p_entity_type := 'class',
        p_entity_id   := NULL,
        p_actor_id    := p_actor_profile_id,
        p_actor_name  := p_actor_name,
        p_after_json  := jsonb_build_object(
                             'target_academic_year', v_target_year.label,
                             'classes_created', v_created_classes_count,
                             'classes_updated', v_updated_classes_count,
                             'students_assigned', v_assigned_students_count
                         ),
        p_note        := format('Constitution des classes effectuée pour %s : %s classe(s) créée(s), %s mise(s) à jour, %s élève(s) affecté(s).',
                                v_target_year.label, v_created_classes_count, v_updated_classes_count, v_assigned_students_count)
    );

    RETURN jsonb_build_object(
        'ok', TRUE,
        'targetYearId', v_target_year.id,
        'createdClassesCount', v_created_classes_count,
        'updatedClassesCount', v_updated_classes_count,
        'assignedStudentsCount', v_assigned_students_count
    );
END;
$function$;

-- ─── §5. upsert_student_from_import — classification params ───────────────

DO $_drop_student$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS sig
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'upsert_student_from_import'
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %s', r.sig);
    END LOOP;
END
$_drop_student$;

CREATE OR REPLACE FUNCTION public.upsert_student_from_import(
  p_tenant_id        uuid,
  p_student_code     text,
  p_parent_id        text,               -- 0037: UUID OR parent_code / local ref
  p_first_name       text,
  p_last_name        text,
  p_display_name     text DEFAULT NULL,
  p_middle_name      text DEFAULT NULL,
  p_date_of_birth    date DEFAULT NULL,
  p_gender           text DEFAULT NULL,
  p_grade_level_id   uuid DEFAULT NULL,
  p_class_id         uuid DEFAULT NULL,
  p_enrollment_date  date DEFAULT NULL,
  p_enrollment_status text DEFAULT 'active',
  p_medical_notes    text DEFAULT NULL,
  p_is_active        boolean DEFAULT true,
  -- 0028 params (preserved so the desktop caller keeps working):
  p_grade_level_code text DEFAULT NULL,
  p_transport_tier   text DEFAULT NULL,
  p_payment_plan     text DEFAULT 'tranches',
  -- 0107 params (T-401 classification):
  p_filiere_code     text DEFAULT NULL,
  p_specialite_code  text DEFAULT NULL
) RETURNS TABLE (
  out_student_id     uuid,
  out_student_code   text,
  out_was_inserted   boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id        uuid;
  v_code      text := COALESCE(NULLIF(TRIM(p_student_code), ''),
                               'ELV-' || EXTRACT(YEAR FROM now())::int || '-' || UPPER(SUBSTRING(MD5(RANDOM()::text), 1, 6)));
  v_existing  uuid;
  v_inserted  boolean := false;
  v_first     text := COALESCE(NULLIF(TRIM(p_first_name), ''), '');
  v_last      text := COALESCE(NULLIF(TRIM(p_last_name), ''), '');
  v_disp      text := COALESCE(NULLIF(TRIM(p_display_name), ''),
                               NULLIF(TRIM(v_first || ' ' || v_last), ''));
  v_plan      text := CASE WHEN p_payment_plan IN ('tranches', 'full_annual') THEN p_payment_plan ELSE 'tranches' END;
  -- 0037: Android pushes 'M'/'F' gender codes while the students.gender CHECK
  -- requires male/female/other — normalize at the RPC boundary.
  v_gender    text := CASE lower(COALESCE(p_gender, ''))
                     WHEN 'm' THEN 'male'
                     WHEN 'f' THEN 'female'
                     WHEN 'male' THEN 'male'
                     WHEN 'female' THEN 'female'
                     WHEN 'other' THEN 'other'
                     ELSE NULL END;
  v_parent    uuid := public.resolve_parent_ref(p_tenant_id, p_parent_id);
  -- 0107: normalized classification ('general' → NULL storage, the
  -- untagged pre-0107 state; COALESCE preserves existing values).
  v_filiere   text := lower(NULLIF(btrim(COALESCE(p_filiere_code, '')), ''));
  v_specialite text := lower(NULLIF(btrim(COALESCE(p_specialite_code, '')), ''));
BEGIN
  IF v_parent IS NULL THEN
      RAISE EXCEPTION 'upsert_student_from_import: unresolvable parent ref %', p_parent_id
        USING HINT = 'Push the parent (upsert_parent_from_import) before its students.';
  END IF;

  IF v_filiere = 'general' THEN
      v_filiere := NULL;
  END IF;

  -- Identity resolution (column refs qualified — see 0031):
  --   1. (tenant_id, student_code)
  --   2. (parent_id, first_name, last_name) when all three are non-empty
  SELECT s.id INTO v_existing
  FROM public.students s
  WHERE s.tenant_id = p_tenant_id
    AND s.student_code = v_code
    AND s.deleted_at IS NULL
  LIMIT 1;

  IF v_existing IS NULL AND v_first <> '' AND v_last <> '' THEN
    SELECT s.id INTO v_existing
    FROM public.students s
    WHERE s.tenant_id = p_tenant_id
      AND s.parent_id = v_parent
      AND s.first_name = v_first
      AND s.last_name = v_last
      AND s.deleted_at IS NULL
    LIMIT 1;
  END IF;

  IF v_existing IS NOT NULL THEN
    UPDATE public.students s SET
      parent_id           = v_parent,
      first_name          = COALESCE(NULLIF(TRIM(p_first_name), ''), s.first_name),
      last_name           = COALESCE(NULLIF(TRIM(p_last_name), ''), s.last_name),
      display_name        = COALESCE(v_disp, s.display_name),
      middle_name         = COALESCE(p_middle_name, s.middle_name),
      date_of_birth       = COALESCE(p_date_of_birth, s.date_of_birth),
      gender              = COALESCE(v_gender, s.gender),
      grade_level_id      = COALESCE(p_grade_level_id, s.grade_level_id),
      class_id            = COALESCE(p_class_id, s.class_id),
      enrollment_date     = COALESCE(p_enrollment_date, s.enrollment_date),
      enrollment_status   = COALESCE(NULLIF(TRIM(p_enrollment_status), ''), s.enrollment_status),
      medical_notes       = COALESCE(p_medical_notes, s.medical_notes),
      is_active           = p_is_active,
      grade_level_code    = COALESCE(NULLIF(TRIM(p_grade_level_code), ''), s.grade_level_code),
      transport_tier      = COALESCE(NULLIF(TRIM(p_transport_tier), ''), s.transport_tier),
      payment_plan        = v_plan,
      -- 0107: classification — provided value wins, else preserved.
      filiere_code        = COALESCE(v_filiere, s.filiere_code),
      specialite_code     = COALESCE(v_specialite, s.specialite_code),
      updated_at          = now()
    WHERE s.id = v_existing;
    v_id := v_existing;
  ELSE
    INSERT INTO public.students (
      tenant_id, student_code, parent_id, first_name, middle_name, last_name,
      display_name, date_of_birth, gender, grade_level_id, class_id,
      enrollment_date, enrollment_status, medical_notes, is_active,
      grade_level_code, transport_tier, payment_plan,
      filiere_code, specialite_code
    ) VALUES (
      p_tenant_id, v_code, v_parent, v_first, p_middle_name, v_last,
      v_disp, COALESCE(p_date_of_birth, '2000-01-01'::date), v_gender, p_grade_level_id, p_class_id,
      COALESCE(p_enrollment_date, current_date), COALESCE(NULLIF(TRIM(p_enrollment_status), ''), 'active'),
      p_medical_notes, p_is_active,
      p_grade_level_code, p_transport_tier, v_plan,
      v_filiere, v_specialite
    )
    RETURNING id INTO v_id;
    v_inserted := true;
  END IF;

  RETURN QUERY SELECT v_id, v_code, v_inserted;
END;
$$;

COMMENT ON FUNCTION public.upsert_student_from_import IS
  'Idempotent upsert for students. Identity: (tenant, student_code) with fallback '
  'to (parent_id, first_name, last_name). 0037: p_parent_id accepts a server UUID, '
  'a canonical parent_code (PAR-YYYY-XXXXXX) or a mobile local ref; preserves the '
  '0028 params (grade_level_code / transport_tier / payment_plan). '
  '0107 (T-401): p_filiere_code / p_specialite_code set the academic classification '
  '(NULL/''general'' = untagged; COALESCE preserves the stored classification on '
  'partial syncs — imports never erase classification).';

-- ─── §6. execute_batch_promotion — stamp classification into history ────────
-- Full replacement of the 0059 definition with ONE change: the history rows
-- record the student's filière/spécialité (the classification in force
-- during the completed year — T-401's academic-year context preservation).
-- Everything else (validation, atomicity, advancement semantics, audit)
-- is byte-equivalent in behavior to 0059.

CREATE OR REPLACE FUNCTION public.execute_batch_promotion(
    p_decisions jsonb,
    p_actor_profile_id uuid DEFAULT NULL,
    p_actor_name text DEFAULT NULL,
    p_tenant_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_decision jsonb;
    v_student_id uuid;
    v_decision_code text;
    v_next_grade text;
    v_academic_year text;
    v_count integer := 0;
    v_updated_ids uuid[] := '{}';
    v_tenant uuid;
    v_caller_is_service_role boolean;
    v_student_found boolean;
    v_history_row public.student_academic_histories%ROWTYPE;
    v_valid_decisions text[] := ARRAY['promoted', 'repeated', 'graduated', 'transferred'];
    v_filiere_code text;
    v_specialite_code text;
BEGIN
    IF p_decisions IS NULL OR jsonb_typeof(p_decisions) <> 'array' THEN
        RAISE EXCEPTION 'execute_batch_promotion: p_decisions must be a JSON array'
          USING ERRCODE = '22023';
    END IF;

    v_caller_is_service_role := coalesce(auth.jwt() ->> 'role', '') = 'service_role';

    -- Tenant resolution + caller verification (same rule as 0059).
    v_tenant := public.current_tenant_id();
    IF p_tenant_id IS NOT NULL AND (v_tenant IS NULL OR p_tenant_id <> v_tenant) THEN
        IF NOT v_caller_is_service_role AND NOT public.is_global_admin() THEN
            RAISE EXCEPTION 'execute_batch_promotion: caller tenant mismatch (p_tenant_id=%)', p_tenant_id
              USING ERRCODE = '42501';
        END IF;
        v_tenant := p_tenant_id;
    END IF;

    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'execute_batch_promotion: caller tenant unresolvable'
          USING ERRCODE = '42501';
    END IF;

    FOR v_decision IN SELECT * FROM jsonb_array_elements(p_decisions)
    LOOP
        v_student_id     := (v_decision ->> 'student_id')::uuid;
        v_decision_code  := v_decision ->> 'decision';
        v_next_grade     := NULLIF(v_decision ->> 'next_grade_code', '');
        v_academic_year  := v_decision ->> 'academic_year';

        -- ── validation: fail the WHOLE batch on any bad decision ──
        IF v_student_id IS NULL THEN
            RAISE EXCEPTION 'execute_batch_promotion: decision entry without a valid student_id (%)', v_decision
              USING ERRCODE = '22023';
        END IF;
        IF v_decision_code IS NULL OR NOT (v_decision_code = ANY (v_valid_decisions)) THEN
            RAISE EXCEPTION 'execute_batch_promotion: invalid decision "%" for student %', v_decision_code, v_student_id
              USING ERRCODE = '22023';
        END IF;
        IF v_academic_year IS NULL OR v_academic_year = '' THEN
            RAISE EXCEPTION 'execute_batch_promotion: decision for student % lacks academic_year (the completed year to archive)', v_student_id
              USING ERRCODE = '22023';
        END IF;
        IF v_decision_code = 'promoted' AND v_next_grade IS NULL THEN
            RAISE EXCEPTION 'execute_batch_promotion: promoted decision for student % lacks next_grade_code', v_student_id
              USING ERRCODE = '22023';
        END IF;

        -- Student must exist in the caller's tenant (RLS hides foreign rows
        -- → v_student_found stays false → the batch fails closed). 0107 also
        -- reads the classification in force (stamped into the history row).
        SELECT TRUE, s.filiere_code, s.specialite_code
          INTO v_student_found, v_filiere_code, v_specialite_code
          FROM public.students s
         WHERE s.id = v_student_id
           AND s.tenant_id = v_tenant
           AND s.deleted_at IS NULL;

        IF v_student_found IS NOT TRUE THEN
            RAISE EXCEPTION 'execute_batch_promotion: student % not found in tenant %', v_student_id, v_tenant
              USING ERRCODE = '42501';
        END IF;

        -- ── 1. append-only history upsert (idempotent per student+year) ──
        -- 0107: filière/spécialité stamped from the student row (NOT from
        -- the payload — the server value is authoritative; the payload
        -- carries no classification).
        INSERT INTO public.student_academic_histories (
            tenant_id, student_id, academic_year, cycle, grade_code, grade_year,
            class_id, class_name, gpa, rank, decision, narrative,
            filiere_code, specialite_code
        ) VALUES (
            v_tenant, v_student_id, v_academic_year,
            v_decision ->> 'cycle', v_decision ->> 'grade_code',
            COALESCE((v_decision ->> 'grade_year')::int, 0),
            (v_decision ->> 'class_id')::uuid,
            v_decision ->> 'class_name',
            COALESCE((v_decision ->> 'gpa')::numeric, 0),
            (v_decision ->> 'rank')::int,
            v_decision_code,
            v_decision ->> 'narrative',
            v_filiere_code,
            v_specialite_code
        )
        ON CONFLICT (student_id, academic_year) DO UPDATE SET
            cycle       = EXCLUDED.cycle,
            grade_code  = EXCLUDED.grade_code,
            grade_year  = EXCLUDED.grade_year,
            class_id    = EXCLUDED.class_id,
            class_name  = EXCLUDED.class_name,
            gpa         = EXCLUDED.gpa,
            rank        = EXCLUDED.rank,
            decision    = EXCLUDED.decision,
            narrative   = EXCLUDED.narrative,
            filiere_code = EXCLUDED.filiere_code,
            specialite_code = EXCLUDED.specialite_code,
            recorded_at = now();

        -- ── 2 + 3. student advancement (desktop semantics preserved) ──
        IF v_decision_code = 'promoted' THEN
            UPDATE public.students
               SET grade_level_code = v_next_grade,
                   class_id = NULL,
                   updated_at = now()
             WHERE id = v_student_id
               AND tenant_id = v_tenant;
            v_updated_ids := v_updated_ids || v_student_id;
        ELSIF v_decision_code = 'graduated' THEN
            UPDATE public.students
               SET enrollment_status = 'graduated',
                   class_id = NULL,
                   updated_at = now()
             WHERE id = v_student_id
               AND tenant_id = v_tenant;
            v_updated_ids := v_updated_ids || v_student_id;
        END IF;
        -- 'repeated' / 'transferred': history row only — the student row
        -- is untouched (previous desktop contract preserved). The
        -- classification is likewise preserved (the stream continues into
        -- the repeated year unless the school edits it).

        v_count := v_count + 1;
    END LOOP;

    -- ── 4. one audit entry for the batch (0014 canonical entry point) ──
    PERFORM public.write_audit_log(
        p_tenant_id   := v_tenant,
        p_action      := 'student.promote',
        p_entity_type := 'student',
        p_entity_id   := NULL,
        p_actor_id    := p_actor_profile_id,
        p_actor_name  := p_actor_name,
        p_after_json  := jsonb_build_object(
                             'count', v_count,
                             'updated_student_ids', to_jsonb(v_updated_ids)
                         ),
        p_note        := 'Promotion de classe exécutée (atomique, RPC 0059/0107)'
    );

    RETURN jsonb_build_object(
        'processed_count', v_count,
        'updated_student_ids', to_jsonb(v_updated_ids)
    );
END;
$$;

COMMENT ON FUNCTION public.execute_batch_promotion IS
  'T-041 (ACAD-100/BUSINESS-004) + T-401: atomic server-side executor for year-end batch promotion. '
  'Receives FINAL decisions (GPA/suggestion/override computed client-side by the canonical desktop engine), '
  'archives each to student_academic_histories (0107: with the student''s filière/spécialité — the '
  'classification in force during the completed year), advances promoted students, graduates 3eme_annee, '
  'writes one audit entry — all in ONE transaction. Runs under caller RLS; any invalid or foreign-tenant '
  'decision rolls back the whole batch.';

-- ----------------------------------------------------------------------------
-- Grants (fn_track_compatible follows the 0096 convention: tenant-guarded,
-- so anon callers fail closed at the tenant resolution inside).
-- ----------------------------------------------------------------------------
revoke all on function public.fn_track_compatible(text, text, text, text, text, uuid) from public;
grant execute on function public.fn_track_compatible(text, text, text, text, text, uuid) to authenticated, service_role, anon;

-- ----------------------------------------------------------------------------
-- Registration (T-091/MIG-TOKENS pattern — the apply script embeds this so
-- the DDL and the registration land in ONE atomic transaction).
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0107', '{0107_filiere_specialite_classification.sql}', 'filiere_specialite_classification')
on conflict (version) do nothing;
