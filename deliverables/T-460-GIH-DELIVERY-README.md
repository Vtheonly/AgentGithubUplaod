# T-460 DELIVERY — the 131st session: the audited passes G + I + H-part-1 (the legacy kit DELETED — DUP-003 closed)

**Session:** 131st (2026-10-02) · **Task:** T-460 (IN PROGRESS — the G/I/H1
milestone delivered; H part 2 + J registered) · **Merged at:** android main
`bba9157` · hub main (this delivery commit) — all pushed to origin.

## The session's mandate

The owner's re-audit mandate (before continuing pass G): *audit the entire app,
do not assume the registered G/H/I list is complete.* Delivered as **android
issue #3** (36.6 KB: 22 findings F-01..F-22 + 4 accessibility notes, each with
location/what/why/standard/change/dependencies/pass/test; scripted whole-tree
measurement over 119 feature files + manual per-screen reading). The audit
**corrected the pass G scope in three places** (SupabaseConfigDialog and
SubjectsDirectoryScreen were never registered; WorkflowMonitorScreen was
"quality bar" in name but half-raw in fact), found one **functional defect**
(the ProfileScreen sign-out bypassing authRepository.signOut — FCM tokens never
deactivated), and pinned the exact pass I gate (27 legacy files, 15 already
zero-importer, GreetingScreenshotTest the only test blocker).

## What was delivered (each: branch → commit → push → merge --no-ff → push main → branch deleted, per ADR-028)

1. **The F-01 sign-out fix (its own logic commit):** ProfileViewModel now calls
   authRepository.signOut() (runCatching-wrapped) before the session clear —
   the canonical FCM-deactivation order, mirroring MainScreen; pinned by a
   2-test source-anchored regression suite. `a0d0205 → 2ab2db9`.
2. **Pass G-a — the dashboard raw screens:** Reports, Alerts (tri-state
   loading/empty — the F-02 fix; French type labels, never raw codes), Profile
   (ElGradientStatCard session header; the DS form patterns), + the shared
   NotificationRow (the F-14 one-language rule for both alert surfaces — the
   hub section rebuilt on it). `4b51bc1 → 28a2ced`.
3. **Pass G-b — PersonnelDetail + the WorkflowMonitor completion:** the 510-line
   raw detail screen on ElScaffold/ElCard/ElDialogShell; the monitor's raw run
   cards + run-detail dialog + status chips on the DS (the T-231 node_results
   surface + retry contract preserved). `8252231 → fe7786e`.
4. **Pass G-c — the Routing trio + the Chat pair:** ElChip FILTER shift pills,
   tri-state vehicle list, ElDialogSheet trip details, the RouteCanvas colors
   theme-resolved as parameters (the honest offline-first Canvas architecture
   PRESERVED — no map SDK introduced), the chat composer on ElTextField +
   ElIconButton. `c4389ad → 38ebf98`.
5. **Pass G-d — the two audit-discovered additions:** SupabaseConfigDialog
   (ElDialogShell + ElTextField, the SEC-004 masking contract preserved) and
   SubjectsDirectoryScreen (522 lines — the create/edit subject forms on
   ElDialogShell + ElTextField; every Vault §05.01/§05.06/§05.07/§06.02
   contract preserved). `ecd6f1f → 45432bb`.
6. **Pass G-e — the CRM detail family (the campaign's heaviest legacy surface,
   ~3,081 lines):** StudentDetail (+ AcademicComponents), ParentDetail (+
   Dialogs + the T-456 YearHistorySection — its 4-test suite green
   throughout) on the DS; the 66 DEAD UI imports pruned from the genuine
   StudentDetailViewModel (the audit's F-15 was corrected on the issue — the
   file was never a misnamed screen). `f85cd80 → 1c14f58`. **The feature-side
   legacy-kit importers: ZERO (both grep gates).**
7. **Pass I — the gated deletion:** the F-22 gate re-verified immediately
   before deleting; **ui/components (27 files) + ui/theme (4 files) + the 5
   dead DS components (ElComposedRevenueChart, ElHeatmapGrid, ElSectionDivider,
   ElSkeleton ×4, ElVerticalTabList) DELETED — 2,917 lines**;
   GreetingScreenshotTest de-legacy-fied; the DS display/ElInfoRow recognized
   as canonical (the pass-G-e local duplicate removed). `870c60c → 79567ab`.
   **The DUP-003 two-kits era is closed: the app has exactly ONE component
   system.**
8. **Pass H part 1 — the token/convention sweep:** the 369
   MaterialTheme.typography reads unified on ElTheme.typography (grep gate
   zero); the 142 MaterialTheme.colorScheme reads → the ElColors semantic
   roles; TRIAGE_COLORS → ElChartPalette (the pinned T-289 rule); the
   DashboardHub school-year tag DERIVED from the calendar (the audit's only
   hardcoded-data point); the GlobalSearch no-results empty state.
   `84bf2f1 → bba9157`.

## Verification (the full gate at every step)

`./gradlew testDebugUnitTest` — **656 tests / 0 failures** (654 → 656 with the
F-01 regression pins; 1 env-gated skip, the documented LiveDatabaseEquivalenceTest
assumption) · `./gradlew testReleaseUnitTest` — **619/0** · `./gradlew lintDebug`
green · `./gradlew assembleDebug` — **SUCCESSFUL, 31.6 MB APK**. The two
zero-reference grep gates on both legacy kits. Contract pins kept green:
PushNotificationRoutingTest, YearHistoryTest, DebtAgingTest, InfoTip/StatsTips,
AuditDiffSheetTest (14), WorkflowRunContractT231Test, the §06.04 promotion
contract, T-362 honest-offline, T-064 dialog location.

**Environmental note (recorded for future sessions):** the container's rootfs
pressure intermittently fails Robolectric's native-runtime extraction
(/tmp/robolectric-* FileSystemException) when two heavy tasks share a run —
every such red was re-run green in isolation; the green numbers above are from
isolated runs.

## The honest remaining (registered on issue #3, precise scope)

- **H part 2:** F-10 — the 17 raw AlertDialogs on already-DS screens →
  ElDialogShell/ElTextField (ExpenseApproval ×2, PaymentDetail refund, RollCall
  date-picker, TranchesTab mark-paid); F-18 — the 7 android.widget.Toast sites →
  ElToast; the 62 raw sp literals.
- **F-19 (the 403 off-grid dp values): OWNER DECISION REQUIRED** (enforce
  ElTheme.spacing tokens vs bless on-grid literals) — no unilateral
  normalization was done.
- **Pass J:** F-11 session-surface consolidation (Profile vs SignOutScreen vs
  ProfileCard — where does the single surface live) and F-13 directory search
  parity (Employee/Classes/Subjects lack the search Student/Parents have) —
  both owner decisions.

## Contents

- `elimtiyaz-android-T460-GIH.zip` — the Android repo at `bba9157` (tree, no
  .git/build; secrets gitignored — the ROOT .env recipe is
  `/home/z/my-project/scripts/android-env.sh` per the android AGENTS.md §8.1).
- `el-imtiyaz-all-systems-T460-GIH.zip` — the hub + the Android repo (the
  website repo was not re-cloned this session; its last delivery remains
  `elimtiyaz-website-T456-459.zip`).
