# T-437 Delivery — the 116th session (2026-09-29)

**Task:** T-437 — Student Re-enrollment, Academic History, Payment Handling & Direct Student Creation (GitHub issue #18).
**Status:** DONE — the backend legs LIVE-VERIFIED (verify_t-437.sql **27/27 GREEN**, zero residue), the full surface set TESTED (tsc 0 · eslint 0 errors · FULL vitest 4,320/18 — the failing set = the documented 9-file baseline).

## What was delivered

| Area | What |
|---|---|
| **The identity distinction** (issue §1, §6, §13, §14) | Student = the same person across all academic years; Enrollment = the per-year registration. `re_enrollments` (one row per student × target year) + the composite `fn_re_enroll_student` update the EXISTING student row — no code path in the flow can create a duplicate person; `student_academic_histories` stays append-only and untouched (INV-21). |
| **The Réinscription tab** (§2, §4) | The dedicated tab alongside Parents/Élèves, with the RED pending-decision badge, the source/target year bar (incl. the create-next-year affordance), the candidate worklist, and the freeze/finalize (refuses while any candidate is waiting). |
| **The candidates from finalized pedagogy** (§3) | Generated from the LIVE active roster + the FINALIZED `student_academic_histories` rows (the promotion flow's output — never a second pass/fail engine). Previous year/class, final result, average, pass/fail/repeating status, expected next level; the honest « Résultat non finalisé » state for history-less students. |
| **The pre-filled form** (§5) | The « Réinscrire » action opens the ReEnrollModal: identity/parent/previous year/class/result read-only; only the new-year placement (level/class/plan/transport/remise/FI) editable. The devis reuses `computeBilling`; the billing persists through the ONE shared wire builder in ONE transaction stamped `academic_year_id` = target. |
| **Payment handling** (§7) | The target year's FI + 3 tuition + 3 transport tranches generated automatically (the official T-425 model); previous-year rows untouched (INV-26a); the waterfall's oldest-due-first order preserves the year distinction; the new plan is immediately visible on every year-aware surface (the T-436 surfaces). The DATA-054 year-blind identity index that would have silently dropped every new-year tranche is fixed (migration 0129). |
| **The direct add-student** (§8–§10) | « Ajouter un élève » directly on the Élèves tab → the parent search-or-create step (`ParentRepository.search`) → the pre-filled student form → the billing persisted on the SAME family (an existing parent binds by its ACTUAL code — never a duplicate). The parent drawer's « Ajouter un enfant » leg now persists its devis too (the BUSINESS-109 repair). |
| **The origin** (§11–§12) | The structured origin block (origin type / previous school / previous level / previous academic year / notes) captured at creation (the wizard's step 2 + the direct form) and displayed as the DISTINCT « Origine / École précédente » card in the student's Infos tab — clearly separate from the at-school history (the Pédagogique tab). |

## The artifacts

| File | Contents |
|---|---|
| `AgentGithubUplaod-T437.zip` | The hub repo (desktop + the canonical backend + this documentation system) |
| `elimtiyaz-website-T437.zip` | The parent web portal |
| `elimtiyaz-all-systems-T437.zip` | Both, side by side (`all-systems-T437/`) |

## How to verify

1. **Build & run the desktop app** (`cd elimtiyaz-desktop && npm install && npm run dev`).
2. **The Réinscription tab:** CRM → Réinscription → pick the source year (2026-2027) → « Créer 2027-2028 » if missing → « Générer / Rafraîchir la liste » — the red badge counts the waiting candidates; the worklist shows each student's previous year/class + the finalized result (or « Non finalisé ») + the expected level.
3. **The re-enrollment:** « Réinscrire » on a candidate → the pre-filled form (the previous results read-only) → confirm the level → Facturation → the devis → Terminer — the student is re-enrolled for the target year and the tranches land stamped with that year (visible in the parent drawer's « Historique par Année Scolaire »).
4. **The freeze:** decide every candidate (Réinscrire / Ne continue pas) → « Figer la liste » — after the freeze everything is refused.
5. **The direct add-student:** CRM → Élèves → « Ajouter un élève » → search an existing parent (or create one) → the student form (with the « Origine / École précédente » section) → the billing steps → the child lands on the SELECTED family with the tranches written.
6. **The origin display:** open the student's profile → Infos → the « Origine / École précédente » card.
7. **The live backend evidence:** `docs/recovery/t-437-live-verification.md` (verify_t-437.sql 27/27 against the live project, zero residue).

## The knowledge

- `docs/decisions/ADR-031-re-enrollment-state-model.md` — the state model
- `docs/domain/academic-rules.md` §10 (INV-21..24) + `docs/domain/financial-rules.md` §18 (INV-25..26)
- `AGENTS.md` §15.69 — the session's reusable discoveries (the pipe-exit-code masking trap; the year-keyed identity audit; the extract-the-builder rule; the bind-by-actual-code seam; the shown-vs-persisted preview rule)
- `docs/recovery/t-437-live-verification.md` — the full live evidence
- Migrations: `0128_re_enrollment_and_student_origin.sql` + `0129_installments_year_scoped_identity.sql` (chain head 0129, both applied live atomically)

## What remains (the honest Left)

1. The owner's packaged-app visual pass over the new surfaces (the standing acceptance convention).
2. The school's REAL 2026-2027 → 2027-2028 transition through the new tab (the operational pass).
3. The `promotionCycles` slot stays mock-wired even in Supabase mode (a pre-existing gap flagged this session — it matters because the cycles write the histories the re-enrollment reads).
4. ACAD-511's import-time history writer (owner-gated, unchanged).
5. The Android/website ports of the origin fields + the re-enrollment surface (ADR-031 is the porting contract).
