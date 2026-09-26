# Excel format deep comparison — `Suivis clients  2026_2027.xlsx` (WB1) vs `2027-2026.xlsx` (WB2)

**Task:** T-414 (issue #14 Task 2) · **Written:** 2026-09-26 (99th session) · **Status:** the design input for the `etat-2027-2026` import configuration
**Sources:** the forensic workbooks at `Excel/` (never modified) + `Excel/excel_deep_inspection_report.md` + `Excel/full_descbrtion.md` + an independent header-row diff and cell-level scan (row counts, formula shapes, populated-column census) performed before this document.

This document is the DEEP ANALYSIS the issue mandates BEFORE any import configuration is designed: what stayed the same, what changed superficially, what is genuinely different, the complete column mapping, formula equivalence, and every relationship that must survive the import.

---

## 1. Workbook composition & sheet correspondence

| Sheet concept | WB1 (`Suivis clients  2026_2027.xlsx`) | WB2 (`2027-2026.xlsx`) | Relationship |
| :--- | :---: | :---: | :--- |
| Master operational roster | `ETAT 20262027` (1 289 data rows, 47 cols) | `ETAT 20262027` (1 288 non-empty rows, 1 139 named) | **Same sheet, same NAME, evolved format** — the core engine carried over |
| Family quotes | `Devis` (184 rows) | — | Removed (the desktop's registration wizard + devis surfaces own this now) |
| Receipt template | `BON ` (20 rows) | — | Removed (receipts are canonical, server-numbered — ADR-004) |
| Reference lists | `REF` (26 rows) | — | Removed (the DB catalogs own the vocabulary) |
| Analytical dashboard | — | `statistiques ` (1 871 #REF! formulas) | New — a REPORTING surface referencing a deleted sheet; **excluded from import** |

Both workbooks keep the same 4 defined names (`CLIENT, NIVEAU, parent, TUTEUR`) — internal metadata, no import impact.

## 2. The ETAT sheet — complete column mapping

### 2.1 Fundamentally identical (columns A–E, G–Y: position, header, semantics)

| Col | Header (both) | Canonical key | Notes |
| :---: | :--- | :--- | :--- |
| A | *(none)* | — unmapped | Payment-plan notes ("PAR MOIS", "P LES LIVRES") — free text, never structured |
| B | `INFOS` | `infos` | Administrative flags |
| C | `E-MAIL` | `email` | Actually stores document codes (`BON01`) / book-payment markers |
| D | `NEM` | `nem` | Parent phone(s), multi-value `06xxx/07xxx` — identity |
| E | `TUTEUR` | `tuteur` | `NV`/`nv` = nouveau (new student) |
| G | `niveau` | `niveau` | `PRIM`/`COLG`/`LYC`/`GS`/`MS`/`AUTISTE`… (same vocabulary) |
| H | `CLASSE` | `classe` | `CP`…`CM2`, `1AAM`…`4AAM`, `1AS`…`3AS` (same codes) |
| I | `OPTION` | `option` | Transport flags — WB2 adds `TRNSP 15JOUR` (tolerated unknown) |
| J | `REMISE` | `remise` | Family discount — **already netted into DEVIS ANNUEL** (never a separate ledger adjustment; the T-105/DATA-010 rule) |
| K | `JUSTIFICATION` | `justification` | Discount reason |
| L | `DEVIS ANNUEL` | `devisAnnuel` | Net annual quote (formula — see §3) |
| M | `REMBOURCEMENT` | `remboursement` | Refund |
| N | `DETTES` | `dettes` | Prior-year debt |
| O | `REGLEMENTS DETTES` | `reglementsDettes` | Payments toward prior debt |
| P | `TOTAL VERSEMENTS` | `totalVersements` | Formula — informational |
| Q | `TOTAL*CREANCE` | `totalCreance` | Formula — informational |
| R | `FI` | `fi` | Registration fee paid (WB2 leaves it empty on most rows — the year's structure collects it within V1; the P formula still includes R) |
| T | `2V` | `v2Alt` | 2nd tuition installment |
| U | `v3` | `v3` | 3rd tuition installment |
| V | `DISTINATION` | `distination` | Transport town (same communes; WB2 carries more distinct values — same concept) |
| W/X/Y | `1T`/`T2`/`t3` | `t1`/`t2`/`t3` | Transport tranches |

### 2.2 Equivalent under superficial variation

| Col | WB1 header | WB2 header | Canonical key | Underlying reality |
| :---: | :--- | :--- | :--- | :--- |
| **F** | `NOM` | *(empty)* | `nom` | **Same data, same position** — the 2027/2026 header row lost the NOM label. → POSITIONAL addressing (`column: "F"`); identity switches from the `NOM` header to the `nom` field KEY. |
| **S** | `V2` | `V1` | `v2` | **The same concept — the 1st tuition installment.** WB1's `V2` was a mislabeling; WB2 corrects it to `V1`. The canonical record key stays `v2` (the storage adapters' contract) — a RELABEL, not a semantic change. |

### 2.3 Removed in WB2 (present in WB1)

| Col | WB1 header | Canonical key | Disposition |
| :---: | :--- | :--- | :--- |
| AB/AC | `ORTH1`/`ORTH2` | `orth1`/`orth2` | Superseded by the expanded PSY grid (speech-therapy sessions fold into the session-payment model) |
| AD | `E-PLANT` | `eplant` | Superseded (no WB2 equivalent) |
| AE | `Ratrapage` | `ratrapage` | Superseded by `COURS SUP` (both are remedial-teaching payments → tuition family) |
| AF–AK | `SEPTEMBRE`/`CREANCES SEPTEMBRE`/`DECEMBRE`/`CREANCES DECEMBRE`/`MARS`/`CREANCES MARS` | `septembre`…`creanceMars` | Replaced by the CREANCE SEPT ×3 + TT CREANCE block (WB2 models the September quota as a FORMULA rather than three quarterly text columns) |
| AL/AM/AN | `TOTAL`/`COL_AM`/`#NAME?` | — | Dead/legacy columns — never imported |

### 2.4 Added in WB2

| Col | Header | Canonical key | Classification |
| :---: | :--- | :--- | :--- |
| AB–AM | `PSY3`…`PSY14` | `psy3`…`psy14` | **Payments** (therapy_psychology) — the therapy grid standardized to 14 session slots |
| AN | `CREANCE SEPT` | `creanceSept` | **Informational** — the September-quota formula `=S+J+N−expected [±transport]` (genuinely NEW calculation; see §3.3) |
| AO | `CREANCE SEPT` *(same header!)* | `creanceSept2` | **Informational** — lump-sum adjustments; POSITIONAL addressing (shared header) |
| AP | `CREANCE SEPT` *(same header!)* | `creanceSept3` | **Informational** — same |
| AQ | `TT CREANCE` | `ttCreance` | **Informational** — total creance (the ledger recomputes) |
| AR | `COURS SUP` | `coursSup` | **Payment** (tuition family — supplementary tutoring) |
| AS | `LIVRES` | `livres` | **Payment** (books) — promoted from free-text notes in WB1 (`P LES LIVRES` in columns A/C) to a structured column |
| AT | `CLUB` | `club` | **Payment** (extracurricular) |
| AU | `SORTIES` | `sorties` | **Payment** (extracurricular — school trips) |

**Populated-data census (WB2):** the new columns are STRUCTURAL placeholders in the current file — PSY3–14: 1 cell (a `"-"`), LIVRES/CLUB/SORTIES/COURS SUP: 0 cells, FI: 1 cell, CREANCE SEPT (AN): 1 270 formula cells, TT CREANCE: 1 cell. The E2E verification of these columns therefore runs on a SYNTHETIC workbook with populated values (`real-excel-import-2027-2026.test.ts`), while the REAL file exercises the shared core columns at full volume (1 139 named rows).

## 3. Formula & calculation equivalence

### 3.1 Identical calculations (both workbooks, byte-identical templates)

- **Total payments (P):** `=R{row}+S{row}+T{row}+U{row}+W{row}+X{row}+Y{row}` — 403 rows in WB1, 1 285 in WB2.
- **Remaining balance (Q):** `=L{row}-P{row}` — same counts.
- Both formulas consume the SAME columns in the SAME positions — the canonical import record's `totalVersements`/`totalCreance` remain informational cross-checks.

### 3.2 Same logic, parameterized values (DEVIS ANNUEL, L)

Both workbooks build L as `=[FI] + [scolarité] + [transport] − J{row}` with the constants varying by grade/zone/**year**:

| Family | WB1 templates | WB2 templates |
| :--- | :--- | :--- |
| Primaire + transport standard | `=25000+185000+35000-J` | (prices carried per the year's grid) |
| Primaire + far transport | `=25000+205000+35000-J`, `=25000+205000+35000+55000-J` | `=265000-J`, `=345000-J`, `=300000-J`… |
| Collège/Lycée no transport | `=25000+330000-J`, `=300000-J`, `=355000-J` | `=245000-J`, `=345000-J` |

**Conclusion:** the calculation is the same; the CONSTANTS are the year's prices — exactly the per-academic-year price-configuration concern of T-414 Task 1 (the 2027-2026 prices belong to that year's config, NOT to a new formula). The importer reads the CACHED RESULT of L — year-specific prices flow through as data.

### 3.3 Genuinely new calculation (CREANCE SEPT, AN — WB2 only)

`AN = S + J + N − expectedSeptemberTuition [ + W − expectedSeptemberTransport]` with thresholds observed at 98 000 / 106 000 / 112 000 / 114 000 / 120 000 / 132 000 / 138 000 / 142 000 (+ 20 000 / 30 000 transport variants). A value of 0 = first installment fully covered; negative = the exact underpayment. **This calculation did not exist in WB1** (its closest ancestors were the static CREANCES SEPTEMBRE/DECEMBRE/MARS text columns) and it is **informational for the import**: the canonical ledger recomputes balances by replay (INV-1) — copying the workbook's own arrears math would create a second financial system, which the mandate forbids.

### 3.4 Harmless anomalies (tolerated, not "differences")

- 16 `#REF!` errors in WB1 (the BON sheet's lookups into deleted sheets) and 1 871 in WB2 (statistiques referencing the deleted `Etat General Versement`) — **root cause: both workbooks were copied from older workbooks whose companion sheets were removed**; none of the errors sit in the ETAT data path.
- Inline scratchpad arithmetic inside V1/V2 cells (`=122000-25000`, `=40400+40400+40400`) — manual splits, not systematic templates; the cached results read as data.
- WB1 header col AN renders as `#NAME?` — a broken legacy header, never mapped.

## 4. Relationships that must survive the import (all preserved)

1. **Parent ↔ student:** `NEM` (parent phone) + `nom` (student, column F in both) → the upsert identity; students without NEM fall back to the tuteur/placeholder parent (unchanged rule).
2. **Student ↔ academic placement:** `niveau` + `CLASSE` (+ `DISTINATION` for transport tier) — same vocabulary, same mappers (`niveau-mapper`, `destination-mapper`).
3. **Family financial aggregate:** the per-student rows aggregate under one parent by phone — the adapter's existing behavior; WB2's first 404 rows are the same students in the same order as WB1 (the continuation), so a cross-format re-import MUST upsert, not duplicate (pinned by the idempotency + equivalence tests).
4. **Payments ↔ ledger ↔ installments:** every payment column (FI/V1/2V/v3/1T/T2/t3/PSY1–14/COURS SUP/LIVRES/CLUB/SORTIES) → a `payment` ledger entry + a `payments` row + the tranche schedule — through the SAME RepositoryStorageAdapter → repositories → sync-queue (`upsert_*_from_import`) path as WB1. **No second financial system.**
5. **Charges ↔ the annual quote:** `DEVIS ANNUEL` (L) → the tuition charge; `DETTES` (N) → prior-year debt charge; `REMBOURCEMENT` (M) → negative adjustment. `REMISE` (J) stays NON-ledgered (the DATA-010 double-discount rule — L is already net of it in BOTH workbooks).
6. **Informational ↔ recomputed:** `TOTAL VERSEMENTS`, `TOTAL*CREANCE`, `CREANCE SEPT` ×3, `TT CREANCE` are captured on the record for the audit trail but NEVER ledgered — balances replay from stored entries.

## 5. The resulting architecture (what the comparison justified)

```
WB1 (2026-2027) ──► config etat-2026-2027 ─┐
                                            ├─► ImportConfigRegistry ─► Generic Import Engine
WB2 (2027-2026) ──► config etat-2027-2026 ─┘         (detect by header        │
                                                       signature; positional   ▼
                                                       addressing for F/AN-AO-AP)  Canonical Import Record
                                                                                 (identical keys for both formats)
                                                                                       │
                                                                                       ▼
                                                          RepositoryStorageAdapter → EXISTING business logic
                                                          (parents/students/ledger/payments/installments
                                                           + the sync queue's canonical RPCs)
```

The two configurations differ ONLY in their source addressing (headers/columns/aliases/required-headers signature); the canonical record keys — the storage adapters' contract — are IDENTICAL, which is what makes the formats interchangeable without a second importer or a second financial system.

**Config detection:** both formats match the sheet NAME `ETAT 20262027`; the header row disambiguates — WB1's `NOM` signature selects `etat-2026-2027`, WB2's `V1`+`LIVRES`+`CLUB`+`SORTIES` signature selects `etat-2027-2026`.

**Excluded:** `statistiques ` (a #REF!-broken reporting surface — §15.53: analytics consumes the canonical engines, never a parallel data path).
