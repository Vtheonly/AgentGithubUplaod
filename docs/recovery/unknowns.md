# Unknowns — Open Questions Registry

> Questions that cannot currently be answered with sufficient evidence. **No agent may silently turn an unknown into an assumption** — that is how this codebase accumulated much of its drift. Each unknown lists what is needed to resolve it and what it blocks. When an unknown is resolved, record the decision (as an ADR if architectural) and update the blocked problems/tasks.

## UNKNOWN-001 — Does binding an activation code activate the user account?

- **Question:** The website's `bind-activation-code` EF sets `user_profiles.status='active'` + grants the parent role after binding; the desktop's canonical version does neither (activation is a separate admin step). Which is the intended contract?
- **Evidence:** Website EF `index.ts:174-205` activates; desktop EF `index.ts:78-133` does not; SQL RPC `bind_activation_code` (0005) only binds `parents.auth_user_id`. They cannot both be right. (Problems CROSS-009, BUSINESS-008, SEC-104.)
- **Why it matters:** whichever EF is deployed determines whether parents can self-activate or wait for staff; consolidating the two EFs is impossible until this is decided.
- **Affected components:** both bind-activation-code EFs, parent onboarding (Path A), `approve_account_request` flow.
- **Blocked:** T-028 (EF consolidation), part of SEC-110's activation side-effects.
- **Required to resolve:** business owner decision (product semantics), then an ADR.

## UNKNOWN-002 — What is the Android target write architecture?

- **Question:** Should Android mutate the server through the canonical RPCs (online direct, offline queued replay) as ADR-005 proposes, or keep the Room-first + `upsert_*_from_import` design with the import RPCs upgraded to parity?
- **Evidence:** current architecture bypasses all canonical financial RPCs (ARCH-003/CROSS-005) with silent server-side gaps (CROSS-102/103, BUSINESS-102). ADR-005 exists but is Proposed — not owner-confirmed.
- **Why it matters:** it is the single largest architectural decision left; it determines whether Android financial writes ever gain server-side validation/audit and which Room layer survives.
- **Affected components:** Android repository bindings, sync dispatcher, Room layers; canonical RPC contract.
- **Blocked:** T-045 (Room consolidation), T-059 (Android canonical writes), parts of T-038/T-069 scheduling.
- **Required to resolve:** owner sign-off on ADR-005 (or an explicit alternative decision + new ADR).

## UNKNOWN-003 — Are the payment Edge Functions the canonical gateway or dead code?

- **Question:** `collect-payment` and `refund-payment` EFs contain JWT/permission/validation/audit logic but no client ever calls them (DEAD-016). Gateway (wire clients to them) or remove (direct SQL RPC is the contract)?
- **Evidence:** zero invocation sites across all three repos; clients call SQL RPCs directly; the EFs' absorbed latent defects (WEAK-001/002, DRIFT-002/004) were never triggered.
- **Why it matters:** if they are the gateway, their defects become live and must be fixed; if removed, RLS+triggers alone carry the invariants and the security posture must be reviewed.
- **Affected components:** both EFs, desktop/Android payment write paths.
- **Blocked:** T-067.
- **Required to resolve:** owner decision; interacts with ADR-005.

## UNKNOWN-004 — Do parents need server-stored downloadable receipts?

- **Question:** The `receipts` table + storage bucket are orphaned (no writer since migration 0034 dropped the old `collect_payment`); the website's Receipts tab is permanently empty. Restore server-side receipt persistence, or remove the table and keep desktop client-side PDFs?
- **Evidence:** CROSS-101 (table created 0007, written until 0034, empty since; website `useReceiptsForPayment` queries a table nothing writes).
- **Why it matters:** either parents get self-service receipt downloads (feature work) or a dead table + broken UI ships (current state).
- **Affected components:** `receipts` table, website Receipts tab, desktop generateReceipt.
- **Blocked:** T-066.
- **Required to resolve:** product decision (support/audit requirements for receipt re-download).

## ~~UNKNOWN-005 — What is the chat product scope?~~ RESOLVED 2026-08-31

- **Question:** Is staff↔parent/staff↔staff chat a committed feature? No production code creates `chat_channels`; the desktop chat is an in-memory mock; the website MessagesView is permanently empty.
- **Evidence:** CHAT-103 (zero channel writers), CHAT-105 (mock chat), CHAT-104 (no last-message sorting).
- **Resolution (14th session):** the owner instructed "fix and test the chat in all platforms" —
  chat IS a committed feature. Channel creation is staff-only; the parent portal is read+reply.
  Recorded as **ADR-008** (accepted). Implementation: migration 0061 (backend completion +
  canonical `create_direct_channel` RPC), T-099 (desktop SupabaseChatRepository), T-100
  (staff↔parent entry point), T-101 (portal readiness). T-037's "if built" branch is operative.
- **Unblocked:** T-037 (implementation portion), CHAT-104. NEW scope gap documented: Android has
  no chat UI at all (task T-102 tracks it).

## UNKNOWN-006 — Is multi-tenancy a real production requirement?

- **Question:** Will more than one school (tenant) ever share a deployment? Today a single DEMO tenant (`00000000-…-0001`) is the production tenant for El-Imtiyaz Boumerdès.
- **Evidence:** the schema is multi-tenant by design (tenants, tenant_id everywhere, per-tenant roles), but the resolver/policy defects (TENANT-100/101/102) show the model was never exercised beyond one tenant.
- **Why it matters:** determines the real-world severity of all TENANT-* findings and how much hardening investment is justified.
- **Affected components:** RBAC resolver, RLS policies, tenant enumeration.
- **Blocked:** nothing hard-blocked; affects prioritisation of T-005/T-053 and acceptance criteria.
- **Required to resolve:** owner statement of deployment intent.

## UNKNOWN-007 — How should role-broadcast notification read-state work?

- **Question:** `notifications.is_read` is a single flag, but role-broadcasts target many recipients. Introduce a per-recipient read table (e.g. `notification_reads`), or accept broadcasts as read-only/undismissible?
- **Evidence:** NOTIF-100 (RLS blocks recipients from marking broadcasts read — bulk mark-read silently no-ops), NOTIF-104 (Android read-state is local-only).
- **Why it matters:** current behaviour makes the bell badge permanently non-zero and trains users to ignore notifications.
- **Affected components:** notifications table/RLS, all three bell implementations.
- **Blocked:** T-038; influences T-032's notifications filter portion.
- **Required to resolve:** product decision + schema design.

## UNKNOWN-008 — What activation-code format and rate-limit policy is acceptable?

- **Question:** Codes are 7 digits from non-crypto `random()` (10M space, brute-forceable, no rate limit). A stronger format (longer, alphanumeric, CSPRNG) trades off human readability (parents type these). What is the requirement?
- **Evidence:** WEAK-100; migration 0005 `generate_activation_code`; website activation screen without rate limiting.
- **Why it matters:** combined with SEC-110 (now fixed via T-006) brute-force enabled account takeover; even with caller verification, code enumeration remains possible.
- **Affected components:** activation code generation, binding endpoint.
- **Blocked:** T-072.
- **Required to resolve:** product/security decision (format, attempt limits, lockout).

## UNKNOWN-009 — Are demo accounts intended for production builds?

- **Question:** Desktop ships 9 quick-fill staff accounts; Android ships a divergent set with one shared password. Dev convenience or product feature (e.g. for sales demos)?
- **Evidence:** SEC-100, CROSS-100.
- **Why it matters:** determines the end-state of T-001 (delete vs dev-gate) and whether credentials must be rotated everywhere.
- **Affected components:** both login screens.
- **Blocked:** final policy of T-001 (the security fix itself is unblocked).
- **Required to resolve:** owner decision.

## UNKNOWN-010 — Is the multi-guardian family feature required?

- **Question:** `parent_student_links` exists (schema + RLS) with zero writers; every student has exactly one `parent_id`. Does the school need both parents / guardians to have portal access?
- **Evidence:** DEAD-200.
- **Why it matters:** divorced/shared-custody families currently cannot both see their child's data; sibling-discount logic may miss half-siblings.
- **Affected components:** parent-student linkage, portal auth, discount engine.
- **Blocked:** T-070.
- **Required to resolve:** product decision.

## UNKNOWN-011 — Timetable: complete the feature or remove it?

- **Question:** The desktop has a full timetable domain model + mock CRUD + conflict detection and a UI KPI, but no table, no repository, no migration. Build it or delete the façade?
- **Evidence:** SCHED-100, SCHED-101 (conflict detection misses room clashes).
- **Why it matters:** the "Couverture EDT" KPI permanently shows 0% in production mode; users may believe timetables are managed.
- **Affected components:** desktop academics module.
- **Blocked:** T-042.
- **Required to resolve:** product decision.

---

## Resolved unknowns

- **UNKNOWN-005 (chat product scope)** — resolved 2026-08-31, 14th session: chat is a committed
  cross-platform feature (owner instruction). Decision recorded in ADR-008; backend migration
  0061 applied live (verify_t-098 15/15); desktop T-099/T-100 and website T-101 landed.
  Unblocked T-037; spawned T-102 (Android chat UI scope gap).
