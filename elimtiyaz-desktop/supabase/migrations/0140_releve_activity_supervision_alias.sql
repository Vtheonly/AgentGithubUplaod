-- ============================================================================
-- 0140_releve_activity_supervision_alias.sql
-- ============================================================================
-- T-481 (WORKFORCE-508, 139th session 2026-10-04) — the discovery of the
-- Relevé port: the 0009 CHECK constraint on releve_entries.activity_type
-- admits 'surveillance' (the French spelling) but BOTH clients' shared
-- wire vocabulary uses 'supervision' (the English spelling — desktop
-- domain/model/personnel.ts ReleveActivity AND the Android ReleveActivity
-- enum, whose KDoc pins "matches desktop codes exactly"). Every
-- "Surveillance" entry a client tried to write would have died with a
-- check_violation.
--
-- The fix: WIDEN the CHECK to admit both spellings (append-only — the
-- constraint is replaced, the 0009 file untouched; no data change: any
-- historical 'surveillance' rows keep reading through the repository's
-- read-side fold 'surveillance' → domain 'supervision').
--
-- Ruling rationale (the PARITY-010/ADR-033 precedent — settle on the
-- majority implementation with evidence): the two CLIENTS agree on
-- 'supervision' as the cross-platform wire code (the Android's wire
-- protocol is documented as verbatim desktop parity); the DB CHECK is the
-- single divergent implementation. Widening keeps the historical value
-- legal instead of rewriting history.

-- ----------------------------------------------------------------------------
-- §1. Widen the activity CHECK with 'supervision'
-- ----------------------------------------------------------------------------
alter table public.releve_entries
    drop constraint releve_entries_activity_type_check;

alter table public.releve_entries
    add constraint releve_entries_activity_type_check check (activity_type in (
        'course', 'meeting', 'surveillance', 'supervision', 'correction',
        'task', 'delivery', 'warehouse', 'admin', 'other'
    ));

comment on constraint releve_entries_activity_type_check on public.releve_entries is
    'The 0009 vocabulary + ''supervision'' (0140/T-481: both clients'' shared wire code for the Surveillance activity — the 0009 French spelling stays legal for historical rows; the read side folds it to ''supervision'').';

-- ----------------------------------------------------------------------------
-- §2. Registration (T-091/MIG-TOKENS pattern).
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0140', '{0140_releve_activity_supervision_alias.sql}', 'releve_activity_supervision_alias')
on conflict (version) do nothing;
