# Deep Sweep 08 — Runtime Spot-Verification of the S11 Checklist Findings (Session 12)

**Date:** 2026-11-19 · **Session:** S12 · **Branch:** `investigation/session-12` · **Repo HEAD at start:** `14f47bdf` (main, clean tree).
**Charter:** handoff-session-12 Lane B item 1 — convert the S11 static findings to runtime-proven where a read-only browser session allows it, plus the two standing S10 leftovers (BUG-044 loop origin, tooltip spot-check). **No application source, configuration, schema, or dependency was modified.** Only `Investigation Archive/` was written; scripts and the dev server ran outside the repo tree.

## §0 — Method

The S10 recipe re-run verbatim (Deep Sweep/06 §8): `npm ci --ignore-scripts` (931 packages; `git status` stayed clean) → `npx vite --port 5173` (Vite 6.4.3) → agent-browser/Chromium → first load PRE-toggle (the C-20 live-default state) → set `el-imtiyaz.local-config={"supabase_use_supabase":false}` → reload → mock login as SuperAdmin → walkthrough: dashboard (Vue d'ensemble + Analytique & Pilotage) → Finances (Paiements, Suivi des Dettes) → **Encaissement modal from the debt-dashboard entry** → CRM (Parents, Élèves) → **student drawer → Paiements & Tranches tab** → Finances → **payment-detail drawers (Virement + Chèque)** → **receipt PDF download + text extraction** → tooltip hover on the analytics cards → copilot send probe. The three S10 method lessons were applied (trusted events for Radix; overlay-wrapper checks; getBoundingClientRect for fixed elements).

## §1 — BUG-046: RUNTIME-PROVEN (the owner's "missing tranches progress bar")

Entry point #1 (Finances → Suivi des Dettes → "Encaisser", family row `Fatima Belkacem`, outstanding 99 000 DZD, dashboard itself showing "Dernier paiement 13/08/2025"):

- The modal opens titled **"Encaissement — Dette consolidée famille"** with the line item **"Solde familial consolidé (toutes catégories)"**.
- **"Déjà réglé (historique): 0"** and **"Reste à payer: 99 000"** — the family's real payment history is erased from the modal's DebtMeter while the launching dashboard shows a payment 463 days ago. Exactly the S11 static prediction (`alreadyPaidAmount: 0` on the synthetic consolidated item).
- The tranche strip collapses to **ONE segment** spanning 0→99 000 ("Affectation waterfall — 1 tranche(s)": the synthetic item itself, named "Tranche 3" in the waterfall list). The RACCOURCIS TRANCHE row offers a single "0" and the consolidated item — no T1/T2/T3 strip.
- Screenshot: `censuses/runtime-s12-encaissement-payments-entry-bug046.png` (dialog 1152×508).

**Verdict: BUG-046 upgraded [STATIC] → [RUNTIME-proven].** The contrast case (the student payments tab's true multi-tranche strip) could not be exercised — the walked student (Yacine Benali) shows "Tranches restantes: 0" and a disabled "Encaisser part élève"; the strip's multi-segment rendering was verified instead via the S11 static census (entry #5).

## §2 — BUG-048: right-edge overflow RUNTIME-PROVEN; adjacent-collision case not exercised

In the same modal (single-segment variant), the PaymentSlider scale row (`div.relative.h-4.mt-0.5.text-\[9px\]`, width 609 px, **overflow: visible**) carries the last boundary label SPAN "99 000" (`absolute -translate-x-1/2`, 29 px wide) positioned at `left:100%` → rendered x=694..724 while the row ends at x=709 — **the label overflows the scale row's right edge by 15 px** (half the label width), hanging into the card padding. The segment label SPAN carries `text-[10px] ... truncate` (598 px wide in this variant — truncation not triggered here; the S11 census documents the "Tranche…"/"15 dé…" clipping at narrower widths). The >3-segment adjacent-label collision was not exercisable this run (see §1); the mechanism (absolute −translate-x-1/2 at left:N%, unclamped last label, no overflow control) is confirmed at runtime.

**Verdict: BUG-048 partially upgraded — the edge-overflow mechanism [RUNTIME-proven]; the multi-label collision remains [STATIC + S11 measurements].**

## §3 — BUG-053: RUNTIME-PROVEN (the transfer/check asymmetry, both directions)

- **Virement payment** `REC-2025-000009` (Karim Benali → Yacine Benali, 79 000 DZD, drawer "Paiement REC-2025-000009"): renders N° REÇU / CANAL (Virement) / PÔLE / DATE / MONTANT / PARENT PAYEUR / ÉLÈVE BÉNÉFICIAIRE / NOTES — **NO transfer details block at all** (no reference, no bank, no operation date). The drawer is a single panel (0 `[role=tab]` elements) with **zero allocation content**.
- **Chèque payment** `REC-2025-000002` (Amina Cherif → Mohamed Cherif, 3 500 DZD): the same drawer DOES render a **"DÉTAILS DU CHÈQUE"** block (N° Chèque / Banque / Émission / Compensation — all "—" for the mock data, but the block exists).

**Verdict: BUG-053 upgraded [STATIC] → [RUNTIME-proven]** — the exact asymmetry S11 found in code (`payment-detail-drawer.tsx:259-271` has only the `method === "check"` branch). Incidental mock-data note (not a code defect): the Virement payment carries the note "Chèque en attente de compensation".

## §4 — BUG-047: RUNTIME-PROVEN (the receipt PDF is a strict subset of even the drawer)

"Reçu PDF" clicked on the Chèque drawer → `recu-REC-2025-000002.pdf` (2.6 KB) downloaded → `pdftotext` extraction (evidence: `censuses/runtime-s12-recu-REC-2025-000002.txt` + the PDF). Contents: receipt number, statut, date, reference (PAY-002), payeur block, **one single summary line** ("Paiement comptoir | Cheque | Transport | 3 500"), TOTAL PAYÉ, notes, justificatif (proofUrl), signature block. **Omitted:** the check details the DRAWER itself shows (N° Chèque/Banque/Émission/Compensation), any per-category/tranche allocation, expected/excess amounts, collectedBy, academic year. The PDF shows strictly less than the drawer, which shows strictly less than the student-tab PaymentBreakdownCard.

**Verdict: BUG-047 upgraded [STATIC] → [RUNTIME-proven]** (RC-1..RC-4 chain confirmed end-to-end on a real generated artifact). Also runtime-confirmed: the PaymentBreakdownCard ("DÉTAIL DE LA COUVERTURE") IS mounted and rendering in the student payments tab — its single mount point (S11: `student-detail/payments-tab.tsx:207`).

## §5 — BUG-042 regression check: PASS

`system_settings` request count for the whole session: **0** (Configuration tab never visited). The unbounded error-refetch loop does NOT occur spontaneously — it requires the tab visit, exactly as root-caused in Deep Sweep/06 §3.

## §6 — Tooltip runtime spot-check: PASSED (the S10 leftover closed)

Dashboard → Analytique & Pilotage → trusted hover on the info button "Radar de vigilance multi-critères" → a Radix tooltip portal opens with the full description ("Mesure : La synthèse du triple risque : pédagogique, assiduité, financier — …"). Tooltips work at runtime under trusted events; the S7 static census (10 usage files, 5 analytics cards) is now runtime-corroborated on the analytics surface, and the S10 report's "inconclusive on the walked pages" note is resolved (registered as correction **C-22**).

## §7 — BUG-044 probe: silent no-reply reproduced; loop NOT reproduced; zero network activity

Mock session, copilot drawer ("Copilot Éducatif", model label "openai/gpt-oss-120b"), send "test": the user turn appears with timestamp and **persists with no assistant reply after it**; **console completely clean** (no `Maximum update depth exceeded`, no errors/warnings); **no network request fired at all** (the unconfigured send fails before any fetch — a fully silent failure). The S10-observed update-depth loop did not reproduce this run — it remains non-deterministic with origin unpinned (S10 leftover (a) stays open, now with the added datum: a clean-console, zero-request failure variant exists). Screenshot: `censuses/runtime-s12-copilot-bug044.png`.

## §8 — NEW FINDING BUG-058: the perpetual mock-mode health-probe drip

Full census + the two honest retractions of this session's own intermediate readings: `censuses/runtime-s12-network-summary.txt`. Summary:

- `/auth/v1/health` is probed **every ~30 s, continuously, regardless of the mock toggle** — at the login screen and on every page (measured: +2 request lines/35 s; +3 GETs/65 s on a quiet mock dashboard; the session total grew 29→43+ over ~70 min).
- Each probe = 1 OPTIONS + 1 GET, 402 under the cap ≈ **~240 doomed requests/hour whenever the app is open, in ANY mode** — a constant background drip on the quota-limited backend (and pointless traffic even unquota'd: mock mode deliberately avoids the backend yet probes it forever).
- Root cause (static): `getOnlineDetector()` (online-detector.ts:171-182) resolves the probe URL from the canonical-fallback `supabaseUrl`, NOT from the effective runtime config — the t-050 design comment ("no probe when unconfigured") is defeated by the same canonical fallback as C-20/BUG-042. **Third member of the two-gates seam family.**
- The one-time 11-REST-table warm-up (C-20 class) was re-observed at the pre-toggle first load and did not repeat after the toggle.

## §9 — Register deltas (S12)

- **New ID: BUG-058** (the mock-blind 30 s health-probe drip; LOW-MEDIUM; fix = resolve probeUrl from the effective runtime config / explicit offline mode).
- **Evidence-class upgrades:** BUG-046 [RUNTIME-proven] · BUG-047 [RUNTIME-proven] · BUG-053 [RUNTIME-proven] · BUG-048 [edge-overflow mechanism RUNTIME-proven; multi-label collision still static].
- **Correction C-22:** the S10 tooltip spot-check "inconclusive" is resolved — tooltips runtime-verified on the analytics cards.
- **BUG-044 refinement:** clean-console/zero-request failure variant recorded; loop still non-reproduced.
- Infra: OPS-011 **10-run-stable** (the S12 gate-check probe re-run — see `01-INFRASTRUCTURE-STATUS.md`).
- Next free IDs after this session: **BUG-059, DEAD-019, DUP-035, ARCH-040, OPS-015; next correction C-23.**

## §10 — Evidence files

| File | Content |
|---|---|
| `censuses/runtime-s12-encaissement-payments-entry-bug046.png` | The Encaissement modal from the Payments/debt-dashboard entry (BUG-046) |
| `censuses/runtime-s12-recu-REC-2025-000002.pdf` + `.txt` | The generated receipt PDF + its extracted text (BUG-047) |
| `censuses/runtime-s12-copilot-bug044.png` | The copilot drawer after the unconfigured send (BUG-044) |
| `censuses/runtime-s12-network-summary.txt` | The network census: totals, the two traffic classes, BUG-058, the two retractions, the root-cause seam |
