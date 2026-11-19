# Deep Excel Import Engine Audit — Session 8 (2026-11-19)

**Owner mandate (verbatim):** "do the excel import and test it heavly on the excel import on the db sweep the whole codebase on the excel import engine imlaimtrntion audit fullly" — a full-depth sweep of the Excel import engine implementation across the whole codebase, with HEAVY testing of the import on the database path.
**Read-only regime maintained:** no application source, config, schema, or dependency was modified. Only `Investigation Archive/` was written. Scripts (harness, diagnostics) live OUTSIDE the repository at `/home/z/my-project/scripts/` (sandbox layer, uncommitted).
**Repo HEAD at session start:** `9ad9fef2` (main, clean tree).

---

## 1. Executive verdict

The Excel import engine is the codebase's **best-factored and best-battle-tested subsystem**, and this session's heavy testing (two independent layers: the repo's own 150-test regression slice + a purpose-built 47-test adversarial harness, **197 tests, all green**) confirms it end-to-end against the REAL workbooks:

- **1,137/1,137** students' ledger balances on the real `2027-2026.xlsx` equal the workbook's own per-row arithmetic (`L + N − M − O − Σpayment-columns`) — **maxDelta = 0 DZD** — under an INDEPENDENT oracle (this harness's own re-read of the workbook, not the engine's).
- **390/390** exact on the old `Suivis clients  2026_2027.xlsx`.
- The issue-#20 corruption signature is **absent**: 940 indebted / 197 settled (the live-verified T-420 census, reproduced exactly).
- Re-import is a financial **NO-OP**; dry-run writes **nothing**; a 5,000-row stress (2× the real workbook) imports in **8.7 s** with bounded concurrency.
- Every failure mode tested (ledger flush Err, payments flush throw, preflight read failure, single-row create failure, rollback delete failure) surfaces an **honest error with landed-count accounting** — the exact silent-loss defects of issue #20 (IMPORT-112/113/114/115) are regression-pinned and re-verified here.

Two genuine findings emerge (both small, neither blocks anything):

1. **BUG-040 (new)** — placeholder-family merges never backfill parent contact data (the phone/email carried by a later row of the same family is dropped).
2. **DEAD-013 now EMPIRICALLY confirmed** — `ATOMIC_IMPORT_ABORTED` and `STRICT_MODE_REJECTED` are unreachable code (the "import student no matter what" policy of Iteration 21 converts every validation error to a warning; `ctx.errors` can never gain entries from validation).

The live-DB lane remains **blocked by the Supabase spend cap (OPS-011, now 6-run-stable)** — heavy testing therefore ran through the engine's real DB write path (`RepositoryStorageAdapter`) against instrumented stub repositories (the repo's own t-105 test convention, the same method that produced the T-420 forensics), not against the quota-restricted live project. §8 gives the one owner action that would open the live lane.

---

## 2. Complete inventory — every file, symbol, and call site of the engine

Census file: `censuses/excel-import-engine-tree-census.txt` (re-runnable commands + counts). Total estate: **~8,500 lines** across 30 engine files + 2 config documents + 1 UI consumer.

### 2.1 The engine tree (`src/infrastructure/excel/import-engine/`, 29 files)

| File | Lines | Role |
|---|---:|---|
| `import-engine.ts` | 613 | The orchestrator: `importFile()` / `preview()` / event bus (`ImportEventMap`), sheet selection, per-sheet pipeline, transaction + rollback ceremony, report generation, audit emission |
| `storage/repository-adapter.ts` | **2,961** | **THE DB write path**: family batch resolution, parent/student upserts, financial entry/payment/installment builders, 3-level dedup, preflight, honest-error bulk flush, compensating rollback |
| `storage/storage-adapter.ts` | 186 | The `StorageAdapter` port (abstract transaction/upsert/audit contract) + `BatchUpsertRow` (PERF-503 seam) + `RollbackOutcome` (IMPORT-114 surface) |
| `storage/in-memory-adapter.ts` | 221 | Renderer-default in-memory adapter (checksum-skip idempotency) |
| `parsers/excel-parser.ts` | 304 | ExcelJS workbook open, dynamic header-row finding (top-30 scan, scoring), row iteration with positional `__col_<LETTER>` keys + header keys, formula/richText/error cell normalization |
| `parsers/sheet-detector.ts` | 35 | Two-tier detection delegate → `importConfigRegistry.detect()` |
| `validators/row-validator.ts` | 378 | Summary/non-data row detection (12 FR keywords), field resolution precedence (positional → header → alias → normalized → static table), Iteration-21 error→warning conversion |
| `validators/field-coercer.ts` | 234 | Ordered coercion pipeline: Excel-error → required → default → type dispatch → structural rules |
| `validators/rules/*` | ~260 | `positive-number` (FR separators, DA/€/$ symbols), `phone`/`phoneList`/`normalizePhone` (DZ formats, float-stored numbers), `enum`, `email`, `required`, `min-length` |
| `schemas/etat-schema.ts` + `bon`/`devis`/`ref`/`index` | 191 | Schema shims — all DERIVED from the central `ImportConfigRegistry` (T-414/ADR-026) |
| `mappers/niveau-mapper.ts` | 148 | `NIVEAU_MAP` (broad codes) + `CLASSE_CODE_MAP` (exact CALC-001 per-grade resolution) + AUTISTE track detection |
| `mappers/name-splitter.ts` | 66 | LASTNAME-FIRSTNAME split (Latin + Arabic) |
| `mappers/destination-mapper.ts` | 34 | DISTINATION town → canonical transport destination (delegates to the domain `TOWN_ALIASES`) |
| `dedupe/upsert-matcher.ts` | 83 | Identity extraction (header→key translation, array/date normalization) |
| `er-matcher.ts` | 264 | The T-438 ER-PMAE seam: source-qualified observation ids, `ConfirmedEntityMatcher` (human-confirmed bindings only), run-scoped binding builder, import-time analysis orchestrator |
| `reporters/json-reporter.ts` + `excel-reporter.ts` | 203 | In-memory report bytes (JSON = full context; Excel = human review) — never auto-downloaded |
| `utils/checksum.ts` / `id.ts` / `logger.ts` | 145 | File/record checksums, run ids, structured logger |
| `types.ts` / `import-context.ts` / `errors.ts` / `index.ts` | 484 | Engine types (FieldSpec/ImportSchema/ImportOptions), per-run state (stats/warnings/sheet results), typed error hierarchy (12 codes), public exports |

### 2.2 The configuration layer (`src/infrastructure/excel/import-config/`)

| File | Lines | Role |
|---|---:|---|
| `config-registry.ts` | 308 | The CENTRAL registry: `register` (structural validation), `get`/`list`, `identify` (tier-1 name shortlist), `detect` (tier-2 header-signature disambiguation), `resolve`/`resolveAll` (compile → runtime schemas, detectionPriority-ordered), `setEnabled`, `selectConfig` |
| `configs/etat-2026-2027.ts` | 167 | The OLD workbook format document (40-col ETAT; NOM-headed identity; ORTH/E-PLANT/Ratrapage; quarterly SEPTEMBRE/DECEMBRE/MARS) |
| `configs/etat-2027-2026.ts` | 185 | The NEW format document (headerless F, V2→V1 relabel, PSY1–14 grid, CREANCE SEPT ×3 + TT CREANCE informational, COURS SUP/LIVRES/CLUB/SORTIES; statistiques excluded with reason) |
| `types.ts` / `extensions.ts` / `index.ts` | 363 | `ImportConfigDocument` types (concept/role mandatory per field), the T-414 `EntityMatcher`/`CanonicalEntityRef` extension seam, registry singleton |

### 2.3 The UI consumer (the only feature-level consumer)

| File | Lines | Role |
|---|---:|---|
| `src/features/crm/excel-import-modal.tsx` | 973 | The 5-step flow (select → dry-run preview → review → atomic commit → reports+download). Wires `RepositoryStorageAdapter` to the live repositories + audit sink; pauses financial-realtime around the commit (PERF-504 fix); T-438 ER-PMAE review flow behind an experimental flag; mock-mode sync-queue enqueue; skip-error surfacing from `getErrorsForRun` |

### 2.4 Call-site map (verified by census re-run)

- **Engine construction sites:** exactly ONE production consumer (`excel-import-modal.tsx:194`) + the modal's `getEngine()` memo; everything else is tests (24 files, §6).
- **`importConfigRegistry` consumers:** `schemas/index.ts`, `schemas/etat-schema.ts`, `parsers/sheet-detector.ts` (all read-only derivations) + tests. The registry is the single source of truth for both formats (ADR-026 honored — no parallel hand-rolled schema survives).
- **Domain dependencies of the DB path:** `domain/calc/ledger/entries` (charge/payment/adjustment factories), `domain/calc/payment/waterfall-allocator` (installment attribution), `domain/calc/pricing/school-price-matrix` (REAL tuition/transport/FI schedules), `domain/calc/pricing` `getOfficialTuitionDueDates` (T-435 canonical due dates), `domain/calc/pricing/transport` `TOWN_ALIASES` — one shared pricing truth, no import-local price tables (verified: zero price constants duplicated in the adapter).
- **The other ingestion paths** (NOT this engine; see §9): batch-registration, re-enrollment, mock autofill, backup-restore, sync replay.

---

## 3. Architecture — the verified pipeline (what actually runs, stage by stage)

```
File bytes (Uint8Array)
  └─ ExcelParser.open ── ExcelJS load; normalizeCell: formula→cached result, richText→join,
      no-cached-result formula→null, {error}→#REF! string
  └─ selectSheets ── options.schemas ▸ options.sheets ▸ default: detect(name)!==null
  └─ per sheet: SheetDetector.detect(name, actualHeaderRow)   ← T-414 FORMAT disambiguation
      tier-1 name regex shortlist → tier-2 ALL-requiredHeaders match (most specific wins)
      → ties: detectionPriority → registration order
  └─ findHeaderRow ── dynamic scan of top 30 rows; required×10 + field-match scoring;
      explicit headerRow wins ties; dataStartRow from config when the explicit row matched
  └─ iterateRows ── every cell under BOTH `__col_<LETTER>` (positional) and its header key;
      empty rows counted, skipped
  └─ RowValidator.validate ── isSummaryOrNonDataRow (12 FR keywords + per-schema key-field
      presence) → skip; else per-field FieldCoercer.coerce → record + warnings
      ⚠ Iteration 21: ALL errors converted to warnings — a data row is NEVER rejected
  └─ UpsertMatcher.extractIdentity (NEM + NOM; empty parts skipped)
  └─ dryRun? count-as-imported : buffer BatchUpsertRow[]
  └─ RepositoryStorageAdapter.upsertRecordsBatch (PERF-503):
      Phase 0  TWO snapshot reads (parents.search("") + students.search(""))
      Phase 1  sequential family grouping (BatchParentIndex: phone→email→placeholder-name
               →legacy-Tuteur stages) + T-438 ER bindings pre-resolution
      Phase 2  bounded-concurrency pool (default 8) over INDEPENDENT families;
               per family, in row order: ensureParent → findExistingStudent
               (IMPORT-109 exact: parentId+displayName, then parentId+first/last)
               → createStudentTracked/updateStudent → build+buffer financial rows
               (ledger entries / payment rows / installment rows) → track entities
  └─ commitTransaction → flushPendingBatches:
      preflight (3 parallel DB key reads — FAIL-CLOSED on read failure)
      → cross-run dedup vs DB keys (∪ in-process cache for ledger)
      → WITHIN-BATCH dedup FIRST-WINS (IMPORT-115)
      → ledger.bulkAppendWithProgress / payments.bulkCollectWithProgress /
        installments.bulkImportInstallmentsWithProgress — every Result HONORED
        (IMPORT-116/117); honest per-chunk landed counts (IMPORT-118)
      → ANY failure ⇒ throw with the ÉTAT PARTIEL sentence
  └─ rollbackTransaction (compensating, best-effort, students-then-parents,
      IMPORT-119: only rows the run actually created) + PARTIAL_ROLLBACK_STATE surfacing
  └─ reports (JSON + Excel bytes, in-memory) + saveAuditRun + import.run_completed audit
```

**The dual-format config layer** (ADR-026): both workbooks' sheets are named `ETAT 20262027`; the registry disambiguates by header signature — the old format requires the `NOM` header, the new format requires `V1/LIVRES/CLUB/SORTIES` (the new grid). Field mappings carry `column` letters for the headerless/ambiguous columns (F, CREANCE SEPT ×3) — positional addressing takes precedence over header matching. Config documents are structurally validated at registration (key/header/column/concept/role/identity resolvability) — C9 proves invalid docs are rejected with precise issue paths.

---

## 4. The DB write path — verified behavior detail (repository-adapter.ts)

1. **Family resolution (`BatchParentIndex.resolveFamilyFor`)** — the multi-pronged strategy in order: exact phone → exact email → placeholder-name stages (`(inconnu)`-phone parents matched by first/last, then displayName, then the legacy "Tuteur" format). Phone-bearing rows CAN be absorbed into earlier phoneless placeholder families (first-wins); the reverse (a phoneless row after a phone-bearing family of the same name) creates a second family — the workbook's ~741 parents for 1,137 students shows the practical outcome is sound, but see **BUG-040** (§7).
2. **Financial identity, three dedup levels** (all re-verified live here): cross-run preflight vs the DB (`listImportLedgerSourceKeys` ∪ the observe() cache; payments by deterministic `IMP-{studentId}-{field}` receipt; installments by the YEAR-SCOPED 0129 identity with `resolveImportAcademicYearId`), within-batch FIRST-WINS (IMPORT-115), and the DB-level unique indexes (`ledger_entries_source_uidx` etc.).
3. **The financial mapping itself** (per ETAT row): DEVIS ANNUEL → charge(tuition); DETTES → charge(tuition); REMISE → deliberately NO entry (already netted in L — the T-105/DATA-010 fix, verified by the oracle: balances match L exactly); REMBOURSEMENT → negative adjustment; every payment column → payment entries (tuition/transport/therapy_psychology/therapy_speech/books/extracurricular/other); CREANCE SEPT ×3 + TT CREANCE deliberately informational (INV-1: balances recomputed by ledger replay, never copied).
4. **Payments rows** mirror payment-type fields with `expectedAmount` from the CALC-001 matrix (overpayment → `excessAmount`/`excessRemark`), and T-502 recorded-period `collectedAt` anchors (Sept 15 / Dec 15 / Mar 15 of the canonical academic year — one derivation shared with installment due dates; no-payment-period fields keep the run timestamp).
5. **Installment rows**: the official Registration + 3-Tranche model (FI at T0 due at signup; V1/2V/v3 due Sept/Dec/Mar; transport 3 tranches per-town) built UNPAID, then the T-105 reconciliation aligns Σdue to the ledger target (last tranche absorbs +Δ; −Δ cascades tuition-only, newest first), then the T-424 canonical waterfall pools ALL payment streams and allocates oldest-due-first through the SAME `allocatePaymentToInstallments` the live RPC uses. The tranche number is parsed from the deterministic id (`-T(\d)$`), never from free-text labels.
6. **Failure semantics** (all pinned by C1–C5): preflight failure ⇒ fail-closed before ANY financial write; any flush failure ⇒ the import FAILS with the exact landed-count sentence (`ÉTAT PARTIEL — X écritures, Y paiements, Z tranches… immuables…`); compensating rollback deletes only rows the run created (IMPORT-119 tracked creates) and its failures surface `PARTIAL_ROLLBACK_STATE` with counts.

---

## 5. The dual-format configs — the two documents side by side

| Dimension | etat-2026-2027 (old) | etat-2027-2026 (new) |
|---|---|---|
| Sheet identity | `ETAT 20262027`, header `NOM` present | same NAME, headerless F; requiredHeaders `V1, LIVRES, CLUB, SORTIES` |
| Student name | header `NOM` (col F, header+positional) | **positional-only** `column: "F"` |
| 1st installment | header `V2` | header relabeled `V1` → same canonical key `v2` |
| Therapy grid | PSY1/PSY2 + ORTH1/ORTH2 + E-PLANT + Ratrapage | PSY1…PSY14 (all therapy_psychology); ORTH/E-PLANT/Ratrapage gone |
| Quarterly | SEPTEMBRE/DECEMBRE/MARS + CREANCES ×1 each | replaced by CREANCE SEPT ×3 + TT CREANCE — all informational |
| Ancillary | — | COURS SUP / LIVRES / CLUB / SORTIES (structured payments) |
| Excluded sheets | BON/Devis/REF as separate schemas | `statistiques` excluded with documented reason (1,871 #REF!) |
| Canonical target | identical — same repositories, ledger, payments journal, installment schedule, record keys | identical |

**Canonical equivalence is regression-pinned by the repo's own integration test** (`real-excel-import-2027-2026.test.ts`: the same student in the OLD and NEW layouts imports to identical canonical records) and re-verified here (C11 detection + A1/A2 both formats through the identical write path).

---

## 6. Heavy-test evidence — the two layers (all green)

### Layer 1 — the repo's own regression suites (re-run this session, 20 files / 150 tests PASS)

`npx vitest run` over the import slice: `excel-import-mappers`, `import-config-registry` (7), `t-011-payment-atomicity`, `t-012-bulkcollect-failfast`, `t-364-import-flush-idempotency`, `t-420-honest-bulk-errors`, `t-420-partial-rollback-surfacing`, `t-420-realtime-pause-seam`, `t-421-reimport-idempotency`, `t-438-er-gate-and-seam`, `t-439-er-binding-scope`, `t-439-import-year-identity`, `real-excel-import` + `real-excel-import-2027-2026` (16, incl. the real-workbook full pipeline + idempotent re-import), `empty-state-excel-restore` (13), `t-105-import-shape`, `t-420-payment-state-regression` (11), `sync-batch`, `t-417-excel-import-perf` (6: census + call-count budget + wall-clock + no-op + atomicity + bounded concurrency), `t-517-modal-financial-consistency`.

### Layer 2 — the S8 purpose-built heavy harness (47/47 PASS)

Harness: `/home/z/my-project/scripts/s8-excel-import-heavy-harness.ts` (outside the repo; drives the REAL `ImportEngine` + `RepositoryStorageAdapter` + real domain calc modules). Machine evidence: `censuses/excel-import-heavy-harness-results.json`.

| Group | Tests | Headline results |
|---|---|---|
| **A — real workbooks through the full DB path** | A1/A1b/A2/A2b/A2c/A2d/A3/A4/A5/A6/A7/A8 (12) | old: 390 students exactly; new: **1137 / 3342 / 2198** exactly (installments 5956 vs live 5963 — see §7.4); **per-student balance oracle: 1137/1137 + 390/390, maxDelta=0**; **940 indebted / 197 settled** exact; reports bytes generated; re-import NO-OP; dry-run zero writes; buffers cleared across runs |
| **B — adversarial corpus** | B1–B22 (24 incl. b/c variants) | zero-sheet workbook, header-only, unknown-name (default `no_sheets` / explicit `unknown_schema` / **tier-2 header-signature rescue** — a matching-header sheet with an unknown name still imports), garbage headers, missing-NOM skip, TOTAL/SOMME skip, #REF! optional→warning+0, #REF!-as-NOM→non-data, duplicate rows FIRST-WINS (1 student, first row's amounts only), shared-phone family (1 parent 2 students), multi-value NEM (first part), FR-locale `123 456,78`→123456.78, negative DETTES not ledgered, Arabic names split correctly, padded/odd headers matched normalized, number-as-text parsed, formula-like text NEVER evaluated (no calc-injection), 999,999,999 accepted, 5,000-row stress (8.7 s, 5,000 students, 10,000 ledger entries), corrupt bytes → parser error + zero writes, HTML-as-.xls → parser error |
| **C — failure-mode matrix** | C1–C11 (11) | ledger flush Err → honest `ÉTAT PARTIEL` sentence with landed counts; payments flush throw → same; preflight read failure → **fail-closed, zero financial writes**; single-row createStudent failure → row skipped with rowIndex error, sibling imports; rollback delete failure → `PARTIAL_ROLLBACK_STATE` warning with counts; **ATOMIC_IMPORT_ABORTED unreachable (DEAD-013 confirmed)**; strict:true with garbage → import succeeds (**STRICT_MODE_REJECTED unreachable**); concurrency 1 vs 8 → byte-identical aggregates; invalid config registration → 4 structural issues, not registered; tier-2 detection; dual-format disambiguation |

---

## 7. Findings registered this session

### 7.1 BUG-040 (NEW) — placeholder-family merge drops parent contact enrichment

**Evidence (live workbook, rows cited):** `2027-2026.xlsx` rows 441 (ZEMMOURI ABDERHMAN, NEM=`665586466`→`0665586466`), 773 (REZGAN SAMYI, `0771502887`), 849 (OUALI RAZAN, `0560003627`) all join EARLIER placeholder families created by phoneless rows of the same family name — the created parent keeps `phone: "(inconnu)"` and **the phone carried by the later row is never backfilled** (no `updateParent` with contact enrichment exists in the adapter). Row 990 (GOURI MANE, phone `0552714626`, email `P LES LIVERES`) joins an earlier phone-bearing family via the email prong — the second phone is likewise dropped.
**Consequence:** contact search / parent outreach surfaces `(inconnu)` for these families; the data IS recoverable (raw record retained in `rowsByRun` + import report) but never lands on the parent entity.
**Severity/confidence:** LOW–MEDIUM / HIGH (deterministically reproduced on the real workbook; ≤ single-digit row counts affected in practice — 741 parents for 1,137 students still matches the T-420 census).
**Recommendation (execution-ready):** in `processEtatFamily`, when a phone-bearing row resolves to a placeholder family (`family.resolvedParent.phone === "(inconnu)" && input.phone !== "(inconnu)"`), call `updateParent(parent.id, { phone: input.phone, email: input.email ?? existing.email })` before the student upsert; pin with a B-test (placeholder-first + phone-later → parent phone backfilled; phone-first + phoneless-later unchanged). Fold into the next execution session's T-queue (candidate T-556).

### 7.2 DEAD-013 — EMPIRICALLY CONFIRMED (unreachable abort modes)

C6/C7 (harness): worst-case invalid rows — bad enum, NaN numeric, invalid email, `#REF!` in a number field — ALL convert to warnings (Iteration-21 "import student no matter what"); `ctx.errors` stays EMPTY; `strict: true` imports successfully. **`ATOMIC_IMPORT_ABORTED` (import-engine.ts:214) and `STRICT_MODE_REJECTED` (import-engine.ts:317) are unreachable from validation.** The VAULT §14.02 atomic contract is instead enforced at the FLUSH layer (honest failure + compensating rollback), which the T-420 family of fixes made real. The `strict` option is effectively a no-op flag; its doc comment ("post-commit") describes the dead path. Disposition unchanged from the S2 registration: owner decides restore-fail-closed vs remove the enum values (ROADMAP 4.8); this session adds the empirical confirmation and recommends REMOVAL of the dead branches + the `strict` option, with the audit-log vocabulary documented.

### 7.3 Dry-run audit quirk (observation, no ID)

A7: the dry-run preview emits BOTH `import.run_started` AND `import.run_completed` audit actions (the T-420 live log shows the same: RUN 1 dry-run 3,833 ms "run_completed audit ✓"). A preview is logged as a completed run — mildly misleading in the audit trail (a `run_completed` with `options.dryRun: true` is distinguishable, so severity is cosmetic). Not registered as an ID; recorded here + in the harness evidence.

### 7.4 Stub-vs-live installment count note (non-defect)

The harness's deterministic stub path lands **5,956** installments vs the documented live-DB **5,963** (T-420 live verification). The 7-row delta comes from the live environment's pre-existing rows and the live per-dueDate academic-year resolver (the stub resolves one fixed year for every due date), not from any engine divergence — students/ledger/payments counts match the live numbers EXACTLY (1137/3342/2198). Recorded so future sessions comparing counts do not misread it.

### 7.5 Behaviors verified-as-designed (documented for the record)

- **Tier-2 header rescue (B3c):** a sheet with an unknown NAME but a full ETAT header set still imports under explicit selection — the signature fallback is intended (legacy engine behavior preserved).
- **Formula-string cells are never evaluated** (B17) — the parser only ever reads CACHED results; a text cell containing `=25000+330000-J10` coerces to warning+0. No calc-injection surface exists in the import path.
- **`parseNumber` currency stripping** (`[DA€$]` letters removed after space/comma handling) — accepts `25 000 DA`; a naked `DA` string coerces to empty→null.
- **`normalizePhone` float handling:** numeric cells like `799534750` (Excel float) are prefixed to `0799534750` — verified end-to-end (the real workbook stores many phones as numbers).

---

## 8. The live-DB lane (OPS-011 — 6-run-stable)

GET-only probes re-run at session start (protocol unchanged; keys in-memory only, masked here):

```
P1  GET /rest/v1/ (publishable)             → 401 Secret API key required   (key-type gate)
P2  GET /rest/v1/ (secret)                  → 402 exceed_egress_quota
P3  GET /rest/v1/students?select=id&limit=1 → 402 exceed_egress_quota
P4  GET /auth/v1/health (secret)            → 402 exceed_egress_quota
```

The project has been quota-restricted on every probe run since Session 2 (S2→S8; now **6-run-stable**). The live import-flush lane (a real workbook against the real Supabase tables — the T-420 Phase-6 ceremony) therefore REMAINS owner-gated: **lift the spend cap (or upgrade the plan) in the Supabase dashboard**, then re-run this harness's Group A with the Supabase repository layer — the engine's contract is already proven identical on the stub path, so the only untested dimension is the wire itself (the exact thing the local-first migration is designed to escape; OPS-011 → LOCAL-FIRST-BLUEPRINT INV-2/INV-5).

---

## 9. The engine vs the OTHER ingestion paths (position in the codebase)

Per the S2 import audit (verified, unchanged this session): five data-ingestion families exist — (1) THIS Excel bulk-import engine; (2) batch registration (`register_family_batch` RPC, shares the devis computation); (3) re-enrollment; (4) mock autofill (Ctrl+O, production-mounted — ARCH-010); (5) backup-restore + offline sync replay. The engine is the ONLY schema-driven, config-registered, idempotent, atomic, audit-trailed ingestion path. The S2 verdict stands and is now deep-verified: **the redundancy is NOT in the engine** — it is in (a) the four billing-computation engines (DUP-001, C-1 Phase 1) and (b) the 973-line single-file modal (decompose when next touched). No new import-engine duplication was found: zero competing Excel-parse implementations, zero parallel schema tables, zero price constants (all shared domain modules — verified §2.4).

---

## 10. What does NOT need work (do not re-litigate without new evidence)

1. The engine's core pipeline, both format configs, the 3-level dedup, the honest-error flush, the compensating rollback, the ER seam, and the perf profile (PERF-503 bounded concurrency + PERF-504 realtime pause) — all heavy-verified green.
2. The T-420 family of fixes (IMPORT-112/113/114/115/116/117/118/119 + PERF-504) — regression-pinned AND independently re-verified by this session's harness.
3. The 5-step modal's flow contracts (dry-run preview, atomic commit, report bytes, skip-error surfacing).

## 11. Hardening backlog (small, ordered, owner-gated)

1. **T-556 (proposed):** BUG-040 contact backfill on placeholder-family merge (§7.1 — exact fix shape given).
2. **T-557 (proposed):** remove the dead `ATOMIC_IMPORT_ABORTED`/`STRICT_MODE_REJECTED` branches + the no-op `strict` option (DEAD-013 confirmation §7.2); alternatively restore fail-closed validation behind a config flag if the owner wants row-level rejection semantics (owner decision D-13 candidate).
3. **T-558 (proposed, cosmetic):** suppress `import.run_completed` for dry-runs (§7.3) or tag it `dry_run: true`.
4. Live-DB re-verification ceremony when the cap lifts (§8): re-run harness Group A against the Supabase repositories; expect 5963 installments (§7.4).

**Session protocol satisfied:** read-only maintained; scripts outside the repo; only `Investigation Archive/` written; registers updated (FINDINGS_INDEX +BUG-040; SESSION_LOG row 8; README; 01-INFRASTRUCTURE-STATUS S8 run; session-08 report; handoff-session-09).
