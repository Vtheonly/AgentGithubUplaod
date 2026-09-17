# T-390 Live Verification — the Supabase access audit + backend health proof (2026-09-18, 79th session)

> Read-only live probes against the NEW project `vebfehrpzajhstyhinnw` (eu-west-1), executed 2026-09-18 with the owner-supplied credentials. No business data was mutated by any probe in this task (the write-path round-trip is T-392's scope). No tokens are recorded here.

## Probe 1 — project identity (Management API)

```
GET https://api.supabase.com/v1/projects/vebfehrpzajhstyhinnw
→ 200 {"id": "vebfehrpzajhstyhinnw", "name": "elimtiyaz-empty", "status": "ACTIVE_HEALTHY", "region": "eu-west-1"}
```

Note: the dashboard *name* is `elimtiyaz-empty` (a label from the 72nd-session empty-clone mandate) — it does **not** describe the current data state (the owner has since created live test rows; see Probe 4).

## Probe 2 — the owner's reported symptom, reproduced and split (REST)

The exact request shape from the owner's console paste (`refreshById`, `supabase-shared-repositories.ts:474-479`):

```
# 2a. WITHOUT a user JWT (anon role — the broken desktop state):
$ curl "https://vebfehrpzajhstyhinnw.supabase.co/rest/v1/parents?select=id,display_name&id=eq.220e7f65-db05-498d-b2e5-a514f8b75570" \
      -H "apikey: sb_publishable_…"
→ HTTP 200  []

# 2b. WITH the admin's access token (authenticated role):
$ curl … -H "apikey: sb_publishable_…" -H "Authorization: Bearer <admin access token>"
→ HTTP 200  [{"id":"220e7f65-db05-498d-b2e5-a514f8b75570","display_name":"asdfghgfds asdfghgfds","tenant_id":"00000000-0000-0000-0000-000000000001"}]
```

**Conclusion:** the parent exists; the `[]` is RLS correctly filtering an unauthenticated (anon) request. Network/URL/key/project are all healthy — the failure is the missing user session on the caller (AUTH-302).

## Probe 3 — authentication chain (GoTrue)

```
POST /auth/v1/token?grant_type=password   {email: admin@elimtiyaz.dz}   → HTTP 200
  user.id: a148fe34-98e3-422a-bf42-91da094e270c · role: authenticated · confirmed_at: 2026-09-15T22:58:46Z
  expires_in: 3600 (refresh token issued)

GET /auth/v1/user  (Bearer)   → HTTP 200 (same user id/email/role)
```

## Probe 4 — data + RBAC census (Management API SQL endpoint)

```
parents: 7 · students: 3 · tenants: 1 · user_profiles: 1 · auth.users: 1 · schema_migrations: 97

parents row 220e7f65-…: first_name "asdfghgfds", tenant_id …0001, deleted_at NULL (EXISTS)

user_profiles: 42e369e9-9f88-40a0-8434-ffd3b2c3ba8b ↔ auth_user_id a148fe34-…, status "active", tenant …0001
role_assignments: super_admin (role_id …0101), tenant …0001, revoked_at NULL

students (created_at proves the live write path works when authenticated):
  e1a4457a-…  ELV-2026-E0E486   "SIDI MAMER SAMYI"    2026-09-15 17:48  (soft-deleted 2026-09-16)
  e8ee4460-…  ELV-2026-441FCD   "testi testi"          2026-09-17 12:05  active
  13f0ef93-…  ELV-2026-069F26   "an other dude …"      2026-09-17 14:04  active
```

## Probe 5 — authenticated students read (REST, Bearer)

```
GET /rest/v1/students?select=id,display_name,student_code,tenant_id,parent_id&limit=10
→ HTTP 200 [13f0ef93-… "an other dude an other dude" parent 4f80e8e1-…, e8ee4460-… "testi testi" parent a64a92ea-…]
```

(2 rows — the third student is soft-deleted and correctly excluded by the `deleted_at IS NULL` SELECT policy family.)

## Verdict

| Check | Result |
|---|---|
| Correct project / URL / publishable key / flags | **PASS** (locked in `supabase-client.ts` + `build-windows.mjs`) |
| Network reachability | **PASS** |
| REST API (anon gateway) | **PASS** |
| Authentication (sign-in, getUser) | **PASS** |
| User → profile → role → tenant chain | **PASS** (active super_admin on default tenant) |
| RLS SELECT as authenticated admin (parents, students) | **PASS** |
| Parent `220e7f65-…` exists | **PASS** (the handed-over report's Problem 6 is disproven) |
| Students INSERT path (historical evidence) | **PASS** (live rows created 2026-09-15/16/17 via the canonical RPC) |
| **Root cause of the owner's symptom** | **AUTH-302** — the desktop's domain session survives while the Supabase SDK session is gone → every REST call is anon → `200 []` → silent empty UI |

The remaining T-392 work is client-side only (session-state synchronization + error surfacing + the `validateConnection` `%20`/false-positive residual). The write-path round-trip (create → read → update → persist) is executed and documented in `t-392-live-verification.md`.
