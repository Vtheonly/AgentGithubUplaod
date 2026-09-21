# Source of Truth Registry

> Authoritative implementation for every important domain concept. **Consult this before implementing or changing any business functionality.** Entries marked `UNKNOWN` are unresolved — see `docs/recovery/unknowns.md`; do not guess them into a decision.
>
> Legend: ⭐ = canonical (authoritative). ⚠ = drifted/dangerous duplicate. ✝ = dead/unreachable. Repo abbreviations: **D** = AgentGithubUplaod (`elimtiyaz-desktop/`), **A** = elimtiyaz-android, **W** = elimtiyaz-website, **DB** = Supabase schema/RPC (defined in D).

## Registry

| Concept | Source of Truth ⭐ | Repository/Path | Consumers | Notes |
|---|---|---|---|---|
| **Tenants / multi-tenancy** | `tenants` table + `current_tenant_id()` (auth.uid-based) | DB, migrations 0002/0003 | All clients, every RLS policy | `current_user_roles()`/`current_user_permissions()` ignore tenant (TENANT-100). Single demo tenant `00000000-…-0001` is the production tenant (seed 0023). |
| **Users & profiles** | `user_profiles` table | DB, migration 0002 | Desktop, Website auth | Global admins (`tenant_id IS NULL`) unsupported by desktop client (TENANT-103). |
| **Authentication (staff)** | Supabase Auth (email/password) + `current_user_roles`/`current_user_permissions` RPCs | DB | Desktop login, EFs | Android bypasses with offline fallback + email role inference (SEC-101/102). EF permission checks broken for non-super_admin (SEC-109). |
| **Authentication (parents)** | Supabase Auth + Google OAuth | DB | Website (primary), desktop | Website still wires a mock-admin bypass (SEC-007). |
| **Authorization / RBAC** | `role_assignments` + `has_role()` / `has_any_role()` + `Permission` matrix (desktop `src/core/`) | DB + D | All clients | Role resolver is tenant-blind (TENANT-100); approval EF allows role escalation (SEC-107). |
| **Parents (CRM)** | `parents` table; canonical write path = `upsert_parent_from_import` RPC with deterministic `parent_code` | DB (0005, 0027); D repo | Desktop CRM, website profile, Android | ⚠ EF `approve-signup-request` inserts parents directly with random codes (DRIFT-001). Parent-student link is single FK `students.parent_id`. |
| **Students (CRM)** | `students` table; canonical code = deterministic `ELV-…` (desktop `deterministicStudentCode` semantics) | DB (0005); D `src/core/format/id.ts`; A `IdentityCodes.kt` | All clients | ⚠ Android generates sequential codes locally (DRIFT-001/DEAD-005). |
| **Identity codes (PAR-/ELV-/activation)** | Deterministic FNV-1a generators | D `src/core/format/id.ts` (`deterministicParentCode`, `deterministicActivationCode`); A `IdentityCodes.kt` | Parent/student creation, activation | ADR-003. ⚠ 5+ paths still random (DRIFT-001). Activation codes in DB use `random()` 7-digit (WEAK-100). |
| **Installments (tranches)** | `installments` table | DB (0007 + 0026/0027) | Financial engine, all clients | `amount_due/amount_paid/amount_pending` are the authoritative columns. |
| **Payments (mutation)** | SQL RPC `collect_and_allocate_payment` | DB, migration 0040 | Desktop (direct RPC) | ⭐ atomic: payment+ledger+waterfall+parent_credit+audit+receipt#. Android does NOT use it (CROSS-005). ⚠ Desktop has silent fallback to `upsert_payment_from_import` (BUSINESS-002). Payment EFs never invoked (DEAD-016). |
| **Payments (bulk import)** | SQL RPC `upsert_payment_from_import` | DB, migration 0027 | Excel importer, Android sync push | Non-atomic, SECURITY DEFINER (SEC-111), no waterfall/ledger/audit. Import-only by design. ⚠ Android uses it as its only payment write path. |
| **Refunds** | SQL RPC `revert_payment_allocation` (LIFO reversal) | DB, migration 0041 | Desktop repo layer (no UI — DEAD-015) | Missing tenant check (SEC-112). Android's local refund is non-idempotent and sync-incomplete (BUSINESS-102, CROSS-102/103). Canonical rule: refunds are compensating entries; `refunded` and `cancelled` are terminal states. |
| **Balances** | Ledger replay — never stored. Desktop `computeParentSummary` (TS) = SQL `compute_parent_summary` (0042) = reference | D `src/domain/calc/ledger/balance.ts`; DB; A `LedgerEngine.kt`; W `src/lib/canonical/` | Debt dashboard, portal KPIs, Android dashboards | ⚠ Website replays only first 500 ledger rows (WEAK-022). Android overdue map never passed (WEAK-007). |
| **Waterfall allocation** | SQL (inside `collect_and_allocate_payment`); reference TS `allocatePaymentToInstallments` | DB 0040; D `src/domain/calc/payment/waterfall-allocator.ts` | Payments, portals | Category filter: `NULL` = all categories (canonical); ⚠ desktop direct path defaults to `"tuition"` (BUSINESS-005/DRIFT-004 absorbed in DEAD-016). |
| **Overdue rule (INV-4)** | Desktop `computeParentSummary` (named canonical by migration 0042): overdue ⇔ balance > 0.001 DZD AND latestCharge.at < now AND overdueDueDate < now | D `src/domain/calc/ledger/balance.ts`; SQL `compute_parent_summary` (0042) | Debt dashboards, lock-delinquent actions | ⚠ Android uses 1 DZD threshold + wrong date basis (DRIFT-006, BUSINESS-007) and never passes the due-date map (WEAK-007). |
| **Discounts** | `evaluateAllSystemDiscounts` (5 rules incl. `passage_palier`, `highest_average`, `sibling_fixed`) | D `src/domain/calc/pricing/discount-engine.ts`; DB pricing tables (0006) | Registration, billing | ⚠ Batch registration passes null for 2 rule inputs (WEAK-005); Android skips 4 of 5 rules. |
| **Receipt numbers** | Server-side sequential `REC-YYYY-NNNNNN` inside `collect_and_allocate_payment` | DB, migration 0040 | Receipt display, audit | ADR-004. ⚠ 4 client-side algorithms coexist (DRIFT-011). |
| **Receipt documents (PDF)** | Desktop client-side generation (`pdf-lib`) | D `SupabasePaymentRepository.generateReceipt` | Desktop downloads | The `receipts` DB table is orphaned/never written; website receipt download permanently broken (CROSS-101, blocked on UNKNOWN-004). |
| **Reconciliation** | Desktop `reconcileFinancials()` (currently 4 of 6 canonical cross-checks) | D `src/domain/calc/reconcile/reconciliation.ts` | Desktop reconcile action | BUSINESS-001: missing `crossCheckBalanceSum` + `crossCheckParentCredit`. Canonical = 6 checks (INV-9). |
| **Ledger / audit trail** | `ledger_entries` table; `audit_logs` table + `write_audit_log` RPC | DB (0007, 0014) | All clients, EFs | EF audit writes swallow failures (SEC-001); several paths write no audit at all (BUSINESS-101, PARENT-103 absorbed in SEC-110). |
| **Academic years** | `academic_years` table (`is_current` singleton per tenant) | DB (0004/0029) | All clients | ⚠ `setCurrentYear` is a non-atomic 2-step update (ACAD-101); desktop cache never refreshes (CROSS-104). |
| **Classes / subjects / class_subjects** | `class_subjects` table | DB (0004) | Desktop academics, website | Single `teacher_id` per (class, subject) — co-teaching unsupported (ACAD-102, deferred). |
| **Homework** | `homework` table | DB, migration 0029 | Website `useHomeworkForClass` | ⚠ Legacy `homework_assignments` (0004) is dead but still in schema + website realtime subscription (WEAK-016). Desktop/Android pushes are broken (HOMEWORK-100/101). |
| **Attendance records** | `attendance_records` table; canonical write = `upsert_attendance_from_import` RPC (0041) | DB | Android (works), website display | Desktop direct upsert triple-broken (ATT-100). Justification workflow: parents submit, no staff review (ATT-101). |
| **Attendance rate** | `(present + late) / total` — canonical fn `calculateAttendanceRate` | D `src/domain/model/academic.ts:279`; W `portal-derive.ts` | Dashboards, bulletins, narratives | ⚠ 3 views use `present/total` instead (WEAK-019 family). |
| **Assessments / grades** | `assessments` + `grades` tables; `upsert_grade_from_import`/`upsert_assessment_from_import` RPCs | DB (0029, 0041) | Desktop academics, Android, website bulletin | `set_assessments_tenant` trigger falls back to DEMO tenant (TENANT-105 absorbed in DEAD-100). |
| **GPA / subject averages** | `computeOverallGpa`, `computeSubjectAverage` (desktop canonical) | D `src/domain/calc/`; W `src/lib/canonical/` (port) | Bulletins, portal | Website port verified equivalent for these functions. |
| **Promotion (year-end)** | `students.grade_level_code` update + `student_academic_histories` (canonical, 0029) | DB; D `SupabasePromotionRepository` | Desktop promotion flow | ⚠ Table RLS inert → desktop promotion fails (TENANT-106); Android sync drops the grade change (STUDENT-100); dead SQL `promote_students` RPC writes legacy table (ACAD-100). |
| **Bulletins (report cards)** | Website `bulletin.ts` (client-side PDF) | W `src/lib/bulletin.ts` | Parent portal | ⚠ "Présences" KPI shows raw present count (WEAK-019 family). |
| **Notifications** | `notifications` table (3 targeting modes: user / role-broadcast / tenant-broadcast) | DB (0013) | All clients | Role-broadcasts can't be marked read (NOTIF-100, blocked); insert policy allows spam (NOTIF-101). |
| **Push notifications** | `send-push-notification` EF (website repo) + `device_tokens` + `register_fcm_token` RPC | W `supabase/functions/`; DB (0027) | — (nothing invokes it) | ✝ Entire pipeline non-functional: never invoked, internally broken, opt-in only (PUSH-100 family). |
| **Chat** | `chat_channels` / `chat_messages` tables | DB (0010, RLS 0019) | Website MessagesView (reads only) | ✝ No production code creates channels; desktop chat is mock-only (CHAT-103). Product scope unknown (UNKNOWN-005). |
| **Email** | `approve-signup-request` EF (Resend, conditional) | D `supabase/functions/` | Approval flow | Workflow `send_email` action is a stub (PUSH-104). |
| **LLM / AI features** | `ai-proxy` EF → Groq/OpenRouter | D `supabase/functions/ai-proxy`; D `src/infrastructure/ai/llm-adapter.ts` | Desktop narrative generator etc. | ⚠ BYOK fallback can leak unmasked PII (SEC-002). |
| **Synchronization (desktop)** | `SyncService` + IndexedDB queue + `defaultPushHandler` → `upsert_*_from_import` RPCs | D `src/infrastructure/sync/`, `src/app/providers/sync-provider.tsx` | Excel import path | Handles 4/15 entity kinds; queue is process-global (SYNC-100/101/102). |
| **Synchronization (Android)** | Room + `SyncSupport` → sync queue → `SyncQueueDispatcher` → `upsert_*_from_import`; `PullSyncRepository.pullAll` | A `infrastructure/sync/` | All Android writes | ⚠ Dispatcher swallows errors (CROSS-200); target architecture = canonical RPCs (ADR-005, UNKNOWN-002). |
| **Freshness (website)** | TanStack Query + realtime hooks | W `src/app/providers/`, `src/lib/hooks/use-realtime.ts` | Portal | 2 of 4 hooks broken; no polling fallback (CACHE-100). |
| **Excel bridge (legacy import)** | Desktop import engine → sync queue → `upsert_*_from_import` | D `src/infrastructure/excel/` | Initial data migration from workbook | Legacy workbook `Suivis clients 2026_2027.xlsx` is the historical source, not a live source of truth. |
| **Timetable** | DB: `timetable_configurations`/`timetable_constraints`/`timetable_versions`/`timetable_entries`/`rooms` (0109/0110) + `fn_timetable_publish` | D canonical model `model/timetable.ts` + validator `calc/timetable/constraints.ts` + native solver `ts-greedy-v1` (ADR-020); Supabase `SupabaseTimetableRepository` | — | ✅ Implemented + TESTED (T-404, 2026-09-22); the legacy mock façade in teacher.ts is superseded — do not extend (SCHED-100 residual). |
| **Multi-guardian families** | NONE — `parent_student_links` table exists, zero writers | DB (0005) | — | ✝ (DEAD-200, UNKNOWN-010). |

## How to use this registry

1. Find the concept; go to the canonical implementation FIRST.
2. Anything marked ⚠ is a known divergent duplicate — do not copy it, and do not extend it without checking the problem-registry entry.
3. Anything marked ✝ is dead — do not build on it.
4. If a concept is missing or marked UNKNOWN, the correct next action is investigation + an entry in `docs/recovery/unknowns.md` — never a new parallel implementation.
## Required additions — Academic classification and promotion

| Concept | Source of Truth | Required consumers | Architectural rule |
|---|---|---|---|
| **Niveau → Filière → Spécialité → Classe/Section** | Canonical academic DB/domain model to be established by T-401 | Desktop, Android, Website, class formation, CRM, statistics, search, import/export | One model and one validation contract; no page-local classification enums or mapping tables |
| **Batch promotion** | students.grade_level_code + student_academic_histories | Desktop promotion, Android sync, class formation, CRM, student details, statistics, academic history | One atomic promotion write path; legacy academic_history / promote_students remains dead and must not be revived |

T-401 must establish the canonical classification source before downstream UI integration is considered complete. T-402 must make promotion consume and publish that same model.

---

### Batch Promotion Cycle contract

**Promotion Cycle** is the workflow-level source of truth for coordinating a source academic year into a target academic year. It does not replace the canonical promotion domain model.

- Cycle = one source → target academic-year operation.
- Group/class = the human-review unit inside the cycle.
- Student decision = promoted/repeating/deferred/other established outcome.
- Class confirmation = atomic commit of that group's decisions.
- Cycle completion = verified completion of all required groups, with exceptions explicitly resolved.
- All UI surfaces consume the same canonical promotion domain/database contract.


### Automatic timetable contract

Automatic Timetable / Emploi du temps is a canonical generated scheduling domain, not a page-local calendar.

- Canonical inputs: academic year, canonical academic classification, classes/groups, subjects/modules, teachers, rooms, periods, curriculum hour/session requirements, availability, and hard/soft constraints.
- Canonical output: versioned timetable assignments of class/group, subject, teacher, room, day, and period/session with validation and audit metadata.
- Solver implementation is behind a TypeScript adapter; solver-specific representations are not the application source of truth.
- The dedicated Timetable/Emploi du temps UI is a consumer/view of the canonical generated schedule.
- Class, teacher, and room views must not create separate schedule records or scheduling algorithms.
- Packaged Electron generation must use the bundled solver artifact rather than developer PATH/runtime dependencies.


### Cross-Year Debt Aging and Payment Behavior

Debt status is derived from the canonical financial obligations, payment records, payment allocations, due dates, and academic-year history.

The canonical analysis preserves the original obligation year and due date while also considering subsequent-year payment activity and inactivity. An old debt is not, by itself, proof of prolonged non-payment.

Green/Yellow/Orange/Red are presentation states of one documented financial-status calculation. No page may invent its own thresholds or status logic.

**Implemented topology (T-405, 2026-09-22 — VERIFIED, financial-rules §15):**

| Concept | Source of Truth | Consumers |
|---|---|---|
| **Debt-aging status calculation** | Desktop `src/domain/calc/ledger/debt-aging.ts` (`computeDebtAgingAnalysis`/`computeDebtAgingStatus`) — the reference; SQL mirror `compute_debt_aging_rows`/`compute_debt_aging_summary` (migration 0111); website port `src/lib/canonical/calc/ledger/debt-aging.ts` (sha-pinned) | The desktop « Suivi des Dettes » tab; the portal's DebtAgingStatusCard; dashboards/statistics/exports via the RPC; future Android mirror |
| **Debt-aging outstanding** | Σ `GREATEST(0, amount_due − amount_paid − amount_pending)` over unpaid REAL installment rows — the SAME Créances-tab basis (INV-4 family) | Every T-405 surface |
| **Academic-year attribution (INV-14)** | `attribute_academic_year(date, tenant)` (0111) / `resolveAcademicYearForDate` (TS) — academic_years window first, Jul1–Jun30 Algerian convention fallback | Origin-year + subsequent-year-payment classification |
| **Payment behavior** | Non-reversed `entry_type='payment'` ledger entries (the `computeParentSummary` replay source) | Last payment, inactivity, subsequent-year activity |

The staff query contract is the 0111 RPC `compute_debt_aging_summary` (gated: super_admin/financial_officer/support_staff + current tenant; anon revoked per §15.34). `mv_debt_aging` carries the extended payment-behavior columns for server-side analytics (its pre-existing ledger-basis columns are unchanged and documented as a distinct basis).
