# T-416 — Live Verification Record (issue #12: the Purge Button — the student/parent domain reset)

**Session:** 100th (2026-09-26) · **Task:** T-416 · **Live project:** `vebfehrpzajhstyhinnw` (eu-west-1)
**Script:** `elimtiyaz-desktop/scripts/t-416-purge-live-verification.mjs` (rollback-safe transactional sandbox — the real 196 parents / 290 students are NEVER touched)
**Migrations applied live this session:** `0120_purge_student_parent_domain.sql` (the canonical RPC) + `0121_purge_approval_request_orphan_closure.sql` (the PURGE-502 amendment + the audit-note fix)
**Final run:** 22/22 GREEN · sandbox 12/12 asserts GREEN · zero residue · audit count unchanged (1088 → 1088)

## 1. The owner's gate, and how it was proven

The session directive: **"Do testing and make sure the purge does not interfere with the sync and backup processes."** The no-interference contract was proven at FOUR layers: source guards (the migration FILE cannot reach the backup/sync infrastructure — 43 assertions), the transactional sandbox (a non-domain `sync_queue` probe and a `backup_archives` probe seeded under the real tenant SURVIVE the purge while every domain row dies), the aftermath census (the sync/backup RPCs present; `backup_archives` count invariant 0→0), and the PostgREST gate census (the service-role caller is REFUSED by Gate 1 — only a signed-in super_admin human or a DB-superuser console may purge).

## 2. The verification matrix — 22/22 GREEN

### PHASE 0 — preflight (the live-schema authority, §57c)

| # | Check | Result |
|---|-------|--------|
| P0.1 | Registry head | ✅ 0121 / 0120 / 0119 / 0118 / 0117 … |
| P0.2 | The unregistered live 0118 present (the PURGE-500 context) | ✅ in the live registry, reconciled by 0120 |
| P0.3 | The chain-tail state known | ✅ 0120 + 0121 both registered |
| P0.4 | Domain baseline captured | ✅ parents=196, students=290, payments=3, installments=3, backup_archives=0, sync_queue=0, audit_logs=1088 |

### PHASE 1 — the chain tail applied atomically (the T-091 registrations)

| # | Check | Result |
|---|-------|--------|
| P1.1 | Apply 0120 + 0121 (each in one begin/commit; already-registered files skipped idempotently) | ✅ 0120 applied run 1; 0121 applied run 2 (re-applied with the audit-note fix run 7 — pre-commit, same session) |
| P1.2 | Registry rows 0120 + 0121 | ✅ both, correct names |
| P1.3 | Exactly ONE canonical overload remains (the live-0118 reconciliation) | ✅ `purge_student_parent_domain(text,boolean,uuid)` — the pre-existing `(text,boolean)` overload was dropped by 0120 |
| P1.4 | The live body carries the PURGE-502 amendment | ✅ `pg_get_functiondef`: the auth-keyed approval predicate present |

### PHASE 2 — the transactional sandbox (EXECUTE-mode evidence, zero residue)

The sandbox seeds 20 FAKE-marked probe rows (§15.50) under the real tenant inside `begin; … rollback;`, runs the REAL RPC in all three modes, asserts the full dependency graph + the no-interference invariants, then RAISES a marker exception — the aborted transaction rolls EVERYTHING back (the audit entry included).

| # | Check | Result |
|---|-------|--------|
| P2.0 | The admin claims installed (the exact `request.jwt.claims` GUC PostgREST sets) | ✅ admin@elimtiyaz.dz — the probes run under the real super_admin authorization |
| P2.1 | The sandbox verdict (12 asserts) | ✅ GREEN — see the breakdown below |
| P2.2 | Rollback restored the real data | ✅ parents 196→196, students 290→290 |
| P2.3 | Zero probe residue | ✅ fake_backups=0, fake_sync=0, fake_parents=0 |
| P2.4 | audit_logs count unchanged (the sandbox's own entries rolled back) | ✅ 1088→1088 |

**The 12 sandbox asserts:** the wrong-phrase gate (`confirmation_required`, nothing deleted) · the dry-run (total **711** = 691 real + 20 probes, zero deletes) · EXECUTE (per-family delete counts: parents 197, students 291, payments 4, installments 4, invoices 1, auth_users 1, user_profiles 1, chat 1/1, notifications 1, activation 1, links 1, documents 1, service_enrollments 1, allocations 1, ledger 1, calendar 1, approval_requests 1 — every real + probe row of the tenant's domain) · zero residue across ALL seeded families · the portal/auth closure (the trigger-created profile + role assignment + the auth user all gone) · **the PURGE-502 closure** (the trigger-created approval request, keyed by auth_user_id with target_parent_id NULL, dies WITH the account — no orphan) · the non-domain sync_queue probe SURVIVES · the domain sync_queue probe is purged (PURGE-501) · the backup_archives probe SURVIVES · the purge audit entry written.

### PHASE 3 — the exact UI path (GoTrue password grant → PostgREST rpc)

| # | Check | Result |
|---|-------|--------|
| P3.1 | Admin sign-in | ✅ admin@elimtiyaz.dz authenticated |
| P3.2 | The dry-run verdict through the authenticated path | ✅ total=691, every family counted |
| P3.3 | The verdict counts the REAL domain (== the baseline census) | ✅ parents=196/196, students=290/290 |
| P3.4 | The dry-run is idempotent (re-run identical, nothing deleted) | ✅ 691 → 691 |
| P3.5 | The wrong phrase refused through the real path | ✅ `{ok:false, code:"confirmation_required"}` |

### PHASE 4 — the no-interference aftermath (the owner's directive)

| # | Check | Result |
|---|-------|--------|
| P4.1 | The sync/backup RPCs still present | ✅ mark_sync_queue_processed, purge_expired_backups, upsert_parent_from_import, write_audit_log |
| P4.2 | backup_archives count unchanged across the whole run | ✅ 0 → 0 |
| P4.3 | The service-role caller REFUSED by Gate 1 | ✅ `{ok:false, code:"forbidden"}` — only humans/console purge |

## 3. What the live run CAUGHT (the eight-iteration debug log — every failure a real find)

The sandbox was run EIGHT times; each failure was a genuine live-schema fact the file chain could not teach, fixed and re-run (the §15.38 discipline — a live leg that passes first try proves nothing):

1. **Run 1 — the GoTrue trigger collision:** `handle_new_auth_user()` creates `user_profiles` + `account_approval_requests` on EVERY auth.users insert — the manual profile insert died on the unique key. The seed now rides the trigger (every profile reference resolves the trigger-created row by auth_user_id).
2. **Run 1 — the P1.3 false negative:** `pg_proc`'s `::regprocedure::text` emits signatures WITHOUT spaces — the test regex expected `", "`. Fixed (`/text,\s*boolean,\s*uuid/`).
3. **Run 3 — `students.date_of_birth` is NOT NULL live** (not in the file-chain seed shape).
4. **Run 3 — `calendar_events.kind` live CHECK enum** has no 'other' — the probe uses 'custom'.
5. **Run 4 — `payment_allocations.charge_id` → `ledger_entries.id`** (NOT installments — the file chain's naming suggests otherwise); the seed now creates the charge ledger entry FIRST.
6. **Runs 5/6 — Gate 1 refused the Management-API session:** the SQL endpoint runs as `postgres`, which is **NOT a superuser** on hosted Supabase and carries no JWT — the gate correctly failed closed. Fix: the sandbox installs the REAL verified admin claims (`set local request.jwt.claims = '<the GoTrue JWT payload>'` — the same GUC PostgREST sets per request), so the probes exercise the true UI-path authorization.
7. **Run 7 — `jsonb_object_length(jsonb)` DOES NOT EXIST:** 0120's audit note would have killed EVERY real EXECUTE at the audit write (42883) — the dry-run never reaches it, which is why every prior gate was green. **A ship-blocking bug only a live EXECUTE-mode sandbox could catch.** Fixed in 0121 (the `jsonb_object_keys` count) and pinned by a source guard.
8. **Run 6 — the marker-report parse:** PG appends a CONTEXT line to the exception message — the regex now stops at the report's last `}`.

## 4. The PURGE-502 finding (registered + fixed + proven in one session)

The trigger + `0044_admin_created_accounts` create a reachable end state where a parents row claims an `auth_user_id` whose `account_approval_requests` row has `target_parent_id` NULL (0044 resolves requests without ever linking a target). 0120's approval family matched only target-linked rows → the purge would delete the account and ORPHAN the request — the exact "orphaned, inconsistent, or partially deleted records" the issue forbids. **Migration 0121** extends the family with `or t.auth_user_id = any(v_auth_ids)` — a request dies if and only if its auth account dies; a pending signup whose account is NOT claimed by the domain keeps both (ADR-027's pre-parent boundary preserved). The sandbox's `approval_request_auth_closure_purge502` assert proves it live (the trigger-created request died with the account; everything rolled back).

## 5. Local gates (this session's changes)

- The guard suite restructured for the two-file chain (0120 + 0121): **43/43 green** (was 20) — every canonical invariant now runs against BOTH bodies, plus the delta-discipline test (the ONLY non-comment changes vs 0120 are the PURGE-502 predicate and the audit-note fix) and the `jsonb_object_length` regression pin.
- `check-migrations-append-only.sh`: OK (+1 new file — 0121).
- eslint: 0 on the changed files.
- FULL vitest: **4 120 passed / 25 failed — the failing set byte-identical to the documented pre-existing baseline** (the cross-platform [3] / t-034 [4] / t-390 / vault [2] / t-134 / t-355 [3] / ai-review [3] / analytics-visuals [2] / dashboard-3zone families), **+23 new green** vs the 99th-session closeout.

## 6. The remaining VERIFIED gate (the standing convention)

The real purge is by design irreversible and is NEVER "tested" against real data by an agent. The owner executes it from the packaged app (Settings → Zone de danger) when they choose — the card's dry-run preview will show the same 691-row census the authenticated path returned here. A pre-purge manual backup is advised (the card says so; the backup family is untouched by the purge by design).
