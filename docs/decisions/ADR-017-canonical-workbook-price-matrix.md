# ADR-017: The workbook-derived price matrix is the canonical pricing source

- **Status:** Accepted (2026-09-12, 54th session — problem CALC-001, tasks T-315…T-319)
- **Context:** The entire pricing/calculation layer was built on a fictional price book ("Prices.md": tuition 130k–395k, flat family FI 5 000, 10% early discount, 5 discount rules, 4 transport zones, chess/canteen/uniform services) that matched nothing in the school's actual records. The school's real 2026/2027 model lives in the legacy Excel workbook `Suivis clients  2026_2027.xlsx` — encoded in RAW FORMULAS:
  - ETAT column L (DEVIS ANNUEL): `=FI+scolarité+transport−remise` per row.
  - ETAT column S (V2): `=V2_sticker−remise` (e.g. `=122000-J58`).
  - Devis sheet: Sous-total / Réduction / REMBOURSEMENT / Montant Total, and the early-payment note `=+SUM(F…)*0.05` (5% of the scolarité only).
- **Decision:**
  1. The canonical 2026/2027 pricing matrix is the workbook extraction codified in `elimtiyaz-desktop/src/domain/calc/pricing/school-price-matrix.ts` (FI per grade, scolarité per grade, V2/2V/v3 tranche stickers, 20-town transport matrix, real services, 5%-of-scolarité early rate, sibling default 5 000/child).
  2. The corpus verification suite `src/tests/domain/pricing/real-school-corpus.test.ts` (fixture generated from the workbook: 390 ETAT rows + 10 Devis quotes) is the acceptance gate for ANY change to the pricing engine — a change that breaks the corpus replay is a regression, by definition.
  3. The negotiated REMISE is a manual per-student input (never a deterministic formula); it reduces the devis total and the V2 tranche only. The sticker-price case (`chargeStickerPrice`) reproduces the two documented SEDIKI rows.
  4. The DB pricing catalog follows via migrations (0089: per-grade `registration_fee` on `grade_level_tuition`, real grid + towns + services, fictional discounts deactivated, `full_annual` = 5). The catalog drives FUTURE quotes; the historical financial corpus is NEVER recomputed from it (balances replay from stored ledger rows — INV-1).
  5. The Android mirror (`core/DiscountEngine.kt`) must stay in lockstep with the desktop engine (ADR-002); the shared cross-platform scenario fixtures carry the corrected expectations.
- **Consequences:**
  - New registrations produce numbers that match the school's own Excel (verified row-by-row).
  - The retired fictional values remain readable for historical rows (legacy discount codes stay in the unions/DB for compatibility but are inactive; legacy transport zones still resolve).
  - Price changes for FUTURE years go through the admin pricing settings (the matrix is the DEFAULT) — and the corpus suite pins the 2026/2027 defaults.
  - The workbook itself is the forensic evidence; it stays at the repository root, unmodified.
