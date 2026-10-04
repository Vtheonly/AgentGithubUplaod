# T-495 — The Live Verification of the T-492/T-493/T-494 Delivery + the SYNC-303 Discovery (the 147th session, 2026-10-05)

**The mandate:** the owner supplied the full infrastructure token set — *"here are all the tokens you need from infrastructure to test if it works make sure it works"* — unblocking the three owner-gated legs the 146th session's delivery README listed under "What remains (owner-gated, honestly)": the live expense round-trip, the on-device-census leg, and the Personnel convergence.

**The runner:** `elimtiyaz-desktop/scripts/t495-live-verification.py` — the t488 conventions (run-unique FAKE-marked probes, the app's OWN sanctioned paths, honest PASS/FAIL, zero-residue cleanup that keeps append-only history). Every leg drives the REAL Supabase stack (GoTrue + PostgREST + RLS + the WEAK-030 triggers) with the signed-in admin's JWT — the device's own visibility — never the service key except where authenticated DELETE is impossible (verified: no DELETE policy exists on `expense_tickets` for `authenticated`).

**THE VERDICT: 43 PASS / 0 FAIL** (`docs/recovery/t-495-live-verification-evidence.txt`).

## The infrastructure tokens (all verified live)

| Token | Verification |
|---|---|
| `sb_secret_…` (service role / secret key) | REST gateway 200; schema 116 tables readable |
| `sb_publishable_…` (anon key) | The app's own apikey path — every drain and probe call |
| `sbp_…` (Management access token) | `GET /v1/projects/vebfehrpzajhstyhinnw` → 200; **the SQL endpoint WORKS** (`/database/query` — the trigger/constraint forensics below ran through it) |
| GitHub PAT `ghp_…` | `GET /user` → 200; both repos cloned |

## LEG 1 — the T-493 pull census (read-only): every unbounded pull drains the FULL live population

Every Android pull replicated call-for-call over the real gateway (the signed-in admin's JWT, the app's exact query shapes):

| Stream | Drain | Live count | Verdict |
|---|---|---|---|
| installments (id-keyset, 1 000/page) | 5 956 rows, 6 pages | 5 956 | PASS — the tranche stream is FULL |
| personnel | 18 rows | 18 | PASS |
| departments / classes / subjects | 4 / 6 / 16 | 4 / 6 / 16 | PASS |
| expense_tickets (the T-492 embed pull) | 0 | 0 | PASS |
| releve_entries (the T-494 pull) | 0 | 0 | PASS |
| homework / attendance_records / assessments | 0 / 0 / 0 | 0 / 0 / 0 | PASS |
| pull_parents_for_sync (page 1 000) | 741 | 741 | PASS |
| **pull_students_for_sync (page 1 000 — the FIXED size)** | **1 137 rows, 2 pages** | **1 137** | **PASS — the SYNC-303 fix proven live** |
| pull_payments_for_sync (page 5 000, jsonb) | 2 198 | 2 198 | PASS |
| pull_ledger_entries_for_sync (page 5 000, jsonb) | 3 342 | 3 342 | PASS |

The tranche census the device will compute on: **T0 (FI) 1 137 · T1 1 606 · T2 1 609 · T3 1 604** — the full population, exactly what the desktop's engine derives from.

## THE SYNC-303 DISCOVERY (found live, fixed, and pinned this session)

Replicating the ORIGINAL T-493 page size against the live backend exposed a residual truncation the unit suite could not see:

- `pull_students_for_sync` answered **p_limit=5 000 with EXACTLY 1 000 rows** — `Content-Range: rows 0-999` — while `pull_payments_for_sync` / `pull_ledger_entries_for_sync` passed through whole at 2 198 / 3 342 rows (`Content-Range: 0-0/*`).
- The difference (pinned via the Management-API SQL endpoint): the parents/students RPCs are **`RETURNS TABLE(...)`** — row-typed — and the Supabase API gateway applies its **max-rows setting (1 000)** to row-typed RPC responses, slicing them whatever the function's own `LIMIT` says. The payments/ledger RPCs return **jsonb** — a single payload the gateway does not slice.
- The drain then mistook the sliced 1 000-row page for a completed SHORT page (1 000 < 5 000) and stopped: **the device held 1 000 of the live 1 137 students, silently truncated** — the same defect class as the original "tranches are incorrect" report, surviving T-493 on the RPC path. (The DB itself was never at fault: the raw SQL and the RPC called through SQL both return 1 137.)
- **THE FIX (android, T-495):** the row-typed pair drains at the new `ROW_TYPED_RPC_PAGE_SIZE = 1_000` — ≤ the gateway slice, so a full page stays FULL and the `p_since` cursor keeps advancing; the jsonb pair keeps the 5 000 page. **Proven live: the 1 137-student drain completes in 2 pages, all ids distinct** — and the discovery is PINNED in the runner (the p_limit-5 000 call still returns exactly the 1 000-row slice — the defect mechanism, kept as permanent evidence).
- **The suite:** `PullPaginationT495Test` 6/6 — the config contract (page ≤ the slice, distinct from the jsonb page), the live 1 137-row drain at the fixed size, the sliced-page-never-reads-as-short regression guard (the old 5 000 config pinned as the truncation), and the source-wiring scans (both RPC paths pass the row-typed page as BOTH `p_limit` and `pageSize`; the jsonb pair untouched).

## LEG 2 — the T-494 Personnel convergence (read-only): the app will show the server's truth

- The live ACTIVE personnel set (`deleted_at IS NULL`): **exactly 1 real worker — Adam Cherif (PER-2026-82FB27)** — the T-486 honest posture (the 8 FAKE archive-era rows + the probe rows are all soft-deleted).
- **Every one of the 17 soft-deleted rows is also `is_active=false`** — the Android DAO's `status='active'` filter and the desktop's `deleted_at IS NULL` filter yield the SAME visible set on the live data (0 deleted rows would leak into the app's list). *(The registered nuance: the Android DTO has no `deleted_at` field — a soft-deleted-but-still-active row would display; every live archived row carries both flags, so the surfaces agree on today's data.)*
- **The demo-seed ids are UUID-IMPOSSIBLE server-side** — the strongest eviction-safety proof: every table's `id` column is UUID-typed (verified in the API schema), so an `id=in.(per-admin,…)` filter is REJECTED with `22P02 invalid input syntax for type uuid` — the demo ids are not even REPRESENTABLE in the server's id space. The exact-id eviction can never match a server row — by type, not by luck. (Checked across personnel / departments / parents / students.)
- The `releve_entries` census: **0 rows** — the Activité tab's honest-empty pre-production state.

## LEG 3 — the T-492 expense round-trip (probe + zero-residue): the owner-gated leg CLOSED

A run-unique FAKE-marked probe driven through the dispatcher's EXACT call shapes (the app's local `exp-<uuid>` id with the prefix strip, the category resolution by (tenant, code), the `EXP-<year>-<6 base36>` ticket number with the server collision check, the full-row upsert on the id PK under RLS with the admin's JWT):

- **B1–B3 the create push:** category resolved (`office_supplies` → its live UUID), ticket number free, the full-row upsert **HTTP 201** under RLS.
- **C the app's pull leg:** the exact pull query (id-keyset + the `expense_categories(code)` embed) returns the probe; the T-093 translation verified both directions (`pending_approval → submitted`, `office_supplies → supplies`).
- **D the desktop-visible leg:** the desktop repository's exact read (`select *, expense_categories(code)` filtered by tenant, ordered by `submitted_at desc`) sees the probe in the approval queue — **"Android submit → desktop visible" VERIFIED LIVE.**
- **E the transition leg:** the self-approval negative control REJECTED (`P0001 Self-approval is forbidden (plan §08 / WEAK-030)`); the legal approve with a distinct approver **HTTP 204**; the originator's title/category/amount proven UNCHANGED (the transition-only contract); the status `approved_funds_released` + approver recorded; the `expense_state_transitions` append verified (`pending_approval → approved_funds_released`, exactly 1 row).
- **F the replay contracts:** F1 — the GENUINE dispatcher replay (the same enqueue-time payload, row unchanged) is a **no-op (HTTP 200, still exactly 1 row)**; F2 — the stale-status replay after an external approval is REJECTED (the WEAK-030 state machine: `Unauthorized expense transition: approved_funds_released → pending_approval`) — the honest-error contract (the entry stays pending with lastError, never a silent "synced"); F3 — **a NEW discovery pinned:** the BEFORE-INSERT workflow trigger runs AHEAD of the upsert's conflict resolution, so a create replay carrying a NON-INITIAL status is rejected at the INSERT gate itself (`Invalid initial expense status`) — defense-in-depth the dispatcher never trips (its payload is frozen at enqueue time with an initial status).
- **G the cleanup:** the probe's transitions + ticket deleted (service key — no authenticated DELETE policy exists, verified live this session); **zero residue confirmed** (ticket=0, transitions=0, the table back to its pre-probe 0 rows).

## The Android verification battery (with the SYNC-303 fix)

- `./gradlew test` — **BUILD SUCCESSFUL**: testDebugUnitTest **766 / 0 failures / 1 documented skip** (88 suites) + testReleaseUnitTest **693 / 0 failures / 1 skip** (70 suites) — the battery moved 760 → 766 and 687 → 693 (the 6 new T-495 tests), everything else baseline-stable.
- `./gradlew lint` — green. `./gradlew assembleDebug` — the APK built (33 MB).

## What remains (honest)

1. **The live-device eyeball** — the owner installing the new APK (the T-495 build, not the T-492-T-494 one: it carries the students-pagination fix) and seeing: the working expenses form, the full-population tranche numbers, and the Personnel list converging on Adam Cherif. The device-side Room-count census (`1 137 students / 5 956 installments` in Room after a sync cycle) is the owner's one-line check.
2. **The boundary-tie nuance (registered):** the `pull_parents_for_sync` / `pull_students_for_sync` server cursors are **EXCLUSIVE** (`updated_at > p_since`) — the T-493 test models an inclusive cursor. With near-unique live timestamps (998 distinct in the first 1 000) the drain is complete, and the tie-guard stops honestly on uniform bulk pages; a tie straddling a page boundary would skip the tied rows — the same residual the T-493 tie-guard documents, now with the exact server semantics pinned.
3. **The personnel WRITE path** (Android-created workers reaching the server) remains the registered OFFLINE-400 residual — the desktop owns personnel writes.
4. The standing queue from the 146th session (TEST-504's mechanical guard source-scan test; the ARCH-001 remaining non-Personnel mock slots; the REALTIME-105 replay-on-remount residual).
