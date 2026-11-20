# Excel Inspection — S23 (the unified-engine audit's workbook evidence)

**Session 23 (2026-11-20) · companion analysis: `Investigation Archive/Deep Sweep/13-UNIFIED-EXCEL-ENGINE-ENTITY-AUDIT-2026-11-20.md`.**
**Charter: read-only on the app; this folder + Deep Sweep/13 are the only S23 writes.**

## 1. Provenance

| Item | Value |
|---|---|
| New source | `/home/z/my-project/upload/ETAT 2024 -205.xlsx` (owner-supplied upload, S23) — 2,175,591 bytes, SHA-256 `e5e3ba32bff63f48156efe6396a4b090a2ca07b6df00e20c19cac1fbcab4c2cc` |
| Re-inspected | `repo/Excel/2027-2026.xlsx` (`b293b22bef41aa3d…`), `repo/Excel/Suivis clients  2026_2027.xlsx`, `upload/متابعة تمدرس التلاميذ.xlsx` (`15174e1b77e82e34…` — byte-identical to the S14 archive copy; structure re-verified, no re-dump) |
| Tools | openpyxl 3.1.5 (twice-loaded: `data_only=False` formulas + `data_only=True` cached) for the census; the REAL TypeScript engine (ExcelJS parser + ImportEngine + RepositoryStorageAdapter) against instrumented stub repositories for the harness |
| Scripts | `/home/z/my-project/scripts/excel_inspect_s23.py` (census/CSV dump) + `s23-unified-excel-harness.ts` + `s23b-per-sheet-diagnostics.ts` + `s23c-parse-benchmarks.ts` (tsx runner at `scripts/s23runner/`) — all OUTSIDE the repo, per the S7/S13/S14 convention |

## 2. This folder's artifacts

| Artifact | Content |
|---|---|
| `workbook-structure.json` | All 4 workbooks × every sheet: state (visible/hidden), dims, merged ranges, freeze panes, protection, cell-type counts, formula counts, error-cell catalog (truncated at 400) |
| `format-comparison-matrix.json` | **The mandated Format Comparison Matrix** — the 9 formats side by side (identity encoding / Tranche 2 / Tranche 3 / FI / extra fees / owed / paid / remaining / support status today) |
| `etat-2024-205-NEWFORMAT/` | The NEW workbook's full dumps: `*_values.csv` + `*_formulas.csv` for all 21 sheets (incl. the hidden-state census) |
| `2027-2026/`, `suivis-clients-2026-2027/` | The two registered financial workbooks' dumps (re-verification of the S8-era structure) |
| `pedagogie-verify/` | structure-only verification of the S14 pedagogy workbook (SHA-identical) |
| `harness-results.json` | The 100%-row stress harness: detection matrix (all sheets × the exact `processSheet` logic) + RUN A/B/C/D/E/F/G (baseline, old workbook, the 21-sheet archive drop, CLIENT CRITIQ alone, idempotency, failure injection, 5× scale) with per-row oracle outcomes and call counts |
| `harness-per-sheet.json` | Per-sheet isolation runs (EGV alone / 20262025 alone / 20232024 alone / 20262027 alone) + the EGV ground truth + the CLIENT CRITIQ family/roster census with marker counts |
| `parse-benchmarks.json` | Stage-level wall-clock + memory (workbook load / iterate+validate) on both financial workbook sizes |

## 3. The verdicts the artifacts carry (full detail in Deep Sweep/13)

1. **`ETAT 2024 -205.xlsx` is a 21-sheet historical archive, not one format** — the school's whole book: the new family-level `CLIENT CRITIQ` debtor state, FOUR more ETAT year-sheet variants, the `Etat General Versement` payments ledger, the legacy BON/Devis/REF sheets, and 13 auxiliary sheets.
2. A default file-drop imports 7 sheets / 5,021 rows and corrupts the money (BUG-066/067/068): 188 current-year students end with wrong balances; EGV alone fabricates ≈ +281.6 M DZD charges / −68.3 M DZD refunds and silently drops ≈ 155 M DZD of real tuition payments; the 3rd variant's LIVRES data lands as psychology payments.
3. **`CLIENT CRITIQ` is completely unsupported today** (unknown_schema) — 23 families / 48 children / 31,584,600 DZD of critical-debtor state.
4. The two REGISTERED formats stay oracle-exact (1,135/1,139 + 389/390 rows; residual = duplicate-name oracle artifacts + one workbook self-inconsistency); re-import is a perfect no-op; the injected mid-flush failure surfaces the honest partial-state sentence and the compensating rollback deletes every run-created row.

## 4. Quirks catalogued (the future adapters' input)

- Freeze pane A2 on the 3rd-variant ETAT (row 1 = header row, verified).
- Header rows at 4 / 3 / 4 / 7 on the historical year-sheets (the dynamic top-30 scan rescues detection; the registry's fixed `headerRow: 1` does not).
- `v1/V2/V3` vs `V2/2V/v3` vs `V1/2V/v3` relabelings across years; `REMIS`/`DEVIS ANNUE`/`Neveu` misspellings (positional addressing saves them).
- `' ETAT 20242025'` — leading space in the SHEET NAME (tier-1 `^ETAT` misses it).
- EGV: two `NUM TEL` columns (D + E) + BON01..BON10 receipt columns + `1V/2V/3V` tranches.
- 7 date-formatted cells with out-of-range serials (AN/AO/AQ/AR ≈ rows 1201–1257) — read as numbers, informational only.
- CLIENT CRITIQ: the roster panel's 122 named slots with payment-plan markers (ECHE-family ×12, MOIS, 3V, CAS, A VOIR, APRE AID, DETERGENT, A V); the TOT row (31,584,600 DZD) = Σ Montant.
- Zero hidden sheets anywhere; defined names CLIENT/NIVEAU/parent/TUTEUR on all three financial workbooks.
