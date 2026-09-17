# Supabase Root-Cause & Remediation — Final Report (2026-09-18)

> **The handed-over mandate:** the owner's task list "El-Imtiyaz Desktop — Supabase Root Cause & Remediation" (17 September 2026) — clone the repos, read the audit docs + AGENTS.md, audit every Supabase access point, verify the client/URL/key, prove auth/tenant/RLS, fix student loading + insertion, stop swallowing errors, build a deterministic diagnostics screen, produce this final report. Live tokens were supplied; every push/merge followed each commit.
>
> **The one-line verdict:** the backend was HEALTHY end to end; the true root cause of every reported symptom ("connection works but data does not", "existing children not appearing", "new children can't be inserted", "parent ID does not exist") was **AUTH-302** — a client-side session-state desynchronization that made every REST call run as `anon`, so RLS silently filtered every list to empty (`200 []`) with zero visible errors. The pasted audit's Root Problems 3–6 (missing data migration / nonexistent parent) were **disproven live**; its Problems 1–2 were already fixed and are now verified at every remaining path.
>
> **Task chain:** T-390 (the access-point audit + backend health proof) → T-391 (the live auth/tenant/RLS matrix + write round-trip, 29/29) → T-392 (the AUTH-302 + OPS-317 + OPS-318 fixes, 14/14) → T-393 (the diagnostics screen, 12/12 + 20/0/1 live) → T-394 (this report + closeout).

---

## 1. The root-cause table (15 categories, every row evidence-linked)

| # | Category | Status | Root cause found / fix / evidence |
|---|---|---|---|
| 1 | **Configuration** (URL, key, single client) | **PASS** | The canonical singleton `getSupabaseClient()` is the ONLY client (T-390 census — every `createClient`/`from`/`rpc`/`auth`/`storage`/`channel`/`fetch` path inventoried in `docs/audits/supabase-access-audit-2026-09-18.md`). Production is hard-locked to `https://vebfehrpzajhstyhinnw.supabase.co` + the publishable key (commits cc317a6/f39eb17); the production bundle build re-verified this session: 2 canonical URL refs, **0 old-project refs, 0 secret keys** (the single `service_role` string match is the connection-card's warning TEXT, not a key). `describeSupabaseConnection()` reports host + key FORMAT only. |
| 2 | **Network / URL construction** | **PASS** | The `%20` URL class (Root Problem 2: `…supabase.co%20/rest/v1/tenants` → ERR_NAME_NOT_RESOLVED) is dead at every path: the canonical client normalizes at construction (f39eb17) and `validateConnection` now routes through the SAME exported `normalizeSupabaseUrl` seam (T-392/OPS-318, commit 3e2642e) with sanitized persistence. Regression-pinned (t-392: URL-normalization-no-%20). Live: `GET /rest/v1/tenants` → 200 (t-393 leg 2). |
| 3 | **Authentication** | **PASS (fixed)** | **AUTH-302 was the root cause of the owner's symptom set.** The domain session (`el-imtiyaz.session`) survived the loss of the SDK session (`el-imtiyaz.supabase.session.vebfehrpzajhstyhinnw`) → every REST call anon → RLS `200 []` (a SELECT under RLS never 4xx-es on auth loss) → OPS-317's silent catches degraded every list to empty. **Fix (T-392, auth-provider.tsx):** startup `refreshSession()` failures are classified — auth-class failures EVICT the domain session (honest sign-in screen); network-class failures keep it (offline start). 14/14 regression tests. Live proof of the mechanism: the owner's exact request returns `200 []` anon and `200 [row]` authenticated (t-391 A3/A4, t-393 leg 10). |
| 4 | **Tenant resolution** (user → profile → role → tenant) | **PASS** | admin → profile `42e369e9-…` → `super_admin` → default tenant `00000000-…-0001`; every step verified via REST AND RPC (t-391 B, 200s throughout; t-393 legs 6–9). No tenant drift. |
| 5 | **RLS (read + write matrix)** | **PASS** | 9 tables authenticated SELECT + the anon split: zero Postgres error codes, correct filtering both ways (t-391 C: 29/29; t-393 leg 10). Writes: the RLS-500 soft-delete path had been fixed earlier by migration 0100; the full write round-trip (D1–D9) green. RLS is intact and was NEVER weakened. |
| 6 | **Parents** | **PASS** | The "parent `220e7f65-db05-498d-b2e5-a514f8b75570` does not exist" hypothesis DISPROVEN live: the row EXISTS, not deleted, correct tenant — the anon read returning `[]` was AUTH-302's signature (t-390, t-391 A4: authenticated read → the row). Parents list: 3 active (7 total − 4 soft-deleted). |
| 7 | **Students read** | **PASS (fixed)** | The "existing children not appearing" symptom = AUTH-302 + OPS-317 (anon reads → silent empty cache). With a valid session the students read is green (t-391 C: 2 active; t-393 leg 10). The seed degradation is now RECORDED and rendered (t-392 + the t-393 screen). |
| 8 | **Students insert** | **PASS** | The create path works through the canonical RPC (`upsert_student_from_import`): t-391 D3 (200, out_student_id), read-back D4, SQL-verified persistence D6. The historical insert failure (HTTP 400 `22P02 invalid input syntax for type uuid: ""`) was already fixed by T-387/SYNC-300 (blank-string → null at every optional typed-parameter seam). |
| 9 | **Students update** | **PASS** | PATCH `updateStudent` shape → 200, matched row, SQL-verified persistence (t-391 D5/D6). |
| 10 | **RPCs** | **PASS** | `current_user_profile_id`, `current_user_roles`, `current_tenant_id`, `upsert_parent_from_import`, `upsert_student_from_import`, `soft_delete_parent`, `soft_delete_student` all verified live with the desktop's exact payload shapes (t-391 B/D; t-393 legs 7–9). |
| 11 | **Schema** (deployed vs code) | **PASS** | 97/97 migrations registered on BOTH projects with exact version parity (T-386 healed the OPS-316 registration drift on production; T-387 re-aligned `types.ts` to the live `pg_proc` signature). The RLS helper functions match the live `SECURITY DEFINER` shape (verify_t-376 12/12 on both). |
| 12 | **Data migration** | **PASS** | The canonical census is present on the NEW project: tenants=1, roles=11, permissions=56, transport_destinations=28, academic_years=1 + the business rows (parents=7, students=3, payments=4, payment_allocations=5). The "missing seed data" hypothesis DISPROVEN (T-387; re-confirmed by t-391/t-393 counts). ⚠ 0023_seed.sql must NOT be re-run (its asserts expect the 0023-era census — the AGENTS.md §15.37 trap). |
| 13 | **Realtime** | **PASS with one OPEN standing item** | The websocket path is wired (financial-realtime.ts, no secret key); the diagnostics screen's channel probe is unit-tested. Live: the `supabase_realtime` publication covers 3 tables (audit_logs, salary_payments, staff_absences) while the app's `postgres_changes` subscriptions target non-publication tables → **REALTIME-105 / T-337 remains the registered open item** (a known, tracked divergence — not part of the owner's symptom set; no data-loss consequence, notifications only). |
| 14 | **Storage** | **PASS** | 10 buckets exist (SQL census, t-391 C); the authenticated REST role sees 0 buckets (RLS on the storage schema — by design; the diagnostics screen reports this honestly as a count, the t-393 leg 11 design). The unified `student_documents` table path was fixed by T-372/SYNC-110. |
| 15 | **Production EXE** | **NOT PROVEN (in this sandbox) — build legs PROVEN, install/launch matrix = owner runbook §4** | The renderer production bundle builds clean with `VITE_DESKTOP_PRODUCTION=true` (exit 0, canonical URL ×2, 0 old-project refs, 0 secrets, the diagnostics screen included) and `electron/` main compiles (tsc exit 0). The Windows NSIS build/install/launch matrix cannot execute in this Linux sandbox — the exact runbook is §4 below. |

**Totals: 14 PASS (3 of them "PASS — fixed this session"), 0 FAIL, 1 NOT PROVEN (EXE install/launch, with runbook).**

---

## 2. What was actually wrong vs what the pasted audit claimed

| Pasted-audit Root Problem | Live verdict | Evidence |
|---|---|---|
| RP1 stale credentials | Already fixed (canonical lock) — re-verified | bundle census: 0 old-project refs |
| RP2 `%20` URL bug | Already fixed at the main path; the LAST surviving path (`validateConnection`) fixed by T-392/OPS-318 | t-392 regression + t-393 leg 2 |
| RP3 connection works, data doesn't | **REAL — but client-side: AUTH-302**, not a data problem | t-391 A3/A4, T-392 fix |
| RP4 children not appearing | Same root cause (AUTH-302 + OPS-317) — fixed | T-392 + t-393 |
| RP5 new children can't be inserted | DISPROVEN live (insert works; the historical 400 was SYNC-300, fixed T-387) | t-391 D3 |
| RP6 parent ID doesn't exist | DISPROVEN live (the parent EXISTS) | t-391 A4 |
| RP7–RP18 ("not proven" items) | All proven PASS by T-391/T-393 (except the EXE legs + REALTIME-105, honestly registered) | the table above |

The pasted report's own caveat ("may or may not be the issue") was correct: its data-layer hypotheses were wrong; the connection layer was fine; the defect was the session layer in between.

## 3. The remediation delivered (commits, all pushed + merged to `main`)

| Commit | Task | Content |
|---|---|---|
| `e26fd1f` | T-390 registration | the task/problem registry entries for the mandate |
| `ee2337c` | T-391 | the live probe script + the 29/29 evidence doc |
| `3e2642e` | T-392 | the AUTH-302 eviction + OPS-317 seed surfacing + OPS-318 sanitization + 14 tests |
| `4ca2ca4` | T-391/T-392 closeout | the registry flips (statuses CLOSED — VERIFIED) |
| `0286f7a` | T-393 | the diagnostics screen module + 12 tests + the live E2E script + the evidence doc |
| (this commit) | T-394 | this report + the registry closeout |

**The handed-over 30-task list mapping:** T1–T5 → T-390 (the access-point audit, the single client, the URL/key lock, the old-ref census, the %20 kill); T6–T9 → T-391 A/B (+T-390 for the parent ID); T10 → T-392 (AUTH-302 — the actual fix for "children not appearing"); T11–T13 → T-391 D (+T-387's earlier SYNC-300 fix for the insert 400); T14–T18 → T-390/T-391/T-393 (schema parity 97/97, RLS matrix, data census, RPCs, storage); T19 → realtime census + REALTIME-105 registered (open); T20 → T-392/OPS-317; T21 → T-393; T22 → t-391 C; T23 → t-391 D; T24 → T-392 unit + the HTTP-layer proof (the renderer-restart leg = the runbook §4); T25 → the storageKey project-scoping (the stale-state defense, cc317a6/f39eb17) + runbook §4.1; T26 → the production build legs PROVEN (renderer + electron main) + runbook §4.2; T27–T28 → runbook §4 (the sandbox cannot execute the Windows matrix); T29 → honored throughout (the 200-[] trap is exactly what AUTH-302 exploited — now detected by the screen); T30 → this report.

## 4. The owner's EXE acceptance runbook (the legs this sandbox cannot execute)

1. **Clean-state check (T25):** install the EXE on a machine with NO prior El-Imtiyaz userData (or delete `%APPDATA%/el-imtiyaz*` first). Launch → the app must show the sign-in screen (NOT a remembered session with empty lists — the AUTH-302 fix evicts honestly).
2. **Sign-in + data:** sign in as the admin → CRM → Parents (3 rows) and Élèves (2 rows) must appear immediately. If any list is empty: open **Settings → Diagnostic Supabase** → "Lancer le diagnostic" → the `auth.domain-vs-sdk` check names the exact failure class; the "Derniers échecs de chargement" card shows the recorded reason.
3. **Write round-trip:** create a child (CRM → Élèves → Ajouter) → it must appear immediately, survive F5, and survive an app restart (the HTTP-layer persistence is already proven live — this checks the renderer cache re-seed).
4. **Restart persistence:** restart the app → the session survives (valid SDK session) or the sign-in screen appears (evicted) — never an empty app with a stale session.
5. **If anything fails:** use "Copier le rapport" on the diagnostics screen and send the text (it contains HTTP statuses + error codes + tables — never keys).

## 5. Remaining open items (honest register)

- **REALTIME-105 / T-337** — the publication/subscribed-tables divergence (notifications only; pre-existing, tracked).
- **The EXE install/launch matrix** — §4 above (owner-executed).
- **The standing pre-existing test failures** (20, all in the concurrent T-388 i18n fallout + CALC-001 mirror files — the failing set is byte-identical to the session-open baseline; none in this mandate's files).
