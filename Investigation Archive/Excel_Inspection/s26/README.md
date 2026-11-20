# Excel_Inspection — Session 26 re-inspection (the NEW `Excel/متابعة تمدرس التلاميذ.xlsx`)

**Date:** 2026-11-21 (Session 26, the pre-coding readiness audit). **Mode:** read-only (G0 ACTIVE — Issue #32, 0 comments).

## 1. What was placed in the repository and what it is

The owner's `new excel` commit (`c08b6fd1`, 2026-11-20 22:34 +0100) added `Excel/متابعة تمدرس التلاميذ.xlsx` (195,516 bytes) at the repository root's `Excel/` folder (alongside the S23-era workbooks `Excel/2027-2026.xlsx` and `Excel/Suivis clients  2026_2027.xlsx`, and an unrelated tracked app artifact `.smartexport/selection-state.json` — outside this lane's scope).

**SHA-256 comparison (Task 4.1):**

| File | SHA-256 | Verdict |
|---|---|---|
| `Excel/متابعة تمدرس التلاميذ.xlsx` (NEW) | `15174e1b77e82e34e4878868d8a6d240fc7e93e6d5d827943b6e462e9bf69958` | — |
| `Investigation Archive/Excel_Inspection/source/متابعة تمدرس التلاميذ.xlsx` (Session 14 archived source) | `15174e1b77e82e34e4878868d8a6d240fc7e93e6d5d827943b6e462e9bf69958` | **BYTE-IDENTICAL** |

**The newly placed workbook is byte-identical to the Session 14 BLANK template.** It is the same blank pedagogy workbook that S14 inspected — not a filled roster copy.

## 2. The full programmatic re-inspection (Task 4.2 — double openpyxl load)

Re-executed per the mandate (openpyxl, loaded twice: `data_only=False` for formulas and `data_only=True` for cached values; every sheet, block, header, cell, data validation, defined name):

- **Sheet inventory (8, none hidden):** `جع مشترك` · `الرياضات` · `تقني رياضي` · `علوم تجريبية` · `تسيير واقتصاد` · `لغات اجنبية` · `Feuil7` · `Feuil8` — the same 8 sheets as S14.
- **Formula cells: 0 across all 8 sheets** (blank template — consistent with S14's empty formulas catalog).
- **Values dumps:** every `*_values.csv` regenerated under `s26/csv/` is **byte-identical** to the S14 dumps in `csv/` (8/8 sheets). The `*_formulas.csv` dumps differ only in format (the S14 files are full-sheet grid dumps of empty cells; the S26 files are two-column `cell,formula` catalogs) — **both contain zero formulas**, so there is no semantic difference. S14 provenance preserved: the S14 files are untouched.
- **Rosters/averaging rules:** none present — no student rosters, no marks, no averaging weights/rules exist in this workbook. The S14 structural findings (block layout, column model, per-sheet subject lists) stand unchanged.
- Artifacts: `s26/csv/` (8×2 dumps), `s26/structure/workbook-structure.json`, `s26/structure/formulas-catalog.tsv`, `s26/s26-inspection-verdict.json`.

## 3. Impact on the register (Task 4.4)

- **T-563 (workbook-driven subject catalog)** — UNCHANGED. The blank template's per-sheet subject lists are the S14 lists verbatim. The open questions remain UNRESOLVED (the file is identical, so it decides nothing new): `تكنولوجيا` ≡ `INFORMATIQUE` still to confirm with the school (non-blocking); `تا / ج` → تاريخ وجغرافيا (probable, flagged); `ت اسلا` → التربية الإسلامية (probable, flagged); `الوجبات` *(sic)* → `الواجبات` (one-letter typo, read as homework); the 4 missing subjects (`محاسبة` · `مناجمنت` · `القانون` · `الأسبانية`) still missing from the app's 14-subject catalog — T-566's scope.
- **T-566 (curriculum & assessment coverage, D-13)** — UNCHANGED; the workbook encodes no new marks/averaging rules (0 formulas).
- **T-567 (the pedagogy-workbook importer)** — UNCHANGED; the importer's source-of-truth record for THIS format stays the S14 model (blank roster grid, `الشعبة/القسم` block headers, `معدل` recomputed app-side).
- **BUG-064 / D-13** — no new data; the D-13 default (⏵ A: the composite recipe) stands as staged.
- **T-603..T-611 fixture paths (the mandate's ETAT check):** `ETAT 2024 -205.xlsx` is **NOT present in the repository** — it remains external-only, exactly as S23 recorded (only its CSV dumps + structure JSON are archived under `Excel_Inspection/s23/etat-2024-205-NEWFORMAT/`). The in-repo workbook set for fixtures is: `Excel/متابعة تمدرس التلاميذ.xlsx` (this blank template), `Excel/2027-2026.xlsx`, `Excel/Suivis clients  2026_2027.xlsx`, plus the archived S14/S23 evidence packages. Any fixture needing `ETAT 2024 -205.xlsx` bytes must continue to reference it as an EXTERNAL owner-supplied path, or be built from the archived `s23/etat-2024-205-NEWFORMAT/` dumps.

## 4. Verdict

The `new excel` commit changes nothing in the pedagogy/Excel lane's evidence base: it re-places the S14 blank template at `Excel/` (repo-root convenience copy), verified byte-identical, re-dumped and re-diffed programmatically. All S14/S23 inspection findings, open questions, and task scopes carry forward unchanged. Recorded so the executor never has to wonder what the "new" workbook contained.

*Session 26 — read-only on application source; only `Investigation Archive/` written; no key material; G0 ACTIVE.*
