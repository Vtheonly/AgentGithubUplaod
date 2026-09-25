# Multi-Agent Worklog

---
Task ID: T-413-session-open
Agent: main (Super Z)
Task: T-413 — Student Approval, Enrollment, Portal/Messaging Synchronization & Cross-Section Navigation (repos: AgentGithubUplaod hub + elimtiyaz-website)

Work Log:
- Cloned both repos: /home/z/my-project/repos/AgentGithubUplaod (hub, contains elimtiyaz-desktop/ + docs/) and /home/z/my-project/repos/elimtiyaz-website.
- Read hub AGENTS.md (all 55 rules incl. §15.1-53), website AGENTS.md, task-registry (head = T-411, T-412 taken by the concurrent agent), problem-registry, next-task.md.
- Baseline repair: the pristine origin/main tip had ONE tsc error (t-411-registration-remise.test.ts importing CreateParentInput from model/student without re-export — commit 2e0f589's omission). Fixed + committed + pushed (05766c9 → merged 1475592).

Stage Summary:
- T-413 did not exist in the registry; registered it during Phase 5 with STUDENT-100..104 problem entries.

---
Task ID: T-413-phase-1
Agent: main (Super Z)
Task: The backend phase — migration 0116 + the approve-signup-request EF student path.

Work Log:
- Migration 0116_student_application_approval.sql: §1 the student_application column; §2 the self-service attach (own-pending SELECT+UPDATE policies + the column-guard trigger with the service_role/no-JWT/staff bypasses); §3 the approve_student_application composite RPC (bind-or-create + the deterministic parent + ELV code + class enrollment + the academic history + REUSE approve_account_request); §4 parents_student_sees_own; §5 the channel's student gate.
- EF approve-signup-request: STUDENT-102 guard, the category guard, the parent↔student reclassification BEFORE the guards, the composite path.
- Live-caught defects (the E2E doing its job): (1) the RLS-500 zero-row false positive (the self-attach saved NOTHING — the SELECT-policy fold made the row invisible; fixed with the own-pending SELECT policy + read-back assertions); (2) the mutual-RLS recursion 42P17 (the direct students subquery in the parents policy; fixed with the is_own_parent_via_student SECURITY DEFINER helper); (3) the v_class.name NULL-record bug; (4) the GoTrue metadata-timing discovery (admin createUser returns app_metadata but the INSERT trigger sees it empty — the 0054 invite path's role capture never worked; every signup lands 'parent').
- Verified: t-413-apply.py --verify 19/19 (BEGIN/ROLLBACK incl. T9 the recursion regression); applied live atomically (chain head 0116) + re-applied the corrected body; EF deployed (smoke 401/401/401/CORS-200); t-413-student-e2e.py 20/20 zero-residue (both legs: the student composite + the family enrollment).

Stage Summary:
- Commits pushed: baseline repair (05766c9) + Phase 1 + the two harness scripts. Live chain head: 0116. Next free: 0117.

---
Task ID: T-413-phases-2-3
Agent: main (Super Z)
Task: The desktop phase — the approval repository/UI + the Pedagogy search + the 3-dot menu.

Work Log:
- supabase-approval-repository.ts: the student matching (the activation-code student_id + the application name against the CANONICAL students table) + approveWithExistingStudent/approveWithNewStudent.
- approvals-tab.tsx: the application card, the student flows (bind-existing search / create+enroll with the level-scoped class picker + the family resolution), the ReclassifyToggle, the validation gates.
- academics-page + students-directory-tab (NEW): the « Annuaire élèves » tab (canonical search: name/ELV/family/class/level + filters + the deep link).
- shared/ui/student-actions-menu.tsx (NEW): the standardized 3-dot menu (CRM / Pédagogie / family dossier / family finance / class — context-less actions never render) mounted on the CRM students table + the class roster + the directory.
- financials: the /financials?familyId= deep link + the installments family filter chip (the initialCategory pattern).
- Tests: t-413-student-approval.test.ts 28/28 + t-413-cross-section-navigation.test.ts 16/16; the updated source-scan guards (t-264: 7 maybeSingle sites; t-331: the multi-branch submit gate). Full gates: tsc 0 / eslint 0 / FULL vitest 3 939 passed with the 25-fail set byte-identical to the pristine-tree runs (stash-verified on both halves — the documented baseline + the concurrent T-412 additions; zero regressions).

Stage Summary:
- Commits pushed: b8f08d6 (Phases 2-3, 14 files, 2009 insertions). The concurrent agent's docs push merged cleanly.

---
Task ID: T-413-phase-4
Agent: main (Super Z)
Task: The website phase — the student-bound resolution + the application form.

Work Log:
- auth-provider.tsx: after the parent miss, resolve the caller's OWN student row (students_student_self) → self-scoped childrenList + the family row (parents_student_sees_own). The billing surfaces stay parent-role-gated (UNKNOWN-024 registered).
- student-application-form.tsx + student-application.ts (NEW): the pending-screen form (reads the own pending request, PATCHes ONLY the column, the zero-row guard, session re-resolve) + the canonical 13-code grade-level list.
- pending-activation-screen.tsx: mounts the form (pending variant only).
- database.ts: the student_application column + the payload type. dictionary.ts: 18 application.* keys × fr/ar/en.
- Gates: vitest 657/657 (9 new T-413 tests) + tsc 0 + lint clean + build green (the strict build caught the phase-narrowing issue the vitest esbuild pass absorbed — §15.25 again).

Stage Summary:
- Website commit pushed: 5c530b6.

---
Task ID: T-413-phase-5
Agent: main (Super Z)
Task: The documentation/registry closeout + the packaging.

Work Log:
- problem-registry.md: STUDENT-100..104 (all RESOLVED/TESTED with evidence).
- task-registry.md: the full T-413 entry. t-413-live-verification.md (NEW): the complete evidence record.
- AGENTS.md §15.55 (NEW): the GoTrue metadata-timing trap + the mutual-RLS recursion + the zero-row read-back rule.
- change-log.md, next-task.md (next free migration 0117), unknowns.md (UNKNOWN-024: the financial-visibility-for-students owner decision).
- Commits pushed: f913009.

Stage Summary:
- T-413 stands IMPLEMENTED / TESTED (live legs verified). Remaining VERIFIED gates: the owner's packaged-app UI pass + the UNKNOWN-024 decision + the Android consideration.
