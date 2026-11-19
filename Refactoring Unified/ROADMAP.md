# Prioritized Refactoring Roadmap — Execution Table

Companion to `BLUEPRINT.md`. Every row = one registered task series (T-numbers to be assigned per AGENTS.md §13 at execution time). Ordering within a phase is the recommended execution order; the Dependency column encodes hard edges. **Session 2 additions:** Phase 5 (UI unification, from `BLUEPRINT.md` §12) and the SET-U quick win folded into Phase 4 below. **Session 4 additions:** Phases 6-7 (unified data pipeline + local-first migration, from `BLUEPRINT.md` §13; cross-verified `Investigation Archive/Testing and Runtime Evidence/S4-CROSS-VERIFICATION-2026-11-19.md`; full designs in `Investigation Archive/Data Pipeline Unification/02-UNIFIED-PIPELINE-DESIGN.md` and `Investigation Archive/Local-First Architecture/LOCAL-FIRST-BLUEPRINT.md`).

## Phase 0 — Zero-risk cleanup (signal-to-noise, no behavior change)

| # | Task | Findings | Effort | Dependency | Verification |
|---|---|---|---|---|---|
| 0.1 | Remove root `src/` stray, stub lockfile, empty nested file | DEAD-001/002, OPS-007 | XS | — | typecheck |
| 0.2 | Remove dead files: dashboard-tab-layout-editor, narrative-generator, 3 barrels | DEAD-003, DEAD-010, DEAD-011 | S | — | typecheck + full vitest + baseline move |
| 0.3 | DepartmentManagement: remove **or** wire (owner decision first) | DEAD-004 | S | decision | grep + vitest |
| 0.4 | Relocate 4 test-only domain files into tests | DEAD-008/011 | S | — | vitest from new paths |
| 0.5 | Dead-symbol batch: core (~25), shared (~16), domain, features, infra | DEAD-006/007/008/009/012 | M | — | typecheck + vitest + baseline move |
| 0.6 | Fix stale doc comments (7 cited sites) | BUG-030 | XS | — | review |
| 0.7 | Align `vite-env.d.ts` phantom type; simplify system-config dead branches | R-3.9 | S | — | typecheck + settings config tab |
| 0.8 | **Gate the Ctrl+O autofill to dev builds** | ARCH-010, ADD-5 | XS | — | t-399 suite + manual |
| 0.9 | Remove broken root one-off scripts + stale check-supabase.ts | OPS-002/008 | XS | — | repo clone/scripts inventory |
| 0.10 | Remove 7 static JSON dumps + old-ref-era cleanup scripts | OPS-004 | XS | — | docs references updated |

## Phase 1 — The money path (highest business value)

| # | Task | Findings | Effort | Dependency | Verification |
|---|---|---|---|---|---|
| 1.1 | Root-cause + settle the t-502 wave-meter parity failure | BUG-012 (runtime) | M | — | test green or evidence-based re-baseline |
| 1.2 | Convert settled/overdue checks to INV-4 predicates (6+ sites); map `deriveDebtTriage` onto `computeDebtAgingStatus` | DUP-016, BUG-012 | M | 1.1 | per-site regression tests |
| 1.3 | Devis equivalence fixtures capturing current persisted shapes | C-1 prep | M | — | fixture suite green |
| 1.4 | Introduce `domain/calc/pricing/devis.ts` composing matrix+tuition (policy param reproducing today's #4 wiring) | DUP-001 | M | 1.3 | equivalence suite |
| 1.5 | Switch feature `computeBilling` preview → devis service | DUP-001 | S | 1.4 | batch-registration suites |
| 1.6 | Switch `registration-billing-wires` → devis service (mapping only) | DUP-001 | S | 1.4 | registration e2e + live-verify script |
| 1.7 | Mock batchRegister adopts devis service | DUP-001, DUP-005 | S | 1.4 | mock parity tests |
| 1.8 | Formatting/INV-4 consolidation batch (isoWindow, DZD, dates, attendanceRate, label maps, periodMinutes, mapStudentRow, CYCLE_OF_GRADE, toIsoDate/currentAcademicYear, WhatsApp) | DUP-008..014, 019, 020, 022 | M | — | affected suites; visual spot-check money copy |
| 1.9 | Fix client-side verified defects: BUG-001 terms, BUG-002 gpa args, BUG-003 revenue label, BUG-004 student-code filter (+Android check), BUG-005 sort, BUG-016 memo, BUG-022 names, BUG-023 nulls, BUG-024 redaction, BUG-025 header drop, BUG-026 tab sync, BUG-013 role strings, BUG-015 literals, BUG-027 copy | BUG-001..005, 013, 015, 016, 022..027 | M | — | per-fix tests (each its own T-task per governance) |
| 1.10 | Fix render-phase setState (5 files) | BUG-011 | S | — | React suites + manual |

## Phase 2 — Verified backend defect repair (SQL/EF, append-only + live ceremony)

| # | Task | Findings | Effort | Dependency | Verification |
|---|---|---|---|---|---|
| 2.0 | Live-vs-chain `schema_migrations` + table census diff (§15.11) | risk #1 | S | credentials | recorded evidence |
| 2.1 | Workflow registry alignment migration (+`source_handle`, −`has_medical_justification`) + EF/client parity test | C-4, BUG-009 | M | 2.0 | verify_t SQL + parity test |
| 2.2 | EF `run-overdue-scan` INV-4 fix | C-5, BUG-008 | S | 2.0 | boundary fixture + live one-shot |
| 2.3 | `collect-payment` EF proof-fields + `ctx.userDisplayName`; `refund-payment` double audit | BUG-007 | S | 2.0 | EF tests + live-verify |
| 2.4 | `ai-proxy`: 'copilot' CHECK migration + `corsHeaders` fix; config.toml function list + auth-hook + verify_jwt fixes | BUG-007 | S | 2.0 | EF deploy evidence |
| 2.5 | `update-server-secret`: FCM v1 allowlist + in-tree audit-actions copy | BUG-007 | S | 2.0 | EF test |
| 2.6 | `register_family_batch` source_id regression + data repair for affected rows | BUG-006 | M | 2.0, Android reachability check | verify SQL + repair DML evidence |
| 2.7 | `create_manual_debt` academic_year_id; purge ID-domain fix; `revert_payment_allocation` allocations/bulk_import; debt `"bulk"` uuid + audit stringify | BUG-006/018 | M | 2.0 | verify SQL each |
| 2.8 | `attendance_select` RLS tightening; `mv_grade_summary` unique-index restore | BUG-006 | M | 2.0 | policy census + RLS probe |
| 2.9 | Bootstrap 9000 rewrite (syntax, RLS policies, trigger) as fresh-clone concern | BUG-006 | S | 2.0 | fresh-clone boot test |

## Phase 3 — Structure and contracts

| # | Task | Findings | Effort | Dependency | Verification |
|---|---|---|---|---|---|
| 3.1 | Price-source injection for non-tuition charges (sever domain→mock) | ARCH-001, L-1 | M | **before any mock work** | manual-charge suites |
| 3.2 | Repository interface merge (C-3) + approvals/purge domain contracts (ADD-1) | DUP-002, ARCH-007 | M | — | typecheck + t-313 |
| 3.3 | Split `supabase-shared-repositories.ts` by repository | ARCH-008, L-7 | M | ADD-2 desirable | typecheck + suites |
| 3.4 | UI relocations: sync-indicator, person-navigation-context, topbar split, tenant-switcher | ARCH-003/004, L-2..L-5 | M | — | typecheck + UI smoke |
| 3.5 | Dashboard analytics logic → domain (+thresholds from settings) | ARCH-009, L-6 | M | 1.2 | pinned-output comparison |
| 3.6 | Settings per-tab gating via feature-registry | ARCH-012, L-9 | S | — | RBAC suites |
| 3.7 | Mock-layer decisions: port or quarantine the 5 live slots (per feature) | ARCH-006 | L (per port) | 3.1 | per-feature live verification |
| 3.8 | core/ai placement ADR (document, don't move) | ARCH-002, L-8 | S | — | ADR |
| 3.9 | Legacy teacher-timetable stack removal + mock migration | DUP-021, R-2.7 | S | — | mock teacher suites |

## Phase 4 — Platform hygiene and documentation truth

| # | Task | Findings | Effort | Dependency | Verification |
|---|---|---|---|---|---|
| 4.1 | Generated DB-types pipeline (+ optional permission enum generation) | ADD-2, ADD-6, ARCH-014/015 | M | — | diff vs migrations; parity test |
| 4.2 | i18n decision executed (remove gen dicts or complete T-388 apply) | DEAD-005, R-3.8 | S or L | decision + sibling-repo check | i18n parity tooling |
| 4.3 | Scripts consolidation: parameterized delivery-zip builder; archive apply-live family | DUP-006/007, ADD-4, R-4.1/4.2 | S | — | builder output comparison |
| 4.4 | deliverables/ disposition (purge/LFS/keep) + Excel/ provenance placement + smartexport fix | OPS-001/005/006, L-11 | S-M | owner decisions | repo size; workflow |
| 4.5 | Table/select consolidation onto shared primitives (39 tables, 9 selects — progressive) | DUP-015 | L (incremental) | — | per-feature visual + a11y checks |
| 4.6 | Governance doc refresh: AGENTS.md §2/§3/§17, system-map, AGENTS_supabase refs, §15 numbering note | ARCH-016, OPS-009 | S | — | doc review |
| 4.7 | RBAC matrix persistence completion (or explicit future-work note) | BUG-017 | M | decision | settings suites |
| 4.8 | Import-abort modes decision (restore fail-closed or remove enum) | DEAD-013, R-3.6 | S | decision | import engine tests |
| 4.9 | Settings `?tab=` stuck-on-mount fix (topbar quick-backup target) | BUG-031 | XS | — | settings tab suites |

## Phase 5 — UI component unification (Session 2; evidence: UI Component Audit 00-05)

| # | Task | Findings | Effort | Dependency | Verification |
|---|---|---|---|---|---|
| 5.1 | Z-index tokens + animation-family consolidation (delete custom slide keyframes; toast verb) | DUP-023/028 | XS | — | snapshot tests on 5 shell surfaces |
| 5.2 | Wizard + AutoFormModal render through ModalShell (props stable, 24 consumers) | DUP-025 | S | 5.1 | existing wizard/form-modal suites + visual review |
| 5.3 | EntityDetailDrawer → ModalShell preset (responsive DrawerSize mapping) | DUP-024 | S | 5.1 | drawer suites (t-405 et al.) + visual review |
| 5.4 | Copilot drawer port + teacher-overlay reclassification | ARCH-021, DUP-024 | M | 5.3 | copilot streaming tests + role-dashboard suites |
| 5.5 | Native `title=` → shared Tooltip eradication (batched per feature area) | DUP-026 | M | — | per-area suites; a11y spot-check |
| 5.6 | BUG-025 header-slot fix + remove dead useModal/ModalHost stack | BUG-025, ARCH-018 | S | — | unified-modal suites |
| 5.7 | Collapsible primitive + ~10 site migrations | UI audit 04 | S | — | affected feature suites |
| 5.8 | KPI composition refactor (KpiCard root; ExecutiveCards decomposition) | DUP-027 | M | D-U1 desirable | dashboard/financials snapshots |
| 5.9 | Dashboard per-tab view-model hooks (de-prop-drill) | DUP-029 | M | — | existing tab tests |
| 5.10 | Settings ceremony primitives (SettingsCard promotion + useSettingsSection) + gating pass | DUP-030, ARCH-012 | M | — | settings suites + RBAC matrix tests |
| 5.11 | Repository-bypass routing (parent-detail-drawer; PlatformDiagnosticsPort for settings tooling) | ARCH-019 | S-M | — | crm + diagnostics suites |

## Phase 6 — Unified data pipeline (Session 4; evidence: Data Pipeline Unification 01-02, S4 cross-verification)

Consolidates 4 backup producers + 3 purge layers, 5 restore variants, 8 sync mechanisms, 6 XLSX + 2 CSV + 2 PDF + 2 ZIP surfaces + 3 download helpers, 6 ingestion paths + 3 re-import drivers, 6 offload mechanisms into PipelineCore + 8 services. Zero format loss (read-compatibility rules per format). Effort scale: XS≤1d, S≤3d, M≤2w, L≤1m.

| # | Task | Findings | Effort | Dependency | Verification |
|---|---|---|---|---|---|
| 6.1 | `pipeline/core/` as delegating facades (StreamRegistry dual-perimeter, SchemaVersionRegistry, FormatRegistry, ChecksumService, AuditBus) — no caller changes | R-4 groundwork | S | — | typecheck + new unit tests |
| 6.2 | `DownloadHelper` consolidates export-target/downloadBlob; replaces `downloadPdf` (12 sites), inspector-local helper, data-export inline | DUP-031, R-15 | S | 6.1 | t-368 suites + byte-compare artifacts |
| 6.3 | `exportToCsv` dialect param (`,` default, `;` FR, BOM always); route copilot through it | DUP-031 | XS | 6.1 | dialect unit test |
| 6.4 | Uniform `pipeline.export.*` audit events (archive-export, reports, CRM trio — today unaudited) | ARCH-030, P-7 | XS | 6.1 | audit assertions in t-382/t-505 |
| 6.5 | `VaultReplayAdapter` (snapshot → BatchUpsertRow[] → RepositoryStorageAdapter) + ImportService facade — the ONE commit path | R-1 groundwork, P-5 | M | 6.1 | t-364/t-421 green |
| 6.6 | Sync dispatch → declarative `SYNC_POLICY` table; keep fail-loud default (S4 refinement: 5 producer kinds / 8 push-path kinds / 5 enum-only kinds) | BUG-037, R-6 | S | — | t-022/t-171/t-305/t-415-sync |
| 6.7 | t-421 preflight triple as mandatory pre-write gate for every replay | R-5 | XS | 6.5 | t-421 extended |
| 6.8 | `RestoreService` 10-step contract (absorbs restore/inspectArchive/backup-file-restore); feature-flagged | ARCH-029/R-1 | L | 6.5 | t-415 + t-300 + NEW round-trip layer 1 |
| 6.9 | Live replay target + scoped restore UI ("restaure le magasin local / le serveur") | R-1; owner decision D-8 | M | 6.8 | NEW round-trip layer 2 (fake client) |
| 6.10 | 13-stream perimeter live in backup+restore; v1-read absence warnings | ARCH-026/R-4 | M | 6.8 | t-487 + round-trip layer 1 |
| 6.11 | Safety-backup refusal at service level (pre-restore/import/purge/sync-upgrade) | P-11 | S | 6.8 | refusal tests |
| 6.12 | Canonical archive v2 (manifest + per-stream SHA-256 + machine id) + v1 read migration | P-3/P-4, BUG-035/036 | M | 6.10 | NEW v2-format suite (writer↔reader + tamper) |
| 6.13 | `RetentionPolicy` ONE definition feeds vault sweep/service/mirror/RPC/EF; EF header fix | BUG-034/R-8, DUP-032 | S | 6.1 | t-415 retention tests |
| 6.14 | `WarmupService` merge (13 sources); retire warmSnapshotSources | ARCH-027/R-11 | M | 6.10 | t-487 + t-505 |
| 6.15 | data-export JSON v1 retirement; checkpoint relabel (D-10 default); inspector → SheetSpec + generateReportPdf + honest truncation | BUG-033, ARCH-028, R-10 | S | 6.2 | t-368 suites + inspector test |
| 6.16 | Therapy bytes: media-vault storage + `storagePath` + honest legacy labels | BUG-032/R-2 (Critical) | M | 6.1 | vault-compliance §02.06 extension — **superseded by 7.10 if LF-3 lands first** |
| 6.17 | Transactional flush (single-transaction RPC or savepoints) | R-5 | M | 6.7 | t-364/t-421 + failure-injection |
| 6.18 | Sync coverage: expense/personnel push paths or explicit prune; drop enum-only kinds | BUG-037, R-6 | M | 6.6 | t-022/t-171 extensions |
| 6.19 | H-9..H-16 backlog in severity order (mirror reconciliation, passphrase wording, state-off-localStorage, disk preflight, checksum alarms, quarantine, Deflate read) | R-7/9/12/13 + new | M | 6.12 | per-item suites |

## Phase 7 — Local-first migration (Session 4; evidence: LOCAL-FIRST-BLUEPRINT, S4 cross-verification; engine gates pre-verified)

Escapes the Supabase quota lock permanently (OPS-011: live mode broken today). PGlite main-process engine + five ports + self-hosted relay sync. Kill-switch rollback at every phase; the INV-2 gate (network-blocked boot/sign-in/read/write/backup/restore on the packaged Windows build) is the program's definition of success.

| # | Task | Findings | Effort | Dependency | Verification |
|---|---|---|---|---|---|
| 7.0 | **LF-0 seam formalization + hard-lock removal:** five ports as interfaces; delete canonical pin (`supabase-client.ts:35-38,148-157,171-172`, storageKey `:205`); backend-kind-aware `validateConnection` (replace `.supabase.co`-only check, `system-config.ts:431-433`); route the 16 bypass files (S4 count: 9 features + tenant-switcher + sync-provider + system-config + media-vault + llm-adapter + 3 sync); draft ADR-002/004 supersessions; `satisfies` factory exhaustiveness check | ARCH-019/022/023/024/033 | M | — | typecheck + full vitest; t-472 hermeticity re-pointed; ARCH-019 suites |
| 7.1 | **LF-1 local engine behind the seam:** PGlite `LocalDatabaseService` in main process; chain replay + `0000_local_compat` prologue (S4 census: pgcrypto+pg_trgm loadable; uuid-ossp+pgjwt skip-guards; auth-schema GUC shim for 89 `auth.uid()` refs); `LocalBackendAdapter` for the 49 overridden slots; 5 mock-only slots get real persistence (D-6 default: persist all five); IPC channels; mock↔local parity suite per repository | ARCH-006, DEAD-015, ARCH-035 | XL | 7.0, 6.5 | chain-census gate (100/14/5; 324/324 policies parse); t-364/t-421 vs local; perf gate at t-368-scale corpus; Windows packaging spike (<30 MB installer growth) |
| 7.2 | **LF-2 auth + RBAC local:** `LocalAuthService` (scrypt, sessions, activation codes 0055 semantics, role-escalation guard from EF `_shared/role-assignment.ts`); user-manager UI re-pointed; OAuth/global-signout per D-7 default (drop OAuth, keep global sign-out) | ARCH-031; D-7 | L | 7.1 | RBAC suites; T-266; activation lifecycle tests |
| 7.3 | **LF-3 EF ports + storage:** workflow engine promoted (fix 0088 divergence); overdue scanner canonized (INV-4 formula, delete EF twin); cron family → scheduled tasks; `MediaStore` local folders (absorbs 6.16); audit writer in adapter; financial-realtime channel removed → IPC change bus | ARCH-025 (27 RPC-only tables incl. `receipts`), R-2 | L | 7.1 | workflow parity suite (re-pointed); overdue fixtures; media round-trip |
| 7.4 | **LF-4 sync relay + conflict policies:** relay service (D-1 default: internet VPS); `SyncTransportPort` adapters (relay + supabase-as-relay); op-log change-log table; per-entity policy table (consumes 6.6); receipt sequencing (ADR-004 amendment); cross-machine invalidation bus; Android surface per D-2; FCM per D-3 | D-1..D-4 gate this row | L | 7.1, 6.6 | two-node simulation (deterministic replay proofs); offline-drain tests (t-171/t-305) |
| 7.5 | **LF-5 Supabase demotion + teardown:** supabase adapter = optional relay only; scripts archive sweep (292+52 files); §11.1 ceremony → local DB commands; ADRs finalized; credentials.md cleanup (OPS-012 owner action) | OPS-003/004/008/012 | S-M | 7.3, 7.4 | full suite + **INV-2 kill-the-network boot test** |

**Phase 6↔7 interlocks (from the graduated designs):** 7.0 starts immediately, parallel to Phase 6; 7.1 rides 6.5's commit path; 7.3 supersedes 6.16 (therapy bucket → local folder) and shrinks Phase 2's EF-repair scope (2.3 collect-payment EF and 2.4 config.toml die at 7.3 — sequence accordingly); 7.4 consumes 6.6's policy table; 6.9 and 7.4 wait on owner decisions D-8 and D-1 respectively (defaults proposed in `Investigation Archive/OWNER-DECISION-PACKET.md`). The final data extraction (blueprint §8) needs the Supabase spend cap lifted exactly ONCE — owner-gated, 24h notice in the issue before the migration weekend.

## Standing rules for all phases

1. One T-task per commit; five-question commit body; push after commit.
2. `tsc --noEmit` + relevant suites green before each commit; full `npm test` + baseline move at each batch boundary.
3. SQL/EF changes follow §11.1 live-verify ceremony; RLS never weakened; migrations append-only.
4. Cross-platform changes mirrored or registered as divergences (§10).
5. Findings register updated as items complete; UNRESOLVED items re-verified or escalated to the owner.
