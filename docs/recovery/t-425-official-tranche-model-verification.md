# T-425 — The Official 3-Tranche Model: Verification Record (109th session, 2026-09-27)

> **Mode:** the owner confirmed the official billing structure directly ("THERE IS NO 4TH TRANCHE — Registration (FI) + Tranche 1 (V1) + Tranche 2 (2V) + Tranche 3 (v3); Max Tuition Installments: 3; Max Transport Installments: 3; the `4ème TRANCHE` label existed only in cell A19 of the old workbook's `BON ` receipt sheet — an unmaintained template, erroneously labeled, DELETED from the updated `2027-2026.xlsx`"). This task corrected the app to that model and re-anchored the live DB to it. Every probe below is re-runnable read-only evidence.

## The defect (DATA-044, registered 55590e6 before the fix — §13)

Migration 0090 (CALC-001, 55th session) canonized the deleted BON receipt template's four labels as the billing model: the registration fee as tranche 1 ("INSCRIPTION"), the real 1st versement (V1) as "2EME TRANCHE" due Dec 15 (one term late), 2V as "3ème TRANCHE", and v3 as the phantom "4ème TRANCHE" due Jun 15. The live census before the fix (`scripts/t-425-no-4th-tranche-probe.mjs`): tuition T1 = "INSCRIPTION (FI)" n=1,137; tuition T4 n=1,137 Σdue 96,918,500 due 2027-06-15; tuition T2 (the real V1) due 2026-12-15. Every tuition wave's label AND timing was off by one term, and the Finance strip rendered a "Tranche 4 (Juin)" card that does not exist in the school's billing model.

## The fix (four commits, each pushed to main individually)

| Commit | Phase | What |
|---|---|---|
| `55590e6` | Registration | DATA-044 + T-425 registered BEFORE the fix (§13) + the live probe; the DATA-041/042/043 statuses synced to their landed T-424 phases |
| `d3f0361` | A — the model + the import | FI → a NON-WAVE fee row at tranche 0 (identity `(tenant,parent,student,tuition,0)` protected by the 0032 partial unique index; due at signup Sept 15; label "Frais d'inscription (FI)"); tuition = EXACTLY 3 tranches labeled `Tranche 1/2/3 — Scolarité (V1/2V/v3)` on the canonical `getOfficialTuitionDueDates` schedule (Sept 15 / Dec 15 / Mar 15); the wave derivation collapses to 1..3 (0/NULL/legacy-4 = non-wave rows on EVERY surface); the Finance strip's wave-4 card deleted; the T-105 negative-delta cascade scoped to TUITION rows (the official schedule reordering would have floored 14 fixed per-town transport rows — the census anchors 1,966/408 hold UNCHANGED thanks to the scoping) |
| `e7c0a60` | B — migration 0124 | Clear the stale Excel-import installments (`source_type='bulk_import' AND source_id LIKE 'imp-%'` — the precise import identity; batchRegister's wizard rows untouched; purge safety verified live TWICE: 0 payment links, 0 allocations, FKs ON DELETE SET NULL) + re-tighten the CHECK to `(0,1,2,3)` + the constraint comment |
| `a62103a` | C — the live remediation | 0124 applied live (Management API, HTTP 201, atomic; verified: the CHECK text + the registration row + 0 installments) then the REAL workbook re-imported through the corrected canonical pipeline (the REAL ImportEngine + the REAL Supabase repositories headlessly — `scripts/t-425-live-reimport.ts`; 1,141 read / 1,139 updated / 2 skipped / 0 rejected / 67s) |

(T-424's own phases landed earlier: `91d5088` registration, `76500d3` Phase A — DATA-041 the waterfall attribution, `958813e` Phase B — DATA-042 the canonical predicates + wave derivation, `097326a` Phase C — DATA-043 the dashboard full-collection reads + the registered baseline move 25→18.)

## The live result (the official model — `scripts/t-425-no-4th-tranche-probe.mjs`)

| Row | n | Σdue (DZD) | Σpaid (DZD) | Due date |
|---|---|---|---|---|
| tuition T0 — Frais d'inscription (FI) | 1,137 | 28,959,000 | 27,827,300 | 2026-09-15 |
| tuition T1 — Tranche 1 (V1) | 1,134 | 111,758,300 | 83,600,400 | 2026-09-15 |
| tuition T2 — Tranche 2 (2V) | 1,137 | 96,075,000 | 20,267,200 | 2026-12-15 |
| tuition T3 — Tranche 3 (v3) | 1,132 | 96,918,500 | 17,396,200 | 2027-03-15 |
| transport T1/T2/T3 (1T/T2/t3) | 472 each | 23,134,000 | 13,523,000 | Sept/Dec/Mar |
| **tuition T4** | **0** | — | — | **does not exist** |

Total installments: 5,956 (the in-memory oracle's count EXACTLY — the live DB holds precisely the engine's verified output).

## The Excel source-of-truth verification (`scripts/t-425-live-verify.mjs`)

The owner's mandate: "Carefully verify that the numbers and statuses being displayed in the app actually match what is present in the Excel spreadsheet. Do not assume that the current Statistics or Finance calculations are correct."

**The workbook's own ground truth pinned first** (`scripts/t-425-q-column-diagnostic.mjs`):
- Σ P-column (TOTAL VERSEMENTS, cached) = Σ (R+S+T+U+W+X+Y) computed = **162,649,000 DZD exactly** — the owner's stated P formula confirmed on all 1,138 deduped rows.
- Σ max(0, Q-column) = **193,797,200 DZD** (the school's authoritative créance, INCLUDING their manual overrides).
- The Q column diverges from the pure formula (L+N−M−P) on exactly **8 hand-overridden rows** (METAH NADA, DAHMANI FARES, LAOUAR ANES, ELOUARADI MED, AITHAMOUDA ANAIS, TASLGHOUA NAILA, BERDAI MAROUAN, GOUIGEH HIBA) — the school adjusted Q by hand without adjusting the underlying columns.
- The ancillary columns (AR..AU: COURS SUP, LIVRES, CLUB, SORTIES) are all zero on this workbook.

**The per-student comparison (live DB vs the workbook's own Q column, matched by the t-424 oracle's phone+name keying):**
- **1,130 of 1,138 rows match EXACTLY (±1 DZD)** — the live per-student Σremaining equals the school's own créance figure.
- **7 divergences, every one explained:**
  - 6 are the school's manual Q overrides listed above (the app computes the formula over the real columns: devis + dettes − remboursement − every real payment including REGLEMENTS DETTES; the school's hand values cannot be derived from the sheet's own columns — the recommendation below).
  - 1 (HEROUA MOSADEK, Δ −3,000) is a real payment the workbook's own P formula misses — the engine counts it; **the app is more correct than the sheet**.
- 1 row has no live student match (the known workbook name/phone artifact — same row the t-424 in-memory oracle could not match).
- **0 overpaid rows** (amount_paid ≤ amount_due on all 5,956).
- **Encaissé = 162,713,000 DZD** — the T-423 acceptance value EXACTLY (the payments table also carries the REGLEMENTS DETTES settlements Σ64,000 that the workbook's P formula does not include: 162,649,000 + 64,000 = 162,713,000).
- **Créances = 194,230,700 DZD** on the installment basis (the DATA-039 basis label applies): the workbook-formula total 194,465,700 minus the REGLEMENTS DETTES payments and the negative-clamp effects — and within +433,500 of the school's hand-adjusted Q total 193,797,200 (the 6 override rows).

**The cross-surface invariant (T-424's core acceptance):** Statistics and Finance now read the SAME collections (the 0123 RPCs / the keyset fallback — DATA-043) through the SAME canonical derivation (`deriveTrancheWaveStats` + `isInstallmentSettled` — DATA-042) over the SAME corrected rows (DATA-041's waterfall + T-425's structure). The same student, payment, tranche, debt, balance, or payment status CANNOT render differently between the tabs — it is one data flow, pinned by the t-424 unit suite's cross-surface invariant (Finance pooled per-index totals == Σ Statistics per-category rows; settled follows the ONE predicate) and the no-4th-tranche pins (a legacy T4 row and the FI fee row are non-wave on BOTH surfaces).

## The gates

- typecheck 0 errors · vitest full suite **4,206 passed / 18 failed = BASELINE-MATCHED** (the registered baseline moved 25→18 by T-424 Phase C: the t-355 owner-copy repair + the t-353 result assertions; `scripts/test-baseline.json` cites the task) · desktop runner 809/0/10 · mirror 784/0/0/35 · sanity 819/819 · tier-4 KNOWN PARITY (unchanged).
- The t-424 in-memory oracle RE-RUN under the new structure before the live write: WATERFALL Σremaining = **193,477,900 = the workbook's computed Q EXACTLY**, 0 overpaid rows — the attribution preserved (the pool is byte-identical; only the structure it fills changed).
- The import-family regressions all green with their census anchors UNCHANGED (t-105, t-417, empty-state-excel-restore, t-364, t-420) — the tuition-scoped cascade kept the totals identical.

## The recommendation for the 6 override families

The school's hand-adjusted Q values (negotiated settlements) cannot be reproduced from the sheet's own columns. To reflect them in the app, the school should record the adjustments properly (a REMISE on the row, a DETTES reduction, or a ledger adjustment) and re-import — the canonical pipeline then carries them through every surface. Until then the app shows the formula-derived figure (the honest computation over the real data), and the 6-row delta (+433,500 DZD total) is the documented difference.

## Chain + registry state

Migration chain head: **0124** (0122 still reserved for IMPORT-118/REALTIME-105). DATA-041/042/043/044 → RESOLVED — TESTED — LIVE-VERIFIED. T-424 + T-425 → DONE. Knowledge: AGENTS.md §15.65.
