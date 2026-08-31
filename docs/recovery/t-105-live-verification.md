# T-105 — Live Verification Matrix

> Task: T-105 — Excel-corpus cross-platform equivalence + full financial reconciliation to the source workbook (owner-mandated).
> Date: 2026-09-01 (16th recovery session).
> Scope: the REAL workbook (`Suivis clients  2026_2027.xlsx`, sheet `ETAT 20262027`, rows 2–391) as the data oracle; all 259 live parents; the three client platforms; the live write path.

---

## 1. The workbook itself (does the problem occur there? — owner question)

**NO — the workbook is internally consistent:**

| Check | Result |
|---|---|
| `P (TOTAL VERSEMENTS) = R+S+T+U+W+X+Y` (FI+V2+2V+v3+1T+T2+t3) | **390/390 rows exact** |
| `Q (TOTAL*CREANCE) = L − P` | **390/390 rows exact** |
| `L (DEVIS ANNUEL) = components − J(REMISE)` — L is **NET** of remise | raw formulas read for representative rows (2, 3, 235, 236, 242); e.g. row 235 `=300000-J235` |
| Duplicate student names | exactly one pair: rows 235/242 'SIDI MAMER SAMYI' (different phones → different parents) |
| Refunds (M) / dettes (N) / reglements (O) nonzero rows | 0 / 2 / 0 |

The divergence the owner reported does NOT manifest inside the workbook — it lived **between the workbook and the imported corpus** (§2).

## 2. Corpus diagnosis BEFORE 0063 (Excel ↔ DB, name+phone join, 390/390 students matched)

| Check | Result | Root causes |
|---|---|---|
| M1 payments == workbook versements | 258/259 | row 242's family never imported (**DATA-011**, 255,000 DZD) |
| M2 netdue == devis+dettes−regl | 61/258 | **DATA-010** double-remise (223 parents, Σ −9,709,700 DZD) + schedule-vs-devis residuals (~35) |
| M3 balance == workbook créance | 61/258 | same |
| Σ remise adjustments live | −9,709,700 | the importer wrote charge=L (net) AND −J adjustment |

## 3. Migration 0063 (`0063_excel_corpus_alignment.sql`, applied live atomically with registration — MIG-TOKENS)

- STEP 1 — compensating +|J| adjustments per imported "Remise sur devis" entry (append-only, idempotent source_ids).
- STEP 2 — the missing row-242 family created exactly per the workbook: parent `0554288142` (PAR-2026-md5), student 'SIDI MAMER SAMYI' (5ap), tranches 102,000 / 76,500 / 76,500 (5ap grid net of 45,000 remise = 255,000 exactly), NET devis charge, 3 payments (V2 75,000 + 2V 90,000 + v3 90,000).
- STEP 3 — per-student alignment: ledger adjustment (target − netdue) + installment absorption (last-tranche rule, cascade, status recompute).
- STEP 4 — waterfall replay: `DELETE payment_allocations` → installments reset → all payments replayed (canonical order).
- STEP 5 — audit marker `financial.reconcile_0063`.

**Dry-run** (BEGIN…ROLLBACK) before applying: all checks green. **Idempotency**: double-run in one transaction → identical final state (marker guard). **Fresh deployment**: every step targets zero rows (corpus join matches nothing).

## 4. Corpus verification AFTER 0063 (`scripts/verify_t-105.sql`, live)

| Check (per parent, n=259) | Result |
|---|---|
| M1 paid == TOTAL VERSEMENTS | **259/259** |
| M2 netdue (charges+adj) == DEVIS+DETTES−REGL | **259/259** |
| M3 balance == netdue − paid (workbook créance) | **259/259** |
| C3 installments Σ due == ledger netdue | **259/259** |
| C4 no tranche over-applied | **259/259** |
| C5 INV-4 remaining == max(0, balance) | **259/259** |

`verify_t-103.sql` re-run: **C1–C8 all TRUE** (0 residuals). Chain: **60/60** (0001–0063, JSON-diffed, zero drift).

Spot checks (workbook → live):

| Parent | devis/netdue | paid | balance | Workbook says |
|---|---|---|---|---|
| ZIREG LEA (0663701834) | 239,500 | 239,500 | **0** | Q=0 (was a fake −25,500 credit pre-0063) |
| SIDI MAMER SAMYI A (0550067500) | 463,500 | 493,500 | **−30,000** | Q(row 235)=−30,000, Q(row 236)=0 |
| SIDI MAMER SAMYI B (0554288142) | 255,000 | 255,000 | **0** | Q(row 242)=0 — family created by 0063 |

## 5. Cross-platform equivalence (the owner's core ask)

259 canonical `computeParentSummary` scenarios generated from the post-0063 live corpus (real ledger entries + tranches per parent): `financial-tests/equivalence/scenarios/t105_*.json`, `then` = the live `compute_parent_summary` SQL RPC values (the backend leg).

| Engine | Result |
|---|---|
| Backend (canonical SQL RPC, live) | the reference (259 parents queried via REST) |
| Desktop TS runner (`desktop_runner.ts`) | **259/259 == backend** |
| Android Kotlin runner (`AndroidEquivalenceTest`, gradle) | **259/259 == backend** (304/304 scenarios total; the single ✗ is the pinned zero-payment all-engine error case) |
| Website port (`t-105-corpus-equivalence.test.ts` + fixture) | **262/262** (259 parents + aggregates + INV-4) |
| Triple comparator (`triple_comparator.ts`) | **304/304 equivalent, 0 discrepant** |

Platform suites: desktop **69 files / 2,192 tests** ALL PASS (+ NEW `t-105-import-shape.test.ts` 5/5 on a real-workbook import), typecheck clean, lint 0 errors; website **18 files / 415 tests**, lint clean, build green; Android equivalence 304/304 (JDK 21 + SDK 35 provisioned in-container).

## 6. Live write-path sync (`scripts/verify_t-105-ops.sql`, all in BEGIN…ROLLBACK)

| Op | Checks | Result |
|---|---|---|
| **A — payment** (canonical `collect_and_allocate_payment`, cash 20,000) | payment+ledger rows created; RPC returns allocated=20,000/unallocated=0; `compute_parent_summary` paid/outstanding move ±20,000 EXACTLY; I1 payments==ledger; waterfall applied to tranches; I3 due==charges+adj | 6/6 TRUE |
| **B — registration** (`batch_register_family` + FI Tranche-1 payment 25,000) | parent+2 students created; clean zero financial state; FI lands on Tranche 1 (allocated=25,000); I1/I3 hold | 4/4 TRUE |
| **C — pending check** (method=check, proof mandatory — trigger enforced) | lands as `amount_pending` (INV-4 uncleared); remaining non-negative and net of pending | 2/2 TRUE |
| **D — refund** (`revert_payment_allocation`) | refunded payment excluded from paid totals; I1 holds with reversed-originals excluded | 2/2 TRUE |

**14/14 TRUE** — a mutation through the Supabase canonical RPC propagates consistently to every read surface (payments, ledger, installments, allocations, `compute_parent_summary`).

## 7. Importer regression protection (fresh imports)

`repository-adapter.ts`: (1) NO ledger entry for the remise (comment cites the formula evidence); (2) `buildInstallmentRows` C3 reconciliation — Σ tranches due ← devis + dettes − remboursement (last-tranche absorption, negative cascade, status recompute). Verified by `t-105-import-shape.test.ts` (5/5): zero "Remise sur devis" adjustments, no REMISE-sourced entries, Σ tranches == Σ(devis+dettes−remboursement), ledger net == Σ(devis+dettes), no negative tranches.

## 8. Artifacts

- Migration: `elimtiyaz-desktop/supabase/migrations/0063_excel_corpus_alignment.sql` (chain 60/60)
- Apply script: `elimtiyaz-desktop/scripts/apply_0063_live.sh` (MIG-TOKENS atomic)
- Corpus verification: `elimtiyaz-desktop/scripts/verify_t-105.sql`
- Ops verification: `elimtiyaz-desktop/scripts/verify_t-105-ops.sql`
- Import-shape tests: `elimtiyaz-desktop/src/tests/integration/t-105-import-shape.test.ts`
- Corpus scenarios: `elimtiyaz-desktop/financial-tests/equivalence/scenarios/t105_*.json` (259)
- Website corpus test: `elimtiyaz-website/src/test/t-105-corpus-equivalence.test.ts` + `src/test/fixtures/t105-corpus.json`
- Generators/diagnostics (session workspace): `/home/z/my-project/scripts/` (extract_excel_corpus.py, gen_0063_migration.py, gen_t105_scenarios.py, gen_website_fixture.py, compare_t105.py, dryrun_0063.sql, diag_t-105-*.sql)

## 9. Remaining

- T-104 / DATA-009 (parent_credit double-count in the canonical writer) — design decision, now affects only NEW overpayments (2 historical genuine credits remain).
- The 259 t105 scenarios are pinned fixtures — regenerate via `scripts/gen_t105_scenarios.py` if the corpus changes materially.
