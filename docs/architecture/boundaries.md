# Architectural Boundaries

> What each layer/platform is responsible for — and what it must NOT be responsible for. These boundaries are derived from the audited code and migrations (evidence cited), not from aspiration. Where the current code violates its own boundary, the violating code is catalogued in `docs/recovery/problem-registry.md` and the boundary below describes the intended rule that the violations are measured against.

## 1. Backend (Supabase: PostgreSQL, SQL RPCs, Edge Functions, RLS, Realtime)

**Responsible for:**

- Authoritative business logic for every mutation: waterfall allocation, LIFO refund reversal, balance-affecting transitions, lifecycle transitions (pending → paid / bounced / refunded / cancelled).
- Validation that clients cannot be trusted to perform: proof requirements (`enforce_payment_proof` trigger), tenant isolation (RLS + tenant-scoped resolvers), terminal-state guards (no refund of `refunded`/`cancelled`), idempotency.
- Domain operations as atomic units: `collect_and_allocate_payment` writes payment + ledger + waterfall + parent_credit + audit **in one transaction**. This atomicity is the model every new RPC must follow.
- Database-level invariants: unique constraints (receipt numbers, `(tenant_id, parent_code)`, canonical attendance index), CHECK constraints, append-only audit semantics.
- The audit trail (`audit_logs`): every mutation MUST leave an audit entry with actor identity and reason (canonical §7.6 — see `docs/domain/financial-rules.md`).
- Sequential, server-authoritative numbering (receipt numbers, ADR-004).

**Must NOT:**

- Expose SECURITY DEFINER RPCs that trust caller-supplied identity parameters (`p_user_id`, `p_auth_user_id`, `p_tenant_id`) without verifying them (violations: SEC-106, SEC-110, SEC-111, SEC-112).
- Accept anonymous invocations for privileged operations (violation: SEC-105).
- Keep dead duplicate implementations callable (violations: legacy `promote_students` RPC — ACAD-100; dropped-function re-creation risks — REG-001).

## 2. Desktop (Electron staff application — `elimtiyaz-desktop/`)

**Responsible for:**

- Staff presentation and interaction: financials UI, CRM, academics, workforce.
- Calling canonical RPCs for every mutation; failing loudly when they are unavailable.
- The reference TypeScript engine (`src/domain/calc/`) — the executable specification mirrored by SQL and Kotlin; changes here must propagate through the equivalence suites to the mirrors.
- Client-side document generation (receipt PDF, bulletins) where no server storage requirement exists (UNKNOWN-004 pending).
- The Excel bridge: importing the legacy workbook through the sync queue into canonical tables.

**Must NOT:**

- Fall back to non-atomic write paths on RPC failure and report success (violation: BUSINESS-002).
- Re-implement server-side rules in ways that diverge (category default — BUSINESS-005; preview/actual mismatch).
- Keep repositories silently mock in "Supabase mode" without labelling them (violation: ARCH-001 — 26 slots still mock).
- Ship credentials, weaken the sandbox, or write audit entries that misreport actor/reason (violations: SEC-100, ARCH-002, BUSINESS-003).

## 3. Android (offline-first staff application)

**Responsible for:**

- Fully functional offline operation against its local Room store (reads + local mutations).
- Durable outbound mutation queue that replays through the **canonical** server path when connectivity returns (TARGET — ADR-005).
- Mirroring the canonical engines (Kotlin port) with verified equivalence — not inventing local variants of the rules.
- Push token registration lifecycle for the device.

**Must NOT:**

- Invent an alternative write path to the server (current violation: `upsert_payment_from_import` as the only payment path — CROSS-005/ARCH-003).
- Grant roles or sessions client-side (violations: SEC-101, SEC-102, WEAK-101).
- Generate identity codes or receipt numbers locally with non-canonical algorithms (violations: DRIFT-001, DRIFT-011).
- Swallow sync errors and report success (violation: CROSS-200).

## 4. Website (parent portal)

**Responsible for:**

- Parent-facing presentation of canonical data (balances, installments, attendance, homework, bulletins, notifications).
- The narrow set of parent-initiated writes: activation-code binding, absence-justification submission, notification read-state, FCM registration.
- Freshness via realtime hooks backed by a polling/window-focus fallback (TARGET for CACHE-100).

**Must NOT:**

- Perform financial writes (it is read-mostly by design).
- Ship authentication bypasses or mock identities (violation: SEC-007/DEAD-010/REG-003 — one consolidated defect).
- Duplicate server-side Edge Functions locally (violation: its own `bind-activation-code` copy — CROSS-009).
- Compute KPIs with non-canonical formulas (violations: WEAK-018, WEAK-019, WEAK-022).

## 5. Database schema layer (migrations)

- The canonical chain lives ONLY in this repository (ADR-001). Schema changes are NEW migrations with the next free number — applied migrations are immutable history.
- RLS policies enforce tenant isolation and per-table authorization; a policy that does nothing (e.g. `fn_current_tenant_id()`-based ones — DEAD-100) is a defect, not a safety net.
- Triggers enforce DB-level invariants (payment proof, tenant stamping, updated_at). Trigger-based tenant stamping must fail loudly on unresolvable context, never default to the DEMO tenant (violation: TENANT-105).

## 6. Cross-cutting rules

1. **One write path per business operation.** Adding a second path requires an ADR and retirement of the old one.
2. **Clients consume; the backend owns.** If a client needs a rule the backend doesn't expose, extend the backend (new RPC/EF), don't reimplement client-side.
3. **Mirrors must be verified.** Desktop TS (reference) ↔ SQL ↔ Kotlin ↔ website port: any behaviour change runs the equivalence suites (`docs/testing/cross-platform.md`) before merge.
4. **Every mutation is audited** with actor + reason server-side.
5. **Boundaries apply to tests too**: cross-platform equivalence tests compare platform OUTPUTS against the canonical engine — they do not bless client-side reimplementations.
