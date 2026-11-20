-- ============================================================================
-- 0024_system_settings.sql
-- ============================================================================
-- Database-backed system configuration. Stores tenant-level settings that
-- admins can edit from the desktop app's Configuration tab.
--
-- Design:
--   - Each setting is a key/value pair with a typed `value` column (jsonb)
--     so we can store strings, numbers, booleans, arrays, and objects.
--   - The `category` column groups settings in the UI (connection, ai, email,
--     push, storage, backup, system).
--   - The `is_sensitive` flag marks settings whose value should be masked in
--     the UI (API keys, passphrases). The actual value is stored as AES-256-GCM
--     ciphertext in the `value_encrypted` column; non-sensitive settings use
--     `value` (plaintext jsonb).
--   - The `is_editable` flag prevents users from deleting critical settings
--     (they can still update the value).
--   - The `updated_by` column tracks which admin last changed each setting
--     (audit trail).
--
-- SECURITY:
--   - Sensitive values are encrypted with AES-256-GCM before storage.
--   - The encryption key is the tenant's backup passphrase (same one used
--     for backup archives) — this way the user only needs to remember one
--     passphrase, and the same key derivation (PBKDF2 100k) is reused.
--   - When reading sensitive values via the API, the value is returned as
--     "********" (masked) unless the caller explicitly requests the plaintext
--     via a `reveal=true` parameter (SuperAdmin only, audit-logged).
-- ============================================================================

create table public.system_settings (
    id                  uuid        primary key default public.gen_uuid(),
    tenant_id           uuid        not null references public.tenants(id) on delete cascade,
    category            text        not null check (category in (
                            'connection', 'ai', 'email', 'push',
                            'storage', 'backup', 'system', 'feature_flags'
                        )),
    key                 text        not null,                          -- 'supabase.url', 'groq.api_key', etc.
    label_fr            text        not null,                          -- 'URL Supabase'
    label_ar            text,
    label_en            text,
    description_fr      text,
    value_type          text        not null check (value_type in (
                            'string', 'number', 'boolean', 'json', 'secret'
                        )),
    value               jsonb,                                          -- plaintext value (null for secrets)
    value_encrypted     text,                                           -- AES-256-GCM ciphertext (secrets only)
    is_sensitive        boolean     not null default false,
    is_editable         boolean     not null default true,
    is_required         boolean     not null default false,
    sort_order          integer     not null default 100,
    validation_pattern  text,                                           -- regex pattern for string validation
    validation_min      numeric,
    validation_max      numeric,
    options             jsonb,                                          -- for enum-like settings: [{value, label_fr}]
    updated_by          uuid,                                           -- user_profiles.id
    updated_at          timestamptz not null default now(),
    created_at          timestamptz not null default now(),
    unique (tenant_id, category, key)
);

create index system_settings_tenant_category_idx on public.system_settings (tenant_id, category, sort_order);
create index system_settings_tenant_key_idx on public.system_settings (tenant_id, key);

comment on table public.system_settings is
  'Database-backed system configuration. Admins edit these from the desktop Configuration tab. Sensitive values are AES-256-GCM encrypted.';

comment on column public.system_settings.category is 'UI grouping: connection, ai, email, push, storage, backup, system, feature_flags.';
comment on column public.system_settings.key is 'Stable dotted key, e.g. supabase.url, groq.api_key, resend.api_key.';
comment on column public.system_settings.value_type is 'string | number | boolean | json | secret. secret values use value_encrypted instead of value.';
comment on column public.system_settings.value is 'Plaintext value as jsonb. NULL for secrets (use value_encrypted instead).';
comment on column public.system_settings.value_encrypted is 'AES-256-GCM ciphertext (base64). Only set when value_type=secret.';
comment on column public.system_settings.is_sensitive is 'true for API keys/passphrases. UI masks the value. Reads return "********" unless reveal=true.';
comment on column public.system_settings.is_editable is 'false prevents deletion (admins can still update the value).';
comment on column public.system_settings.is_required is 'true marks the setting as required — UI shows a warning if empty.';
comment on column public.system_settings.validation_pattern is 'Regex pattern for string validation (e.g. ^https:// for URLs).';
comment on column public.system_settings.options is 'JSON array of {value, label_fr} for enum-like settings.';

-- ----------------------------------------------------------------------------
-- Trigger: updated_at
-- ----------------------------------------------------------------------------
create trigger system_settings_touch_updated_at before update on public.system_settings
    for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- RLS policies
-- ----------------------------------------------------------------------------
alter table public.system_settings enable row level security;

-- SuperAdmin + SupportStaff can read all settings (sensitive values masked by API)
create policy system_settings_select_admin on public.system_settings
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'support_staff'])
    );

-- Only SuperAdmin can update/insert/delete settings
create policy system_settings_admin_write on public.system_settings
    for all to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.has_role('super_admin')
    )
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_role('super_admin')
    );

-- ----------------------------------------------------------------------------
-- Helper functions
-- ----------------------------------------------------------------------------

-- Read a setting value by key (returns jsonb or NULL)
create or replace function public.get_setting(p_tenant_id uuid, p_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select value from public.system_settings
     where tenant_id = p_tenant_id and key = p_key
     limit 1;
$$;

-- Read a setting value as text (convenience)
create or replace function public.get_setting_text(p_tenant_id uuid, p_key text)
returns text
language sql
stable
security definer
set search_path = public
as $$
    select case
        when value is null then null
        when jsonb_typeof(value) = 'string' then value::text
        else value::text
    end
    from public.system_settings
     where tenant_id = p_tenant_id and key = p_key
     limit 1;
$$;

-- Read a boolean setting
create or replace function public.get_setting_bool(p_tenant_id uuid, p_key text, p_default boolean default false)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(
        (select (value::text)::boolean from public.system_settings
          where tenant_id = p_tenant_id and key = p_key limit 1),
        p_default
    );
$$;

-- Upsert a setting (admin operation)
create or replace function public.upsert_setting(
    p_tenant_id uuid,
    p_category text,
    p_key text,
    p_label_fr text,
    p_value jsonb,
    p_value_type text default 'string',
    p_is_sensitive boolean default false,
    p_actor_profile_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
begin
    insert into public.system_settings (
        tenant_id, category, key, label_fr, value, value_type, is_sensitive,
        updated_by, updated_at, created_at
    ) values (
        p_tenant_id, p_category, p_key, p_label_fr, p_value, p_value_type, p_is_sensitive,
        p_actor_profile_id, now(), now()
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
        p_actor_id := p_actor_profile_id,
        p_after_json := jsonb_build_object('key', p_key, 'category', p_category, 'value_type', p_value_type)
    );

    return v_id;
end;
$$;

comment on function public.get_setting is 'Read a setting value by key. Returns jsonb or NULL.';
comment on function public.get_setting_text is 'Read a setting value as text. Convenience wrapper.';
comment on function public.get_setting_bool is 'Read a boolean setting with default fallback.';
comment on function public.upsert_setting is 'Insert or update a setting. Audit-logged. For sensitive values, use upsert_secret_setting instead.';

-- Upsert a SECRET setting (encrypts the value before storage)
-- NOTE: The actual AES-256-GCM encryption happens in the Electron app (renderer),
-- not in the database. The Edge Function `update-server-secret` receives the
-- ciphertext and calls this function with value_encrypted set.
create or replace function public.upsert_secret_setting(
    p_tenant_id uuid,
    p_category text,
    p_key text,
    p_label_fr text,
    p_value_encrypted text,
    p_actor_profile_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
begin
    insert into public.system_settings (
        tenant_id, category, key, label_fr, value_encrypted, value_type,
        is_sensitive, updated_by, updated_at, created_at
    ) values (
        p_tenant_id, p_category, p_key, p_label_fr, p_value_encrypted, 'secret',
        true, p_actor_profile_id, now(), now()
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
        p_actor_id := p_actor_profile_id,
        p_after_json := jsonb_build_object('key', p_key, 'category', p_category, 'masked', true)
    );

    return v_id;
end;
$$;

comment on function public.upsert_secret_setting is
  'Insert or update a SECRET setting. The value_encrypted parameter is AES-256-GCM ciphertext (encrypted by the Electron app). Audit-logged (value NOT included in audit).';

-- ----------------------------------------------------------------------------
-- Seed: default system settings for the default tenant
-- ----------------------------------------------------------------------------
insert into public.system_settings (tenant_id, category, key, label_fr, label_en, description_fr, value_type, value, is_sensitive, is_required, sort_order, validation_pattern)
values
    -- Connection (these are also stored locally in Electron userData; this row is the "last known" value)
    ('00000000-0000-0000-0000-000000000001', 'connection', 'supabase.url', 'URL Supabase', 'Supabase URL', 'URL de votre projet Supabase (https://xxxx.supabase.co)', 'string', null, false, true, 1, '^https://'),
    ('00000000-0000-0000-0000-000000000001', 'connection', 'supabase.anon_key', 'Clé anonyme Supabase', 'Supabase anon key', 'Clé anonyme (safe to publish, gated by RLS)', 'secret', null, true, true, 2, null),
    ('00000000-0000-0000-0000-000000000001', 'connection', 'supabase.use_supabase', 'Utiliser Supabase (vs mock)', 'Use Supabase backend', 'Active le backend Supabase au lieu du mock', 'boolean', 'false'::jsonb, false, true, 3, null),

    -- AI providers (secrets — encrypted)
    ('00000000-0000-0000-0000-000000000001', 'ai', 'groq.api_key', 'Clé API Groq', 'Groq API key', 'Clé API pour Groq (https://console.groq.com/keys)', 'secret', null, true, false, 10, null),
    ('00000000-0000-0000-0000-000000000001', 'ai', 'groq.default_model', 'Modèle Groq par défaut', 'Default Groq model', 'Modèle Groq par défaut', 'string', '"llama-3.3-70b-versatile"'::jsonb, false, false, 11, null),
    ('00000000-0000-0000-0000-000000000001', 'ai', 'openrouter.api_key', 'Clé API OpenRouter', 'OpenRouter API key', 'Clé API OpenRouter (fallback)', 'secret', null, true, false, 12, null),
    ('00000000-0000-0000-0000-000000000001', 'ai', 'openrouter.default_model', 'Modèle OpenRouter par défaut', 'Default OpenRouter model', 'Modèle OpenRouter par défaut', 'string', '"meta-llama/llama-3.3-70b-instruct:free"'::jsonb, false, false, 13, null),
    ('00000000-0000-0000-0000-000000000001', 'ai', 'ai.rate_limit_per_minute', 'Limite de taux IA (req/min)', 'AI rate limit (req/min)', 'Nombre maximum de requêtes IA par minute par tenant', 'number', '60'::jsonb, false, false, 14, null),

    -- Email (Resend)
    ('00000000-0000-0000-0000-000000000001', 'email', 'resend.api_key', 'Clé API Resend', 'Resend API key', 'Clé API Resend pour envoi d''emails (https://resend.com/api-keys)', 'secret', null, true, false, 20, null),
    ('00000000-0000-0000-0000-000000000001', 'email', 'email.from_address', 'Adresse expéditeur', 'From address', 'Adresse email d''expédition (doit être vérifiée dans Resend)', 'string', '"noreply@elimtiyaz.dz"'::jsonb, false, false, 21, '^[^@]+@[^@]+\.[^@]+$'),
    ('00000000-0000-0000-0000-000000000001', 'email', 'email.from_name', 'Nom expéditeur', 'From name', 'Nom affiché comme expéditeur', 'string', '"El-Imtiyaz Platform"'::jsonb, false, false, 22, null),

    -- Push notifications (FCM)
    ('00000000-0000-0000-0000-000000000001', 'push', 'fcm.server_key', 'Clé serveur FCM', 'FCM server key', 'Clé serveur Firebase Cloud Messaging', 'secret', null, true, false, 30, null),
    ('00000000-0000-0000-0000-000000000001', 'push', 'fcm.sender_id', 'ID expéditeur FCM', 'FCM sender ID', 'ID expéditeur Firebase', 'string', null, false, false, 31, null),

    -- Storage (bucket names — these are fixed once created, but shown for reference)
    ('00000000-0000-0000-0000-000000000001', 'storage', 'storage.bucket.payment_proofs', 'Bucket: preuves de paiement', 'Bucket: payment proofs', 'Nom du bucket de stockage des preuves de paiement', 'string', '"payment-proofs"'::jsonb, false, true, 40, null),
    ('00000000-0000-0000-0000-000000000001', 'storage', 'storage.bucket.expense_receipts', 'Bucket: reçus de dépenses', 'Bucket: expense receipts', 'Nom du bucket des reçus de dépenses', 'string', '"expense-receipts"'::jsonb, false, true, 41, null),
    ('00000000-0000-0000-0000-000000000001', 'storage', 'storage.bucket.receipts', 'Bucket: reçus PDF', 'Bucket: PDF receipts', 'Nom du bucket des reçus PDF générés', 'string', '"receipts"'::jsonb, false, true, 42, null),
    ('00000000-0000-0000-0000-000000000001', 'storage', 'storage.bucket.student_documents', 'Bucket: documents élèves', 'Bucket: student documents', 'Nom du bucket des documents élèves', 'string', '"student-documents"'::jsonb, false, true, 43, null),
    ('00000000-0000-0000-0000-000000000001', 'storage', 'storage.bucket.homework_attachments', 'Bucket: pièces jointes devoirs', 'Bucket: homework attachments', 'Nom du bucket des pièces jointes de devoirs', 'string', '"homework-attachments"'::jsonb, false, true, 44, null),
    ('00000000-0000-0000-0000-000000000001', 'storage', 'storage.bucket.task_attachments', 'Bucket: pièces jointes tâches', 'Bucket: task attachments', 'Nom du bucket des pièces jointes de tâches', 'string', '"task-attachments"'::jsonb, false, true, 45, null),
    ('00000000-0000-0000-0000-000000000001', 'storage', 'storage.bucket.chat_attachments', 'Bucket: pièces jointes chat', 'Bucket: chat attachments', 'Nom du bucket des pièces jointes de chat', 'string', '"chat-attachments"'::jsonb, false, true, 46, null),
    ('00000000-0000-0000-0000-000000000001', 'storage', 'storage.bucket.tenant_assets', 'Bucket: assets tenant', 'Bucket: tenant assets', 'Nom du bucket des assets tenant (logos, etc.)', 'string', '"tenant-assets"'::jsonb, false, true, 47, null),
    ('00000000-0000-0000-0000-000000000001', 'storage', 'storage.bucket.ai_reports', 'Bucket: rapports IA', 'Bucket: AI reports', 'Nom du bucket des rapports IA générés', 'string', '"ai-reports"'::jsonb, false, true, 48, null),
    ('00000000-0000-0000-0000-000000000001', 'storage', 'storage.bucket.import_reports', 'Bucket: rapports import', 'Bucket: import reports', 'Nom du bucket des rapports d''import Excel/JSON', 'string', '"import-reports"'::jsonb, false, true, 49, null),

    -- Backup
    ('00000000-0000-0000-0000-000000000001', 'backup', 'backup.passphrase', 'Phrase secrète backup', 'Backup passphrase', 'Phrase secrète pour le chiffrement AES-256 des sauvegardes (32+ caractères)', 'secret', null, true, true, 50, null),
    ('00000000-0000-0000-0000-000000000001', 'backup', 'backup.retention_days', 'Rétention sauvegardes (jours)', 'Backup retention (days)', 'Durée de rétention des archives de sauvegarde', 'number', '365'::jsonb, false, true, 51, null),
    ('00000000-0000-0000-0000-000000000001', 'backup', 'backup.schedule_hours', 'Fréquence sauvegarde (heures)', 'Backup schedule (hours)', 'Intervalle entre sauvegardes automatiques (heures)', 'number', '24'::jsonb, false, true, 52, null),
    ('00000000-0000-0000-0000-000000000001', 'backup', 'backup.schedule_time', 'Heure sauvegarde (HH:MM)', 'Backup time (HH:MM)', 'Heure locale de la sauvegarde quotidienne', 'string', '"02:00"'::jsonb, false, true, 53, '^([0-1][0-9]|2[0-3]):[0-5][0-9]$'),

    -- System
    ('00000000-0000-0000-0000-000000000001', 'system', 'system.allowed_origins', 'Origines CORS autorisées', 'Allowed CORS origins', 'Liste séparée par virgules des origines autorisées', 'string', '"http://localhost:5173,app://-,file://-"'::jsonb, false, true, 60, null),
    ('00000000-0000-0000-0000-000000000001', 'system', 'system.rate_limit_window_ms', 'Fenêtre limite de taux (ms)', 'Rate limit window (ms)', 'Fenêtre de temps pour la limite de taux globale', 'number', '60000'::jsonb, false, true, 61, null),
    ('00000000-0000-0000-0000-000000000001', 'system', 'system.rate_limit_max_requests', 'Max requêtes par fenêtre', 'Max requests per window', 'Nombre maximum de requêtes par fenêtre de temps', 'number', '100'::jsonb, false, true, 62, null),
    ('00000000-0000-0000-0000-000000000001', 'system', 'system.log_level', 'Niveau de log', 'Log level', 'Niveau de verbosité des logs', 'string', '"info"'::jsonb, false, true, 63, null),
    ('00000000-0000-0000-0000-000000000001', 'system', 'system.timezone', 'Fuseau horaire', 'Timezone', 'Fuseau horaire par défaut (IANA)', 'string', '"Africa/Algiers"'::jsonb, false, true, 64, null),
    ('00000000-0000-0000-0000-000000000001', 'system', 'system.default_locale', 'Langue par défaut', 'Default locale', 'Langue par défaut de l''application', 'string', '"fr"'::jsonb, false, true, 65, null),
    ('00000000-0000-0000-0000-000000000001', 'system', 'system.default_currency', 'Devise par défaut', 'Default currency', 'Code devise ISO 4217', 'string', '"DZD"'::jsonb, false, true, 66, null),

    -- Feature flags
    ('00000000-0000-0000-0000-000000000001', 'feature_flags', 'feature.enable_ai', 'Activer IA', 'Enable AI', 'Active les fonctionnalités IA (narratives, drafting, anomaly)', 'boolean', 'true'::jsonb, false, false, 70, null),
    ('00000000-0000-0000-0000-000000000001', 'feature_flags', 'feature.enable_workflows', 'Activer workflows', 'Enable workflows', 'Active l''éditeur de workflows DAG', 'boolean', 'true'::jsonb, false, false, 71, null),
    ('00000000-0000-0000-0000-000000000001', 'feature_flags', 'feature.enable_backup_daemon', 'Activer daemon backup', 'Enable backup daemon', 'Active le daemon de sauvegarde automatique', 'boolean', 'true'::jsonb, false, false, 72, null),
    ('00000000-0000-0000-0000-000000000001', 'feature_flags', 'feature.enable_realtime', 'Activer temps réel', 'Enable realtime', 'Active les abonnements temps réel Supabase', 'boolean', 'true'::jsonb, false, false, 73, null),
    ('00000000-0000-0000-0000-000000000001', 'feature_flags', 'feature.enable_arabic_rtl', 'Activer arabe RTL', 'Enable Arabic RTL', 'Active le support arabe RTL', 'boolean', 'true'::jsonb, false, false, 74, null)
on conflict (tenant_id, category, key) do nothing;
