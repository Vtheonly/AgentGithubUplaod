# T-529 — Live Verification — the diagnostics-purpose mandate delivered on the REAL books (AUDIT-509 + AUDIT-510)

> **Session:** 173rd, 2026-10-14 · **Task:** T-529 · **Problems:** AUDIT-509 (the re-pasted échéance-introuvable card — the stale-build verdict + the all-origins mandate) + AUDIT-510 (the configured-price compliance purpose gap)
> **Method:** `scripts/t529-diagnostics-purpose-live.ts` — the app's OWN Supabase client (the admin sign-in), the REAL repositories warmed through the t511 seam (INCL. the pricing config — the new input), the EXACT T-529 engine (`runWebhookDiagnostics` with the live `pricingConfig`) over the REAL streams — READ-ONLY (zero writes; the determinism + row-count invariance prove it). Every fixed class is cross-checked against an INDEPENDENT census re-derived from the raw streams (never the engine checking itself). The registration forensics: `scripts/t529-diagnostics-purpose-probe.ts` (Q1–Q8, read-only, before any fix).

## 1. The verdict

**21/21 GREEN.** The owner's exact example now flags with the full 7-point structure; the config tension is surfaced as the root cause; the re-pasted card's entry is confirmed resolved (the card was a pre-fix build's output); every pre-existing class is byte-stable.

## 2. The streams (the audit's real population — identical to the T-528 census)

`parents=742 · students=1138 · payments=2199 · installments=5960 · ledger=3348 · debtSummaries=635 · allocations=1 · pricing=loaded` — zero corpus drift since the 172nd session (the same 2,199 payments, the same 3,348 ledger rows).

## 3. AUDIT-509 — the re-pasted card's entry (T4) + the all-origins coverage (T7)

| Check | Result |
|---|---|
| T4a — the re-pasted entry `e8afa61f-3f75-4a18-bde1-40900f219057`: NOT dangling, positively reconciled | **PASS** — `reconciled:charge-reg-resolved` → installment `98ed91e2-eaf4-4cae-baec-79f5b737cf8c` (« Facture d'inscription raccordée à son échéancier ») |
| T4b — the global dangling census | **PASS** — 0 findings |
| T7a — `coverage.pricingConfig` | **PASS** — true (the catalog is wired) |
| T7b — the charge identity-form census ≡ the registration forensics | **PASS** — `{installment-pk: 0, installment-reg-identity: 4, bulk-import-stem: 1,143, manual-entry: 1, other: 0}` |

**The stale-build verdict stands** (the registration forensics, §AUDIT-509): the pasted card's explanation text (« qui n'existe pas (alors que le tableau des échéances est chargé) ») is byte-identical to the PRE-T-528 engine's wording — the current engine words the (genuine) dangling class differently and produces NO such finding for this entry or any other. The owner's build predates `92a18d75`. **The owner action (2 minutes): REBUILD the desktop from `main`** — the card must then show the GREEN « Facture d'inscription raccordée » row for the MERSEL MERSELFARes family (PAR-2026-FC78AF, created through the manual registration flow 2026-10-13 12:40; student Omar Khelifi ELV-2026-0CF277).

## 4. AUDIT-510 — the configured-price compliance (T2, T3, T5)

**The owner's exact example, live:** the FI encaissement `IMP-2a3c16a6-db7a-4fee-8232-260c23e1eaf5-FI` — **25,000 DZD**, HADJIBRAHIM HAMIDI (ELV-2026-AA97B9, **1ere_annee**), Excel-import provenance, expectedAmount=0.

| Check | Result |
|---|---|
| T2a — the example flags (was 0 findings pre-T-529) | **PASS** — `outlier_review:price-fi-pay:dd79bb72…` « Encaissement FI en écart avec un des tarifs d'inscription configurés » |
| T2b — BOTH configured references + the delta | **PASS** — flat **5,000** · per-grade (1ere_annee) **25,000** · `25 000 − 5 000 = 20 000 DZD d'écart avec le tarif plat configuré` |
| T2c — the provenance + the possible causes | **PASS** — provenance « import Excel (run run_mukfqlcy_775) » · 3 possible causes · 3 resolution steps |
| T2d — the resolution recommends, never rewrites | **PASS** — « Trancher la convention autoritaire » + the both-branch regularization guidance |
| T2e — the INDEPENDENT arithmetic (re-derived outside the engine) | **PASS** — flat=5,000 · gradeFee(1ere_annee)=25,000 · delta-vs-flat=20,000 |
| T3 — the config tension surfaced ONCE | **PASS** — « Configuration : deux tarifs d'inscription divergents » (flat 5,000 vs 18,000–30,000) with 2 cause candidates |
| T5 — the 5,000 « nouvelle famille » charge carries its price basis | **PASS** — `reconciled:price-fi-charge-ok` « Facture d'inscription conforme au tarif configuré » |

The verdict on the example: the payment **follows the per-grade configured convention** (25,000 = the 1ere_annee fee) and **exceeds the flat configured fee by 20,000** — the divergence class. The finding presents both truths, names the configuration's own two-convention split as the most probable cause, and leaves the ruling (flat vs per-grade) to the owner — the 7-point structure end-to-end: **what** (the title) / **where** (the HAMIDI family + the payment + receipt + student) / **why** (follows one configured reference, violates the other) / **impact** (20,000 DZD above the flat fee) / **evidence** (the payment row, both configured values, the delta, the provenance — each with its source reference) / **causes** (3 labelled hypotheses) / **resolution** (the ruling + both regularization branches — never an automatic correction).

## 5. The findings census (post-T-529, with the live config) and the honest delta

```
                pre (no config)   post (live config)   delta
confirmed_mismatch    2,199             2,199            0
duplicate_event           0                0             0
unjustified_amount        0                0             0
outlier_review            3                5            +2   (the FI divergence + the config tension)
date_semantic_conflict  1,463           1,463            0
unverified              108              107            −1   (the no-catalog coverage finding — the designed degradation)
reconciled            2,873            2,874            +1   (the 5,000 charge's price basis)
```

The delta census is EXACTLY the three designed findings (T6e: new=3, unexpected=0) plus the designed degradation delta (T6f: the single vanished ID is `unverified:price-noconfig:catalog` — present only when no catalog is supplied). Nothing else moved.

## 6. The preserved classes (the owner's hard requirement — T6)

| Class | pre ≡ post ≡ independent census |
|---|---|
| pay-no-ledger (the BUSINESS-002 import class) | **2,198 = 2,198 = 2,198** |
| duplicate_event dup-tuple | **0 = 0** (dup-siblings 162 = 162) |
| shared receipts | **0 = 0** |
| Example-A future-dated corpus | **735 = 735** (still reported honestly — the owner-gated §15.95a remediation corpus) |

## 7. The read-only + determinism guards (T8)

- **T8a** — the second run (same `now`) produces byte-identical counts AND finding IDs. **PASS**
- **T8b** — the row counts never moved (payments 2,199/2,199 · ledger 3,348/3,348). **PASS**

## 8. The battery (the full verification inventory of this task)

1. **The registration forensics (read-only, BEFORE any fix):** `scripts/t529-diagnostics-purpose-probe.ts` — Q1–Q8 (the engine-counts census, the MERSEL identity, the identity-form census, the live pricing config, the FI encaissements census, the FI charges census, the blindness proof, the read-only/determinism guards).
2. **The regression suite:** `src/tests/domain/payment/t-529-diagnostics-purpose.test.ts` — **24/24** (the owner's exact example's six assertions, the tension present/absent, the five verdict classes, the honest degradation, the identity census, the T-528 reg-resolution unchanged-with-config, the dangling + duplicate causes, the 7-dimension census, the frozen-input + determinism pins, the config-first price basis).
3. **The neighborhood pins:** the T-511/T-528 suites **71/71** (the two registered amendments: the scenario-4 actionable filter + the scenario-20 pagination 24→25 with the fourth page).
4. **The battery:** typecheck 0 · Layer 1 GREEN **5,227 passed / 0 failed / 5 skipped across all 317 files** (the five-chunk census; the registered baseline move WITH the +5 transcription correction — the T-528 committed fields recorded 5,208/5,213; the true figures, confirmed by the pre-change re-measure, are 5,203/5,208) · Layer 2 all equivalence layers matched (810/820 · 774/820 · 784/820 · sanity 820/820 + 319/319 — the canonical engines byte-untouched) · eslint 0 errors / 994 warnings byte-identical pre/post (0 new).
5. **The live round (this document):** 21/21 GREEN through the app's own client on the owner's project.

## 9. The VERIFIED gate

The owner's eyeball pass: REBUILD the desktop from `main`, open Finance → Diagnostic & Requêtes → the « Diagnostic Webhooks » card over the real books — (a) the « Anomalies à examiner » chip reads **5** (was 3): the HAMIDI FI row (« Encaissement FI en écart avec un des tarifs d'inscription configurés », 20,000 DZD) + the config row (« Configuration : deux tarifs d'inscription divergents ») join the 3 standing price outliers; expanding the HAMIDI row shows BOTH configured references, the delta, the provenance, the « Causes possibles (hypothèses à vérifier) » block, and the resolution steps; (b) the MERSEL MERSELFARes family (PAR-2026-FC78AF) shows the GREEN « Facture d'inscription raccordée » row (no « échéance introuvable »); (c) the other classes unchanged (2,198 partial-processing warnings, 1,463 date-semantics, 107 unverified, the Doublons chip at 0).

**The REGISTERED owner ruling (the root cause the diagnostics now surface):** the configuration carries TWO divergent registration-fee conventions — the flat familial 5,000 (charged by the registration flow's « Frais d'inscription (nouvelle famille) ») vs the per-grade 18,000–30,000 (charged by the Excel import's FI column). Which is authoritative? The owner's ruling decides: if the flat 5,000 is the truth, the HAMIDI 20,000 excess needs regularization through the existing flows; if the per-grade grid is the truth, the registration flow under-charges and the config's flat column should be aligned. The engine flags and explains; it never rewrites.
