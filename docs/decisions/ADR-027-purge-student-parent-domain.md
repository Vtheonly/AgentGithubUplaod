# ADR-027 — The Canonical Student/Parent Domain Purge Contract

**Status:** PROPOSED → ACCEPTED (T-416, 100th session, 2026-09-26)
**Context:** GitHub issue #12 (the Purge Button) + the owner's session directive "make sure the purge does not interfere with the sync and backup processes" · supersedes nothing (the domain had no purge surface — PURGE-500)

## The decision

ONE server-canonical RPC — `public.purge_student_parent_domain(p_confirm_phrase text, p_dry_run boolean default true, p_tenant_id uuid default null) returns jsonb` (migration 0120) — is the ONLY purge path for the student/parent domain, called from ONE desktop surface (the Settings "Zone de danger" card). Per-row CRM deletion remains the 0100 soft-delete contract; this RPC is the tenant-wide **reset**, and nothing else.

## The scope semantics (what "full student/parent data reset" means)

**Purged (FK-safe order):** the financial closure (payment_allocations → payments → installments → invoices → ledger_entries → account_adjustments → receipts-if-present → discount_applications → service_enrollments) → the academic student data (grades, attendance_records, academic_history, student_academic_histories, student_documents — including the no-FK 0004 soft references) → the CRM core (activation_codes, parent_student_links, target-linked account_approval_requests, students, parents) → the portal/auth closure for the purged accounts (chat_messages + parent-member chat_channels, notifications, notification_preferences, device_tokens, calendar_events, sessions, role_assignments, user_profiles, auth.users) → the sync staging for the five domain entities (PURGE-501).

**Never touched (the no-interference contract, asserted by source guards + live probes):**

1. **The backup family** — `backup_archives`, `purge_expired_backups`, every backup RPC/EF. A backup taken before the purge remains a valid archive of the pre-purge state; restoring it is the documented T-300 offline-layer rehydration path (an owner decision, not the purge's).
2. **The sync infrastructure** — non-domain `sync_queue` rows, `mark_sync_queue_processed`, the idempotent push RPCs. The purge deletes ONLY the tenant's queue rows for `parent|student|payment|installment|ledger_entry` (the `StagedMutation.entity` set) — the resurrection hazard (PURGE-501) — and that deletion is part of the same atomic transaction as the business deletes.
3. **The audit journal** — `audit_logs` is append-only forensic evidence (§15.26, the T-408 purge precedent). The purge itself WRITES one `system.purge_student_parent_domain` entry with the per-table counts; it never deletes history.
4. **The academic catalog** — academic_years/levels, subjects, classes, class_subjects, filieres, subject_configurations, timetable_*, rooms (the fake-purge precedent's asserted-preserved list).
5. **The workforce/operations domains** — personnel*, salary_*, workforce_*, expense_*, suppliers, purchases, inventory_*, deliveries, pending_receipts (⚠ the OPERATIONS purchase-receipt table, NOT the financial receipts — a naming trap), releve_entries (personnel timesheet).
6. **Engine history** — workflow_runs/workflow_pending_resumes (operational audit of the automation engine, the §15.26 forensic precedent; their jsonb may dangle references to purged ids, documented here), ai_request_logs (token counts, no student payload), tasks.

**Boundaries:** the purge is tenant-wide (the issue's "full reset" — not per-student); the auth closure deletes `auth.users` only for accounts claimed by purged parent/student rows whose profile holds no staff role (a staff account is never caught in the blast radius — the role-assignment guard). **The approval-request boundary (refined by the 0121 amendment, PURGE-502):** an `account_approval_requests` row dies if and only if (a) it is target-linked to a purged parent/student, OR (b) its `auth_user_id` belongs to an auth account the purge is deleting — the GoTrue trigger creates requests keyed by `auth_user_id` with no target, and 0044's admin-create path resolves them without ever linking a target, so a purge that deleted the account but kept the request would orphan it against a deleted account (the exact inconsistency the issue forbids). A pending signup whose account is NOT claimed by any parent/student row keeps BOTH its account and its request (`v_auth_ids` only ever contains claimed accounts — genuinely pre-parent data stays outside the blast radius).

## The safety model (the issue's "cannot be triggered accidentally")

1. **Server-side:** super_admin role gate (the 0100 house pattern) OR a DB-superuser console session (the Management-API SQL path — already the platform's highest privilege; the function gives it the SAFE, audited route instead of ad-hoc SQL); tenant resolution `coalesce(p_tenant_id, current_tenant_id())` with an explicit `tenant_unresolved`/`invalid_tenant` failure (never a null-tenant match-everything); **typed confirmation phrase `PURGER`** required for execute mode (anything else → `confirmation_required`, nothing deleted); **dry-run is the default** (`p_dry_run` true → counts only, zero deletes); one append-only audit entry per successful execution.
2. **Client-side:** the card is visible only to super_admin and only in Supabase mode (mock mode has no server data — honest disabled state); the execute button is disabled until the phrase is typed exactly; a ConfirmModal recaps the dry-run counts before the final call; the result panel shows the server's per-table counts.

## The live-0118 reconciliation (PURGE-500)

The unregistered live migration `0118 / purge_student_parent_domain` may have created a function under this name with an unknown signature. Migration 0120 therefore FIRST drops EVERY `pg_proc` overload of `public.purge_student_parent_domain` before creating the canonical one — `create or replace` alone would silently ADD a second signature (the §57 42702 ambiguity class that killed the backup purge RPC live).

## The verification model (the owner's no-interference mandate, evidence over assertion)

1. **Local:** the SQL source-guard suite (delete ORDER, the gates, the never-touched assertions, the overload-drop, the receipts existence-guard) + the UI + repository suites; the FULL vitest/tsc/eslint gates against the documented baselines.
2. **Live, rollback-safe:** the transactional sandbox — BEGIN; seed FAKE-marked probes under the real tenant; execute the REAL RPC; assert zero residue across every family AND the no-interference invariants (backup_archives count unchanged, a non-domain sync_queue probe survives and still drains through `mark_sync_queue_processed`, the purge audit entry exists, `purge_expired_backups` still callable); ROLLBACK — the real data (196 parents / 290 students at the 99th-session census) is never touched. Plus the admin-JWT PostgREST dry-run (the exact path the UI takes).
3. **The VERIFIED gate:** the owner executes the real purge from the packaged app when they choose — the standing visual-acceptance convention (the purge is by design irreversible; it is never "tested" against real data by an agent).

## The live-verification record (2026-09-26, the 100th session — supersedes the plan above with evidence)

The live legs ran (`scripts/t-416-purge-live-verification.mjs`): migrations **0120 + 0121** applied and registered on `vebfehrpzajhstyhinnw`; the transactional sandbox **22/22 GREEN, 12/12 asserts** — 20 FAKE probes seeded through the platform's real triggers under the real admin claims, the wrong-phrase gate refused, the dry-run counted 711 (691 real + 20 probes) deleting nothing, EXECUTE purged every family including the PURGE-502 approval closure, a non-domain sync_queue probe and a backup_archives probe SURVIVED, and the marker-exception rollback restored the real 196/290 census with the audit count unchanged. The authenticated PostgREST path returned the exact 691-row dry-run census, idempotently, and refused the wrong phrase. The run CAUGHT two real defects pre-ship (PURGE-502 the orphaned approval request; PURGE-503 the `jsonb_object_length` audit-note landmine that would have killed every real EXECUTE) — both fixed by 0121, both pinned by source guards. Full record: `docs/recovery/t-416-live-verification.md`.

## Consequences

- The desktop gains its first whole-domain destructive surface; the Settings danger-zone card is the single entry point (no repository, script, or EF may call the execute mode outside the owner's action or a rollback-wrapped verification).
- The sync drain after a purge sees an empty domain queue and non-domain work continuing — the documented interference contract (nothing to reconcile, nothing resurrects).
- A pre-purge backup remains the ONLY recovery path for purged data (by design — the reset is the point); the owner should take a manual backup before executing (the UI card says so).
