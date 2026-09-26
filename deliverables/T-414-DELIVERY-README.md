# T-414 Delivery — Price Configuration & Generic Excel Import System (99th session, 2026-09-26)

**The owner's mandate (GitHub issue #14):** two tasks — (1) **Price Configuration**: independent, complete price configurations per academic year, one active as the source of truth for new payments/invoices/charges/calculations, historical pricing preserved, explicit activation when moving to a new year; (2) **Excel Import Configuration + Generic Import Engine**: deep comparison of the old and new workbooks BEFORE any design, a configuration describing the new format, ONE generic importer driven by a centralized configuration repository, everything flowing into the SAME canonical model and the EXISTING financial ledger, with profile/entity matching kept as a future extension point ONLY. Then zip all the systems and the main repo, push with the PAT, and deliver.

## What this delivery contains

| File | What it is |
|---|---|
| `AgentGithubUplaod-T414.zip` (44.9 MB) | **The main repo (hub)** at commit `0df66b6` — the complete tree: `elimtiyaz-desktop/` (source + tests + scripts + the migration chain through **0117**), `docs/` (the full documentation system incl. the T-414 records), the Excel forensic workbooks, `build-windows.sh`, and the prior `deliverables/` set. |
| `elimtiyaz-website-T414.zip` (728 KB) | **The website repo** at `5c530b6` (no changes needed this session — T-414 is desktop+backend scoped; the website consumes the canonical read-side which is unchanged in shape). |
| `elimtiyaz-all-systems-T414.zip` (45.6 MB) | Both systems combined. |
| `T-414-worklog.md` | The session worklog (the multi-agent log format). |

**Note on `deliverables/archives/`:** the historical delivery zips (177 MB) remain **excluded** from these zips to stay under GitHub's 100 MB file limit — they are permanently preserved inside the repository itself at `deliverables/archives/`. Cloning the repo gives you everything.

## What the session did

### Task 1 — Price Configuration (PRICING-500 → RESOLVED/TESTED; ADR-025; migration 0117 LIVE)

- **Migration 0117** (applied live atomically; chain head **0117**; verified **9/9 GREEN** by `scripts/verify_t-414.sql`, §11.1 BEGIN/ROLLBACK, zero residue):
  - `pricing_configs_one_active_per_tenant` — the partial unique index: exactly ONE active config per tenant, enforced by the DATABASE.
  - `set_active_pricing_config(p_config_id)` — the atomic, staff-gated, tenant-scoped, audited activation switch (idempotent; cross-tenant and no-staff-role attempts rejected — live-proven).
  - `create_pricing_config_for_year(p_academic_year_id, p_label, p_clone_from_active)` — the new-year preparation RPC; clones the five child grids (tuition/transport/complementary/additional/discounts) from the active config; friendly 23505 on one-config-per-year.
- **The application layer:** `PricingConfigSummary` + the `PricingRepository` contract extension (`listConfigs` / `readForYear` / `createConfigForYear` / `activateConfig`; `observe()` = the ACTIVE config — the calculation source of truth for `batchRegister` billing, the wizard, the import installments); Supabase + mock parity; the **Settings → Tarification year-config bar** (list / create-with-clone / confirm-guarded activate / read-only historical tuition preview).
- **Historical preservation (the mandate's core principle), live-proven (C4):** the deactivated config's label/registration_fee/second_apron_fee/academic_year_id/child-grid counts are byte-identical after the switch; balances replay stored ledger amounts (ADR-017 §4 / INV-1) — no code path recomputes stored financial rows from the active config, and this task adds none.
- Tests: **+16** (10 mock contract incl. the historical-preservation + clone-isolation checks; 6 Supabase routing/summary tests).

### Task 2 — Excel Import Configuration & Generic Import Engine (IMPORT-111 → RESOLVED/TESTED; ADR-026)

- **The deep comparison FIRST** (the mandate's order): **`docs/architecture/excel-format-comparison-2026-2027-vs-2027-2026.md`** — the complete column mapping, formula equivalence, the #REF! root causes, the relationships that must survive, and a populated-column census. Key findings: columns A–E/G–Y semantically identical; **column F's NOM header vanished** (positional addressing required); **column S relabeled V2→V1** (same canonical concept); the therapy grid expanded to **PSY1–14**; **three CREANCE SEPT columns share one header** (positional addressing); **COURS SUP / LIVRES / CLUB / SORTIES** added; the P and Q formulas are byte-identical; L is the same logic with the year's price constants (the Task-1 per-year pricing concern); CREANCE SEPT is genuinely new and informational; `statistiques` is a #REF!-broken dashboard (excluded).
- **The central configuration repository** (`src/infrastructure/excel/import-config/`): versioned, JSON-serializable `ImportConfigDocument`s + `ImportConfigRegistry` (register / load / identify / select / validate / version / resolve / manage) + structural validation with precise issue paths + the two built-in format documents (`etat-2026-2027` with its 4 sheets; `etat-2027-2026` with the new grid).
- **The engine stays generic (additive changes only):** `FieldSpec` gains `column` (positional letter) + `aliases`; the parser emits synthetic `__col_<LETTER>` row keys; `lookupValue` resolves column-first; `processSheet`/`listSheets` detect the FORMAT with the actual header row (the same sheet NAME exists in both workbooks — the header signature V1+LIVRES+CLUB+SORTIES vs NOM disambiguates); the four legacy schemas are now DERIVED from the configuration (one source of truth; the named exports and detection order preserved).
- **Same canonical model, same financial system:** the new columns map onto the SAME import-record contract (V1 → the canonical key `v2`; PSY3–14 → therapy_psychology; COURS SUP → tuition; LIVRES → books; CLUB/SORTIES → extracurricular) through the SAME `RepositoryStorageAdapter` → repositories → ledger/payments/installments → sync-queue RPCs. CREANCE SEPT ×3 + TT CREANCE are deliberately never ledgered (INV-1 — balances replay).
- **Extension points ONLY (profile matching NOT implemented, per the mandate):** `EntityMatcher` + `NoOpEntityMatcher` (always "no match"), `ImportConfigStore` (a future DB-backed configuration store), `ImportValidationRule`, `ReconciliationHook`, `ImportSourceAdapter`.
- Tests: **+14** (7 registry incl. validation/detection/versioning/the no-op-matcher mandate check; 7 E2E against the REAL `2027-2026.xlsx` — 1 139 students imported from the HEADERLESS column F, financial records through the existing streams, statistiques exclusion, idempotency, the synthetic ancillary-services round-trip, and the **CANONICAL EQUIVALENCE proof**: the same student expressed in both layouts imports to identical canonical records and identical ledger totals). The legacy real-workbook suite re-ran **9/9** through the registry-backed engine (the path candidates now include `Excel/`).

## The commits of this session (all pushed to main)

1. `83a5dad` — docs(recovery): T-414 Phase 0 — PRICING-500 + IMPORT-111 + ADR-025 (register before any fix, §13)
2. `9f4932e` — feat(pricing): Task 1 — migration 0117 live-applied + verified 9/9 GREEN (PRICING-500 RESOLVED/TESTED)
3. `522ed92` — merge: Task 1 (the feature branch; one trunk)
4. `51192ac` — feat(import): Task 2 — the ImportConfigRegistry + the 2027-2026 format (IMPORT-111 RESOLVED/TESTED)
5. `78aeeaa` — merge with the concurrent session's T-415 Phase 0 (both registries preserved)
6. `0df66b6` — docs(recovery): the T-414 close-out
7. The delivery commit (this one)

## Verification gates (all recorded)

- `npx tsc --noEmit` → **0 errors**.
- `npx vitest run` (FULL) → **3 973 passed / 25 failed / 24 skipped** — the failing set **byte-identical to the documented pre-session baseline** (the pre-existing dashboard/cross-platform/t-034/vault families; zero regressions; +37 session tests).
- `npx eslint` on every changed file → **0 errors**.
- Migration chain: append-only guard OK (+1 file, head **0117**); applied live atomically with registration; idempotent re-run verified.
- Live verification: `scripts/verify_t-414.sql` → **9/9 GREEN** (`docs/recovery/t-414-live-verification.md`).

## Key documentation to find later

- **`docs/recovery/t-414-live-verification.md`** — the migration's live evidence (9 checks).
- **`docs/architecture/excel-format-comparison-2026-2027-vs-2027-2026.md`** — the deep workbook comparison (the design input).
- **`docs/decisions/ADR-025-per-year-price-configuration.md`** + **`ADR-026-import-configuration-architecture.md`** — the two architecture decisions.
- **`docs/recovery/task-registry.md`** T-414 + **`problem-registry.md`** PRICING-500 / IMPORT-111 — the full records with evidence.

## Honest remaining items

- The owner's packaged-app UI pass over the year-config bar + an import of the 2027-2026 workbook through the CRM import modal on a real machine (the standing visual-acceptance gate for every desktop feature).
- Profile/entity matching: NOT implemented (by mandate) — the extension points await a future task.
- The 2027-2028 pricing configuration itself is an explicit owner action (create → adjust → activate); no config was auto-created.
- The concurrent T-415 session (issue #13, backup/restore) was in flight during delivery; its Phase 0 registration is preserved on main and untouched.
