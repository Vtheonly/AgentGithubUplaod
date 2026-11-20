-- ============================================================================
-- 0157_remove_tournee_permissions.sql
-- ============================================================================
-- T-541 / OPS-324 (180th session, 2026-10-15) — the owner's mandate:
-- "Completely Remove the GPS Tournee Driver Feature … This is a complete
-- removal, not merely a UI change … Associated permissions and
-- configuration where they are exclusively related to this feature."
--
-- The two exclusively-tournee permissions seeded by 0023 —
--   `access_driver_mode` (Mode chauffeur, routing/701)
--   `view_routing`       (Voir le routage,  routing/702)
-- — are retired together with their role_permissions grants.
--
-- What this migration deliberately does NOT do:
--   - It does NOT drop the `driver` ROLE (0023 role 107): live
--     user_profiles may hold role 'driver'; the role's REMAINING grants
--     (view_tasks, view_notifications, submit_expense — the standard
--     worker set) stay valid. The desktop's Role.Driver and the
--     deliveries workflow (driver-dashboard, ManageDeliveries) are NOT
--     tournee components and are untouched.
--   - It does NOT touch any other permission, role, or table.
--   - Idempotent: deletes are no-ops if the rows are already gone, and
--     the schema_migrations registration is on-conflict-guarded (T-091).
--
-- Client companion (same task): the desktop dropped Permission.
-- AccessDriverMode + the sidebar entry + the /routing route + the
-- feature-registry node; Android dropped ACCESS_DRIVER_MODE + the three
-- routing screens + the GPS foreground service + the Room tables
-- (v20→v21). This migration is the SERVER half of the same removal.

-- ----------------------------------------------------------------------------
-- §1. Remove the exclusively-tournee role_permissions grants (driver role)
-- ----------------------------------------------------------------------------
delete from public.role_permissions rp
  using public.permissions p
 where rp.permission_id = p.id
   and p.code in ('access_driver_mode', 'view_routing');

-- ----------------------------------------------------------------------------
-- §2. Remove the exclusively-tournee permissions themselves
-- ----------------------------------------------------------------------------
delete from public.permissions
 where code in ('access_driver_mode', 'view_routing');

-- ----------------------------------------------------------------------------
-- §3. Registration (T-091/MIG-TOKENS pattern).
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0157', '{0157_remove_tournee_permissions.sql}', 'remove_tournee_permissions')
on conflict (version) do nothing;
