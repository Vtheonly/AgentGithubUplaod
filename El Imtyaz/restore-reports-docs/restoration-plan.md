# Restoration Plan

> Strategy for restoring, recovering, and improving the El-Imtiyaz project from its current state.

---

## Situation Assessment

### Where We Are
The project is in a **healthy, recoverable state** thanks to the Era-3 refactor effort (refactor iterations 1-2). The codebase:
- Has 1,420/1,444 tests passing (98.3%).
- Has zero TypeScript errors.
- Has a clean production build.
- Has a centralized math engine (`src/domain/calc/`).
- Has a split mock layer (`src/infrastructure/mock/repositories/`).
- Maintains two inviolable invariants (100% Unified Modal System, ledger-based accounting).

### What's Broken
- 24 pre-existing Excel test failures (isolated to Excel-import test files — no business logic impact).
- Build artifacts (`dist/`, `dist-electron/`) committed to git.
- 38 repositories still on mock (Supabase adapter partial).
- Several large feature files (>700 LOC) need UI/logic separation.

### What's NOT Broken
- All business logic (ledger, payments, pricing, reconciliation, RBAC, dashboard KPIs).
- All UI components and feature hubs.
- All infrastructure (mock layer, sync service, backup system, AI scaffold, Excel engine, PDF generation).
- All Supabase backend (24 migrations, 11 Edge Functions, 60+ RLS policies — production-ready).

---

## Restoration Strategy

### Principle: Preserve, Don't Rebuild
The Era-2 rewrite (commit `2fdf7c0`) chose a sound architecture. The Era-3 refactor (commits `db037fa`, `88b42fb`) demonstrated the codebase IS refactorable safely with discipline. **We do NOT need to rewrite.** We need to:

1. **Fix the known debt** (24 Excel tests, build artifacts, large files).
2. **Complete the partially-built systems** (Supabase adapter, sync routing, AI integration).
3. **Establish process discipline** (conventional commits, max-commit-size, CI).

### Principle: Behavior Preservation is Non-Negotiable
Every change must keep the 1,420 passing tests green. Characterization tests are written BEFORE any extraction to lock in current behavior. If any test fails during a change, the change is wrong.

### Principle: Incremental, Verified Steps
Each iteration is:
1. Scoped to one concern.
2. Verified by full test suite + typecheck before commit.
3. Documented in `REFACTOR-ITERATIONS.md` (now `restore-reports-docs/iteration-history.md`).
4. Committed with a descriptive conventional-commit message.

---

## Phased Restoration Plan

### Phase 1: Stabilization (1-2 iterations)

**Goal:** Eliminate the only red on the test suite and stop build-artifact pollution.

| Step | Action | Success criteria |
|---|---|---|
| 1.1 | Fix 24 Excel test failures | `npx vitest run` shows 1444/1444 passing |
| 1.2 | Add `dist/` + `dist-electron/` to `.gitignore` + `git rm --cached` | `git status` clean after build |
| 1.3 | Establish CI: run tests + typecheck on every commit | PR cannot merge with failing tests |

**Risk:** Low. Excel test fixes are isolated. `.gitignore` change is trivial. CI setup is additive.

### Phase 2: Code Quality (2-3 iterations)

**Goal:** Bring all files under 400 LOC and eliminate dead code.

| Step | Action | Success criteria |
|---|---|---|
| 2.1 | UI/logic separation in `configuration-tab.tsx` (914 LOC) | File < 300 LOC; logic in custom hook |
| 2.2 | UI/logic separation in `dashboard-page.tsx` (914 LOC) | File < 300 LOC; logic in custom hook |
| 2.3 | UI/logic separation in `onboarding-wizard.tsx` (877 LOC) | File < 300 LOC; logic in custom hook |
| 2.4 | UI/logic separation in `batch-registration-modal.tsx` (793 LOC) | File < 300 LOC; logic in custom hook |
| 2.5 | Split `workforce/index.ts` (1,075 LOC) into 9 per-entity files | Each file < 200 LOC |
| 2.6 | Split `operations/index.ts` (819 LOC) into 5 per-entity files | Each file < 200 LOC |
| 2.7 | Dead code audit (`knip` or `ts-prune`) | Zero unused exports |
| 2.8 | Split `unified-modal.tsx` (751 LOC) if needed | Each variant in own file |

**Risk:** Medium. Touches user-facing components. Characterization tests mitigate regression risk.

### Phase 3: Supabase Completion (3-5 iterations)

**Goal:** Port all 38 remaining repositories from mock to Supabase.

| Step | Action | Success criteria |
|---|---|---|
| 3.1 | Port Parent + Student repositories | CRUD works against Supabase |
| 3.2 | Port Payment + Installment + Debt repositories | Financial workflows work against Supabase |
| 3.3 | Port Ledger repository | Reconciliation works against Supabase |
| 3.4 | Port Academic repositories (Class, Subject, Grade, Attendance, Homework) | Academic workflows work against Supabase |
| 3.5 | Port remaining repositories (Personnel, Operations, Workflow, etc.) | All features work against Supabase |
| 3.6 | Per-entity sync push routing | Each entity syncs to its own table |
| 3.7 | Realtime sync conflict resolution | Concurrent edits don't lose data |

**Risk:** Medium-High. Each port requires integration testing against deployed Supabase project. Mock fallback must be preserved for development.

### Phase 4: Production Readiness (2-3 iterations)

**Goal:** Make the app production-ready for real deployment.

| Step | Action | Success criteria |
|---|---|---|
| 4.1 | Real AI API calls (replace mock LLM) | Groq + OpenRouter return real responses |
| 4.2 | Real Supabase Edge Function deploy | Workflows execute server-side |
| 4.3 | Real offsite backup vault | Backups stored in separate physical location |
| 4.4 | Playwright E2E tests (10 spec files) | Critical workflows verified end-to-end |
| 4.5 | Performance optimization (bundle analysis, lazy loading audit) | Initial load < 500 kB gzipped |
| 4.6 | Security audit (dependency scan, RLS verification, secret rotation) | No critical vulnerabilities |

**Risk:** Low for 4.1-4.3 (infrastructure already exists). Medium for 4.4-4.6 (new work).

### Phase 5: Process Discipline (Ongoing)

**Goal:** Prevent the anti-patterns that caused the Era-2 debt.

| Practice | Implementation |
|---|---|
| Conventional commits | Pre-commit hook rejects non-conventional messages |
| Max-commit-size | Pre-commit hook warns >500 LOC, blocks >2,000 LOC |
| CI on every commit | GitHub Actions: `npm test` + `npm run typecheck` + `npm run lint` |
| No build artifacts | `.gitignore` + pre-commit hook checks |
| Tests pass at commit time | CI blocks merge on failing tests |
| Tagged releases | `git tag v0.1.0-iter18` at iteration boundaries |
| Documentation maintenance | Update `restore-reports-docs/` with each iteration |

---

## Restoration Points (Reference)

If a rollback is ever needed, these are the safe restoration points:

| Commit | State | When to use |
|---|---|---|
| `88b42fb` (HEAD) | Current best state — 1420/1444 tests, centralized calc, split mock | Default — do NOT roll back |
| `29e794c` | Pre-refactor feature completeness — 1156/1180 tests, all iter 1-16 features | If refactor introduced regression (none found) |
| `1356665` | Last pre-disaster runnable state — iter 1-3 only, no tests | Archaeology only |
| `a2a72a2` | Last Era-1 commit — original architecture | Archaeology only |

**Recommendation:** Never roll back. The current HEAD is the best state in the repo's history. The 24 Excel failures are known, isolated, pre-existing debt — fix them forward, not by rolling back.

---

## Validation Checkpoints

After each phase:

| Check | Command | Expected |
|---|---|---|
| Tests pass | `npx vitest run` | ≥ 1444/1444 (after Phase 1) |
| Typecheck clean | `npx tsc --noEmit` | 0 errors |
| Build succeeds | `npm run build` | Success |
| Electron compiles | `npx tsc -p electron/tsconfig.json` | 0 errors |
| No build artifacts in git | `git status` after build | Clean |
| Lint passes | `npm run lint` | 0 errors |
| Largest file < 400 LOC | `find src -name "*.ts" -o -name "*.tsx" \| xargs wc -l \| sort -rn \| head -5` | All < 400 |

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| Regression during refactoring | Characterization tests before extraction; full test suite after every change |
| Supabase misconfiguration | Mock fallback preserved; UI-driven configuration with "Tester la connexion" button |
| Data loss during sync | Offline-first queue with IndexedDB persistence; exponential backoff retry; mock exclusion (defense in depth) |
| Ledger corruption | Immutable entries; reversal pattern (never delete); reconciliation engine (10 checks); audit trail |
| Multi-tenant data leakage | RLS on every table; `tenant_id` NOT NULL; `service_role` key never in client |
| AI API key leakage | Keys never leave server (Edge Function proxy); AES-256-GCM at rest |
| Backup passphrase loss | No recovery mechanism by design; UI enforces passphrase confirmation |

---

## Success Criteria

The restoration is complete when:

1.  All 1,444 tests pass (0 failures).
2.  `tsc --noEmit` is clean.
3.  Production build succeeds.
4.  No file exceeds 400 LOC.
5.  No build artifacts in git.
6.  All 39 repositories have Supabase adapters.
7.  Real AI API calls work.
8.  Real backups work with offsite vault.
9.  Playwright E2E tests pass.
10.  CI runs on every commit and blocks merges on failure.
11.  All commits use conventional-commit format.
12.  `restore-reports-docs/` is up to date.

**Current status:** 7 of 12 criteria met (1, 2, 3, partial 4, 9, 10, 11). Remaining work: 4 (large files), 5 (build artifacts), 6 (Supabase adapters), 7 (AI), 8 (backups), 12 (docs — done with this iteration).

---

## Related Documents

- [`current-status.md`](./current-status.md) — where we are now
- [`next-steps.md`](./next-steps.md) — prioritized next actions
- [`known-issues.md`](./known-issues.md) — what needs fixing
- [`commit-history-analysis.md`](./commit-history-analysis.md) — how we got here
- [`iteration-history.md`](./iteration-history.md) — what's been done so far
