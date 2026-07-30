-- ============================================================================
-- 0011_operations.sql
-- ============================================================================
-- Operations domain: suppliers, purchase requests (two-tier approval like
-- expenses), deliveries (inbound/outbound/internal with multi-stop routing),
-- inventory items + transactions, and pending receipts/dispatches queues.
--
-- Per plan §11 (Operations):
--   - Suppliers: master vendor records with payment terms and 1-5 rating
--   - Purchase requests: draft → submitted → approved/rejected → ordered → received
--     (mirrors expense_tickets state machine from 0008)
--   - Deliveries: assigned → in_transit → delivered → confirmed/failed/cancelled
--     with multi-stop routing stored as jsonb (lat/lng + time windows)
--   - Inventory: items with on-hand/reserved/reorder levels, transaction ledger
--     for receive/dispatch/scan/damage/adjust/return
--   - Pending receipts: inbound goods awaiting verification
--   - Pending dispatches: outbound goods awaiting pickup/delivery
--
-- Conventions (consistent with 0002–0010):
--   - `public.gen_uuid()` for PKs
--   - `tenant_id` NOT NULL FK → tenants(id) ON DELETE CASCADE
--   - `created_at`/`updated_at` timestamptz NOT NULL DEFAULT now()
--   - `public.touch_updated_at()` trigger on every table with `updated_at`
--   - Actor columns (requester_id, approved_by, performed_by, received_by,
--     dispatched_by) reference user_profiles.id WITHOUT FK constraints
--   - `driver_id` references personnel(id) — drivers are staff
--   - Monetary amounts: numeric(12,2) for totals, numeric(10,2) for unit prices
--   - GIN indexes on jsonb columns; trigram on searchable text
--   - CHECK constraints for all enum-like text fields
--
-- Scale assumptions (per plan §00):
--   - ~5,000 total users / ~300 DAU / ~50 peak concurrent
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. suppliers — master vendor records
-- ----------------------------------------------------------------------------
create table public.suppliers (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    code            text        not null,                                 -- 'SUP-0001'
    name            text        not null,
    contact_name    text,
    phone           text,
    email           text,
    address         text,
    tax_id          text,                                                 -- Algerian NIF/RC
    payment_terms   text,                                                 -- 'Net 30', 'COD', etc.
    rating          smallint    check (rating is null or (rating >= 1 and rating <= 5)),
    is_active       boolean     not null default true,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    deleted_at      timestamptz,
    unique (tenant_id, code)
);

create index suppliers_tenant_active_idx on public.suppliers (tenant_id, name) where deleted_at is null;
create index suppliers_trgm_idx on public.suppliers using gin (name extensions.gin_trgm_ops, contact_name extensions.gin_trgm_ops);

comment on table public.suppliers is
  'Master vendor records. Soft-deleted via deleted_at. Plan §11.02.';
comment on column public.suppliers.code is 'Short stable code unique per tenant (e.g. SUP-0001).';
comment on column public.suppliers.rating is 'Optional 1-5 quality rating (smallint). NULL = unrated.';
comment on column public.suppliers.payment_terms is 'Free-text payment terms (Net 30, COD, etc.).';

-- ----------------------------------------------------------------------------
-- 2. purchase_requests — two-tier procurement workflow
-- ----------------------------------------------------------------------------
create table public.purchase_requests (
    id                      uuid        primary key default public.gen_uuid(),
    tenant_id               uuid        not null references public.tenants(id) on delete cascade,
    request_number          text        not null,                          -- 'PR-2026-001234'
    title                   text        not null,
    description             text,
    requester_id            uuid        not null,                          -- user_profiles.id (no FK by convention)
    department_id           uuid        references public.departments(id) on delete set null,
    status                  text        not null default 'draft' check (status in (
                                'draft', 'submitted', 'approved', 'rejected',
                                'ordered', 'received', 'cancelled'
                            )),
    priority                text        not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
    expected_delivery_date  date,
    total_amount            numeric(12,2) not null default 0 check (total_amount >= 0),
    lines                   jsonb       not null default '[]'::jsonb,      -- [{description, quantity, unit_price, total}]
    approved_by             uuid,                                          -- user_profiles.id (no FK by convention)
    approved_at             timestamptz,
    rejected_reason         text,
    supplier_id             uuid        references public.suppliers(id) on delete set null,
    ordered_at              timestamptz,
    received_at             timestamptz,
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now(),
    unique (tenant_id, request_number)
);

create index purchase_requests_tenant_status_idx on public.purchase_requests (tenant_id, status, created_at desc);
create index purchase_requests_requester_idx on public.purchase_requests (requester_id, created_at desc);
create index purchase_requests_approver_idx on public.purchase_requests (approved_by) where approved_by is not null;
create index purchase_requests_supplier_idx on public.purchase_requests (supplier_id) where supplier_id is not null;
create index purchase_requests_department_idx on public.purchase_requests (department_id) where department_id is not null;
create index purchase_requests_lines_gin_idx on public.purchase_requests using gin (lines jsonb_path_ops);
create index purchase_requests_trgm_idx on public.purchase_requests using gin (title extensions.gin_trgm_ops);

comment on table public.purchase_requests is
  'Two-tier procurement workflow mirroring expense_tickets (0008). State machine enforced at DB layer. Plan §11.03.';
comment on column public.purchase_requests.requester_id is 'user_profiles.id of the buyer/staff submitting the request. No FK (convention).';
comment on column public.purchase_requests.lines is 'JSON array of line items: [{description, quantity, unit_price, total}]. GIN-indexed.';
comment on column public.purchase_requests.approved_by is 'user_profiles.id of the approver (FinancialOfficer/Manager). No FK (convention).';
comment on column public.purchase_requests.total_amount is 'Sum of line totals. numeric(12,2) in DZD. App-layer recomputes on save.';

-- ----------------------------------------------------------------------------
-- 3. deliveries — multi-stop inbound/outbound/internal delivery tracking
-- ----------------------------------------------------------------------------
create table public.deliveries (
    id                  uuid        primary key default public.gen_uuid(),
    tenant_id           uuid        not null references public.tenants(id) on delete cascade,
    delivery_number     text        not null,                              -- 'DLV-2026-001234'
    delivery_type       text        not null check (delivery_type in ('inbound', 'outbound', 'internal')),
    status              text        not null default 'assigned' check (status in (
                                'assigned', 'in_transit', 'delivered',
                                'confirmed', 'failed', 'cancelled'
                            )),
    driver_id           uuid        references public.personnel(id) on delete set null,
    vehicle             text,                                              -- 'Toyota Hiace 005-123-16'
    origin_address      text,
    destination_address text,
    scheduled_at        timestamptz not null,
    departed_at         timestamptz,
    delivered_at        timestamptz,
    confirmed_at        timestamptz,
    stops               jsonb       not null default '[]'::jsonb,          -- [{address, lat, lng, contact, window_start, window_end, status}]
    notes               text,
    delay_reason        text,
    delay_minutes       integer     not null default 0 check (delay_minutes >= 0),
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    unique (tenant_id, delivery_number)
);

create index deliveries_tenant_status_idx on public.deliveries (tenant_id, status, scheduled_at);
create index deliveries_driver_idx on public.deliveries (driver_id, scheduled_at desc) where driver_id is not null;
create index deliveries_scheduled_idx on public.deliveries (scheduled_at) where status in ('assigned', 'in_transit');
create index deliveries_stops_gin_idx on public.deliveries using gin (stops jsonb_path_ops);

comment on table public.deliveries is
  'Multi-stop delivery tracking (inbound/outbound/internal). driver_id → personnel. Plan §11.04.';
comment on column public.deliveries.driver_id is 'personnel.id of the assigned driver. SET NULL if they leave the company.';
comment on column public.deliveries.stops is 'JSON array of stop objects: [{address, lat, lng, contact, window_start, window_end, status}]. GIN-indexed.';
comment on column public.deliveries.delay_minutes is 'Total delay in minutes (>= 0). delay_reason explains the cause.';

-- ----------------------------------------------------------------------------
-- 4. inventory_items — stock-keeping units with reorder thresholds
-- ----------------------------------------------------------------------------
create table public.inventory_items (
    id                  uuid        primary key default public.gen_uuid(),
    tenant_id           uuid        not null references public.tenants(id) on delete cascade,
    sku                 text        not null,                              -- 'SKU-EDU-001'
    name                text        not null,
    description         text,
    category            text,                                              -- 'stationery', 'cleaning', 'it', etc.
    unit                text        not null default 'piece',              -- 'piece', 'box', 'liter', 'kg'
    quantity_on_hand    numeric(12,2) not null default 0 check (quantity_on_hand >= 0),
    quantity_reserved   numeric(12,2) not null default 0 check (quantity_reserved >= 0),
    reorder_level       numeric(12,2) not null default 0 check (reorder_level >= 0),
    reorder_quantity    numeric(12,2) not null default 0 check (reorder_quantity >= 0),
    unit_cost           numeric(12,2) not null default 0 check (unit_cost >= 0),
    location            text,                                              -- 'WH-A/Shelf-3'
    is_active           boolean     not null default true,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    deleted_at          timestamptz,
    unique (tenant_id, sku),
    check (quantity_reserved <= quantity_on_hand)
);

create index inventory_items_tenant_active_idx on public.inventory_items (tenant_id, name) where deleted_at is null;
create index inventory_items_category_idx on public.inventory_items (tenant_id, category) where category is not null;
create index inventory_items_low_stock_idx on public.inventory_items (tenant_id) where deleted_at is null and quantity_on_hand <= reorder_level and is_active = true;
create index inventory_items_trgm_idx on public.inventory_items using gin (name extensions.gin_trgm_ops, sku extensions.gin_trgm_ops);

comment on table public.inventory_items is
  'Stock-keeping units with on-hand/reserved quantities and reorder thresholds. Plan §11.05.';
comment on column public.inventory_items.sku is 'Unique stock-keeping unit code per tenant.';
comment on column public.inventory_items.quantity_reserved is 'Units committed to outbound orders but not yet dispatched. CHECK: reserved <= on_hand.';
comment on column public.inventory_items.reorder_level is 'Threshold below which a reorder alert fires.';
comment on column public.inventory_items.reorder_quantity is 'Suggested reorder quantity when stock falls below reorder_level.';
comment on column public.inventory_items.unit_cost is 'Latest weighted-average unit cost in DZD (numeric(12,2)).';

-- ----------------------------------------------------------------------------
-- 5. inventory_transactions — append-only stock movement ledger
-- ----------------------------------------------------------------------------
create table public.inventory_transactions (
    id                  uuid        primary key default public.gen_uuid(),
    tenant_id           uuid        not null references public.tenants(id) on delete cascade,
    item_id             uuid        not null references public.inventory_items(id) on delete restrict,
    transaction_type    text        not null check (transaction_type in (
                                'receive', 'dispatch', 'scan', 'damage',
                                'adjust', 'return'
                            )),
    quantity            numeric(12,2) not null check (quantity <> 0),     -- positive = inbound, negative = outbound
    unit_cost           numeric(12,2) not null default 0 check (unit_cost >= 0),
    total_cost          numeric(12,2) not null default 0 check (total_cost >= 0),
    reference_type      text,                                              -- 'purchase_request', 'delivery', 'adjustment', etc.
    reference_id        uuid,                                              -- polymorphic FK (no constraint)
    performed_by        uuid,                                              -- user_profiles.id (no FK by convention)
    note                text,
    transaction_at      timestamptz not null default now(),
    created_at          timestamptz not null default now()
);

create index inventory_transactions_item_idx on public.inventory_transactions (item_id, transaction_at desc);
create index inventory_transactions_tenant_type_idx on public.inventory_transactions (tenant_id, transaction_type, transaction_at desc);
create index inventory_transactions_reference_idx on public.inventory_transactions (reference_type, reference_id) where reference_id is not null;
create index inventory_transactions_performed_by_idx on public.inventory_transactions (performed_by, transaction_at desc) where performed_by is not null;

comment on table public.inventory_transactions is
  'Append-only stock movement ledger. quantity is signed (+inbound / -outbound). Polymorphic reference via reference_type/reference_id. Plan §11.06.';
comment on column public.inventory_transactions.transaction_type is 'receive=inbound from supplier, dispatch=outbound to consumer, scan=barcoded check, damage=loss/write-off, adjust=manual correction, return=customer return.';
comment on column public.inventory_transactions.quantity is 'Signed quantity: positive for inbound movements (receive/return), negative for outbound (dispatch/damage). Adjust can be either.';
comment on column public.inventory_transactions.reference_type is 'Polymorphic reference discriminator (e.g. purchase_request, delivery, pending_dispatch). reference_id is the row UUID.';
comment on column public.inventory_transactions.performed_by is 'user_profiles.id of the warehouse worker / buyer who recorded the movement. No FK (convention).';

-- ----------------------------------------------------------------------------
-- 6. pending_receipts — inbound goods awaiting verification
-- ----------------------------------------------------------------------------
create table public.pending_receipts (
    id                  uuid        primary key default public.gen_uuid(),
    tenant_id           uuid        not null references public.tenants(id) on delete cascade,
    purchase_request_id uuid        references public.purchase_requests(id) on delete set null,
    supplier_id         uuid        references public.suppliers(id) on delete set null,
    expected_at         timestamptz,
    received_at         timestamptz,
    received_by         uuid,                                              -- user_profiles.id (no FK by convention)
    items_json          jsonb       not null default '[]'::jsonb,          -- [{sku, name, expected_qty, received_qty, condition}]
    status              text        not null default 'pending' check (status in (
                                'pending', 'partial', 'received', 'cancelled'
                            )),
    note                text,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index pending_receipts_tenant_status_idx on public.pending_receipts (tenant_id, status, expected_at);
create index pending_receipts_pr_idx on public.pending_receipts (purchase_request_id) where purchase_request_id is not null;
create index pending_receipts_supplier_idx on public.pending_receipts (supplier_id) where supplier_id is not null;
create index pending_receipts_items_gin_idx on public.pending_receipts using gin (items_json jsonb_path_ops);

comment on table public.pending_receipts is
  'Inbound goods awaiting verification. Links to purchase_request (origin) and supplier. Plan §11.07.';
comment on column public.pending_receipts.items_json is 'JSON array of item lines: [{sku, name, expected_qty, received_qty, condition}]. GIN-indexed.';
comment on column public.pending_receipts.received_by is 'user_profiles.id of the warehouse worker who confirmed receipt. No FK (convention).';

-- ----------------------------------------------------------------------------
-- 7. pending_dispatches — outbound goods awaiting pickup/delivery
-- ----------------------------------------------------------------------------
create table public.pending_dispatches (
    id                  uuid        primary key default public.gen_uuid(),
    tenant_id           uuid        not null references public.tenants(id) on delete cascade,
    destination         text        not null,
    items_json          jsonb       not null default '[]'::jsonb,          -- [{sku, name, quantity, note}]
    scheduled_at        timestamptz not null,
    dispatched_at       timestamptz,
    dispatched_by       uuid,                                              -- user_profiles.id (no FK by convention)
    delivery_id         uuid        references public.deliveries(id) on delete set null,
    status              text        not null default 'pending' check (status in (
                                'pending', 'dispatched', 'delivered', 'cancelled'
                            )),
    note                text,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index pending_dispatches_tenant_status_idx on public.pending_dispatches (tenant_id, status, scheduled_at);
create index pending_dispatches_delivery_idx on public.pending_dispatches (delivery_id) where delivery_id is not null;
create index pending_dispatches_items_gin_idx on public.pending_dispatches using gin (items_json jsonb_path_ops);

comment on table public.pending_dispatches is
  'Outbound goods awaiting pickup or delivery. Links to deliveries when assigned to a driver. Plan §11.08.';
comment on column public.pending_dispatches.items_json is 'JSON array of item lines: [{sku, name, quantity, note}]. GIN-indexed.';
comment on column public.pending_dispatches.dispatched_by is 'user_profiles.id of the warehouse worker who released the goods. No FK (convention).';
comment on column public.pending_dispatches.delivery_id is 'FK to deliveries(id) once a driver is assigned. SET NULL if the delivery is cancelled.';

-- ----------------------------------------------------------------------------
-- 8. Triggers — touch_updated_at on every table with updated_at
-- ----------------------------------------------------------------------------
create trigger suppliers_touch_updated_at before update on public.suppliers
    for each row execute function public.touch_updated_at();
create trigger purchase_requests_touch_updated_at before update on public.purchase_requests
    for each row execute function public.touch_updated_at();
create trigger deliveries_touch_updated_at before update on public.deliveries
    for each row execute function public.touch_updated_at();
create trigger inventory_items_touch_updated_at before update on public.inventory_items
    for each row execute function public.touch_updated_at();
create trigger pending_receipts_touch_updated_at before update on public.pending_receipts
    for each row execute function public.touch_updated_at();
create trigger pending_dispatches_touch_updated_at before update on public.pending_dispatches
    for each row execute function public.touch_updated_at();
-- NOTE: inventory_transactions is append-only (no updated_at) — no trigger.
