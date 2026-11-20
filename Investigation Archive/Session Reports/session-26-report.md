# Session 26 Report — the pre-coding readiness audit (v2.2 sync, empirical baseline, charter, workbook)

**Date:** 2026-11-21 · **Mode:** STRICTLY READ-ONLY on application source, tests, migrations, scripts, package.json, `docs/`, `AGENTS.md`, `AGENTS_supabase.md` (Gate `G0` ACTIVE — Issue #32 at 0 comments, the 21st consecutive silent run). **Allowed writes:** `Investigation Archive/` + `Refactoring Unified/` only. **Zero production Supabase mutations** (every probe GET-only; keys in-memory; masked everywhere). Helper scripts and harnesses kept OUTSIDE the repo.

## 1. Scope executed (the six mandated tasks, in order)

1. **Bootstrap & gate check:** synced `main` (HEAD `c08b6fd1` — the owner's `new excel` commit; clean tree); read the archive's README/SESSION_LOG/handoff-25/Deep Sweep 14/the v2.1 triad end-to-end; GET Issue #32 → open, 0 comments (G0 locked — the discipline held all session).
2. **The Permanent Charter (Task 2):** `MIGRATION-CONSOLIDATION-AND-EGRESS-CHARTER.md` written (the five permanent rules + the S26 re-validation census + the egress-gap audit + the `0002+` recommendation); the verbatim AGENTS.md §11.6 / AGENTS_supabase.md §6.7 adoption draft staged at `AGENTS-CHARTER-AMENDMENT-DRAFT.md` (G0-gated — the governance files untouched); cross-references added to the RELOAD-GUIDE §A.0/§A.2, the RELOCATION-RUNBOOK Phase 0, LOCAL-FIRST-BLUEPRINT's header, and the v2.2 triad. **Registered OPS-020.** No migration was modified, regenerated, or re-consolidated.
3. **The read-only local audit (Task 3):** `npm ci --ignore-scripts` in `elimtiyaz-desktop/` (603 packages, gitignored — the first install on the post-consolidation tree, since S24 consolidated without `node_modules`); then the full ladder (§2 below); then the fresh-DB PGlite audit of `0001` (§3 below).
4. **The workbook inspection (Task 4):** SHA-256 comparison, the double openpyxl load, the dump diffs, the fixture-path check (§4 below).
5. **The v2.2 sync (Task 5):** 63 verified single-match replacements + 3 inserted sections across the triad + the relocation guide + the two local-first docs (§5 below).
6. **The integrity checks (Task 6):** the programmatic orphan check (197/197), the version/count consistency scan, the conflict-marker scan, the token-hygiene scan, the git-diff scope proof (§6 below).

## 2. The empirical post-consolidation test & build baseline (Task 3.1 — exact results)

| Check | Result |
|---|---|
| `npm ci --ignore-scripts` | OK — 603 packages installed, `node_modules/` gitignored (repo `.gitignore:2`) |
| `npx tsc --noEmit` | **EXIT 0 — zero diagnostics** (run twice; identical) |
| `bash scripts/check-migrations-append-only.sh` | **EXIT 0** — `append-only guard OK: 1 migration file(s) (+0 added vs origin/main, +0 new in worktree); 152 archived historical file(s)` |
| `npx vitest run src/tests/infrastructure/t-058-migration-append-only.test.ts` | **6/6 passed** (2.5s) — the suite runs the guard, which understands the consolidated layout; NO change needed |
| Full `npx vitest run` | **Test Files 33 failed \| 287 passed \| 1 skipped (321); Tests 29 failed \| 5116 passed \| 5 skipped (5150); Duration 626s; EXIT 1** |

**The 33 failed files decompose EXACTLY into 25 OPS-018 test-failing + 7 OPS-018 collection-error files + exactly ONE pre-existing red** (`src/tests/domain/t-502-wave-meter-thresholds.test.ts` — BUG-038's date bomb, red since 2026-10-16, T-549's fix). Every OPS-018-class failure traces to a stale `supabase/migrations/0NNN_*.sql` reference: **29 distinct ENOENT'd archived filenames** were observed, fully explained by the **39-site census** (35 literal + 4 constructed-path) in `OPS-018-COMMIT-1-BLUEPRINT.md` — which carries the copy-paste-ready Commit-1 spec (one `sed` pass + 4 segment edits; t-058's fixtures/guard constants excluded by design) and the five verification gates. **Commit 1 after G0 lifts is purely mechanical.**

## 3. The local from-scratch PGlite audit of `0001` (Tasks 2+3 — the egress charter's evidence)

Fresh PGlite 0.5.17 (PG 18.7 wasm) + the contrib extensions + the reconstructed `0000_local_compat` prologue (auth/storage/roles/supabase_migrations shims; `storage.foldername` returning `text[]`; the documented pgjwt skip-guard — created-never-called, grep-verified). **Single pass: 2,348 statements, ZERO failures.** Census EQUAL to Deep Sweep/14 Part C.3 on every axis: **99 tables · 14 views · 5 matviews · 147 functions · 90 triggers (89 public + the auth.users mirror) · 226 FKs · 512 indexes · 4 sequences · 242 public + 22 storage policies · 99 RLS-enabled tables · 11 buckets · 89 function grants · the realtime publication (6 memberships) · the canonical seeds (11/54/145 + the full system set) · `supabase_migrations` self-registered (1 row)** — and **zero duplicate class names**. The full census table + the method: `MIGRATION-CONSOLIDATION-AND-EGRESS-CHARTER.md` Part 2.

**Egress-gap audit (recorded, `0001` untouched):** (a) **`mv_grade_summary` has NO unique index** — chain-faithful (0021 created it; **0041:51 dropped the matview with it and never restored it**), and the `refresh_materialized_view` whitelist excludes the name — home: T-590/E7A-1 (ROADMAP 6.3's existing scope + the whitelist widening); (b) `sync_apply_batch` (T-593) and the parameterized year-range aggregations (T-590) are absent — **by design, queued for Stage A**; (c) `mv_dashboard_kpis` + `mv_debt_aging` are NOW()-anchored (confirmed empirically) — T-590's supersession targets. **Recommendation recorded: `0001` stays the pre-Stage-A baseline; Stage A ships as `0002_*.sql`+ beside it; re-consolidation is reconsidered ONLY after Stage A lands — never mid-flight.**

## 4. The NEW workbook inspection (Task 4 — the diff findings)

- **SHA-256:** `Excel/متابعة تمدرس التلاميذ.xlsx` = `15174e1b77e82e34e4878868d8a6d240fc7e93e6d5d827943b6e462e9bf69958` (195,516 bytes) — **BYTE-IDENTICAL to the Session 14 blank template** (`Excel_Inspection/source/…`). The owner's `new excel` commit (`c08b6fd1`) re-placed the same blank file at `Excel/`.
- **Double openpyxl load (formulas + cached values), every sheet/validation/defined name:** 8 sheets (none hidden) — the S14 set verbatim; **0 formula cells**; **all 8 values dumps byte-identical to S14's**; the formulas-dump format difference is cosmetic (S14 = full-grid empty-cell dumps; S26 = two-column catalogs; both zero formulas).
- **Content:** no student rosters, no marks/grades, no averaging weights/rules; the S14 structural model (block layout, column model, per-sheet subject lists) is the unchanged record.
- **Impact:** **T-563/T-566/T-567/D-13/BUG-064 UNCHANGED** — every S14 open question stays open (`تكنولوجيا`≡`INFORMATIQUE`, `تا / ج`, `ت اسلا`, `الوجبات` sic, the 4 missing subjects محاسبة/مناجمنت/القانون/الأسبانية).
- **`ETAT 2024 -205.xlsx`: NOT in the repository — still external-only** (only its S23 CSV dumps + structure JSON are archived under `Excel_Inspection/s23/etat-2024-205-NEWFORMAT/`); the T-603..T-611 fixtures must keep referencing it as an external owner-supplied path. The in-repo workbook set: `Excel/متابعة تمدرس التلاميذ.xlsx`, `Excel/2027-2026.xlsx`, `Excel/Suivis clients  2026_2027.xlsx`.
- Artifacts: `Excel_Inspection/s26/` (8×2 dumps, structure JSON, formulas catalog, the verdict JSON, the README record) — S14 provenance preserved (nothing under `csv/` or `source/` touched).

## 5. The v2.1 → v2.2 sync (Task 5 — self-contained, contradiction-free)

- **Stale counts fixed:** EXECUTION-PLAN §12 T-575 card + ROADMAP 6.10 + the RELOAD-GUIDE §A.2 — all now carry the consolidated-baseline figures (**1 migration `0001` / 99 tables / 14 views / 5 matviews / 11 buckets / 264 policies (242 public + 22 storage) / 147 functions / 90 triggers**); the RELOAD-GUIDE's verification SQL comments re-based (`expect 1` registration row, 99 tables, 264 policies, 11 buckets; the push step now applies the consolidated baseline, not the 152-chain); BLUEPRINT's §1.1/§11 framing + the risk-1 "chain side" note re-based.
- **All S24 §14 deltas folded inline at their cards:** T-594 (§3 Step 5.3 + ROADMAP 6.2 — ~120/h configured-mode only, mock silent by design); T-592/E7A-3 + ROADMAP 6.5 (ARCH-049's 30 instances/18 files); T-591/E7A-2 + ROADMAP 6.4 (BUG-069 tenant-scope + keyset/RPC); E2.4 (DUP-037 — the fifth billing site, mock batchRegister `:526-548`); T-569/§10 (C-24 — DB-side scope EMPTY, `class_subjects` stays); T-588 (C-25 — 13+ stores); T-578 (BUG-046's 7 synthetic sites + the `unified-payment-modal.tsx:283-285` root); T-561 (BUG-065's medical→support read-corruption precondition); T-587 (the flat/not-year-keyed `REAL_TUITION_BY_GRADE` + `REAL_FI_AUTISTE`; the corrected `:99-130` location); T-586 (the 96×3=288 stats-tips blocks + the ~34 user-visible sites).
- **Session 25 folded in:** OPS-019 homed (EXECUTION-PLAN §5 standing owner actions + §1 gates row + §12 register linkage + §15.1; ROADMAP 6.13 + the coverage row; BLUEPRINT §18.1); D-21 in the §5 digest; the widened OPS-012 recorded in §5.
- **The §6 register counts fixed:** the stale `184`/`190` header + registered-set line now read **197 IDs, zero orphans** (S23+S24+S25+S26 additions + the next-free pointer `DEAD-027/DUP-040/ARCH-052/BUG-072/OPS-021`); ROADMAP's coverage map carries OPS-019/OPS-020 rows; BLUEPRINT's coverage note updated to 197.
- **The OPS-015 hard ordering locked everywhere:** EXECUTION-PLAN §15.4, BLUEPRINT §18.4, ROADMAP standing rule 6 — **no live builds / CI/deploy targets / cap lifts on either project until T-559 + T-560 (five sites) + T-594 are coded and locally verified.**
- **ROADMAP 1.1 / EP §3 Step 3** now carry the OPS-018 note (the Commit-1 blueprint reference) until Commit 1 runs.

## 6. The integrity checks + the Go/No-Go readiness verdict (Task 6)

- **Orphan check (programmatic, range-aware — the S24 method):** the register's 197 IDs (DEAD 23 + DUP 36 + ARCH 49 + BUG 69 + OPS 20) all map into ROADMAP and/or EXECUTION-PLAN and/or BLUEPRINT — **0 orphans.**
- **Version/count consistency:** unified `v2.2` labels across the triad; no stale `184`/`190`/`152 migrations / 100 tables / 10 buckets / ~331` assertions remain in the operational docs (the Sessions-1-23 historical framing is explicitly labeled historical in BLUEPRINT §17/§1.1); T-549..T-611 complete; no internal contradictions found by the scan.
- **Conflict markers (`<<<<<<<`/`=======`/`>>>>>>>`):** zero across the archive + the triad. **Token hygiene:** zero key-shaped strings in every file written this session (the masked-probe discipline held).
- **`git diff --name-only` scope proof:** every modified/added file lives under `Investigation Archive/` or `Refactoring Unified/` — zero files outside (see the commit bodies; `git status` clean apart from them).

**The Go/No-Go verdict: GO — CONDITIONALLY, on exactly these owner actions (nothing else blocks Commit 1):**

1. **Lift Gate `G0`** — comment on Issue #32 (or instruct the next session) to green-light execution; the first act is the OPS-018 Commit-1 blueprint (mechanical, fully specified).
2. **D-21 (the Google-side OAuth step):** add `https://gvuvibcsfjhwcjikgxql.supabase.co/auth/v1/callback` (+ the origin) to the OAuth client wired into the NEW project's Supabase; confirm the consent screen's branding/audience — the Supabase side is already fully wired (OPS-019).
3. **OPS-012 (the rotation):** once OAuth is complete, rotate the COMPLETE pasted credential set (both Supabase projects' keys + both management tokens + the GitHub PAT + the Vercel PAT + the Firebase key).
4. **⏵ defaults (D-5, D-6, D-8..D-16, D-20):** confirm or override in Issue #32 if anything should differ from the staged defaults.
5. **OPS-015 discipline (a non-action):** keep the spend cap on `vebfehrpzajhstyhinnw` in place and point NOTHING live at `gvuvibcsfjhwcjikgxql` until T-559 + T-560 + T-594 are green locally.

## 7. What this session did NOT do (and why)

- No application source, test, migration, script, `package.json`, `docs/`, `AGENTS.md`, or `AGENTS_supabase.md` file was modified (G0 ACTIVE; the charter amendment is staged, not applied).
- No migration was regenerated or re-consolidated (the mandate forbade it); `0001` was audited byte-untouched.
- No Supabase write of any kind (GET-only probes; the schema verification ran on a local PGlite instance outside the repo).
- No historical Session 1–25 report or existing finding was altered (append-only archive rules; the new `s26/` dumps sit beside S14's, not over them).
- The PGlite audit's prologue/harness scripts stay outside the repo (the mandate's "helper scripts outside the repo" rule).

*Session 26 — the readiness audit of record. Read-only on application source; only `Investigation Archive/` + `Refactoring Unified/` written; no key material anywhere; G0 ACTIVE.*
