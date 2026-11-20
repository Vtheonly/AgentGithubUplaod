# Deep Sweep 13 — The Unified Excel Engine, Entity Resolution & Performance Audit (Session 23)

**Date:** 2026-11-20 · **Session:** 23 · **Repo HEAD at start:** `f9368e19` (main, clean tree; the sandbox re-cloned from GitHub at session start — OPS-011 protocol reused).
**Owner mandate (verbatim core):** "I want **ALL Excel spreadsheet processing engines unified**, and I want **ALL supported Excel formats to resolve through ONE unified underlying entity-resolution and financial-semantic model**… **Performance is a top priority** … **THIS IS AN AUDIT-ONLY TASK.**"
**New input this session:** `ETAT 2024 -205.xlsx` (owner upload — the distinct new financial format).
**Charter:** strictly read-only on the application; scripts outside the repo (`/home/z/my-project/scripts/s23*`); outputs strictly inside `Investigation Archive/` (this file + `Excel_Inspection/s23/`).

---

## §1 Executive verdict

1. **The S8 baseline stands for the two registered formats.** Re-verified at HEAD with a fresh 100%-row harness (RUN A/B): `2027-2026.xlsx` imports **1,137 students / 741 parents / 3,342 ledger / 2,198 payments / 5,956 installments** with the independent per-row balance oracle at **1,135/1,139 rows exact** (the 4 residual deltas are 2 duplicate-displayName families + 1 workbook self-inconsistency — see §6.1); `Suivis clients 2026_2027.xlsx` imports **390 students, 389/390 oracle-exact**; re-import is a **perfect NO-OP** (0 delta on every stream — RUN E); the injected mid-flush failure surfaces the honest `ÉTAT PARTIEL` sentence and the compensating rollback deletes **all 1,137 created students + 741 parents, 0 failures** (RUN F).
2. **The new workbook breaks that safety record — it is not one new format, it is an archive of EIGHT ingestion-relevant formats.** `ETAT 2024 -205.xlsx` is a 21-sheet historical archive (2,175,591 bytes) containing: a family-level critical-debtor state (`CLIENT CRITIQ` — the genuinely NEW format), **four more per-student ETAT year-sheets** (`ETAT 20232024`, `ETAT 20262025`, `' ETAT 20242025'` (leading space), `ETAT 20262027` in a THIRD header variant), the historical payments ledger (`Etat General Versement`), the legacy document sheets (`BON `, `Devis`, `REF`), and 13 auxiliary/report sheets.
3. **Dropping that one file into the current app imports 7 sheets / 5,021 rows and corrupts the money.** Empirically measured (RUN C): 4,993 students, 2,561 parents, **33,344 ledger entries, 27,627 payments, 24,232 installments** land in one run; **188 of 1,312 current-year students end with WRONG balances** (cross-sheet multi-year ledger pollution); the `Etat General Versement` sheet is imported under the WRONG config with a full column shift (payments become charges, the remaining balance becomes refunds, real tuition payments vanish into informational columns) — **~281.6 M DZD of fabricated charges, ~68.3 M DZD of fabricated refunds, ~155 M DZD of real payments silently dropped, −132.1 M DZD of quarterly tuition recorded as speech-therapy** (per-sheet isolation RUN, §6.4).
4. **`CLIENT CRITIQ` — the format the owner explicitly wants kept — is completely unsupported** (no schema → `unknown_schema` skip; 23 families / 48 children / **31,584,600 DZD** of critical-debtor state cannot enter the app; RUN D).
5. **Entity resolution is three parallel implementations with different semantics** (BatchParentIndex exact-match stages; UpsertMatcher identity extraction; the ER-PMAE engine gated OFF behind `EXPERIMENTAL_ER_PMAE_KEY` and only consulted through human-confirmed bindings) — the unification target is real and the ER-PMAE engine is the right core to graduate, not a fourth engine.
6. **Performance is parse-dominated on the stub path and protocol-dominated on the live path.** Measured: ExcelJS full-workbook load 0.56 s (558 KB file) → 1.49 s (2.1 MB archive, all 21 sheets resident, +95 MB heap); iterate+validate ≈ 1.9 ms/row; 5× synthetic scale (6,589 rows) imports in 12.8 s end-to-end on stubs with linear scaling but **+197 MB heap** (the ExcelJS DOM is the memory ceiling). The live-path costs are the documented ones (3 sequential bulk RPCs — already optimal — plus the per-sheet full-table `search("")` snapshots, the DS/09 unbounded-SELECT family). The optimization blueprint (§7) is prioritized with accuracy proofs.

**No application source, SQL, config, or dependency was modified.** `git status` at close shows only `Investigation Archive/` writes (§9). The engine tree was read end-to-end personally (the full 2,961-line `repository-adapter.ts`, the parser/validator/coercer chain, the config registry + both config documents, the ER seam, the `domain/identity` engine); every load-bearing number below was produced by code against the real files, never guessed.

---

## §2 The complete format inventory (programmatically verified)

Workbook census (openpyxl 3.1.5, twice-loaded `data_only=False/True`; SHA-256 pinned; artifacts in `Excel_Inspection/s23/`):

| Workbook | SHA-256 (16) | Sheets | Ingestion-relevant sheets |
|---|---|---|---|
| `upload/ETAT 2024 -205.xlsx` | `e5e3ba32bff63f48…` | **21** (0 hidden) | CLIENT CRITIQ; ETAT 20262027 (3rd variant); ETAT 20232024; ETAT 20262025; ' ETAT 20242025'; Etat General Versement; BON ; Devis; REF |
| `repo/Excel/2027-2026.xlsx` | `b293b22bef41aa3d…` | 2 | ETAT 20262027 (the registered "new" format) — statistiques excluded |
| `repo/Excel/Suivis clients  2026_2027.xlsx` | (S8 forensic pair) | 4 | ETAT 20262027 (the registered "old" format); BON ; Devis; REF |
| `upload/متابعة تمدرس التلاميذ.xlsx` | `15174e1b77e82e34…` (byte-identical to the S14 archive) | 8 | the pedagogy roster template (S14-audited; blank) |

### 2.1 The eight ingestion formats (the matrix the unified engine must cover)

| # | Format (sheet) | Granularity | Identity encoding | Tranche-1 | Tranche-2 | Tranche-3 | Owed | Paid | Remaining | Status today |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | ETAT 20262027 @ Suivis clients (old) | student | NEM phone(s) D + NOM F | FI R + V2 S | 2V T | v3 U | DEVIS ANNUEL L + DETTES N | Σ payment cols (O,R,S,T,U,W,X,Y + therapy/ancillary) | Q = L−P (formula) | **supported, oracle-exact** |
| 2 | ETAT 20262027 @ 2027-2026 (new) | student | NEM D + headerless F | FI R + V1 S | 2V T | v3 U | same L+N−M | same + PSY1..14 + COURS SUP/LIVRES/CLUB/SORTIES | Q = L−P | **supported, oracle-exact** |
| 3 | ETAT 20262027 @ ETAT 2024 -205 (**3rd variant**) | student | NEM D + headerless F | FI R + V1 S | 2V T | v3 U | same | same + **LIVRES/CLUB/SORTIE/COURS SOUTIEN embedded at AB–AE** + PSY7..14 | Q = L−P | **mis-imports** (BUG-068, §6.3) |
| 4 | ETAT 20232024 | student | NEM D + headerless F (header row 4) | FI R + V2 S | 2V T | v3 U | L+N−M | + ORTH/E-PLANT/Ratrapage + SEPTEMBRE/DECEMBRE/MARS | Q = L−P | tier-1 default → old config (positional luck) |
| 5 | ETAT 20262025 | student | NEM D + headerless F (header row 3) | FI R + v1 S | V2 T | V3 U | L+N−M | + ORTH/E-PLANT/Ratrapage + SEPTEMBRE/`december`/MARS | Q = L−P | tier-1 default → old config (positional luck) |
| 6 | ' ETAT 20242025' (leading space) | student | NEM D + headerless F (header row 4) | FI R + v1 S | V2 T | v3 U | L+N−M | + ORTH/E-PLANT/Ratrapage + quarterly | Q = L−P | **silently skipped** (tier-1 `^ETAT` fails on the space) |
| 7 | **Etat General Versement** (EGV) | student | NUM TEL D + E + headerless F (header row 7) | FI O + 1V P | 2V Q | 3V R | DEVIS ANNUEL H + DETTES K − REMBOURSEMENT J | MONTANT VERSE L + DETTES VERSE N (+1V/2V/3V, 1T/2T/3T, P1/P2, O1/O2, Ratrapage, E-PLANT, quarterly) | RESTE VERSE M | **catastrophically mis-imported** (BUG-067, §6.4) |
| 8 | **CLIENT CRITIQ** (the new format) | **family** | Num A (phone) + address B + CLIENT C (family name) + N ENFANT D (child count) + roster panel (R/T/V/X/Z student lists + S/U/W/Y markers, 122 roster slots) | — | — | — | **Montant E (31,584,600 DZD / 23 families)** + "+20000" title adjustment | — (a debtor state) | Montant itself; Garanti F (CHEQ) + Obs G | **unsupported — unknown_schema** (RUN D) |

Sheet-level quirks verified: freeze panes A2 on the 3rd-variant ETAT (row 1 = header); 1,312 data rows (F non-empty) in it; `ETAT 20232024` header at row 4 with a stray `@` pair in row 1; `ETAT 20262025` header at row 3 with `v1/V2/V3` relabeling; EGV header at row 7 with **two NUM TEL columns (D and E)** and BON01..BON10 receipt columns; 7 cells marked date-formatted with out-of-range serials (AN/AO/AQ/AR 1201–1257 — read as numbers, informational only); zero hidden sheets; defined names `CLIENT/NIVEAU/parent/TUTEUR` on all three financial workbooks.

### 2.2 The auxiliary sheets (must be safely ignorable — and are)

`Feuille 25` (609×3 student/class/town transport roster), `LOT GRATUIT 2025` (free-lot list), `caisse02` (cash register: club + trips, Arabic headers), `Feuille 4` (revenue comparison 2023-vs-2022 + price grids), `Tableau croisé dynamique 1` (pivot over DEVIS/CA/remises/dettes), `club dété 2024` (summer club: Arabic headers عدد التلاميد/الاسم و اللقب/تاريخ الدخول/المبلغ…), `APPELLS` (call list), `Feuille 2` (the statistiques-equivalent dashboard — same `#REF!`-family content), `PAR PARENT` (12×6 per-parent summary — the BON VLOOKUP target, present here), `Feuille 7` (competitor price comparison), `datt` (date/amount pairs). None tier-1-match any registered schema and none pass tier-2 → correctly not selected (detection matrix, §6.2). `BON `/`Devis`/`REF` DO import — as **no-op tracked rows** (§4.3).

---

## §3 The code census — every Excel processing & entity-resolution path

Re-verified at HEAD (the S8 census §2 stands; deltas and the entity-resolution layers re-read in full this session):

### 3.1 The import engine (`src/infrastructure/excel/import-engine/`, ~8.5k lines)

`import-engine.ts` (614) orchestrator: `selectSheets` — **default = every sheet whose NAME tier-1-matches** (`detect(ws.name) !== null`, no header context, :368); per sheet `processSheet` re-detects with the actual header row **but falls back to the name match** (`detect(sheetName, headerRow) ?? nameMatch`, :387) — the load-bearing line behind §6's mis-detections. `excel-parser.ts` (305): ExcelJS load; `normalizeCell` (formula→cached result, no-cached→null, richText→join, error→string); **every cell emitted twice** (positional `__col_<L>` + header key — last-wins on duplicate headers); `findHeaderRow` dynamic top-30 scan with required×10+field scoring. `sheet-detector.ts` (35) delegates to `importConfigRegistry.detect`. `row-validator.ts` (379): 12 FR summary keywords + per-schema key-field presence (the `nom` lookup itself resolves the schema's positional mapping); Iteration-21 error→warning conversion (no row ever rejected). `field-coercer.ts` (235) ordered pipeline; `rules/positive-number.ts` `parseNumber` (FR separators; **`[DA€$]` stripped ANYWHERE — "NOMBRE 18" → NaN; `1.500` → 1.5 the French-thousands hazard — zero live instances in the four workbooks: all numeric cells are stored as numbers**); `rules/phone.ts` (DZ normalization, float-stored phones, multi-value split). Schemas (`bon/devis/etat/ref`) all derived from the registry (ADR-026 honored). `repository-adapter.ts` (2,962) — the DB write path, §4. `er-matcher.ts` (264): the ER-PMAE seam (source-qualified observation ids, `ConfirmedEntityMatcher` = human-confirmed bindings only, `buildCurrentRunBindings` run-scoped, `runErImportAnalysis` orchestrator). `mappers/`: niveau-mapper (CALC-001 `resolveGradeFromClasse`), name-splitter, destination-mapper (TOWN_ALIASES). `upsert-matcher.ts` (83): identity extraction (header→key translation; empty identity parts skipped; all-empty → reject).

### 3.2 The config layer (`import-config/`)

`config-registry.ts` (308): register/get/resolve/detect. **The detection contract's failure mode (empirically pinned this session, §6.2):** tier-1 name shortlist (case-insensitive `^ETAT` — matches `Etat General Versement`); single candidate returned WITHOUT header validation; multi-candidate → tier-2 full-signature match; **when no candidate full-matches → `candidates[0]`** (resolveAll order = detectionPriority asc → the OLD config, priority 100) — and `processSheet`'s `?? nameMatch` guarantees every `^ETAT`-named sheet is imported under SOME etat config regardless of header. Two documents registered: `etat-2026-2027` (old: NOM/V2/ORTH/E-PLANT/Ratrapage + quarterly) and `etat-2027-2026` (new: headerless F, V1, PSY1–14, CREANCE SEPT ×3 positional, COURS SUP/LIVRES/CLUB/SORTIES). Both declare `column:` for every field — positional precedence — which is why the historical year-sheets (formats 4/5) import semi-correctly by column-position luck (A–Y positions identical across the family).

### 3.3 The entity-resolution layers (the fragmentation the mandate targets)

1. **`BatchParentIndex`** (repository-adapter.ts:2787–2912) — the production resolver: exact phone → exact email → placeholder-name stages (firstName+lastName under `(inconnu)`, then displayName, then the legacy "Tuteur" format). Snapshot-seeded (`parents.search("")` + `students.search("")` — the per-sheet full-table reads). BUG-040 (S8) stands: placeholder-family merges never backfill contact data.
2. **`UpsertMatcher.extractIdentity`** — schema-declared identity keys (NEM+nom) → the tracked-row identity blob (audit/report only; not a resolver).
3. **`domain/identity/**` (1,887 lines) — the ER-PMAE engine**: `analyze()` = normalize → block (candidate pools) → veto → score → band (definite/probable/review) → proposal; pure (no I/O); idempotent (INV-55 hash-skip); **proposes, never merges** (INV-50). Gated OFF behind `EXPERIMENTAL_ER_PMAE_KEY` (`excel-import-modal.tsx`); at commit time only `ConfirmedEntityMatcher` (approved bindings, run-scoped, source-qualified ids — T-438/T-439) is consulted, PRE-legacy-resolution (Phase 1a, adapter :787–810).
4. The student identity is family-scoped EXACT match (`findStudentInFamily`, adapter :1098 — parentId+displayName, then parentId+first/last — IMPORT-109).

**Verdict:** three layers, three vocabularies, one gated-off. The unification (§5) is a consolidation onto ONE pipeline, not a new engine — the ER-PMAE core is already deterministic, conflict-safe (veto + band + human-confirm), and backfill-capable (the missing backfill is BUG-040's fix, already queued as T-556).

### 3.4 The other ingestion families (unchanged from S2/S8; position confirmed)

batch-registration (`register_family_batch` RPC + `compute-billing.ts` — the devis computation), re-enrollment, mock autofill (ARCH-010), backup-restore, offline sync replay. None parse Excel. The export estate (`data-export.ts` 322, `export-engine.ts` 180, `full-export.ts` 675, `reports.ts` 257) is write-side and out of the import-unification scope (the unified READ model in §5 does not touch them).

### 3.5 The modal consumer (`excel-import-modal.tsx`, 972)

The ONLY engine construction site; calls `importFile(bytes, name, { dryRun: true })` for preview and `{}` for commit — **no `sheets`/`schemas` options → the default all-matching-sheets selection** (§6.2's exposure is the production path, not a hypothetical). ER-PMAE review flow renders only under the experimental flag; the sync-queue enqueue from `listInsertedForRun`; financial-realtime paused around commit (PERF-504).

---

## §4 The DB write path — where ETAT is hardcoded vs everything else dropped

`RepositoryStorageAdapter.upsertRecordsBatch` (:692–708): **`schema.name !== "etat"` → `upsertTrackedRecord` → track in-memory only, `{action:"insert"}`** — BON/Devis/REF rows are recorded in `rowsByRun` (audit/report) and **persist nothing** (no entities, no ledger, no payments; `insertRecord` for REF's `extractAs` fan-out is equally a no-op :1196–1200). The entire financial semantic model — `buildFinancialEntries` (:1487: DEVIS ANNUEL→charge, DETTES→charge, REMISE deliberately no entry, REMBOURSEMENT→negative adjustment, every payment column→payment entry with stable `${studentId}:${field}` sourceIds), `buildPaymentRows` (:2204: CALC-001 expected amounts, T-502 period anchors, PSY3–14 + ancillary), `buildInstallmentRows` (:2393: the official Registration+3-tranche model built UNPAID → T-105 reconciliation → T-424 waterfall pooling), `realScheduleFor`, `academicPeriodAnchors` — **reads the ETAT field vocabulary directly off the generic record** (the "one record format = one financial model" coupling the mandate asks to break). The flush (PERF-503): 3 parallel preflight key reads (fail-closed) → 3-level dedup (DB keys ∪ in-process cache; within-batch first-wins; DB unique indexes) → 3 bulk calls with honest landed-count failure sentences (IMPORT-116/117/118 — re-verified live-by-stub in RUN F). Compensating rollback deletes only run-created rows (IMPORT-119 — RUN F: 1,137/741 deleted, 0 failures).

---

## §5 The unified design — ONE engine, ONE entity-resolution model (implementation-ready)

**Design name:** the **Canonical Import Pipeline (X-lane)**. Directory target: `src/infrastructure/excel/import-engine/` extended in place (the S8-proven shell is kept: event bus, dry-run, atomic commit, rollback, reports, audit — all reused verbatim).

### X-U1 — Format Adapter layer (per format; layout knowledge ONLY)

One `FormatAdapter` per format family, each owning: sheet matchers, header-row strategy (fixed/dynamic), column resolution (positional ∪ header ∪ aliases), quirks (FR numbers, date-serial garbage, multi-phone split, `#REF!` tolerance). The eight registered adapters (2.1's matrix) emit **one `CanonicalRow`**; nothing else. The registry's detect contract gains a **reject gate**: a sheet that tier-1-matches but fails BOTH tier-2 signatures AND the adapter's own header fingerprint → explicit `unknown_schema` warning + skip (replaces the `candidates[0]`/`?? nameMatch` auto-adopt — the root of BUG-066/067). Per-sheet **academic-year attribution** is part of the adapter (sheet-name year parsing `ETAT 2023\s*2024` → 2023-2024; explicit picker fallback) — the root fix for the multi-year pollution.

### X-U2 — The Canonical Normalized Import Record (the ONE semantic model)

```
CanonicalRow {
  sourceSheet, sourceRow, academicYear, sourceSystem,
  student:  { displayName, firstName?, lastName?, gradeLevel?, classCode?, transportTown? },
  guardian:  { phones[], emails[], displayName?, familyName, isPlaceholder },
  charges:  [{ category: tuition|transport|therapy|books|…, amount, basis: devis|priorDebt|garanti }],
  payments: [{ category, amount, tranche?: 0|1|2|3, period?: T1|T2|T3, rawField, receiptKey }],
  totals:   { owed, paid, remaining, tranche2Paid, tranche3Paid }   // carried for the oracle, never ledgered (INV-1)
}
```

Every adapter maps its columns into this shape; **the ETAT-family adapters share one `EtatColumnAdapter` core with per-year variant tables** (the 8 formats differ only in column addresses + tranche labels — 2.1's matrix is the variant table). The family-level `ClientCritiqAdapter` emits one CanonicalRow per FAMILY with its roster panel resolved through the entity resolver (X-U3) as student references (child-count cross-check: `N ENFANT` vs panel length → warning, never silent).

### X-U3 — ONE Unified Entity-Resolution Pipeline (the consolidation)

The `domain/identity` engine (normalize → block → veto → score → band) becomes the **only** resolver, fed by the CanonicalRow's guardian/student identity, run in three modes: (a) **auto-accept definite** (strong-id exact hits — today's phone/email exact stages remain the deterministic gate, byte-identical outcomes); (b) **propose** probable/review bands → the existing review surface (INV-50 unchanged); (c) **legacy fallback** = today's exact-match path for unproposed rows (INV-45 preserved). `BatchParentIndex`/`findStudentInFamily` become the engine's fast-path blocking layer (not a parallel semantics); BUG-040's backfill lands here (T-556). The pipeline is format-agnostic — CLIENT CRITIQ families resolve through the same bands as ETAT rows.

### X-U4 — ONE Unified Financial & DB Write Pipeline

The CanonicalRow's charges/payments/tranches feed the EXISTING builders — refactored from "read ETAT keys off a generic record" to "read the canonical record" (the field-by-field builders of §4 keep their verified semantics: REMISE-no-entry, T-105 reconciliation, T-424 waterfall, deterministic sourceIds `imp-…-{category}-T{n}` + `${studentId}:${field}`, receipt keys `IMP-{studentId}-{field}`, year-scoped installment identity 0129). Ledger/payment/installment streams stay 3 bulk RPCs with the 3-level dedup — **re-import idempotency is format-independent** (proved: RUN E held at zero delta; the identity keys are already canonical). Multi-year workbooks write tranches under the row's resolved academic year (T-439's year scoping already exists at the installment identity — extended to the ledger sourceId with a year component: `imp:{year}:{studentId}:{field}` — the BUG-066 root fix at the write layer).

### X-U5 — The CLIENT CRITIQ adapter (the new format's semantics)

`CLIENT CRITIQ` (family-level critical debtors): families = rows 5–27 (Num phone, address, CLIENT family name, N ENFANT, **Montant = the family's total outstanding** — the sheet IS a creance state; title "ETAT 2EME TRIMESTRE CREANCE + 20000" documents the school's +20,000 adjustment), Garanti (CHEQ = guarantee instrument), Obs. The roster panel (columns R/T/V/X/Z, 122 slots, markers `ECHE/ECHELENE/ECHEL/ECH/MOIS/3V/CAS/A VOIR/APRE AID/DETERGENT/A V`) resolves students by name → the entity resolver; unmatched panel names surface as review-band proposals (the school's roster is the student set at risk). Mapping: **owed = Montant (a charge snapshot at family granularity — imported as a family-level `priorDebt` charge when the students are known; otherwise as an unattributed family charge), paid = 0, remaining = Montant**; guarantee + markers land as notes/metadata. Idempotency: deterministic sourceId `critiq:{familyKey}:{montant}`.

### X-U6 — Sheet-selection UX contract

The modal's sheet step lists every sheet with its detected adapter + row count; default selection = **current-year ETAT-family sheets only** (the adapter's year attribution drives it); historical year-sheets and auxiliary sheets are listed as excluded-with-reason (the 13 auxiliary sheets get a stable "not a data source" vocabulary). This closes the 7-sheet default-import exposure (§6.2) at the UX layer as defense-in-depth behind X-U1's reject gate.

### X-U7 — Performance envelope (the §7 blueprint's receiver)

The canonical pipeline keeps: bounded-concurrency family pool (8), the 3-bulk-RPC flush, realtime pause; adds: schema-projection cell walk (read only addressed columns), per-sheet keyset preflights (no `search("")` snapshots), optional streaming reader for >5 MB workbooks, and the diff-skip re-import (checksum now actually computed — DEAD-024's fix folds in).

### X-U8 — Sequencing (execution lane, T-603..T-611 — §10 of EXECUTION-PLAN)

`T-603 reject-gate` → `T-604 year attribution` → `T-605 CanonicalRow + EtatColumnAdapter variant table` (all 7 student formats) → `T-606 unified ER pipeline consolidation` → `T-607 write-pipeline refactor onto CanonicalRow` → `T-608 ClientCritiqAdapter` → `T-609 EGV adapter (the payments-ledger format)` → `T-610 sheet-selection UX` → `T-611 perf envelope (projection walk + keyset preflights + diff-skip)`. Each task's acceptance gate = §8's oracle at 100% rows for every affected format.

---

## §6 Empirical findings (the local harness — 100% of rows, zero remote calls)

Harness: `/home/z/my-project/scripts/s23-unified-excel-harness.ts` + `s23b-per-sheet-diagnostics.ts` + `s23c-parse-benchmarks.ts` (tsx, outside the repo; the REAL `ImportEngine` + `RepositoryStorageAdapter` + real domain calc modules; instrumented stub repositories implementing the full optional-method surface — tracked creates, bulk+progress, listImport* key sets, year resolver — the S8 t-105 convention). Artifacts: `Excel_Inspection/s23/harness-results.json`, `harness-per-sheet.json`, `parse-benchmarks.json`.

### 6.1 The baseline holds (RUN A/B)

`2027-2026.xlsx`: 1,141 rows read → **1,137 imported + 2 updated + 2 skipped; 741 parents; 3,342 ledger; 2,198 payments; 5,956 installments; 3,550 ms wall** — byte-identical to the S8/live numbers. Oracle (independent ExcelJS re-read; owed = L+N−M; paid = Σ(O,R,S,T,U,W,X,Y,therapy,ancillary)): **1,135/1,139 exact**; the 4 residual: `BIDA MED`/`KHALEF RAYAN` (two families each sharing a student displayName — oracle matching artifact, both students' own balances exact by S8's per-student oracle) and `HEROUA  MOSADEK`/`HEROUA MOSADEK` (rows 770/771: the SAME student entered twice with disagreeing payments 33,000 vs 30,000 — the workbook's own inconsistency; the engine resolves first-wins deterministically to 232,000; row 771's self-arithmetic says 235,000). Old workbook: 390 students, **389/390** (the one residual = the same duplicate-name class). **Re-import (RUN E): 0 delta on students/parents/ledger/payments/installments — perfect NO-OP.**

### 6.2 The detection matrix — what one file-drop selects today

| Sheet (21) | tier-1 | final schema | imported? |
|---|---|---|---|
| CLIENT CRITIQ | — | **null** | **no — unknown_schema (the new format unsupported)** |
| ETAT 20262027 | etat | etat (tier-2 → etat-2027-2026) | **yes — mis-mapped (BUG-068)** |
| ETAT 20232024 | etat | etat (candidates[0] → OLD config) | yes (positional luck) |
| ETAT 20262025 | etat | etat (candidates[0] → OLD config) | yes (positional luck) |
| ' ETAT 20242025' | — | null | silently skipped |
| **Etat General Versement** | **etat** | **etat (candidates[0] → OLD config)** | **yes — catastrophic (BUG-067)** |
| BON / Devis / REF | bon/devis/ref | same | yes — no-op tracked rows |
| 13 auxiliary sheets | — | null | correctly skipped |

7 sheets / 5,707 rows read / 5,021 imported in **one** default drop (the modal passes no sheet options — production path), 19.1 s, **10,798 warnings**.

### 6.3 BUG-066 — multi-sheet year-archive imports corrupt balances (NEW, CRITICAL)

188 of 1,312 current-year students end with WRONG ledger balances (oracle pass 1,124): a student present in several `^ETAT`-named year-sheets (overlap census: **154** students also in ETAT 20232024, **491** in ETAT 20262025, **110** in EGV) is imported by EVERY sheet in one run; the ledger sourceIds are year-blind (`${studentId}:${field}`), so cross-year entries with DISJOINT field sets are **not deduped against each other** and accumulate on the same student. Cited: `ZIREG LEA` (row 2 — true balance 0 → ledger **−299,500**), `ZERGANI MAHDI` (row 7 — 0 → **−291,000**), `ZERGANI YAHIA` (row 9 — 0 → **−374,000**), `BENYOUCEF ANAIS` (row 22 — present in FOUR importable sheets). Root causes stacked: no sheet-level year attribution (X-U1) + no year component in ledger sourceIds (X-U4). Severity: CRITICAL under the new input class; nil for the two registered single-sheet workbooks.

### 6.4 BUG-067 — "Etat General Versement" mis-detected and catastrophically mis-imported (NEW, CRITICAL)

Tier-1 `^ETAT` (case-insensitive) matches the historical payments ledger; tier-2 fails both configs (its headers are 1V/2V/3V/P1/P2/O1/O2…); `candidates[0]` + `?? nameMatch` hand it the OLD etat config; the dynamic header-scan finds its row-7 header; then the **column shift** (EGV has 3 extra columns before the payment grid) maps: MONTANT VERSE (L, money PAID) → `devisAnnuel` charge; RESTE VERSE (M, REMAINING) → `remboursement` refund; DETTES VERSE (N) → `dettes` charge; FI (O) → `reglementsDettes`; 1V/2V (P/Q) → the INFORMATIONAL totalVersements/totalCreance (**~154,992,490 DZD of real tuition payments silently vanish**); 3V (R) → `fi`; DISTINATION (S) → `v2` (string→0); 1T (T) → `v2Alt`; 2T (U) → `v3`; 3T (V) → `distination` (a number as town); P1/P2/O1/O2 (W/X/Y/Z) → transport tranches T1/T2/T3 + `psy1`; Ratrapage (AA) → `psy2`; E-PLANT (AB) → `orth1`; SEPTEMBRE (AC) → `orth2`; CREANCES SEPTEMBRE (AD) → `eplant`; DECEMBRE (AE) → `ratrapage`… Isolation run (1,251 rows): **8,679 ledger entries + 6,851 payments + 5,007 installments of corrupted data; +281,601,040 DZD fabricated charges; −68,280,830 DZD fabricated refunds (the remaining balances "refunded"); −132,096,590 DZD quarterly tuition recorded as speech-therapy; −76,707,750 DZD as catch-up; −33,124,750 DZD informational creances recorded as E-PLANT payments.** The EGV ground truth: owed 349,017,080 / paid 302,131,790 / remaining 46,885,290 — the import's total signed ledger sum for its rows: **−227,392,380 DZD.**

### 6.5 BUG-068 — the third ETAT header variant mis-maps its ancillary grid (NEW, HIGH)

`ETAT 2024 -205.xlsx`'s ETAT 20262027 passes tier-2 (V1✓ LIVRES✓ CLUB✓ SORTIES✓ — present at AB/AC and AS..AU) and imports under `etat-2027-2026`, whose positional `psy3..psy6 → AB..AE` collide with this variant's **embedded LIVRES/CLUB/SORTIE/COURS SOUTIEN**: the 8 rows carrying LIVRES data in AB import as `psy3` therapy_psychology payments (**80,000 DZD under the wrong category** — isolation run: `PSY3 count=8 sum=−80,000`; `livres`=AS stays 0); SORTIE (AD) → psy5 and COURS SOUTIEN (AE) → psy6 carry no data today (0 rows) but are silently un-mappable; CLUB@AC → psy4. Balance-neutral, category-corrupting (books ≠ psychology) — plus the duplicate-header last-wins overwrite on the raw record's "LIVRES"/"CLUB" header keys.

### 6.6 ARCH-047 — the format registry covers 2 of 8 real formats; no reject gate (NEW, HIGH)

The two config documents describe formats #1/#2 only; the detection contract auto-adopts every `^ETAT`-named sheet (`candidates[0]` fallback + `?? nameMatch`) with no "this is NOT a known layout" outcome. The `' ETAT 20242025'` sheet (leading space) is silently skipped — the same class, opposite polarity (a real year state the school may want, invisible to the user). CLIENT CRITIQ (ARCH-048's capability gap) has no schema at all.

### 6.7 ARCH-048 — BON/Devis/REF "support" persists nothing (NEW, MEDIUM)

The three legacy schemas are registered, detected, imported as rows... and land **nowhere** (`upsertTrackedRecord` → in-memory tracking only; REF's `extractAs` fan-out no-op). The user-visible import report says "16 imported" for BON — but zero domain entities exist. Either give them canonical targets (receipt/quote documents — X-U2's record model carries the fields) or classify them as excluded document sheets; the current in-between is misleading.

### 6.8 Smaller verified items

- **DEAD-024 (NEW, LOW):** `InsertedRow.checksum` is never computed (always `""` — the "computed lazily" comment's async excuse; the diff-skip re-import optimization (§7) needs it real).
- **Run-scope note (not a defect):** the ETAT 20262027 informational CREANCE SEPT columns in the new archive carry 7 date-formatted cells with out-of-range serials (AN/AO/AQ/AR ~1201–1257) — read as numbers, informational only, no ledger impact; documented as the school's file-corruption class.
- **Coercion hazards re-verified, zero live instances:** `parseNumber`'s `[DA€$]` anywhere-strip and `1.500`→1.5 French-thousands parse have no data in any of the four workbooks (all amounts stored as numeric cells); the hazards stay on the hardening list for future text-heavy formats (CLIENT CRITIQ's Montant is numeric too).
- **Phone warning class:** 10,798 warnings in RUN C are dominated by EGV's mis-mapped string columns (enum/phone noise — e.g. "55021780", an 8-digit operator typo) — a symptom of BUG-067, not an independent defect.

---

## §7 Deep performance audit & optimization blueprint (prioritized, accuracy proofs)

### 7.1 Measured profile (stub path — the engine's own costs; live-path costs are the documented network family)

| Stage | 558 KB workbook | 2.1 MB archive (per ETAT sheet) | Notes |
|---|---|---|---|
| ExcelJS workbook load | 556 ms | 1,488 ms | whole-workbook DOM; +74–95 MB heap; the 21 sheets all resident |
| iterateRows + RowValidator | 2,060 ms (1,141 rows) | 2,469 ms (1,317 rows) | ≈1.9 ms/row; every cell emitted under 2 keys; per-field coercion churn |
| Full import (stub DB, 8-way pool) | 3,550 ms total | 19,138 ms (7 sheets / 5,707 rows) | families pool + 3 bulk flushes + reports off |
| 5× synthetic scale | — | 12,766 ms / 6,589 rows / 1 sheet | linear; **+197 MB heap, RSS 758 MB** — the ExcelJS DOM ceiling |
| Re-import (no-op) | 0 delta, ~5 s | — | full re-walk: no diff-skip |
| Failure injection | honest error; rollback 1,137 students + 741 parents, 0 failed | — | compensating path costed |

### 7.2 The bottleneck catalog + optimizations (each with its accuracy/atomicity proof)

1. **P1 — per-sheet full-table identity snapshots (`parents.search("")` + `students.search("")`, one pair per ETAT sheet — 4 pairs for the archive).** On Supabase this is the DS/09 unbounded-SELECT family (a full-tenant parent+student download per sheet). **Fix (X-U7): keyset preflight by the run's own identity blocks** — the run knows every phone/name it is about to import: `WHERE phone IN (…)` / `WHERE last_name || ' ' || first_name` IN chunks (≤500 keys per call, keyset-paginated). Accuracy proof: the current match is EXACT equality over the full list; a query restricted to the same values returns the same rows (superset only by duplicate keys, resolved by the same first-wins rule); Err-degrade semantics unchanged.
2. **P2 — the cell walk materializes every column twice** (`__col_` + header keys, 60 cols × rows; `normalizeCell` object-shape checks on each). **Fix: schema projection** — iterate only the schema's addressed columns (positional ∪ headers ∪ aliases), emit the single resolved key per field. Accuracy proof: the coercion reads exactly the resolved field sources (positional precedence is unchanged — resolution happens once per schema, not per cell); non-addressed columns today land only on the raw record's header keys, which only `isSummaryOrNonDataRow` scans (12-keyword scan over string values — preserved by projecting summary-scan columns A–G only). Expected: 3–5× on the walk (≈60% of the stub-path wall).
3. **P3 — ExcelJS full-DOM load.** The 2.1 MB archive → 95 MB heap, 1.5 s, and the 5× scale shows RSS 758 MB. **Fix (staged): (a) post-load sheet pruning** (drop non-selected worksheets immediately — the archive keeps only its ETAT-family sheets; measured DOM share of auxiliary sheets is the majority of cells) — zero-risk, memory-only; (b) optional streaming reader for >5 MB inputs (SAX-style row feed behind the same `IterateRowsOptions` contract — the parser interface already isolates it). Accuracy proof: (a) reads nothing the selection doesn't address; (b) the contract is the cached-value semantics — formula cells still read cached results, never re-evaluated.
4. **P4 — re-import walks and rewrites everything** (1,139 updateStudent calls + full re-validation; the DB-side dedup keeps it a financial no-op — RUN E). **Fix: diff-skip** — compute the canonical row checksum (DEAD-024's field, now real) and skip rows whose (sourceSystem, row, checksum) matches the prior run's persisted set; skipped rows emit `action:"skip"` with reason `unchanged`. Accuracy proof: identical checksum ⇒ byte-identical canonical record ⇒ the write would be an idempotent no-op by the existing 3-level dedup; the ledger/payments streams are untouched for skipped rows exactly as today's cross-run filter does for whole-file re-imports.
5. **P5 — per-family sequential create awaits** (in-family row order is semantically REQUIRED — parent-before-student, IMPORT-109 chains; cross-family is already 8-way). **Fix (live path only): the Stage B single-transactional batch upsert RPC family** (already mandated by the unified-pipeline design) folds createParent/createStudent into one `import_families_batch` RPC call per chunk of INDEPENDENT families — the intra-family order is preserved inside the RPC's loop. Accuracy proof: the RPC executes the same ordered sequence server-side; the compensating log is the RPC's returned created-id sets (IMPORT-119 semantics preserved).
6. **P6 — validation churn** (RuleIssue allocation + per-field regex passes; 7,229 warnings on the mis-mapped EGV alone). **Fix: fast-path null/empty checks before object allocation; precompiled per-schema coercion plan (type-dispatch table built once per schema instead of per-row switch).** Accuracy proof: pure refactor of the dispatch order — the pipeline's ordered semantics (error→default→dispatch→rules) unchanged; the warning/error CONTRACT unchanged (same rules, same messages).
7. **P7 — findHeaderRow re-reads the top-30 candidate header rows per sheet with full normalize per cell.** **Fix: memoize `readHeaderRow` per (sheet, row) during the scan.** Accuracy proof: pure caching of a deterministic read.

Not on the list (verified NOT bottlenecks): the 3-bulk-RPC flush (optimal — 1 call per stream), the bounded pool (8; measured no contention), the waterfall/reconciliation (in-memory per row, µs-scale), the reporters (disabled by default in the modal flow).

### 7.3 The 5× target (the mandate's "as fast as possible without compromising accuracy")

Post-P1+P2+P4 at 5× scale (6,589 rows): projected ≈ 12.8 s → **≈4–5 s stub-path** (walk 3–5× faster, diff-skip zeroes the second pass) with **RSS < 400 MB** after pruning; the live-path wins are P1+P5 (network round-trips collapse from ~7.5k sequential requests per archive to ≈ 15 keyset preflights + 3 bulk flushes + 1 batch-upsert-chunk family). Every gate in §8 must pass at 1× AND 5× before these are considered landed.

---

## §8 Local-first validation plan (the acceptance gate BEFORE any remote push)

**Scope:** every change on the X-lane (T-603..T-611) must pass this gate locally (zero remote calls — the stub-repository harness convention), in this exact order, before merge; the live DB remains owner-gated behind OPS-011 as always.

1. **G1 — 100%-row oracle, all formats:** for EACH of the eight formats (2.1's matrix): every row through the adapter+pipeline; per-row independent oracle (owed/paid/remaining/tranche2/tranche3 from the workbook's own cells — the S23 harness's oracle) at **0 DZD delta**; totals reported (`rows inspected / passed / failed / skipped / warnings / mismatches`) — no sampling, ever. The 2.1 matrix + `harness-results.json` are the fixture set (the four real workbooks, SHA-pinned in `Excel_Inspection/source/` + `Excel/`).
2. **G2 — entity resolution:** zero split families for known-same families (phone/email exact), zero false merges (the veto/negative-pair fixtures from `er-engine.test.ts`), BUG-040 backfill pinned (placeholder-first + phone-later → parent phone backfilled), CLIENT CRITIQ roster names resolve or propose — never silently drop.
3. **G3 — idempotency:** re-import of each format → 0 delta on students/parents/ledger/payments/installments (RUN E's shape, per format).
4. **G4 — failure injection:** preflight fail → fail-closed, zero financial writes; mid-flush fail → the honest `ÉTAT PARTIEL` sentence with landed counts; rollback → only run-created rows deleted, outcome surfaced (RUN F's shape).
5. **G5 — multi-year gate:** the 21-sheet archive drop → the current-year sheet imports; historical sheets import only under their own year identity; cross-year ledger sourceIds distinct; the §6.3 oracle for the current-year sheet passes at 100% (188→0 mismatches); EGV never imports as an etat roster.
6. **G6 — performance:** wall-clock ≤ 2× the §7.3 projection at 1× and 5× scale; peak RSS under the §7.3 ceiling; DB round-trips ≤ the §7.3 budget (counted by the instrumented stubs — the harness already counts every call).
7. **G7 — regression:** the repo's own import slice (the 20-file/150-test S8 set) green; the S8 oracle at 1,137/1,137 + 390/390 reproduced.
Only after G1–G7 pass locally does the implementation session request the live-lane ceremony (OPS-011 cap lift, then the T-420 Phase-6 re-verification pattern).

---

## §9 What does NOT need work (do not re-litigate without new evidence)

1. The engine shell (event bus, dry-run preview, atomic commit ceremony, compensating rollback, reports, audit trail) and the two REGISTERED formats' end-to-end behavior — re-proven exact this session (RUN A/B/E/F).
2. The T-420 family (IMPORT-112..119), PERF-503/504, the 3-level financial dedup, the T-424 waterfall + T-105 reconciliation semantics.
3. The ER-PMAE engine's purity/idempotency/INV-50 contracts (`er-engine.test.ts` parity) — the graduation (X-U3) is wiring, not repair.
4. The pedagogy workbook's import path (DS/10 P-U5 — the blank template; unchanged this session).
5. The export estate (read-side only; out of scope).

## §10 Hardening backlog (the X-lane's task queue — folded into EXECUTION-PLAN §13 / ROADMAP Phase 9 as T-603..T-611)

T-603 the detect-reject gate (BUG-066/067 root) · T-604 per-sheet academic-year attribution · T-605 the CanonicalRow + EtatColumnAdapter variant table (8 formats) · T-606 the unified ER pipeline consolidation · T-607 the write-pipeline refactor onto CanonicalRow (year-scoped ledger sourceIds) · T-608 the ClientCritiqAdapter · T-609 the EGV adapter (payments-ledger format, family of BON lookups) · T-610 the sheet-selection UX contract · T-611 the perf envelope (P1+P2+P4+P6+P7). Registered findings this session: **BUG-066, BUG-067, BUG-068, ARCH-047, ARCH-048, DEAD-024** (+ BUG-040's fix already queued T-556; the S8 queue T-555..T-560 unchanged).

---

## §11 Verification status of this sweep

Every load-bearing claim was produced by code against the real files and re-checked: the 21-sheet census (openpyxl, twice-loaded, SHA-pinned); the detection matrix (the exact `processSheet` sequence against the real registry); all counts (harness JSON artifacts, instrumented stubs, 100% of rows — the sampling prohibition honored); the mis-mapping quantifications (per-sheet isolation runs — EGV/20262025/20232024/20262027 individually); the parse benchmarks (3 runs); the baseline reproduction (RUN A/B byte-identical to S8/live: 1,137/741/3,342/2,198/5,956 + 390). Scripts live OUTSIDE the repo (`/home/z/my-project/scripts/s23*` + the tsx runner — nothing committed into application code); the only writes are `Investigation Archive/Excel_Inspection/s23/` + this file + the register/blueprint updates. `npm ci` installed gitignored `node_modules/` only (`git status` clean of tracked files throughout). No secrets, no remote calls beyond the standing GET-only probe set, no app source/config/SQL touched.
