# Session 45 Report — E2.6 wave 3: the 8-defect closeout (2026-11-22)

**Mandate:** the owner's standing ≥4-task session minimum. **Delivered: 8** — every remaining E2.6 defect, one commit each, E2.6 RESOLVED-TESTED (16/16 defects since Session 41).

## The census (the owner's standing question, re-verified fresh this session)
**32 task cards solved since G0 was lifted** (Sessions 28-45; E2.6 is the 32nd). **89 open**: 47 T-cards (18 the v2.0 investigation register, 12 E7A/E7B, 6 post-overhaul, 9 the Excel-importer lane, 2 §16) + 43 E-items (E1:8 E3:7 E4:8 E5:9 E6:10... E2 now FULLY closed) — 3 folded cards excluded. The register-hygiene pass over the 18-card v2.0 bucket remains the next census refinement.

## The defects (each: re-verified at HEAD → fixed → pinned → neighborhood-verified → committed → pushed)
| Defect | Commit | The fix | Pins |
|---|---|---|---|
| BUG-010 SuperAdmin stamp | 6d97ed65 | ONE ensureSuperAdminPermissions on sign-in/refresh/RESTORE (the hand-rolled second stamp dead) + the session.ts invariant comment corrected (can() is NOT a bypass site — t-313) + ai-309's promised-but-missing leg-2 pin written | ai-309 4/4 |
| BUG-016 gpa memo | d649926a | the missing dep + the class context (without academicLevelId/academicYearId NO config can match — the BUG-002 lesson; the dep alone was dead) + the formula caption DERIVED from the recipes in play | t-e26-bug016 3/3 |
| BUG-022 name resolvers | 4c0ec6f1 | studentDisplayName at both insights sites (empty-string displayNames rendered empty labels) + NEW teacherDisplayName + the coefficient-weighted grade-anomaly baseline | t-e26-bug022 5/5 |
| BUG-025 modal header | d57a29a6 | the UnifiedModal header slot RENDERS for dialog/drawer (was command-palette-only; two live call sites lost real UI) | t-e26-bug025 4/4 |
| BUG-026 tab sync | a8bcb4df | apply ?tab= whenever it appears then CONSUME it (the dashboard idiom, reactive) | t-e26-bug026 3/3 |
| BUG-013 role strings | cbcbd47b | the RoleSelect speaks the canonical Role enum + a read-side legacy normalizer (no stranded saved nodes) | t-e26-bug013 4/4 |
| BUG-027 copy | d1193da7 | the REAL −5% rate (was −10%), the derived 28-destination count (was 4), the derived RBAC header; prescolaire → UNKNOWN-031; 'Messager interne' gone at HEAD | t-e26-bug027 4/4 |
| BUG-020 pricing profile | f537c5fe | the deadline derives from the academic year (June 30 of the start year via earlyPaymentCutoff); the reversesId exclusion applied symmetrically (net invariant, presentation honest); the structured tranche_number wins | t-e26-bug020 8/8 |

## Verification
- Per-fix suites: **34 new pins**, all GREEN.
- Neighborhoods measured across the per-defect runs: **598 tests GREEN** (rbac/security 154 · AI tools 101 · modal consumers 46 · class-detail 25 · financials/payment 283).
- Session-open gates: tsc 0; the full battery **346 files / 5,723 passed / 0 failed / 5 skipped** (the Session-44 baseline + ai-309's leg-2).
- The FINAL full battery at closeout: **353 files (352 passed + 1 skipped) / 5,754 passed / 0 failed / 5 skipped** — the baseline MOVES to this figure citing Session 45 (+7 suites: the t-e26 per-fix files; ai-309's leg-2 was already in the open figure).

## Discoveries persisted
- **UNKNOWN-031** (docs/recovery/unknowns.md): the AcademicLevel taxonomy has no prescolaire value — the registration wizard cannot enroll maternelle children (the domain carries prescolaire GRADES and prices MS/GS rows, but the only path is a legacy best-effort fallback). An owner decision: extend the union / a dedicated maternelle flow / deliberate year-0 rows.
- The BUG-016 lesson (recorded in-code): a missing memo dep can be UNOBSERVABLE when the consumed input cannot affect the output without its context — the dep fix and the context fix are one fix.
- The reversesId idiom is now applied in THREE places consistently (cross-checks, the service pricing profile ×2 symmetric filters).

## Not done / deferred
- The Vercel redeploy stays owner-gated (the PAT still lacks /v9/projects scope — §15.111c).
- The register-hygiene pass over the v2.0 investigation register (18 cards) — the next census refinement.
