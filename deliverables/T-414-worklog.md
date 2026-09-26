# Multi-Agent Worklog

---
Task ID: 1
Agent: main (Super Z session)
Task: Issue #14 (AgentGithubUplaod) — Price Configuration + Generic Excel Import System (T-414)

Work Log:
- Cloned both repos into /home/z/my-project/workspace/ (AgentGithubUplaod = hub, elimtiyaz-website = portal).
- Explored hub architecture: desktop app at elimtiyaz-desktop/, canonical Supabase backend (migrations 0001-0116), docs/ tree, AGENTS.md rules (§15.1-§15.56).
- Read Excel deep-analysis: Excel/excel_deep_inspection_report.md + full_descbrtion.md. Old WB (Suivis clients 2026_2027, 4 sheets) vs New WB (2027-2026, 2 sheets). ETAT columns A-AA identical semantics; col F header NOM→blank; col S V2→V1 rename; therapy grid PSY1-2+ORTH1-2+E-PLANT+Ratrapage → PSY1-14; quarterly blocks → CREANCE SEPT ×3 + TT CREANCE; NEW COURS SUP/LIVRES/CLUB/SORTIES. Core formulas P=R+S+T+U+W+X+Y and Q=L-P identical.
- Mapped existing import engine: src/infrastructure/excel/import-engine/ (ImportSchema TS constants, sheet-detector 2-tier, RepositoryStorageAdapter → domain repos → sync queue upsert_*_from_import RPCs). Existing schemas: etat/devis/bon/ref (old format only).
- Mapped pricing layer: migration 0006 (pricing_configs unique(tenant_id, academic_year_id) — per-year model EXISTS in DB), 0089 realignment, SupabasePricingRepository.activeConfigId() picks FIRST active row (not year-scoped), readDbPricingConfig not year-scoped, UI pricing-tab has no year dimension. ADR-017: catalog drives FUTURE quotes only; corpus pins 2026/2027 defaults.
- Problem-ID census (§15.54): PRICING family does NOT exist yet → register PRICING-500; IMPORT family last = IMPORT-110 → register IMPORT-111.
- Next: baseline typecheck/lint/vitest (§15.14), then Task 1 (price config) → Task 2 (import config + generic engine).

Stage Summary:
- Environment ready; architecture understood; analysis material located; task registered as T-414 in plan.
- KEY DESIGN DECISIONS:
  - Task 1: migration 0117 (one-active-per-tenant partial unique index + set_active_pricing_config + create_pricing_config_for_year RPCs), extend PricingRepository contract (listConfigs/activateConfig/createConfigForYear/readForYear), mock+supabase parity, pricing-tab year selector UI. observe() = ACTIVE config (calculation source of truth); historical = read-only.
  - Task 2: new import-config module (versioned JSON-serializable ImportConfigDocument + ImportConfigRegistry central repository + 5 configs incl. new etat-2027-2026), engine schemas/index.ts becomes registry-backed shim (engine code unchanged), column-letter addressing for headerless formats, header-signature disambiguation (V1+LIVRES+CLUB+SORTIES vs NOM), adapter extended for psy3-14/coursSup/livres/club/sorties, EntityMatcher + extension-point interfaces (NO profile matching implementation).

---
Task ID: 2
Agent: main (Super Z session)
Task: T-414 implementation — Task 1 (price config) + Task 2 (import config registry + 2027-2026 format)

Work Log:
- Task 1: migration 0117 (one-active-per-tenant index + set_active_pricing_config + create_pricing_config_for_year RPCs), applied LIVE atomically + verified 9/9 GREEN (verify_t-414.sql BEGIN/ROLLBACK, zero residue). PricingConfigSummary + PricingRepository contract (listConfigs/readForYear/createConfigForYear/activateConfig) + Supabase + mock parity + the pricing-year-config-bar UI. +16 tests (10 mock + 6 supabase). Committed 9f4932e, merged 522ed92, pushed.
- Task 2: deep comparison doc (excel-format-comparison-2026-2027-vs-2027-2026.md) BEFORE design; ADR-026; import-config module (types + config-registry with full validation + extensions with NoOpEntityMatcher + 2 config documents); engine integration additive (FieldSpec column/aliases, __col_ synthetic keys, column-first lookup, header-row-aware format detection in processSheet, schemas derived from registry); adapter extended for PSY3-14/COURS SUP/LIVRES/CLUB/SORTIES through the existing ledger/payments/installments streams; CREANCE SEPT/TT CREANCE informational-only. +14 tests (7 registry + 7 new-format E2E incl. canonical equivalence old↔new). Fixed: REF empty-identity validation, FastPaymentRepo stub, statistiques exclusion assertion, entryType→type, equivalence-mode workbook. Committed 51192ac.
- CONCURRENT AGENT: the parallel 99th session pushed T-415 Phase 0 (d4540e1) mid-flight; merged cleanly (78aeeaa) — both sessions' registry entries preserved; they own next-task.md.
- Full suite after both tasks: 3973 passed / 25 failed / 24 skipped — failing set byte-identical to the documented baseline. tsc 0, eslint 0 errors on changed files.
- Remaining: delivery zips + issue #14 comment + final report.

Stage Summary:
- T-414 COMPLETE (IMPLEMENTED/TESTED): PRICING-500 + IMPORT-111 both RESOLVED/TESTED with recorded evidence; migration chain head 0117 (live).
- Key learnings recorded: Management API returns HTTP 201 (not 200) for successful SQL; PLpgSQL blocks take ONE exception section with multiple WHEN clauses; has_function_privilege arg order is (user, function, privilege); set_config('request.jwt.claims', ..., true) inside DO blocks; vitest does NOT typecheck (Result narrowing needs explicit guards); the real workbooks live under Excel/ (test path candidates extended).
