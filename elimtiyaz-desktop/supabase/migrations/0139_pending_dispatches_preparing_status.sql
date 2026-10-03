-- ============================================================================
-- 0139_pending_dispatches_preparing_status.sql
-- ============================================================================
-- T-479 (WORKFORCE-507, 139th session 2026-10-04) — the warehouseTasks
-- Supabase port. The domain `DispatchStatus` union carries a 'preparing'
-- transient state (the warehouse dashboard's "Expédier" flow steps
-- pending → preparing → dispatched; `MockWarehouseTaskRepository
-- .prepareDispatch` writes it) but the 0011 CHECK constraint on
-- `pending_dispatches.status` only allows ('pending', 'dispatched',
-- 'delivered', 'cancelled') — a faithful port could never persist the
-- preparing step. This migration widens the CHECK with 'preparing'
-- (append-only: the constraint is REPLACED, never the 0011 file edited).
--
-- No data change: every existing row keeps its status; the widened
-- constraint only admits one new value on future writes.

-- ----------------------------------------------------------------------------
-- §1. Widen the status CHECK with 'preparing'
-- ----------------------------------------------------------------------------
alter table public.pending_dispatches
    drop constraint pending_dispatches_status_check;

alter table public.pending_dispatches
    add constraint pending_dispatches_status_check check (status in (
        'pending', 'preparing', 'dispatched', 'delivered', 'cancelled'
    ));

comment on column public.pending_dispatches.status is
    'Outbound dispatch lifecycle: pending → preparing (goods being gathered) → dispatched → delivered; cancelled is terminal. 0139 added ''preparing'' (T-479: the domain union''s transient state, previously impossible to persist).';

-- ----------------------------------------------------------------------------
-- §2. Registration (T-091/MIG-TOKENS pattern).
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0139', '{0139_pending_dispatches_preparing_status.sql}', 'pending_dispatches_preparing_status')
on conflict (version) do nothing;
