# Governance Documentation Summary (AGENTS.md, AGENTS_supabase.md, docs/)

**Task DOC-1 · Agent AG · Read-only.** Covers: AGENTS.md (1,109 lines, ~328 KB), AGENTS_supabase.md (48 lines), docs/ tree (agents, architecture, audits, decisions, domain, operations, recovery, testing).

## 1. AGENTS.md purpose and major rule systems

**What it is:** the "primary persistent operating manual for every AI coding agent (Claude, Codex, Copilot, or human)" — the entry point into a documentation/control system in `docs/`. 17 numbered top-level sections (§1–§17) plus two unnumbered mandate rules (`## Automatic Timetable rule — T-404`, `## Cross-Year Debt Aging rule — T-405`), plus ~110 accumulated numbered sub-rules under §15.

**The task-numbering system (T-numbers).** All work is tracked as `T-NNN` tasks in `docs/recovery/task-registry.md` — "the authoritative todo list… There is no other task list." 361 `### T-…` entries exist; IDs run T-001 → **T-548**. Tasks reference problem IDs (`SEC-xxx`, `DATA-xxx`, …) from `docs/recovery/problem-registry.md`. Work proceeds in numbered **sessions** (dated headers in `docs/recovery/next-task.md` reach "The 181st session, 2026-10-15"). Status flow: `OPEN → READY → IN_PROGRESS → IMPLEMENTED → TESTED → VERIFIED`; skipping statuses or claiming one without evidence is forbidden.

**Registration-before-code-change (§13).** "When you start a task: set it `IN_PROGRESS` in the task registry and identify it in `docs/recovery/next-task.md`" — before the first code change. §5 prescribes the 9-step lookup order before modifying code (task registry → problem registry → audits → source-of-truth → system-map/boundaries → domain rules → unknowns → ADRs → code).

**Session/closeout process** (`docs/agents/workflow.md`, 11 stages): `DISCOVER → UNDERSTAND → PLAN → VERIFY PLAN → IMPLEMENT → TEST → REVIEW DIFF → CHECK ARCHITECTURE → UPDATE DOCUMENTATION → COMMIT → UPDATE TASK STATUS`. Session-opening ritual: run the FULL suite + lint + typecheck (§15.14) and diff live `supabase_migrations.schema_migrations` against the local chain (§15.11). Closeout: update registries + change-log, write a per-task `docs/recovery/t-XXX-live-verification.md` for high-stakes changes, commit, push, then update session summaries.

**Push-first directive.** AGENTS_supabase.md §5: "Keep everything pushed/merged after each commit (owner rule)". `git-workflow.md` §5 (absolute history rules): never force-push, never rewrite/rebase-across/squash existing commits, never delete branches — amended by §15.59 (T-418/ADR-028): a branch ref may be deleted only after a containment census proves its tip is an ancestor of `main`.

**The commit-content rule (§14).** Every commit body must answer five questions — `Task:` / `Left:` / `Change:` / `Verified:` / `Next:` (plus `Problem:`, `Root Cause:`, `Preserved:`, `Affected:`, `Related:` for architectural/financial/security changes). Conventional-commit subjects; one task per commit.

**Other recurring rule systems:** Existing-Implementation-First (§6 — "most of this project's damage came from parallel implementations"); source-of-truth registry (§8); no duplicate implementations (§9 — port verbatim with provenance headers); cross-platform change protocol (§10); verification matrix incl. live-Supabase verification with `scripts/verify_t-XXX.sql` convention (§11/§11.1); documentation-update mapping (§12 — "Documentation lives ONLY in this repo's `docs/` tree"); uncertainty handling (§16 — record in unknowns.md, never guess).

**§15.NNN accumulation pattern.** §15 "What agents are FORBIDDEN from doing" is an append-only lessons-learned ledger: each significant session appends numbered "discoveries" rules citing T-number, problem ID, date, and session number. Numbering has drifted through three styles: inline list rules 1–41 (with duplicate numbers 24/25/26 added out of order), `###`-headed rules 42–85 (anomalies: 46/47 out of order, 84 missing, 75 duplicated), then `§15.86–§15.110` (15.98 and 15.101 each appear twice). **Approximate count: ~110 numbered §15 rules.** Collisions are so routine there is an explicit "numbering-collision protocol" (§15.43, extended in §15.102c).

**What the latest sections cover.** §15.98–§15.110 (T-517→T-548 era, Oct 2026): Google-OAuth debugging chain; Firebase-is-FCM-only separation; VAPID key-pair shape reading; Zod-4 JIT-vs-CSP; source-scan guards; local-date keys vs `toISOString()`; SECURITY DEFINER RPCs binding actor parameters; identity-form censuses; brand assets byte-identity; presentation layer as shared language; dashboard-grid track-sizing; form-primitive reset edges.

## 2. Section inventory

| Theme | Where | Approximate count |
|---|---|---|
| System/identity/repo topology | §1–§4 | 4 sections |
| Pre-change research discipline | §5–§10 | 6 sections |
| Verification (incl. live Supabase quirks #1–#14) | §11, §11.1 | 2 + 14 quirk blocks |
| Docs/task/commit process | §12–§14 | 3 sections |
| Forbidden actions & accumulated discoveries | §15 | ~110 numbered rules |
| Uncertainty / doc map | §16–§17 | 2 sections |
| Standing domain mandates | 2 unnumbered rules (T-404 timetable, T-405 debt aging) | 2 |

## 3. docs/ inventory

| Folder | Files | Purpose | Freshness |
|---|---|---|---|
| `docs/agents/` | 2 | `workflow.md` (11-stage), `git-workflow.md` (commit standard + history rules) | Current; stable |
| `docs/architecture/` | 5 | `system-map.md`, `source-of-truth.md`, `boundaries.md`, excel-format comparison, repository-migration scoping | **Mixed**: `source-of-truth.md` current (T-521/ADR-035/migration-0153 rows, 2026-10-13); `boundaries.md` largely holds; **`system-map.md` stale** ("audited 2026-08-28/29"; claims chain "0001–0044 (41 files)" and 13 EFs vs actual 152 files/0157 head and 16 EF folders) |
| `docs/audits/` | 12 | Verbatim read-only audit archives (86 + 99 findings → 145 consolidated problems) + dated audit reports 2026-08-30 → 2026-10-10 | Archival by design |
| `docs/decisions/` | 35 | **ADR-001 … ADR-035** — genuinely ADR-like (Status, Context, Problem, Decision, Alternatives, cross-references) | Current (ADR-035 dated 2026-10-13) |
| `docs/domain/` | 3 | `financial-rules.md`, `academic-rules.md`, `identity-rules.md` — canonical business invariants | Maintained |
| `docs/operations/` | 2 | `credentials.md`, `portal-google-oauth.md` | Current (census dated 2026-10-14) |
| `docs/recovery/` | 153 | **The process core**: `task-registry.md` (6,564 lines; 361 entries to T-548), `problem-registry.md` (8,670 lines; 571 problem-ID headings), `next-task.md` (1,882 lines; 181 sessions), `current-state.md`, `change-log.md` (5,063 lines), `definition-of-done.md`, `recovery-rules.md` (22 rules), `unknowns.md` (24 UNKNOWN entries), 86 `t-XXX-live-verification.md` evidence files, evidence folders | **Most current layer in the repo** |
| `docs/testing/` | 3 | `strategy.md`, `cross-platform.md`, `unified-architecture.md` (T-419/ADR-029 layer map) | Current |

## 4. AGENTS_supabase.md rules

A 48-line incident report from the T-376/OPS-314 era (2026-09-15): the fresh empty clone of the production DB looked perfect (95/95 migrations, 83/83 tables, 226/226 policies) but every authenticated read died with `500 54001 stack depth limit exceeded` — two transcription losses in the hand-written chain, fixed by migration `0099_rls_helper_security_definer_parity.sql`. Standing rules: (1) policy-affecting attributes are **structure** — byte-diff against live, never assume; (2) "N/N migrations applied" is **NOT** functional parity — only a live authenticated request proves it; (3) never widen a grant to match a permissive live default-ACL artefact; (4) never diagnose a fresh clone from the client console; plus migration-registration discipline and "keep everything pushed/merged after each commit."

## 5. Accuracy/drift assessment with concrete examples

The governance layer is **mostly accurate but has measurable drift in its "header" sections while its "tail" (recovery layer) is current** — consistent with an append-only process where new knowledge is appended at the end and early summaries are not rewritten.

1. **Migration-chain range stale in AGENTS.md §2/§3:** claims the canonical chain is "0001–0057"; the actual chain holds **152 files, 0001–0157**. AGENTS.md's own tail and `current-state.md` know the head is 0156/0157.
2. **`docs/architecture/system-map.md` stale:** "audited 2026-08-28/29", "migrations 0001…0044 (41 files)", "13 desktop EFs" — actual: 152 migration files, 16 EF folders.
3. **Counts stale in AGENTS.md §17:** "problem registry (145 problems)" — `problem-registry.md` now carries **571 entries** (the 145 was the 2026-08-29 consolidation baseline).
4. **AGENTS_supabase.md references that don't resolve:** `bash /home/mersel/Documents/Projects/export/run376.sh` (owner-machine path; no `run376.sh` at repo root) and "full credentials map in `file.md`" — **no `file.md`** in the repo.
5. **Verified-accurate claims:** `elimtiyaz-desktop/financial-tests/equivalence/` exists; `elimtiyaz-desktop/scripts/` contains `verify_t-376.sql`, `check-migrations-append-only.sh`, `test-baseline.json`, `run_verify_sql_live.sh` exactly as referenced; 86 `t-XXX-live-verification.md` files match the §11.1 convention.
6. **Governance vs. practice drift at the margins:** the repo's latest commit message is literally `new` (the junk-message class §14 forbids), and the working tree carries parallel artifact directories (`deliverables/`, `Excel/`, `.smartexport/`, `Context Report/`) outside `docs/` — nominally violating §12/§15.13 ("documentation lives ONLY in this repo's docs/ tree; never create parallel documentation"). (Note by Session-1 lead: `Investigation Archive/` and `Refactoring Unified/` are the owner-mandated exceptions under this investigation's charter.)

## 6. Constraints a future refactoring must respect

1. **Append-only migrations (hard, machine-enforced).** ADR-001 + §15.9 + recovery-rules #14: applied migrations are immutable; schema changes are NEW migrations at the next free number; enforced by `check-migrations-append-only.sh` wired into `npm test`. Live-applied SQL must commit file + `schema_migrations` registration atomically (§15.10). Beware the stray live `0118` (UNKNOWN-028) and concurrent sessions applying migrations before pushing files (§15.87a).
2. **Registration-before-code-change.** Every change rides a T-number: task set IN_PROGRESS before code (§13). "Do not refactor speculatively — structural improvements happen as tasks with their own registry entries, not as drive-bys" (recovery-rules #7). A refactor will need its own task series.
3. **Evidence-gated statuses.** No `TESTED`/`VERIFIED` without recorded evidence in `change-log.md`; backend changes require live verification via the `verify_t-XXX.sql` convention and, for high-stakes changes, a `t-XXX-live-verification.md`. The **live DB schema is the authority — migration files are history** (§15.57c); session-open must diff live `schema_migrations` vs the local chain (§15.11).
4. **Commit & history discipline.** Five mandatory answers in every commit body; small, focused, one-task commits; push after commit; never force-push/rewrite/squash; branch deletion only after the §15.59 containment census.
5. **Canonical-path and cross-platform invariants.** No second implementations (§6/§9); financial mutations only through canonical RPCs (ADR-002); never weaken RLS / add `SECURITY DEFINER` to "make it work" (§15.4); `audit_logs` is append-only by trigger (§15.26); any shared-behaviour change must ship to all three platforms or be registered as a divergence (§10), with equivalence suites mandatory for financial/academic changes (§11).
6. **Test-baseline discipline.** `scripts/test-baseline.json` is the documented red/green census; any refactor that changes pass/fail counts must move the baseline to the TRUE merged count in the same change (§15.85c, §15.91d).
7. **Operational guardrails.** Owner-pinned admin credential must never be "repaired" (§15.23); secrets never committed; no destructive probes against real business rows (§15.38 — use FAKE-marked, purgeable, canonical-path test data, §15.50); unknowns block work (§16 — 24 open UNKNOWN entries); documentation updates are part of done (§12).
