# Messages & Communication — Comprehensive Section Audit (T-499, the 150th session — Markdown edition, re-issued 2026-10-10 under T-500)

> **Audit date:** 2026-10-10 (T-499, the 150th session; re-issued as Markdown under T-500 per the owner's instruction — this replaces the session's PDF report as the archival form) · **Task:** Area A of the owner's Messages/Pedagogy/Staff audit mandate — **"the chat for both clients and the worker"**
> **Application:** `elimtiyaz-desktop` (Electron + React + TypeScript) against the **live production Supabase** (`vebfehrpzajhstyhinnw`, eu-west-1)
> **Method:** full code-path tracing + a LIVE REST E2E through the app's own repository shapes (`scripts/t499-portal-chat-e2e.py`): **45 PASS / 0 FAIL**, zero residue, FAKE-marked run-unique probes, service-role cleanup with row-count assertions, audit rows kept (§15.26).
> **Evidence levels:** `[LIVE]` real backend write through the real stack · `[READ]` read-only live probe · `[CODE]` source-traced · `[TEST]` pinned by the vitest suite.

---

## A. Executive assessment

**The chat between the CLIENTS (parents) and the WORKER (staff) is PROVEN functional end-to-end on the live backend** — 45 live checks, zero failures, both channel-creation directions, full message persistence, notification fan-out in both directions, RLS delivery with scope isolation, read receipts, and the complete negative-control set `[LIVE]`. The E2E models the `SupabaseChatRepository`'s exact REST shapes, so the proof covers the desktop's real code path, not just the raw API.

Two desktop defects were found and FIXED in the same session (CHAT-304, CHAT-305) with 11 regression tests; the battery moved 4,817 → **4,828 / 0 / 5** with zero regressions. The one owner-gated step to real usage remains **account provisioning**: 741 parents with ZERO portal accounts — the chat has no live users yet, but every mechanism it needs is now proven.

---

## B. Audit coverage

**Code surfaces traced:** `src/features/personnel/management/chat-panel.tsx` (the internal scope) + the CRM portal-chat surface, `src/features/dashboard/alert-detail-modal.tsx` (notification navigation), `src/features/crm/parent-detail-drawer.tsx` / `crm-page.tsx` (the portal conversation entry), `src/infrastructure/supabase/repositories/supabase-chat-repository.ts`, `src/shared/hooks/useUnreadCounts` (the fixed badge engine), the chat domain model, and the governing migrations (0010 chat tables, 0048 tightened inserts, 0051 read receipts, 0061 channel completion + touch trigger, 0067 parent-admin channel, 0075 message→notification fan-out, 0135 scope derivation, 0105 the worker-gate widening, 0136 attachment storage policies, 0092/0136 portal upload).

**Live probes executed** (`scripts/t499-portal-chat-e2e.py`): sections A–K = 45 checks. **Prior live evidence absorbed:** T-463 (scope separation), T-464 (attachments lifecycle), T-488 (DM recipient selection + "at least one receiver"), T-495/T-497 sessions.

---

## C. Feature inventory

| Feature | Status | Evidence |
|---|---|---|
| Conversations & message threads (internal + portal scopes) | **REAL** | `[LIVE]` T-499 + T-463 |
| Sending/receiving messages, both directions | **REAL** | `[LIVE D1–G4]` |
| Direct messages + recipient selection | **REAL** | `[LIVE C]` + T-488 (the DM modal, the "at least one receiver" fix) |
| Staff↔parent (portal) communication | **REAL** | `[LIVE C–H]` — ADR-012 |
| Conversation creation (both directions, deterministic convergence) | **REAL** | `[LIVE C/K]` — 0061 worker-side, 0067 client-side, SAME channel |
| Message persistence + history | **REAL** | `[LIVE D/E]` |
| Unread counts + badges | **REAL** (after CHAT-304) | `[TEST]` 6 regression pins |
| Read receipts (append-only guard) | **REAL** | `[LIVE H]` — 0051 |
| Message ordering | **REAL** | `[LIVE G]` |
| Notifications from new messages | **REAL** | `[LIVE D5/F]` — 0075 fan-out, both directions |
| Notification → conversation navigation | **REAL** (after CHAT-305) | `[TEST]` 5 regression pins |
| Attachments | **REAL** | T-464 + T-488/T-499 (bucket policies 0136) |
| Access control / scope isolation (portal vs internal) | **REAL** | `[LIVE I]` — 0135 + 0019/0048 policies |
| Realtime delivery | **PARTIAL** | subscription-based on channels/messages (0106 publication); notifications refetch-based |
| Search/filtering | NOT IMPLEMENTED | by design — not in the product requirements |

---

## D. Live verification results (the 45 checks, grouped)

- **A. Worker sign-in** — the owner-pinned admin credential; profile resolvable.
- **B. Probe client provisioning** — the T-464 pattern: GoTrue user (admin API) → the 0002 trigger auto-creates the profile + approval request → activation → the parent role (0023) → the probe `parents` row bound via `auth_user_id`.
- **C. The worker opens the channel** — `create_direct_channel` (0061) under the admin JWT: 200, **scope='portal' derived server-side (0135)**, members = admin + parent, **idempotent re-open returns the SAME channel**.
- **D. The worker sends a message** — the exact `sendMessage` insert shape (tenant_id, read_by self-seed, attachments jsonb): persisted; the **0061 touch trigger** fired (last_message_at + preview); the **0075 fan-out wrote exactly ONE notification targeting the client** (`link_entity_type='chat_channel'`), and none targeting the author.
- **E. The client sees it** — the parent signs in (password grant) and reads `chat_channels` + `chat_messages` under RLS: the channel and the message visible, correctly ordered.
- **F. The client replies** — the insert under the PARENT JWT (the 0048 member-check policy is the real gate): persisted; the fan-out now targets the ADMIN (the worker); the touch trigger advanced.
- **G. The worker sees the reply** — both messages, correct order, correct authorship.
- **H. Read receipts** — the client marks the admin's message read (the 0051 append-only `read_by` update, the repository's exact shape: existing entries re-sent byte-identical + one new entry); the admin's re-read shows the parent's profile in `read_by`.
- **I. Negative controls** — the client CANNOT create channels (the 0061 staff gate), CANNOT read a non-member channel (0019 select policy), CANNOT write into a non-member channel (0048 insert policy), and an anon key sees nothing.
- **J. Cleanup** — service-level deletes with row-count assertions (notifications, messages, channel, parents row, profile, role assignment, GoTrue user) + zero-residue post-checks; audit rows kept.
- **K. The client-side channel creation** — `open_parent_admin_channel` (0067) as the parent: **converges on the SAME channel** (the deterministic pair code) — both directions land in ONE conversation.

---

## E. Defects found and fixed (T-499)

| ID | Severity | Status | Finding → Fix |
|---|---|---|---|
| **CHAT-304** | Medium | **RESOLVED / TESTED** | The channel-list unread badge was the dead ternary `channel.lastMessageAt ? 0 : 0` — structurally zero for every unselected channel → replaced by `useUnreadCounts` (the per-channel message-stream subscription); badges render on every listed conversation, both scopes, and clear through the open→markRead→refresh loop; 6 regression pins |
| **CHAT-305** | Medium | **RESOLVED / TESTED** | Chat notifications had NO navigation (no `chat_channel` case in `AlertDetailModal`) → the reactive channel resolution + scope-aware routing (portal → the CRM deep link; internal → the NEW `/personnel?tab=chat&channelId=…` tab deep link); 5 regression pins |

Both fixes merged through branch `t-499-chat-audit` (5 focused commits, no-ff to main) with the battery re-run: **4,828 / 0 / 5** (+ exactly the 11 new tests).

---

## F. Honest data-state findings (live censuses)

- **741 parents, ZERO portal accounts** — the chat has no live parent users; account provisioning (activation codes / Settings → Comptes) is the owner-gated activation step.
- 18 personnel (now 20 with the two documented T-500 probe rows), 1 active, **0 account bindings** — the worker side is equally unprovisioned.
- The internal-scope chat (staff↔staff) shares the same verified machinery (T-463/T-488); the 0105 widening (worker/buyer/driver/warehouse_worker) is in place.

---

## G. Verification battery (T-499 closeout)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npm test` (unified) | **4,828 / 0 / 5 — the registered baseline move** (4,817 + exactly the 11 new T-499 tests) |
| Lint | 0 errors |
| Live E2E | **45 PASS / 0 FAIL** (`scripts/t499-portal-chat-e2e.py`) |

---

## H. Git / release status

Branch `t-499-chat-audit` → 5 focused commits → no-ff merge to `main` @ `19e58a0`. The delivery zip (`deliverables/AgentGithubUplaod-T499.zip`, 41 MB, manifest-verified) was built; the GitHub push — blocked during T-499 on the redacted PAT — **completed at the start of T-500** (`89315c0..19e58a0 main → main`). The original 11-page PDF report was delivered to `download/`; this Markdown edition is the archival form under `docs/audits/`.

---

## I. Outstanding items

1. **Account provisioning** (owner action): parents via activation codes; workers via Settings → Comptes — the only gate between the proven machinery and real usage.
2. **MEDIA-300** (portal chat attachments, parent-side) — remains the registered open item from the attachments family.
3. Chat notifications are refetch-based (no realtime on `notifications`) — the bell's freshness depends on the polling/refetch cycle (REALTIME-105 family).

**Statuses:** PASS (all 45 live checks) · FAIL (none) · PARTIAL (realtime notifications) · NOT TESTED (Electron UI interaction — source-traced + feature-tested).
