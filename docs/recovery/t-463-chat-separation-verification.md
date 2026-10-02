# T-463 Verification — The Chat-System Separation (scope column + desktop/Android split surfaces)

**Task:** T-463 · **Problem:** CHAT-300 · **Session:** 135th (2026-10-03) · **Status:** COMPLETE — the backend VERIFIED live; the desktop and Android gates TESTED (the in-app eyeball check is owner-gated, as every UI change is).

## The mandate

The owner's issue: the platform has TWO distinct chat systems — (1) Portal↔Staff (staff on desktop/mobile ↔ students/parents on the portal) and (2) Internal staff chat (desktop↔desktop, desktop↔mobile, mobile↔mobile, staff-to-staff, groups, workers) — that must be "clearly separated in the architecture, UI, permissions, data model, and navigation… Do not mix portal conversations with internal staff conversations."

## What was wrong (CHAT-300)

- ONE undifferentiated `chat_channels` table: no scope marker; `create_direct_channel` (0061) and `open_parent_admin_channel` (0067) produce structurally identical rows.
- Every staff client merged both systems into one channel list: the desktop Personnel "Messagerie" tab, the Android ChatScreen — parent DMs and staff channels interleaved, undistinguishable.
- The CRM parent drawer's "Messager" action created the parent channel and then dead-ended on a toast — the operator had to walk to Personnel and hunt for the "Parent — X" channel inside the internal list.

## Root cause

The chat tables (0010) predate the parent-messenger mandate (ADR-012/0067); the portal messenger deliberately reused the same table and DM-code algorithm (one conversation per pair), but no scope marker was ever added and no client ever split its list. The two systems differ ONLY in member composition (a portal channel contains ≥1 non-employee member) — derivable, but never derived.

## What was changed

### Backend — migration `0135_chat_channel_scope.sql` (applied live + registered, atomic)

1. `chat_channels.scope` (`'internal' | 'portal'`, NOT NULL, default `'internal'`, check constraint) — **forced by a BEFORE INSERT OR UPDATE trigger** (`chat_channels_derive_scope`) from member composition: any member that is NOT an employee-role holder (parent/student, or a profile with no employee roles — incl. since-deleted ghosts) ⇒ `'portal'`; only all-employee member sets ⇒ `'internal'`. Clients cannot mislabel a channel.
2. Backfill of the existing rows with the same rule (idempotent).
3. `profile_has_staff_role` recreated on the **9-role employee set** (0105 alignment — fixes the live inconsistency where a WORKER's raw group-channel insert was denied by 0067's 5-role non-staff-creator check), plus the new row-tenant variant `profile_has_staff_role_in_tenant(p_profile_id, p_tenant_id)` the derivation needs.
4. Registration row (T-091/MIG-TOKENS pattern, atomic with the apply).

### Desktop (hub repo)

- `ChatChannelScope` type + `ChatChannel.scope` on the domain model; `ChatRepository.observeChannels(personnelId, scope?)`; the Supabase repository reads the column and filters per scope; the mock mirrors (seed channels scoped; `openParentChannel` products are `'portal'`; `createChannel` derives mock-side).
- `ChatPanel` gains a `scope` prop — ONE component, TWO surfaces: internal (Personnel "Messagerie Interne" — channel creation allowed, "Conversations du personnel uniquement" explainer) and portal (new CRM "Messagerie Portail" tab — no free-form creation; conversations are opened per-parent; "Portail" badge on the selected channel; the parent-empty-state points to the parent-record action).
- The CRM parent drawer's "Messager" action now NAVIGATES to the portal tab with the new channel selected (`/crm?action=portal-chat&channelId=…` deep link) instead of the toast dead-end.
- `DashboardSection` gained an optional `description` line (the scope explainer).
- New regression test: `t-099-supabase-chat-repository.test.ts` — the scope split (internal/portal/all observers) + the pre-0135-row default.

### Android

- `ChatChannel.scope` + `isPortal` + `ChatChannelScope` enum (`fromWire` tolerant of unknown values); `ChatChannelDto` reads `scope`; the Room cache entity stores it (schema **v17 → v18**, `MIGRATION_17_18` — purely additive, cached rows default internal until the next replace-style refresh).
- `ChatScreen` gains `scope` + `topBarTitle` params (hub-tab embeds hide the top bar): the INTERNAL list and the PORTAL list are separate surfaces with their own empty-state explanations; `Routes.PortalChat` (RBAC: `USE_CHAT`) + the CRM hub's new "Portail" tab host the portal surface; `ChatDetail` carries an `isPortal` tag ("Portail — parent/élève") so the operator always knows which system they are in.
- Version-pin guards updated per the T-102 v17 precedent (`DatabaseMigrationDisciplineT046Test` → 18; `ServerDismissedEvictionT181Test` → 18).
- Tests: +5 scope model/DTO tests (`ChatModelsTest`), +2 Room migration tests (`RoomSchemaUpgradeT463Test` — survival + both-values round-trip).

### Website — deliberately unchanged

The portal is portal-only by construction (parents can only ever be members of channels containing themselves; per 0067 they cannot create parent↔parent channels, and staff-created channels containing a parent are portal-scoped by the trigger). The website's MessagesView therefore already shows exactly the portal system.

## What was verified (all commands actually run this session)

### Live backend (Management API SQL endpoint, atomic apply + probes)

- Apply: `python3 scripts/apply-migration-live.py …/0135_chat_channel_scope.sql` → HTTP 201, `[]` (clean); re-apply idempotent.
- Registration: `select version from supabase_migrations.schema_migrations where version in ('0134','0135')` → both rows.
- **Trigger probes 5/5 green** (`scripts/verify_t463_live.py`, probe → assert → cleanup):
  - A: all-staff channel with a client-LIED `scope='portal'` → forced `internal` ✓
  - B: channel with a non-staff member + client-LIED `scope='internal'` → forced `portal` ✓
  - C: member-set change re-derives scope ✓
  - D: the two production channels (parent↔admin DMs) → `portal` ✓
  - cleanup: zero residue ✓
- The resolvers census: `profile_has_staff_role_in_tenant` sees the super_admin's role under the row's tenant ✓.
- Append-only migration guard: `bash scripts/check-migrations-append-only.sh` → "130 migration file(s), +0 added vs origin/main, +1 new in worktree" ✓.

### Desktop

- `npm run typecheck` → 0 errors ✓
- `npx eslint <the 11 changed files>` → 0 errors (13 pre-existing warnings; the repo-wide 1 error is the pre-existing `scripts/t-424-tranche-attribution-analysis.ts` untouched by this task) ✓
- `npx vitest run` (full) → **4,604 passed / 17 failed / 5 skipped (4,626 total)** — the failing-file set is **byte-identical to the documented baseline** (`scripts/test-baseline.json`); the +1 test is the new scope-split regression test (passing) ✓

### Android

- `./gradlew compileDebugKotlin` → BUILD SUCCESSFUL (pre-existing warnings only) ✓
- `./gradlew testDebugUnitTest` (full debug suite) → **703 tests, 0 failed, 1 skipped** (T-462 baseline 697 → +7: 5 scope model tests + 2 migration tests; the two version-pin guards updated per the documented precedent) ✓
- `./gradlew lint` → BUILD SUCCESSFUL ✓

## What remains unresolved (Left)

1. **OWNER (device smoke test):** build the APK (`./scripts/setup-env.sh` + `./gradlew assembleDebug`) and eyeball the CRM "Portail" tab + the portal tags + the internal "Messagerie Interne" list on a real screen — the code gates are green but the visual acceptance is the owner's.
2. **Android parent-detail portal entry:** the CRM hub's Portail tab lists portal conversations, but the Android parent-DETAIL screen has no per-parent "open conversation" action yet (the channel is opened from the DESKTOP parent file / the parent's own portal button; the Android sees it on refresh). Registering a follow-up would need the desktop's `openParentChannel` ported to the Android chat repository — deliberately deferred to keep this session's scope controlled (the lists, navigation, tags and data model are the separation mandate; the per-parent creator is an additive follow-up).
3. The 0075 notification fan-out is scope-agnostic (it notifies channel members) — works for both systems unchanged; no gap found.

## New discoveries documented this task

1. **`profile_has_staff_role` was caller-tenant-scoped** (`current_tenant_id()`) — meaningless in caller-less contexts (the migration backfill itself): the first backfill attempt silently classified BOTH production parent↔admin channels as 'internal' because the resolver saw no tenant. Fixed by the row-tenant variant `profile_has_staff_role_in_tenant` (the derivation now uses `NEW.tenant_id`). Recorded here + in the migration header.
2. **The two live parent↔admin channels carry since-deleted parent members** (ghost profiles with no role rows — the T-148/T-150 round-trip test users were cleaned up). Under the derived rule a ghost member is NOT staff ⇒ the channel is 'portal' — semantically correct (it was created by `open_parent_admin_channel`).
3. **The 0105/0067 role-list inconsistency** (workers are staff for the RPC but not for the RLS resolvers) — fixed in 0135 by recreating `profile_has_staff_role` on the 9-role set. Registered in the problem entry as part of CHAT-300's permissions half.
