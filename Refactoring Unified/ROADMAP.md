# Prioritized Refactoring Roadmap — Execution Table (v2.3)

**Companion to `BLUEPRINT.md` v2.3.** **v2.3 (Session 27, 2026-11-21 — the final pre-Go lock-in):** **the execution ORDER is now EXECUTION-PLAN §2's three tracks** (Track 1 baseline-green → Track 2 `T-559 → T-560 ×5 → T-594` → Track 3 relocation + website cutover + Stage A: `T-550 → T-573 → T-552 → ARCH-046 → T-575 → T-574 → T-614 → T-590..T-593 → T-595`, then `T-577` early) **BEFORE Phases 1–5** — the phase ROWS below are unchanged in content; only the recommended start order follows the tracks; 5.1/5.8/5.11/5.12/5.18/5.21 expanded to the owner's locked mandates (the full-light primary theme incl. the complete Dashboard+Statistics UI; the every-detail Encaissement PDFs; the full-table report PDFs; the early right-click Cut/Copy/Paste/Select-All incl. read-only surfaces + automated tests); **NEW 5.18a (T-612) + 5.18b (T-613)** — the Payment Error Detector, Diagnostics & Data Inspector Overhaul (EXECUTION-PLAN §16; Deep Sweep/15; the G-DETECT-1..4 acceptance gates incl. the 1-by-1 actual-Excel rule); **NEW 6.14 (T-614)** — the Website Cutover, Env Update, Redeploy & Operational Verification card (Deep Sweep/16; OPS-021; the RELOAD-GUIDE §A.7); 1.3 carries the 1-by-1 actual-Excel fixture rule; the register carries **204 IDs (zero orphans)**; standing rule 6 gains the website-deploy clause. Original v2.2 header follows. **v2.2 (Session 26):** every S24 §14 delta folded INLINE into the phase rows (6.2 narrows per C-23 — ~120/h configured-mode only, mock silent by design; 6.4 gains BUG-069's unscoped+uncapped reads; 6.5's radius is ARCH-049's 30 instances/18 files; 1.4–1.7's mock-adoption step owns DUP-037; 8.8's DB-side deletion scope is EMPTY per C-24 — `class_subjects` stays; 5.19 widens to 13+ stores per C-25; BUG-046's 7 synthetic sites + the `unified-payment-modal.tsx:283-285` root on 5.10; BUG-065's medical→support read-corruption precondition on 8.1; `REAL_TUITION_BY_GRADE` flat/not-year-keyed + `REAL_FI_AUTISTE` on 5.18; the stats-tips 96×3=288 blocks on 5.9); 6.10 re-based on the consolidated baseline (1 migration `0001` / 99 tables / 14 views / 5 matviews / 11 buckets / 264 policies); 1.1 carries the OPS-018 note until Commit 1 runs; OPS-019 (the owner-side OAuth blocker — D-21) homed as 6.13 + a coverage row; OPS-020 (the charter) homed; the register carries 197 IDs (zero orphans); standing rule 6 gains the no-live-builds clause. Original v2.1 header follows. **v2.1 (Session 24):** the S24 verification homed five new findings (DUP-037 → 1.4-1.7's mock-adoption step; ARCH-049 → 6.5 (T-592 — the volley blast radius 30 instances/18 files); BUG-069 → 6.4 (T-591 — the unscoped reconcile/collectDebtors reads); OPS-017 → Phase 6's relocation lane (the NEW project is alive, uncapped, schema-empty — the target is READY); OPS-018 → the G0-lift execution preamble (31 test-path updates after the consolidation)); three corrections folded (C-23: T-594/6.2 narrows — mock mode is already silent, ~120/h configured; C-24: 8.8's T-569 DB-side deletion scope empties — TeacherSubjectAssignment is app-only, class_subjects is the DB truth; C-25: 5.19's T-588 store inventory widens to 13+); the migration chain is now the consolidated single-file baseline (`0001_initial_consolidated_schema.sql` + `migrations_archive/` — append-only continues from 0002). Original v2.0 header follows.

**Companion to `BLUEPRINT.md` v2.0.** Every row = one registered task series; all lanes now carry their T-numbers (the staged register T-549..T-611 — complete; **T-555 stays reserved/unused**) — **Phase 9 (the unified-Excel X-lane, S23) extends the register**. Ordering within a phase is the recommended execution order; the Dependency column encodes hard edges. **v2.0 changes:** the **Stage A** lane (the owner's immediate mandate, D-17 — egress survival, query minimization, portable relocation) is elevated to Phase 6 with its own rows; **Stage B** replaces the old Phase 6/7 split (Phase 7 = the unified pipeline + local-first hybrid, superseding the LF-4 relay and LF-5 demotion designs); **Phase 5 is re-scoped as the experience overhaul** (D-19: white theme, dashboard overhaul, modal purge + the S11/S12/S7/S9 UX-defect lanes); **Phase 8 = the pedagogy lane** (T-561..T-571, parallel with own sequencing); the relocation lane (T-573..T-575) lands in Phase 6. All counts census-corrected (C-8/C-10/C-11/C-13/C-14/C-15/C-19); the E1.7→T-573 and E2.4→ARCH-037 resolutions applied.

**Effort scale:** XS ≤ 1 day · S ≤ 3 days · M ≤ 2 weeks · L ≤ 1 month · XL = the T-599 engine build.

---

## Phase 0 — Zero-risk cleanup (signal-to-noise, no behavior change)

| # | Task | Findings | Effort | Dependency | Verification |
|---|---|---|---|---|---|
| 0.1 | Remove root `src/` stray, stub lockfile, empty nested file | DEAD-001/002/023, OPS-007 | XS | — | typecheck |
| 0.2 | Remove dead files: dashboard-tab-layout-editor (the D-U5 first move of the T-596 overhaul), narrative-generator, 3 barrels | DEAD-003, DEAD-010, DEAD-011 | S | — | typecheck + full vitest + baseline move |
| 0.3 | DepartmentManagement: remove **or** wire (owner decision first) | DEAD-004 | S | decision | grep + vitest |
| 0.4 | Relocate 4 test-only domain files into tests | DEAD-008/011 | S | — | vitest from new paths |
| 0.5 | Dead-symbol batch: core (~25), shared (~16), domain, features, infra | DEAD-006/007/008/009/012 | M | — | typecheck + vitest + baseline move |
| 0.6 | Fix stale doc comments (7 cited sites) | BUG-030 | XS | — | review |
| 0.7 | `vite-env.d.ts` alignment — **RESCOPED (R-1): keep the `window.elImtiyaz.config` declarations; they become TRUE via T-573's preload bridge; only the truly-unbuilt `app`/`fs` members get a doc note** | R-3.9 → T-573 | S | — | typecheck + settings config tab |
| 0.8 | **Gate the Ctrl+O autofill to dev builds** (T-583's startup lane completes the eager-mount removal) | ARCH-010, ADD-5 | XS | — | t-399 suite + manual |
| 0.9 | Remove broken root one-off scripts + stale check-supabase.ts | OPS-002/008 | XS | — | repo clone/scripts inventory |
| 0.10 | Remove 7 static JSON dumps + old-ref-era cleanup scripts | OPS-004 | XS | — | docs references updated |

## Phase 1 — The money path (highest business value)

| # | Task | Findings | Effort | Dependency | Verification |
|---|---|---|---|---|---|
| 1.1 | Root-cause + settle the t-502 wave-meter parity failure — **DONE-BY-T-549** (BUG-038's wall-clock defect, not a predicate divergence — R-3) — **until Commit 1 (OPS-018: `Investigation Archive/OPS-018-COMMIT-1-BLUEPRINT.md`) re-points the 30 live migration-path references, the full-ladder baseline also carries the consolidation's ENOENT failures** | BUG-012/038 | M→done | T-549 | test green via the clock injection |
| 1.2 | Convert settled/overdue checks to INV-4 predicates (6+ sites); map `deriveDebtTriage` onto `computeDebtAgingStatus` | DUP-016, BUG-012, BUG-019 | M | T-549 | per-site regression tests |
| 1.3 | Devis equivalence fixtures capturing current persisted shapes **per price era (2026-2027 AND 2027-2026 configs)** — **v2.3: cut and verified against EACH actual workbook INDIVIDUALLY (`Excel/Suivis clients  2026_2027.xlsx` alone AND `Excel/2027-2026.xlsx` alone — never a combined import)** | C-1 prep, R-2 | M | — | fixture suite green, per-file |
| 1.4 | Introduce `domain/calc/pricing/devis.ts` composing matrix+tuition with a **per-year `pricingBasis` parameter** (reproducing today's #4 wiring) | DUP-001, ARCH-037 (R-2) | M | 1.3 | equivalence suite × two eras |
| 1.5 | Switch feature `computeBilling` preview → devis service | DUP-001 | S | 1.4 | batch-registration suites |
| 1.6 | Switch `registration-billing-wires` → devis service (mapping only) | DUP-001 | S | 1.4 | registration e2e + live-verify script |
| 1.7 | Mock batchRegister adopts devis service | DUP-001, DUP-005 | S | 1.4 | mock parity tests |
| 1.8 | Formatting/INV-4 consolidation batch (isoWindow, DZD, dates, attendanceRate, label maps, periodMinutes, mapStudentRow, CYCLE_OF_GRADE, toIsoDate/currentAcademicYear, WhatsApp; S-U1/S-U4/S-U5 fold here) | DUP-008..014, 019, 020, 022, BUG-014 | M | — | affected suites; visual spot-check money copy |
| 1.9 | Fix client-side verified defects: BUG-001 terms, BUG-002 gpa args, BUG-003 revenue label, BUG-004 student-code filter (+Android check), BUG-005 sort, BUG-016 memo, BUG-022 names, BUG-023 nulls, BUG-024 redaction, BUG-025 header drop, BUG-026 tab sync, BUG-013 role strings, BUG-027 copy (+ BUG-010/020/021) | BUG-001..005, 010, 013, 015, 016, 020..027 | M | — | per-fix tests (each its own T-task per governance) |
| 1.10 | Fix render-phase setState (5 files) | BUG-011 | S | — | React suites + manual |
| 1.11 | **T-556 — BUG-040 contact backfill on placeholder-family merge** (the phone-bearing row enriches the placeholder family before the student upsert) | BUG-040 | S | — | the B-test (placeholder-first → backfilled) |
| 1.12 | **T-557 — dead-abort-mode removal** (D-12 default (b): remove the unreachable `ATOMIC_IMPORT_ABORTED`/`STRICT_MODE_REJECTED` branches, or restore fail-closed behind a flag — owner call) | DEAD-013, R-3.6 | S | decision | import engine tests |
| 1.13 | **T-558 — dry-run audit tag** (suppress `import.run_completed` for dry-runs or tag `dry_run: true`) | DS/04 §7.3 | XS | — | audit-assertion test |

## Phase 2 — Verified backend defect repair (SQL/EF, append-only + live ceremony — **dual-valid and PERMANENT under D-17**)

| # | Task | Findings | Effort | Dependency | Verification |
|---|---|---|---|---|---|
| 2.0 | Live-vs-chain `schema_migrations` + table census diff (§15.11) | risk #1 | S | G2 | recorded evidence |
| 2.1 | Workflow registry alignment migration (+`source_handle`, −`has_medical_justification`) + EF/client parity test | C-4, BUG-009 | M | 2.0 | verify_t SQL + parity test |
| 2.2 | EF `run-overdue-scan` INV-4 fix — **permanent (D-17: serves web/mobile parity + sync; the v1.x "dies at LF-3" note is reversed)** | C-5, BUG-008 | S | 2.0 | boundary fixture + live one-shot |
| 2.3 | `collect-payment` EF proof-fields + `ctx.userDisplayName`; `refund-payment` double audit | BUG-007 | S | 2.0 | EF tests + live-verify |
| 2.4 | `ai-proxy`: 'copilot' CHECK migration + `corsHeaders` fix; config.toml function list + auth-hook + verify_jwt fixes (**folds ARCH-046's drift reconciliation — coordinate with T-590's migration files**) | BUG-007, ARCH-046 | S | 2.0 | EF deploy evidence |
| 2.5 | `update-server-secret`: FCM v1 allowlist + in-tree audit-actions copy | BUG-007 | S | 2.0 | EF test |
| 2.6 | `register_family_batch` source_id regression + data repair for affected rows | BUG-006 | M | 2.0, Android reachability check | verify SQL + repair DML evidence |
| 2.7 | `create_manual_debt` academic_year_id; purge ID-domain fix; `revert_payment_allocation` allocations/bulk_import; debt `"bulk"` uuid + audit stringify | BUG-006/018 | M | 2.0 | verify SQL each |
| 2.8 | `attendance_select` RLS tightening; `mv_grade_summary` unique-index restore (**the T-590 CONCURRENTLY precondition**) | BUG-006 | M | 2.0 | policy census + RLS probe |
| 2.9 | Bootstrap 9000 rewrite (syntax, RLS policies, trigger) as fresh-clone concern | BUG-006 | S | 2.0 | fresh-clone boot test |

## Phase 3 — Structure and contracts

| # | Task | Findings | Effort | Dependency | Verification |
|---|---|---|---|---|---|
| 3.1 | Price-source injection for non-tuition charges (sever domain→mock) | ARCH-001, L-1 | M | **before any mock work** | manual-charge suites |
| 3.2 | Repository interface merge (C-3 — **T-564 is the pedagogy lane's P-U6 execution of the same consolidation**) + approvals/purge domain contracts (ADD-1) | DUP-002, ARCH-007 | M | — | typecheck + t-313 |
| 3.3 | Split `supabase-shared-repositories.ts` by repository | ARCH-008, L-7 | M | ADD-2 desirable | typecheck + suites |
| 3.4 | UI relocations: sync-indicator, person-navigation-context, topbar split, tenant-switcher | ARCH-003/004, L-2..L-5 | M | — | typecheck + UI smoke |
| 3.5 | Dashboard analytics logic → domain (+thresholds from settings) — **rides the T-596 overhaul as its domain-engine half** | ARCH-009, L-6 | M | 1.2 | pinned-output comparison |
| 3.6 | Settings per-tab gating via feature-registry (**+ the BUG-029 registry-accuracy fix**) | ARCH-012, L-9, BUG-029 | S | — | RBAC suites |
| 3.7 | Mock-layer decisions: port or quarantine the 5 live slots (per feature) | ARCH-006 | L (per port) | 3.1 | per-feature live verification |
| 3.8 | core/ai placement ADR (document, don't move) | ARCH-002, L-8 | S | — | ADR |
| 3.9 | Legacy teacher-timetable stack removal + mock migration — **absorbed by T-569 (the phantom Teacher write-surface deletion)** | DUP-021, R-2.7 | S | — | mock teacher suites |

## Phase 4 — Platform hygiene and documentation truth

| # | Task | Findings | Effort | Dependency | Verification |
|---|---|---|---|---|---|
| 4.1 | Generated DB-types pipeline (+ optional permission enum generation) | ADD-2/6, ARCH-014/015, DEAD-015 | M | — | diff vs migrations; parity test |
| 4.2 | i18n decision executed (remove gen dicts or complete T-388 apply) | DEAD-005, R-3.8, ARCH-013 | S or L | decision + sibling-repo check | i18n parity tooling |
| 4.3 | Scripts consolidation: parameterized delivery-zip builder; archive apply-live family (**permanent protocol — only the redundant copies go**) | DUP-006/007, ADD-4, R-4.1/4.2, OPS-003/004 | S | — | builder output comparison |
| 4.4 | deliverables/ disposition (purge/LFS/keep) + Excel/ provenance placement + smartexport fix | OPS-001/005/006, L-11, ARCH-017 | S-M | owner decisions | repo size; workflow |
| 4.5 | Table/select consolidation onto shared primitives (40 hand-rolled `<table>` files + 9 native-select bypasses — progressive; S-U3/S-U6 fold here) | DUP-015, C-15 | L (incremental) | — | per-feature visual + a11y checks |
| 4.6 | Governance doc refresh: AGENTS.md §2/§3/§17, system-map, AGENTS_supabase refs, §15 numbering note | ARCH-016, OPS-009 | S | — | doc review |
| 4.7 | RBAC matrix persistence completion — **absorbed by T-588 (the settings 8-store unification writes `tenant_role_overrides`)** | BUG-017, SET-U5 | M | decision | settings suites |
| 4.8 | Import-abort modes decision (restore fail-closed or remove enum) — **T-557** | DEAD-013, R-3.6, D-12 | S | decision | import engine tests |
| 4.9 | Settings `?tab=` stuck-on-mount fix — **absorbed by T-588 (with BUG-043's runtime twin)** | BUG-031, SET-U4 | XS | — | settings tab suites |

## Phase 5 — The experience overhaul (D-19; evidence: UI Component Audit 00–05, DS/01/06/07, the S11/S12 checklist)

| # | Task | Findings | Effort | Dependency | Verification |
|---|---|---|---|---|---|
| 5.1 | **T-589 — the full-light theme flip: Light/White is the PRIMARY theme app-wide (D-19, v2.3)** — default `light` + boot colors + ARCH-036 `-rgb` parity + BUG-039 `--radius-pill` + DEAD-017 keyframes + the 279-hex/24-file tokenization + **BUG-075's `mix-cards.tsx:37-51` frozen-palette retarget + the `dashboard-theme.ts` midnight-fallback re-pin** + t-546 extension | D-19/§E11, ARCH-036, BUG-039, DEAD-017, BUG-075 | S-M | before 5.2 | t-546 extended; the full light visual pass (dashboard + statistics, zero dark leftovers) |
| 5.2 | Z-index tokens + animation-family consolidation (delete custom slide keyframes; toast verb) — the UI-U1 arc on the light foundation | DUP-023/028 | XS | 5.1 | snapshot tests on 5 shell surfaces |
| 5.3 | Wizard + AutoFormModal render through ModalShell (props stable, 24 consumers) | DUP-025 | S | 5.2 | existing wizard/form-modal suites + visual review |
| 5.4 | EntityDetailDrawer → ModalShell preset (responsive DrawerSize mapping) | DUP-024 | S | 5.2 | drawer suites (t-405 et al.) + visual review |
| 5.5 | Copilot drawer port + teacher-overlay reclassification (D-U4) | ARCH-021, DUP-024 | M | 5.4 | copilot streaming tests + role-dashboard suites |
| 5.6 | Native `title=` → shared Tooltip eradication (194 occurrences / 102 files, batched per feature area) | DUP-026, C-10 | M | — | per-area suites; a11y spot-check |
| 5.7 | **T-576 — modal cosmetic cleanup:** BUG-025 header-slot + BUG-041 `data-testid` passthrough + the dead `useModal`/`ModalHost` stack removal (ARCH-018) + DUP-034 bare `confirm()` → ConfirmModal | BUG-025/041, ARCH-018, DUP-034 | S | — | unified-modal suites |
| 5.8 | **T-577 — Electron main UX & hygiene (v2.3: moved EARLY — immediately after Track 3, not Phase 5):** BUG-045's expanded contract — the French-labeled `{role:"editMenu"}` + the `context-menu` popup with **Cut (`Couper`) on `canCut`, Paste (`Coller`) on `canPaste`, Copy (`Copier`) on ANY non-empty `selectionText` (incl. read-only tables/cards/receipts), Select All (`Tout sélectionner`) on `canSelectAll`** + automated menu/context-menu builder unit tests + OPS-014 single-instance lock, window-state, did-fail-load, sandbox, prod DevTools removal | BUG-045, OPS-014 | S | — | the menu-unit test matrix + copy-paste works on every surface incl. read-only |
| 5.9 | **T-586 — modal text & jargon purge + formatter unification:** the 45+ jargon leaks (INV-/T-/ADR-/§/DATA-/waterfall), the 5 worst text blocks, the **Prix / Prix justifié / Couverture** contract, BUG-057's four-formatter unification on `formatDzd*` + the `NaN` fixes + one `DZD` suffix | B6/E12, BUG-057 | M | — | copy review; formatter snapshot tests |
| 5.10 | **T-578 — one canonical Encaissement context + slider fix:** `buildFamilyCollectContext` (BUG-046's erased payment history + the uncapped tranche strip) + the BUG-048 label collision/overflow fix | BUG-046, BUG-048 | M | — | the 10 entry points' suites; visual matrix |
| 5.11 | **T-579 — full payment-details contract (v2.3: the EVERY-DETAIL expansion):** the shared `buildPaymentCoverage` builder in PDFs (BUG-047) + the drawer transfer block + `PaymentBreakdownCard` mounts (BUG-053) + content-pinned tests — **the receipt/statement PDFs carry EVERY detail: paid-now, total paid to date, total due (Prix/Prix justifié net), the EXACT remaining balance owed, the per-tranche FI/T1/T2/T3 + per-category breakdown, the method + full check/transfer fields, the collector, the academic year** | BUG-047, BUG-053 | M | — | t-368 content pins incl. the tranche lines, paid-to-date, remaining, year |
| 5.12 | **T-580 — WinAnsi crash + PDF cosmetic (v2.3: widened to the report family):** BUG-049's sanitize fix + the revenue-report period-label filter-or-drop + **the report PDFs (`global-reports.ts`, `debt-report.ts`, `class-report.ts`, `report-document.ts`) render COMPLETE detailed tables matching the applied UI filters — no bare/truncated summaries, full WinAnsi safety on every drawn string** | BUG-049 | XS | — | lineage-audit PDF ≥ 1,000 DZD exports; a filtered report PDF with é/è/Arabic + a large row set exports whole |
| 5.13 | **T-581 — backup integrity trio:** BUG-050 wrong RBAC key + BUG-051 daemon-schedule + BUG-015's tenant-ID/actor literals | BUG-050/051/015 | S | — | backup round-trip tests |
| 5.14 | **T-582 — import number-parser hardening:** BUG-052's `D`/`A` char-class + FR-thousands-dot defects | BUG-052 | XS | — | the adversarial parser suite |
| 5.15 | **T-583 — startup acceleration:** route-level `React.lazy`, dynamic exceljs/pdf-lib, splash ≤1 s dismissible, lazy ar/en dictionaries, the DEV-gate autofill completion | BUG-054 | M | — | boot timeline evidence (before/after) |
| 5.16 | **T-584 — scheduled automation runner + working example:** the `scheduled`/`calendar_cron_event` runner (cron EF / pg_cron) + the seeded published template + the roll-call trigger + owner secrets doc | BUG-055 | M | — | a scheduled workflow fires end-to-end |
| 5.17 | **T-585 — AI hardening remainder:** fetch timeouts (AbortSignal), dead model metadata removal, passphrase → `safeStorage`/keychain, the AI-i18n decision (**T-572 owns the BUG-044 UX half**) | BUG-056 | M | T-572 | timeout tests; keychain round-trip |
| 5.18 | **T-587 — per-year diagnostics price basis (v2.3: executes INSIDE 5.18a/§16's overhaul):** thread `yearPricingConfigs` per attributed year, regenerate/delete the stale `REAL_TUITION_BY_GRADE`, the price-basis banner, the t-529 extension (**R-2's other half; rides T-562's AcademicYearContext**) | ARCH-037 | M | 1.4, T-562 | two-era diagnostic fixture test |
| 5.18a | **T-612 — the diagnostics/reconcile ENGINE overhaul (§16.1; Deep Sweep/15):** the academic-year parameter + per-year partitioning + per-row price basis incl. the autiste branch; the symmetric FI gate; the reversed-original exclusion; the parent_credit crediting; the thresholds API wired; **BUG-072's unscoped+uncapped `reconcile()`/`collectDebtors()` reads scoped + RPC/keyset-walked**; the dual-reconciler unification (BUG-021's PK-only/last-wins); the `dzd()`/`studentByCode` guards; off-main-thread execution | ARCH-037, BUG-021, BUG-072, ARCH-009, C-27 | L | 1.4, T-562 | **G-DETECT-1 (zero false errors vs each actual workbook INDIVIDUALLY) + G-DETECT-2 (100% planted-error detection)** |
| 5.18b | **T-613 — the inspector/console/exports overhaul (§16.2; Deep Sweep/15):** the unified XLSX/PDF export stacks (the rogue stacks + BUG-073's pagination/WinAnsi/truncation/silent-failures die); the BUG-074 trigger-seam filters; the DUP-040 canonicalization; the ARCH-052 debt-basis unification + the mock aging parity suite; the 9-stream subscription dedup; the full-light restyle; the "Paiement moyen" fix | BUG-073, BUG-074, BUG-075, DUP-040, ARCH-052, ARCH-028, R-10 (PDF) | L | 5.18a | **G-DETECT-3 + G-DETECT-4** (canonical bases; complete correctly-paginated light-themed exports) |
| 5.19 | **T-588 — settings 8-store unification:** system_settings as the single tenant-level store; RBAC saves to `tenant_role_overrides` (closes BUG-017); dead keys removal (DEAD-018); the `?tab=` deep-link fix (BUG-031+BUG-043); the backup passphrase mirror + daemon-schedule read die or re-wire; SET-U1/U2/U3/U6 ceremony primitives ride E6's fold | ARCH-038, DEAD-018, BUG-017/031/043, SET-U1..U6 | M | — | settings suites + RBAC matrix tests |
| 5.20 | **T-597 — OAuth switching + Gmail rebinding (D-18):** the Settings → Account & OAuth section; the transactional `replace-user-identity` EF; the four-column decoupling + `OWNER_PINNED_ADMIN_EMAIL` → `is_owner_pinned` DB flag | D-18, DS/07 §D9-D10 | M | — | identity-swap integration test |
| 5.21 | **T-596 — dashboard overhaul UX (D-19; v2.3: the full-light Statistics mandate):** the minimalist, uncluttered, self-explanatory redesign — D-U1 view-model hooks + D-U3 RoleDashboardTemplate + UI-U7 KPI/collapsible composition on the T-590 compact-RPC data source; **ONE single calculation engine shared by Dashboard and Payments/Finance** (D-U2 — the C-2/L-6 domain engines); **the ENTIRE Dashboard AND Statistics UI (OverviewTab, AnalyticsTab, StatStrip, ExecutiveCards, MixCards, InfoTip, dashboard-theme.ts, every chart SVG/card) rebuilt/styled as cohesive FULL LIGHT — Light/White PRIMARY, zero dark leftovers** | ARCH-040 (UX), BUG-059 (surface), D-U1..U5, BUG-075 | L | 6.1 (T-590), 5.1 | dashboard snapshot suites; the numbers-equal test; the full-light visual pass |
| 5.22 | **T-572 — the copilot failure UX** (BUG-044: paired-error semantics or commit-on-success; the unconfigured empty state + honest header badge; the logger.warn; the test update) | BUG-044/042 lineage | S | — | copilot-drawer suite re-pinned |

## Phase 6 — STAGE A: egress survival, query minimization & portable Supabase relocation (D-17 — the owner's immediate lane)

**Standing constraint (OPS-015): the cap lift MUST NOT precede 6.0–6.2 + 6.3 — and NO deploy (desktop builds OR the website/portal on Vercel) points at either project before 6.0–6.2 are green.** The live-ceremony rows (verify SQL, live one-shots) are G2-gated; the development, mock-tested work is not.

| # | Task | Findings | Effort | Dependency | Verification |
|---|---|---|---|---|---|
| 6.0 | **T-559 — the toast-context split** (BUG-042 root fix; `toast-provider.tsx:57-69` memo on stable deps only; `toasts` via second context) — THE top CRITICAL | BUG-042, T-559 card | XS-M | — | 108 consumers typecheck; the S10 regression shape |
| 6.1 | **T-560 — the five-site loop breakers** (load-generation-ref gates: configuration-tab:73-85, accounts-tab:60-80, pricing-year-config-bar:58-63, promotion-cycle-detail:69-78, promotion-cycles-tab:53-62) | BUG-042 family | S | 6.0 | per-site effect-count tests |
| 6.2 | **T-594 — BUG-058 health-probe fix** (the `/auth/v1/health` drip — ~120/h in CONFIGURED mode only, ZERO by design in mock/offline (C-23) — respects the effective runtime config) | BUG-058 | S | 6.0 desirable | offline network census: zero probes |
| 6.3 | **T-590 — dashboard server-side aggregation:** the KPI/revenue/aging/demographic RPCs + validated MVs (0021→0034/0041/0049/0111 chain; the `mv_grade_summary` unique index (**S26 audit: still absent in `0001` — chain-faithful, 0041 dropped 0021's index; the refresh-RPC whitelist must also gain the name**); year-range guards vs stale/positive-charge-only/rolling-window regressions; the prev-year duplicate download + third-path elimination) | ARCH-040, BUG-059, DEAD-019 | M-L | 2.8 desirable | parity vs client engines; year-range tests |
| 6.4 | **T-591 — targeted projections + keyset pagination + on-demand fetches:** the BUG-060..063 family + BUG-069 (the unscoped+uncapped `reconcile()`/`collectDebtors()` reads — tenant-scope + keyset/RPC walks) + the lint guard on >1,000-row tables | BUG-060..063, OPS-015 reads | M | 6.3 patterns | per-site count/query-shape tests |
| 6.5 | **T-592 — the incremental delta cache:** the `0143` `(updated_at, id)` keyset delta pulls + intelligent invalidation replace the 30 s/focus re-seed volley (**ARCH-049: 30 `CacheFreshness` instances / 18 files** × full collections); the one-coherent-caching-architecture decision (QueryClientProvider/useObservable/CacheFreshness; F-U4 prune-or-wire) | OPS-015 class 1, ARCH-020, DUP-029 (layer) | M | 6.3 patterns | delta-correctness tests; volley gone |
| 6.6 | **T-593 — the transactional batch sync RPC:** arrays of mutations applied atomically; `sync_queue` bulk status; compact results (1,000-row import: ~3,000-4,000 requests → batched calls); the per-item fallback kept during soak | OPS-015 class 4 | M | — | batch round-trip + failure-injection |
| 6.7 | **T-595 — the egress measurement gates:** before/after Database Egress, REST API Egress, request counts per boot / dashboard load / navigation / 1,000-row sync batch; the external-dependencies register (portal + Android audited if provided) | §14.5, D-17 | S | 6.0-6.6 | the recorded evidence artifacts |
| 6.8 | **T-573 — the `BackendProfile` main-process runtime config switcher** (ADD-9: the versioned profile + preload bridge — the `vite-env.d.ts` declarations become TRUE; the canonical constants demote to factory defaults; **absorbs T-551's hard-lock scope**) | ARCH-022/023/024, ARCH-034, R-1 | M | 6.0 desirable | packaged app re-points without rebuild |
| 6.9 | **T-574 — relocation auth tooling:** the UUID-preserving auth export/import pair + the email-match remap script (dry-run report) + the password-reset flow | S18 §B | M | 6.8 | the remap dry-run over the export |
| 6.10 | **T-575 — the one-command target preflight:** `scripts/preflight-target.mjs` (**the consolidated baseline: 1 migration (`0001`) / 99 tables / 14 views / 5 matviews / 11 buckets / 264 policies (242 public + 22 storage) / 147 functions / 90 triggers — Deep Sweep/14 Part C.3, S26-re-proven** / RLS census / the 5 helpers' SECURITY DEFINER parity / EF drift / REST smoke / verify_t-376 12/12) wired into the packager — **OPS-016 unlocks (a Windows installer becomes buildable against a healthy target)** | OPS-016, T-575 card | S | 6.8 | preflight green on a prepared target |
| 6.11 | **ARCH-046 — the config.toml ↔ functions/ sync** (delete the two phantom entries; add the three code-present entries) — executed in Phase 2's 2.4 or here, never both | ARCH-046 | XS | — | config-driven deploy of the listed set |
| 6.12 | **T-598 — the post-cap-lift payment reconciliation oracle** (owner-gated, one-time window with the live census): the ×10 exoneration record, the 1,281 legacy `paid>due` rows, the two price-era confusion, the future-anchored bucket surfaced everywhere; corrective `account_adjustments` with provenance | C-21, §A1.5 | M | G2 + 6.0-6.2 | the oracle over the full export |
| 6.13 | **OPS-019 / D-21 — the owner-side Google OAuth completion (NO code; the owner's lane):** add the NEW project's callback (`https://gvuvibcsfjhwcjikgxql.supabase.co/auth/v1/callback`) + origin to the Google client wired into its Supabase, confirm the consent-screen branding/audience — the Supabase side is already fully wired (the S25 config audit; the S26 re-probe unchanged) | OPS-019, D-21 | owner | — | Google sign-in works on the NEW project; then the OPS-012 full-set rotation |
| 6.14 | **T-614 — the Website Cutover, Env Update, Redeploy & Operational Verification card (v2.3 NEW; after 6.10 + 6.9 + 6.13; owner-gated on Vercel access):** the Vercel env re-point (`NEXT_PUBLIC_SUPABASE_URL` + the new publishable key → **REDEPLOY** — env beats the website repo's committed OLD-ref defaults but the build-time inlining demands the rebuild); the website repo's pinning-test commit (t-516/t-096); the new project's auth parity (site_url + `https://elimtiyaz-website.vercel.app` in the redirect allow-list + D-21); the EF/buckets/realtime parity; the end-to-end portal smoke (login → finance → activation → timetable → documents → notifications/chat → FCM) — the full checklist: the RELOAD-GUIDE §A.7; the audit: Deep Sweep/16 | OPS-021, D-17 | S | 6.8-6.10, 6.13 | the §A.7 checklist ALL-pass; the portal's own `vitest run` green post-re-pin |

## Phase 7 — STAGE B: unified pipeline & local-first hybrid sync (D-17; evidence: LOCAL-FIRST-BLUEPRINT, 02-UNIFIED-PIPELINE-DESIGN, S4 cross-verification; engine gates pre-verified)

Escapes the quota lock for the desktop permanently while Supabase stays (sync + web portal + Android). PGlite main-process engine + five ports + local↔Supabase delta sync. Kill-switch rollback at every phase; the INV-2 gate (network-blocked boot/sign-in/read/write/backup/restore on the packaged Windows build) is the program's definition of success.

| # | Task | Findings | Effort | Dependency | Verification |
|---|---|---|---|---|---|
| 7.0 | **LF-0 seam (T-550..T-553)**: five ports as interfaces; the hard-lock removal **executes inside T-573's profile switcher**; the 17 bypass files routed (both grep shapes); backend-kind-aware `validateConnection`; ADR-002/004 supersessions; `satisfies` factory exhaustiveness | ARCH-019/022/023/024/033, C-11 | M | 6.8 (T-573) | typecheck + full vitest; ARCH-019 suites |
| 7.1 | **Pipeline core facades (P-0 groundwork, 6.1-6.4 of the v1.x plan)**: `pipeline/core/` (StreamRegistry dual-perimeter, SchemaVersionRegistry, FormatRegistry, ChecksumService, AuditBus) + `DownloadHelper` + `exportToCsv` dialect + uniform export audit events — zero caller-visible change | R-4 groundwork, DUP-031, ARCH-030 | S | — | typecheck + unit tests; byte-compare |
| 7.2 | **The one commit path (P-1.1)**: `VaultReplayAdapter` + ImportService facade — ONE commit path for restore AND import AND sync replay | R-1 groundwork, P-5 | M | 7.1 | t-364/t-421 green |
| 7.3 | **T-599 — LF-1 local engine (XL)**: PGlite `LocalDatabaseService` in the main process; chain replay + `0000_local_compat` prologue (pgcrypto+pg_trgm; uuid-ossp+pgjwt skip-guards; the auth-schema GUC shim for 69 executable `auth.uid()`); `LocalBackendAdapter` for the 49 slots; the 5 mock-only slots get persistence (D-6); IPC channels; mock↔local parity per repository; spike gates (installer <30 MB growth, t-368-scale perf, 324/324 policies parse) | ARCH-006, DEAD-015, ARCH-035, ARCH-032 | XL | 7.0, 7.2 | chain-census gate (100/14/5); parity suites; INV-2 standing |
| 7.4 | **Restore unification (P-2)**: `RestoreService` 10-step contract (absorbs restore/inspectArchive/backup-file-restore; safety-backup refusal; the t-421 preflight triple; transactional flush; live replay target + scoped UI per D-8; the 13-stream perimeter; archive v2 + retention + warmup + data-export honesty — the P-2/P-3/P-4 hardening rows of the v1.x plan ride here) | ARCH-026/029, R-1/R-4/R-5, BUG-035/036, BUG-034, BUG-033, ARCH-027/028, D-8..D-11 | L | 7.2 | t-415 + t-300 + NEW round-trip layers; tamper suite |
| 7.5 | **Sync dispatch declarative (P-1.2)**: the `SYNC_POLICY` table (5 producer / 8 push-path / 5 enum-only kinds); fail-loud default; expense/personnel push paths or explicit prune | BUG-037, R-6 | S-M | 7.1 | t-022/t-171/t-305/t-415-sync |
| 7.6 | **T-600 — LF-2 local auth + RBAC (amended by D-18)**: `LocalAuthService` (scrypt, sessions, activation codes 0055, the role-escalation guard); **Google OAuth STAYS** — the linked identity lives on Supabase (web portal), managed by T-597's surface; global sign-out = the Supabase-side revocation broadcast | ARCH-031, D-18 | L | 7.3 | RBAC suites; T-266; activation lifecycle |
| 7.7 | **T-601 — LF-3 EF ports + local storage**: workflow engine promoted (the 0088 divergence fix settles DUP-003); the desktop overdue scanner canonized (INV-4) while **the EF surfaces stay live for web/mobile parity**; cron → scheduled tasks; `MediaStore` local folders (absorbs BUG-032); audit writer; financial-realtime → the IPC change bus | ARCH-025, R-2, DUP-003/004, ARCH-032 | L | 7.3 | workflow parity; overdue fixtures; media round-trip |
| 7.8 | **T-602 — local↔Supabase delta sync (replaces LF-4/LF-5)**: the push leg on T-593's batch RPC; the pull leg on the `0143` keyset cursor (T-592's engine); per-entity conflict policies (deterministic replay for money; 3-way entities; LWW attendance/homework; union append-only); cross-device invalidation; **no VPS relay (D-17)**; Supabase stays the sync layer + web portal | D-17, ADR-004 amendment | L | 7.6, 6.5, 6.6 | two-node simulation; offline-drain tests (t-171/t-305) |
| 7.9 | **Hardening backlog (P-3.4)**: H-9..H-16 in severity order (mirror reconciliation, passphrase wording, state-off-localStorage, disk preflight, checksum alarms, quarantine, Deflate read) | R-7/9/12/13 | M | 7.4 | per-item suites |
| 7.10 | **Local seed ceremony (the one-time extraction, D-5 + E7.9's successor)**: relocate (Phase 6) → seed the local DBs from the new project's unrestricted REST path (the 27-table writer map + RPC-read checklist as the script seed spec; T-421 preflights; per-stream verify; second PC pairing; two-node smoke) | D-5, LF0-PREP Part A | M | 7.3, 7.8, G2 | chain-census + parity + INV-2 gates |

## Phase 8 — Pedagogy unification lane (parallel; own sequencing; evidence: DS/10 + DS/11 + DS/12 §3)

**G0 governs the whole lane; D-13..D-16 carry ⏵ defaults.** Sequencing: **T-561 → (T-562 ∥ T-563 ∥ T-564 ∥ T-565 ∥ T-568) → (T-566 ∥ T-569) → T-570 → T-567 → T-571**; Phase-4 greps clean BEFORE any Phase-5 deletion; the BUG-065 parity test before the category bridge deletes.

| # | Task | Findings | Effort | Dependency | Verification |
|---|---|---|---|---|---|
| 8.1 | **T-561 · P-U1+M-U2 — the GradeLevel spine + the staff-category vocabulary** (the **8-site** M-U2 rewire + BUG-065's parity-test precondition) | ARCH-041/044, BUG-065 | M | — | GRADE_LEVELS drift guard; promotion suites; zero-remnant greps |
| 8.2 | **T-562 · P-U2 — the AcademicYearContext** (kills `DEFAULT_ACADEMIC_YEAR` + the second attribution chain; the ARCH-043 period-grid fold) | ARCH-039/043 | S | 8.1 | the payments↔scolaire seam test |
| 8.3 | **T-563 · P-U3 — the external class-code alias** | DS/10 | S | — | uniqueness per year; importer matching |
| 8.4 | **T-564 · P-U6 — the repository contract consolidation** (closes DUP-002 = Phase 3.2's pedagogy-side execution) | DUP-002 | XS-S | — | typecheck + t-313 |
| 8.5 | **T-565 · P-U7 — the filières drift-guard test** | DUP-035 | XS | — | the 0107 row-set equality test |
| 8.6 | **T-568 · M-U4 — the `parent_student_links` adoption** (D-14 ⏵ adopt; the backfill + trigger invariant) | DEAD-020 | S-M | 8.1 | links = pre-backfill count; invariance test |
| 8.7 | **T-566 · P-U4 — curriculum & assessment coverage** (D-13 ⏵ the composite recipe; the 4 missing subjects + the 8 mark families + the cc precedent) | ARCH-042 | M-L | 8.1 | recipe equivalence tests |
| 8.8 | **T-569 · M-U1/M-U3 — the teaching-staff consolidation** (D-15 ⏵ delete the phantom; the legacy timetable family + `TeacherSubjectAssignment` die here) | ARCH-044, DUP-036, DUP-021 | M | 8.1 | t-408 semantics; zero-remnant greps |
| 8.9 | **T-570 · M-U5..M-U8 — EnrollmentService + the dead-store drops** (`grades` DEAD-021 + `academic_history` DEAD-022 DROP after the greps; the `service_enrollments` seam doc D-16 ⏵ keep) | ARCH-045, DEAD-021/022 | M | 8.8, greps | the full DS/11 §4.4 checklist (a-h) |
| 8.10 | **T-567 · P-U5 — the pedagogy-workbook importer** (the BUG-064 class-resolution generalization; `معدل` ignored → recomputed) | BUG-064 | M | 8.1, 8.3, 8.7 | the S8-oracle discipline on a real filled workbook |
| 8.11 | **T-571 · M-U9/M-U10 + P-U8 — the ADR batch + the exit gate** | DS/11 | S | all above | the §4.4 re-run; register closure |

## Phase 9 — The unified Excel engine lane (parallel; own sequencing; evidence: DS/13 + Excel_Inspection/s23 — Session 23)

**G0 governs the whole lane; D-20 carries ⏵ defaults (OWNER-DECISION-PACKET Part G).** Sequencing: **T-603 → T-604 → T-605 → (T-606 ∥ T-607) → (T-608 ∥ T-609) → T-610 → T-611**; every task's exit gate = DS/13 §8's local oracle (100% of rows, 0 DZD delta) on the format it touches — no sampling, zero remote calls. The lane runs on the S8-proven engine shell (event bus, dry-run, atomic commit, compensating rollback, reports, audit — reused verbatim).

| # | Task | Findings | Effort | Dependency | Verification |
|---|---|---|---|---|---|
| 9.1 | **T-603 · X-U1 — the detect-reject gate** (a tier-1 name match that fails every adapter fingerprint → explicit `unknown_schema` skip; deletes the `candidates[0]` + `?? nameMatch` auto-adopt paths) | **BUG-067** (EGV), ARCH-047 | S | — | EGV alone → 0 rows; the 21-sheet archive drop → only fingerprint-passing sheets selected |
| 9.2 | **T-604 · X-U1 — per-sheet academic-year attribution** (sheet-name year parsing `ETAT 2023\s*2024` → 2023-2024; explicit picker fallback; year-scoped ledger sourceIds `imp:{year}:{studentId}:{field}`) | **BUG-066** | S-M | 9.1 | the DS/13 §6.3 oracle: the 188 cross-sheet balance mismatches → 0 |
| 9.3 | **T-605 · X-U2 — the CanonicalRow + the EtatColumnAdapter variant table** (ONE adapter core, 8 variant rows: the 2026/2027, 2027/2026, 3rd-variant, 2023/2024, 2026/2025, 2024/2025, EGV layouts; positional resolution keeps precedence; the duplicate-header last-wins hazard dies at the adapter) | **BUG-068**, ARCH-047 | M | 9.1 | the §8 G1 oracle per format; LIVRES@AB lands as books (8 rows, 80,000 DZD) — not psy3 |
| 9.4 | **T-606 · X-U3 — the unified entity-resolution pipeline** (the `domain/identity` engine graduates: auto-accept definite / propose probable+review / legacy exact fallback; BatchParentIndex + findStudentInFamily become the blocking fast-path; the T-556/BUG-040 backfill lands here) | BUG-040 (S8), DS/13 §3.3 | M | 9.3 | er-engine parity + the zero-split/zero-false-merge fixtures + backfill pin |
| 9.5 | **T-607 · X-U4 — the write pipeline onto CanonicalRow** (the §4 financial builders read the canonical record; INV-1 untouched: REMISE-no-entry, T-105 reconciliation, T-424 waterfall; the 3-bulk-RPC flush + 3-level dedup unchanged) | DS/13 §4 | M | 9.3 | RUN A/B/E/F reproduction byte-identical (1,137/741/3,342/2,198/5,956 + 390 + no-op + honest flush failure) |
| 9.6 | **T-608 · X-U5 — the ClientCritiqAdapter** (family-level: Montant → family outstanding charge snapshot, Garanti/Obs/marker metadata, roster-panel resolution through the unified resolver, `critiq:` deterministic sourceIds) | **ARCH-048** (capability), DS/13 §5 | M | 9.4 | 23 families / 48 children / 31,584,600 DZD imported once; re-import no-op; N ENFANT vs panel cross-check warnings |
| 9.7 | **T-609 · X-U2 — the EGV + document-sheet adapters** (EGV as the payments-ledger format — its own column contract; BON/Devis/REF get REAL canonical targets or explicit excluded-with-reason classification — the tracked-only no-op ends) | **ARCH-048**, DS/13 §6.7 | S-M | 9.3 | EGV ground truth (349,017,080 / 302,131,790 / 46,885,290) oracle-exact under its own adapter |
| 9.8 | **T-610 · X-U6 — the sheet-selection UX contract** (detected adapter + row count per sheet; default = current-year family only; historical/auxiliary listed as excluded-with-reason) | DS/13 §5 | S | 9.1–9.7 | the modal's default drop = current-year sheets only |
| 9.9 | **T-611 · X-U7 — the performance envelope** (P1 keyset preflights replace `search("")` snapshots; P2 schema-projection cell walk; P3 post-load sheet pruning; P4 real checksums + diff-skip re-import — DEAD-024's fix; P6 coercion-plan precompile) | DS/13 §7, DEAD-024 | M | 9.5 | §8 G6/G7: wall-clock + RSS + round-trip budgets at 1× and 5×; the S8 oracle still exact |

## Standing rules for all phases

1. One T-task per commit; five-question commit body; push after commit.
2. `tsc --noEmit` + relevant suites green before each commit; full `npm test` + baseline move at each batch boundary.
3. SQL/EF changes follow §11.1 live-verify ceremony; RLS never weakened; migrations append-only.
4. Cross-platform changes mirrored or registered as divergences (§10) — **the web portal and Android keep consuming Supabase unchanged (D-17); Stage A's RPCs serve them for free**.
5. Findings register updated as items complete; UNRESOLVED items re-verified or escalated to the owner.
6. **OPS-015 ordering (absolute):** no cap lift — AND no live build/CI/deploy target pointed at either Supabase project (`gvuvibcsfjhwcjikgxql` or `vebfehrpzajhstyhinnw`), **the website/portal Vercel deploy included** — before 6.0 (T-559) + 6.1 (T-560 ×5) + 6.2 (T-594/BUG-058) are coded and locally verified.
7. **The kill-switch invariant (Stage B):** the previous backend stays selectable until the next stage is green; the INV-2 gate is the definition of success.

## Findings coverage map (the orphan check — every registered ID → its phase row)

The register carries **204 registered IDs** (DEAD-001..015, 017..024 · DUP-001..032, 034..037, 040 · ARCH-001..049, 052 · BUG-001..075 · OPS-001..021; the never-assigned placeholders: DEAD-016/026/027, DUP-033/038/039, ARCH-050/051, BUG-070/071; S23 added BUG-066..068, ARCH-047/048, DEAD-024; S24 added DUP-037/ARCH-049/BUG-069/OPS-017/OPS-018; S25 added OPS-019; S26 added OPS-020 — the charter; **S27 added BUG-072..075, DUP-040, ARCH-052, OPS-021 + the corrections packet C-27**). Full evidence per ID: `FINDINGS_INDEX.md`; full task cards: `EXECUTION-PLAN.md` §6 (the 1:1 traceability matrix). Compact map:

| IDs | Phase row (this file) |
|---|---|
| DEAD-001/002/023, OPS-007 | 0.1 · OPS-002/008 → 0.9 |
| DEAD-003/010/011 | 0.2 (DEAD-011's test-only half → 0.4) |
| DEAD-004 | 0.3 (Owner) |
| DEAD-005 | 4.2 (ARCH-013 rides; R-3.8) |
| DEAD-006/007/008/009/012/014 | 0.5 |
| DEAD-013 | 1.12 (T-557; D-12) |
| DEAD-015 | 4.1 + 7.3 |
| DEAD-017 | 5.1 (T-589) |
| DEAD-018 | 5.19 (T-588) |
| DEAD-019 | 6.3 (T-590) |
| DEAD-020/021/022 | 8.6 / 8.9 (T-568/T-570) |
| DEAD-024 | 9.9 (T-611 — the real checksum + diff-skip) |
| DUP-001/005 | 1.3–1.7 |
| DUP-002 | 3.2 ∥ 8.4 (T-564) |
| DUP-003/004 | 2.1/2.2 + 7.7 |
| DUP-006/007 | 4.3 |
| DUP-008..014, 019, 020, 022 | 1.8 |
| DUP-015 | 4.5 |
| DUP-016/017 | 1.2 / 3.6 |
| DUP-018 | Doc (4.6 context; Phase 2 consolidates the redefinitions) |
| DUP-021 | 8.8 (T-569; absorbs 3.9) |
| DUP-023/028 | 5.2 |
| DUP-024 | 5.4/5.5 |
| DUP-025 | 5.3 |
| DUP-026 | 5.6 |
| DUP-027 | 5.9 (E6.8) + 5.21 (T-596) |
| DUP-029 | 5.10 (E6.9) + 6.5/5.21 |
| DUP-030 | 5.12 (E6.11) + 5.19 (T-588) |
| DUP-031 | 7.1 |
| DUP-032 | 7.4 |
| DUP-034 | 5.7 (T-576) |
| DUP-035 | 8.5 (T-565) |
| DUP-036 | 8.8 (T-569) |
| ARCH-001 | 3.1 |
| ARCH-002/005/020 | 3.8 (the ADR batch; ARCH-020 + 6.5) |
| ARCH-003/004 | 3.4 |
| ARCH-006 | 3.7 → 7.3 final |
| ARCH-007 | 3.2 |
| ARCH-008 | 3.3 |
| ARCH-009 | 3.5 + 5.21 (T-596) |
| ARCH-010 | 0.8 (+ 5.15 completes) |
| ARCH-011 | 1.9 (its own T-task within the batch) |
| ARCH-012 | 3.6 / 5.12 / 5.19 |
| ARCH-013 | 4.2 + 3.8 |
| ARCH-014/015 | 4.1 |
| ARCH-016 | 4.6 |
| ARCH-017 | 4.4 (Owner) |
| ARCH-018 | 5.7 (T-576) |
| ARCH-019 | 7.0 (T-552; + 3.4 tenant-switcher) |
| ARCH-021 | 5.5 (E6.4) |
| ARCH-022/023/024/034 | 6.8 (T-573 — absorbs T-551) |
| ARCH-025/031/032 | 7.6/7.7/7.3 |
| ARCH-026/027/028/029 | 7.4 |
| ARCH-030 | 7.1 |
| ARCH-033 | 7.0 |
| ARCH-035 | 7.3 gate |
| ARCH-036/039/040 | 5.1 (T-589) / 8.2 (T-562) / 6.3 (T-590) + 5.21 (T-596) |
| ARCH-037 | 5.18 (T-587; + 1.3–1.7's pricing basis) |
| ARCH-038 | 5.19 (T-588) |
| ARCH-041..045 | 8.1 (T-561) / 8.7 (T-566) / 8.2 (T-562) / 8.8 (T-569) / 8.9 (T-570) |
| ARCH-046 | 2.4 / 6.11 (once) |
| ARCH-047 | 9.1–9.3 (T-603/T-604/T-605 — the reject gate + year attribution + variant table) |
| ARCH-048 | 9.6/9.7 (T-608/T-609 — CLIENT CRITIQ + the document-sheet canonical targets) |
| BUG-001..005, 010, 013, 015, 016, 020, 021, 022..028 | 1.9 (BUG-015's backup half → 5.13 T-581) |
| BUG-006/018 | 2.6–2.9 |
| BUG-007 | 2.3–2.5 |
| BUG-008/009 | 2.2 / 2.1 |
| BUG-011 | 1.10 |
| BUG-012/019 | 1.2 (+ T-549 §3) |
| BUG-014 | 1.8 |
| BUG-017 | 5.19 (T-588; absorbs 4.7) |
| BUG-025 | 5.7 (T-576) |
| BUG-026/029/030 | 1.9 / 3.6 / 0.6 |
| BUG-031/043 | 5.19 (T-588) |
| BUG-032 | 7.7 (T-601) |
| BUG-033..037 | 7.4 / 7.5 (+ 7.8) |
| BUG-038 | 1.1 (T-549 — §3 of EXECUTION-PLAN) |
| BUG-039..041 | 5.1 (T-589) / 5.7 (T-576) / 1.11 (T-556) |
| BUG-042/044 | 6.0/6.1 (T-559/T-560) / 5.22 (T-572) |
| BUG-045..051 | 5.8 (T-577) · 5.10 (T-578) · 5.11 (T-579) · 5.12 (T-580) · 5.13 (T-581) |
| BUG-052..057 | 5.14 (T-582) · 5.15 (T-583) · 5.16 (T-584) · 5.17 (T-585) · 5.22 (T-572) · 5.9 (T-586) |
| BUG-058 | 6.2 (T-594) |
| BUG-059 | 6.3 (T-590) + 5.21 (T-596) |
| BUG-060..063 | 6.4 (T-591) |
| BUG-064 | 8.10 (T-567) |
| BUG-065 | 8.1 (T-561 precondition) |
| BUG-066 | 9.2 (T-604 — year-scoped sourceIds; the 188→0 oracle) |
| BUG-067 | 9.1 (T-603 — the reject gate; EGV never imports as an etat roster) |
| BUG-068 | 9.3 (T-605 — the variant table; LIVRES@AB = books) |
| BUG-072 | 6.4 (T-591) + 5.18a (T-612 — §16) — the unscoped+uncapped reconcile/collectDebtors reads |
| BUG-073/BUG-074/BUG-075/DUP-040/ARCH-052 | 5.18b (T-613 — §16; BUG-075 also 5.1/5.21) — the inspector overhaul set |
| OPS-021 | 6.14 (T-614 — the website cutover card) + EXECUTION-PLAN §5 standing owner actions |
| OPS-001/005/006 | 4.4 (Owner) |
| OPS-003/004 | 4.3 |
| OPS-009 | 4.6 |
| OPS-010 | Doc (Phase 2 ceremony context) |
| OPS-011/012/013 | The gates / Owner actions (§5 of EXECUTION-PLAN) |
| OPS-014 | 5.8 (T-577) |
| OPS-015 | 6.7 (T-595) + the standing rule 6 |
| OPS-016 | 6.10 (T-575; + 6.8 T-573) |
| OPS-019 | 6.13 + the owner actions (EXECUTION-PLAN §5) — the Google-side client edit (D-21) |
| OPS-020 | the standing charter (BLUEPRINT §18 / EXECUTION-PLAN §15.3 / `Investigation Archive/MIGRATION-CONSOLIDATION-AND-EGRESS-CHARTER.md`) |
| R-1..R-15 (pipeline hardening) | 7.1–7.4 as mapped in EXECUTION-PLAN §6 |

**Orphan check verdict: zero orphans** — every registered ID maps to a phase row here and to a task card in `EXECUTION-PLAN.md` §6 (verified Session 22, programmatically; the S23 additions map to Phase 9 above and §13's task cards — verified Session 23; the S27 additions map to the rows above — re-verified programmatically in Session 27, the same range-aware method).


---

## Session 24 addendum (v2.1) — the new-ID coverage rows

| IDs | Phase row (this file) |
|---|---|
| DUP-037 | 1.4–1.7 (E2.4 — the FIFTH billing site; the mock-adoption step absorbs it) |
| ARCH-049 | 6.5 (T-592 — the volley's 30-instance/18-file blast radius) |
| BUG-069 | 6.4 (T-591 — the unscoped+uncapped reconcile()/collectDebtors() reads) |
| OPS-017 | Phase 6 (G2R/T-573..T-575 — the NEW project is a READY blank target; the consolidated schema is its seed) |
| OPS-018 | the G0-lift execution preamble (31 src/tests migration-path updates, one mechanical pass) |

**Orphan check after S24: still zero** — the register now carries 195 IDs (190 + the five above); all 195 map to phase rows here and to EXECUTION-PLAN §6 task homes (verified programmatically, range-aware, Session 24 — Deep Sweep/14 Part B).


---

## Session 25 + 26 addendum (v2.2) — the new-ID coverage rows

| IDs | Phase row (this file) |
|---|---|
| OPS-019 | 6.13 (+ EXECUTION-PLAN §5 standing owner actions) — the owner-side Google OAuth completion on the NEW project (D-21): the Google client's redirect URI + consent screen |
| OPS-020 | the standing charter (BLUEPRINT §18 / EXECUTION-PLAN §15.3 / `Investigation Archive/MIGRATION-CONSOLIDATION-AND-EGRESS-CHARTER.md`) — permanent policy, not a task |

**Orphan check after S26: still zero** — the register now carries **197 IDs** (190 + the S24 five + OPS-019 + OPS-020); all 197 map to phase rows here and to EXECUTION-PLAN §6 task homes (re-verified programmatically in Session 26 — range-aware, the same method as S24's Part B audit).

---

## Session 27 addendum (v2.3) — the new-ID coverage rows + the S27 execution-order note

**The execution ORDER note (the v2.3 mandate):** the phase rows below stay the task table of record; the EXECUTION ORDER is EXECUTION-PLAN §2's three tracks (Track 1 baseline-green → Track 2 T-559/T-560×5/T-594 → Track 3 T-550→T-573→T-552→ARCH-046→T-575→T-574→T-614→T-590..T-593→T-595, then T-577 early) BEFORE Phases 1–5 (E2..E6).

| IDs | Phase row (this file) |
|---|---|
| BUG-072 | 6.4 (T-591) + 5.18a (T-612 — EXECUTION-PLAN §16.1) |
| BUG-073 | 5.18b (T-613 — EXECUTION-PLAN §16.2) |
| BUG-074 | 5.18b (T-613) |
| BUG-075 | 5.1 (T-589) + 5.21 (T-596) + 5.18b (T-613) |
| DUP-040 | 5.18b (T-613) |
| ARCH-052 | 5.18b (T-613) |
| OPS-021 | 6.14 (T-614 — the Website Cutover card) + EXECUTION-PLAN §5 standing owner actions |
| C-27 | Doc (the corrections register — six corrections, none invalidating a disposition) |

**Orphan check after S27: still zero** — the register now carries **204 IDs** (197 + the seven S27 additions); all 204 map to phase rows here and to EXECUTION-PLAN §6 task homes (re-verified programmatically in Session 27 — range-aware, the same method as S24/S26).

## Dead Code, Duplicates & Re-Implementations to Retire

Load `elimtiyaz-desktop/docs/codebase-audit/MASTER-CONSOLIDATION-CANDIDATE-REGISTER.csv` with the active card. Match its paths, symbols and operation to the rows below before implementation. For each match record the finding ID, survivor and consumers, retirement diff, baseline and post-change tests, and actual net production LOC. If the card has no verified match, record that result in its closeout. Proceed from the implementation SHA and recheck each prior disposition.

T-621 through T-624 in EXECUTION-PLAN.md own the cleanup sequence. T-429 supplies the canonical debt-aging rule for T-623.
