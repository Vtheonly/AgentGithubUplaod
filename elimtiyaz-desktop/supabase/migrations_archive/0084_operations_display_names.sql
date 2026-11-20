-- ============================================================================
-- 0084_operations_display_names.sql — T-238/T-239/T-240 support (35th session)
-- ============================================================================
-- CONTEXT: the T-047 Group-A ports #7/#8/#9 (purchaseRequests, deliveries,
-- inventory — the Buyer/Driver/Warehouse dashboards' production-grade
-- persistence, the owner's "no mock workarounds" mandate) map the domain
-- contracts onto the canonical 0011 tables. Three domain fields have no
-- column home:
--
--   1. PurchaseRequest.requestedByName / approvedByName — the 0011 table
--      stores only requester_id / approved_by (user_profiles.id, "no FK by
--      convention" — a PostgREST embed is therefore NOT detectable), and
--      user_profiles rows can be renamed/deleted, which would silently
--      rewrite history. The 0074 precedent (tasks.created_by_name +
--      author_name) solved exactly this: freeze the display name at write
--      time.
--   2. Delivery.driverName — same problem (driver_id → personnel, but the
--      domain renders the name; personnel rows soft-delete and the 0011
--      FK is ON DELETE SET NULL, so post-hoc resolution would degrade to
--      null). driver_name frozen at write time.
--   3. Delivery.newEta (reportDelay's new arrival estimate) — no column;
--      the delay pair (delay_reason/delay_minutes) exists but the domain
--      contract carries the ETA string.
--   4. InventoryTransaction.quantityBefore / quantityAfter / actorName —
--      the 0011 transaction log stores only the signed quantity
--      (quantity <> 0); the domain's before/after pair is the audit-grade
--      display the warehouse dashboard renders, and performed_by is a
--      no-FK user_profiles.id. Frozen columns keep the ledger append-only
--      and self-describing.
--
-- Cross-platform check (AGENTS.md §10): these tables have NO Android or
-- website consumers today (the Android operations screens are not built;
-- the website is the parent portal) — the desktop is the only client, and
-- this migration is additive (new nullable columns; existing rows read as
-- NULL names, which the adapters degrade honestly to "—").
--
-- IDEMPOTENCY: ADD COLUMN IF NOT EXISTS — safe to re-apply.
--
-- Per AGENTS.md §15 rule 10 (T-091/MIG-TOKENS pattern): this file is
-- applied to the live project TOGETHER with its schema_migrations
-- registration in one atomic transaction (scripts/apply_0084_live.sh).
--
-- NOTE: the Management API SQL endpoint silently DROPS `comment on`
-- statements (AGENTS.md §11.1 quirk 1) — the catalog comments land on
-- fresh CLI deployments only. That is the documented live state.
-- ============================================================================

alter table public.purchase_requests
    add column if not exists requested_by_name text,
    add column if not exists approved_by_name text;

comment on column public.purchase_requests.requested_by_name is
  'Display name of the requester FROZEN at write time (0074 tasks.created_by_name precedent — requester_id has no FK and profiles can be renamed).';
comment on column public.purchase_requests.approved_by_name is
  'Display name of the approver FROZEN at decision time (same precedent).';

alter table public.deliveries
    add column if not exists driver_name text,
    add column if not exists new_eta text;

comment on column public.deliveries.driver_name is
  'Driver display name FROZEN at assignment time (driver_id is ON DELETE SET NULL — post-hoc resolution would degrade).';
comment on column public.deliveries.new_eta is
  'Revised arrival estimate (ISO string) reported by the driver on a delay (the domain reportDelay contract).';

alter table public.inventory_transactions
    add column if not exists quantity_before numeric(12,2),
    add column if not exists quantity_after numeric(12,2),
    add column if not exists performed_by_name text;

comment on column public.inventory_transactions.quantity_before is
  'Item quantity_on_hand BEFORE this transaction (audit-grade ledger display, frozen at write time).';
comment on column public.inventory_transactions.quantity_after is
  'Item quantity_on_hand AFTER this transaction (audit-grade ledger display, frozen at write time).';
comment on column public.inventory_transactions.performed_by_name is
  'Actor display name FROZEN at write time (performed_by has no FK by convention).';

-- ----------------------------------------------------------------------------
-- Registration row (T-091/MIG-TOKENS pattern — scripts/apply_0084_live.sh
-- embeds this so the DDL and the registration land in ONE atomic
-- transaction; ON CONFLICT keeps it idempotent.)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0084', '{0084_operations_display_names.sql}', 'operations_display_names')
on conflict (version) do nothing;
