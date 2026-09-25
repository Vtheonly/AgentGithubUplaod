# T-408 Complete — Final System Archives (90th session, 2026-09-22)

The complete state of all three El-Imtiyaz repositories at the T-408 close-out
(main @ 68e85bf — the academic-setup unblock + the fake-data purge):

| Archive | System | Contents |
|---|---|---|
| `elimtiyaz-hub-AgentGithubUplaod-T408-complete.zip` | The hub: desktop staff app + the canonical Supabase backend + this documentation system | 1,781 files — the full source, the 111-migration chain, the legacy Excel workbook, all recovery documentation (excludes node_modules/.git) |
| `elimtiyaz-website-T408-complete.zip` | The parent web portal (Next.js) | The full source incl. the T-408 portal timetable view (excludes node_modules/.git/.next) |
| `elimtiyaz-android-T408-complete.zip` | The Android staff app (Kotlin/Compose) | The full source incl. the T-348 canonical subject-architecture mirror (excludes .git/build outputs) |

What T-408 delivered (the 89th + 90th sessions):
- ACAD-506/507/508 + SCHED-105/106 RESOLVED (the 89th session): class creation
  resolves the REAL academic_levels uuid; the SupabaseTeacherRepository
  bridges teachers onto personnel (no teachers table — SCHED-100/ADR-020);
  migration 0114 seeds the Algerian national catalog (14 matières + 127
  configurations, the OFFICIAL BEM scale); the portal timetable view.
- ACAD-509 RESOLVED (the 90th session): the synthetic academic-YEAR layer
  purged (the fabricated "ay-2025-2026" fallback pair, the stale "2025-2026"
  literals, mapSubjectRow's fake year denormalization, the dashboard's
  hardcoded four-year selector) — every creation surface guards the
  missing-year case; the year drawer derives from subject_configurations.
- The module/subject/matière census: ONE canonical Subject concept across
  Desktop/Supabase/Android/Website — no parallel model exists.

Evidence: docs/recovery/t-408-academic-setup-creation.md +
docs/recovery/t-408-live-verification.md + the live probe
elimtiyaz-desktop/scripts/t-409-live-year-payload-probe.py (8/8 GREEN).
