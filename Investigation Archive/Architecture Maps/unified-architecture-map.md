# Unified Architecture Map — El-Imtiyaz Desktop (Session 1)

**Status:** cross-verified against source by 8 parallel verification passes + static import-graph analysis + typecheck/test execution.
**Scope:** the whole repository (`Vtheonly/AgentGithubUplaod`), with the application proper at `elimtiyaz-desktop/`.

---

## 1. Repository topology (what actually exists)

```
AgentGithubUplaod/  (the "hub" repo)
├── elimtiyaz-desktop/          ★ THE APPLICATION (Electron + React + TS + Supabase)
│   ├── electron/               main.cts + preload.cts (Node main process; imports ONLY electron+node builtins)
│   ├── src/                    renderer process (961 TS/TSX files, ~318k lines)
│   │   ├── app/                composition root: app.tsx, app-shell.tsx (routes), splash-gate, 7 providers
│   │   ├── core/               primitives + RBAC + format + theme + AI runtime (30 files)
│   │   ├── domain/             models + calc engines + repository interfaces (111 files)
│   │   ├── features/           10 feature areas, 220 files (UI + view-models)
│   │   ├── infrastructure/     supabase + mock + excel + backup + sync + export + ai + storage (176 files)
│   │   ├── shared/             UI kit + layout chrome + hooks + devtools + particle-engine (79 files)
│   │   ├── i18n/               base dicts + (dead) generated dicts + stats-tips glossary
│   │   └── tests/              325 test files (vitest)
│   ├── supabase/               152 migrations (0001–0157, 5 numbers never used), 16 EF folders (22 files),
│   │                           config.toml, bootstrap/9000 (BROKEN — see BUG-006)
│   ├── financial-tests/        cross-platform equivalence scenarios
│   ├── scripts/                302 files: test runner, packager, 80 apply-live, 78 verify, i18n toolchain…
│   ├── public/, resources/     static assets
│   └── package.json            v1.3.0 (test 5247-pass baseline; check:migrations wired)
├── Context Report/             the 7 prior AI investigation reports (INPUT — preserved)
├── docs/                       governance: agents, architecture, audits, 35 ADRs, domain rules,
│                               operations, recovery (task registry T-001..T-548, 181 sessions), testing
├── AGENTS.md                   1,109-line operating manual (~110 §15 rules)
├── AGENTS_supabase.md          DB incident report + rules
├── scripts/ (root)             52 files: 39 tNNN-build-zips.sh + 13 one-offs
├── deliverables/               142 committed zip artifacts — 985 MB (OPS-001)
├── Excel/                      owner workbooks + deep-inspection provenance (2 MB)
├── .smartexport/               AI-context selection state (2 JSON)
├── src/ (root)                 stray EMPTY file only (DEAD-001)
├── build-windows.sh            Linux host wrapper → npm package:win (intentional 3-layer chain)
├── package-lock.json           96-byte stub, no package.json (OPS-007)
└── Investigation Archive/ · Refactoring Unified/   (this investigation — charter-mandated)
```

Sibling repos referenced but NOT in this repo: `elimtiyaz-android` (Android client), `elimtiyaz-website` (web client). Cross-platform parity is a standing governance rule (§10); several findings (workflow engine, permissions, pull RPCs) have Android consumers.

## 2. Runtime architecture (how the app actually executes)

```
┌────────────────────────── Electron main process (electron/main.cts) ─────────────────────────┐
│  window lifecycle, zoom, shell.openExternal, file save/pick IPC (vault:*)                    │
└───────────────────────────────────────▲──────────────────────────────────────────────────────┘
                                        │ preload bridge (same api exposed as window.elImtiyaz
                                        │ AND window.elImtiyazDesktop — members: window/zoom/
                                        │ shell/saveFile/pickFile/pickBackupFile/pickDirectory)
┌─────────────────────────────── Renderer (Vite + React) ──────────────────────────────────────┐
│ app/app-shell.tsx — routes: / /crm /academics /academics/class/:id /roll-call /grades/:id    │
│                       /financials /personnel /workflow /settings /profile /login            │
│ Route guard: core/rbac/route-access (6 protected prefixes; /personnel = fallback, ARCH-011)   │
│                                                                                               │
│ app/providers (7): repository (Repositories context ★service locator), auth (Session),        │
│   toast, modal, user-preferences (theme), sync, ai-copilot                                    │
│                                                                                               │
│ FEATURES (10 areas) ──useRepositories()──▶ app/providers/repository-provider                  │
│   academics·ai·auth·crm·dashboard·financials·personnel·profile·settings·workflow              │
│                                                                                               │
│ REPOSITORY SELECTION (repository-provider.tsx:171-192):                                       │
│   useSupabase=false → mockRepositories (mock-composite: 54 in-memory slots)                   │
│   useSupabase=true  → getSupabaseRepositories() = {...mockRepositories, …49 Supabase          │
│       overrides…} + Object.assign(approvals)   ← mock layer ALWAYS constructed/bundled        │
│       5 slots stay mock in live mode: clubs, psychology, orthophonie, aiConfig,               │
│       performanceReviews (ARCH-006)                                                           │
│   + realtime overlay: financial-realtime swaps repositories.debt via Object.defineProperty    │
└──────────────────────────────────────┬────────────────────────────────────────────────────────┘
                                       │ supabase-js (anon/publishable key; prod locked to
                                       │ https://vebfehrpzajhstyhinnw.supabase.co)
┌──────────────────────────── Supabase (Postgres + EFs) ───────────────────────────────────────┐
│ 152 migrations → ~99 live tables (by chain), RLS everywhere (331 CREATE POLICY stmts),        │
│ 54 seeded permissions + 11 roles, canonical financial RPCs (collect_and_allocate_payment,     │
│ revert_payment_allocation, register_family_batch, …), triggers (receipt numbering, audit      ││
│ append-only, handle_new_auth_user), 5 materialized views, 16 Edge Functions                   │
│ (ai-proxy, workflow-execute engine, run-overdue-scan, cron family, user-account mgmt)         │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 3. Layer dependency matrix (measured, import-statement counts; tests excluded)

| from \ to | app | core | domain | features | i18n | infrastructure | shared |
|---|---|---|---|---|---|---|---|
| **app** | — | 20 | 17 | 14 | 1 | 14 | 10 |
| **core** | 7 | — | 32 | 0 | 0 | 0 | 0 |
| **domain** | 0 | 17 | — | 0 | 0 | **1** | 0 |
| **features** | **334** | 176 | 410 | — | 0 | **73** | 941 |
| **i18n** | **1** | 0 | 0 | 0 | — | 0 | 1 |
| **infrastructure** | **10** | 270 | 450 | **2** | 0 | — | 3 |
| **shared** | **12** | 14 | 6 | **3** | 1 | **5** | — |

Reading notes:
- `features → app` (334 statements) is the **providers-as-service-locator** pattern: nearly every feature file pulls `useRepositories`/`useAuth`/`useToast` from `app/providers`. This is the de-facto architecture, not a documented one (ARCH-005).
- `core → domain/app` (38 statements, all inside `core/ai/*`): the AI runtime sits ABOVE domain engines and consumes the app's `Repositories` interface. "Core is the bottom layer" only holds for `core/{result,logger,app-error,audit-actions,rbac,format,theme}` (ARCH-002).
- `domain → infrastructure` (1 statement) is the single hard boundary break: `domain/calc/ledger/non-tuition-charges.ts:29 → infrastructure/mock/pricing-seed` (ARCH-001).
- `shared → {app 12, features 3, infrastructure 5}`: topbar (features/dashboard alert modal, infra sync-indicator), person-navigation-context (features/crm drawers), tenant-switcher (infra supabase-client), generators (infra mock fixtures), audit-activity-toaster/modal-host/toast-viewport/gated-content/search-index (app providers) (ARCH-003).
- `infrastructure → {app 10, features 2}`: sync-indicator → sync-provider + features/settings conflict-resolver-modal (a UI component living under infrastructure/); mock dashboard-layout-repository → features/dashboard/dashboard-layout-storage constant; backup* → repository-provider (ARCH-004).

## 4. Module-by-module responsibility map (authoritative implementation ⇒ condition)

### 4.1 Core (`src/core`, 30 files)
| Module | Responsibility | Authoritative? | Consumers | Condition |
|---|---|---|---|---|
| `result.ts` + `app-error.ts` | Result type + error taxonomy | YES (canonical) | 86 files | Healthy; 3 dead combinators; duplicate unknown-error normalization |
| `logger.ts` | JSON structured logger w/ redaction | YES | 18+ files | Healthy; setLevel dead; `*ApiKey` redaction gap (latent, BUG-024) |
| `audit-actions.ts` | Audit wire constants | YES | 25 files | Healthy |
| `rbac/*` (7 files) | Session, roles, 71-permission enum, feature registry, route access | YES (client-side authority) | auth-provider, app-shell, sidebar, features, settings | Functionally sound; ~25 dead exports; stale registry metadata; dual gating idioms; vocabulary split vs SQL seeds (ARCH-016) |
| `format/*` | currency/date/id formatters | YES | 37+ files | Healthy core; 3 dead formatters contradicting live data (EMP- vs PER-); 2 infra toIsoDate clones |
| `theme/*` | palette engine + presets | YES | user-preferences-provider, settings | Clean; light-border drift 62% vs 65% |
| `ai/*` (14 files) | copilot runtime: 27 tools, streaming, artifacts, stats/insights | YES (desktop copilot) | ai-copilot-provider, features/ai renderers, llm-adapter, ai-config-tab | Working; dispatch fragility ("inconnu :"); formatting duplication; several verified tool bugs (BUG-003/005/023); transport = direct BYOK for copilot, edge-first for single-shot |

### 4.2 Domain (`src/domain`, 111 files)
| Module | Responsibility | Authoritative? | Condition |
|---|---|---|---|
| `model/*` (24) | entity models + label maps | YES | wide | Healthy; some dead types/unions (fictional discounts, `missing_proof`, `AcademicCycleLegacy`) |
| `calc/ledger/*` | account ids, entries, balance replay, debt-aging (INV-16), year-history | YES (client-side canonical, mirrored in SQL 0111+) | 50+ files | Strong; epsilon/inv4 duplicated in year-history; overdue split charge-vs-installment (intentional) |
| `calc/payment/*` | INV-4 predicates, sums, waterfall, clearance, LIFO, tranche-waves, service-pricing-profile, financial-query-engine | YES for queries/splits; service-pricing-profile deviates (C11) | 50+ files | Strong core; INV-4 re-derived ≥6×; label parsing; hardcoded 2026 deadline |
| `calc/pricing/*` | school-price-matrix (2026/2027 real prices), tuition split, transport, discount rules/engine | YES (one of FOUR devis engines — see DUP-001) | mock, supabase wires, features, excel | HIGH duplication risk |
| `calc/academics/*` | subject-config (ADR-018), gpa, terms, promotion, class-placement, algerian-curriculum | YES | features/academics, crm, core/ai | gpa config-resolution bug (BUG-002); terms bug (BUG-001); class-placement legacy-column mapping |
| `calc/timetable/*` | algerian-profile Sun–Thu, constraints, feasibility, greedy solver | YES | only via repositories | periodMinutes ×4 copies; constraint indexing repeated |
| `calc/teacher/*` | LEGACY Mon–Fri teacher timetable validation | NO — superseded by calc/timetable | mock teacher-repo ONLY | Obsolete (DUP-021) |
| `calc/workflow/*` + `kahn.ts` | condition evaluator, dry-run, auto-layout, 3 templates | YES (client simulator) | features/workflow, mock, tests | Triplicated with SQL+EF (DUP-003) |
| `calc/payroll/*` | payroll-forecast | YES (sole engine, ADR-024) | financials, dashboard, core/ai | Low risk |
| `calc/{diff,expense,clubs,therapy,reconcile}/*` | audit diffs, 3-way merge, anomaly signals, club/therapy validation, reconciliation checks | YES | narrow | anomaly type duplication; cross-check blind spots (BUG-021); reconciliation.ts test-only (DEAD-011) |
| `identity/*` (11) | ER-PMAE identity resolution pipeline | YES | excel import, experimental tab | Low risk |
| `repository/*` (9) | 50+ repository interfaces | YES (contracts) | provider + implementations | Interface split repository.ts vs academic-repository.ts (DUP-002); 4 interfaces mock-only; approvals+purge have NO interface (ARCH-007) |

### 4.3 Infrastructure (`src/infrastructure`, 176 files)
| Module | Responsibility | Authoritative? | Condition |
|---|---|---|---|
| `supabase/supabase-client.ts` | client + mode resolution + prod lock | YES | Healthy |
| `supabase/supabase-repositories.ts` | factory: mock spread + 49 overrides + approvals | YES | Header comments stale; ARCH-006 mock-always-bundled |
| `supabase/repositories/` (38) | all Supabase adapters | YES (live persistence) | shared-repositories.ts = 5,250-line monolith (ARCH-008); behavioral drift vs mock (DUP-005); stale mapStudentRow copy; audit divergences |
| `supabase/types.ts` | DB row types | nominal | Hand-written, ~23/99 tables — STALE (ARCH-015) |
| `supabase/financial-realtime.ts` | realtime invalidation + debt facade + pause/resume | YES | Healthy |
| `mock/` (53) | in-memory repositories + MockStore + subject-behavior + seeds + fixtures | YES for the 5 live mock slots + mock mode | subject-behavior + pricing-seed are PRODUCTION dependencies (do not prune); fixtures production-reachable via ungated Ctrl+O (ARCH-010) |
| `excel/` (44) | import engine + configs + export writers | YES | Healthy core; unreachable abort modes; label-parsing |
| `export/` (5), `backup/` (7), `sync/` (7), `receipt-pdf/` (12), `ai/` (3), `storage/` (1), `experimental/` (1) | archives, vault, offline queue, PDFs, LLM router, media vault, flags | YES | sync-indicator layering violation; backup restore mock-only (documented); fixed-salt docstring contradiction; narrative-generator.ts DEAD (DEAD-010) |

### 4.4 Features (`src/features`, 220 files)
| Area | Entry | Repos | Condition |
|---|---|---|---|
| academics (42) | 4 routes + registry | 12 repo families | Active; render-phase setState ×5; UTC date keys; hardcoded literals |
| crm (24) | /crm + 5 deep-links | parents/students/re-enrollment/debt/… | Active core; 4th devis engine lives here (compute-billing) |
| dashboard (40) | / | 10 repo families | Active; contains business logic that belongs in domain (ARCH-009); 1 dead file; hardcoded thresholds |
| financials (22) | /financials + 4 deep-links | payments/installments/debt/expenses/ledger | Active core; mixed settled-predicates |
| personnel (39) | /personnel | 10 repo families | Active; 1 dead file (340 lines); dual reimbursement flows |
| settings (39) | /settings | settings/pricing/audit/accounts/approvals/aiConfig | Sprawling 14 tabs, per-tab gating gaps; RBAC matrix localStorage-only |
| workflow (6) | /workflow | workflows | Healthy; non-canonical role strings |
| ai (4), auth (2), profile (2) | — | providers | Healthy |

### 4.5 Shared (`src/shared`, 79 files) + i18n (9 files)
UI kit fully alive (no dead files); symbol-level dead weight catalogued; layout chrome has upward imports; devtools autofill ungated in production; particle-engine decorative with internal dead code. i18n: base dictionaries alive; **generated dictionaries (3×1,028 keys) 100% dead** (DEAD-005); hardcoded French widespread.

### 4.6 Supabase backend
152 migrations; canonical financial RPCs (8 redefinitions of collect_and_allocate_payment across the chain — append-only style); RLS heavy; 11 verified live bugs (BUG-006/007) + bootstrap 9000 broken; workflow + overdue logic triplicated with client (DUP-003/004); permission vocabulary split (ARCH-016).

### 4.7 Scripts & tooling (both locations)
- **Active and wired** (~20 files): `run-unified-tests.mjs`, `build-windows.mjs`, `check-migrations-append-only.sh`, `test-baseline.json`, `run_verify_sql_live.sh`, `t404-postgrest-smoke.sh`, i18n toolchain (11), corpus generators, `clean-slate-reset.mjs`, fixtures builder, root `build-windows.sh` (3-layer chain — intentional).
- **Consolidatable**: 39 build-zip scripts (near-identical), 80 apply-live scripts (historical boilerplate).
- **Broken**: 11 root one-off scripts with dead absolute paths; `check-supabase.ts`; `eyeball-probe-cleanup.py`; `update_allowed_origins.sh`.

## 5. Data-flow sketches (canonical write path example)

Payment collection (authoritative): `features/financials/unified-payment-modal` → `useRepositories().payments` → `SupabasePaymentRepository.collect` (`supabase-shared-repositories.ts:2470-2508`) → RPC `collect_and_allocate_payment` (SQL 0127, waterfall + ledger + audit trigger) → realtime events → `financial-realtime` → `repositories.debt` facade refresh → UI re-renders. The EF `collect-payment` is a second, BUGGY wrapper of the same RPC (BUG-007) — desktop does not use it; Android may.

Registration billing (contested): `features/crm/batch-registration` → `computeBilling` (feature engine) for preview → `SupabaseStudentRepository.batchRegister` → `registration-billing-wires.buildRegistrationBillingWires` (different remise strategy) → RPC `register_family_batch` (0128, source_id regression BUG-006) → installments + ledger. Mock mode uses a third strategy (per-student FI tranche-0); Excel import uses a fourth (school-price-matrix). **Four engines can produce different installment shapes for the same student (DUP-001).**

## 6. Architectural boundaries: enforced vs violated

| Boundary | Status | Evidence |
|---|---|---|
| Electron main ⟂ renderer | ENFORCED | main.cts imports only electron/node; all src is renderer-side via preload |
| Append-only migrations | ENFORCED (tooling) / VIOLATED (history) | guard wired to npm test; 22 files modified post-commit (OPS-010) |
| Financial writes via canonical RPCs | ENFORCED (desktop) | ADR-002; all mutations through RPCs; EF wrappers divergent |
| domain ⟂ infrastructure | VIOLATED (1) | non-tuition-charges.ts:29 (ARCH-001) |
| shared ⟂ features/infrastructure/app | VIOLATED (20 stmts) | topbar, person-navigation-context, tenant-switcher, generators… (ARCH-003) |
| infrastructure ⟂ features/app | VIOLATED (12 stmts) | sync-indicator.tsx; mock dashboard-layout-repository (ARCH-004) |
| core = bottom layer | VIOLATED by design (AI subsystem) | core/ai → domain + app providers (ARCH-002) |
| Single modal system | VIOLATED | 4 raw Radix Dialog wrappers beside UnifiedModal |
| Single i18n system | VIOLATED | dead gen dictionaries + widespread hardcoded FR/EN |
| RLS on all tables | ENFORCED | 106 ENABLE statements; one leak (attendance_select, BUG-006) |

## 7. What would break if X were removed (top linkage risks)

- `infrastructure/mock/subject-behavior.ts` → 26+ Supabase repositories break (production-shared primitive).
- `infrastructure/mock/pricing-seed.ts` → Supabase pricing/student repos + domain non-tuition-charges break (price fallback + boundary violation).
- `mock/fixtures/*` → Ctrl+O autofill (production-mounted) breaks.
- `mock-composite` → `getSupabaseRepositories` spread base breaks; live mode loses its 5 mock slots.
- `domain/calc/ledger/non-tuition-charges.ts` → Supabase `appendManualCharge` + feature price previews break (do NOT delete despite the mock import).
- `core/ai/*` ↔ `app/providers` — deleting repository-provider's `Repositories` interface breaks the whole AI tool layer (type-only).
- `supabase/functions/workflow-execute/engine.ts` ← desktop vitest imports it (cross-tree test seam).
- Removing `deliverables/` contents: nothing in code references them; only owner workflow.
