# ADR-012 — The web messenger connects parents to the Administrator only

- **Status:** Accepted (2026-09-03, 24th session)
- **Deciders:** Owner (explicit issue report: "The messenger on the web client should only connect users (parents) directly to the **Administrator** (one-on-one channel). Communication between parents must not be allowed; the chat feature is strictly meant for educational reports and inquiries directed to the admin.")
- **Amends:** ADR-008 (chat is a committed cross-platform feature — staff-initiated channels)
- **Resolves:** CHAT-200a (the portal messenger is dead for parents — no parent-invokable channel-creation path, 0 rows in `chat_channels`) · CHAT-200b (nothing structurally forbids parent↔parent communication) · closes the T-149 scope question
- **Task:** T-148 (backend, migration 0067), T-149 (website), T-150 (live apply + verify)

## Context

ADR-008 (2026-08-31) established chat as a committed feature with **staff-only channel creation**
("the school contacts the parent, not vice-versa from the portal"). Two weeks of live usage
showed the operational consequence: staff never open channels proactively, `chat_channels`
stays at 0 rows, and the portal's MessagesView shows "Aucune conversation" forever — the
messenger is effectively dead for every parent. Simultaneously, the 0048 RLS policies only
enforce "creator ∈ member_ids" and "author ∈ member_ids": a parent with API access could
create a channel with another parent as member, and both could then exchange messages —
parent↔parent communication was structurally possible, which the school has now explicitly
forbidden.

## Decision

1. **Parents can reach the Administrator from the portal.** A parent-initiated,
   idempotent, one-on-one channel to the tenant's Administrator is the ONE
   channel-creation action the web client offers: `open_parent_admin_channel()`
   (migration 0067) resolves the tenant's oldest active `super_admin` (fallback
   `support_staff`) and opens/returns the deterministic DM for that pair. The channel is
   strictly meant for **educational reports and inquiries directed to the admin** (the
   owner's words).
2. **Parent↔parent communication is forbidden at the database level, not just the UI.**
   Migration 0067 tightens both policies:
   - `chat_channels_insert`: a non-staff creator requires every OTHER member to hold a
     chat-staff role (super_admin / manager / support_staff / financial_officer / teacher —
     the same 5-role list as 0048/0061).
   - `chat_messages_insert`: a non-staff author may only post in a `direct` channel where
     at least one OTHER member holds a chat-staff role.
   Staff keep the full 0048 semantics (member rule unchanged) — staff↔staff, group and
   announcement channels are unaffected.
3. **One conversation per pair.** `open_parent_admin_channel` uses the same sorted-pair
   deterministic DM code as 0061's `create_direct_channel`, so the channel a parent opens
   is exactly the channel the staff side's "Messager" action would resolve for the same
   pair — no duplicates, whichever side opens first.
4. **Staff-initiated channels remain** (ADR-008 unchanged in that respect): staff can
   still open direct channels with any parent from the desktop's parent-detail drawer.

## Consequences

- The website MessagesView gains a "Contacter l'administration" action (T-149) — the only
  channel-creation UI on the portal, parents only. ADR-008's "do NOT add channel-creation
  UI" consequence is superseded by THIS decision for the admin channel specifically.
- Parents cannot create channels with other parents, post in parent↔parent or
  group/announcement channels, or address notifications to other parents (that last one
  was already enforced by 0048).
- The RLS evaluation needs to test the staff-ness of OTHER profiles — `role_assignments`
  rows are not readable by parents, so migration 0067 adds the SECURITY DEFINER helper
  `profile_has_staff_role(uuid)` (the 0003 `has_any_role` convention: read-only, pinned
  search_path, exposes only a boolean).
- If the school later wants role-based routing (e.g. inquiries → support_staff), the
  admin-resolution query in `open_parent_admin_channel` is the single place to change.
- Android chat v1 (T-129) is staff-side and unaffected; its write path satisfies the
  tightened policies for staff authors.

## Evidence

- Live: `scripts/verify_t-148.sql` results recorded in `docs/recovery/change-log.md`
  (T-150): parent opens the admin channel (idempotent ×2), non-parent/staff callers
  rejected, parent insert into a parent-only channel REJECTED, parent insert into the
  admin DM ACCEPTED, staff insert unaffected, chain 64/64 zero drift.
- Website: `src/test/t-149-contact-admin.test.ts` (T-149).
