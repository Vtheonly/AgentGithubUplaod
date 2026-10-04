# DELIVERY — T-495 (the 147th session)

## What this delivery is

The owner's token mandate — *"here are alll the tokens you need from infrastructure to test if it works make sure it works"* — executed end-to-end against the live backend: the **live verification of the T-492/T-493/T-494 delivery** (all three owner-gated legs from the previous delivery CLOSED) **plus a NEW defect discovered during the verification and fixed in the same session** (SYNC-303 — the row-typed RPC gateway-slice truncation). The delivery carries both repositories (the hub at `672aee0`, the android at `607d718`) plus **the T-495 APK** (`apk/el-imtiyaz-debug-T495.apk`) — the build the owner should install, because it carries the students-pagination fix the T-492-T-494 APK does not.

## The verification — 43 PASS / 0 FAIL

The runner: `elimtiyaz-desktop/scripts/t495-live-verification.py` (committed) — every leg drives the real Supabase stack through the app's OWN exact REST calls with the signed-in admin's JWT, run-unique FAKE-marked probes, zero residue. The record: `docs/recovery/t-495-live-verification.md`; the raw evidence: `docs/recovery/t-495-live-verification-evidence.txt`.

1. **The T-493 pull census (read-only):** every unbounded Android pull drains the FULL live population, call-for-call — installments **5,956 in 6 pages** (the tranche census the device will compute: FI 1,137 · T1 1,606 · T2 1,609 · T3 1,604), payments 2,198, ledger 3,342, parents 741, **students 1,137 in 2 pages** (at the fixed page size), personnel 18, departments 4, classes 6, subjects 16, expense_tickets 0, releve_entries 0. **The "tranches are incorrect" defect is verified gone at the data layer.**

2. **The T-494 Personnel convergence (read-only):** the live active personnel set is exactly **one real worker — Adam Cherif (PER-2026-82FB27)**; all 17 soft-deleted FAKE/probe rows are also `is_active=false` (the app's display filter and the desktop's agree); the demo-seed ids are **UUID-impossible server-side** (the `22P02` rejection on the id filter is the proof — the exact-id eviction can never touch a server row); releve_entries is 0 (the honest-empty Activité tab). **After the owner's device syncs, the Personnel section shows the server's truth — no mock data.**

3. **The T-492 expense round-trip (probe + zero residue):** the create push (201, under RLS, the dispatcher's exact call shapes) → the app's pull returns it (the category embed + both translation directions) → **the desktop's exact read sees it** (the owner-gated "Android submit → desktop visible" leg CLOSED) → the transition contract (the self-approval block, the originator's fields unchanged, the state-transition audit append) → the replay contracts (the genuine replay is a no-op; stale/divergent replays are rejected by the WEAK-030 state machine) → zero residue.

## The new fix — SYNC-303 (android `607d718`)

**Discovered live during the census leg:** the Supabase API gateway slices **row-typed RPC responses** (`RETURNS TABLE(...)`) at its max-rows setting (**1,000** on this project) whatever `p_limit` says — `pull_students_for_sync` answered `p_limit=5,000` with EXACTLY 1,000 rows (`Content-Range: rows 0-999`), while the jsonb-returning payments/ledger RPCs pass through whole (verified at 2,198 / 3,342). The T-493 drain mistook the sliced 1,000-row page for a completed short page: **the device held 1,000 of the 1,137 students — silently truncated** (the same defect class as the original tranches report, surviving on the RPC path).

**The fix:** the new `ROW_TYPED_RPC_PAGE_SIZE = 1_000` — the parents/students pair drains at a page ≤ the gateway slice, so a full page stays FULL and the cursor keeps advancing. **Proven live: 1,137 students in 2 pages, all ids distinct.** Pinned by `PullPaginationT495Test` 6/6 (including the regression guard that pins the OLD config's truncation as the defect) and by the runner's permanent discovery check.

**The Android battery with the fix:** `./gradlew test` — 766 debug + 693 release / 0 failures / 1 documented skip each (baseline 760/687 + the six new tests); `./gradlew lint` green; `./gradlew assembleDebug` green.

## What remains (honest)

1. **The live-device eyeball** — install `apk/el-imtiyaz-debug-T495.apk` (NOT the T-492-T-494 APK), sign in, and: the expenses form works (tappable from the start, per-field errors); the tranche numbers reflect the full population; the Personnel list converges on Adam Cherif (and shows real workers as they are created on the desktop). The one-line device check: after a sync cycle, the students/CRM count is **1,137** and the dashboard's tranche dossiers match the desktop's.
2. **The boundary-tie residual (registered):** the parents/students server cursors are EXCLUSIVE (`updated_at > p_since`) — boundary timestamp ties can skip tied rows (the tie-guard covers uniform pages; the live data is near-unique: 998 distinct stamps in the first 1,000).
3. **The personnel WRITE path** (Android-created workers reaching the server) remains the registered OFFLINE-400 residual — the desktop owns personnel writes.
4. The standing queue: TEST-504's mechanical guard; the ARCH-001 remaining non-Personnel mock slots (performanceReviews, aiConfig, clubs, psychology, orthophonie); the REALTIME-105 replay-on-remount residual.

## How to test on the device

Install `apk/el-imtiyaz-debug-T495.apk`, sign in, then:
1. **Finances → Dépenses → Nouvelle dépense** — fill and submit; the button is tappable from the start; after the next sync the ticket is visible on the desktop's approval queue (verified live: the desktop's exact read sees Android-submitted tickets).
2. **The dashboard / Tranches** — after the first online sync cycle, the wave numbers are computed on the full 5,956-installment population, matching the desktop by construction.
3. **Personnel → Employés** — after the first online sync cycle, the 5 mock workers are gone; the list shows the server's personnel (currently: Adam Cherif).
4. **CRM / Students** — the roster now carries all **1,137** students (the T-492-T-494 APK silently held only the first 1,000 — the SYNC-303 fix this build carries).

## The zips

- `AgentGithubUplaod-T495.zip` — the hub (the desktop system + all documentation + the verification runner and evidence)
- `elimtiyaz-android-T495-session.zip` — the Android repo + `apk/el-imtiyaz-debug-T495.apk`
