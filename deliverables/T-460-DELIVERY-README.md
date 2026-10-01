# T-460 DELIVERY — the 130th session: the UI-unification campaign, six passes (the owner's full-UI-consistency mandate)

**Session:** 130th (2026-10-02) · **Task:** T-460 (IN PROGRESS — passes 1/B/C/D/E/F
delivered; G–I registered) · **Merged at:** android main `72c780a` · hub main (this
delivery commit) — all pushed to origin.

## The mandate

The owner's issue: the full UI consistency audit & unification — every page and
sub-page onto the single modern design system (`ui/designsystem/`), the legacy
`ui/components/` + `ui/theme/` kits retired at the end. The audit's own priority
order was followed (§4 rule 6: the "two apps in one screen" hubs first).

## What was delivered (six passes, each: branch → commit → push → merge --no-ff → push main → branch deleted, per ADR-028)

1. **Pass 1 — the mixed files:** DashboardHubScreen (the last legacy import →
   ElTabRow), the shared T-297 AuditDiffSheet RELOCATED to features/settings +
   rebuilt on ElBottomSheet/ElTag/ElTheme (its 14-test suite moved with it, green),
   AuditLogScreen, DiagnosticsSection, ToggleRow. `e83b6f1`.
2. **Pass B — the global nav chrome (the route-model rewrite):** MainScreen onto
   ElScaffold/ElTopBar/ElBottomBar; HubTab gains a stable route; the index-based
   state model (tabHistory, deep links, RBAC) preserved untouched. `3927fd3`.
3. **Pass C — the Financials hub (the issue's worst offender):** 10 files — the
   5 legacy tabs, the shell, DebtDashboard (the T-456 « Par année » drawer + the
   T-457 §15.1 labels preserved on DS chrome), InstallmentSchedule, ProofScanner. `1892e5e`.
4. **Pass D — the Academics hub:** RollCall, GradeEntry (the quick-grade dialog on
   ElDialogShell), HomeworkPush, PromotionReview, the shell, AttendanceStatus. `041ddde`.
5. **Pass E — the CRM hub shell + the auth trio + global search:** Login,
   ChangePasswordModal (ElDialogShell), PermissionDenied, GlobalSearch. `7c5bbd2`.
6. **Pass F — the Personnel module:** the hub, EmployeeDirectory (the create dialog
   on ElDialogShell + ElChip selectors), TeacherWorkspace, AuditStream, Releve,
   SignOut. `db964dc`.
7. **En passant — the ARCH-012 release-gate repair:** the full `./gradlew test` was
   RED on main BEFORE this session (6 test classes failing on the release variant by
   the two documented ARCH-012 mechanisms — the exclusion list had rotted as six
   sessions landed tests without extending it). Extended 2→8 classes; lesson pinned
   in the android AGENTS.md. `42a7cb9`.

## The measured progress (the issue's own metrics)

- Feature legacy-kit importer files: **41 → 6** (all five hubs + the nav chrome +
  the auth trio now on the DS; the 6 remaining are ALL the CRM detail family —
  StudentDetail×3, ParentDetail×2, ParentYearHistorySection)
- MaterialTheme-reading feature files: **55 → 31** (the raw-M3 screens remain)
- The acceptance-criterion direction confirmed on every migrated surface: the
  T-456/T-457/T-458 debt contracts, the InfoTips, the RBAC gating, the deep-link
  mapping, every ViewModel — all preserved (each commit's Preserved field)

## Verification (the full session-final gates)

- `./gradlew compileDebugKotlin` — BUILD SUCCESSFUL
- `./gradlew test` — BUILD SUCCESSFUL: **debug 654/0 + release 617/0** (1 env-gated
  skip each; the release gate repaired this session)
- `./gradlew lint` — BUILD SUCCESSFUL (the baseline gate, zero new findings)
- Per-pass: compile + testDebugUnitTest 654/0 after EVERY pass (the count never
  dropped — no test lost or weakened)

## The zips (this delivery)

- `elimtiyaz-android-T460.zip` — the Android source tree at main `72c780a`
  (600 files; build outputs, .git, local .env and keystores excluded)
- `el-imtiyaz-all-systems-T460.zip` — `repo/` (the hub: docs + desktop + scripts)
  + `elimtiyaz-android/` (the app source) — 2,721 files. The website is unchanged
  this session and not carried in this archive (its latest zip: T-456-459).

## What remains (registered in T-460's Left — the next session's entry points)

- **Pass G:** the raw-M3 screens (Reports, Alerts, Profile, PersonnelDetail, the
  Routing trio, the Chat pair) + the CRM detail families (StudentDetail/ParentDetail
  — the heaviest legacy surfaces, ~2,800 lines)
- **Pass H:** the MaterialTheme-read + hardcoded-dp sweep on the migrated files'
  stragglers
- **Pass I:** the legacy `ui/components/` + `ui/theme/` DELETION — gated on ZERO
  references (must not run until the CRM family migrates)

Full evidence: T-460 in `docs/recovery/task-registry.md` + the change-log entry +
each commit's five-question body on the android main.
