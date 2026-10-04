# T-489 / T-490 / T-491 — The 145th Session Delivery (2026-10-04)

## What this delivery is

The owner's two-part mandate, executed and verified:

1. **T-489 (UI-330) — the Android first-page decluttering.** The owner's
   report: *"the first page feels a bit messy… a long list of frais d'appel
   for students, followed by payment, ID, transaction, and other sections
   that I do not think need to take up so much space… relocate anything
   that is not really important from the main page, or turn those sections
   into cards or quick-access buttons… keeping all existing features
   available."*
   - The Vue d'ensemble tab's heavy analytics block (the 3 giant tranche
     wave cards with 2×3 metric grids + reconciliation lines + category
     chips, the 4 mini stat tiles, the category-repartition list) is
     replaced by **ONE compact `DashboardCollectionSummaryCard`**: the
     global collected % + the ENCAISSÉ/EN COURS/RESTE DÛ trio + one thin
     meter line per wave T1/T2/T3 (status tag + days-late) + the
     **"Analyse détaillée"** button that opens the Analytique tab.
   - The payments/notifications feed compacts to **2 single-line payment
     rows + one unread summary row** with a **"Tout voir"** path to the
     Alerts inbox (a route that existed but was never wired).
   - The alerts section shows the **2 most urgent** + "Voir tout".
   - **Every relocated surface stays available**: the Analytique tab is
     byte-untouched (the full wave hero, the stat strip, the mixes, YoY,
     the aging composition, the funnel, the Pareto, the demographics);
     the Finance journal holds the payment detail; the Alerts inbox holds
     the full lists.
   - Evidence: the new `DashboardOverviewStructureT489Test` 8/8 + the
     committed Robolectric render `app/src/test/screenshots/
     t489-compact-first-page.png` + the FULL gate (`./gradlew test`)
     **718 debug + 653 release tests, 0 failures** + lint green.
     **Status: RESOLVED-TESTED** (the live-device eyeball is the owner's —
     the APK is included below).

2. **T-490 — the extensive equivalence verification (VERIFIED, all three
   legs green):**
   - **The Android corpus suites** (the REAL Kotlin engine):
     `AndroidEquivalenceTest` 1/1 (the 41-scenario financial corpus —
     payments, refunds, waterfall allocation, discounts, reconciliation,
     idempotency, year-history) + `CrossPlatformEquivalenceTest` 3/3 (the
     13-chart analytics-visuals corpus — the exact dashboard statistics
     derivations).
   - **The LIVE read-only database equivalence**: `LiveDatabaseEquivalenceTest`
     — **PASSED LIVE** with the owner-supplied credentials: the Android
     StatisticsEngine's output equals the live database's own SQL
     aggregates on **every value** (count/total/mean/median/σ/min/max/best
     month, the category mix, the per-installment INV-4 aging census, the
     recovery funnel, outstanding, the dynamic overdue, the collection
     rate, the class census). The T-449 corpus pins (2 198 ops /
     16 271 300 DZD / 46%) still hold — zero production drift, and the
     test **cannot modify the database** (the truth SQL wraps in
     BEGIN…ROLLBACK; the PostgREST legs are GETs).
   - **The desktop battery**: typecheck 0 errors · vitest **4 787 passed /
     0 failed / 5 skipped** (byte-identical to the registered baseline) ·
     Layer 2 the financial-equivalence pipeline **GREEN** (820
     deterministic scenarios; the tier-4 desktop-vs-mirror comparison 0
     errors / 0 warnings; the 36 skips are the documented PARITY-005 set).

3. **T-491 (TEST-504) — the session's discovery, fixed same-session.**
   Running the FULL `./gradlew test` (not just the debug variant) exposed
   that the Android release gate had been **red on main since the 133rd
   session** — T-463/T-464's MigrationTestHelper suites landed without the
   release exclusion entries (the 5th recurrence of the ARCH-012
   release-gate rot). Fixed; the gate is green again; the 5th-recurrence
   lesson is pinned in the android `AGENTS.md` §8.1 and the durable
   mechanical guard is registered owner-gated in the hub's TEST-504.

## The archives

| Archive | Contents |
|---|---|
| `AgentGithubUplaod-T489-T491.zip` | The hub repo (desktop app + canonical backend + the full documentation system) at `33b9e99` |
| `elimtiyaz-android-T489-session.zip` | The Android repo at `babeea5` + **`apk/el-imtiyaz-debug-T489.apk`** (install this to see the new first page) |

## Where everything is recorded

- `docs/recovery/task-registry.md` — T-489 (TESTED), T-490 (VERIFIED), T-491 (VERIFIED)
- `docs/recovery/problem-registry.md` — UI-330 (RESOLVED-TESTED), TEST-504 (RESOLVED-TESTED)
- `docs/recovery/change-log.md` — the 145th-session entry
- `docs/recovery/next-task.md` — the session record + the standing queue

## What remains (the honest list)

- **T-489's live-device eyeball** — install the APK, look at the first
  page, confirm it feels right (owner-gated; no emulator in the session's
  container).
- **TEST-504's mechanical guard** — a source-scan test that makes the
  release-exclusion same-commit rule mechanically enforced (owner-gated,
  small, self-contained).
- **A transient flake observed (not introduced) this session**:
  `RealtimeSyncT069Test` flaked once across ~6 full/filtered runs
  ("Key chat_messages is missing in the map"), green in isolation and in
  the clean full re-run — the suite carries a documented race history
  (android AGENTS.md §5 lesson 3). Recorded in the visual-record commit.
- The standing queue from prior sessions (ARCH-001's remaining mock
  slots, the REALTIME-105 replay-on-remount residual, the website's
  drifted functions).

## The commits (all merged to main and pushed)

- Hub: `7ecbe14` (the registration) → `0169e0f` · `d06c63c` (the
  closeout) → `33b9e99` · the delivery commit (this one).
- Android: `650f94e` (the fix) → `bb59f67` · `11639b4` (the gate repair)
  → `d3d2591` · `796bab9` (the §8.1 lesson) → `5d86ed7` · the visual
  record → `babeea5`.
