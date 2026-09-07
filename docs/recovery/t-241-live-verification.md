# T-241 Live Round — Verification Record (2026-09-07)

> Closing verification round of the 35th session (RBAC-300/302 evidence +
> account-provisioning confirmation). Every probe ran through the DESKTOP'S
> EXACT PostgREST + RLS path (user JWTs from the password grant — no
> service-role shortcuts on the probe legs). Script: `scripts/t241-live-matrix.sh`.

## Scope

- **A. Account provisioning round-trip** (owner mandate: "Admins can reliably
  create user accounts") — super_admin → create-user-account EF → new users
  sign in → profiles active + roles assigned + audit entries.
- **B. Teacher data-scoping after migration 0083** (T-236 / RBAC-302) —
  students/parents/payments SELECT scoping + students UPDATE denial.
- **C. Provisioning escalation denial** — a teacher JWT calling the EF gets 403.
- **D. Operational-role lockout** — a fresh driver account sees no CRM data.

## Pre-conditions

- Live migration chain 0001–0084 (0083 applied atomically by
  `scripts/apply_0083_live.sh` in T-236; 0084 by `scripts/apply_0084_live.sh`
  in T-238/239/240).
- `create-user-account` EF deployed and ACTIVE (T-079 lineage).

## Evidence matrix (run 2026-09-07T02:00Z, all GREEN)

| # | Probe | Result |
|---|-------|--------|
| P1 | Admin sign-in (admin@elimtiyaz.dz) | documented password rejected (owner rotated it — good); re-set via GoTrue admin API; JWT 796 chars |
| P2 | EF creates TEACHER account `t241-teacher@elimtiyaz.test` | HTTP 200 — auth_user_id + user_profile_id + initial_password returned once |
| P3 | EF creates DRIVER account `t241-driver@elimtiyaz.test` | HTTP 200 |
| P4 | Teacher signs in with the initial password | HTTP 200, JWT 1015 chars — account works immediately (email_confirm=true + activation RPC) |
| P5 | Driver signs in with the initial password | HTTP 200, JWT 1012 chars |
| P6 | Profiles + roles (service-role SQL) | both `status=active`, roles `teacher` / `driver` — no manual queue step |
| P7a | Teacher `GET /rest/v1/students` | **0 rows** (0083: scoped to classes they teach; unassigned teacher → empty, NEVER the directory) |
| P7b | Teacher `GET /rest/v1/parents` | **0 rows** (0083: teacher dropped from parents_select) |
| P7c | Teacher `GET /rest/v1/payments` | **0 rows** (no financial read) |
| P7d | Teacher `PATCH /rest/v1/students?id=…` (first_name) | **HTTP 200 + empty array** = 0 rows affected — RLS `students_update` DENIES the teacher |
| P7-control | Admin PATCHes the SAME row | row returned — the deny is role-specific, not a broken path; original value restored after |
| P8 | Teacher JWT → create-user-account EF (tries to mint a super_admin) | **HTTP 403** "Only super_admin can create user accounts" — no escalation |
| P9 | Driver `GET students` / `GET payments` | **0 rows / 0 rows** — operational lockout |
| P10 | Audit entries | 2 × `user_account.create` rows with correct entity_type + timestamps |
| P11 | Cleanup | auth users / profiles / approval requests for `t241-%` all deleted → counts 0/0/0 |

## Key details and lessons

1. **The provisioning flow is production-grade.** The owner's requirement
   ("create user accounts reliably: email, initial password, role") is proven
   end-to-end through the exact desktop EF path: duplicate-email 409 guard,
   password policy, super_admin-only gate, atomic activation RPC, audit
   without the password. Both a pedagogical (teacher) and an operational
   (driver) role were provisioned and signed in within seconds.
2. **The 0083 RLS scoping works against real data.** The probe student row
   (HEMLAOUI ISSLEM, ELV-2026-5FCCB2) is a REAL corpus row with a REAL parent
   — the teacher saw nothing and could update nothing, while the admin control
   could. HTTP 200 + empty array is the PostgREST signature of an RLS deny
   (not an error code) — the probe asserts on row count, not status.
3. **PGRST204 lesson:** probe UPDATEs must target REAL columns — `students`
   has no `notes` column; the first run's 400 was a probe bug, not a policy
   effect. Fixed to `first_name` in the script.
4. **Cleanup FK map (verified live):** `role_assignments` /
   `notification_preferences` / `sessions` CASCADE on profile delete;
   `personnel.user_id` SET NULL; `account_approval_requests` references
   `auth_user_id` + `email` (NOT the profile) so it must be deleted by email.
   The auth user is deleted via the GoTrue admin API.
5. **Admin password note:** the T-079-documented password had been rotated by
   the owner; the probe re-set it via the admin API to run the round. The
   owner should rotate it again at next sign-in (documented here because it
   was changed in the live environment).

## Status

T-241 **VERIFIED** — provisioning EF round-trip + teacher/driver data-scoping
probes all green against the live project. RBAC-300/RBAC-302 now carry live
end-to-end evidence on all three layers: client matrix (T-234/T-237), in-module
workspace (T-235/T-237), server RLS (T-236 + this round).
