# T-528 — Live Verification — the two Diagnostic-Webhooks false positives fixed on the REAL books (AUDIT-507 + AUDIT-508)

> **Session:** 172nd, 2026-10-13 · **Task:** T-528 · **Problems:** AUDIT-507 (the reg-identity dangling charges) + AUDIT-508 (the sibling duplicate tuples)
> **Method:** `scripts/t528-false-positives-live.ts` — the app's OWN Supabase client (the admin sign-in), the REAL repositories warmed through the t511 `warmExportSources` seam, the EXACT T-528-fixed engine (`runWebhookDiagnostics`) over the REAL streams — READ-ONLY (zero writes; the double-run determinism + the row-count invariance prove it). Every fixed class is cross-checked against an INDEPENDENT census re-derived from the raw streams (never the engine checking itself).

## 1. The verdict

**13/13 GREEN.** Both reported false-positive classes are GONE from the real books; every genuine-detection class is preserved byte-for-byte against independent censuses.

## 2. The streams (the audit's real population)

`parents=742 · students=1138 · payments=2199 · installments=5960 · ledger=3348 · debtSummaries=635 · allocations=1` — note the corpus GREW since the T-511 census (2,198 payments): the owner registered the reported family TODAY at 12:40 (its 5,000 DZD fee-payment `b49bf312` / `REC-2026-000001` is the +1 payment, with exactly ONE ledger twin — clean).

## 3. The fix evidence (the two reported classes)

### 3.1 AUDIT-507 — the owner's reported billing entry (T4a–T4d)

| Check | Result |
|---|---|
| T4a — the reported entry `e8afa61f-3f75-4a18-bde1-40900f219057` no longer carries `confirmed_mismatch:charge-dangling` | **PASS** — no dangling finding exists |
| T4b — it is positively reconciled through the reg-identity | **PASS** — `reconciled:charge-reg-resolved:e8afa61f…` → installment `98ed91e2-eaf4-4cae-baec-79f5b737cf8c` (the REAL « Année complète » row, 365,000 DZD, matching Omar Khelifi `ELV-2026-0CF277`) |
| T4c — the family's registration charges ALL resolve | **PASS** — 4/4 `charge-reg-resolved` for parent `e3506a7c…` (tuition t1 365,000 + transport t1/t2/t3 20,000/10,000/10,000) |
| T4d — the GLOBAL census: no installment-sourced charge is left unresolved | **PASS** — 4 installment-sourced charges on the books, 0 dangling findings |

The pre-fix state (the registration forensics, `scripts/t528-false-positive-probe.ts` Q6/Q13/Q14): the same 4 charges were ALL flagged CRITICAL « Facture liée à une échéance introuvable » (405,000 DZD of false alerts) while their backing installments existed with EXACTLY agreeing amounts. Post-fix: 0 false alerts, 4 positively-accounted findings stating the resolution form.

### 3.2 AUDIT-508 — the sibling duplicate tuples (T5a–T5b)

| Check | Result |
|---|---|
| T5a — zero `duplicate_event:dup-tuple` findings on the real books | **PASS** — 0 (was 162 — the T-511 census's « 162 duplicate signatures », live-proven to be 100% sibling groups) |
| T5b — the reconciled sibling findings match the independent census | **PASS** — engine `dup-siblings` = **162** = the independent re-derivation from the raw payments stream (the same rule computed outside the engine) |

The 162 sibling groups (377 payments, 13,606,500 DZD — AHLEM+ABDERHMAN HAMOUDA 2×135,000, CELIA+HADJER AKHAL 2×133,000, …) now render as `reconciled:dup-siblings:*` findings explaining WHY identical tuples are legitimate (distinct students, distinct receipts, identical per-grade pricing) instead of false « événement rejoué » warnings.

## 4. The preserved classes (the owner's hard requirement — T6)

| Class | Engine ≡ independent census | Note |
|---|---|---|
| T6a — the BUSINESS-002 import class (payments without ledger twins) | **2,198 = 2,198** | byte-untouched by the fix — the separate owner-gated question |
| T6b — the shared-receipt CRITICAL class | **0 = 0** | no receipts are shared on the live books; the check is preserved (test-pinned) |
| T6c — the Example-A future-dated class | **735 payments · 45,491,400 DZD** | still reported honestly — the owner-gated §15.95a remediation corpus |
| T7 — read-only + deterministic | **PASS** | the second run's counts byte-identical; the row counts never move |

## 5. The findings census (post-fix) and the one honest delta

```
confirmed_mismatch: 2,199 · duplicate_event: 0 · unjustified_amount: 0 · outlier_review: 3
date_semantic_conflict: 1,463 · unverified: 107 · reconciled: 2,873   → findings = 6,645
```

Against the T-511 census (6,638): −4 false dangling +4 charge-reg-resolved −162 dup-tuple +162 dup-siblings = net 0 from the FIX; the +7 corpus drift is TODAY's registration data (the 4 registration charges → 4 charge-reg-resolved, the 5,000 fee charge → 1 reconciled charge-justified [« Frais d'inscription 2026 (nouvelle famille) » — specific description], the 5,000 payment → 1 reconciled pay-ok, and ONE honest `recon-gap` — see below).

**The one honest delta — a genuine data-state finding, NOT a false positive:** the new account carries exactly ONE `confirmed_mismatch:recon-gap` finding (the +1 over the 2,198 pay-no-ledger class — `pay-multi-ledger` and `orphan-ledger` are both census-proven 0). The arithmetic, live-proven: the ledger replay says **405,000 DZD outstanding** (410,000 charges incl. the 5,000 FI fee − 5,000 paid) while the installments-based debt summary says **400,000** (405,000 due − 5,000 paid) — the divergence is EXACTLY the FI fee « Frais d'inscription 2026 (nouvelle famille) », which the 0102/0128 registration convention writes as a LEDGER-ONLY charge (no installment row). The engine honestly surfaces this ledger-vs-installments divergence for the owner's review; per the read-only charter it is NEVER auto-corrected. (Registered as an observation for the owner: whether the FI fee should also mint an installment row — or the debt summary should read the ledger — is a business-ruling question, not an agent decision.)

## 6. The full verification inventory (this task)

1. **The registration forensics (read-only, SELECT-only):** `scripts/t528-false-positive-probe.ts` (Q1–Q8) + `scripts/t528-false-positive-probe2.ts` (Q9–Q14) — the ground truth for both classes BEFORE the fix.
2. **The regression suite:** `src/tests/domain/payment/t-528-false-positives.test.ts` — **21/21** (the five owner-mandated classes + the safety edges).
3. **The neighborhood pins:** the T-511 suites **50/50 unchanged-green** (40 engine + 10 UI — the genuine-duplicate and dangling classes preserved by construction).
4. **The battery:** typecheck 0 · the FULL unified suite **GREEN 0 failed / 5,203 passed / 5 skipped (5,208, 316 files — the registered baseline move)** · Layer 2 all equivalence layers matched (810/820 · 774/820 · 784/820 · sanity 820/820 + 319/319 — the canonical financial engines byte-untouched) · eslint 0/0-new.
5. **The live round (this document):** 13/13 GREEN through the app's own client on the owner's project.

## 7. The VERIFIED gate

The owner's eyeball pass: REBUILD the desktop, open Finance → Diagnostic & Requêtes → the « Diagnostic Webhooks » card over the real books — (a) the Khelifi family (`PAR-2026-FC78AF`) shows NO « échéance introuvable » critical (its 4 registration charges appear as green « Facture d'inscription raccordée » rows); (b) the Doublons chip shows **0** (the 162 sibling families now appear as green « Paiements identiques légitimes — élèves distincts » rows); (c) the other classes unchanged (2,198 partial-processing warnings, 1,463 date-semantics, 3 price outliers, 107 unverified — the standing owner-gated corpus).
