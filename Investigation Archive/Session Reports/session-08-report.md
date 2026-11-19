# Session 8 Report — The Excel Import Engine Deep Audit + Heavy-Test Sweep

**Date:** 2026-11-19 · **Session ID:** S8 · **Branch:** `investigation/session-08` · **Repo HEAD at start:** `9ad9fef2` (main, clean tree)
**Owner mandate (verbatim):** "do the excel import and test it heavly on the excel import on the db sweep the whole codebase on the excel import engine imlaimtrntion audit fullly"
**Read-only regime:** MAINTAINED — no application source, config, schema, or dependency modified. All harness scripts live OUTSIDE the repository (`/home/z/my-project/scripts/`, sandbox layer). Only `Investigation Archive/` written.

---

## 1. What the session set out to do

Three things at once, per the mandate: (a) sweep the WHOLE codebase for the Excel import engine implementation; (b) audit it fully (inventory, comparisons, failure modes); (c) test it HEAVILY on the DB path.

## 2. The sweep (what was read, end-to-end)

The complete engine estate, ~8,500 lines, every file opened and read:

- **`src/infrastructure/excel/import-engine/`** — 29 files: the orchestrator (`import-engine.ts` 613L), the DB write path (`storage/repository-adapter.ts` **2,961L**, read in full, in chunks), the port + in-memory adapter, the parser (dynamic header-row scoring, positional `__col_<LETTER>` addressing, formula/richText/error normalization), the sheet detector, the row validator (summary-row detection, field-resolution precedence, the Iteration-21 "import no matter what" policy), the field coercer + all six rules, the schema shims, the three mappers (niveau/name/destination), the upsert matcher, the ER-matcher (T-438 seam), the two reporters, the utils, types/context/errors.
- **`src/infrastructure/excel/import-config/`** — the central registry (validation + detection + resolution) and BOTH format documents (`etat-2026-2027.ts`, `etat-2027-2026.ts`) with their full field maps.
- **`src/features/crm/excel-import-modal.tsx`** (973L) — the only production consumer: the 5-step flow, realtime pause (PERF-504), ER-PMAE review flow, sync-queue enqueue, skip-error surfacing.
- The prior-record documents re-read: the T-420 forensic baseline (`docs/recovery/t-420-import-integrity-baseline.md` — the issue-#20 saga: IMPORT-112/113/114/115/116/117/118/119 + PERF-504, all FIXED/TESTED/LIVE-VERIFIED), the S2 import audit, the S3 pipeline inventory, `docs/architecture/excel-format-comparison`, ADR-026/017, and the Excel deep-inspection report.

**Census artifacts:** `Deep Sweep/censuses/excel-import-engine-tree-census.txt` (re-runnable commands + counts + consumer/test call-site lists).

## 3. The heavy testing (two layers, 197 tests, ALL GREEN)

**Infra gate first:** GET-only probes → REST root/table/auth-health all 402 `exceed_egress_quota` → **OPS-011 now 6-run-stable**; the live-DB lane stays owner-gated (the one owner action: lift the spend cap). The heavy testing therefore ran the engine's REAL DB write path against instrumented stub repositories (the t-105 convention the T-420 forensics themselves used).

**Layer 1 — the repo's own import regression slice (20 files / 150 tests PASS):** mappers + config-registry + t-011/t-012/t-364/t-420×3/t-421/t-438/t-439×2 + the two real-workbook integration suites + empty-state-restore + t-105 + t-420-payment-state + sync-batch + t-417-perf + t-517-modal. (vitest installed from the lockfile — `npm ci`, 931 packages, node_modules gitignored, tree verified clean.)

**Layer 2 — the S8 purpose-built adversarial harness (47/47 PASS)** (`/home/z/my-project/scripts/s8-excel-import-heavy-harness.ts`, machine evidence `Deep Sweep/censuses/excel-import-heavy-harness-results.json`):

| Group | Coverage | Headline |
|---|---|---|
| A — REAL workbooks × full DB path | 12 tests | old: 390/253/1283/891/1966; new: **1137/741/3342/2198/5956**; **independent per-student balance oracle: 1137/1137 + 390/390, maxDelta 0 DZD**; **940/197 indebted census exact** (the issue-#20 signature absent); reports bytes; re-import NO-OP; dry-run zero writes; cross-run buffer hygiene |
| B — adversarial corpus | 24 tests | zero-sheet, header-only, unknown-name (3 detection paths incl. the tier-2 header rescue), garbage headers, missing-NOM, TOTAL/SOMME, #REF! optional/required, duplicate identities FIRST-WINS, shared-phone families, multi-value NEM, FR-locale `123 456,78`, negative DETTES, Arabic names, padded headers, number-as-text, formula-string cells never evaluated, 999M accepted, 5,000-row stress (8.7 s), corrupt bytes, HTML-as-.xls |
| C — failure modes + edges | 11 tests | ledger flush Err → honest `ÉTAT PARTIEL` with landed counts; payments flush throw; **preflight fail-closed (zero financial writes)**; single-row createStudent failure (rowIndex error, sibling imports); rollback delete failure → `PARTIAL_ROLLBACK_STATE`; **ATOMIC_IMPORT_ABORTED/STRICT_MODE_REJECTED unreachable (DEAD-013 confirmed)**; concurrency 1 vs 8 identical; invalid config registration rejected with 4 issues; tier-2 + dual-format detection |

**The delta chase (method note, worth keeping for future oracle work):** the first oracle run showed 9 imperfect joins out of 1,139. A per-field diagnostic (`s8-delta-fields.ts`) decomposed ALL nine: 4 were my oracle double-counting column O (engine verified correct field-by-field: KOUBAA −34000 = 286000−320000 exact; AITHAMOUDA 380000 = 300000+130000−50000 exact; GOUIGEH 397000 exact), 4 were the engine's documented multi-pronged family resolution (placeholder-first-wins / email prong — engine balances all verified equal to their rows' own arithmetic), and 1 was the IMPORT-109 name-variant collapse (the double-space "HEROUA  MOSADEK"/"HEROUA MOSADEK" pair merging into one student, first-wins — engine correct). Zero engine defects in the nine; one real data-quality gap surfaced instead (BUG-040).

## 4. Findings

- **BUG-040 (new, HIGH confidence):** placeholder-family merges drop parent contact enrichment — phone-bearing rows absorbed into earlier phoneless placeholder families keep the parent at `(inconnu)` forever; real-workbook rows 441/773/849 cited; fix shape given (T-556 proposal).
- **DEAD-013 empirically confirmed:** both abort modes unreachable; `strict` is a no-op flag; atomicity is enforced at the flush layer (T-420 family). Removal proposed (T-557).
- **Documented non-defects:** dry-run emits `run_completed` audit (cosmetic quirk); stub 5,956 vs live 5,963 installments (environment delta); tier-2 header rescue on unknown names (intended); no calc-injection surface (formula strings never evaluated).

## 5. Deliverables

`Deep Sweep/04-DEEP-EXCEL-IMPORT-ENGINE-AUDIT-2026-11-19.md` (the full audit: inventory → architecture → DB write path → configs side-by-side → heavy-test evidence → findings → live-DB lane → engine vs other ingestion paths → what does NOT need work → ordered backlog) + 2 evidence censuses + registers (FINDINGS_INDEX S8 addendum, SESSION_LOG row 8, README, 01-INFRASTRUCTURE-STATUS S8 run) + this report + `handoff-session-09.md`.

## 6. Git hygiene

Single write surface: `Investigation Archive/` only. Incremental commits on `investigation/session-08`, pushed with the owner PAT, merged to `main` after verification (no force-push). Token-hygiene grep performed before every push (standing documentation-text false positives only).
