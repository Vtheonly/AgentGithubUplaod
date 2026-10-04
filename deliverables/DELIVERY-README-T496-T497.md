# DELIVERY — T-496 / T-497 (the 148th session, 2026-10-05)

**The mandate:** "keep going" on the standing queue — TEST-504's mechanical guard + the boundary-tie residual the 147th session registered honestly.

## What is in this delivery

| Artifact | What it is |
|---|---|
| `AgentGithubUplaod-T496-T497.zip` | The hub repo (desktop + the canonical backend + the docs system) at `e5415f5` — migration 0143, the live verification runner + evidence, the closed registry entries |
| `elimtiyaz-android-T497-session.zip` | The android repo at `b941f1e` + **the T-497 APK** (`el-imtiyaz-debug-T497.apk` inside) |
| `el-imtiyaz-debug-T497.apk` | The standalone APK — **install THIS one** (the T-495 APK does not carry the composite keyset) |

## T-496 — TEST-504's mechanical guard (DONE, TESTED)

The 6th ARCH-012 recurrence is now mechanically impossible: `ReleaseExclusionGuardT497Test` — every suite importing `androidx.room.testing.MigrationTestHelper` must appear in the `testReleaseUnitTest` exclusion list (the import is the signal; comment-mentions don't count). **Its own discovery:** the guard passed VACUOUSLY until `build.gradle.kts` was declared a runtime test input — an exclusion-list edit left the task UP-TO-DATE (the RED-side proof: green in 16s before the declaration, correctly red in 9s after).

## T-497 — the composite (sort_key, id) keyset (SYNC-304: RESOLVED-TESTED, VERIFIED live)

The session's opening live pins found the four sync RPCs paginating on NON-UNIQUE cursors, with the owner's data sitting in every failure mode:

- **parents/students (EXCLUSIVE cursor):** a tie group straddling a page boundary is SILENTLY SKIPPED — the live students table holds 4 tie pairs (8 rows).
- **payments (INCLUSIVE cursor):** ALL 2 198 rows share ONE frozen bulk-backfill timestamp — the stuck cliff the day a uniform group exceeds the 5 000-row page.
- **ledger (BUSINESS-date key):** the table NEVER had an `updated_at` column — the Android cursor was NULL on every row (a silent single-page truncation past 5 000 rows), and the business-date key misses recently-updated old-dated rows on every incremental pull.

**The fix:** migration 0143 (applied live ATOMICALLY — rehearsed BEGIN…ROLLBACK clean first; each RPC gains `p_after_id` + the composite branch + the deterministic `ORDER BY sort_key, id`; the ledger gets the change-time column with the `touch_updated_at()` trigger; the NULL branch preserves each function's pre-0143 semantics — **your installed APK keeps working unchanged**, pinned live) + the Android `SyncKeyset` drain.

**The live verification: 27 PASS / 0 FAIL** (`docs/recovery/t-497-live-verification.md`): the four full-population drains (741 / 1 137 / 2 198 / 3 342 — distinct, monotonic, non-null cursors) · the straddle proof on the LIVE students tie pair · the uniform-group proof INSIDE the payments' frozen backfill · the installed-APK 3-arg compatibility on all four RPCs.

**The Android battery:** 775 debug + 702 release, 0 failures, 1 documented skip each (baseline + exactly the 9 new tests); lint green.

## The one-line owner check (the live-device eyeball)

Install the T-497 APK, sign in, let one sync cycle run, then check the dashboard numbers — the full populations (741 familles / 1 137 élèves) and the tranche statistics computed over them. If any stream looks short, the drain logs say so honestly now (every partial pull warns).

## Honest residuals (unchanged, registered)

- OFFLINE-400 (d): the personnel WRITE path (Android-created workers reaching the server) — the desktop owns personnel writes.
- ARCH-001's remaining non-Personnel mock slots; REALTIME-105's replay-on-remount.
- The desktop battery was not re-run this session (zero TS sources changed; the next desktop-touching session re-runs it).
