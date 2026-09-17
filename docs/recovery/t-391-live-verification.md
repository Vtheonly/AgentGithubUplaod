# T-391 Live Verification — auth/tenant/RLS matrix + the write-path round-trip (2026-09-18, 79th session)

> Executed by `elimtiyaz-desktop/scripts/t-391-live-rls-e2e.py` against `vebfehrpzajhstyhinnw` (run `1789665485`): **29/29 PASS, 0 FAIL, 0 NOT TESTED.** Zero business-data residue (the probe parent+student were created and removed through the CANONICAL soft-delete RPCs; the audit rows remain as the honest append-only record — §15.26). No tokens recorded.

## The full matrix (exact statuses)

### A. Authentication (handed-over Task 6)
| Check | Result | Evidence |
|---|---|---|
| Admin sign-in (password grant) | **PASS** | HTTP 200, user `a148fe34-…` |
| `auth.getUser()` | **PASS** | HTTP 200, role `authenticated` |
| Anon read of the owner's exact request → `200 []` | **PASS** | HTTP 200, rows 0 — RLS-correct (the AUTH-302 signature) |
| Authenticated read of the same request → the row | **PASS** | HTTP 200, rows 1 — **AUTH-302 proof** |

### B. Tenant resolution (Task 7 — user → profile → role → tenant)
| Check | Result | Evidence |
|---|---|---|
| `user_profiles` readable via REST (buildSession shape) | **PASS** | HTTP 200, 1 profile |
| `rpc current_user_profile_id` | **PASS** | → `42e369e9-…` |
| `rpc current_user_roles` | **PASS** | → `['super_admin']` |
| `rpc current_tenant_id` | **PASS** | → `00000000-…-0001` (default tenant) |

### C. RLS read matrix (Tasks 8/22)
| Table | Authenticated SELECT | Rows |
|---|---|---|
| parents | **PASS** (200) | 3 (7 total − 4 soft-deleted) |
| students | **PASS** (200) | 2 active |
| classes | **PASS** (200) | 0 |
| payments | **PASS** (200) | 4 |
| payment_allocations | **PASS** (200) | 5 |
| attendance_records | **PASS** (200) | 0 |
| personnel | **PASS** (200) | 0 |
| transport_destinations | **PASS** (200) | 28 (canonical post-0089 census) |
| academic_years | **PASS** (200) | 1 |
| anon parents / anon students | **PASS** (200, 0 rows — RLS-correct) | 0 |
| storage buckets (SQL census) | **PASS** | 10 buckets |
| `supabase_realtime` publication (SQL census) | INFO | 3 tables (audit_logs, salary_payments, staff_absences) — the app's `postgres_changes` subscriptions still target non-publication tables → **REALTIME-105/T-337 stays the standing open item** (correctly registered, unchanged) |

### D. Write round-trip (Tasks 23/12/13 — the desktop's EXACT shapes)
| Step | Result | Evidence |
|---|---|---|
| D1 `upsert_parent_from_import` (the `createParent` shape, run-unique code) | **PASS** | HTTP 200, parent `b28b7807…` |
| D2 parent read-back (`refreshById` shape) | **PASS** | 200, tenant `…0001` |
| D3 `upsert_student_from_import` (the `createStudent` shape, `p_parent_id` = probe parent) | **PASS** | HTTP 200, student `a8524831…` |
| D4 student read-back | **PASS** | 200, `parent_id` = probe parent |
| D5 PATCH update (`updateStudent` shape, `medical_notes`) | **PASS** | 200, matched 1 row (representation returned) |
| D6 SQL verification (persisted + tenant consistency + FK integrity) | **PASS** | both tenants `…0001`, `parent_id` intact, update persisted, nothing soft-deleted |
| D7 `soft_delete_student` (canonical cleanup) | **PASS** | `{ok: true, deleted_at: …}` |
| D8 `soft_delete_parent` (canonical cleanup) | **PASS** | `{ok: true, deleted_at: …}` |
| D9 post-cleanup operational invisibility | **PASS** | `students?id=…&deleted_at=is.null → []` |

## Conclusions for the handed-over task list

- **Task 6 (test authentication): DONE — PASS** (session exists, user exists, expiry 3600 s; refresh token issued; never logged tokens).
- **Task 7 (trace user → profile → tenant): DONE — PASS** (admin → profile `42e369e9…` → super_admin → default tenant `…0001`; every step verified against the database).
- **Task 8 (test RLS SELECT): DONE — PASS** (9 tables + the anon split; zero Postgres error codes — nothing failed).
- **Task 22 (representative reads): DONE — PASS** (parents, students, classes, payments, payment_allocations, attendance, personnel, transport — the `notes` concept has no standalone table in the chain; notes live on the parents/students columns and chat/notification tables).
- **Task 23 (representative write tests): DONE — PASS** (create → read → update → SQL-verified persistence, then canonical cleanup).
- **Task 12 (`students.parent_id`): DONE — PASS** (the probe student was created with a real, same-tenant parent; the FK + tenant consistency verified server-side).
- **Task 13 (tenant consistency): DONE — PASS** (`parent.tenant_id == student.tenant_id == default tenant`).
- **Task 24 (persistence after refresh/restart): PASS at the HTTP layer** (the row survives and is re-readable on every fresh request — no client cache involved). The RENDERER-level refresh/restart behaviour (the React cache re-seed) is covered by T-392's unit tests + the owner's EXE acceptance pass (the sandbox cannot run the Windows EXE — documented in the final report).

**The backend is now proven end-to-end: every remaining defect in the owner's symptom set is client-side (AUTH-302 + OPS-317 + OPS-318 → T-392).**
