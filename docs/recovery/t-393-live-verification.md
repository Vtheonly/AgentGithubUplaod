# T-393 Live Verification — the diagnostics screen's probe sequence executed live (2026-09-18, 79th session)

> Executed by `elimtiyaz-desktop/scripts/t-393-diagnostics-e2e.py` against `vebfehrpzajhstyhinnw` (run `1789673721`, READ-ONLY): **20 PASS / 0 FAIL / 1 NOT TESTED.** The script mirrors the desktop runner's deterministic probe sequence exactly — same order, same query shapes, same PASS/FAIL/NOT TESTED classification — so this run is simultaneously the T-392 live re-verification leg (the full healthy path re-proven AFTER the AUTH-302/OPS-317/OPS-318 fixes). No tokens recorded; no business data touched.

## The probe matrix (the runner's order, live)

| # | Probe (runner id) | Live result | Evidence |
|---|---|---|---|
| 1 | config.connection | **PASS** | canonical host `vebfehrpzajhstyhinnw.supabase.co`, key format `publishable` |
| 2 | network.rest | **PASS** | HTTP 200 on `GET /rest/v1/tenants` (anon reachability) |
| 3 | auth.sdk-session | **PASS** | password grant 200, `expires_in` 3600 s |
| 4 | auth.user | **PASS** | `GET /auth/v1/user` 200, role `authenticated` |
| 5 | auth.domain-vs-sdk | **PASS** | freshly issued JWT accepted by /auth/v1/user — the two session stores align (the AUTH-302 cross-check) |
| 6 | tenant.profile-rest | **PASS** | HTTP 200, profile visible, tenant `…0001` |
| 7 | tenant.id-rpc | **PASS** | → `00000000-0000-0000-0000-000000000001` |
| 8 | rpc.profile-id | **PASS** | → `42e369e9-9f88-40a0-8434-ffd3b2c3ba8b` |
| 9 | rpc.roles | **PASS** | → `super_admin` |
| 10 | rls.parents / students / classes / payments / payment_allocations / attendance_records / personnel | **PASS** ×7 | HTTP 200; counts 3 / 2 / 0 / 4 / 5 / 0 / 0 |
| 10 | the AUTH-302 signature reproductions | **PASS** ×2 | anon read of the owner's exact request → `200 []`; authenticated read → `200 [row]` (the screen detects exactly this split) |
| 11 | storage.buckets | **PASS** | HTTP 200, 0 bucket(s) VISIBLE to the authenticated role (RLS on the storage schema; the SQL census via the management API reports the full 10 — the runner's honest-count design) |
| 12 | realtime publication census | **PASS** | `supabase_realtime` covers 3 tables (audit_logs, salary_payments, staff_absences) — REALTIME-105 stays the standing open item |
| 12 | realtime websocket channel | **NOT TESTED** | the runner's channel probe is unit-tested (SUBSCRIBED/TIMED_OUT paths); the live websocket leg belongs to the owner's EXE acceptance matrix (documented in the final report, T-394) |

## The screen itself

- **Module:** `src/features/settings/supabase-diagnostics/` — `diagnostics-types.ts` (the PASS/FAIL/NOT TESTED contracts), `diagnostics-runner.ts` (the deterministic 18-check sequence), `supabase-diagnostics-tab.tsx` (the view + the OPS-317 seed-degradation card + the safe clipboard export). Self-contained: no shared-component edits, no dictionary files (the T-388 concurrent-agent contract), French labels internal.
- **Mount:** Settings → the new « Diagnostic Supabase » tab (next to Configuration; `?tab=diagnostics` deep-link works via the existing VALID_TABS mechanism).
- **The AUTH-302 detector:** the `auth.domain-vs-sdk` check cross-compares the app session (useAuth) with the SDK session (auth.getSession) — the exact defect class that produced the owner's « connection works but no data » state is now VISIBLE from inside the app, with the operator instruction (sign out / sign in).
- **The OPS-317 explainer card:** renders `getSeedDiagnostics()` — the recorded, classified reasons (auth vs network) why the lists degraded to empty; an empty list with NO record = a genuinely empty database.
- **Safety:** every detail is HTTP status + code + table + count; the suite asserts no `sb_publishable_` prefix, no JWT prefix (`eyJ`), ever appears in the report or the clipboard export.

## Verification summary

- Unit: `npx vitest run src/tests/features/t-393-supabase-diagnostics.test.tsx` — **12/12 PASS** (runner ×7: healthy 18-check sequence + category order, the AUTH-302 signature, mock-mode per-category NOT TESTÉ + zero network calls, network failure honesty, RLS 42501, storage permission-split, realtime timeout, no-token-leak; view ×5: run wiring + injected client, the badges + warning banner, the seed-diagnostics card, the empty state, the clipboard export).
- Gates: `npx tsc --noEmit` — 0 errors; `npx eslint` on the touched files — 0 errors / 0 new warnings.
- Live: **20/20 PASS + 1 honest NOT TESTED** (the websocket leg) — the full probe sequence against the real project, read-only.
