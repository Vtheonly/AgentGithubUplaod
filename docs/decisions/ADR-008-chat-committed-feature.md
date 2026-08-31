# ADR-008 — Chat is a committed cross-platform feature (staff-initiated)

- **Status:** Accepted (2026-08-31, 14th session)
- **Deciders:** Owner (explicit instruction: "fix and test the chat in all platforms")
- **Resolves:** UNKNOWN-005 (chat product scope) · unblocks T-037 (chat implementation), CHAT-103, CHAT-104, CHAT-105

## Context

Since the first audit, chat existed as a half-built feature on three disconnected tracks: a
sandboxed in-memory mock on the desktop (`mock/workforce/index.ts` — wiped on every restart,
invisible to other platforms), a permanently empty MessagesView on the parent portal (nothing in
production ever created `chat_channels` rows — CHAT-103), and zero chat UI on Android. T-037 was
**Blocked** on UNKNOWN-005 ("Is staff↔parent/staff↔staff chat a committed feature?").

## Decision

1. **Chat IS a committed feature.** The owner's instruction of 2026-08-31 ("fix and test the chat
   in all platforms") is the product decision UNKNOWN-005 was waiting for. The "if built" branch
   of T-037 is now the operative plan.
2. **Channel creation is STAFF-ONLY.** Staff open direct channels with parents or colleagues; the
   parent portal stays **read + reply** (its designed role — the website has no channel-creation
   UI and the canonical `create_direct_channel` RPC enforces a staff gate). This mirrors the
   school's operational model: the school contacts the parent, not vice-versa from the portal.
3. **Canonical creation path:** the `create_direct_channel(p_other_profile_id, p_name)` RPC
   (migration 0061) — idempotent (deterministic DM code from the sorted member pair), SECURITY
   DEFINER with full caller verification (staff gate, target-exists, fixed 'direct' type — the
   0050/0055 hardened pattern; see the migration header for why INVOKER could not work: RLS
   `user_profiles_select_own` hides other profiles from non-super_admin/support_staff callers).
4. **Desktop entry points:** the personnel ChatPanel (staff↔staff, group/department/announcement
   channels) and the CRM parent-detail-drawer "Messager" action (staff↔parent, T-100) — both
   through `SupabaseChatRepository` (T-099), which replaces the mock in the Supabase assembly.
5. **Ordering and previews:** channel lists order by last activity — `chat_channels.last_message_at`
   / `last_message_preview` are denormalized by the `chat_messages_touch_channel` trigger
   (migration 0061, CHAT-104).

## Consequences

- The website MessagesView becomes usable as soon as staff open a channel with the parent (no
  website feature work was required — read/reply/markRead were already correct from T-032/0051).
- **Android has NO chat UI** — it never had one (only `USE_CHAT` permission constants in
  `core/Rbac.kt`). This is a scope gap, not a regression; registered as its own task
  (T-102 documents it; the Android chat UI is future work gated on the Android write-architecture
  decision, ADR-005).
- `chat_channels` gains completion columns (description, department_id, archived_at,
  last_message_at, last_message_preview) + a staff/creator-gated UPDATE policy (migration 0061).
- Announcement channels remain staff-only to create (0048 RLS gate); parents can reply in direct
  channels but cannot post into announcement channels (read-only broadcast per the 0010 schema
  comment).
- The mock chat repository remains for mock/dev mode (the mock implements
  `openParentChannel` with best-effort parity).

## Evidence

- Live: `scripts/verify_t-098.sql` — 15/15 checks (registration, columns, policies, trigger,
  idempotency, staff gate, self/foreign rejection, RLS regressions, audit).
- Desktop: `src/tests/infrastructure/t-099-supabase-chat-repository.test.ts` — 12/12
  (incl. 3 T-100 parent-channel tests).
- Website: `src/test/t-101-portal-chat-readiness.test.ts` — 4/4.
- REST layer: anonymous `POST /rest/v1/rpc/create_direct_channel` → 401 (live, 2026-08-31).
