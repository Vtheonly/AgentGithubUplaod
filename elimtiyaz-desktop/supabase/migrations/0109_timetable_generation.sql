-- ============================================================================
-- 0109_timetable_generation.sql — T-404 (SCHED-100 / UNKNOWN-011)
-- ============================================================================
-- The canonical Automatic Timetable (Emploi du temps) backend contract.
--
-- Before this migration the timetable feature was a MOCK-ONLY façade
-- (SCHED-100): a desktop domain model + mock CRUD + a "Couverture EDT"
-- KPI that is permanently 0% in production because NO table, NO
-- repository and NO migration existed. UNKNOWN-011 ("build or remove?")
-- is resolved by the owner's T-404 directive: BUILD.
--
-- This migration:
--
--   §1  `rooms` — the room catalog (code, type, capacity). Rooms were
--       previously only a free-text `classes.room` column; scheduling
--       needs rooms as first-class bookable resources.
--
--   §2  `timetable_configurations` — the school-week / period structure
--       per academic year, DATA-DRIVEN (school_days text[] + periods
--       jsonb + breaks jsonb). The Algerian profile (Sunday–Thursday,
--       08:00–15:00, 6 teaching periods) is SEEDED AS DATA in §10 — the
--       solver never hardcodes it. NOTE: the legacy mock-only SchoolDay
--       type (teacher.ts) claims Mon–Fri is the "Algerian school week";
--       Algeria's school week is Sunday–Thursday (weekend Friday +
--       Saturday) — registered as SCHED-102. The canonical config is
--       data-driven, so the school can set any week.
--
--   §3  `timetable_constraints` — hard/soft constraint rows scoped to
--       school / class / teacher / room (kind + severity + params jsonb).
--       Free days, unavailable periods, max daily lessons, teacher
--       weekly-hour caps, preferred periods … all DATA, never code.
--
--   §4  `timetable_versions` — generation trials/versioning. A version is
--       one complete generated-or-manual schedule attempt for an academic
--       year: status draft → in_review → approved → published → archived
--       (rejected terminal for reviewed drafts). ONE published version
--       per (tenant, academic_year) — enforced by partial unique index.
--       Carries solver id/build (reproducibility), generation params,
--       statistics, and review/approve/publish actor stamps (audit).
--
--   §5  `timetable_entries` — the CANONICAL schedule slots. One row per
--       (version, class, day, period). Consecutive lessons (double-period
--       labs) are N rows sharing a lesson_group ordinal. Teacher/room
--       double-booking is impossible BY INDEX (partial unique on
--       (version, teacher, day, period) and (version, room, day, period))
--       — the DB-level backstop behind the domain validator (SCHED-101's
--       room-conflict gap is closed here too). Published/archived
--       versions are IMMUTABLE (trigger guard §5b): adjustments happen on
--       a duplicated draft, then re-approved and re-published.
--
--   §6  `class_subjects` extension — `consecutive_periods` (double-period
--       lessons) and `required_room_type` (lab/subject room requirements),
--       the two curriculum fields the generator needs beyond the existing
--       weekly_hours (0029) / teacher_id (0004) / coefficient.
--
--   §7  `fn_timetable_publish` — the atomic publish RPC: approved →
--       published, archiving the previously published version for the
--       same academic year, with caller + role verification and one
--       audit entry (the 0055/0096 hardening pattern).
--
--   §8  RLS — the 0019/0094 pattern: staff (super_admin, support_staff)
--       write; staff + teachers read configs/constraints/versions/rooms;
--       ALL authenticated (incl. parent accounts — the future website
--       consumer) read entries ONLY of published versions.
--
--   §9  Function grants (revoke from public; grant to authenticated,
--       service_role, anon — the tenant guard fails closed for anon).
--
--   §10 Algerian default configuration seeded as DATA for every existing
--       (tenant, academic_year) pair.
--
-- DESIGN NOTES / DELIBERATE DECISIONS (ADR-020):
--   * period_index refers to the TEACHING-period array of the
--     configuration (breaks are not slots) — the solver iterates
--     day × teaching-period.
--   * start_minutes/end_minutes are denormalized from the period
--     definition for direct display/time math without a join.
--   * `timetable_constraints.kind` carries a DB CHECK of the canonical
--     v1 kind list — the list IS the constraint contract (ADR-020);
--     extending it is a new migration + domain change.
--   * No FK from timetable_entries.teacher_id to a teachers table —
--     there is NO teachers table (SCHED-100 audit); the canonical
--     teacher identity is personnel(id) (class_subjects.teacher_id
--     pattern, 0004).
--   * COMMENT ON statements are intentionally omitted from the live-apply
--     path expectations: the Management API silently drops them (AGENTS.md
--     §11.1 quirk #1); they exist only in this file for fresh CLI
--     deployments.
--
-- SAFETY / GUARDS:
--   * Everything is ADDITIVE — no existing table/column is altered except
--     the two nullable-with-default columns on class_subjects (§6), which
--     is backward-compatible by construction (old clients ignore them).
--   * RLS enabled on every new table BEFORE any policy; policies created
--     with DROP IF EXISTS first (idempotent re-apply safe).
--   * The publish RPC is SECURITY DEFINER with SET search_path = public
--     and verifies current_user_profile_id() + role BEFORE any write.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1. rooms — the bookable room catalog
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rooms (
    id           uuid        PRIMARY KEY DEFAULT public.gen_uuid(),
    tenant_id    uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    code         text        NOT NULL,                          -- 'SAL-01', 'LAB-INFO-1', …
    name         text        NOT NULL,                          -- 'Salle 01 — Bâtiment A'
    room_type    text        NOT NULL DEFAULT 'classroom'
                 CHECK (room_type IN ('classroom','science_lab','computer_lab',
                                      'language_lab','sports','library','workshop','other')),
    capacity     integer     CHECK (capacity IS NULL OR capacity > 0),
    building     text,
    floor_label  text,
    is_active    boolean     NOT NULL DEFAULT true,
    notes        text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS rooms_tenant_type_idx ON public.rooms (tenant_id, room_type, is_active);

-- ----------------------------------------------------------------------------
-- §2. timetable_configurations — school week / periods as DATA
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.timetable_configurations (
    id                      uuid        PRIMARY KEY DEFAULT public.gen_uuid(),
    tenant_id               uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    academic_year_id        uuid        NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
    label                   text        NOT NULL,
    -- The school week. Data-driven: {'sunday'..'thursday'} for the Algerian
    -- profile; any subset of the 7 day names is valid.
    school_days             text[]      NOT NULL
                            CHECK (cardinality(school_days) BETWEEN 1 AND 7
                                   AND school_days <@ ARRAY['monday','tuesday','wednesday',
                                                            'thursday','friday','saturday','sunday']),
    -- Teaching periods (breaks are NOT slots): [{"index":1,"label":"S1",
    -- "startMinutes":480,"endMinutes":540}, …]
    periods                 jsonb       NOT NULL
                            CHECK (jsonb_typeof(periods) = 'array'),
    -- Labeled breaks for display: [{"afterPeriodIndex":2,"label":"Pause",
    -- "startMinutes":600,"endMinutes":615}, …]
    breaks                  jsonb       NOT NULL DEFAULT '[]'::jsonb
                            CHECK (jsonb_typeof(breaks) = 'array'),
    default_lesson_minutes  integer     NOT NULL DEFAULT 60 CHECK (default_lesson_minutes BETWEEN 30 AND 120),
    max_periods_per_day     integer     NOT NULL DEFAULT 8  CHECK (max_periods_per_day BETWEEN 1 AND 12),
    is_active               boolean     NOT NULL DEFAULT true,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, academic_year_id)
);

-- ----------------------------------------------------------------------------
-- §3. timetable_constraints — hard/soft constraints as DATA
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.timetable_constraints (
    id                uuid        PRIMARY KEY DEFAULT public.gen_uuid(),
    tenant_id         uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    academic_year_id  uuid        NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
    -- What the constraint applies to. entity_id is null for scope='school'.
    scope             text        NOT NULL CHECK (scope IN ('school','class','teacher','room')),
    entity_id         uuid,       -- classes.id / personnel.id / rooms.id (validated domain-side per scope)
    -- The canonical v1 constraint kinds (ADR-020 contract):
    --   free_day            {day}                       class/teacher/room/school
    --   unavailable_period  {day, periodIndex}          teacher/class/room
    --   max_daily_lessons   {max}                       class/teacher
    --   max_weekly_hours    {max}                       teacher
    --   max_consecutive     {max}                       class/teacher
    --   preferred_period    {periodIndex, weight}       class/subject pair encoded in params
    --   avoid_first_period  {}                           class
    --   avoid_last_period   {}                           class
    --   prefer_morning      {weight}                     class
    --   prefer_afternoon    {weight}                     class
    --   minimize_gaps       {weight}                     teacher/class
    kind              text        NOT NULL CHECK (kind IN (
                        'free_day','unavailable_period','max_daily_lessons',
                        'max_weekly_hours','max_consecutive','preferred_period',
                        'avoid_first_period','avoid_last_period',
                        'prefer_morning','prefer_afternoon','minimize_gaps')),
    severity          text        NOT NULL DEFAULT 'hard' CHECK (severity IN ('hard','soft')),
    params            jsonb       NOT NULL DEFAULT '{}'::jsonb
                      CHECK (jsonb_typeof(params) = 'object'),
    is_active         boolean     NOT NULL DEFAULT true,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS timetable_constraints_scope_idx
    ON public.timetable_constraints (tenant_id, academic_year_id, scope, entity_id)
    WHERE is_active;
CREATE INDEX IF NOT EXISTS timetable_constraints_year_idx
    ON public.timetable_constraints (academic_year_id) WHERE is_active;

-- ----------------------------------------------------------------------------
-- §4. timetable_versions — generation trials, review and publication
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.timetable_versions (
    id                    uuid        PRIMARY KEY DEFAULT public.gen_uuid(),
    tenant_id             uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    academic_year_id      uuid        NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
    version_number        integer     NOT NULL CHECK (version_number >= 1),
    status                text        NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','in_review','approved','rejected',
                                            'published','archived')),
    label                 text,
    -- Solver identification for reproducibility (T-404 packaging gate 8).
    solver_id             text        NOT NULL DEFAULT 'ts-greedy-v1',
    solver_build          text,
    generation_params     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    -- Placement/violation summary + the unplaced-requirements explanation
    -- list (the "conflict explanations" contract — never silently drop).
    statistics            jsonb       NOT NULL DEFAULT '{}'::jsonb,
    hard_violation_count  integer     NOT NULL DEFAULT 0 CHECK (hard_violation_count >= 0),
    soft_violation_count  integer     NOT NULL DEFAULT 0 CHECK (soft_violation_count >= 0),
    unplaced_count        integer     NOT NULL DEFAULT 0 CHECK (unplaced_count >= 0),
    created_by            uuid,
    created_by_name       text,
    reviewed_by           uuid,
    reviewed_at           timestamptz,
    review_note           text,
    approved_by           uuid,
    approved_at           timestamptz,
    published_by          uuid,
    published_at          timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, academic_year_id, version_number)
);

CREATE INDEX IF NOT EXISTS timetable_versions_year_status_idx
    ON public.timetable_versions (tenant_id, academic_year_id, status);

-- THE publication invariant: at most ONE published version per year.
CREATE UNIQUE INDEX IF NOT EXISTS timetable_versions_one_published
    ON public.timetable_versions (tenant_id, academic_year_id)
    WHERE status = 'published';

-- ----------------------------------------------------------------------------
-- §5. timetable_entries — the canonical schedule slots
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.timetable_entries (
    id                uuid        PRIMARY KEY DEFAULT public.gen_uuid(),
    tenant_id         uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    academic_year_id  uuid        NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
    version_id        uuid        NOT NULL REFERENCES public.timetable_versions(id) ON DELETE CASCADE,
    class_id          uuid        NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
    subject_id        uuid        NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
    -- Canonical teacher identity = personnel (SCHED-100: no teachers table).
    teacher_id        uuid        REFERENCES public.personnel(id) ON DELETE SET NULL,
    room_id           uuid        REFERENCES public.rooms(id) ON DELETE SET NULL,
    day               text        NOT NULL CHECK (day IN ('monday','tuesday','wednesday',
                                                          'thursday','friday','saturday','sunday')),
    period_index      integer     NOT NULL CHECK (period_index >= 1),
    -- Denormalized from the configuration's period definition (display +
    -- time math without a join; enforced consistent by the domain writer).
    start_minutes     integer     NOT NULL CHECK (start_minutes >= 0 AND start_minutes < 1440),
    end_minutes       integer     NOT NULL CHECK (end_minutes > 0 AND end_minutes <= 1440),
    -- Ordinal linking the N rows of a consecutive (double-period) lesson.
    lesson_group      integer     NOT NULL DEFAULT 1,
    -- Manual pins survive regeneration (the generator keeps locked slots).
    is_locked         boolean     NOT NULL DEFAULT false,
    source            text        NOT NULL DEFAULT 'generated'
                      CHECK (source IN ('generated','manual')),
    notes             text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    -- One slot per class per day per period within a version.
    UNIQUE (tenant_id, version_id, class_id, day, period_index)
);

CREATE INDEX IF NOT EXISTS timetable_entries_version_idx
    ON public.timetable_entries (version_id);
CREATE INDEX IF NOT EXISTS timetable_entries_class_idx
    ON public.timetable_entries (tenant_id, academic_year_id, class_id)
    WHERE teacher_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS timetable_entries_teacher_idx
    ON public.timetable_entries (version_id, teacher_id, day, period_index)
    WHERE teacher_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS timetable_entries_room_idx
    ON public.timetable_entries (version_id, room_id, day, period_index)
    WHERE room_id IS NOT NULL;

-- §5b. Double-booking is IMPOSSIBLE at the storage layer: a teacher cannot
-- hold two slots, a room cannot host two lessons, in the same version on
-- the same day+period. (SCHED-101 closed at the DB level as well.)
CREATE UNIQUE INDEX IF NOT EXISTS timetable_entries_teacher_slot_uidx
    ON public.timetable_entries (version_id, teacher_id, day, period_index)
    WHERE teacher_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS timetable_entries_room_slot_uidx
    ON public.timetable_entries (version_id, room_id, day, period_index)
    WHERE room_id IS NOT NULL;

-- §5c. Published/archived versions are immutable — adjustments happen on a
-- duplicated draft which is then re-approved and re-published.
CREATE OR REPLACE FUNCTION public.timetable_entries_guard_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
declare
    v_status text;
begin
    if TG_OP = 'DELETE' then
        select status into v_status from public.timetable_versions where id = old.version_id;
        if v_status in ('published','archived') then
            raise exception 'timetable_entries is immutable for published/archived version % (T-404). Duplicate the version to a draft to make changes.', old.version_id
                using errcode = 'P0001';
        end if;
        return old;
    end if;

    select status into v_status from public.timetable_versions where id = new.version_id;
    if v_status in ('published','archived') then
        raise exception 'timetable_entries is immutable for published/archived version % (T-404). Duplicate the version to a draft to make changes.', new.version_id
            using errcode = 'P0001';
    end if;
    return new;
end;
$function$;

DROP TRIGGER IF EXISTS timetable_entries_immutable ON public.timetable_entries;
CREATE TRIGGER timetable_entries_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON public.timetable_entries
    FOR EACH ROW EXECUTE FUNCTION public.timetable_entries_guard_immutable();

-- ----------------------------------------------------------------------------
-- §6. class_subjects — the two curriculum fields the generator needs
-- ----------------------------------------------------------------------------
ALTER TABLE public.class_subjects
    ADD COLUMN IF NOT EXISTS consecutive_periods integer NOT NULL DEFAULT 1
        CHECK (consecutive_periods BETWEEN 1 AND 4),
    ADD COLUMN IF NOT EXISTS required_room_type text;

-- ----------------------------------------------------------------------------
-- §7. fn_timetable_publish — atomic approved → published
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_timetable_publish(
    p_version_id        uuid,
    p_actor_profile_id  uuid DEFAULT NULL,
    p_actor_name        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
declare
    v_tenant       uuid;
    v_version      public.timetable_versions%ROWTYPE;
    v_archived_id  uuid;
begin
    -- Caller verification (the 0055/0096 hardening pattern): fail closed.
    v_tenant := public.current_tenant_id();
    if v_tenant is null then
        return jsonb_build_object('ok', false, 'reason', 'no_tenant',
                                  'message', 'Aucun tenant résolu pour l''appelant.');
    end if;
    if not public.has_any_role(ARRAY['super_admin','support_staff']) then
        return jsonb_build_object('ok', false, 'reason', 'forbidden',
                                  'message', 'Seuls les administrateurs peuvent publier un emploi du temps.');
    end if;

    select * into v_version
    from public.timetable_versions
    where id = p_version_id and tenant_id = v_tenant
    for update;
    if not found then
        return jsonb_build_object('ok', false, 'reason', 'not_found',
                                  'message', 'Version d''emploi du temps introuvable.');
    end if;
    if v_version.status <> 'approved' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_status',
                                  'message', 'Seule une version approuvée peut être publiée (statut actuel : '
                                             || v_version.status || ').');
    end if;

    -- Archive the currently published version (atomic swap; the partial
    -- unique index timetable_versions_one_published is the backstop).
    update public.timetable_versions
    set status = 'archived', updated_at = now()
    where tenant_id = v_tenant
      and academic_year_id = v_version.academic_year_id
      and status = 'published'
    returning id into v_archived_id;

    update public.timetable_versions
    set status = 'published',
        published_by = p_actor_profile_id,
        published_at = now(),
        updated_at = now()
    where id = p_version_id;

    perform public.write_audit_log(
        p_tenant_id   := v_tenant,
        p_action      := 'timetable.version_publish',
        p_entity_type := 'timetable_version',
        p_entity_id   := p_version_id,
        p_actor_id    := p_actor_profile_id,
        p_actor_name  := p_actor_name,
        p_after_json  := jsonb_build_object(
                             'versionNumber', v_version.version_number,
                             'archivedVersionId', v_archived_id
                         ),
        p_note        := format('Emploi du temps version %s publié pour l''année %s.',
                                v_version.version_number, v_version.academic_year_id)
    );

    return jsonb_build_object(
        'ok', true,
        'publishedVersionId', p_version_id,
        'archivedVersionId', v_archived_id
    );
end;
$function$;

-- ----------------------------------------------------------------------------
-- §8. RLS — the 0019/0094 pattern
-- ----------------------------------------------------------------------------
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timetable_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timetable_constraints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timetable_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timetable_entries ENABLE ROW LEVEL SECURITY;

-- rooms: staff + teachers read; direction writes.
DROP POLICY IF EXISTS rooms_select ON public.rooms;
CREATE POLICY rooms_select ON public.rooms
    FOR SELECT TO AUTHENTICATED
    USING (tenant_id = public.current_tenant_id()
           AND public.has_any_role(ARRAY['super_admin','support_staff','teacher']));

DROP POLICY IF EXISTS rooms_staff_write ON public.rooms;
CREATE POLICY rooms_staff_write ON public.rooms
    FOR ALL TO AUTHENTICATED
    USING (tenant_id = public.current_tenant_id()
           AND public.has_any_role(ARRAY['super_admin','support_staff']))
    WITH CHECK (tenant_id = public.current_tenant_id()
                AND public.has_any_role(ARRAY['super_admin','support_staff']));

-- timetable_configurations
DROP POLICY IF EXISTS timetable_configurations_select ON public.timetable_configurations;
CREATE POLICY timetable_configurations_select ON public.timetable_configurations
    FOR SELECT TO AUTHENTICATED
    USING (tenant_id = public.current_tenant_id()
           AND public.has_any_role(ARRAY['super_admin','support_staff','teacher']));

DROP POLICY IF EXISTS timetable_configurations_staff_write ON public.timetable_configurations;
CREATE POLICY timetable_configurations_staff_write ON public.timetable_configurations
    FOR ALL TO AUTHENTICATED
    USING (tenant_id = public.current_tenant_id()
           AND public.has_any_role(ARRAY['super_admin','support_staff']))
    WITH CHECK (tenant_id = public.current_tenant_id()
                AND public.has_any_role(ARRAY['super_admin','support_staff']));

-- timetable_constraints
DROP POLICY IF EXISTS timetable_constraints_select ON public.timetable_constraints;
CREATE POLICY timetable_constraints_select ON public.timetable_constraints
    FOR SELECT TO AUTHENTICATED
    USING (tenant_id = public.current_tenant_id()
           AND public.has_any_role(ARRAY['super_admin','support_staff','teacher']));

DROP POLICY IF EXISTS timetable_constraints_staff_write ON public.timetable_constraints;
CREATE POLICY timetable_constraints_staff_write ON public.timetable_constraints
    FOR ALL TO AUTHENTICATED
    USING (tenant_id = public.current_tenant_id()
           AND public.has_any_role(ARRAY['super_admin','support_staff']))
    WITH CHECK (tenant_id = public.current_tenant_id()
                AND public.has_any_role(ARRAY['super_admin','support_staff']));

-- timetable_versions
DROP POLICY IF EXISTS timetable_versions_select ON public.timetable_versions;
CREATE POLICY timetable_versions_select ON public.timetable_versions
    FOR SELECT TO AUTHENTICATED
    USING (tenant_id = public.current_tenant_id()
           AND public.has_any_role(ARRAY['super_admin','support_staff','teacher']));

DROP POLICY IF EXISTS timetable_versions_staff_write ON public.timetable_versions;
CREATE POLICY timetable_versions_staff_write ON public.timetable_versions
    FOR ALL TO AUTHENTICATED
    USING (tenant_id = public.current_tenant_id()
           AND public.has_any_role(ARRAY['super_admin','support_staff']))
    WITH CHECK (tenant_id = public.current_tenant_id()
                AND public.has_any_role(ARRAY['super_admin','support_staff']));

-- timetable_entries: staff + teachers see everything (drafts included);
-- every other authenticated account (parents — the future website
-- consumer) sees ONLY the published version's entries.
DROP POLICY IF EXISTS timetable_entries_select ON public.timetable_entries;
CREATE POLICY timetable_entries_select ON public.timetable_entries
    FOR SELECT TO AUTHENTICATED
    USING (
        tenant_id = public.current_tenant_id()
        AND (
            public.has_any_role(ARRAY['super_admin','support_staff','teacher'])
            OR EXISTS (
                SELECT 1 FROM public.timetable_versions v
                WHERE v.id = timetable_entries.version_id
                  AND v.tenant_id = timetable_entries.tenant_id
                  AND v.status = 'published'
            )
        )
    );

DROP POLICY IF EXISTS timetable_entries_staff_write ON public.timetable_entries;
CREATE POLICY timetable_entries_staff_write ON public.timetable_entries
    FOR ALL TO AUTHENTICATED
    USING (tenant_id = public.current_tenant_id()
           AND public.has_any_role(ARRAY['super_admin','support_staff']))
    WITH CHECK (tenant_id = public.current_tenant_id()
                AND public.has_any_role(ARRAY['super_admin','support_staff']));

-- ----------------------------------------------------------------------------
-- §9. Function grants (the 0096 pattern: explicit EXECUTE for the three API
-- roles; the tenant guard fails closed for anon callers).
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.fn_timetable_publish(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_timetable_publish(uuid, uuid, text)
    TO authenticated, service_role, anon;

REVOKE ALL ON FUNCTION public.timetable_entries_guard_immutable() FROM public;

-- ----------------------------------------------------------------------------
-- §10. The Algerian school profile, seeded as DATA (never code):
--      week Sunday→Thursday, 08:00 start, 4 morning periods, lunch,
--      2 afternoon periods, 15-min mid-morning break. Fully editable.
-- ----------------------------------------------------------------------------
INSERT INTO public.timetable_configurations (
    tenant_id, academic_year_id, label, school_days, periods, breaks,
    default_lesson_minutes, max_periods_per_day, is_active
)
SELECT
    t.id,
    ay.id,
    'Profil algérien standard',
    ARRAY['sunday','monday','tuesday','wednesday','thursday'],
    '[
        {"index": 1, "label": "S1", "startMinutes": 480, "endMinutes": 540},
        {"index": 2, "label": "S2", "startMinutes": 540, "endMinutes": 600},
        {"index": 3, "label": "S3", "startMinutes": 615, "endMinutes": 675},
        {"index": 4, "label": "S4", "startMinutes": 675, "endMinutes": 735},
        {"index": 5, "label": "S5", "startMinutes": 780, "endMinutes": 840},
        {"index": 6, "label": "S6", "startMinutes": 840, "endMinutes": 900}
    ]'::jsonb,
    '[
        {"afterPeriodIndex": 2, "label": "Pause", "startMinutes": 600, "endMinutes": 615},
        {"afterPeriodIndex": 4, "label": "Déjeuner", "startMinutes": 735, "endMinutes": 780}
    ]'::jsonb,
    60,
    6,
    true
FROM public.tenants t
CROSS JOIN public.academic_years ay
WHERE ay.tenant_id = t.id
ON CONFLICT (tenant_id, academic_year_id) DO NOTHING;
