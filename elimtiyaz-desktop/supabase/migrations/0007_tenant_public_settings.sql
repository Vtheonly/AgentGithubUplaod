-- ============================================================================
-- 0007_tenant_public_settings.sql
-- T-627 (the C-25 follow-up register, item 1 — docs/architecture/
-- settings-stores.md) — the tenant-level collapse of the three device-local
-- settings stores onto system_settings + the SEC-121 hardening of the
-- settings-write RPCs.
--
-- WHAT:
--   (1) The three per-tenant seed rows (idempotent ON CONFLICT DO NOTHING,
--       cross-joined over every tenant — the debt-seed pattern):
--         ai.provider_config       (category 'ai',     json,    NULL — never configured)
--         backup.scheduler_enabled (category 'backup', boolean, TRUE — the pre-collapse default-ON semantics preserved)
--         theme.custom_palettes    (category 'system', json,    NULL)
--   (2) read_public_settings() — the STABLE SECURITY DEFINER reader for the
--       whitelisted NON-SECRET trio. Audience: EVERY authenticated STAFF
--       member of the tenant (custom themes render at boot on every staff
--       machine, the backup scheduler runs per signed-in session, the
--       copilot reads model ids) — far wider than system_settings's own RLS
--       readers (super_admin/support_staff). The table's RLS stays
--       untouched: the values reach the wider audience through this gated
--       surface ONLY (the read_debt_aging_thresholds precedent, §15.75b,
--       with the audience widened to the staff set because these three
--       values are non-secret operational config every staff client
--       consumes; parents/student portal accounts are refused).
--   (3) save_public_setting(p_key, p_value) — the ONE whitelisted writer:
--       the three public keys ONLY, super_admin-gated, tenant + actor
--       resolved SERVER-SIDE (the client sends no identity columns — the
--       save_rbac_matrix pattern), shape-validated, audited through
--       write_audit_log. Fail-loud on unknown keys and wrong shapes.
--   (4) SEC-121: upsert_setting + upsert_secret_setting (0024-era,
--       consolidated 0001) gain the 0055/0155 caller-verification recipe —
--       service_role exempt; otherwise super_admin AND
--       p_tenant_id = current_tenant_id() — plus the actor fallback
--       (coalesce(p_actor_profile_id, current_user_profile_id())) and the
--       anon/public revoke. BEFORE: no gate of any kind on a SECURITY
--       DEFINER path taking a caller-supplied p_tenant_id. The pricing path
--       (the only existing client caller — a super_admin UI passing its own
--       tenant) is preserved verbatim.
--
-- GATES HONORED: no RLS weakened (no policy touched); append-only (no
-- existing migration edited); no secret ever stored (the trio is non-secret
-- by charter — the AI API keys stay device-local AES-256-GCM under the
-- per-device keychain passphrase, settings-stores.md rule 3: keys can
-- never sync).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (1) The three per-tenant seed rows (idempotent)
-- ----------------------------------------------------------------------------
insert into public.system_settings (
    tenant_id, category, key, label_fr, label_en, description_fr,
    value_type, value, is_sensitive, is_editable, is_required, sort_order
)
select
    t.id,
    v.category,
    v.key,
    v.label_fr,
    v.label_en,
    v.description_fr,
    v.value_type,
    v.value,
    false,
    true,
    false,
    v.sort_order
from public.tenants t
cross join (values
    ('ai'::text,     'ai.provider_config'::text,       'Configuration IA (provider + modèles)'::text, 'AI configuration (provider + models)'::text, 'La moitié non secrète de la configuration IA (fournisseur, modèles, paramètres) — les clés API restent chiffrées sur l''appareil.'::text, 'json'::text, null::jsonb, 15),
    ('backup'::text, 'backup.scheduler_enabled'::text,  'Sauvegarde automatique activée'::text,       'Automatic backup enabled'::text,            'Active ou désactive la sauvegarde automatique planifiée de l''établissement.'::text, 'boolean'::text, 'true'::jsonb, 51),
    ('system'::text, 'theme.custom_palettes'::text,     'Thèmes personnalisés (palettes de marque)'::text, 'Custom themes (brand palettes)'::text,    'Les palettes de couleurs personnalisées de l''établissement, visibles par tout le personnel.'::text, 'json'::text, null::jsonb, 71)
) as v(category, key, label_fr, label_en, description_fr, value_type, value, sort_order)
on conflict (tenant_id, category, key) do nothing;

-- ----------------------------------------------------------------------------
-- (2) read_public_settings — the staff-gated light reader for the trio
-- ----------------------------------------------------------------------------
create or replace function public.read_public_settings()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
    v_tenant uuid := public.current_tenant_id();
    v_profile uuid := public.current_user_profile_id();
    v_ai jsonb;
    v_scheduler jsonb;
    v_themes jsonb;
begin
    -- The audience gate: every AUTHENTICATED STAFF member of the tenant.
    -- (Portal parent/student accounts are refused — the desktop surfaces
    -- consuming this trio are staff-only.)
    if auth.uid() is null or v_profile is null then
        raise exception 'read_public_settings: authenticated staff context required'
            using errcode = '42501';
    end if;
    if v_tenant is null then
        raise exception 'read_public_settings: no active tenant for this caller'
            using errcode = '23502';
    end if;
    if not public.profile_has_staff_role(v_profile) then
        raise exception 'read_public_settings: staff surface'
            using errcode = '42501';
    end if;

    -- The whitelist is fixed IN SQL (category + key pairs); is_sensitive is
    -- asserted false so a future sensitive row with a colliding key can
    -- never leak through this surface. The coalesce(max(case…)) form is the
    -- §15.44-safe pattern (never greatest-wrapped).
    select
        coalesce(max(case when s.key = 'ai.provider_config' then s.value end), 'null'::jsonb),
        coalesce(max(case when s.key = 'backup.scheduler_enabled' then s.value end), 'null'::jsonb),
        coalesce(max(case when s.key = 'theme.custom_palettes' then s.value end), 'null'::jsonb)
    into v_ai, v_scheduler, v_themes
    from public.system_settings s
    where s.tenant_id = v_tenant
      and s.is_sensitive = false
      and (
           (s.category = 'ai' and s.key = 'ai.provider_config')
        or (s.category = 'backup' and s.key = 'backup.scheduler_enabled')
        or (s.category = 'system' and s.key = 'theme.custom_palettes')
      );

    return jsonb_build_object(
        'aiProviderConfig', v_ai,
        'backupSchedulerEnabled', v_scheduler,
        'customThemes', v_themes
    );
end;
$function$
;

comment on function read_public_settings() is 'T-627 (C-25 follow-up register): the staff-gated light reader for the three PUBLIC non-secret tenant settings (ai.provider_config, backup.scheduler_enabled, theme.custom_palettes). Audience: every authenticated staff member of the tenant — the values are operational non-secret config every staff client consumes (theme rendering, the backup scheduler, the AI model ids). The system_settings RLS stays untouched; the values reach the wider audience through this whitelisted surface only.';

-- ----------------------------------------------------------------------------
-- (3) save_public_setting — the whitelisted, server-identity-resolved writer
-- ----------------------------------------------------------------------------
create or replace function public.save_public_setting(p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_tenant uuid := public.current_tenant_id();
    v_actor uuid := public.current_user_profile_id();
    v_category text;
    v_label_fr text;
    v_value_type text;
    v_sort int;
    v_row_id uuid;
begin
    if not public.has_role('super_admin') then
        raise exception 'save_public_setting: seul un Super Administrateur peut modifier les réglages de l''établissement'
            using errcode = '42501';
    end if;
    if v_tenant is null then
        raise exception 'save_public_setting: no active tenant for this caller'
            using errcode = '23502';
    end if;

    -- The whitelist: exactly the reader's three keys. The category, label,
    -- type and sort order are DERIVED server-side (the client sends no
    -- metadata it could get wrong).
    case p_key
        when 'ai.provider_config' then
            v_category := 'ai';
            v_label_fr := 'Configuration IA (provider + modèles)';
            v_value_type := 'json';
            v_sort := 15;
        when 'backup.scheduler_enabled' then
            v_category := 'backup';
            v_label_fr := 'Sauvegarde automatique activée';
            v_value_type := 'boolean';
            v_sort := 51;
        when 'theme.custom_palettes' then
            v_category := 'system';
            v_label_fr := 'Thèmes personnalisés (palettes de marque)';
            v_value_type := 'json';
            v_sort := 71;
        else
            raise exception 'save_public_setting: unknown public setting key: %', p_key
                using errcode = '22023';
    end case;

    -- Shape validation (fail-loud). jsonb 'null' (or SQL NULL) = "not
    -- configured" for the two json keys; the scheduler flag REQUIRES a
    -- boolean (its absence is meaningless — the reader defaults ON).
    if p_key = 'backup.scheduler_enabled' and coalesce(jsonb_typeof(p_value), 'null') <> 'boolean' then
        raise exception 'save_public_setting: backup.scheduler_enabled doit être un booléen'
            using errcode = '22023';
    end if;
    if p_key = 'ai.provider_config' and coalesce(jsonb_typeof(p_value), 'null') not in ('object', 'null') then
        raise exception 'save_public_setting: ai.provider_config doit être un objet (ou null)'
            using errcode = '22023';
    end if;
    if p_key = 'theme.custom_palettes' and coalesce(jsonb_typeof(p_value), 'null') not in ('array', 'null') then
        raise exception 'save_public_setting: theme.custom_palettes doit être un tableau (ou null)'
            using errcode = '22023';
    end if;

    insert into public.system_settings (
        tenant_id, category, key, label_fr, value_type, value,
        is_sensitive, is_editable, is_required, sort_order,
        updated_by, updated_at, created_at
    ) values (
        v_tenant, v_category, p_key, v_label_fr, v_value_type, p_value,
        false, true, false, v_sort,
        v_actor, now(), now()
    )
    on conflict (tenant_id, category, key) do update
        set value = excluded.value,
            updated_by = excluded.updated_by,
            updated_at = now()
    returning id into v_row_id;

    perform public.write_audit_log(
        p_tenant_id := v_tenant,
        p_action := 'system_setting.update',
        p_entity_type := 'system_setting',
        p_entity_id := v_row_id,
        p_actor_id := v_actor,
        p_after_json := jsonb_build_object('key', p_key, 'value_type', v_value_type, 'origin', 'save_public_setting')
    );

    return jsonb_build_object('saved', true, 'key', p_key);
end;
$function$
;

comment on function save_public_setting(text,jsonb) is 'T-627 (C-25 follow-up register): the ONE whitelisted writer for the three PUBLIC tenant settings — super_admin-gated, tenant + actor resolved server-side, shape-validated, audited. The client sends only the key and the jsonb value (no identity, no metadata).';

-- ----------------------------------------------------------------------------
-- (4) SEC-121 — the caller-verification hardening of the settings-write RPCs
--     (same signatures; the bodies gain the 0055/0155 recipe)
-- ----------------------------------------------------------------------------
create or replace function public.upsert_setting(p_tenant_id uuid, p_category text, p_key text, p_label_fr text, p_value jsonb, p_value_type text DEFAULT 'string'::text, p_is_sensitive boolean DEFAULT false, p_actor_profile_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_id uuid;
    v_caller_is_service_role boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
    v_actor uuid := coalesce(p_actor_profile_id, public.current_user_profile_id());
begin
    -- SEC-121 (T-627): the 0055 caller-verification recipe. BEFORE this
    -- migration the function had NO gate — any caller reaching the gateway
    -- could write ANY tenant's settings through this SECURITY DEFINER path.
    -- The pricing path (a super_admin UI passing its own tenant) passes the
    -- gates verbatim.
    if not v_caller_is_service_role then
        if auth.uid() is null or not public.has_role('super_admin') then
            raise exception 'upsert_setting: super_admin (ou service_role) uniquement'
                using errcode = '42501';
        end if;
        if p_tenant_id is distinct from public.current_tenant_id() then
            raise exception 'upsert_setting: tenant mismatch — un appelant ne peut écrire que les réglages de son propre tenant'
                using errcode = '42501';
        end if;
    end if;

    insert into public.system_settings (
        tenant_id, category, key, label_fr, value, value_type, is_sensitive,
        updated_by, updated_at, created_at
    ) values (
        p_tenant_id, p_category, p_key, p_label_fr, p_value, p_value_type, p_is_sensitive,
        v_actor, now(), now()
    )
    on conflict (tenant_id, category, key) do update
    set value = excluded.value,
        value_type = excluded.value_type,
        is_sensitive = excluded.is_sensitive,
        updated_by = excluded.updated_by,
        updated_at = now()
    returning id into v_id;

    -- Audit log
    perform public.write_audit_log(
        p_tenant_id := p_tenant_id,
        p_action := 'system_setting.update',
        p_entity_type := 'system_setting',
        p_entity_id := v_id,
        p_actor_id := v_actor,
        p_after_json := jsonb_build_object('key', p_key, 'category', p_category, 'value_type', p_value_type)
    );

    return v_id;
end;
$function$
;

comment on function upsert_setting(uuid,text,text,text,jsonb,text,boolean,uuid) is 'Insert or update a setting. Audit-logged. For sensitive values, use upsert_secret_setting instead. SEC-121 (T-627, migration 0007): caller verification added — service_role exempt; otherwise super_admin AND the caller''s own tenant (p_tenant_id = current_tenant_id()); the actor falls back to the caller''s profile when not supplied.';

create or replace function public.upsert_secret_setting(p_tenant_id uuid, p_category text, p_key text, p_label_fr text, p_value_encrypted text, p_actor_profile_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_id uuid;
    v_caller_is_service_role boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
    v_actor uuid := coalesce(p_actor_profile_id, public.current_user_profile_id());
begin
    -- SEC-121 (T-627): the same caller-verification recipe as upsert_setting.
    if not v_caller_is_service_role then
        if auth.uid() is null or not public.has_role('super_admin') then
            raise exception 'upsert_secret_setting: super_admin (ou service_role) uniquement'
                using errcode = '42501';
        end if;
        if p_tenant_id is distinct from public.current_tenant_id() then
            raise exception 'upsert_secret_setting: tenant mismatch — un appelant ne peut écrire que les réglages de son propre tenant'
                using errcode = '42501';
        end if;
    end if;

    insert into public.system_settings (
        tenant_id, category, key, label_fr, value_encrypted, value_type,
        is_sensitive, updated_by, updated_at, created_at
    ) values (
        p_tenant_id, p_category, p_key, p_label_fr, p_value_encrypted, 'secret',
        true, v_actor, now(), now()
    )
    on conflict (tenant_id, category, key) do update
    set value_encrypted = excluded.value_encrypted,
        is_sensitive = true,
        value_type = 'secret',
        updated_by = excluded.updated_by,
        updated_at = now()
    returning id into v_id;

    -- Audit log (does NOT include the value for security)
    perform public.write_audit_log(
        p_tenant_id := p_tenant_id,
        p_action := 'system_secret.update',
        p_entity_type := 'system_setting',
        p_entity_id := v_id,
        p_actor_id := v_actor,
        p_after_json := jsonb_build_object('key', p_key, 'category', p_category, 'masked', true)
    );

    return v_id;
end;
$function$
;

comment on function upsert_secret_setting(uuid,text,text,text,text,uuid) is 'Insert or update a SECRET setting. The value_encrypted parameter is AES-256-GCM ciphertext (encrypted by the Electron app). Audit-logged (value NOT included in audit). SEC-121 (T-627, migration 0007): caller verification added — service_role exempt; otherwise super_admin AND the caller''s own tenant.';

-- ----------------------------------------------------------------------------
-- (5) The grants — explicit and narrow (the §15.104 lesson: revoking PUBLIC
--     alone leaves the anon grant; revoke BOTH, then grant the intended
--     audiences). The in-body gates remain the enforcement.
-- ----------------------------------------------------------------------------
revoke all on function public.read_public_settings() from public, anon;
grant execute on function public.read_public_settings() to authenticated;

revoke all on function public.save_public_setting(text, jsonb) from public, anon;
grant execute on function public.save_public_setting(text, jsonb) to authenticated, service_role;

revoke all on function public.upsert_setting(uuid, text, text, text, jsonb, text, boolean, uuid) from public, anon;
grant execute on function public.upsert_setting(uuid, text, text, text, jsonb, text, boolean, uuid) to authenticated, service_role;

revoke all on function public.upsert_secret_setting(uuid, text, text, text, text, uuid) from public, anon;
grant execute on function public.upsert_secret_setting(uuid, text, text, text, text, uuid) to authenticated, service_role;
