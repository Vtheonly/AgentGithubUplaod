# DELIVERY — T-492 / T-493 / T-494 (the 146th session)

## What this delivery is

The owner's post-T-489-APK test report — *"The expenses section does not work (button grayed out). The tranches are incorrect, and the personnel section in the app is still using mock data instead of the real worker data."* — fixed end-to-end, with all three symptoms root-caused, repaired, tested, and documented. The delivery carries both repositories (the hub at `c455243`, the android at `f571ea1`) plus the built APK (`apk/el-imtiyaz-debug-T492-T494.apk`) for the owner's device test.

## The three fixes

### 1. The expenses section (UI-331 + SYNC-302 — T-492, android `5f6f993` merged `eec5bef`)

**The root cause ran deeper than the report suggested:** the submit button read `viewModel.canSubmit` — a plain getter — inside the button's recompose scope, a scope that reads no field state. Compose never invalidated that scope on typing, so the button computed `enabled=false` at first composition and **stayed disabled no matter what was typed**. The owner could never enable it; the "grayed out" report was literal.

The fix, at both levels:
- **The form** — every UI-affecting derivation is state-driven now (`missingFields` is a combined StateFlow collected in the button's scope, recomposing on every keystroke); the button is enabled whenever not submitting (never silently disabled); an invalid tap renders the desktop's exact zod messages per field ("Titre requis (min. 3 caractères)" / "Montant supérieur à 0 requis" / "Bénéficiaire requis"), shows a banner naming the missing fields, and scrolls the first offender into view; the under-button helper names the missing fields at all times.
- **The pipeline** — the expenses feature was 100% local-only before (the desktop's expenses never appeared on Android; Android submissions never reached the server). Now: `expense_tickets` is pulled (paginated, with the category embed, the desktop's T-093 translation layer ported verbatim), every local write enqueues, and the dispatcher pushes — the create path upserts the full row idempotently on the server PK; workflow transitions (approve/reject/disburse/settle) write ONLY the transition columns, so an Android approval can never rewrite the originator's title/category/amount. The ticket number is now the desktop's `EXP-<year>-<6 base36>` convention (collision-checked locally and against the server), replacing a `count+1` sequence that violated the identity rules. Room v19→v20 adds the proof-attribution columns so pulled settled tickets render the full 4-stage timeline.

**Evidence:** `ExpenseSubmitT492Test` 6/6 (the owner's exact scenario), `ExpenseTicketTranslationT492Test` 11/11, `ExpenseSyncWiringT492Test` 4/4, `RoomSchemaUpgradeT492Test` 2/2.

### 2. The tranches (SYNC-301 — T-493, android `933d3e1` merged `1331356`)

**The root cause:** every unbounded pull capped at 2 000 rows while the live census holds **installments 5 963 / ledger 3 342 / payments 2 198** — the device computed every tranche statistic on an arbitrary truncated subset. (The T-490 equivalence verification had proven the ENGINE correct against live SQL — which is exactly why this hid: the engine was right, the device just never received the full population.)

The fix: the `drainByCursor` keyset drain on every unbounded pull — the plain-table paths loop on `id > cursor ORDER BY id LIMIT 1000` (installments drain in 6 pages), the four `pull_*_for_sync` RPC paths loop on the `p_since` cursor (with the bulk-timestamp tie-guard for import-shaped data), and a 60-page cap guards the loop. **After this fix, the device's tranche numbers are computed over the full population and match the desktop's by construction.**

**Evidence:** `PullPaginationT493Test` 9/9 (including the 5 963-row drain at the live census scale and the T-420 bulk-import tie shape).

### 3. The personnel mock data (DATA-059 — T-494, android `084e015` merged `2215302`)

**The root cause:** the demo seeder planted 5 mock workers + 3 demo families + mock timesheets on **every fresh install — including configured production builds** — and the upsert-only pulls never evicted them. Worse, the academic history seeded fabricated grades for **pulled REAL students** whenever the assessments table was empty.

The fix, in three layers:
- **The posture split** — the demo content now seeds ONLY in the demo-sandbox posture (unconfigured AND debug, the same policy as the demo login); a configured build's fresh install seeds only the real catalogs (pricing/subjects/classes).
- **The eviction** — after every pull cycle on a configured build, the exact seeded ids are deleted (exact ids and parent-scoped deletes only; the two LIKE patterns are proven UUID-impossible). This is **self-healing: the owner's existing device converges on its next online cycle** — the 5 mock workers disappear and the Personnel section shows the server's truth.
- **The releve pull** — the canonical `releve_entries` table (the desktop's own timesheet source) is now pulled, so the Activité tab shows real timesheets instead of the mock ones.

**Evidence:** `DemoSeedGatingT494Test` 5/5 (the eviction removes every demo row and keeps every real row — proven on a real Room instance with UUID-shaped survivors), `DemoHygieneWiringT494Test` 4/4.

**Note:** if the live personnel table is currently empty (the T-486 census archived the FAKE probes and found no real staff rows), the Personnel section will become honestly EMPTY — that is the documented correct pre-production state; the owner's real workers appear the moment they exist server-side (create them on the desktop).

## The gates

- `./gradlew test` (the FULL gate): testDebugUnitTest **760 / 0 failures / 1 documented skip** + testReleaseUnitTest **687 / 0 failures / 1 skip** — BUILD SUCCESSFUL
- `./gradlew lint`: green
- `./gradlew assembleDebug`: the APK in `apk/`
- The battery moved 718 → 760 across the session (42 new tests: 9 pagination + 23 expenses + 10 hygiene)

## What remains (owner-gated, honestly)

1. **The live round-trip** (Android submit → desktop visible) and the **on-device census** (the device's Room counts == the live table counts) — both need the live credentials (not supplied this session) or the owner's device.
2. **The live-device eyeball** of the fixed form and the Personnel section's convergence.
3. The personnel WRITE path (Android-created workers reaching the server) remains the registered OFFLINE-400 residual — the desktop owns personnel writes today.
4. The TEST-504 mechanical guard (the standing ask from the 145th session).

## How to test on the device

Install `apk/el-imtiyaz-debug-T492-T494.apk`, sign in, then:
1. **Finances → Dépenses → Nouvelle dépense** — fill the form; the button is tappable from the start; tap it with the title empty → the errors + the scroll; complete it → the submission (and after the next sync, the ticket visible on the desktop).
2. **Finances → Tranches / the dashboard's collection card** — after the first online sync cycle (a minute), the wave numbers reflect the full population (5 963 installments), matching the desktop.
3. **Personnel → Employés** — after the first online sync cycle, the 5 mock workers are gone; the list shows the server's personnel (empty if none exist yet — the honest state).
